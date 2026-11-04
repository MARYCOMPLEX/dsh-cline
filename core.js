// Pure routing / injection / parsing logic for the Cline Pass upstream console.
// Kept free of Cordis and node:http so it can be unit-tested and reused.
//
// Two upstream pipelines were measured on the Cline gateway:
// - planner: executed by Vercel AI Gateway. The response carries
//   choices[0].message.provider_metadata.gateway.routing; provider preferences
//   must travel in providerOptions.gateway.{only,order,sort}. Cline drops the
//   top-level provider shorthand for this pipeline.
// - direct: executed by OpenRouter. The response carries a top-level `provider`
//   display name and the real `model` id; provider preferences travel in the
//   top-level provider.{only,order,sort}.

export const OR_SORT = { cost: 'price', ttft: 'latency', tps: 'throughput' }

// Vercel AI Gateway inference-region routing. Measured on the Cline gateway in
// 2026-11: `providerOptions.gateway.only` is silently dropped while the request
// still resolves to the private contributor route. Adding an inferenceRegion
// moves the model onto the public provider pool, and only then does only/order
// take effect. `providers` is the opt-in map the gateway validates against, so
// every channel a request allows must be listed there — otherwise the request
// fails with "None of the providers considered ... support the requested
// inference region".
export const DEFAULT_GEO_REGION = 'us'
const GEO_REGION_RE = /^[a-z0-9][a-z0-9-]{1,15}$/

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i

/** Unique, trimmed, non-empty strings, preserving order. */
export function uniq(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

/** OpenRouter/Vercel provider display names become the slugs routing accepts. */
export function slugify(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-')
}

/** Keep only values that look like a provider slug. */
export function normalizeSlugs(list) {
  return uniq(list).filter((value) => SLUG_RE.test(value))
}

// Capability filters the Vercel gateway validates in providerOptions.gateway.has.
// The gateway rejects anything else with a 400 that names the allowed set, so the
// panel and the persisted config accept exactly this vocabulary.
export const HAS_ENUM = ['free', 'implicit-caching', 'reasoning', 'structured-output', 'tool-use', 'vision']
const HAS_QUANT_RE = /^!?quantization:[a-z0-9._-]{1,24}$/

/** Whether one value is a capability the gateway understands. */
export function isHasValue(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return false
  return HAS_ENUM.includes(text) || HAS_QUANT_RE.test(text)
}

/** Keep the capability filters the gateway will accept, in order, deduplicated. */
export function normalizeHas(list) {
  if (!Array.isArray(list)) return []
  const lowered = list.map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean)
  return [...new Set(lowered)].filter(isHasValue).slice(0, 8)
}

/**
 * Normalize the per-model inference-region setting.
 * `off` keeps the legacy body (only/order are sent, the gateway may ignore
 * them); `zone` injects `providerOptions.gateway.inferenceRegion` so the pin is
 * actually executed on the public pool.
 * @param {{scope?:string,geoRegion?:string}|string|undefined} input
 */
export function normalizeRegion(input) {
  const raw = typeof input === 'string' ? { scope: input } : input && typeof input === 'object' ? input : {}
  const scope = raw.scope === 'off' || raw.scope === 'none' ? 'off' : 'zone'
  const candidate = String(raw.geoRegion ?? DEFAULT_GEO_REGION).trim().toLowerCase()
  const geoRegion = GEO_REGION_RE.test(candidate) ? candidate : DEFAULT_GEO_REGION
  return { scope, geoRegion }
}

/** Whether requests for this model should carry an inferenceRegion. */
export function regionEnabled(region) {
  return normalizeRegion(region).scope === 'zone'
}

/**
 * Build the gateway's inferenceRegion object for one request.
 * @param {{scope?:string,geoRegion?:string}} region normalized or raw setting.
 * @param {string[]} providers channels the request is allowed to use.
 */
export function buildInferenceRegion(region, providers = []) {
  const { geoRegion } = normalizeRegion(region)
  const map = {}
  for (const value of Array.isArray(providers) ? providers : []) {
    const slug = String(value ?? '').trim()
    // The discovery sentinel is not a slug but the gateway still validates it,
    // so it is kept verbatim instead of being slug-filtered.
    if (slug) map[slug] = null
  }
  return { scope: 'zone', geoRegion, providers: map }
}

/**
 * Recursively merge a manual override over generated routing fields. Plain
 * objects merge key by key; arrays and scalars replace the generated value, so
 * a hand-written `only` list wins over the computed one.
 */
export function deepMerge(base, patch) {
  if (patch === undefined) return base
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(out[key], value)
  return out
}

// A hand-written block is a convenience escape hatch, not a payload carrier.
const EXTRAS_LIMIT = 8 * 1024

/**
 * Sanitize the per-model manual override. Only plain objects survive, and the
 * whole block is capped so a typo cannot bloat the persisted state.
 * @param {{gateway?:object,provider?:object}|undefined} input
 */
export function normalizeExtras(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const pick = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    try {
      const copy = JSON.parse(JSON.stringify(value))
      return copy && typeof copy === 'object' && !Array.isArray(copy) ? copy : null
    } catch {
      return null
    }
  }
  const extras = {}
  const gateway = pick(raw.gateway)
  const provider = pick(raw.provider)
  if (gateway) extras.gateway = gateway
  if (provider) extras.provider = provider
  try {
    return JSON.stringify(extras).length <= EXTRAS_LIMIT ? extras : {}
  } catch {
    return {}
  }
}

/**
 * Map a gateway-reported provider (often an OpenRouter display name) onto the
 * channel slug used by the routing API. "OpenInference" -> "open-inference".
 * @param {unknown} value display name or slug.
 * @param {string[]} known discovered channel slugs.
 */
export function resolveProviderSlug(value, known = []) {
  if (value == null || value === '') return null
  const slug = slugify(value)
  const list = normalizeSlugs(known)
  if (list.includes(slug)) return slug
  const normalize = (input) => String(input).toLowerCase().replace(/[^a-z0-9]/g, '')
  const target = normalize(slug)
  return list.find((item) => normalize(item) === target) || slug
}

function asRouting(json) {
  const data = json?.data && (json.data.choices || json.data.provider_metadata) ? json.data : json || {}
  const message = data?.choices?.[0]?.message
  const routing = message?.provider_metadata?.gateway?.routing
    || data?.provider_metadata?.gateway?.routing
    || {}
  return { data, message, routing }
}

/**
 * Read pipeline attribution and the real upstream from one gateway response.
 * @param {unknown} json parsed non-stream response body.
 */
export function parseRouting(json) {
  const { data, message, routing } = asRouting(json)
  const direct = typeof data?.provider === 'string' ? data.provider : null
  const canonicalFromModel = typeof data?.model === 'string' && data.model.includes('/') ? data.model : null
  const pipeline = routing.finalProvider ? 'planner' : direct ? 'direct' : null
  return {
    content: message && message.content !== undefined ? message.content : null,
    usage: data?.usage || null,
    pipeline,
    canonicalSlug: routing.canonicalSlug || canonicalFromModel,
    finalProvider: routing.finalProvider || (direct ? slugify(direct) : null),
    finalProviderName: routing.finalProvider || direct,
    fallbacks: Array.isArray(routing.fallbacksAvailable)
      ? routing.fallbacksAvailable.filter((value) => typeof value === 'string')
      : [],
    plan: typeof routing.planningReasoning === 'string' ? routing.planningReasoning : '',
    model: typeof data?.model === 'string' ? data.model : null,
  }
}

/** Extract a provider-neutral error string from a gateway body. */
export function extractError(input) {
  if (input == null) return ''
  if (typeof input === 'string') return input
  const error = input.error ?? input.data?.error
  if (typeof error === 'string') return error
  if (error != null) {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return typeof input.message === 'string' ? input.message : ''
}

/**
 * Parse the fake-upstream routing error into the channel list.
 * planner: "Available providers are: a, b, ..."
 * direct:  {"error":{"metadata":{"available_providers":[...]}}}
 * @param {unknown} input error body or error text.
 * @param {'planner'|'direct'|null} pipeline
 */
export function parseAvailableProviders(input, pipeline) {
  const text = typeof input === 'string' ? input : extractError(input)
  const plannerText = /Available providers are:\s*([^.]+)/i.exec(text || '')
  const fromText = () => {
    if (!plannerText) return []
    return normalizeSlugs(plannerText[1].split(/,\s*/))
  }

  if (pipeline === 'planner') return fromText()

  // A direct-pipeline body may be the error object itself, or an error string
  // that embeds the OpenRouter JSON after a status prefix. Check both.
  if (input && typeof input === 'object') {
    const nested = input.error?.metadata?.available_providers
      ?? input.metadata?.available_providers
      ?? input.available_providers
    if (Array.isArray(nested)) return normalizeSlugs(nested)
  }
  const start = (text || '').indexOf('{')
  if (start >= 0) {
    try {
      const object = JSON.parse(text.slice(start))
      const list = object?.error?.metadata?.available_providers
        ?? object?.metadata?.available_providers
        ?? object?.available_providers
      if (Array.isArray(list)) return normalizeSlugs(list)
    } catch {
      // Fall through to the planner-shaped text.
    }
  }
  // A gateway may answer the direct pipeline with planner-shaped text; accept it.
  return fromText()
}

/** "alibaba won tier 0 over baseten, fireworks" -> ["alibaba","baseten","fireworks"] */
export function parseTier0(plan) {
  const match = /([\w.-]+)\s+won tier 0 over\s+([^."]+)/i.exec(String(plan || ''))
  if (!match) return []
  return normalizeSlugs([match[1], ...match[2].split(/,\s*|\s+and\s+/i)])
}

/** Classify one pinned-channel failure into the console's status vocabulary. */
export function classifyUpstreamError(message) {
  const text = String(message || '')
  if (/empty response content/i.test(text)) return 'ok'
  if (/429|rate-?limited|temporarily rate/i.test(text)) return 'limited'
  if (/invalid_request|modelid|no allowed providers|no available providers|not found|unsupported/i.test(text)) return 'bad'
  if (/unauthorized|re-authenticate|401/i.test(text)) return 'auth'
  return 'unknown'
}

/**
 * Build the ordered attempt list for one model.
 * - listed upstreams: one attempt each; strict pins only that channel, preferred
 *   puts it first in `order` and the rest after it.
 * - no listed upstreams: one automatic attempt; exclude becomes an only-whitelist.
 * @param {{upstreams?:string[],exclude?:string[],pinMode?:'auto'|'strict'|'preferred',sort?:string|null}} cfg
 */
export function buildAttempts(cfg = {}) {
  const exclude = normalizeSlugs(cfg.exclude)
  const listed = normalizeSlugs(cfg.upstreams).filter((upstream) => !exclude.includes(upstream))
  const hasList = normalizeHas(cfg.has)
  const mode = cfg.pinMode || (listed.length ? 'strict' : 'auto')
  const strict = mode !== 'preferred'
  const sort = cfg.sort || null
  const region = normalizeRegion(cfg.region)
  const extras = normalizeExtras(cfg.extras)
  if (mode !== 'auto' && listed.length) {
    return listed.map((upstream, index) => ({
      upstream,
      strict,
      orderRest: strict ? [] : listed.filter((_, other) => other !== index),
      excludeList: exclude,
      hasList,
      sort,
      region,
      extras,
    }))
  }
  return [{ upstream: null, strict, orderRest: [], excludeList: exclude, hasList, sort, region, extras }]
}

/**
 * Return a deep copy of one OpenAI chat body with routing preferences injected.
 * The gateway ignores exclude/ignore, so exclusion is expressed as an only
 * whitelist (known channels minus excluded ones). `attempt.extras` is merged
 * last, which is how a new gateway field can be sent without a plugin update.
 * @param {object} body original chat-completions body.
 * @param {'planner'|'direct'|null} pipeline
 * @param {{upstream?:string|null,strict?:boolean,orderRest?:string[],excludeList?:string[],hasList?:string[],sort?:string|null,region?:object,extras?:object}} attempt
 * @param {string[]} known channels discovered for this model.
 */
export function injectPrefs(body, pipeline, attempt = {}, known = []) {
  const copy = JSON.parse(JSON.stringify(body ?? {}))
  const upstream = attempt.upstream || null
  const exclude = normalizeSlugs(attempt.excludeList).filter((value) => value !== upstream)
  const allowList = exclude.length ? normalizeSlugs(known).filter((value) => !exclude.includes(value)) : null
  const hasList = normalizeHas(attempt.hasList)
  const sort = attempt.sort || null
  const region = normalizeRegion(attempt.region)
  const extras = normalizeExtras(attempt.extras)

  const useVercel = pipeline === 'planner' || pipeline == null
  const useOpenRouter = pipeline === 'direct' || pipeline == null

  if (useVercel) {
    const gateway = {}
    if (upstream) {
      if (attempt.strict !== false) gateway.only = [upstream]
      else {
        gateway.order = [upstream, ...normalizeSlugs(attempt.orderRest).filter((value) => value !== upstream)]
        if (allowList && allowList.length) gateway.only = allowList
      }
    } else if (allowList && allowList.length) {
      gateway.only = allowList
    }
    // Capability filter: an intersection with only/order, so a conflicting pin
    // is a hard 400 rather than a silent fallback.
    if (hasList.length) gateway.has = hasList
    if (sort) gateway.sort = sort
    // A pin without a region is resolved onto the private contributor route,
    // where the gateway ignores only/order; the region is what makes the pin
    // executable. Automatic requests with nothing else stay byte-identical.
    if (Object.keys(gateway).length && region.scope === 'zone') {
      gateway.inferenceRegion = buildInferenceRegion(region, [...(gateway.only || []), ...(gateway.order || [])])
    }
    const merged = extras.gateway ? deepMerge(gateway, extras.gateway) : gateway
    if (Object.keys(merged).length) {
      const current = copy.providerOptions && typeof copy.providerOptions === 'object' ? copy.providerOptions : {}
      const currentGateway = current.gateway && typeof current.gateway === 'object' ? current.gateway : {}
      copy.providerOptions = { ...current, gateway: { ...currentGateway, ...merged } }
    }
  }

  if (useOpenRouter) {
    // OpenRouter has no capability filter or inference region; provider.require_parameters
    // and provider.quantizations are the nearest equivalents but they do not map
    // one-to-one, so `has` and `inferenceRegion` are only injected for the gateway pipeline.
    const provider = copy.provider && typeof copy.provider === 'object' ? { ...copy.provider } : {}
    if (upstream) {
      if (attempt.strict !== false) provider.only = [upstream]
      else {
        provider.order = [upstream, ...normalizeSlugs(attempt.orderRest).filter((value) => value !== upstream)]
        if (allowList && allowList.length) provider.only = allowList
      }
    } else if (allowList && allowList.length) {
      provider.only = allowList
    }
    if (sort) provider.sort = OR_SORT[sort] || sort
    const merged = extras.provider ? deepMerge(provider, extras.provider) : provider
    if (Object.keys(merged).length) copy.provider = merged
  }

  return copy
}

/**
 * Minimal pinning body used by discovery/validation probes. The region is
 * included when enabled so a validation probes the same route the pin uses.
 */
export function pinBody(model, pipeline, upstream, region) {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }
  const regionOn = regionEnabled(region)
  if (pipeline === 'planner') {
    body.providerOptions = { gateway: { only: [upstream] } }
    if (regionOn) body.providerOptions.gateway.inferenceRegion = buildInferenceRegion(region, [upstream])
  } else if (pipeline === 'direct') body.provider = { only: [upstream] }
  else {
    body.provider = { only: [upstream] }
    body.providerOptions = { gateway: { only: [upstream] } }
    if (regionOn) body.providerOptions.gateway.inferenceRegion = buildInferenceRegion(region, [upstream])
  }
  return body
}

/** Minimal request used to discover which pipeline a model uses. */
export function probeBody(model) {
  return { model, messages: [{ role: 'user', content: 'Reply with the word OK' }], max_tokens: 256 }
}

/**
 * Fake-upstream request: zero tokens because the router rejects it first.
 * With a region the rejection happens on the public model, so the returned list
 * is the pool the pin will actually be validated against.
 */
export function harvestBody(model, pipeline, region) {
  const body = { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 16 }
  const regionOn = regionEnabled(region)
  if (pipeline === 'planner') {
    body.providerOptions = { gateway: { only: ['__probe__'] } }
    if (regionOn) body.providerOptions.gateway.inferenceRegion = buildInferenceRegion(region, ['__probe__'])
  } else if (pipeline === 'direct') {
    body.provider = { only: ['__probe__'] }
  } else {
    body.provider = { only: ['__probe__'] }
    body.providerOptions = { gateway: { only: ['__probe__'] } }
    if (regionOn) body.providerOptions.gateway.inferenceRegion = buildInferenceRegion(region, ['__probe__'])
  }
  return body
}

/** Parse the final SSE chunks for the real upstream. */
export function parseSSEProvider(text) {
  const source = String(text || '')
  let provider = null
  let canonical = null
  let pipeline = null
  const lines = source.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload)
      if (typeof chunk.provider === 'string') {
        provider = slugify(chunk.provider)
        canonical = typeof chunk.model === 'string' ? chunk.model : canonical
        pipeline = 'direct'
      }
    } catch {
      // A chunk can be split across the tail boundary; keep scanning.
    }
  }
  if (!provider) {
    const final = /"finalProvider"\s*:\s*"([^"]+)"/.exec(source)
    const slug = /"canonicalSlug"\s*:\s*"([^"]+)"/.exec(source)
    if (final) {
      provider = final[1]
      pipeline = 'planner'
    }
    if (slug) canonical = slug[1]
  }
  return { provider, canonical, pipeline }
}

/** Normalize one model's persisted config, dropping values the gateway cannot use. */
export function normalizeModelConfig(input = {}) {
  const exclude = normalizeSlugs(input.exclude).slice(0, 10)
  const upstreams = normalizeSlugs(input.upstreams).filter((value) => !exclude.includes(value)).slice(0, 10)
  const pinMode = input.pinMode === 'preferred'
    ? 'preferred'
    : input.pinMode === 'strict'
      ? 'strict'
      : 'auto'
  return {
    upstreams,
    exclude,
    has: normalizeHas(input.has),
    pinMode,
    sort: ['cost', 'ttft', 'tps'].includes(input.sort) ? input.sort : null,
    region: normalizeRegion(input.region),
    extras: normalizeExtras(input.extras),
  }
}

/**
 * A routing conflict fails identically on every channel, so the interceptor
 * must return the error instead of walking the rest of the pinned list.
 * Covers an unsatisfiable capability filter, a region that none of the allowed
 * providers serve, and an only list no known provider can satisfy.
 * @param {unknown} text gateway error body or message.
 */
export function isRoutingConflict(text) {
  const value = String(text || '')
  return /satisfy the required has conditions|has entries must be one of/i.test(value)
    || /support the requested inference region/i.test(value)
    || /no available providers match the 'only' filter/i.test(value)
}

/** Summary counters for the panel header. */
export function summarize(models = {}) {
  const result = { models: 0, channels: 0, pinned: 0, requests: 0, errors: 0 }
  for (const model of Object.values(models)) {
    if (!model || typeof model !== 'object') continue
    result.models += 1
    result.channels += Array.isArray(model.upstreams) ? model.upstreams.length : 0
    if (model.cfg && Array.isArray(model.cfg.upstreams) && model.cfg.upstreams.length) result.pinned += 1
    result.requests += Number(model.requests || 0)
    result.errors += Number(model.errors || 0)
  }
  return result
}
