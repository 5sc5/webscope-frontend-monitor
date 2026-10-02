import { gzipSync } from 'node:zlib'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createMonitor } from '../packages/monitor-sdk/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const count = 1000
const dom = new JSDOM('<!doctype html><title>Benchmark</title>', { url: 'http://localhost:5175/benchmark' })
for (const key of ['window', 'document', 'location', 'history', 'XMLHttpRequest', 'ErrorEvent', 'HTMLElement', 'Event', 'navigator']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
let requests = 0
let transported = 0
dom.window.fetch = async (_input, options) => {
  const { events } = JSON.parse(options.body)
  requests++
  transported += events.length
  return new Response(JSON.stringify({ accepted: events.length, duplicates: 0 }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}

async function run(batchSize) {
  requests = 0
  transported = 0
  const monitor = createMonitor({ appId: 'benchmark', reportUrl: '/api/events', batchSize, flushInterval: 60000, maxQueueSize: 2000 })
  monitor.start()
  await monitor.flush()
  const baseRequests = requests
  const baseTransported = transported
  const started = performance.now()
  for (let index = 0; index < count; index++) monitor.captureError(new Error(`Benchmark item ${index} failed`))
  const captureDuration = performance.now() - started
  for (let attempt = 0; monitor.getStatus().queued > 0 && attempt < count + 10; attempt++) await monitor.flush()
  const result = { events: transported - baseTransported, transportRequests: requests - baseRequests, captureTotalMs: Number(captureDuration.toFixed(2)), captureMeanMs: Number((captureDuration / count).toFixed(4)), dropped: monitor.getStatus().dropped }
  assert.equal(result.events, count)
  assert.equal(result.dropped, 0)
  monitor.destroy()
  return result
}

const individual = await run(1)
const batched = await run(10)
assert.equal(individual.transportRequests, count)
assert.equal(batched.transportRequests, count / 10)
const dist = new URL('../packages/monitor-sdk/dist/', import.meta.url)
const sizes = []
for (const name of await readdir(dist)) {
  if (!name.endsWith('.js')) continue
  const code = await readFile(new URL(name, dist))
  sizes.push({ name, bytes: code.length, gzipBytes: gzipSync(code).length })
}
const result = {
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model },
  scope: 'Node + JSDOM synthetic benchmark, in-memory acknowledged transport. Not browser Web Vitals or real network latency.',
  sdkBundle: sizes,
  batching: { individual, batched, requestReductionPercent: Number(((1 - batched.transportRequests / individual.transportRequests) * 100).toFixed(1)) },
}
await mkdir(`${root}/docs`, { recursive: true })
await writeFile(`${root}/docs/benchmark.json`, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
dom.window.close()
