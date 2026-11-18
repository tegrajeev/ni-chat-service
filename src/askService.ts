/** Text-to-SQL pipeline: write one SELECT, check it, run it, then explain the rows. */
import { readFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { config } from './config'
import { databaseConfig, getCatalog, getSchemaContext } from './schemaService'
import { MAX_ROWS, getPool, runGuardedQuery, type QueryResult } from './db'
import { chat, type ChatMessage, type ChatRequest } from './llm'
import {
  answerSystemPrompt,
  answerUserMessage,
  parseSqlDraft,
  repairMessage,
  textToSqlSystemPrompt,
  type SqlDraft,
} from './prompts'
import { guardSql, type GuardResult } from './sqlGuard'
import { renderSchema, type Catalog, type Example, type SchemaContext } from './schemaContext'

export const ASK_ERROR_MESSAGE = "I couldn't build a valid query for that. Try naming the payer, county or specialty."

export const askRequestSchema = z.object({
  question: z.string().max(500, 'question must be at most 500 characters').transform((value) => value.trim()).pipe(z.string().min(1, 'question is required')),
  context: z.object({
    payer: z.string().trim().max(200).optional(),
    county: z.string().trim().max(200).optional(),
    state: z.string().trim().max(200).optional(),
    system: z.string().trim().max(200).optional(),
  }).optional(),
})

export type AskInput = z.infer<typeof askRequestSchema>

export interface AskContext {
  payer?: string
  county?: string
  state?: string
  system?: string
}

export type AskResult =
  | { kind: 'cannot_answer'; explanation: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'data'
      answer: string
      explanation: string
      assumptions: string[]
      columns: string[]
      rows: unknown[][]
      rowLimitHit: boolean
      sql: string
      references: { table: string; description: string }[]
      timings: { llmMs: number; dbMs: number; totalMs: number }
    }

export interface AuditEntry {
  time: string
  question: string
  sql: string
  guard: string
  rowCount: number
  ms: number
  error?: string
}

export interface AskDeps {
  chat: (request: ChatRequest) => Promise<string>
  query: (sql: string) => Promise<QueryResult>
  schema: SchemaContext
  catalog: Catalog
  examples: readonly Example[]
  database: string
  audit?: (entry: AuditEntry) => void | Promise<void>
  log?: (line: string) => void
}

let cachedExamples: Example[] | null = null

export function loadExamples(): Example[] {
  if (cachedExamples) return cachedExamples
  const raw = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'examples.json'), 'utf8')) as { examples: Example[] }
  cachedExamples = raw.examples
  return cachedExamples
}

function redact(text: string): string {
  return text.split(config.DB_PASSWORD).join('[redacted]').split(config.LLM_API_KEY).join('[redacted]').slice(0, 500)
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Query failed'
  return redact(message)
}

/** Dates and byte strings become text. Numbers stay numbers so the answer check can see them. */
export function convertCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('utf8')
  if (typeof value === 'bigint') {
    const asNumber = Number(value)
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString()
  }
  return value
}

function numericValues(text: string): number[] {
  const found = text.match(/-?\d[\d,]*(?:\.\d+)?%?/g) ?? []
  return found
    .map((raw) => Number(raw.replace(/,/g, '').replace(/%/g, '')))
    .filter((value) => Number.isFinite(value))
}

/** Every number in the answer must already appear in the rows or the question. Commas and % are ignored. */
export function numbersMatchAnswer(answer: string, question: string, rows: unknown[][]): boolean {
  const allowed = numericValues(`${question}\n${JSON.stringify(rows)}`)
  return numericValues(answer).every((value) => allowed.some((candidate) => Math.abs(candidate - value) < 1e-6))
}

function templateAnswer(columns: string[], rows: unknown[][]): string {
  const lines = [`Here are the results (${rows.length} rows).`]
  for (const row of rows.slice(0, 3)) {
    const parts = columns.map((column, index) => `${column}: ${row[index] == null ? '' : String(row[index])}`)
    lines.push(`- ${parts.join(', ')}`)
  }
  return lines.join('\n')
}

function scenarioLine(context: AskContext | undefined): string {
  if (!context) return ''
  const parts = (['payer', 'county', 'state', 'system'] as const)
    .filter((key) => context[key])
    .map((key) => `${key}=${context[key]}`)
  return parts.length ? `Current scenario: ${parts.join(', ')}` : ''
}

function userText(input: AskInput): string {
  const line = scenarioLine(input.context)
  return line ? `${input.question}\n${line}` : input.question
}

function referencesFor(tables: string[], schema: SchemaContext): { table: string; description: string }[] {
  const byName = new Map(schema.tables.map((table) => [table.table.toLowerCase(), table.description]))
  return tables.map((table) => ({ table, description: byName.get(table.toLowerCase()) ?? '' }))
}

async function writeAuditFile(entry: AuditEntry): Promise<void> {
  const dir = join(__dirname, '..', 'logs')
  await mkdir(dir, { recursive: true })
  const line = {
    time: entry.time,
    question: entry.question,
    sql: entry.sql,
    guard: entry.guard,
    rowCount: entry.rowCount,
    ms: entry.ms,
    ...(entry.error ? { error: entry.error } : {}),
  }
  await appendFile(join(dir, 'ask.jsonl'), `${JSON.stringify(line)}\n`, 'utf8')
}

async function record(deps: AskDeps, entry: AuditEntry): Promise<void> {
  try {
    await (deps.audit ?? writeAuditFile)(entry)
  } catch (err) {
    deps.log?.(JSON.stringify({ event: 'ask_audit', message: errorText(err) }))
  }
}

function createDefaultDeps(): AskDeps {
  const schema = getSchemaContext()
  if (!schema) throw new Error('Schema is not loaded')
  return {
    chat,
    query: async (sql) => runGuardedQuery(await getPool(databaseConfig()), sql),
    schema,
    catalog: getCatalog(),
    examples: loadExamples(),
    database: config.DB_DATABASE,
    log: (line) => console.error(line),
  }
}

export async function answerQuestion(input: AskInput, deps: AskDeps = createDefaultDeps()): Promise<AskResult> {
  const started = Date.now()
  const system = textToSqlSystemPrompt(renderSchema(deps.schema, deps.catalog), deps.examples, MAX_ROWS)
  const questionText = userText(input)
  let messages: ChatMessage[] = [{ role: 'user', content: questionText }]
  let llmMs = 0
  let dbMs = 0
  let lastSql = ''
  let lastGuard = 'not run'
  let lastError = ''

  const elapsed = () => Date.now() - started
  const audit = (extra: { sql: string; guard: string; rowCount: number; error?: string }) => record(deps, {
    time: new Date().toISOString(),
    question: input.question,
    sql: extra.sql,
    guard: extra.guard,
    rowCount: extra.rowCount,
    ms: elapsed(),
    ...(extra.error ? { error: extra.error } : {}),
  })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const llmStarted = Date.now()
    const raw = await deps.chat({ system, messages: messages.map((message) => ({ ...message })), json: true })
    llmMs += Date.now() - llmStarted
    const draft = parseSqlDraft(raw)
    if (!draft) {
      lastError = 'The model did not return valid SQL JSON.'
      lastGuard = 'rejected'
      if (attempt === 0) {
        messages = [...messages, { role: 'user', content: repairMessage(lastSql, lastError) }]
        continue
      }
      break
    }
    if (!draft.sql.trim()) {
      await audit({ sql: '', guard: 'cannot_answer', rowCount: 0 })
      return { kind: 'cannot_answer', explanation: draft.explanation }
    }
    const guard = guardSql(draft.sql, { allowedTables: deps.schema.allowedTables, database: deps.database })
    if (!guard.ok) {
      lastSql = draft.sql
      lastGuard = guard.reason
      lastError = guard.reason
      if (attempt === 0) {
        messages = [
          { role: 'user', content: questionText },
          { role: 'assistant', content: raw },
          { role: 'user', content: repairMessage(draft.sql, guard.reason) },
        ]
        continue
      }
      break
    }
    lastSql = guard.sql
    lastGuard = 'ok'
    const queryStarted = Date.now()
    let result: QueryResult
    try {
      result = await deps.query(guard.sql)
      dbMs += result.ms
    } catch (err) {
      dbMs += Date.now() - queryStarted
      lastError = errorText(err)
      deps.log?.(JSON.stringify({ event: 'ask_sql_error', message: lastError }))
      if (attempt === 0) {
        await audit({ sql: guard.sql, guard: 'ok', rowCount: 0, error: lastError })
        messages = [
          { role: 'user', content: questionText },
          { role: 'assistant', content: raw },
          { role: 'user', content: repairMessage(guard.sql, lastError) },
        ]
        continue
      }
      break
    }
    return finishData(deps, input, draft, guard, result, llmMs, dbMs, elapsed, audit)
  }

  await audit({ sql: lastSql, guard: lastGuard, rowCount: 0, error: lastError || ASK_ERROR_MESSAGE })
  return { kind: 'error', message: ASK_ERROR_MESSAGE }
}

async function finishData(
  deps: AskDeps,
  input: AskInput,
  draft: SqlDraft,
  guard: Extract<GuardResult, { ok: true }>,
  result: QueryResult,
  llmMs: number,
  dbMs: number,
  elapsed: () => number,
  audit: (extra: { sql: string; guard: string; rowCount: number; error?: string }) => Promise<void>,
): Promise<AskResult> {
  const columns = result.columns
  const rows = result.rows.slice(0, MAX_ROWS).map((row) => row.map(convertCell))
  const llmStarted = Date.now()
  let answer = ''
  try {
    answer = await deps.chat({
      system: answerSystemPrompt(),
      messages: [{ role: 'user', content: answerUserMessage(input.question, draft, columns, rows, result.rowLimitHit) }],
    })
  } catch (err) {
    deps.log?.(JSON.stringify({ event: 'ask_answer', message: errorText(err) }))
    answer = ''
  }
  llmMs += Date.now() - llmStarted
  if (!answer.trim() || !numbersMatchAnswer(answer, input.question, rows)) answer = templateAnswer(columns, rows)
  const totalMs = elapsed()
  await audit({ sql: guard.sql, guard: 'ok', rowCount: rows.length })
  return {
    kind: 'data',
    answer,
    explanation: draft.explanation,
    assumptions: draft.assumptions,
    columns,
    rows,
    rowLimitHit: result.rowLimitHit,
    sql: guard.sql,
    references: referencesFor(guard.tables, deps.schema),
    timings: { llmMs, dbMs, totalMs },
  }
}

export function formatAskIssues(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const field = issue.path.length ? issue.path.map(String).join('.') : 'body'
    return `${field}: ${issue.message}`
  }).join('; ')
}
