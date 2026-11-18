/**
 * Builds the schema the LLM sees by merging the design document (schema_catalog.json)
 * with the live database (INFORMATION_SCHEMA). The live database always wins:
 *  - tables in the catalog but missing from the DB are dropped
 *  - columns are taken from the DB; descriptions/notes come from the catalog when names match
 *  - documented columns missing from the DB are reported as drift
 */

export interface CatalogColumn { name: string; type: string | null; pk: boolean; references?: string; note?: string }
export interface CatalogTable { table: string; layer: string; description: string; columns: CatalogColumn[]; notes: string[] }
export interface Catalog {
  database: string
  tables: CatalogTable[]
  joinPaths: { name: string; sql: string }[]
  pitfalls: string[]
  excludedTables: { table: string; reason: string }[]
}
export interface LiveColumn { table: string; column: string; dataType: string; maxLength: number | null }
export interface Example { question: string; sql: string }

export interface MergedTable {
  table: string
  description: string
  columns: { name: string; type: string; references?: string; note?: string }[]
  notes: string[]
}
export interface SchemaContext {
  tables: MergedTable[]
  allowedTables: string[]
  drift: { missingTables: string[]; missingColumns: string[]; undocumentedColumns: string[] }
}

function sqlType(c: LiveColumn): string {
  if (c.maxLength == null) return c.dataType
  return `${c.dataType}(${c.maxLength === -1 ? 'max' : c.maxLength})`
}

export function mergeSchema(catalog: Catalog, live: readonly LiveColumn[]): SchemaContext {
  const liveByTable = new Map<string, LiveColumn[]>()
  for (const c of live) {
    const key = c.table.toLowerCase()
    liveByTable.set(key, [...(liveByTable.get(key) ?? []), c])
  }
  const drift = { missingTables: [] as string[], missingColumns: [] as string[], undocumentedColumns: [] as string[] }
  const tables: MergedTable[] = []
  for (const t of catalog.tables) {
    const liveCols = liveByTable.get(t.table.toLowerCase())
    if (!liveCols) {
      drift.missingTables.push(t.table)
      continue
    }
    const doc = new Map(t.columns.map((c) => [c.name.toLowerCase(), c]))
    const liveNames = new Set(liveCols.map((c) => c.column.toLowerCase()))
    for (const c of t.columns) if (!liveNames.has(c.name.toLowerCase())) drift.missingColumns.push(`${t.table}.${c.name}`)
    tables.push({
      table: liveCols[0].table, // live spelling
      description: t.description,
      columns: liveCols.map((c) => {
        const d = doc.get(c.column.toLowerCase())
        if (!d) drift.undocumentedColumns.push(`${t.table}.${c.column}`)
        return { name: c.column, type: sqlType(c), ...(d?.references ? { references: d.references } : {}), ...(d?.note ? { note: d.note } : {}) }
      }),
      notes: t.notes,
    })
  }
  return { tables, allowedTables: tables.map((t) => t.table), drift }
}

/** Compact text form of the schema for the prompt (~5K tokens for the full NI schema). */
export function renderSchema(ctx: SchemaContext, catalog: Catalog): string {
  const lines: string[] = []
  for (const t of ctx.tables) {
    lines.push(`TABLE ${t.table} -- ${t.description}`)
    for (const c of t.columns) {
      const extra = [c.references ? `-> ${c.references}` : '', c.note ?? ''].filter(Boolean).join('; ')
      lines.push(`  ${c.name} ${c.type}${extra ? `  -- ${extra}` : ''}`)
    }
    for (const n of t.notes) lines.push(`  NOTE: ${n}`)
  }
  lines.push('', 'JOIN PATHS:', ...catalog.joinPaths.map((j) => `- ${j.name}: ${j.sql}`))
  lines.push('', 'RULES:', ...catalog.pitfalls.map((p) => `- ${p}`))
  return lines.join('\n')
}
