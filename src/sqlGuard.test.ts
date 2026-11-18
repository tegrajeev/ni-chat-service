import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { guardSql, stripComments } from './sqlGuard'

const catalog = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'schema_catalog.json'), 'utf8'))
const opts = { allowedTables: catalog.tables.map((t: { table: string }) => t.table), database: 'NI_hackathon_data' }
const ok = (sql: string) => {
  const r = guardSql(sql, opts)
  assert.equal(r.ok, true, `expected OK, got: ${r.ok ? '' : r.reason}\n${sql}`)
  return r as { ok: true; sql: string; tables: string[] }
}
const blocked = (sql: string, why?: RegExp) => {
  const r = guardSql(sql, opts)
  assert.equal(r.ok, false, `expected BLOCKED:\n${sql}`)
  if (why && !r.ok) assert.match(r.reason, why)
}

test('allows realistic network comparison queries and reports tables used', () => {
  const r = ok(`SELECT TOP 20 po.ParentOrganizationName, COUNT(DISTINCT pl.NPI) AS providers
    FROM dbo.NetworkProviderMapping npm
    JOIN ProviderLocation pl ON pl.ProviderLocationId = npm.ProviderLocationId
    JOIN [ParentOrganization] po ON po.ParentOrganizationId = npm.ParentOrganizationId
    WHERE pl.FIPS = '48113' GROUP BY po.ParentOrganizationName ORDER BY providers DESC`)
  assert.deepEqual(r.tables, ['NetworkProviderMapping', 'ParentOrganization', 'ProviderLocation'])
})

test('allows CTEs, CAST joins, window functions, three-part names in the right database', () => {
  ok("WITH a AS (SELECT DISTINCT pl.NPI FROM ProviderLocation pl WHERE pl.FIPS = '48113') SELECT COUNT(*) FROM a")
  ok('SELECT hd.HosptitalName FROM ProviderHospitalAffiliation pha JOIN HospitalDetails hd ON hd.HospitalNPI = CAST(pha.HospitalNPI AS varchar(10))')
  ok('SELECT c.FIPS, ROW_NUMBER() OVER (PARTITION BY c.StateCode ORDER BY c.FIPS) rn FROM County c')
  ok('SELECT COUNT(*) FROM NI_hackathon_data.dbo.County')
  ok('```sql\nSELECT TOP 5 * FROM County;\n```')
})

test('values that look like keywords inside strings are fine', () => {
  ok("SELECT * FROM ParentOrganization WHERE ParentOrganizationName LIKE '%Insert Health; DROP%'")
})

test('blocks writes and multiple statements', () => {
  blocked('DELETE FROM County', /SELECT/)
  blocked('SELECT 1; DROP TABLE County', /one statement/)
  blocked("UPDATE County SET CountyName = 'x'")
  blocked('SELECT * INTO #t FROM County', /INTO|Temporary/)
  blocked('SELECT * INTO County_copy FROM County', /INTO/)
  blocked('WITH x AS (SELECT 1 a) DELETE FROM County')
  blocked('TRUNCATE TABLE County')
})

test('blocks side effects, system objects and other databases', () => {
  blocked('SELECT name FROM sys.tables', /System catalog/)
  blocked('SELECT * FROM INFORMATION_SCHEMA.COLUMNS', /System catalog/)
  blocked("SELECT * FROM OPENROWSET('SQLNCLI','x','select 1')", /OPENROWSET/)
  blocked("EXEC xp_cmdshell 'dir'")
  blocked('SELECT 1 WHERE 1=1 WAITFOR DELAY \'00:00:10\'', /WAITFOR/)
  blocked('SELECT @@VERSION', /@/)
  blocked('SELECT * FROM OtherDb.dbo.Users', /Only tables/)
  blocked('SELECT * FROM LinkedSrv.OtherDb.dbo.Users')
  blocked('SELECT * FROM master.dbo.sysdatabases')
})

test('blocks tables outside the allowlist, including excluded client config tables', () => {
  blocked('SELECT * FROM ClientDetails', /not available/)
  blocked('SELECT * FROM LobbyUserConfig', /not available/)
  blocked('SELECT * FROM SomeRandomTable', /not available/)
  blocked('SELECT * FROM County c JOIN (SELECT * FROM ClientNetworkMapping) x ON 1=1', /not available/)
})

test('comments are stripped before checks and execution', () => {
  assert.equal(stripComments("SELECT 1 -- DROP TABLE x\nFROM County /* hi */").replace(/\s+/g, ' ').trim(), 'SELECT 1 FROM County')
  const r = ok('SELECT TOP 1 * FROM County -- ; DROP TABLE County')
  assert.ok(!r.sql.includes('DROP'))
  assert.equal(stripComments("SELECT '--not a comment' FROM County"), "SELECT '--not a comment' FROM County")
})

test('unsupported syntax fails closed with a hint the LLM can act on', () => {
  blocked('SELECT FIPS FROM County EXCEPT SELECT FIPS FROM ProviderLocation', /NOT EXISTS/)
  blocked('SELECT FIPS FROM County ORDER BY FIPS OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY', /TOP/)
})
