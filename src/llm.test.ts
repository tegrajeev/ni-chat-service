import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chat, chatRequestSchema, LlmHttpError, readSseDeltas, type LlmSettings } from './llm'

const openai: LlmSettings = {
  apiKey: 'sk-openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1',
}

const azure: LlmSettings = {
  apiKey: 'azure-secret',
  baseUrl: 'https://demo.openai.azure.com',
  model: 'gpt-demo',
  apiVersion: '2024-10-21',
}

function completion(content: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content } }] }),
    body: { cancel: async () => undefined },
  } as unknown as Response
}

function recordedFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error('unexpected fetch')
    return next
  }
  return { calls, fetchImpl }
}

function headersOf(init: RequestInit): Headers {
  return new Headers(init.headers)
}

function bodyOf(init: RequestInit): { temperature: number; max_tokens: number; model: string; messages: { role: string; content: string }[]; response_format?: { type: string } } {
  return JSON.parse(String(init.body)) as ReturnType<typeof bodyOf>
}

test('OpenAI requests use a bearer token', async () => {
  const { calls, fetchImpl } = recordedFetch([completion('hello')])
  const text = await chat(
    { system: 'rules', messages: [{ role: 'user', content: 'hello' }], json: true },
    { ...openai, fetch: fetchImpl },
  )
  assert.equal(text, 'hello')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions')
  const headers = headersOf(calls[0].init)
  assert.equal(headers.get('Authorization'), 'Bearer sk-openai')
  assert.equal(headers.get('api-key'), null)
  const body = bodyOf(calls[0].init)
  assert.equal(body.temperature, 0)
  assert.equal(body.max_tokens, 1200)
  assert.equal(body.model, 'gpt-4.1')
  assert.deepEqual(body.response_format, { type: 'json_object' })
  assert.deepEqual(body.messages[0], { role: 'system', content: 'rules' })
})

test('Azure requests use the deployments URL and api-key header', async () => {
  const { calls, fetchImpl } = recordedFetch([completion('ok')])
  await chat(
    { system: 's', messages: [{ role: 'user', content: 'q' }] },
    { ...azure, fetch: fetchImpl },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://demo.openai.azure.com/openai/deployments/gpt-demo/chat/completions?api-version=2024-10-21')
  const headers = headersOf(calls[0].init)
  assert.equal(headers.get('api-key'), 'azure-secret')
  assert.equal(headers.get('Authorization'), null)
  const body = bodyOf(calls[0].init)
  assert.equal(body.temperature, 0)
  assert.equal(body.max_tokens, 1200)
})

test('retries once on 503', async () => {
  const { calls, fetchImpl } = recordedFetch([completion('', 503), completion('recovered')])
  const text = await chat(
    { system: 's', messages: [{ role: 'user', content: 'q' }] },
    { ...openai, fetch: fetchImpl },
  )
  assert.equal(text, 'recovered')
  assert.equal(calls.length, 2)
  assert.equal(headersOf(calls[1].init).get('Authorization'), 'Bearer sk-openai')
})

test('does not retry a 400', async () => {
  const { calls, fetchImpl } = recordedFetch([completion('no', 400), completion('should-not-run')])
  await assert.rejects(
    () => chat({ system: 's', messages: [{ role: 'user', content: 'q' }] }, { ...openai, fetch: fetchImpl }),
    (error: unknown) => error instanceof LlmHttpError && error.status === 400,
  )
  assert.equal(calls.length, 1)
})

test('Anthropic requests use the Messages API and x-api-key', async () => {
  const claude: LlmSettings = {
    apiKey: 'sk-ant-test',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiVersion: '2024-10-21',
  }
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ content: [{ type: 'text', text: '{"sql":"SELECT 1"}' }] }),
    body: { cancel: async () => undefined },
  } as unknown as Response
  const { calls, fetchImpl } = recordedFetch([response])
  const text = await chat(
    { system: 'rules', messages: [{ role: 'user', content: 'hello' }], json: true },
    { ...claude, fetch: fetchImpl },
  )
  assert.equal(text, '{"sql":"SELECT 1"}')
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  const headers = headersOf(calls[0].init)
  assert.equal(headers.get('x-api-key'), 'sk-ant-test')
  assert.equal(headers.get('anthropic-version'), '2023-06-01')
  assert.equal(headers.get('Authorization'), null)
  const body = JSON.parse(String(calls[0].init.body)) as { system: string; messages: { role: string }[]; response_format?: unknown; max_tokens: number }
  assert.equal(body.system, 'rules\nReply with one JSON object only.')
  assert.equal(body.max_tokens, 1200)
  assert.equal(body.response_format, undefined)
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }])
})

test('reads Anthropic text deltas from the event stream', () => {
  const first = readSseDeltas('', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n')
  assert.deepEqual(first.deltas, ['Hello'])
})

test('rejects more than 20 messages or 60000 characters', () => {
  const tooMany = chatRequestSchema.safeParse({
    system: 's',
    messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'a' })),
  })
  assert.equal(tooMany.success, false)
  const tooLong = chatRequestSchema.safeParse({
    system: 's',
    messages: [{ role: 'user', content: 'a'.repeat(60_000) }],
  })
  assert.equal(tooLong.success, false)
  const ok = chatRequestSchema.safeParse({
    system: 's',
    messages: [{ role: 'user', content: 'a' }],
    json: true,
  })
  assert.equal(ok.success, true)
})
