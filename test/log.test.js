import test from 'node:test'
import assert from 'node:assert/strict'
import { __test, installFetch, normalizeConfig } from '../index.js'

const config = normalizeConfig({ gatewayBase: 'https://api.cline.bot/api/v1', apiKeyEnv: 'TEST_KEY' })

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function withFetch(fake, run) {
  const previous = globalThis.fetch
  globalThis.fetch = fake
  const state = { enabled: () => true, model: () => ({}), record() {}, save() {} }
  const dispose = installFetch({ logger: { info() {}, warn() {} } }, state, config)
  try {
    return await run()
  } finally {
    dispose()
    globalThis.fetch = previous
  }
}

test('isLlmRequest recognises provider endpoints and rejects other APIs', () => {
  const request = (url, body) => ({
    method: 'POST',
    url,
    body: JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  })
  assert.equal(__test.isLlmRequest(request('https://api.deepseek.com/chat/completions', { model: 'deepseek-chat' })), true)
  assert.equal(__test.isLlmRequest(request('https://api.anthropic.com/v1/messages', { model: 'claude' })), true)
  assert.equal(__test.isLlmRequest(request('https://api.deepseek.com/embeddings', { model: 'embed' })), false)
  assert.equal(__test.isLlmRequest(request('https://example.com/track', { model: 'x' })), false)
})

test('non-Cline model calls are recorded without being rewritten', async () => {
  __test.logBook.clear()
  let sent = null
  const fake = async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) }
    return jsonResponse({
      id: 'req_123',
      model: 'deepseek-chat',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      choices: [{ message: { content: 'ok' } }],
    })
  }
  await withFetch(fake, async () => {
    await globalThis.fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] }),
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
  assert.deepEqual(sent.body, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] })
  const entries = __test.logBook.list({ limit: 5 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].provider, 'deepseek')
  assert.equal(entries[0].model, 'deepseek-chat')
  assert.equal(entries[0].status, 200)
  assert.equal(entries[0].usage.total, 15)
  assert.equal(entries[0].requestId, 'req_123')
})

test('failed non-Cline calls are recorded with the error', async () => {
  __test.logBook.clear()
  const fake = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  await withFetch(fake, async () => {
    await assert.rejects(globalThis.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [] }),
    }))
  })
  const entries = __test.logBook.list({ limit: 5 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].provider, 'openai')
  assert.equal(entries[0].status, 0)
  assert.match(entries[0].error, /ECONNREFUSED/)
})

test('logBook filters by provider and errors', () => {
  __test.logBook.clear()
  __test.logBook.push({ provider: 'cline', model: 'a', status: 200 })
  __test.logBook.push({ provider: 'deepseek', model: 'b', status: 500, error: 'boom' })
  assert.equal(__test.logBook.list({ onlyCline: '1' }).length, 1)
  assert.equal(__test.logBook.list({ onlyErrors: '1' }).length, 1)
  assert.equal(__test.logBook.list({ provider: 'deepseek' }).length, 1)
})