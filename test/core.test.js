import test from 'node:test'
import assert from 'node:assert/strict'
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

test('injectPrefs strict planner sets providerOptions.gateway.only', () => {
  const out = injectPrefs(
    { model: 'm', messages: [], providerOptions: { gateway: { sort: 'cost' } } },
    'planner',
    { upstream: 'alibaba', strict: true },
  )
  assert.deepEqual(out.providerOptions, { gateway: { sort: 'cost', only: ['alibaba'] } })
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
