// Find out why cline-pass/deepseek-v4.1-flash ignores routing prefs: is it a
// private, single-provider canonical model, or does session affinity pin it?
// Reads CLINE_API_KEY from the environment.
// Usage: CLINE_API_KEY=sk_... node tools/live-route-flash.mjs

const gateway = (process.env.CLINE_GATEWAY || 'https://api.cline.bot/api/v1').replace(/\/+$/, '')
const key = (process.env.CLINE_API_KEY || '').trim()
if (!key) {
  console.error('CLINE_API_KEY is required')
  process.exit(2)
}

async function get(path, extraHeaders = {}) {
  const response = await fetch(`${gateway}${path}`, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...extraHeaders },
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

async function chat(model, prefs, extraHeaders = {}) {
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    max_tokens: 256,
    stream: false,
    ...prefs,
  }
  const response = await fetch(`${gateway}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  const node = json?.data ?? json
  const meta = node?.choices?.[0]?.message?.provider_metadata?.gateway
    ?? node?.provider_metadata?.gateway
    ?? null
  const routing = meta?.routing ?? null
  const err = node?.error ?? json?.error
  return {
    model,
    status: response.status,
    sent: prefs,
    canonical: routing?.canonicalSlug ?? null,
    provider: routing?.finalProvider ?? null,
    affinity: routing?.affinity ?? null,
    session: routing?.clientSessionId ?? null,
    sessionSource: routing?.clientSessionIdSource ?? null,
    attempts: (routing?.modelAttempts ?? []).map((entry) => ({
      slug: entry.canonicalSlug,
      providers: (entry.providerAttempts ?? []).map((p) => `${p.provider}:${p.statusCode}`),
    })),
    topModel: node?.model ?? null,
    error: typeof err === 'string' ? err : err ? JSON.stringify(err).slice(0, 300) : null,
  }
}

function line(label, result) {
  console.log(`\n[${label}] status=${result.status}`)
  console.log(`  sent      = ${JSON.stringify(result.sent)}`)
  console.log(`  canonical = ${result.canonical}  provider = ${result.provider}`)
  console.log(`  affinity  = ${JSON.stringify(result.affinity)}  session=${result.session} (${result.sessionSource})`)
  if (result.attempts?.length) console.log(`  attempts  = ${JSON.stringify(result.attempts)}`)
  if (result.error) console.log(`  error     = ${result.error}`)
}

// 1. Per-model catalog entries: how many providers each public model has.
for (const slug of ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-1017', 'private/deepseek-v4p1-flash-contributor']) {
  const result = await get(`/models/${slug}`)
  const body = result.json?.data ?? result.json
  const endpoints = body?.endpoints ?? body?.providers ?? null
  console.log(`\n[model ${slug}] status=${result.status}`)
  if (endpoints) console.log(`  endpoints = ${JSON.stringify(endpoints).slice(0, 700)}`)
  else console.log(`  body = ${result.text.slice(0, 300)}`)
}

// 2. Same model, same prefs, but a caller-chosen affinity id.
line('plain + only deepseek (no session header)', await chat('cline-pass/deepseek-v4.1-flash', { providerOptions: { gateway: { only: ['deepseek'] } } }))
line('plain + only deepseek (fresh x-session-affinity)', await chat('cline-pass/deepseek-v4.1-flash', { providerOptions: { gateway: { only: ['deepseek'] } } }, { 'x-session-affinity': `probe-${Date.now()}` }))
line('plain + only deepseek (x-client-request-id)', await chat('cline-pass/deepseek-v4.1-flash', { providerOptions: { gateway: { only: ['deepseek'] } } }, { 'x-client-request-id': `probe-${Date.now()}` }))

// 3. Alternate ids that might resolve to the public DeepSeek pool.
for (const id of ['cline-pass/deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', 'cline-pass/deepseek-v4.1-flash:batch']) {
  line(`id ${id}`, await chat(id, { providerOptions: { gateway: { only: ['deepseek'] } } }))
}
