// Deep-dive on cline-pass/deepseek-v4.1-flash (no -1017 suffix): which routing
// shapes the gateway honours for this model, and what its metadata reports.
// Reads CLINE_API_KEY from the environment. Nothing is persisted.
// Usage: CLINE_API_KEY=sk_... node tools/live-probe-flash.mjs [model]

const model = process.argv[2] || 'cline-pass/deepseek-v4.1-flash'
const gateway = (process.env.CLINE_GATEWAY || 'https://api.cline.bot/api/v1').replace(/\/+$/, '')
const chatUrl = `${gateway}/chat/completions`
const key = (process.env.CLINE_API_KEY || '').trim()
if (!key) {
  console.error('CLINE_API_KEY is required')
  process.exit(2)
}

const body = (extra = {}) => ({
  model,
  messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  max_tokens: 256,
  stream: false,
  ...extra,
})

async function post(label, payload, timeoutMs = 120000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    const node = json?.data ?? json
    const choice = node?.choices?.[0]
    const meta = choice?.message?.provider_metadata ?? node?.provider_metadata ?? null
    const err = node?.error ?? json?.error
    return {
      label,
      status: response.status,
      ms: Date.now() - started,
      sent: payload.providerOptions ?? payload.provider ?? null,
      providerMeta: meta,
      topProvider: node?.provider ?? null,
      topModel: node?.model ?? null,
      error: typeof err === 'string' ? err : err ? JSON.stringify(err) : null,
      text: text.slice(0, 200),
    }
  } catch (error) {
    return { label, status: 0, ms: Date.now() - started, error: String(error?.message || error) }
  } finally {
    clearTimeout(timer)
  }
}

function report(result) {
  console.log(`\n[${result.label}] status=${result.status} ${result.ms} ms`)
  console.log(`  sent      = ${JSON.stringify(result.sent)}`)
  if (result.topProvider) console.log(`  topProvider = ${JSON.stringify(result.topProvider)}`)
  if (result.topModel) console.log(`  topModel    = ${result.topModel}`)
  if (result.providerMeta) console.log(`  meta      = ${JSON.stringify(result.providerMeta).slice(0, 900)}`)
  if (result.error) console.log(`  error     = ${result.error.slice(0, 600)}`)
}

console.log(`gateway: ${gateway}`)
console.log(`model:   ${model}`)

// What models does the gateway advertise?
try {
  const response = await fetch(`${gateway}/models`, { headers: { authorization: `Bearer ${key}` } })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  const list = json?.data ?? json?.models ?? []
  const ids = Array.isArray(list) ? list.map((item) => item.id ?? item.name).filter(Boolean) : []
  const flash = ids.filter((id) => String(id).includes('flash'))
  console.log(`\n[models] status=${response.status} total=${ids.length}`)
  console.log(`  flash: ${flash.join(', ') || '(none)'}`)
} catch (error) {
  console.log(`\n[models] failed: ${error?.message || error}`)
}

const cases = [
  ['A no-prefs', body()],
  ['B gateway.only=[deepseek]', body({ providerOptions: { gateway: { only: ['deepseek'] } } })],
  ['C gateway.only=[__probe__]', body({ providerOptions: { gateway: { only: ['__probe__'] } } })],
  ['D provider.only=[deepseek]', body({ provider: { only: ['deepseek'] } })],
  ['E gateway.order=[deepseek]', body({ providerOptions: { gateway: { order: ['deepseek'] } } })],
  ['F gateway.has=[vision]', body({ providerOptions: { gateway: { has: ['vision'] } } })],
  ['G gateway.sort=cost', body({ providerOptions: { gateway: { sort: 'cost' } } })],
  ['H both fields', body({ providerOptions: { gateway: { only: ['deepseek'] } }, provider: { only: ['deepseek'] } })],
]

for (const [label, payload] of cases) {
  report(await post(label, payload))
}
