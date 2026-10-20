// Server-render the client panel with fixture state to prove the component tree
// builds without a browser. Run from dsh-cline/tools/ssr after `pnpm add react`.
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
let slotName = null
const storage = new Map()

const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ id, factory }) {
        registered = { id, factory }
      },
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    navigator: { language: 'zh-CN' },
  },
  navigator: { language: 'zh-CN' },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
  },
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

let captured = null
const ctx = {
  slots: {
    inject(name, callback) {
      slotName = name
      callback()
    },
    register(options, Component) {
      captured = { options, Component }
      return captured
    },
  },
}
plugin.apply(ctx)
const registration = captured
if (!registration) throw new Error('no slot registration captured')

const fixture = {
  ok: true,
  gateway: 'https://api.cline.bot/api/v1',
  apiKeyEnv: 'CLINE_API_KEY',
  enabled: true,
  apiKeyConfigured: true,
  llmProvider: 'cline',
  modelIds: ['cline-pass/deepseek-v4.1-flash-1017'],
  models: [{
    id: 'cline-pass/deepseek-v4.1-flash-1017',
    pipeline: 'planner',
    canonicalSlug: 'deepseek/deepseek-v4.1-flash-1017',
    tier0: ['alibaba'],
    upstreams: [
      { slug: 'alibaba', status: 'ok', ms: 812, context: 131072, uptime: 99 },
      { slug: 'baseten', status: 'limited', ms: 901, note: '429 at capacity' },
      { slug: 'fireworks', status: 'bad', note: 'invalid_request_error' },
      { slug: 'deepinfra', status: 'unknown' },
    ],
    cfg: { upstreams: ['alibaba', 'baseten'], exclude: ['fireworks'], pinMode: 'preferred', sort: 'cost' },
    last: { provider: 'alibaba', canonical: 'deepseek/deepseek-v4.1-flash-1017', at: Date.now(), ms: 812, status: 200, attempts: ['alibaba'], target: 'alibaba', error: null },
    history: [],
    requests: 12,
    errors: 1,
    probedAt: Date.now(),
    validatedAt: Date.now(),
  }],
  summary: { models: 1, channels: 4, pinned: 1, requests: 12, errors: 1 },
}

// The registration component receives slot props; feed the fixture as an
// initial state so the table path renders without effects.
const html = renderToString(React.createElement(registration.Component, {
  initialData: fixture,
  initialModel: fixture.models[0].id,
}))

const checks = {
  slot: slotName,
  zhTitle: html.includes('Cline 上游'),
  gateway: html.includes('api.cline.bot'),
  pipelineBadge: html.includes('planner · Vercel'),
  channel: html.includes('alibaba'),
  pinnedChip: html.includes('dc-chip-name'),
  pinButton: html.includes('>钉住<'),
  modeSegments: html.includes('严格钉住') && html.includes('优先 + 回退'),
  statusLimited: html.includes('限流'),
  lastActual: html.includes('最近实际'),
  tokenOnly: html.includes('--dsw-alias-label-primary') && !html.includes('#171a21'),
  summary: html.includes('dc-stat'),
}
console.log(JSON.stringify(checks, null, 2))

storage.set('dsh-cline.lang', 'en')
const english = renderToString(React.createElement(registration.Component, {
  initialData: { ...fixture, enabled: false, apiKeyConfigured: false },
}))
storage.delete('dsh-cline.lang')
console.log(JSON.stringify({
  enTitle: english.includes('Cline Upstreams'),
  disabledBanner: english.includes('Plugin disabled'),
  keyBanner: english.includes('No upstream credential detected'),
}, null, 2))

if (!checks.zhTitle || !checks.pipelineBadge || !checks.channel) {
  console.error('render check failed')
  process.exit(1)
}