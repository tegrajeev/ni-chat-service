/** Live schema cache: catalog merged with INFORMATION_SCHEMA, refreshed every 10 minutes. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config'
import { getPool, readLiveSchema, type DbConfig } from './db'
import { mergeSchema, renderSchema, type Catalog, type SchemaContext } from './schemaContext'

const REFRESH_MS = 10 * 60 * 1000

export function databaseConfig(): DbConfig {
  return {
    server: config.DB_SERVER,
    database: config.DB_DATABASE,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    port: config.DB_PORT,
    encrypt: config.DB_ENCRYPT,
    trustServerCertificate: config.DB_TRUST_CERT,
  }
}

function loadCatalog(): Catalog {
  const file = join(__dirname, '..', 'docs', 'schema_catalog.json')
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!raw || typeof raw !== 'object') throw new Error('docs/schema_catalog.json is not an object')
  const catalog = raw as Catalog
  if (!Array.isArray(catalog.tables) || !Array.isArray(catalog.joinPaths) || !Array.isArray(catalog.pitfalls)) {
    throw new Error('docs/schema_catalog.json is missing tables, joinPaths, or pitfalls')
  }
  return catalog
}

const catalog = loadCatalog()

interface Snapshot {
  context: SchemaContext
  text: string
}

let snapshot: Snapshot | null = null
let timer: ReturnType<typeof setInterval> | null = null
let driftPrinted = false

export function getCatalog(): Catalog {
  return catalog
}

export function getSchemaContext(): SchemaContext | null {
  return snapshot?.context ?? null
}

/** Prompt text from the latest successful merge. Empty until the first refresh. */
export function getRenderedSchema(): string {
  return snapshot?.text ?? ''
}

export function schemaPanel(ctx: SchemaContext): {
  tables: { table: string; description: string; columns: { name: string; type: string; references?: string; note?: string }[] }[]
} {
  return {
    tables: ctx.tables.map((table) => ({
      table: table.table,
      description: table.description,
      columns: table.columns.map((column) => ({
        name: column.name,
        type: column.type,
        ...(column.references ? { references: column.references } : {}),
        ...(column.note ? { note: column.note } : {}),
      })),
    })),
  }
}

export function formatDrift(drift: SchemaContext['drift']): string {
  const sections: [string, string[]][] = [
    ['Missing tables', drift.missingTables],
    ['Missing columns', drift.missingColumns],
    ['Undocumented columns', drift.undocumentedColumns],
  ]
  const lines = ['Schema drift:']
  for (const [label, items] of sections) {
    lines.push(`${label} (${items.length}):`)
    if (items.length === 0) lines.push('  (none)')
    else for (const item of items) lines.push(`  - ${item}`)
  }
  return lines.join('\n')
}

function safeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Schema refresh failed'
  return message.split(config.DB_PASSWORD).join('[redacted]').split(config.LLM_API_KEY).join('[redacted]').slice(0, 300)
}

export async function refreshLiveSchema(): Promise<SchemaContext> {
  const pool = await getPool(databaseConfig())
  const live = await readLiveSchema(pool)
  const context = mergeSchema(catalog, live)
  snapshot = { context, text: renderSchema(context, catalog) }
  return context
}

/** Load the schema now, print drift once, then refresh every 10 minutes. */
export async function startSchemaRefresh(): Promise<void> {
  try {
    const context = await refreshLiveSchema()
    if (!driftPrinted) {
      console.log(formatDrift(context.drift))
      driftPrinted = true
    }
  } catch (err) {
    console.error(JSON.stringify({ event: 'schema_refresh', message: safeErrorMessage(err) }))
  }
  if (timer) return
  timer = setInterval(() => {
    void refreshLiveSchema().catch((err) => {
      console.error(JSON.stringify({ event: 'schema_refresh', message: safeErrorMessage(err) }))
    })
  }, REFRESH_MS)
  timer.unref()
}
