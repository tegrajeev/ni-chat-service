/**
 * SQL guard for LLM-written queries.
 *
 * Defense in depth. This is layer 2 of 3:
 *   1. The database login is read-only and can only SELECT the allowed tables (sql/create_readonly_login.sql).
 *   2. This guard: one SELECT statement, allowlisted tables only, no writes/side effects/system objects.
 *   3. Execution limits: SET ROWCOUNT cap + request timeout (see db.ts).
 *
 * Fail closed: anything the parser cannot read is rejected, and the LLM is asked to rewrite it.
 */
import { Parser } from 'node-sql-parser'

export interface GuardOptions {
  /** Table names the chatbot may read (case-insensitive). Usually the live tables ∩ schema_catalog.json. */
  allowedTables: readonly string[]
  /** The database name allowed in three-part names, e.g. NI_hackathon_data. */
  database: string
}

export type GuardResult =
  | { ok: true; sql: string; tables: string[] }
  | { ok: false; reason: string }

const parser = new Parser()
const PARSE_OPT = { database: 'TransactSQL' }

// Keywords that never belong in a read-only analytics query.
const FORBIDDEN = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE', 'DENY',
  'EXEC', 'EXECUTE', 'DECLARE', 'SET', 'USE', 'WAITFOR', 'BACKUP', 'RESTORE', 'DBCC', 'SHUTDOWN', 'KILL',
  'OPENROWSET', 'OPENQUERY', 'OPENDATASOURCE', 'OPENXML', 'BULK', 'RECONFIGURE', 'INTO',
]
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i')

/** Remove comments, keeping string literals intact. */
export function stripComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === "'") {
      // copy a string literal, handling '' escapes
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") break
        else j += 1
      }
      out += sql.slice(i, j + 1)
      i = j + 1
    } else if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
    } else {
      out += ch
      i += 1
    }
  }
  return out
}

/** Replace string literal contents so keyword checks don't trip on values like 'Insert Health Plan'. */
function blankLiterals(sql: string): string {
  return sql.replace(/N?'(?:[^']|'')*'/g, "''")
}

function cleanCodeFence(text: string): string {
  return text.trim().replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/, '').trim()
}

export function guardSql(input: string, options: GuardOptions): GuardResult {
  let sql = stripComments(cleanCodeFence(input)).trim()
  sql = sql.replace(/;\s*$/, '').trim() // one trailing semicolon is fine
  if (!sql) return { ok: false, reason: 'Empty query.' }
  if (sql.length > 8000) return { ok: false, reason: 'Query is too long.' }

  const code = blankLiterals(sql)
  if (code.includes(';')) return { ok: false, reason: 'Only one statement is allowed.' }
  if (!/^\s*(SELECT|WITH)\b/i.test(code)) return { ok: false, reason: 'Only SELECT queries are allowed.' }
  const forbidden = code.match(FORBIDDEN_RE)
  if (forbidden) return { ok: false, reason: `Keyword "${forbidden[1].toUpperCase()}" is not allowed.` }
  if (/\b(xp|sp)_\w+/i.test(code)) return { ok: false, reason: 'System procedures are not allowed.' }
  if (/@@|@\w/.test(code)) return { ok: false, reason: 'Variables and system functions (@, @@) are not allowed.' }
  if (/#\w/.test(code)) return { ok: false, reason: 'Temporary tables are not allowed.' }
  if (/\b(sys|INFORMATION_SCHEMA)\s*\./i.test(code)) return { ok: false, reason: 'System catalog views are not allowed.' }

  let ast: unknown
  try {
    ast = parser.astify(sql, PARSE_OPT)
  } catch {
    return {
      ok: false,
      reason: 'The query could not be parsed. Use plain T-SQL SELECT; avoid EXCEPT/INTERSECT (use NOT EXISTS) and OFFSET/FETCH (use TOP).',
    }
  }
  const statements = (Array.isArray(ast) ? ast : [ast]) as Array<Record<string, any>>
  if (statements.length !== 1) return { ok: false, reason: 'Only one statement is allowed.' }
  const stmt = statements[0]
  if (stmt.type !== 'select') return { ok: false, reason: 'Only SELECT queries are allowed.' }
  if (stmt.into && stmt.into.expr) return { ok: false, reason: 'SELECT INTO is not allowed.' }

  const cteNames = new Set<string>(
    (stmt.with ?? []).map((w: any) => String(w?.name?.value ?? w?.name ?? '').toLowerCase()).filter(Boolean)
  )
  const allowed = new Map(options.allowedTables.map((t) => [t.toLowerCase(), t]))
  const used = new Set<string>()
  let entries: string[]
  try {
    entries = parser.tableList(sql, PARSE_OPT)
  } catch {
    return { ok: false, reason: 'The query could not be parsed.' }
  }
  for (const entry of entries) {
    const [action, schemaPart, tablePart] = entry.split('::')
    if (action.toLowerCase() !== 'select') return { ok: false, reason: `Operation "${action}" is not allowed.` }
    const table = tablePart.replace(/^\[|\]$/g, '')
    const schema = (schemaPart ?? 'null').replace(/[[\]]/g, '')
    const schemaOk = schema === 'null' || /^dbo$/i.test(schema) || schema.toLowerCase() === `${options.database.toLowerCase()}.dbo`
    if (!schemaOk) return { ok: false, reason: `Only tables in ${options.database}.dbo can be queried (got "${schema}").` }
    if (schema === 'null' && cteNames.has(table.toLowerCase())) continue
    const canonical = allowed.get(table.toLowerCase())
    if (!canonical) return { ok: false, reason: `Table "${table}" is not available. Use only the tables in the reference.` }
    used.add(canonical)
  }
  if (used.size === 0 && entries.length === 0 && /\bFROM\b/i.test(code)) {
    return { ok: false, reason: 'Could not identify the tables in the query.' }
  }
  return { ok: true, sql, tables: [...used].sort() }
}
