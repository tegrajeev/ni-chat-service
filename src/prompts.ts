/** Prompt templates for the two LLM calls. The LLM writes SQL and explains results; it never invents numbers. */
import type { Example } from './schemaContext'

export interface SqlDraft { sql: string; explanation: string; assumptions: string[] }

export function textToSqlSystemPrompt(schemaText: string, examples: readonly Example[], maxRows: number): string {
  return [
    'You write one Microsoft SQL Server (T-SQL) SELECT query that answers a question about Medicare Advantage provider networks in the NI database.',
    '',
    'Hard rules:',
    '- Output JSON only: {"sql": "...", "explanation": "one sentence in plain English", "assumptions": ["..."]}.',
    '- One SELECT statement (a WITH ... SELECT is fine). No INSERT/UPDATE/DELETE/DDL, no temp tables, no variables, no comments.',
    '- Use only the tables and columns listed in SCHEMA. Never guess a column name.',
    `- Return at most ${maxRows} rows: use TOP and an ORDER BY that puts the most useful rows first.`,
    '- Do not use EXCEPT, INTERSECT or OFFSET/FETCH. Use NOT EXISTS and TOP instead.',
    '- Aggregate in SQL (COUNT DISTINCT, SUM) instead of returning raw rows when the question asks "how many", "compare" or "which most".',
    '- Give result columns readable aliases (Providers, Enrollment, Payer).',
    '- Match names loosely: payer names with LIKE \'%humana%\', specialties via HWAISpecialtyDescription LIKE \'%cardio%\', counties with CountyName LIKE \'Bell%\' plus StateCode.',
    '- If the question cannot be answered from SCHEMA, return {"sql": "", "explanation": "why not", "assumptions": []}.',
    '- Put every interpretation you made (which state, which year, which payer name) in "assumptions".',
    '',
    'SCHEMA:',
    schemaText,
    '',
    'EXAMPLES:',
    ...examples.map((e) => `Q: ${e.question}\nSQL:\n${e.sql}\n`),
  ].join('\n')
}

export function repairMessage(previousSql: string, error: string): string {
  return `That query failed: ${error}\nPrevious SQL:\n${previousSql}\nReturn corrected JSON in the same format. Use only tables and columns from SCHEMA.`
}

export function answerSystemPrompt(): string {
  return [
    'You explain the result of a database query to a health plan network analyst.',
    '- Answer the question in 2-5 sentences of plain English, then up to 5 bullets with the key comparisons.',
    '- Use only numbers that appear in RESULT. Keep thousands separators. Never estimate or extrapolate.',
    '- If RESULT is empty, say no matching data was found and suggest one way to broaden the question.',
    '- If ROW_LIMIT_HIT is true, say the list was cut off at the row limit.',
    '- Mention the assumptions briefly if they affect the answer.',
    '- Do not mention SQL, tables or column names; the UI shows those separately as references.',
  ].join('\n')
}

export function answerUserMessage(question: string, draft: SqlDraft, columns: string[], rows: unknown[][], rowLimitHit: boolean): string {
  return JSON.stringify({ QUESTION: question, ASSUMPTIONS: draft.assumptions, COLUMNS: columns, RESULT: rows.slice(0, 50), ROW_LIMIT_HIT: rowLimitHit })
}

/** Parse the model's JSON reply into a SqlDraft, tolerating a code fence. */
export function parseSqlDraft(text: string): SqlDraft | null {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (typeof value?.sql !== 'string' || typeof value?.explanation !== 'string') return null
    const assumptions = Array.isArray(value.assumptions) ? value.assumptions.filter((a: unknown) => typeof a === 'string') : []
    return { sql: value.sql, explanation: value.explanation, assumptions }
  } catch {
    return null
  }
}
