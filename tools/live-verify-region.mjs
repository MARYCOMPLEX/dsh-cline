// End-to-end proof of the region fix: drive the plugin's real fetch wrapper
// (index.js) against the live Cline gateway and read back the final provider.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installFetch, normalizeConfig } from '../index.js'
import { parseRouting } from '../core.js'

const model = process.argv[2] || 'cline-pass/deepseek-v4.1-flash-1017'
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const credentials = fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8')
const key = /^\s*CLINE_API_KEY:\s*(.+?)\s*$/m.exec(credentials)[1].trim().replace(/^["']|["']$/g, '')
process.env.CLINE_API_KEY = key

const config = normalizeConfig({ gatewayBase: 'https://api.cline.bot/api/v1', apiKeyEnv: 'CLINE_API_KEY' })

async function run(name, cfg, stream = false) {
  const meta = {
    pipeline: 'planner',
    canonicalSlug: 'private/deepseek-v4p1-flash-1017-contributor',
    upstreams: ['alibaba', 'baseten', 'deepseek', 'fireworks', 'wafer'],
    upstreamDetail: {},
    status: {},
    cfg,
    last: null,
    history: [],
    requests: 0,
    errors: 0,
  }
  const state = {
    enabled: () => true,
    model: () => meta,
    record: (_id, patch) => Object.assign(meta, patch),
    save: () => {},
  }

  const realFetch = globalThis.fetch
  let sent = null
  globalThis.fetch = async (input, init) => {
    sent = JSON.parse(init.body)
    return realFetch(input, { ...init, headers: { ...init.headers, authorization: `Bearer ${key}` } })
  }
  const dispose = installFetch({ logger: { info() {}, warn() {} } }, state, config)
  try {
    const response = await globalThis.fetch(config.chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 32, stream }),
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    const routing = parseRouting(json)
    console.log(`\n### ${name}${stream ? ' (stream)' : ''}`)
    console.log('  status:', response.status, '| content-type:', response.headers.get('content-type'))
    console.log('  sent gateway:', JSON.stringify(sent.providerOptions?.gateway ?? null))
    console.log('  final provider:', routing.finalProvider || meta.last?.provider, '| canonical:', routing.canonicalSlug || meta.last?.canonical)
    console.log('  last record:', JSON.stringify(meta.last))
  } finally {
    dispose()
    globalThis.fetch = realFetch
  }
}

await run('pin deepseek · region zone us', {
  upstreams: ['deepseek'], exclude: [], has: ['vision', 'implicit-caching'], pinMode: 'strict', sort: null,
  region: { scope: 'zone', geoRegion: 'us' }, extras: {},
})

await run('pin deepseek · region off (old behaviour)', {
  upstreams: ['deepseek'], exclude: [], has: [], pinMode: 'strict', sort: null,
  region: { scope: 'off', geoRegion: 'us' }, extras: {},
})

await run('manual override sorts by throughput', {
  upstreams: ['deepseek'], exclude: [], has: [], pinMode: 'strict', sort: null,
  region: { scope: 'zone', geoRegion: 'us' },
  extras: { gateway: { sort: 'throughput' } },
})

await run('pin deepseek · streaming', {
  upstreams: ['deepseek'], exclude: [], has: [], pinMode: 'strict', sort: null,
  region: { scope: 'zone', geoRegion: 'us' }, extras: {},
}, true)
