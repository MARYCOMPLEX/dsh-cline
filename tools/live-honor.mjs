// Distinguish "routing honoured" from "routing ignored" per model id, using a
// deliberately impossible provider as the tell.
// Usage: CLINE_API_KEY=sk_... node tools/live-honor.mjs

const gateway = (process.env.CLINE_GATEWAY || 'https://api.cline.bot/api/v1').replace(/\/+$/, '')
const key = (process.env.CLINE_API_KEY || '').trim()
if (!key) {
  console.error('CLINE_API_KEY is required')
  process.exit(2)
}

async function chat(model, gatewayPrefs) {
  const payload = {
    model,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    max_tokens: 256,
    stream: false,
    providerOptions: { gateway: gatewayPrefs },
  }
  const response = await fetch(`${gateway}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  const node = json?.data ?? json
  const routing = node?.choices?.[0]?.message?.provider_metadata?.gateway?.routing
    ?? node?.provider_metadata?.gateway?.routing
    ?? null
  const err = node?.error ?? json?.error
  return {
    status: response.status,
    canonical: routing?.canonicalSlug ?? null,
    provider: routing?.finalProvider ?? null,
    affinity: routing?.affinity ?? null,
    error: typeof err === 'string' ? err : err ? JSON.stringify(err) : null,
  }
}

function report(model, prefs, result) {
  const honored = result.status >= 400
  console.log(`\n${model}  ${JSON.stringify(prefs)}`)
  console.log(`  status=${result.status} honored=${honored ? 'YES (rejected the fake pin)' : 'no (fake pin accepted)'}`)
  console.log(`  canonical=${result.canonical} provider=${result.provider} affinity=${JSON.stringify(result.affinity)}`)
  if (result.error) console.log(`  error=${result.error.slice(0, 220)}`)
}

const models = [
  'cline-pass/deepseek-v4.1-flash',
  'cline-pass/deepseek-v4.1-flash-1017',
  'deepseek/deepseek-v4.1-flash',
  'deepseek/deepseek-v4.1-flash-1017',
]

for (const model of models) {
  report(model, { only: ['__probe__'] }, await chat(model, { only: ['__probe__'] }))
  report(model, { only: ['deepseek'] }, await chat(model, { only: ['deepseek'] }))
}
