// dsh-cline — Cline Pass upstream discovery / pinning / failover for DeepSeek Harness.
//
// The plugin installs a scoped wrapper around the Host process's global fetch.
// Only POST <gateway>/chat/completions requests whose body names a Cline Pass
// model are touched: routing preferences are injected into the body, the real
// upstream is read back from the response, and ordered fallback is performed
// before any byte reaches the caller. Every other request passes through.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  buildAttempts,
  classifyUpstreamError,
  extractError,
  harvestBody,
  injectPrefs,
  normalizeModelConfig,
  parseAvailableProviders,
  parseRouting,
  parseSSEProvider,
  parseTier0,
  pinBody,
  probeBody,
  resolveProviderSlug,
  slugify,
  summarize,
  uniq,
} from './core.js'

const PKG = 'dsh-cline'
const VERSION = '1.5.0'
const API_PREFIX = '/dsh-cline'
const OR_API = 'https://openrouter.ai/api/v1'

// Runtime facts the panel's diagnostics route reports. Nothing here is durable.
const diagnostics = {
  interceptor: 'starting',
  gatewayRequests: 0,
  intercepted: 0,
  lastInterceptAt: null,
  lastInterceptError: null,
  lastRouteAt: null,
  clientLogs: [],
}

// The bearer token observed on gateway traffic, kept in memory only.
let capturedAuth = null

const DEFAULTS = {
  enabled: true,
  gatewayBase: 'https://api.cline.bot/api/v1',
  apiKeyEnv: 'CLINE_API_KEY',
  modelPrefix: 'cline-pass/',
  llmProvider: 'cline',
  attemptTimeoutMs: 120000,
  probeTimeoutMs: 180000,
  maxHistory: 50,
  allowRemote: false,
  debug: false,
}

// OpenAI-style inference endpoints whose body carries the gateway routing
// preferences. Any other POST with a matching model is observed but not
// rewritten, because injecting `provider`/`providerOptions` into an unknown
// protocol could be rejected.
const DEFAULT_INJECT_PATHS = ['/chat/completions', '/responses', '/completions']

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const gatewayBase = String(input.gatewayBase || DEFAULTS.gatewayBase).replace(/\/+$/, '')
  let origin = ''
  let basePath = ''
  try {
    const url = new URL(gatewayBase)
    origin = url.origin
    basePath = url.pathname.replace(/\/+$/, '')
  } catch {
    origin = ''
    basePath = ''
  }
  const injectPaths = (Array.isArray(input.injectPaths) ? input.injectPaths : DEFAULT_INJECT_PATHS)
    .map((value) => String(value || '').trim())
    .filter((value) => value.startsWith('/'))
  return {
    enabled: input.enabled !== false,
    gatewayBase,
    gatewayOrigin: origin,
    gatewayPath: basePath,
    chatUrl: `${gatewayBase}/chat/completions`,
    injectPaths: injectPaths.length ? injectPaths : DEFAULT_INJECT_PATHS,
    apiKeyEnv: String(input.apiKeyEnv || DEFAULTS.apiKeyEnv),
    modelPrefix: String(input.modelPrefix || DEFAULTS.modelPrefix),
    llmProvider: String(input.llmProvider || DEFAULTS.llmProvider),
    attemptTimeoutMs: Math.max(1000, Number(input.attemptTimeoutMs) || DEFAULTS.attemptTimeoutMs),
    probeTimeoutMs: Math.max(1000, Number(input.probeTimeoutMs) || DEFAULTS.probeTimeoutMs),
    maxHistory: Math.max(1, Number(input.maxHistory) || DEFAULTS.maxHistory),
    allowRemote: input.allowRemote === true,
    debug: input.debug === true,
    apiPrefix: API_PREFIX,
  }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function atomicWrite(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    fs.writeFileSync(temporary, text, 'utf8')
    fs.renameSync(temporary, file)
  } catch {
    // State is a convenience cache; a read-only home must not break requests.
  }
}

function emptyModel() {
  return {
    pipeline: null,
    canonicalSlug: null,
    upstreams: [],
    upstreamDetail: {},
    status: {},
    cfg: normalizeModelConfig(),
    last: null,
    history: [],
    requests: 0,
    errors: 0,
    probedAt: null,
    validatedAt: null,
  }
}

class Store {
  constructor() {
    this.file = path.join(dshHome(), 'storages', `${PKG}.json`)
    this.data = { version: 1, models: {}, enabled: undefined }
    this.timer = null
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.models && typeof parsed.models === 'object') {
        this.data = { ...this.data, ...parsed, models: parsed.models }
      }
    } catch {
      // A missing or malformed cache starts empty.
    }
  }

  model(id) {
    const existing = this.data.models[id]
    if (existing && typeof existing === 'object') {
      existing.cfg = normalizeModelConfig(existing.cfg)
      if (!Array.isArray(existing.upstreams)) existing.upstreams = []
      if (!existing.upstreamDetail || typeof existing.upstreamDetail !== 'object') existing.upstreamDetail = {}
      if (!existing.status || typeof existing.status !== 'object') existing.status = {}
      if (!Array.isArray(existing.history)) existing.history = []
      if (!Number.isFinite(existing.requests)) existing.requests = 0
      if (!Number.isFinite(existing.errors)) existing.errors = 0
      return existing
    }
    const created = emptyModel()
    this.data.models[id] = created
    return created
  }

  record(id, patch) {
    Object.assign(this.model(id), patch)
    this.save()
  }

  enabled(config) {
    return this.data.enabled !== false && config.enabled !== false
  }

  save() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 250)
    this.timer.unref?.()
  }

  flush() {
    atomicWrite(this.file, JSON.stringify(this.data, null, 2))
  }
}

/**
 * Provider-agnostic request log. Kept in memory: it is an observability view,
 * not durable session state, and writing every gateway call to disk would be
 * more expensive than the thing it measures.
 */
class LogBook {
  constructor(limit = 200) {
    this.limit = limit
    this.entries = []
    this.counter = 0
  }

  push(entry) {
    this.counter += 1
    this.entries.unshift({
      id: `${Date.now().toString(36)}-${this.counter.toString(36)}`,
      at: Date.now(),
      ...entry,
    })
    if (this.entries.length > this.limit) this.entries.length = this.limit
  }

  list(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), this.limit)
    let entries = this.entries
    if (query.provider) entries = entries.filter((entry) => entry.provider === query.provider)
    if (query.model) entries = entries.filter((entry) => String(entry.model || '').includes(query.model))
    if (query.upstream) entries = entries.filter((entry) => String(entry.upstream || '').includes(query.upstream))
    if (query.onlyCline === '1' || query.onlyCline === 'true') entries = entries.filter((entry) => entry.provider === 'cline')
    if (query.onlyErrors === '1' || query.onlyErrors === 'true') entries = entries.filter((entry) => !!entry.error || Number(entry.status) >= 400)
    return entries.slice(0, limit)
  }

  clear() {
    this.entries = []
  }

  /**
   * Newest entry, optionally scoped to one session. Unattributed entries stay
   * eligible because the Host cannot always see a session id on the wire.
   */
  latest(session = null) {
    if (!session) return this.entries[0] || null
    return this.entries.find((entry) => !entry.session || entry.session === session) || null
  }
}

const logBook = new LogBook(200)

const PROVIDER_HOSTS = {
  'api.cline.bot': 'cline',
  'api.deepseek.com': 'deepseek',
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'openrouter.ai': 'openrouter',
  'generativelanguage.googleapis.com': 'google',
  'api.moonshot.cn': 'moonshot',
  'dashscope.aliyuncs.com': 'dashscope',
  'open.bigmodel.cn': 'zhipu',
  'api.minimax.chat': 'minimax',
}

const LLM_PATH_SUFFIXES = ['/chat/completions', '/responses', '/completions', '/messages']

function providerFromUrl(url) {
  try {
    const host = new URL(url).hostname
    return PROVIDER_HOSTS[host] || host
  } catch {
    return 'unknown'
  }
}

// Session affinity headers are only sent by adapters that enable them, so this
// is best-effort attribution: absent ids leave the entry unscoped rather than
// guessing which conversation it belongs to.
const SESSION_HEADERS = ['x-session-affinity', 'x-client-request-id', 'x-session-id', 'session_id']

function sessionOf(request, body) {
  for (const name of SESSION_HEADERS) {
    const value = request.headers.get(name)
    if (value) return value
  }
  const fromBody = body && (body.session_id || (body.metadata && body.metadata.session_id))
  return typeof fromBody === 'string' && fromBody ? fromBody : null
}

function isLlmRequest(request) {
  if (request.method !== 'POST') return false
  if (request.headers.get('x-dsh-cline-internal')) return false
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return false
  try {
    const body = JSON.parse(request.body)
    if (!body || typeof body.model !== 'string' || !body.model) return false
  } catch {
    return false
  }
  try {
    const pathname = new URL(request.url).pathname
    return LLM_PATH_SUFFIXES.some((suffix) => pathname.endsWith(suffix))
  } catch {
    return false
  }
}

function extractUsage(value) {
  const usage = value?.usage || value?.data?.usage
  if (!usage || typeof usage !== 'object') return null
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
  const total = Number(usage.total_tokens ?? (prompt + completion))
  const cached = Number(usage.prompt_tokens_details?.cached_tokens
    ?? usage.cache_read_input_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? 0)
  if (!prompt && !completion && !total) return null
  return { prompt, completion, total, cached }
}

function extractRequestId(response, json) {
  const headers = response?.headers
  return headers?.get('x-request-id')
    || headers?.get('request-id')
    || headers?.get('openai-request-id')
    || json?.id
    || null
}

function parseGenericSSE(text) {
  let provider = null
  let model = null
  let usage = null
  let error = null
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload)
      if (typeof chunk.provider === 'string') provider = slugify(chunk.provider)
      if (typeof chunk.model === 'string') model = chunk.model
      if (chunk.usage) usage = extractUsage(chunk) || usage
      if (chunk.error) error = typeof chunk.error === 'string' ? chunk.error : JSON.stringify(chunk.error)
    } catch {
      // Ignore non-JSON frames and tail-split lines.
    }
  }
  if (!provider) {
    const final = /"finalProvider"\s*:\s*"([^"]+)"/.exec(String(text || ''))
    if (final) provider = final[1]
  }
  return { provider, model, usage, error }
}

function log(ctx, config, message) {
  if (config.debug) ctx.logger?.info?.(`[${PKG}] ${message}`)
}

function warn(ctx, message) {
  ctx.logger?.warn?.(`[${PKG}] ${message}`)
}

function headerMap(headers) {
  return headers instanceof Headers ? headers : new Headers(headers || {})
}

function normalizeRequest(input, init) {
  let url
  let method
  let headers
  let body
  let signal
  if (typeof input === 'string' || input instanceof URL) {
    url = String(input)
    method = String(init?.method || 'GET').toUpperCase()
    headers = headerMap(init?.headers)
    body = init?.body
    signal = init?.signal
  } else if (input && typeof input === 'object' && typeof input.url === 'string') {
    url = input.url
    method = String(init?.method || input.method || 'GET').toUpperCase()
    headers = headerMap(init?.headers || input.headers)
    body = init?.body ?? null
    if (!body && input.body) return null
    signal = init?.signal || input.signal
  } else {
    return null
  }
  if (body == null) return null
  if (typeof body !== 'string') {
    if (Buffer.isBuffer(body)) body = body.toString('utf8')
    else if (body instanceof Uint8Array) body = Buffer.from(body).toString('utf8')
    else return null
  }
  return { input, init, url, method, headers, body, signal }
}

function matchesGateway(request, config) {
  if (request.method !== 'POST') return false
  if (request.headers.get('x-dsh-cline-internal')) return false
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return false
  let url
  try {
    url = new URL(request.url)
  } catch {
    return false
  }
  if (url.origin !== config.gatewayOrigin) return false
  if (!url.pathname.startsWith(`${config.gatewayPath}/`)) return false
  return true
}

/** OpenAI-style inference path whose body accepts the routing preferences. */
function isInjectablePath(pathname, config) {
  return (config.injectPaths || []).some((suffix) => pathname.endsWith(suffix))
}

function abortable(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function readCapped(response, limit) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const buffer = Buffer.from(value)
      if (size + buffer.length >= limit) {
        chunks.push(buffer.subarray(0, Math.max(0, limit - size)))
        size = limit
        break
      }
      chunks.push(buffer)
      size += buffer.length
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The stream may already be closed.
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readStreamText(response, limit = 524288) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  const parts = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const buffer = Buffer.from(value)
      parts.push(buffer)
      size += buffer.length
      while (size > limit && parts.length > 1) {
        size -= parts.shift().length
      }
    }
    return Buffer.concat(parts).toString('utf8') + decoder.decode()
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

async function readSSETail(response) {
  return parseSSEProvider(await readStreamText(response))
}

/**
 * Read the first chunk of a 200 event-stream response. The gateway can answer
 * 200 + text/event-stream while the body is really one error object; detecting
 * it before any byte reaches the caller keeps ordered fallback possible.
 */
async function peekStream(response) {
  if (!response.body) return { kind: 'empty' }
  const reader = response.body.getReader()
  let result
  try {
    result = await reader.read()
  } catch (error) {
    return { kind: 'error', message: String(error?.message || error), reader, head: null }
  }
  if (result.done) {
    try { await reader.cancel() } catch { /* ignore */ }
    return { kind: 'empty' }
  }
  const head = Buffer.from(result.value)
  const text = head.toString('utf8').trimStart()
  if (text.startsWith(':')) return { kind: 'ok', reader, head } // SSE comment/keep-alive
  if (!text.startsWith('data:')) {
    if (text.length === 0) return { kind: 'ok', reader, head }
    try { await reader.cancel() } catch { /* ignore */ }
    return { kind: 'error', message: `unexpected stream head: ${text.slice(0, 80)}`, reader, head: null }
  }
  const payload = text.slice(5).trim()
  if (payload === '[DONE]') return { kind: 'ok', reader, head }
  if (payload.startsWith('{"error"') || payload.startsWith('{"data":{"error"')) {
    try { await reader.cancel() } catch { /* ignore */ }
    return { kind: 'error', message: `stream error: ${payload.slice(0, 160)}`, reader, head: null }
  }
  return { kind: 'ok', reader, head }
}

function rebuildStream(head, reader, response) {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  const stream = new ReadableStream({
    start(controller) {
      if (head && head.length) controller.enqueue(head)
      const pump = () => {
        reader.read().then(({ done, value }) => {
          if (done) {
            controller.close()
            return
          }
          controller.enqueue(value)
          pump()
        }, (error) => controller.error(error))
      }
      pump()
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {})
    },
  })
  return new Response(stream, { status: response.status, statusText: response.statusText, headers })
}

async function readJSONResponse(response) {
  const text = await readCapped(response, 2 * 1024 * 1024)
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const routing = parseRouting(json)
  return {
    provider: routing.finalProvider,
    canonical: routing.canonicalSlug,
    pipeline: routing.pipeline,
  }
}

function rebuildResponse(text, response) {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(text, { status: response.status, statusText: response.statusText, headers })
}

function learnStatus(state, modelId, upstream, message) {
  const status = classifyUpstreamError(message)
  if (status === 'unknown') return
  const meta = state.model(modelId)
  meta.status = {
    ...(meta.status || {}),
    [upstream]: { status, note: String(message || '').slice(0, 160), checkedAt: Date.now() },
  }
  state.save()
}

function learnAvailable(state, modelId, message) {
  const meta = state.model(modelId)
  const list = parseAvailableProviders(message, meta.pipeline || 'planner')
  if (!list.length) return
  const merged = uniq([...(meta.upstreams || []), ...list])
  if (merged.length !== (meta.upstreams || []).length) {
    meta.upstreams = merged
    state.save()
  }
}

function pushHistory(meta, item, limit) {
  meta.history = [item, ...(meta.history || [])].slice(0, limit)
}

function tapResponse(response, modelId, state, config, started, trace, session = null) {
  let clone
  try {
    clone = response.clone()
  } catch {
    return
  }
  const contentType = response.headers.get('content-type') || ''
  const promise = contentType.includes('text/event-stream') ? readSSETail(clone) : readJSONResponse(clone)
  promise
    .then((info) => {
      if (!info) return
      // An endpoint that carries no provider attribution (embeddings, a plain
      // non-routed protocol) must not overwrite a good "last actual" value.
      if (!info.provider) return
      const meta = state.model(modelId)
      if (info.pipeline) meta.pipeline = info.pipeline
      if (info.canonical) meta.canonicalSlug = info.canonical
      const provider = resolveProviderSlug(info.provider, meta.upstreams)
      const last = {
        provider,
        canonical: info.canonical || meta.canonicalSlug || null,
        at: Date.now(),
        ms: Date.now() - started,
        status: trace[trace.length - 1]?.status ?? response.status,
        attempts: trace.map((item) => item.upstream || 'auto'),
        target: trace[trace.length - 1]?.upstream || null,
        error: null,
      }
      meta.last = last
      meta.requests = (meta.requests || 0) + 1
      pushHistory(meta, last, config.maxHistory)
      logBook.push({
        provider: 'cline',
        model: modelId,
        requestedModel: modelId,
        endpoint: '/chat/completions',
        status: last.status,
        ms: last.ms,
        stream: contentType.includes('text/event-stream'),
        upstream: provider,
        canonical: last.canonical,
        target: last.target,
        attempts: last.attempts,
        session,
        error: null,
      })
      state.save()
    })
    .catch(() => {})
}

/** Gateway refusal caused by an unsatisfiable or malformed `has` filter. */
function isHasConflict(text) {
  return /satisfy the required has conditions|has entries must be one of/i.test(String(text || ''))
}

function pushClineFailure(modelId, started, trace, status, error, session = null) {
  logBook.push({
    provider: 'cline',
    model: modelId,
    requestedModel: modelId,
    endpoint: '/chat/completions',
    status,
    ms: Date.now() - started,
    stream: false,
    upstream: null,
    target: trace[trace.length - 1]?.upstream || null,
    attempts: trace.map((item) => item.upstream || 'auto'),
    session,
    error: String(error || '').slice(0, 300) || null,
  })
}

function tapGeneric(response, request, started, parsed = null) {
  let clone
  try {
    clone = response.clone()
  } catch {
    return
  }
  let body = parsed
  if (body === null) {
    try {
      body = JSON.parse(request.body)
    } catch {
      body = null
    }
  }
  const requestedModel = String(body?.model || '')
  const session = sessionOf(request, body)
  let endpoint = ''
  try {
    endpoint = new URL(request.url).pathname
  } catch {
    // keep empty
  }
  const contentType = response.headers.get('content-type') || ''
  const stream = contentType.includes('text/event-stream')
  const promise = stream
    ? readStreamText(clone).then((text) => parseGenericSSE(text))
    : readCapped(clone, 2 * 1024 * 1024).then((text) => {
      let json = null
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
      return {
        provider: json?.provider ? slugify(json.provider) : null,
        model: json?.model || null,
        usage: extractUsage(json),
        error: extractError(json) || null,
        json,
      }
    })
  promise
    .then((info) => {
      const upstream = info.provider ? resolveProviderSlug(info.provider, []) : null
      logBook.push({
        provider: providerFromUrl(request.url),
        model: info.model || requestedModel,
        requestedModel,
        endpoint,
        status: response.status,
        ms: Date.now() - started,
        stream,
        upstream,
        requestId: extractRequestId(response, info.json),
        usage: info.usage || null,
        session,
        error: info.error || (response.ok ? null : `HTTP ${response.status}`),
      })
    })
    .catch(() => {})
}

async function observeGeneric(previous, request, started) {
  let body = null
  try {
    body = JSON.parse(request.body)
  } catch {
    body = null
  }
  try {
    const response = await previous(request.input, request.init)
    tapGeneric(response, request, started, body)
    return response
  } catch (error) {
    logBook.push({
      provider: providerFromUrl(request.url),
      model: String(body?.model || ''),
      requestedModel: String(body?.model || ''),
      endpoint: (() => {
        try {
          return new URL(request.url).pathname
        } catch {
          return ''
        }
      })(),
      status: 0,
      ms: Date.now() - started,
      stream: false,
      upstream: null,
      session: sessionOf(request, body),
      error: String(error?.message || error).slice(0, 300),
    })
    throw error
  }
}

async function proxyRequest(previous, request, bodyObject, state, config, ctx) {
  const modelId = String(bodyObject.model || '')
  if (!modelId.startsWith(config.modelPrefix)) return previous(request.input, request.init)

  diagnostics.gatewayRequests += 1
  const authorization = request.headers.get('authorization')
  if (authorization) capturedAuth = authorization.replace(/^Bearer\s+/i, '').trim()

  let pathname = ''
  try {
    pathname = new URL(request.url).pathname
  } catch {
    return previous(request.input, request.init)
  }

  // Non-OpenAI protocols (an anthropic-messages route, a discovery call, ...)
  // are passed through byte-for-byte. We still read the routing metadata so the
  // panel can report what actually served the request.
  if (!isInjectablePath(pathname, config)) {
    const started = Date.now()
    const response = await previous(request.input, request.init)
    tapResponse(response, modelId, state, config, started, [], sessionOf(request, bodyObject))
    return response
  }

  const session = sessionOf(request, bodyObject)
  const meta = state.model(modelId)
  const attempts = buildAttempts(meta.cfg)
  const started = Date.now()
  const trace = []

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const send = injectPrefs(bodyObject, meta.pipeline, attempt, meta.upstreams || [])
    const headers = new Headers(request.headers)
    headers.set('content-type', 'application/json')
    headers.delete('content-length')
    const init = {
      ...(request.init || {}),
      method: 'POST',
      headers,
      body: JSON.stringify(send),
      signal: abortable(request.signal, config.attemptTimeoutMs),
    }

    let response
    try {
      response = await previous(request.url, init)
    } catch (error) {
      const message = String(error?.message || error)
      trace.push({ upstream: attempt.upstream, status: 0, ms: Date.now() - started, note: message.slice(0, 160) })
      if (index === attempts.length - 1) {
        meta.errors = (meta.errors || 0) + 1
        meta.last = {
          provider: null,
          at: Date.now(),
          ms: Date.now() - started,
          status: 0,
          attempts: trace.map((item) => item.upstream || 'auto'),
          target: attempt.upstream || null,
          error: message.slice(0, 300),
        }
        pushClineFailure(modelId, started, trace, 0, message, session)
        state.save()
        return new Response(
          JSON.stringify({ error: { message: `upstream fetch failed: ${message}`, type: 'upstream_error' } }),
          { status: 502, headers: { 'content-type': 'application/json' } },
        )
      }
      continue
    }

    trace.push({ upstream: attempt.upstream, status: response.status, ms: Date.now() - started, note: '' })

    if (response.ok) {
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream')) {
        const peek = await peekStream(response)
        if (peek.kind === 'error') {
          trace[trace.length - 1].status = 200
          trace[trace.length - 1].note = peek.message.slice(0, 160)
          if (attempt.upstream) learnStatus(state, modelId, attempt.upstream, peek.message)
          if (index === attempts.length - 1) {
            meta.errors = (meta.errors || 0) + 1
            state.record(modelId, {
              last: {
                provider: null,
                canonical: null,
                at: Date.now(),
                ms: Date.now() - started,
                status: 502,
                attempts: trace.map((item) => item.upstream || 'auto'),
                target: attempt.upstream || null,
                error: peek.message.slice(0, 300),
              },
            })
            pushClineFailure(modelId, started, trace, 502, peek.message, session)
            return new Response(
              JSON.stringify({ error: { message: peek.message, type: 'upstream_error' } }),
              { status: 502, headers: { 'content-type': 'application/json' } },
            )
          }
          continue
        }
        if (peek.kind === 'ok') {
          const rebuilt = rebuildStream(peek.head, peek.reader, response)
          tapResponse(rebuilt, modelId, state, config, started, trace, session)
          return rebuilt
        }
        // Empty stream: treat it as a failure and try the next channel.
        trace[trace.length - 1].note = 'empty stream'
        if (index === attempts.length - 1) {
          meta.errors = (meta.errors || 0) + 1
          state.record(modelId, {
            last: {
              provider: null,
              canonical: null,
              at: Date.now(),
              ms: Date.now() - started,
              status: 502,
              attempts: trace.map((item) => item.upstream || 'auto'),
              target: attempt.upstream || null,
              error: 'empty stream',
            },
          })
          pushClineFailure(modelId, started, trace, 502, 'empty stream', session)
          return new Response(
            JSON.stringify({ error: { message: 'upstream returned an empty stream', type: 'upstream_error' } }),
            { status: 502, headers: { 'content-type': 'application/json' } },
          )
        }
        continue
      }
      tapResponse(response, modelId, state, config, started, trace, session)
      return response
    }

    const text = await readCapped(response, 64 * 1024)
    trace[trace.length - 1].note = text.slice(0, 160)
    if (attempt.upstream) learnStatus(state, modelId, attempt.upstream, text)
    if (!attempt.upstream && (attempt.excludeList || []).length) learnAvailable(state, modelId, text)

    // A capability filter that matches nothing fails identically on every
    // channel, so retrying the next pinned one would only add latency.
    if (isHasConflict(text)) {
      meta.errors = (meta.errors || 0) + 1
      state.record(modelId, {
        last: {
          provider: null,
          canonical: null,
          at: Date.now(),
          ms: Date.now() - started,
          status: response.status,
          attempts: trace.map((item) => item.upstream || 'auto'),
          target: attempt.upstream || null,
          error: text.slice(0, 300),
        },
      })
      pushClineFailure(modelId, started, trace, response.status, text, session)
      return rebuildResponse(text, response)
    }

    if (index === attempts.length - 1) {
      meta.errors = (meta.errors || 0) + 1
      state.record(modelId, {
        last: {
          provider: null,
          canonical: null,
          at: Date.now(),
          ms: Date.now() - started,
          status: response.status,
          attempts: trace.map((item) => item.upstream || 'auto'),
          target: attempt.upstream || null,
          error: text.slice(0, 300),
        },
      })
      pushClineFailure(modelId, started, trace, response.status, text, session)
      return rebuildResponse(text, response)
    }
  }

  return previous(request.input, request.init)
}

function installFetch(ctx, state, config) {
  const previous = globalThis.fetch
  if (typeof previous !== 'function') {
    diagnostics.interceptor = 'unavailable: no global fetch'
    return () => {}
  }

  let disposed = false
  const wrapper = async function dshClineFetch(input, init) {
    if (disposed) return previous(input, init)
    try {
      const request = normalizeRequest(input, init)
      if (!request) return previous(input, init)
      if (!state.enabled(config)) return previous(input, init)

      if (matchesGateway(request, config)) {
        let bodyObject
        try {
          bodyObject = JSON.parse(request.body)
        } catch {
          return previous(input, init)
        }
        if (!bodyObject || typeof bodyObject !== 'object') return previous(input, init)
        diagnostics.intercepted += 1
        diagnostics.lastInterceptAt = Date.now()
        return await proxyRequest(previous, request, bodyObject, state, config, ctx)
      }

      // Other providers: record the call for the request log, never rewrite it.
      if (isLlmRequest(request)) {
        diagnostics.intercepted += 1
        diagnostics.lastInterceptAt = Date.now()
        return await observeGeneric(previous, request, Date.now())
      }

      return previous(input, init)
    } catch (error) {
      diagnostics.lastInterceptError = String(error?.stack || error).slice(0, 500)
      log(ctx, config, `interceptor fallback: ${String(error?.message || error)}`)
      return previous(input, init)
    }
  }

  globalThis.fetch = wrapper
  diagnostics.interceptor = 'installed'
  log(ctx, config, 'fetch interceptor installed')

  return () => {
    disposed = true
    if (globalThis.fetch === wrapper) globalThis.fetch = previous
    diagnostics.interceptor = 'removed'
    log(ctx, config, 'fetch interceptor removed')
  }
}

async function resolveKey(ctx, state, config) {
  try {
    const credentials = ctx.get('credentials')
    if (credentials?.resolve) {
      const hit = await credentials.resolve(config.apiKeyEnv)
      if (hit?.value) return hit.value
    }
  } catch {
    // The credentials service may be absent; fall through.
  }
  if (capturedAuth) return capturedAuth
  const environment = process.env[config.apiKeyEnv]
  return environment || null
}

async function fetchJSON(url, init, timeoutMs) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    const text = await readCapped(response, 2 * 1024 * 1024)
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { ok: response.ok, status: response.status, json, text }
  } catch (error) {
    return { ok: false, status: 0, json: null, text: '', error: String(error?.message || error) }
  }
}

async function postJSON(config, key, body, timeoutMs) {
  return fetchJSON(
    config.chatUrl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'x-dsh-cline-internal': '1',
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )
}

async function harvestProviders(config, key, modelId, pipeline) {
  const result = await postJSON(config, key, harvestBody(modelId, pipeline), 60000)
  const fromBody = parseAvailableProviders(result.json, pipeline)
  if (fromBody.length) return fromBody
  const text = result.text || extractError(result.json)
  return parseAvailableProviders(text, pipeline)
}

async function openRouterEndpoints(state, canonicalSlug) {
  const now = Date.now()
  if (!state.data.orModels || now - (state.data.orModelsFetchedAt || 0) > 6 * 3600e3) {
    const listing = await fetchJSON(`${OR_API}/models`, {}, 15000)
    const ids = Array.isArray(listing.json?.data) ? listing.json.data.map((item) => item.id).filter(Boolean) : []
    if (ids.length) {
      state.data.orModels = ids
      state.data.orModelsFetchedAt = now
      state.save()
    }
  }
  const ids = Array.isArray(state.data.orModels) ? state.data.orModels : []
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const real = ids.find((id) => id === canonicalSlug) || ids.find((id) => normalize(id) === normalize(canonicalSlug))
  if (!real) return []
  const endpoints = await fetchJSON(`${OR_API}/models/${encodeURIComponent(real)}/endpoints`, {}, 15000)
  const list = endpoints.json?.data?.endpoints
  if (!Array.isArray(list)) return []
  const detail = {}
  for (const endpoint of list) {
    const provider = String(endpoint.tag || '').split('/')[0]
      || String(endpoint.provider_name || '').toLowerCase().replace(/\s+/g, '-')
    if (!provider) continue
    const item = (detail[provider] ||= { slug: provider, name: endpoint.provider_name || provider, endpoints: 0, context: 0, uptime: 0 })
    item.endpoints += 1
    item.context = Math.max(item.context, Number(endpoint.context_length) || 0)
    item.uptime = Math.max(item.uptime, Math.round(Number(endpoint.uptime_last_30m) || 0))
  }
  return Object.values(detail)
}

async function probeModel(ctx, state, config, modelId) {
  const key = await resolveKey(ctx, state, config)
  if (!key) {
    return { ok: false, error: `未找到上游凭据 ${config.apiKeyEnv}；请先在 Settings → Models 配置，或发送一条消息让插件捕获 Authorization。` }
  }
  const started = Date.now()
  const probe = await postJSON(config, key, probeBody(modelId), config.probeTimeoutMs)
  if (probe.error) return { ok: false, error: probe.error }
  const routing = parseRouting(probe.json)
  if (!routing.pipeline) {
    return {
      ok: false,
      error: extractError(probe.json) || '网关响应未携带 provider_metadata.gateway.routing 或顶层 provider，无法判定管道。',
      status: probe.status,
    }
  }

  let harvest = []
  try {
    harvest = await harvestProviders(config, key, modelId, routing.pipeline)
  } catch {
    harvest = []
  }

  let endpoints = []
  if (routing.pipeline === 'direct' && routing.canonicalSlug) {
    try {
      endpoints = await openRouterEndpoints(state, routing.canonicalSlug)
    } catch {
      endpoints = []
    }
  }
  const detail = {}
  for (const endpoint of endpoints) detail[endpoint.slug] = endpoint

  const meta = state.model(modelId)
  const discovered = uniq([...(harvest.length ? harvest : meta.upstreams || []), ...routing.fallbacks, ...Object.keys(detail)])
  meta.pipeline = routing.pipeline
  meta.canonicalSlug = routing.canonicalSlug || meta.canonicalSlug || null
  if (discovered.length) meta.upstreams = discovered
  meta.upstreamDetail = detail
  meta.availableProviders = harvest
  meta.probedAt = Date.now()
  meta.tier0 = uniq([...(meta.tier0 || []), ...parseTier0(routing.plan)])
  meta.last = {
    provider: resolveProviderSlug(routing.finalProvider, discovered),
    canonical: routing.canonicalSlug || null,
    at: Date.now(),
    ms: Date.now() - started,
    status: probe.status,
    attempts: ['auto'],
    target: null,
    error: null,
  }
  state.save()
  log(ctx, config, `probe ${modelId}: ${routing.pipeline}, ${discovered.length} channels`)
  return {
    ok: true,
    model: modelId,
    pipeline: routing.pipeline,
    canonicalSlug: routing.canonicalSlug,
    upstreams: discovered,
    fallbacks: routing.fallbacks,
    detail,
    last: meta.last,
    ms: Date.now() - started,
    sources: { harvest: harvest.length, openrouter: endpoints.length },
  }
}

async function validateModel(ctx, state, config, modelId) {
  const meta = state.model(modelId)
  const list = Array.isArray(meta.upstreams) ? meta.upstreams : []
  if (!list.length) return { ok: false, error: '尚未探测到渠道；先点「探测」。' }
  const key = await resolveKey(ctx, state, config)
  if (!key) return { ok: false, error: `未找到上游凭据 ${config.apiKeyEnv}。` }

  const results = {}
  const batchSize = 5
  for (let index = 0; index < list.length; index += batchSize) {
    const batch = list.slice(index, index + batchSize)
    await Promise.all(batch.map(async (upstream) => {
      const started = Date.now()
      const result = await postJSON(config, key, pinBody(modelId, meta.pipeline, upstream), 60000)
      const message = extractError(result.json) || result.text || result.error || ''
      const success = !!(result.json?.choices || result.json?.data?.choices)
      const status = success ? 'ok' : classifyUpstreamError(message)
      results[upstream] = {
        status,
        ms: Date.now() - started,
        note: success ? 'ok' : message.slice(0, 160),
        checkedAt: Date.now(),
      }
    }))
  }
  meta.status = { ...(meta.status || {}), ...results }
  meta.validatedAt = Date.now()
  state.save()
  const summary = { ok: 0, limited: 0, bad: 0, auth: 0, unknown: 0 }
  for (const item of Object.values(results)) summary[item.status] = (summary[item.status] || 0) + 1
  return { ok: true, model: modelId, summary, results, upstreams: list }
}

async function testModel(ctx, state, config, modelId, override = {}) {
  const meta = state.model(modelId)
  const cfg = normalizeModelConfig({ ...meta.cfg, ...override })
  const attempts = buildAttempts(cfg)
  const key = await resolveKey(ctx, state, config)
  if (!key) return { ok: false, error: `未找到上游凭据 ${config.apiKeyEnv}。` }

  const base = probeBody(modelId)
  const trace = []
  const started = Date.now()
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    const send = injectPrefs(base, meta.pipeline, attempt, meta.upstreams || [])
    const began = Date.now()
    const result = await postJSON(config, key, send, config.probeTimeoutMs)
    const routing = parseRouting(result.json)
    const message = extractError(result.json) || result.text || result.error || ''
    const reachedModel = /empty response content/i.test(message)
    const success = !!(result.json?.choices || result.json?.data?.choices) || reachedModel
    trace.push({
      upstream: attempt.upstream,
      status: success ? result.status : result.status || 0,
      ms: Date.now() - began,
      note: success ? (reachedModel ? 'empty response (reached model)' : 'ok') : message.slice(0, 160),
    })
    if (success) {
      if (routing.pipeline) meta.pipeline = routing.pipeline
      if (routing.canonicalSlug) meta.canonicalSlug = routing.canonicalSlug
      const actual = resolveProviderSlug(routing.finalProvider, meta.upstreams)
      const last = {
        provider: actual,
        canonical: routing.canonicalSlug || null,
        at: Date.now(),
        ms: Date.now() - started,
        status: result.status,
        attempts: trace.map((item) => item.upstream || 'auto'),
        target: attempt.upstream || null,
        error: null,
      }
      meta.last = last
      state.save()
      return {
        ok: true,
        model: modelId,
        actual,
        actualName: routing.finalProviderName,
        pipeline: routing.pipeline || meta.pipeline,
        canonicalSlug: routing.canonicalSlug,
        content: typeof routing.content === 'string' ? routing.content.slice(0, 120) : null,
        note: reachedModel ? '请求已到达模型，但推理耗尽输出预算，内容为空；该渠道可用。' : null,
        trace,
        ms: Date.now() - started,
      }
    }
    if (attempt.upstream) learnStatus(state, modelId, attempt.upstream, message)
  }
  return { ok: false, model: modelId, error: trace[trace.length - 1]?.note || '所有尝试均失败', trace, ms: Date.now() - started }
}

async function modelIds(ctx, state, config) {
  const ids = new Set(Object.keys(state.data.models))
  try {
    const llm = ctx.get('llm')
    const list = await llm.listModels(config.llmProvider)
    for (const model of list || []) {
      if (model && typeof model.id === 'string') ids.add(model.id)
    }
  } catch {
    // No LLM service or no catalog; observed models are still listed.
  }
  return [...ids].filter((id) => id.startsWith(config.modelPrefix)).sort()
}

async function credentialConfigured(ctx, state, config) {
  try {
    const credentials = ctx.get('credentials')
    const info = await credentials.describe(config.apiKeyEnv)
    if (info && typeof info.configured === 'boolean') return info.configured
  } catch {
    // fall through
  }
  return !!(capturedAuth || process.env[config.apiKeyEnv])
}

async function stateResponse(ctx, state, config) {
  const models = Object.entries(state.data.models || {}).map(([id, model]) => ({
    id,
    pipeline: model.pipeline || null,
    canonicalSlug: model.canonicalSlug || null,
    upstreams: (model.upstreams || []).map((upstream) => ({
      slug: upstream,
      ...(model.upstreamDetail?.[upstream] || {}),
      ...(model.status?.[upstream] || {}),
    })),
    cfg: normalizeModelConfig(model.cfg),
    last: model.last || null,
    history: (model.history || []).slice(0, 12),
    requests: model.requests || 0,
    errors: model.errors || 0,
    tier0: Array.isArray(model.tier0) ? model.tier0 : [],
    probedAt: model.probedAt || null,
    validatedAt: model.validatedAt || null,
  }))
  return {
    ok: true,
    gateway: config.gatewayBase,
    modelPrefix: config.modelPrefix,
    apiKeyEnv: config.apiKeyEnv,
    enabled: state.enabled(config),
    apiKeyConfigured: await credentialConfigured(ctx, state, config),
    llmProvider: config.llmProvider,
    modelIds: await modelIds(ctx, state, config),
    models,
    summary: summarize(state.data.models),
    interceptor: diagnostics.interceptor,
    logCount: logBook.entries.length,
    version: 1,
  }
}

function isLoopback(address) {
  if (!address) return true // in-process / IPC bridge: no socket is a trusted local caller
  const value = String(address)
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1'
    || value.startsWith('127.')
    || value.startsWith('::ffff:127.')
}

function isLocalOrigin(origin) {
  if (!origin) return true
  if (origin === 'null' || origin === 'file://') return true
  try {
    const parsed = new URL(origin)
    if (parsed.protocol === 'file:') return true
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    const host = parsed.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.startsWith('127.')
  } catch {
    return false
  }
}

/**
 * CORS for the harness page. The Desktop renderer loads over file:// and reaches
 * the Host by absolute origin, so its POSTs are cross-origin and preflighted.
 * Non-local web origins are refused rather than reflected.
 */
function applyCORS(request, response) {
  const origin = request.headers.origin
  if (!origin) return true
  if (!isLocalOrigin(origin)) return false
  response.setHeader('access-control-allow-origin', origin === 'null' ? 'null' : origin)
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type,accept')
  response.setHeader('access-control-max-age', '600')
  response.setHeader('vary', 'origin')
  return true
}

function sendJSON(response, status, value) {
  const text = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

function readBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

async function parseJSONBody(request) {
  const text = await readBody(request)
  if (!text) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be a JSON object')
  return value
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return true
  if (origin === 'null' || origin === 'file://') return true
  try {
    const parsed = new URL(origin)
    if (parsed.protocol === 'file:') return true
    if (parsed.host === request.headers.host) return true
    return isLocalOrigin(origin)
  } catch {
    return false
  }
}

function registerRoutes(ctx, state, config) {
  const handler = async (request, response) => {
    diagnostics.lastRouteAt = Date.now()
    try {
      if (!config.allowRemote && !isLoopback(request.socket?.remoteAddress)) {
        return sendJSON(response, 403, { ok: false, error: 'loopback only' })
      }
      if (!applyCORS(request, response)) {
        return sendJSON(response, 403, { ok: false, error: 'cross-origin request refused' })
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204)
        return response.end()
      }
      if (!sameOrigin(request)) {
        return sendJSON(response, 403, { ok: false, error: 'cross-origin request refused' })
      }
      const url = new URL(request.url || '/', 'http://x')
      const action = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')

      if (request.method === 'GET' && (action === '' || action === 'state')) {
        return sendJSON(response, 200, await stateResponse(ctx, state, config))
      }

      if (request.method === 'GET' && action === 'status') {
        // The newest call wins, whoever served it: reporting the newest Cline
        // call instead would show a stale channel whenever the current model
        // is routed elsewhere.
        const session = url.searchParams.get('session')
        const last = logBook.latest(session)
        return sendJSON(response, 200, {
          ok: true,
          enabled: state.enabled(config),
          interceptor: diagnostics.interceptor,
          last,
          total: logBook.entries.length,
        })
      }

      if (request.method === 'POST' && action === 'client-log') {
        try {
          const body = await parseJSONBody(request)
          diagnostics.clientLogs.unshift({ at: Date.now(), ...body })
          if (diagnostics.clientLogs.length > 20) diagnostics.clientLogs.length = 20
        } catch {
          // A malformed diagnostic must never affect the panel.
        }
        return sendJSON(response, 200, { ok: true })
      }

      if (request.method === 'GET' && action === 'logs') {
        const query = Object.fromEntries(url.searchParams)
        const entries = logBook.list(query)
        return sendJSON(response, 200, {
          ok: true,
          total: logBook.entries.length,
          entries,
          providers: uniq(logBook.entries.map((entry) => entry.provider).filter(Boolean)),
        })
      }

      if (request.method === 'POST' && action === 'logs/clear') {
        logBook.clear()
        return sendJSON(response, 200, { ok: true })
      }

      if (request.method === 'GET' && action === 'diag') {
        return sendJSON(response, 200, {
          ok: true,
          version: VERSION,
          interceptor: diagnostics.interceptor,
          gatewayRequests: diagnostics.gatewayRequests,
          intercepted: diagnostics.intercepted,
          lastInterceptAt: diagnostics.lastInterceptAt,
          lastInterceptError: diagnostics.lastInterceptError,
          lastRouteAt: diagnostics.lastRouteAt,
          clientLogs: diagnostics.clientLogs,
          stateFile: state.file,
          process: { pid: process.pid, platform: process.platform, node: process.version },
          config: {
            gatewayBase: config.gatewayBase,
            modelPrefix: config.modelPrefix,
            injectPaths: config.injectPaths,
            llmProvider: config.llmProvider,
            allowRemote: config.allowRemote,
          },
        })
      }

      if (request.method === 'POST' && action === 'enabled') {
        const body = await parseJSONBody(request)
        state.data.enabled = body.enabled !== false
        state.save()
        return sendJSON(response, 200, { ok: true, enabled: state.enabled(config) })
      }

      if (request.method === 'POST' && action === 'config') {
        const body = await parseJSONBody(request)
        if (typeof body.model !== 'string' || !body.model) {
          return sendJSON(response, 400, { ok: false, error: 'model is required' })
        }
        const meta = state.model(body.model)
        meta.cfg = normalizeModelConfig({
          upstreams: body.upstreams ?? meta.cfg.upstreams,
          exclude: body.exclude ?? meta.cfg.exclude,
          has: body.has ?? meta.cfg.has,
          pinMode: body.pinMode ?? meta.cfg.pinMode,
          sort: body.sort ?? meta.cfg.sort,
        })
        state.save()
        return sendJSON(response, 200, { ok: true, model: body.model, cfg: meta.cfg })
      }

      if (request.method === 'POST' && action === 'probe') {
        const body = await parseJSONBody(request)
        if (typeof body.model !== 'string' || !body.model) {
          return sendJSON(response, 400, { ok: false, error: 'model is required' })
        }
        return sendJSON(response, 200, await probeModel(ctx, state, config, body.model))
      }

      if (request.method === 'POST' && action === 'validate') {
        const body = await parseJSONBody(request)
        if (typeof body.model !== 'string' || !body.model) {
          return sendJSON(response, 400, { ok: false, error: 'model is required' })
        }
        return sendJSON(response, 200, await validateModel(ctx, state, config, body.model))
      }

      if (request.method === 'POST' && action === 'test') {
        const body = await parseJSONBody(request)
        if (typeof body.model !== 'string' || !body.model) {
          return sendJSON(response, 400, { ok: false, error: 'model is required' })
        }
        const override = {}
        if (Array.isArray(body.upstreams)) override.upstreams = body.upstreams
        if (Array.isArray(body.exclude)) override.exclude = body.exclude
        if (body.pinMode) override.pinMode = body.pinMode
        if (body.sort !== undefined) override.sort = body.sort
        return sendJSON(response, 200, await testModel(ctx, state, config, body.model, override))
      }

      if (request.method === 'GET' && action === 'history') {
        const all = []
        for (const [id, model] of Object.entries(state.data.models || {})) {
          for (const item of model.history || []) all.push({ model: id, ...item })
        }
        all.sort((left, right) => (right.at || 0) - (left.at || 0))
        return sendJSON(response, 200, { ok: true, history: all.slice(0, 100) })
      }

      return sendJSON(response, 404, { ok: false, error: `unknown action: ${action || '(root)'}` })
    } catch (error) {
      warn(ctx, `route error: ${String(error?.stack || error)}`)
      if (!response.headersSent) sendJSON(response, 500, { ok: false, error: String(error?.message || error) })
      else response.destroy()
    }
  }

  const dispose = ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler })
  log(ctx, config, `routes registered at ${API_PREFIX}`)
  return () => dispose()
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const state = new Store()

  log(ctx, config, `activated (gateway=${config.gatewayBase}, enabled=${state.enabled(config)})`)

  ctx.effect(() => installFetch(ctx, state, config))

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => registerRoutes(webCtx, state, config))
  })
}

export const __test = { logBook, isLlmRequest, providerFromUrl, parseGenericSSE, extractUsage }

export { normalizeConfig, Store, installFetch }
