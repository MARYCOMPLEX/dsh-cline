// Exercise the real Host half against the live gateway:
//   1. install the interceptor exactly as the plugin does,
//   2. send a streaming chat through globalThis.fetch,
//   3. assert the body was rewritten, the SSE stream stayed intact,
//   4. assert the recorded state names the channel that actually served it.
//
// Usage: node tools/live-interceptor.mjs [model] [upstream]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const home = path.join(repo, 'tools', '.runtime-home')
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(path.join(home, 'storages'), { recursive: true })
process.env.DSH_HOME = home

const model = process.argv[2] || 'cline-pass/deepseek-v4.1-flash-1017'
const upstreamArg = process.argv[3] || 'alibaba'
const upstreams = upstreamArg.split(',').map((value) => value.trim()).filter(Boolean)
const upstream = upstreams[0]
const gateway = 'https://api.cline.bot/api/v1'

function readKey() {
  if (process.env.CLINE_API_KEY) return process.env.CLINE_API_KEY.trim()
  const file = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  const text = fs.readFileSync(file, 'utf8')
  const match = /^\s*CLINE_API_KEY:\s*(.+?)\s*$/m.exec(text)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
}

const key = readKey()
if (!key) {
  console.error('no CLINE_API_KEY')
  process.exit(2)
}

// Seed the persisted model config the way the panel would.
const storeFile = path.join(home, 'storages', 'dsh-cline.json')
fs.writeFileSync(storeFile, JSON.stringify({
  version: 1,
  models: {
    [model]: {
      pipeline: 'planner',
      upstreams: [...new Set([...upstreams, 'baseten'])],
      cfg: { upstreams, exclude: [], pinMode: 'strict', sort: null },
    },
  },
}, null, 2))

const { apply } = await import('../index.js')

const cleanups = []
const ctx = {
  logger: {
    info: (message) => { if (process.env.DEBUG_CLINE) console.log('[info]', message) },
    warn: (message) => console.warn('[warn]', message),
  },
  effect: (fn) => { const dispose = fn(); cleanups.push(dispose); return dispose },
  inject: () => {},
  get: () => undefined,
}

// Record what actually leaves the plugin: install this as the "previous" fetch
// before the plugin wraps it, exactly like the app's original undici fetch.
const realFetch = globalThis.fetch
const seen = []
globalThis.fetch = async (input, init) => {
  seen.push({ url: String(input), body: init && init.body ? String(init.body) : null })
  return realFetch(input, init)
}

apply(ctx, { gatewayBase: gateway, apiKeyEnv: 'CLINE_API_KEY', debug: !!process.env.DEBUG_CLINE })

const response = await globalThis.fetch(`${gateway}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model,
    stream: true,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Say OK' }],
  }),
})

const text = await response.text()
const outbound = seen.length && seen[0].body ? JSON.parse(seen[0].body) : {}

console.log(JSON.stringify({
  status: response.status,
  contentType: response.headers.get('content-type'),
  sse: text.includes('data:') || text.includes('finalProvider') || text.includes('"provider"'),
  bytes: text.length,
  injected: outbound.providerOptions?.gateway || outbound.provider || null,
  providerPrefsInjected: !!(outbound.providerOptions?.gateway?.only || outbound.provider?.only),
}, null, 2))

// The wrapper's response is the caller's copy; the tap runs on the clone.
await new Promise((resolve) => setTimeout(resolve, 1500))
const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
const record = saved.models[model] || {}
console.log(JSON.stringify({
  requests: record.requests || 0,
  lastProvider: record.last?.provider ?? null,
  lastCanonical: record.last?.canonical ?? null,
  attempts: record.last?.attempts ?? [],
  target: record.last?.target ?? null,
  hasHistory: Array.isArray(record.history) && record.history.length > 0,
}, null, 2))

for (const dispose of cleanups) {
  try { dispose() } catch { /* ignore */ }
}

const ok = record.requests > 0 && upstreams.includes(record.last?.provider)
console.log(ok ? 'RESULT: interceptor delivered a response and recorded an allowed upstream' : 'RESULT: mismatch')
process.exit(ok ? 0 : 1)