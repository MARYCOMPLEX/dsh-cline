// Print the exact body the interceptor sends for each pin mode.
import { buildAttempts, injectPrefs } from '../core.js'

const model = 'cline-pass/deepseek-v4.1-flash-1017'
const original = {
  model,
  messages: [{ role: 'user', content: 'hi' }],
  stream: true,
  stream_options: { include_usage: true },
}

function show(title, cfg, pipeline, known = ['alibaba', 'baseten', 'deepinfra', 'fireworks']) {
  const attempts = buildAttempts(cfg)
  console.log(`\n### ${title}`)
  console.log(`pipeline=${pipeline} cfg=${JSON.stringify(cfg)}`)
  for (const [index, attempt] of attempts.entries()) {
    const body = injectPrefs(original, pipeline, attempt, known)
    const delta = {}
    for (const key of Object.keys(body)) {
      if (JSON.stringify(body[key]) !== JSON.stringify(original[key])) delta[key] = body[key]
    }
    console.log(`  attempt ${index + 1} -> +${JSON.stringify(delta)}`)
  }
}

show('strict pin on planner', { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null }, 'planner')
show('preferred fallback on planner', { upstreams: ['baseten', 'alibaba'], exclude: ['deepinfra'], pinMode: 'preferred', sort: 'cost' }, 'planner')
show('strict pin on direct (OpenRouter)', { upstreams: ['wafer'], exclude: [], pinMode: 'strict', sort: null }, 'direct')
show('auto with exclusions on planner', { upstreams: [], exclude: ['fireworks', 'deepinfra'], pinMode: 'auto', sort: 'ttft' }, 'planner')
show('strict pin with unknown pipeline', { upstreams: ['alibaba'], exclude: [], pinMode: 'strict', sort: null }, null)

console.log('\n### untouched request (model without the cline-pass/ prefix, or another host)')
console.log(JSON.stringify(original))
