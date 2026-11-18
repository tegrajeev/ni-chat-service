import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Parser } from 'node-sql-parser'
import { guardSql } from './sqlGuard'

const docs = join(__dirname, '..', 'docs')
const catalog = JSON.parse(readFileSync(join(docs, 'schema_catalog.json'), 'utf8'))
const { examples } = JSON.parse(readFileSync(join(docs, 'examples.json'), 'utf8'))
const opts = { allowedTables: catalog.tables.map((t: any) => t.table), database: 'NI_hackathon_data' }
const columns = new Map<string, Set<string>>(catalog.tables.map((t: any) => [t.table.toLowerCase(), new Set(t.columns.map((c: any) => c.name.toLowerCase()))]))

test('every example passes the guard', () => {
  for (const ex of examples) {
    const r = guardSql(ex.sql, opts)
    assert.equal(r.ok, true, `${ex.question}: ${r.ok ? '' : r.reason}`)
  }
})

test('every qualified column in the examples exists in the documented schema', () => {
  const parser = new Parser()
  for (const ex of examples) {
    // alias -> table map from FROM/JOIN clauses
    const aliases = new Map<string, string>()
    for (const m of ex.sql.matchAll(/\b(?:FROM|JOIN)\s+(?:dbo\.)?\[?(\w+)\]?\s+(?:AS\s+)?(\w+)/gi)) aliases.set(m[2].toLowerCase(), m[1].toLowerCase())
    const missing: string[] = []
    for (const m of ex.sql.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const table = aliases.get(m[1].toLowerCase())
      if (!table || !columns.has(table)) continue // CTE alias or dbo prefix
      if (!columns.get(table)!.has(m[2].toLowerCase())) missing.push(`${m[1]}.${m[2]} (${table})`)
    }
    assert.deepEqual(missing, [], `${ex.question}: unknown columns ${missing.join(', ')}`)
    parser.astify(ex.sql, { database: 'TransactSQL' })
  }
})
