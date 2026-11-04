// Confirm "Probe channels" now enumerates the public pool with the region on.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { harvestBody, parseAvailableProviders } from '../core.js'

const model = process.argv[2] || 'cline-pass/deepseek-v4.1-flash-1017'
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const key = /^\s*CLINE_API_KEY:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(home, '.credentials.yaml'), 'utf8'))[1]
  .trim().replace(/^["']|["']$/g, '')
const region = { scope: 'zone', geoRegion: 'us' }

for (const pipeline of ['planner']) {
  const response = await fetch('https://api.cline.bot/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-dsh-cline-internal': '1' },
    body: JSON.stringify(harvestBody(model, pipeline, region)),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  const list = parseAvailableProviders(json ?? text, pipeline)
  console.log(pipeline, 'status', response.status, 'count', list.length)
  console.log(list.join(', '))
  console.log('includes wafer:', list.includes('wafer'), '| includes deepseek:', list.includes('deepseek'))
}
