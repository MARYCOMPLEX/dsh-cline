// Inspect the direct-pipeline harvest error shape.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { harvestBody, parseRouting } from '../core.js'

const model = process.argv[2] || 'cline-pass/glm-5.3-flash'
const gateway = 'https://api.cline.bot/api/v1'
const key = (() => {
  const text = fs.readFileSync(path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.credentials.yaml'), 'utf8')
  const match = /^\s*CLINE_API_KEY:\s*(.+?)\s*$/m.exec(text)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
})()

async function post(body) {
  const response = await fetch(`${gateway}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })
  return { status: response.status, text: await response.text() }
}

const probe = await post({ model, messages: [{ role: 'user', content: 'Reply with the word OK' }], max_tokens: 32 })
console.log('probe status', probe.status)
console.log(probe.text.slice(0, 1200))
let json = null
try { json = JSON.parse(probe.text) } catch {}
const routing = parseRouting(json)
console.log('routing', JSON.stringify(routing, null, 2).slice(0, 800))

const harvest = await post(harvestBody(model, 'direct'))
console.log('\nharvest status', harvest.status)
console.log(harvest.text.slice(0, 2000))