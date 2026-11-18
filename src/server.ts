/** HTTP service for live NI database questions. Secrets stay in config and are never logged. */
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { config } from './config'
import { getPool } from './db'
import { ASK_ERROR_MESSAGE, answerQuestion, askRequestSchema, formatAskIssues } from './askService'
import { chat, chatRequestSchema, formatChatIssues, forwardChatStream, LlmHttpError } from './llm'
import { databaseConfig, getSchemaContext, schemaPanel, startSchemaRefresh } from './schemaService'

const app = express()

app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === config.ALLOWED_ORIGIN) {
      callback(null, true)
      return
    }
    callback(null, false)
  },
}))

app.use((req, res, next) => {
  const started = Date.now()
  const path = req.originalUrl.split('?')[0] ?? req.path
  res.on('finish', () => {
    console.log(JSON.stringify({
      method: req.method,
      path,
      status: res.statusCode,
      ms: Date.now() - started,
    }))
  })
  next()
})

app.use(express.json({ limit: '100kb' }))

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})
app.use(['/ask', '/llm'], chatLimiter)

interface HealthBody {
  status: 'ok' | 'error'
  database: string
  dbOk: boolean
  tableCount: number
  message?: string
}

const NO_DOCUMENTED_TABLES = 'the login cannot see any documented table'

app.get('/health', async (_req, res) => {
  const body: HealthBody = {
    status: 'error',
    database: config.DB_DATABASE,
    dbOk: false,
    tableCount: 0,
  }
  try {
    const pool = await getPool(databaseConfig())
    const result = await pool.request().query<{ tableCount: number }>(
      'SELECT COUNT(*) AS tableCount FROM INFORMATION_SCHEMA.TABLES',
    )
    const tableCount = Number(result.recordset[0]?.tableCount)
    if (!Number.isFinite(tableCount)) {
      res.status(503).json(body)
      return
    }
    const allowed = getSchemaContext()?.allowedTables ?? []
    if (allowed.length === 0) {
      res.status(503).json({ ...body, tableCount, message: NO_DOCUMENTED_TABLES })
      return
    }
    res.status(200).json({
      status: 'ok',
      database: config.DB_DATABASE,
      dbOk: true,
      tableCount,
    })
  } catch {
    res.status(503).json(body)
  }
})

app.get('/schema/drift', (_req, res) => {
  const ctx = getSchemaContext()
  if (!ctx) {
    res.status(503).json({ error: 'Schema is not loaded' })
    return
  }
  res.json(ctx.drift)
})

app.get('/schema', (_req, res) => {
  const ctx = getSchemaContext()
  if (!ctx) {
    res.status(503).json({ error: 'Schema is not loaded' })
    return
  }
  res.json(schemaPanel(ctx))
})

app.post('/ask', async (req, res) => {
  const parsed = askRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: formatAskIssues(parsed.error) })
    return
  }
  if (!getSchemaContext()) {
    res.status(503).json({ error: 'Schema is not loaded' })
    return
  }
  try {
    res.json(await answerQuestion(parsed.data))
  } catch (err) {
    console.error(JSON.stringify({ event: 'ask', name: err instanceof Error ? err.name : 'Error' }))
    res.status(500).json({ kind: 'error', message: ASK_ERROR_MESSAGE })
  }
})

app.post('/llm/chat', async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: formatChatIssues(parsed.error) })
    return
  }
  try {
    if (parsed.data.stream) {
      await forwardChatStream(parsed.data, res)
      return
    }
    const content = await chat(parsed.data)
    res.json({ content })
  } catch (err) {
    if (res.headersSent) return
    if (err instanceof LlmHttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    const aborted = typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'AbortError'
    res.status(aborted ? 504 : 502).json({ error: aborted ? 'LLM request timed out' : 'LLM request failed' })
  }
})

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }
  const status = typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
    ? err.status
    : 500
  const code = status >= 400 && status < 600 ? status : 500
  const error = code === 413 ? 'Payload too large' : code === 500 ? 'Internal error' : 'Bad request'
  res.status(code).json({ error })
})

async function boot(): Promise<void> {
  await startSchemaRefresh()
  const server = app.listen(config.PORT, () => {
    console.log(JSON.stringify({ event: 'listen', port: config.PORT }))
  })
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(JSON.stringify({ event: 'listen', code: err.code ?? 'error' }))
    process.exit(1)
  })
}

void boot()
