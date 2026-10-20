// Render the composer-dock pill with seeded per-session readings. This proves
// the label/icon/tone branches build and that a reload can restore a reading
// from localStorage without waiting for a new request.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToString } from 'react-dom/server'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.resolve(here, '../../client.js')
const source = fs.readFileSync(clientPath, 'utf8')

let registered = null
const storage = new Map()

function localStorageFace() {
  return {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }
}

const sandbox = {
  window: {
    __ModuleLoader__: { load({ id, factory }) { registered = { id, factory } } },
    localStorage: localStorageFace(),
    navigator: { language: 'zh-CN' },
  },
  navigator: { language: 'zh-CN' },
  localStorage: localStorageFace(),
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  URL,
}
sandbox.globalThis = sandbox
vm.runInNewContext(source, sandbox, { filename: clientPath })
if (!registered) throw new Error('client.js did not register a module factory')

const plugin = registered.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
})
const Pill = plugin.__test && plugin.__test.UpstreamPill
if (typeof Pill !== 'function') throw new Error('client did not expose UpstreamPill')

storage.set('dsh-cline.lang', 'zh')
const base = { at: Date.now() - 1000, status: 200, ms: 812, model: 'cline-pass/deepseek-v4.1-flash-1017' }
storage.set('dsh-cline.upstream.s-test', JSON.stringify({
  ...base, id: 'e1', provider: 'cline', upstream: 'deepseek', target: 'deepseek',
}))
storage.set('dsh-cline.upstream.s-warn', JSON.stringify({
  ...base, id: 'e2', provider: 'cline', upstream: 'baseten', target: 'deepseek',
}))
storage.set('dsh-cline.upstream.s-relay', JSON.stringify({
  ...base, id: 'e3', provider: 'cpa.gojia.cloud', upstream: null,
}))
storage.set('dsh-cline.upstream.s-bad', JSON.stringify({
  ...base, id: 'e4', provider: 'cline', upstream: null, target: 'deepseek', status: 0, error: 'ECONNRESET',
}))

const pinned = renderToString(React.createElement(Pill, { sessionId: 's-test' }))
const warn = renderToString(React.createElement(Pill, { sessionId: 's-warn' }))
const relay = renderToString(React.createElement(Pill, { sessionId: 's-relay' }))
const bad = renderToString(React.createElement(Pill, { sessionId: 's-bad' }))
const empty = renderToString(React.createElement(Pill, { sessionId: 's-none' }))

const checks = {
  restoredFromStorage: pinned.includes('上游 deepseek'),
  hasPillClass: pinned.includes('dc-upstream-pill'),
  hasOutlineIcon: pinned.includes('<svg'),
  warnTone: warn.includes('data-tone="warn"'),
  relayLabel: relay.includes('经 cpa.gojia.cloud'),
  relayNoFakeUpstream: !relay.includes('上游 cpa'),
  errorTone: bad.includes('data-tone="bad"'),
  unknownUpstream: bad.includes('上游 未解析'),
  emptySessionHides: empty === '',
}
console.log(JSON.stringify(checks, null, 2))
if (Object.values(checks).some((value) => value !== true)) {
  console.error('pill check failed')
  process.exit(1)
}
