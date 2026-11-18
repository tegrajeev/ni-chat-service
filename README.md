# NI live-data chat kit

Lets the Network What-If chatbot answer questions from `NI_hackathon_data` in real time, with references.

## How a question is answered

1. **Route.** The PNC chat decides: what-if scenario (existing engine) or data question (this service).
2. **Write SQL.** The service sends the LLM the question plus `docs/SCHEMA_REFERENCE.md` content (merged with the live
   schema, about 6K tokens) and 10 worked examples. The LLM returns one SELECT, an explanation and its assumptions.
3. **Check.** `sqlGuard` allows one SELECT on the 41 documented tables only. Rejected queries go back to the LLM once with the reason.
4. **Run.** Read-only login, max 500 rows, 15 s timeout.
5. **Explain.** A second LLM call explains the rows. Numbers not present in the rows are rejected, and a template is used instead.
6. **Show references.** The tables used (with their descriptions), the SQL, and the assumptions appear under the answer, with a link to the schema reference.

## Safety layers
1. Database login can only SELECT the allowed tables (`sql/create_readonly_login.sql`).
2. `src/sqlGuard.ts`: 8 tests including attack cases (13 tests across the kit).
3. Row cap, timeout, rate limit, audit log of every generated query.
4. The LLM key and DB password live only in the service's `.env.local`, never in the browser bundle.

## Files
- `CURSOR_PHASES_DB.md`: seven Cursor prompts with "Done when" checks
- `docs/`: schema reference (Markdown for people and the LLM, JSON for code) and examples
- `src/`: starter TypeScript code (`npm install`, `npm test`)
- `sql/`: read-only login script
- `scripts/`: how the docs were generated from `NI_Table_Schema.xlsx`. If the schema changes, re-run:
  `python3 scripts/parse_schema.py NI_Table_Schema.xlsx raw.json && python3 scripts/build_catalog.py raw.json docs`
