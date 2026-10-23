// Live comparison of the two pin shapes against the real Cline gateway:
//   only-pin      providerOptions.gateway.only = ["deepseek"]
//   has-pin       providerOptions.gateway = { only: ["deepseek"], has: ["vision", "implicit-caching"] }
// Reads CLINE_API_KEY from the environment. Nothing here is persisted.
// Usage: CLINE_API_KEY=sk_... node tools/live-has.mjs [model]

import { parseRouting } from '../core.js'

const model = process.argv[2] || 'cline-pass/deepseek-v4.1-flash'
const gateway = (process.env.CLINE_GATEWAY || 'https://api.cline.bot/api/v1').replace(/\/+$/, '')
const chatUrl = `${gateway}/chat/completions`
const key = (process.env.CLINE_API_KEY || '').trim()
if (!key) {
  console.error('CLINE_API_KEY is required')
  process.exit(2)
}

const baseBody = (extra = {}) => ({
  model,
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: Number(process.env.MAX_TOKENS || 512),
  stream: false,
  ...extra,
})

async function post(label, body, timeoutMs = 90000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
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
    const routing = parseRouting(json)
    const err = json?.error ?? json?.data?.error
    const errorText = typeof err === 'string' ? err : err ? JSON.stringify(err) : ''
    return {
      label,
      status: response.status,
      ms: Date.now() - started,
      provider: routing.finalProvider || null,
      canonical: routing.canonicalSlug || null,
      pipeline: routing.pipeline || null,
      usage: json?.usage || null,
      content: json?.choices?.[0]?.message?.content ?? null,
      gatewayMeta: json?.choices?.[0]?.message?.provider_metadata
        ?? json?.provider_metadata
        ?? json?.choices?.[0]?.provider_metadata
        ?? null,
      error: errorText.slice(0, 400) || null,
      sent: body.providerOptions ?? null,
      raw: errorText ? null : text.slice(0, 200),
    }
  } catch (error) {
    return { label, status: 0, ms: Date.now() - started, error: String(error?.message || error), sent: body.providerOptions ?? null }
  } finally {
    clearTimeout(timer)
  }
}

function report(result) {
  console.log(`\n[${result.label}] status=${result.status} ${result.ms} ms`)
  console.log(`  sent    = ${JSON.stringify(result.sent)}`)
  console.log(`  actual  = ${result.provider || 'null'}${result.canonical ? ` (${result.canonical})` : ''} pipeline=${result.pipeline || 'null'}`)
  if (result.usage) console.log(`  usage   = ${JSON.stringify(result.usage)}`)
  if (result.content) console.log(`  content = ${JSON.stringify(result.content).slice(0, 120)}`)
  if (result.gatewayMeta) console.log(`  meta    = ${JSON.stringify(result.gatewayMeta).slice(0, 600)}`)
  if (result.error) console.log(`  error   = ${result.error}`)
  if (result.raw) console.log(`  raw     = ${result.raw}`)
}

function withGateway(gatewayPrefs) {
  return baseBody({ providerOptions: { gateway: gatewayPrefs } })
}

// 0. Which channels exist for this model (zero-token routing error).
const harvest = await post('channels', baseBody({ providerOptions: { gateway: { only: ['__probe__'] } } }))
console.log(`gateway: ${gateway}`)
console.log(`model:   ${model}`)
console.log(`harvest status=${harvest.status}`)
console.log(`  error: ${(harvest.error || '').slice(0, 500)}`)

const results = []
results.push(await post('A only-pin', withGateway({ only: ['deepseek'] })))
results.push(await post('B has-pin', withGateway({ only: ['deepseek'], has: ['vision', 'implicit-caching'] })))
results.push(await post('C has-vision', withGateway({ only: ['deepseek'], has: ['vision'] })))
results.push(await post('D has-bogus', withGateway({ only: ['deepseek'], has: ['this-capability-does-not-exist'] })))
results.push(await post('E has-alone', withGateway({ has: ['vision'] })))
results.push(await post('F has-free-conflict', withGateway({ only: ['deepseek'], has: ['free'] })))
results.push(await post('G has-free', withGateway({ has: ['free'] })))
results.push(await post('H has-quant', withGateway({ only: ['deepseek'], has: ['!quantization:fp8'] })))
results.push(await post('I no-prefs', baseBody()))
results.push(await post('J order+has', withGateway({ order: ['baseten', 'deepseek'], has: ['vision'] })))
results.push(await post('K only-list+has', withGateway({ only: ['baseten', 'deepseek'], has: ['vision'] })))
results.push(await post('L baseten+has', withGateway({ only: ['baseten'], has: ['vision'] })))

for (const result of results) report(result)

console.log('\n=== summary ===')
for (const result of results) {
  console.log(`${result.label.padEnd(18)} status=${result.status} provider=${result.provider || 'null'} error=${(result.error || '').slice(0, 90)}`)
}
