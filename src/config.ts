/** Load and validate .env.local. Values are never printed. */
import dotenv from 'dotenv'
import { z } from 'zod'

/** Trim strings. Blank values are treated as unset so defaults can apply. */
function trimEnv(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function requiredText(name: string) {
  return z.preprocess(trimEnv, z.string({ error: `${name} is required` }).min(1, `${name} is required`))
}

function optionalText() {
  return z.preprocess(trimEnv, z.string().min(1).optional())
}

function portNumber(name: string) {
  const message = `${name} must be an integer from 1 to 65535`
  return z
    .string({ error: message })
    .regex(/^\d+$/, message)
    .transform((value) => Number(value))
    .pipe(z.number().int().min(1).max(65535))
}

function envFlag(fallback: boolean) {
  return z.preprocess(
    trimEnv,
    z.stringbool('must be true or false').optional().default(fallback),
  )
}

const envSchema = z.object({
  DB_SERVER: requiredText('DB_SERVER'),
  DB_DATABASE: requiredText('DB_DATABASE'),
  DB_USER: requiredText('DB_USER'),
  DB_PASSWORD: requiredText('DB_PASSWORD'),
  DB_PORT: z.preprocess(trimEnv, portNumber('DB_PORT').optional()),
  DB_ENCRYPT: envFlag(true),
  DB_TRUST_CERT: envFlag(false),
  LLM_BASE_URL: z.preprocess(
    trimEnv,
    z.string({ error: 'LLM_BASE_URL is required' }).url('LLM_BASE_URL must be an absolute URL'),
  ),
  LLM_API_KEY: requiredText('LLM_API_KEY'),
  LLM_MODEL: requiredText('LLM_MODEL'),
  LLM_API_VERSION: optionalText(),
  ALLOWED_ORIGIN: z.preprocess(
    trimEnv,
    z.string({ error: 'ALLOWED_ORIGIN is required' }).url('ALLOWED_ORIGIN must be an absolute URL'),
  ),
  PORT: z.preprocess(trimEnv, portNumber('PORT').optional().default(4010)),
})

export type AppConfig = z.infer<typeof envSchema>

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length ? issue.path.map(String).join('.') : 'environment'
      return `- ${field}: ${issue.message}`
    })
    .join('\n')
}

/** Validate an environment object. Throws an Error whose message lists field names only. */
export function parseEnv(source: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${formatIssues(parsed.error)}`)
  }
  return parsed.data
}

function loadConfig(): AppConfig {
  const loaded = dotenv.config({ path: '.env.local', quiet: true })
  try {
    return parseEnv(process.env)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Invalid configuration'
    const fileNote = loaded.error
      ? `Could not read .env.local (${loaded.error.code ?? 'error'}).\n`
      : ''
    console.error(`${fileNote}${detail}\nFix .env.local and restart.`)
    process.exit(1)
  }
}

export const config = loadConfig()
