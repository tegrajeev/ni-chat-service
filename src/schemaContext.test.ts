import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeSchema, renderSchema, type Catalog, type LiveColumn } from './schemaContext'
import { textToSqlSystemPrompt, parseSqlDraft } from './prompts'

const docs = join(__dirname, '..', 'docs')
const catalog: Catalog = JSON.parse(readFileSync(join(docs, 'schema_catalog.json'), 'utf8'))
const { examples } = JSON.parse(readFileSync(join(docs, 'examples.json'), 'utf8'))

/** Pretend the live DB matches the design, except for a few realistic differences. */
function fakeLive(): LiveColumn[] {
  const live: LiveColumn[] = []
  for (const t of catalog.tables) {
    if (t.table === 'NPIQuickFilterMapping') continue // table not built yet
    for (const c of t.columns) {
      if (t.table === 'HospitalDetails' && c.name === 'HosptitalName') {
        live.push({ table: 'HospitalDetails', column: 'HospitalName', dataType: 'varchar', maxLength: 100 }) // typo fixed in DB
        continue
      }
      live.push({ table: t.table, column: c.name, dataType: 'varchar', maxLength: 50 })
    }
  }
  live.push({ table: 'ClientDetails', column: 'ClientName', dataType: 'varchar', maxLength: 100 }) // visible but excluded
  return live
}

test('live schema wins and drift is reported', () => {
  const ctx = mergeSchema(catalog, fakeLive())
  assert.ok(!ctx.allowedTables.includes('NPIQuickFilterMapping'))
  assert.ok(!ctx.allowedTables.includes('ClientDetails'), 'excluded tables never become allowed')
  assert.deepEqual(ctx.drift.missingTables, ['NPIQuickFilterMapping'])
  assert.ok(ctx.drift.missingColumns.includes('HospitalDetails.HosptitalName'))
  assert.ok(ctx.drift.undocumentedColumns.includes('HospitalDetails.HospitalName'))
  const hd = ctx.tables.find((t) => t.table === 'HospitalDetails')!
  assert.ok(hd.columns.some((c) => c.name === 'HospitalName'))
})

test('full prompt stays small enough to send on every question', () => {
  const ctx = mergeSchema(catalog, fakeLive())
  const prompt = textToSqlSystemPrompt(renderSchema(ctx, catalog), examples, 500)
  const approxTokens = Math.round(prompt.length / 4)
  console.log(`prompt chars=${prompt.length} (~${approxTokens} tokens), tables=${ctx.tables.length}`)
  assert.ok(approxTokens < 12000)
})

test('parses model JSON, with or without a code fence', () => {
  assert.equal(parseSqlDraft('```json\n{"sql":"SELECT 1","explanation":"x","assumptions":["TX"]}\n```')?.assumptions[0], 'TX')
  assert.equal(parseSqlDraft('not json'), null)
  assert.equal(parseSqlDraft('{"explanation":"no sql"}'), null)
})
