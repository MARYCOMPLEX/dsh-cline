import test from 'node:test'
import assert from 'node:assert/strict'
import { installFetch, normalizeConfig } from '../index.js'

const GATEWAY = 'https://api.cline.bot/api/v1'
const config = normalizeConfig({ gatewayBase: GATEWAY, apiKeyEnv: 'TEST_KEY' })

function model(overrides = {}) {
  return {
    pipeline: 'planner',
    canonicalSlug: null,
    upstreams: ['alibaba', 'baseten'],
    upstreamDetail: {},
    status: {},
    cfg: { upstreams: [], exclude: [], pinMode: 'strict', sort: null },
    last: null,
    history: [],
    requests: 0,
    errors: 0,
    ...overrides,
  }
}

function fakeState(meta, enabled = true) {
  const records = []
  return {
    records,
    enabled: () => enabled,
    model: () => meta,
    record: (_id, patch) => Object.assign(meta, patch),
    save: () => {},
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function plannerResponse(provider = 'alibaba') {
  return jsonResponse({
    choices: [{
      message: {
        content: 'OK',
        provider_metadata: { gateway: { routing: { finalProvider: provider, canonicalSlug: 'deepseek/deepseek-v4.1-flash' } } },
      },
    }],
  })
}

function directResponse(provider = 'Wafer') {
  return jsonResponse({
    provider,
    model: 'z-ai/glm-5.3-flash',
    choices: [{ message: { content: 'OK' } }],
  })
}

async function withInterceptor(meta, run, options = {}) {
  const previous = globalThis.fetch
  const calls = []
  const queue = [...(options.responses || [plannerResponse()])]
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) })
    return queue.length ? queue.shift() : plannerResponse()
  }
  const state = fakeState(meta, options.enabled !== false)
  const dispose = installFetch({ logger: { info() {}, warn() {} } }, state, config)
  try {
    const response = await run(calls, state)
    return { response, calls, state }
  } finally {
    dispose()
    globalThis.fetch = previous
  }
}

function chatInit(body, extraHeaders = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  }
}

const baseBody = { model: 'cline-pass/deepseek-v4.1-flash-1017', messages: [{ role: 'user', content: 'hi' }] }

test('planner strict injects providerOptions.gateway.only', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)))
  assert.deepEqual(calls[0].body.providerOptions, { gateway: { only: ['alibaba'] } })
  assert.equal(calls[0].body.provider, undefined)
})

test('the same rules apply to the Responses endpoint', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/responses`, chatInit(baseBody)))
  assert.deepEqual(calls[0].body.providerOptions.gateway.only, ['alibaba'])
})

test('unknown protocols are observed but never rewritten', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/messages`, chatInit(baseBody)))
  assert.deepEqual(calls[0].body, baseBody)
})

test('injectPaths can be narrowed or widened by configuration', async () => {
  const custom = normalizeConfig({ gatewayBase: GATEWAY, apiKeyEnv: 'TEST_KEY', injectPaths: ['/messages'] })
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return plannerResponse()
  }
  const state = fakeState(meta)
  const dispose = installFetch({ logger: { info() {}, warn() {} } }, state, custom)
  try {
    await globalThis.fetch(`${GATEWAY}/messages`, chatInit(baseBody))
    await globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody))
  } finally {
    dispose()
    globalThis.fetch = previous
  }
  assert.deepEqual(calls[0].body.providerOptions.gateway.only, ['alibaba'])
  assert.deepEqual(calls[1].body, baseBody)
})

test('planner preferred injects an order and an exclusion whitelist', async () => {
  const meta = model({
    upstreams: ['alibaba', 'baseten', 'deepinfra'],
    cfg: { upstreams: ['baseten', 'alibaba'], exclude: ['deepinfra'], pinMode: 'preferred', sort: 'cost' },
  })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)))
  assert.deepEqual(calls[0].body.providerOptions.gateway.order, ['baseten', 'alibaba'])
  assert.deepEqual(calls[0].body.providerOptions.gateway.only, ['alibaba', 'baseten'])
  assert.equal(calls[0].body.providerOptions.gateway.sort, 'cost')
})

test('direct strict injects the top-level provider shorthand', async () => {
  const meta = model({
    pipeline: 'direct',
    upstreams: ['wafer', 'baseten'],
    cfg: { upstreams: ['wafer'], exclude: [], pinMode: 'strict', sort: 'ttft' },
  })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), {
    responses: [directResponse()],
  })
  assert.deepEqual(calls[0].body.provider, { only: ['wafer'], sort: 'latency' })
  assert.equal(calls[0].body.providerOptions, undefined)
})

test('failed pins fall through to the next upstream', async () => {
  const meta = model({
    upstreams: ['baseten', 'alibaba'],
    cfg: { upstreams: ['baseten', 'alibaba'], exclude: [], pinMode: 'strict', sort: null },
  })
  const { response, calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), {
    responses: [
      jsonResponse({ error: { message: '429 rate limited' } }, 500),
      plannerResponse('alibaba'),
    ],
  })
  assert.equal(response.status, 200)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].body.providerOptions.gateway.only, ['baseten'])
  assert.deepEqual(calls[1].body.providerOptions.gateway.only, ['alibaba'])
})

test('non-gateway requests pass through untouched', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch('https://example.com/v1/chat/completions', chatInit(baseBody)))
  assert.deepEqual(calls[0].body, baseBody)
})

test('disabled plugin passes through untouched', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), { enabled: false })
  assert.deepEqual(calls[0].body, baseBody)
})

test('internal probe traffic skips the interceptor', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(
    `${GATEWAY}/chat/completions`,
    chatInit(baseBody, { 'x-dsh-cline-internal': '1' }),
  ))
  assert.deepEqual(calls[0].body, baseBody)
})

test('auto mode with exclusions injects only the allowed channels', async () => {
  const meta = model({
    upstreams: ['alibaba', 'baseten', 'deepinfra'],
    cfg: { upstreams: [], exclude: ['deepinfra'], pinMode: 'strict', sort: null },
  })
  const { calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)))
  assert.deepEqual(calls[0].body.providerOptions.gateway.only, ['alibaba', 'baseten'])
})

function sseResponse(events) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function sseError(message) {
  return new Response(`data: {"error":{"message":${JSON.stringify(message)}}}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('a 200 event-stream carrying an error switches to the next channel', async () => {
  const meta = model({
    upstreams: ['baseten', 'alibaba'],
    cfg: { upstreams: ['baseten', 'alibaba'], exclude: [], pinMode: 'strict', sort: null },
  })
  const { response, calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), {
    responses: [
      sseError('429 at capacity'),
      sseResponse([
        { choices: [{ delta: { content: 'OK' } }] },
        { provider_metadata: { gateway: { routing: { finalProvider: 'alibaba' } } } },
      ]),
    ],
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  assert.equal(calls.length, 2)
  const text = await response.text()
  assert.match(text, /finalProvider/)
})

test('streamed bodies pass through byte-for-byte', async () => {
  const meta = model({ cfg: { upstreams: [], exclude: [], pinMode: 'strict', sort: null } })
  const events = [
    { choices: [{ delta: { content: 'he' } }] },
    { choices: [{ delta: { content: 'llo' } }] },
    { provider_metadata: { gateway: { routing: { finalProvider: 'alibaba' } } } },
  ]
  const { response } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), {
    responses: [sseResponse(events)],
  })
  const text = await response.text()
  for (const event of events) assert.ok(text.includes(JSON.stringify(event)))
})

test('an empty event-stream on the last attempt surfaces a normalized error', async () => {
  const meta = model({ cfg: { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null } })
  const { response } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), {
    responses: [new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })],
  })
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.match(body.error.message, /empty stream/i)
})
test('an unsatisfiable has filter fails fast instead of trying every pin', async () => {
  const meta = model({
    upstreams: ['baseten', 'alibaba'],
    cfg: { upstreams: ['baseten', 'alibaba'], exclude: [], has: ['free'], pinMode: 'strict', sort: null },
  })
  const { response, calls } = await withInterceptor(meta, () => globalThis.fetch(`${GATEWAY}/chat/completions`, chatInit(baseBody)), {
    responses: [
      jsonResponse({ error: { message: 'None of the providers considered satisfy the required has conditions: free. Providers considered: baseten.' } }, 400),
      plannerResponse('alibaba'),
    ],
  })
  assert.equal(response.status, 400)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body.providerOptions.gateway, { only: ['baseten'], has: ['free'] })
})
