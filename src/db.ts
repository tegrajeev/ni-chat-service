/** SQL Server access for the chatbot: read-only login, row cap, timeout. */
import sql from 'mssql'
import type { LiveColumn } from './schemaContext'

export interface DbConfig {
  server: string
  database: string
  user: string
  password: string
  port?: number
  encrypt?: boolean
  trustServerCertificate?: boolean
}

export const MAX_ROWS = 500
const REQUEST_TIMEOUT_MS = 15_000

let pool: sql.ConnectionPool | null = null

export async function getPool(cfg: DbConfig): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool
  pool = await new sql.ConnectionPool({
    server: cfg.server,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port ?? 1433,
    requestTimeout: REQUEST_TIMEOUT_MS,
    connectionTimeout: 10_000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
    options: { encrypt: cfg.encrypt ?? true, trustServerCertificate: cfg.trustServerCertificate ?? false },
  }).connect()
  return pool
}

/** Column list for the tables this login can see. */
export async function readLiveSchema(p: sql.ConnectionPool): Promise<LiveColumn[]> {
  const r = await p.request().query(`
    SELECT TABLE_NAME AS [table], COLUMN_NAME AS [column], DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLength
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' ORDER BY TABLE_NAME, ORDINAL_POSITION`)
  return r.recordset as LiveColumn[]
}

export interface QueryResult { columns: string[]; rows: unknown[][]; rowLimitHit: boolean; ms: number }

/**
 * Run a query that already passed guardSql. SET ROWCOUNT caps rows server-side;
 * READ UNCOMMITTED avoids blocking ETL loads on the hackathon database.
 */
export async function runGuardedQuery(p: sql.ConnectionPool, guardedSql: string): Promise<QueryResult> {
  const started = Date.now()
  const request = p.request()
  const batch = `SET NOCOUNT ON; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET ROWCOUNT ${MAX_ROWS + 1};\n${guardedSql}\n;SET ROWCOUNT 0;`
  const result = await request.query(batch)
  const recordset = result.recordset ?? []
  const columns = Object.keys(recordset.columns ?? {})
  const rows = recordset.slice(0, MAX_ROWS).map((r: Record<string, unknown>) => columns.map((c) => r[c]))
  return { columns, rows, rowLimitHit: recordset.length > MAX_ROWS, ms: Date.now() - started }
}
