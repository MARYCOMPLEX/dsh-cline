// Live gateway check for the routing assumptions behind dsh-cline.
// Reads CLINE_API_KEY from the local credential store without printing it.
// Usage: node tools/live-probe.mjs [model]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  harvestBody,
  injectPrefs,
  parseAvailableProviders,
  parseRouting,
  parseSSEProvider,
  pinBody,
  probeBody,
} from '../core.js'

const model = process.argv[2] || 'cline-pass/deepseek-v4.1-flash-1017'
const gateway = (process.env.CLINE_GATEWAY || 'https://api.cline.bot/api/v1').replace(/\/+$/, '')
const chatUrl = `${gateway}/chat/completions`

function readKey() {
  if (process.env.CLINE_API_KEY) return process.env.CLINE_API_KEY.trim()
  const file = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.credentials.yaml')
  try {
    const text = fs.readFileSync(file, 'utf8')
    const match = /^\s*CLINE_API_KEY:\s*(.+?)\s*$/m.exec(text)
    if (!match) return null
    return match[1].trim().replace(/^["']|["']$/g, '')
  } catch {
    return null
  }
}

const key = readKey()
if (!key) {
  console.error('No CLINE_API_KEY found in the environment or ~/.dsh/.credentials.yaml')
  process.exit(2)
}

async function post(body, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { status: response.status, json, text }
  } finally {
    clearTimeout(timer)
  }
}

function errorText(result) {
  const err = result.json?.error ?? result.json?.data?.error
  if (typeof err === 'string') return err
  if (err) return JSON.stringify(err)
  return result.text || ''
}

console.log(`gateway: ${gateway}`)
console.log(`model:   ${model}`)

// 1. Real completion: determines the pipeline and the provider that won.
const probe = await post({ ...probeBody(model), max_tokens: 64 }, 120000)
const routing = parseRouting(probe.json)
console.log(`\n[1] probe status=${probe.status} pipeline=${routing.pipeline || 'null'}`)
console.log(`    finalProvider=${routing.finalProvider || 'null'} canonical=${routing.canonicalSlug || 'null'}`)
if (probe.json?.error || probe.json?.data?.error) console.log(`    error=${errorText(probe).slice(0, 300)}`)
if (!routing.pipeline) {
  console.log('\nNo routing attribution in the response; the gateway behavior differs from the expected two pipelines.')
  process.exit(1)
}

// 2. Fake upstream: zero-token routing error lists the channel pool.
const harvest = await post(harvestBody(model, routing.pipeline), 60000)
const text = errorText(harvest)
const channels = parseAvailableProviders(harvest.json ?? text, routing.pipeline)
console.log(`\n[2] harvest status=${harvest.status} channels=${channels.length}`)
console.log(`    ${channels.join(', ') || '(none parsed)'}`)
if (!channels.length) console.log(`    raw error=${text.slice(0, 400)}`)

// 3. Pin the first channel and compare the reported provider.
const target = channels[0]
if (target) {
  const pinned = await post({ ...pinBody(model, routing.pipeline, target), max_tokens: 32 }, 120000)
  const pinnedRouting = parseRouting(pinned.json)
  console.log(`\n[3] pin target=${target} status=${pinned.status}`)
  console.log(`    actual=${pinnedRouting.finalProvider || 'null'} match=${pinnedRouting.finalProvider === target}`)
  if (pinned.json?.error || pinned.json?.data?.error) console.log(`    error=${errorText(pinned).slice(0, 300)}`)
}

// 4. Pin a second channel to prove pinning is not a single fixed route.
const second = channels[1]
if (second) {
  const pinned = await post({ ...pinBody(model, routing.pipeline, second), max_tokens: 32 }, 120000)
  const pinnedRouting = parseRouting(pinned.json)
  console.log(`\n[4] pin target=${second} status=${pinned.status}`)
  console.log(`    actual=${pinnedRouting.finalProvider || 'null'} match=${pinnedRouting.finalProvider === second}`)
  if (pinned.json?.error || pinned.json?.data?.error) console.log(`    error=${errorText(pinned).slice(0, 300)}`)
}

// 5. Preferred order plus an exclusion whitelist.
if (second && target) {
  const preferred = injectPrefs(
    { ...probeBody(model), max_tokens: 32 },
    routing.pipeline,
    { upstream: second, strict: false, orderRest: [target], excludeList: [channels[2]].filter(Boolean) },
    channels,
  )
  const result = await post(preferred, 120000)
  const resultRouting = parseRouting(result.json)
  console.log(`\n[5] preferred order=${second}>${target} exclude=${channels[2] || '-'} status=${result.status}`)
  console.log(`    actual=${resultRouting.finalProvider || 'null'} (${resultRouting.finalProvider === second ? 'first choice' : 'fallback/other'})`)
  if (result.json?.error || result.json?.data?.error) console.log(`    error=${errorText(result).slice(0, 300)}`)
}

// 6. Streaming: the harness always streams, so attribution must survive SSE.
{
  const streamed = await post({ ...probeBody(model), max_tokens: 32, stream: true }, 180000)
  const parsed = parseSSEProvider(streamed.text)
  console.log(`\n[6] stream status=${streamed.status} pipeline=${parsed.pipeline || 'null'} actual=${parsed.provider || 'null'}`)
  console.log(`    canonical=${parsed.canonical || 'null'} bytes=${streamed.text.length}`)
}

// 7. Direct pipeline sample, when the subscription still serves it.
{
  const directModel = 'cline-pass/glm-5.3-flash'
  const directProbe = await post({ ...probeBody(directModel), max_tokens: 64 }, 120000)
  const directRouting = parseRouting(directProbe.json)
  console.log(`\n[7] direct sample ${directModel} status=${directProbe.status} pipeline=${directRouting.pipeline || 'null'} actual=${directRouting.finalProvider || 'null'}`)
  if (directRouting.pipeline === 'direct') {
    const directHarvest = await post(harvestBody(directModel, 'direct'), 60000)
    const directChannels = parseAvailableProviders(directHarvest.json ?? errorText(directHarvest), 'direct')
    console.log(`    channels=${directChannels.length}: ${directChannels.slice(0, 8).join(', ')}`)
    const directTarget = directChannels.includes(directRouting.finalProvider) ? directRouting.finalProvider : directChannels[0]
    if (directTarget) {
      const directPinned = await post({ ...pinBody(directModel, 'direct', directTarget), max_tokens: 32 }, 120000)
      const directPinnedRouting = parseRouting(directPinned.json)
      console.log(`    pin target=${directTarget} status=${directPinned.status} actual=${directPinnedRouting.finalProvider || 'null'} match=${directPinnedRouting.finalProvider === directTarget}`)
      if (directPinned.json?.error || directPinned.json?.data?.error) console.log(`    error=${errorText(directPinned).slice(0, 240)}`)
    }
  } else {
    console.log(`    error=${errorText(directProbe).slice(0, 200)}`)
  }
}
