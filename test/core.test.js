import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAttempts,
  buildInferenceRegion,
  classifyUpstreamError,
  extractError,
  harvestBody,
  injectPrefs,
  isRoutingConflict,
  normalizeExtras,
  normalizeHas,
  normalizeModelConfig,
  normalizeRegion,
  parseAvailableProviders,
  parseRouting,
  parseSSEProvider,
  parseTier0,
  pinBody,
  resolveProviderSlug,
  summarize,
} from '../core.js'

test('parseRouting reads the planner pipeline from message metadata', () => {
  const routing = parseRouting({
    data: {
      choices: [{
        message: {
          content: 'OK',
          provider_metadata: {
            gateway: {
              routing: {
                canonicalSlug: 'deepseek/deepseek-v4.1-flash',
                finalProvider: 'alibaba',
                fallbacksAvailable: ['baseten', 'fireworks'],
                planningReasoning: 'alibaba won tier 0 over baseten and fireworks',
              },
            },
          },
        },
      }],
      usage: { total_tokens: 12 },
      model: 'cline-pass/deepseek-v4.1-flash-1017',
    },
  })
  assert.equal(routing.pipeline, 'planner')
  assert.equal(routing.finalProvider, 'alibaba')
  assert.equal(routing.canonicalSlug, 'deepseek/deepseek-v4.1-flash')
  assert.deepEqual(routing.fallbacks, ['baseten', 'fireworks'])
  assert.equal(routing.content, 'OK')
  assert.deepEqual(parseTier0(routing.plan), ['alibaba', 'baseten', 'fireworks'])
})

test('parseRouting reads the direct pipeline from the top-level provider', () => {
  const routing = parseRouting({
    provider: 'GMICloud',
    model: 'z-ai/glm-5.3-flash',
    choices: [{ message: { content: 'OK' } }],
  })
  assert.equal(routing.pipeline, 'direct')
  assert.equal(routing.finalProvider, 'gmicloud')
  assert.equal(routing.finalProviderName, 'GMICloud')
  assert.equal(routing.canonicalSlug, 'z-ai/glm-5.3-flash')
})

test('parseRouting returns null pipeline when the gateway hides attribution', () => {
  const routing = parseRouting({ choices: [{ message: { content: 'OK' } }] })
  assert.equal(routing.pipeline, null)
  assert.equal(routing.finalProvider, null)
})

test('parseAvailableProviders handles planner text and filters JSON fragments', () => {
  const text = 'Provider set restricted to: __probe__. Available providers are: alibaba, baseten, fireworks, ","type":"invalid_request_error".'
  assert.deepEqual(parseAvailableProviders(text, 'planner'), ['alibaba', 'baseten', 'fireworks'])
})

test('parseAvailableProviders handles the direct JSON error string', () => {
  const text = '{"error":{"message":"no allowed providers","metadata":{"available_providers":["GMICloud","Baseten"]}}}'
  assert.deepEqual(parseAvailableProviders(text, 'direct'), ['GMICloud', 'Baseten'])
})

test('parseAvailableProviders also accepts a parsed object', () => {
  const body = { error: { metadata: { available_providers: ['fireworks', 'sail-research'] } } }
  assert.deepEqual(parseAvailableProviders(body, 'direct'), ['fireworks', 'sail-research'])
})

test('parseAvailableProviders digs the nested JSON out of a direct error string', () => {
  const body = {
    error: 'inference request failed: failed to invoke model from Openrouter: request failed with status 404: '
      + '{"error":{"message":"No allowed providers","code":404,"metadata":{"available_providers":["wafer","baseten","z-ai"],"requested_providers":["__probe__"]}}}',
  }
  assert.deepEqual(parseAvailableProviders(body, 'direct'), ['wafer', 'baseten', 'z-ai'])
})

test('injectPrefs strict planner sets providerOptions.gateway.only and the region', () => {
  const out = injectPrefs(
    { model: 'm', messages: [], providerOptions: { gateway: { sort: 'cost' } } },
    'planner',
    { upstream: 'alibaba', strict: true },
  )
  assert.deepEqual(out.providerOptions.gateway, {
    sort: 'cost',
    only: ['alibaba'],
    inferenceRegion: { scope: 'zone', geoRegion: 'us', providers: { alibaba: null } },
  })
  assert.equal(out.provider, undefined)
})

test('injectPrefs preferred planner sets order plus an exclude whitelist', () => {
  const out = injectPrefs(
    { model: 'm', messages: [] },
    'planner',
    { upstream: 'alibaba', strict: false, orderRest: ['baseten'], excludeList: ['fireworks'] },
    ['alibaba', 'baseten', 'fireworks', 'gmicloud'],
  )
  assert.deepEqual(out.providerOptions.gateway.order, ['alibaba', 'baseten'])
  assert.deepEqual(out.providerOptions.gateway.only, ['alibaba', 'baseten', 'gmicloud'])
  // Every provider the request may use has to be opted into the region.
  assert.deepEqual(out.providerOptions.gateway.inferenceRegion, {
    scope: 'zone',
    geoRegion: 'us',
    providers: { alibaba: null, baseten: null, gmicloud: null },
  })
})

test('injectPrefs direct strict maps sort to OpenRouter vocabulary', () => {
  const out = injectPrefs(
    { model: 'm', messages: [] },
    'direct',
    { upstream: 'gmicloud', strict: true, sort: 'ttft' },
  )
  assert.deepEqual(out.provider, { only: ['gmicloud'], sort: 'latency' })
  assert.equal(out.providerOptions, undefined)
})

test('injectPrefs auto mode leaves the body untouched', () => {
  const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }] }
  assert.deepEqual(injectPrefs(body, 'planner', {}), body)
  assert.notEqual(injectPrefs(body, 'planner', {}), body)
})

test('injectPrefs with unknown pipeline writes both forms', () => {
  const out = injectPrefs({ model: 'm', messages: [] }, null, { upstream: 'alibaba', strict: true })
  assert.deepEqual(out.providerOptions.gateway.only, ['alibaba'])
  assert.deepEqual(out.provider.only, ['alibaba'])
})

test('buildAttempts mirrors strict and preferred semantics', () => {
  const strict = buildAttempts({ upstreams: ['a', 'b'], exclude: ['b'], pinMode: 'strict' })
  assert.deepEqual(strict.map((attempt) => attempt.upstream), ['a'])
  assert.equal(strict[0].strict, true)

  const preferred = buildAttempts({ upstreams: ['a', 'b'], pinMode: 'preferred', sort: 'cost' })
  assert.deepEqual(preferred[0].orderRest, ['b'])
  assert.deepEqual(preferred[1].orderRest, ['a'])
  assert.equal(preferred[0].sort, 'cost')

  const auto = buildAttempts({ exclude: ['c'] })
  assert.equal(auto.length, 1)
  assert.equal(auto[0].upstream, null)
  assert.deepEqual(auto[0].excludeList, ['c'])
})

test('explicit auto mode ignores leftover pins', () => {
  const attempts = buildAttempts({ upstreams: ['a'], pinMode: 'auto' })
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].upstream, null)
})

test('strict mode without a chosen channel still reports strict', () => {
  const attempts = buildAttempts({ pinMode: 'strict' })
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].upstream, null)
  assert.equal(normalizeModelConfig({ pinMode: 'strict' }).pinMode, 'strict')
  assert.equal(normalizeModelConfig({}).pinMode, 'auto')
})

test('pinBody picks the field family from the pipeline', () => {
  assert.deepEqual(pinBody('m', 'planner', 'a').providerOptions.gateway.only, ['a'])
  assert.deepEqual(pinBody('m', 'direct', 'a').provider.only, ['a'])
  assert.deepEqual(harvestBody('m', 'planner').providerOptions.gateway.only, ['__probe__'])
  assert.deepEqual(harvestBody('m', 'direct').provider.only, ['__probe__'])
})

test('pin and harvest bodies carry the inference region when it is enabled', () => {
  const region = { scope: 'zone', geoRegion: 'us' }
  const pinned = pinBody('m', 'planner', 'deepseek', region)
  assert.deepEqual(pinned.providerOptions.gateway, {
    only: ['deepseek'],
    inferenceRegion: { scope: 'zone', geoRegion: 'us', providers: { deepseek: null } },
  })

  const harvested = harvestBody('m', 'planner', region)
  assert.deepEqual(harvested.providerOptions.gateway.inferenceRegion.providers, { __probe__: null })

  // The direct pipeline is OpenRouter: no region field exists there.
  const direct = pinBody('m', 'direct', 'wafer', region)
  assert.deepEqual(direct.provider, { only: ['wafer'] })
  assert.equal(direct.providerOptions, undefined)
})

test('normalizeRegion defaults to a US zone and rejects junk', () => {
  assert.deepEqual(normalizeRegion(), { scope: 'zone', geoRegion: 'us' })
  assert.deepEqual(normalizeRegion({ scope: 'off', geoRegion: 'eu' }), { scope: 'off', geoRegion: 'eu' })
  assert.deepEqual(normalizeRegion({ scope: 'global', geoRegion: 'not a region!' }), { scope: 'zone', geoRegion: 'us' })
  assert.deepEqual(normalizeRegion('zone'), { scope: 'zone', geoRegion: 'us' })
})

test('buildInferenceRegion only lists the providers a request may use', () => {
  assert.deepEqual(buildInferenceRegion({}, ['a', 'b', 'a']), {
    scope: 'zone', geoRegion: 'us', providers: { a: null, b: null },
  })
})

test('normalizeExtras keeps plain objects and drops everything else', () => {
  assert.deepEqual(normalizeExtras({ gateway: { a: 1 }, provider: { b: 2 } }), { gateway: { a: 1 }, provider: { b: 2 } })
  assert.deepEqual(normalizeExtras({ gateway: [1, 2], provider: 'x' }), {})
  assert.deepEqual(normalizeExtras({ gateway: { blob: 'x'.repeat(9000) } }), {})
  assert.deepEqual(normalizeExtras(null), {})
})

test('isRoutingConflict spots the refusals that cannot succeed on retry', () => {
  assert.equal(isRoutingConflict('None of the providers considered satisfy the required has conditions: free'), true)
  assert.equal(isRoutingConflict('None of the providers considered for deepseek/x support the requested inference region'), true)
  assert.equal(isRoutingConflict("No available providers match the 'only' filter: nope"), true)
  assert.equal(isRoutingConflict('429 rate limited'), false)
})


test('classifyUpstreamError separates transient from unusable channels', () => {
  assert.equal(classifyUpstreamError('429 temporarily rate limited'), 'limited')
  assert.equal(classifyUpstreamError('invalid_request_error: no allowed providers'), 'bad')
  assert.equal(classifyUpstreamError('unauthorized'), 'auth')
  assert.equal(classifyUpstreamError('empty response content'), 'ok')
  assert.equal(classifyUpstreamError('something else'), 'unknown')
})

test('extractError handles string, object, and wrapped errors', () => {
  assert.equal(extractError({ error: 'plain' }), 'plain')
  assert.equal(extractError({ data: { error: { message: 'wrapped' } } }), '{"message":"wrapped"}')
  assert.equal(extractError({ error: { metadata: { available_providers: ['a'] } } }), '{"metadata":{"available_providers":["a"]}}')
})

test('parseSSEProvider reads direct provider chunks and planner metadata', () => {
  const direct = [
    'data: {"choices":[{"delta":{"content":"OK"}}]}',
    'data: {"provider":"GMICloud","model":"z-ai/glm-5.3-flash"}',
    'data: [DONE]',
  ].join('\n')
  assert.deepEqual(parseSSEProvider(direct), { provider: 'gmicloud', canonical: 'z-ai/glm-5.3-flash', pipeline: 'direct' })

  const planner = 'data: {"provider_metadata":{"gateway":{"routing":{"finalProvider":"alibaba","canonicalSlug":"deepseek/deepseek-v4"}}}}'
  assert.deepEqual(parseSSEProvider(planner), { provider: 'alibaba', canonical: 'deepseek/deepseek-v4', pipeline: 'planner' })
})

test('resolveProviderSlug maps display names onto routing slugs', () => {
  assert.equal(resolveProviderSlug('OpenInference', ['open-inference', 'wafer']), 'open-inference')
  assert.equal(resolveProviderSlug('GMICloud', ['gmicloud']), 'gmicloud')
  assert.equal(resolveProviderSlug('Z.AI', ['z-ai']), 'z-ai')
  assert.equal(resolveProviderSlug('alibaba', ['alibaba']), 'alibaba')
  assert.equal(resolveProviderSlug('Unknown Co', ['alibaba']), 'unknown-co')
})

test('normalizeModelConfig lets exclude win and caps the list', () => {
  const cfg = normalizeModelConfig({
    upstreams: ['a', 'b', 'a', 'bad slug', ...Array.from({ length: 12 }, (_, i) => `u${i}`)],
    exclude: ['b'],
    pinMode: 'preferred',
    sort: 'tps',
  })
  assert.equal(cfg.upstreams.includes('b'), false)
  assert.equal(cfg.upstreams.length, 10)
  assert.equal(cfg.pinMode, 'preferred')
  assert.equal(cfg.sort, 'tps')
})

test('summarize counts models, channels, and pinned rows', () => {
  const summary = summarize({
    a: { upstreams: ['x', 'y'], cfg: { upstreams: ['x'] }, requests: 3 },
    b: { upstreams: [], cfg: { upstreams: [] }, errors: 1 },
  })
  assert.deepEqual(summary, { models: 2, channels: 2, pinned: 1, requests: 3, errors: 1 })
})

test('normalizeHas keeps only gateway capabilities, case-insensitively', () => {
  assert.deepEqual(
    normalizeHas(['vision', 'VISION', 'bogus', 'quantization:fp8', '!quantization:bf16']),
    ['vision', 'quantization:fp8', '!quantization:bf16'],
  )
  assert.deepEqual(normalizeHas('vision'), [])
  assert.deepEqual(normalizeHas(['free', 'free']), ['free'])
})

test('injectPrefs adds has next to only and can stand alone', () => {
  const withOnly = injectPrefs({ model: 'm' }, 'planner', {
    upstream: 'deepseek', strict: true, hasList: ['vision', 'implicit-caching'],
  })
  assert.deepEqual(withOnly.providerOptions.gateway, {
    only: ['deepseek'],
    has: ['vision', 'implicit-caching'],
    inferenceRegion: { scope: 'zone', geoRegion: 'us', providers: { deepseek: null } },
  })

  const alone = injectPrefs({ model: 'm' }, 'planner', { hasList: ['free'] })
  assert.deepEqual(alone.providerOptions.gateway, {
    has: ['free'],
    inferenceRegion: { scope: 'zone', geoRegion: 'us', providers: {} },
  })

  const empty = injectPrefs({ model: 'm' }, 'planner', { hasList: ['nope'] })
  assert.equal(empty.providerOptions, undefined)
})

test('an off region keeps the legacy body so a pin can be sent without it', () => {
  const out = injectPrefs({ model: 'm' }, 'planner', {
    upstream: 'alibaba', strict: true, region: { scope: 'off' },
  })
  assert.deepEqual(out.providerOptions.gateway, { only: ['alibaba'] })
})

test('the region carries the configured geoRegion', () => {
  const out = injectPrefs({ model: 'm' }, 'planner', {
    upstream: 'alibaba', strict: true, region: { scope: 'zone', geoRegion: 'eu' },
  })
  assert.equal(out.providerOptions.gateway.inferenceRegion.geoRegion, 'eu')
})

test('automatic requests stay untouched, but an explicit override is sent', () => {
  const body = { model: 'm', messages: [] }
  assert.deepEqual(injectPrefs(body, 'planner', { region: { scope: 'zone' } }), body)

  const overridden = injectPrefs(body, 'planner', { extras: { gateway: { sort: 'throughput' } } })
  assert.deepEqual(overridden.providerOptions.gateway, { sort: 'throughput' })
})

test('manual extras are deep-merged over the generated gateway fields', () => {
  const out = injectPrefs({ model: 'm' }, 'planner', {
    upstream: 'alibaba',
    strict: true,
    region: { scope: 'zone', geoRegion: 'us' },
    extras: {
      gateway: {
        only: ['deepseek'],
        sort: 'throughput',
        inferenceRegion: { providers: { deepseek: null, alibaba: null } },
      },
    },
  })
  const gateway = out.providerOptions.gateway
  assert.deepEqual(gateway.only, ['deepseek'])
  assert.equal(gateway.sort, 'throughput')
  assert.deepEqual(gateway.inferenceRegion.providers, { deepseek: null, alibaba: null })
})

test('manual extras may target the direct pipeline provider block', () => {
  const out = injectPrefs({ model: 'm' }, 'direct', {
    upstream: 'wafer',
    strict: true,
    extras: { provider: { require_parameters: true } },
  })
  assert.deepEqual(out.provider, { only: ['wafer'], require_parameters: true })
})

test('has is a gateway-only field', () => {
  const out = injectPrefs({ model: 'm' }, 'direct', { upstream: 'wafer', strict: true, hasList: ['vision'] })
  assert.deepEqual(out.provider, { only: ['wafer'] })
  assert.equal(out.providerOptions, undefined)
})

test('normalizeModelConfig keeps the capability filter', () => {
  assert.deepEqual(normalizeModelConfig({ has: ['vision', 'nope'] }).has, ['vision'])
  assert.deepEqual(normalizeModelConfig({}).has, [])
})

test('normalizeModelConfig persists the region and the manual override', () => {
  const cfg = normalizeModelConfig({
    region: { scope: 'off', geoRegion: 'eu' },
    extras: { gateway: { sort: 'throughput' } },
  })
  assert.deepEqual(cfg.region, { scope: 'off', geoRegion: 'eu' })
  assert.deepEqual(cfg.extras, { gateway: { sort: 'throughput' } })

  const bare = normalizeModelConfig({})
  assert.deepEqual(bare.region, { scope: 'zone', geoRegion: 'us' })
  assert.deepEqual(bare.extras, {})
})

test('buildAttempts carries the capability filter into every attempt', () => {
  const attempts = buildAttempts({ upstreams: ['a', 'b'], has: ['vision'], pinMode: 'preferred' })
  assert.equal(attempts.length, 2)
  for (const attempt of attempts) assert.deepEqual(attempt.hasList, ['vision'])
})

test('buildAttempts carries the region and the manual override into every attempt', () => {
  const attempts = buildAttempts({
    upstreams: ['a', 'b'],
    pinMode: 'strict',
    region: { scope: 'zone', geoRegion: 'eu' },
    extras: { gateway: { sort: 'throughput' } },
  })
  assert.equal(attempts.length, 2)
  for (const attempt of attempts) {
    assert.deepEqual(attempt.region, { scope: 'zone', geoRegion: 'eu' })
    assert.deepEqual(attempt.extras, { gateway: { sort: 'throughput' } })
  }
})
