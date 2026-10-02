import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PrismaClient } from '@prisma/client'
import { createApp } from '../src/app.js'
import { createDatabase, seedApplications } from '../src/database.js'
import { errorFingerprint } from '../src/events.js'

const require = createRequire(import.meta.url)
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let temporaryDirectory: string
let databaseUrl: string
let database: PrismaClient
let server: Server
let baseUrl: string

async function request(path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() as any }
}

function event(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, appId: 'playground', sessionId: 'test-session', type: 'js-error', message: 'Cannot read properties of undefined',
    url: 'http://localhost:5173/editor', timestamp: Date.now() - 60000,
    detail: { stack: 'TypeError: Cannot read properties of undefined\n    at edit (http://localhost:5173/editor.js:10:2)' },
    breadcrumbs: [], ...extra,
  }
}

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'webscope-api-'))
  databaseUrl = `file:${join(temporaryDirectory, 'test.db').replaceAll('\\', '/')}`
  const prismaCli = require.resolve('prisma/build/index.js')
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--schema', join(packageDirectory, 'prisma/schema.prisma'), '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'info' }, stdio: 'pipe',
  })
  database = createDatabase(databaseUrl)
  await seedApplications(database)
  server = createApp(database).listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (database) await database.$disconnect()
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('WebScope API', () => {
  test('registers only applications, with useful empty overview and no fake events', async () => {
    const applications = await request('/api/applications')
    assert.equal(applications.status, 200)
    assert.deepEqual(applications.body.map((item: any) => item.appId).sort(), ['playground', 'survey-platform'])
    const overview = await request('/api/overview?appId=playground')
    assert.equal(overview.body.totalEvents, 0)
    assert.equal(overview.body.errorRate, 0)
    assert.equal(overview.body.performance.length, 5)
    assert.ok(overview.body.performance.every((item: any) => item.p75 === null && item.samples === 0))
    assert.equal((await request('/api/applications', { appId: 'new-app', name: '测试项目' })).status, 201)
    assert.equal((await request('/api/applications', { appId: 'new-app', name: 'Duplicate' })).status, 409)
    assert.equal((await request('/api/applications', { appId: '../bad', name: 'Invalid' })).status, 400)
  })

  test('atomically validates, deduplicates batches and supports retry races', async () => {
    assert.equal((await request('/api/events', { appId: 'unknown', events: [event('unknown')] })).status, 404)
    assert.equal((await request('/api/events', { appId: 'playground', events: [] })).status, 400)
    assert.equal((await request('/api/events', { appId: 'playground', events: [event('atomic-good'), event('bad-type', { type: 'other' })] })).status, 400)
    assert.equal(await database.monitorEvent.count({ where: { id: 'atomic-good' } }), 0)
    assert.equal((await request('/api/events', { appId: 'playground', events: [event('bad-app', { appId: 'survey-platform' })] })).status, 400)
    assert.equal((await request('/api/events', { appId: 'playground', events: [event('future', { timestamp: Date.now() + 600000 })] })).status, 400)
    assert.equal((await request('/api/events', { appId: 'playground', events: [event('bad-metric', { type: 'performance', detail: { name: 'constructor', value: 1 } })] })).status, 400)
    const first = await request('/api/events', { appId: 'playground', events: [event('dedup'), event('dedup')] })
    assert.deepEqual(first.body, { accepted: 1, duplicates: 1 })
    const repeated = await request('/api/events', { appId: 'playground', events: [event('dedup')] })
    assert.deepEqual(repeated.body, { accepted: 0, duplicates: 1 })
    const parallel = await Promise.all(Array.from({ length: 3 }, () => request('/api/events', { appId: 'playground', events: [event('concurrent')] })))
    assert.equal(parallel.reduce((sum, item) => sum + item.body.accepted, 0), 1)
    assert.equal(await database.monitorEvent.count({ where: { id: 'concurrent' } }), 1)
  })

  test('scrubs sensitive nested fields, breadcrumb fields and query parameters', async () => {
    const result = await request('/api/events', {
      appId: 'playground', events: [event('privacy', {
        url: 'http://localhost/editor?token=private&view=edit#secret',
        detail: { password: 'secret', nested: { Authorization: 'Bearer token', okay: 42 }, url: '/api/save?apiKey=secret&mode=fast' },
        breadcrumbs: [{ category: 'request', data: { accessToken: 'secret', url: '/form?password=secret' } }],
      })],
    })
    assert.equal(result.status, 201)
    const saved = (await request('/api/events/privacy')).body
    assert.equal(new URL(saved.url).searchParams.get('token'), '[REDACTED]')
    assert.equal(new URL(saved.url).hash, '')
    assert.equal(saved.detail.password, '[REDACTED]')
    assert.equal(saved.detail.nested.Authorization, '[REDACTED]')
    assert.equal(saved.detail.nested.okay, 42)
    assert.equal(saved.breadcrumbs[0].data.accessToken, '[REDACTED]')
    assert.ok(!JSON.stringify(saved).includes('Bearer token'))
  })

  test('calculates nearest-rank P75, request failure rate, slow requests and hourly trends', async () => {
    const now = Date.now() - 10000
    const events = [
      ...[1000, 2000, 3000, 5000].map((value, index) => event(`metric-${index}`, { type: 'performance', timestamp: now, detail: { name: 'LCP', value } })),
      event('request-ok', { type: 'request', timestamp: now, detail: { status: 200, duration: 1200, method: 'GET' } }),
      event('request-failed', { type: 'request', timestamp: now, detail: { status: 500, duration: 25, method: 'GET' } }),
      event('overview-error', { timestamp: now }),
    ]
    assert.equal((await request('/api/events', { appId: 'playground', events })).body.accepted, 7)
    const overview = (await request(`/api/overview?appId=playground&from=${now - 1}&to=${now + 1}`)).body
    assert.equal(overview.totalEvents, 7)
    assert.equal(overview.errorCount, 1)
    assert.equal(overview.requestCount, 2)
    assert.equal(overview.failedRequestCount, 1)
    assert.equal(overview.errorRate, 50)
    assert.equal(overview.slowRequestCount, 1)
    const lcp = overview.performance.find((item: any) => item.name === 'LCP')
    assert.deepEqual(lcp, { name: 'LCP', p75: 3000, samples: 4, rating: 'needs-improvement' })
    assert.equal(overview.trend.reduce((sum: number, item: any) => sum + item.errors, 0), 1)
    assert.equal(overview.trend.reduce((sum: number, item: any) => sum + item.requests, 0), 2)
    assert.equal(overview.byType.reduce((sum: number, item: any) => sum + item.count, 0), 7)
  })

  test('filters and paginates occurrences and groups normalized errors per application', async () => {
    const now = Date.now() - 5000
    await request('/api/events', { appId: 'playground', events: [
      event('issue-1', { message: 'Failed user 12345', timestamp: now }),
      event('issue-2', { message: 'Failed user 67890', timestamp: now + 1 }),
      event('different-issue', { message: 'Different failure', timestamp: now + 2 }),
    ] })
    const issues = (await request('/api/issues?appId=playground&keyword=Failed%20user')).body
    assert.equal(issues.total, 1)
    assert.equal(issues.items[0].count, 2)
    assert.equal(issues.items[0].firstSeen, now)
    assert.equal(issues.items[0].lastSeen, now + 1)
    const occurrences = (await request(`/api/events?appId=playground&issueId=${issues.items[0].id}&page=1&pageSize=1`)).body
    assert.equal(occurrences.total, 2)
    assert.equal(occurrences.items.length, 1)
    assert.equal(occurrences.items[0].id, 'issue-2')
    assert.equal((await request(`/api/events?appId=playground&from=${now}&to=${now + 2}`)).body.total, 3)
    assert.equal((await request('/api/events?pageSize=101')).status, 400)
    assert.equal((await request('/api/events?from=bad')).status, 400)
    assert.equal((await request('/api/events?from=2000&to=1000')).status, 400)
    assert.equal((await request('/api/events?appId=missing')).status, 404)
    const detail = { stack: 'Error\n at run (main.js:2:1)' }
    assert.notEqual(errorFingerprint('js-error', 'Invalid', detail, 'app-a'), errorFingerprint('js-error', 'Invalid', detail, 'app-b'))
    assert.notEqual(errorFingerprint('js-error', 'Failed user', detail), errorFingerprint('js-error', 'Other error', detail))
  })

  test('bounds batches and payload sizes; returns structured errors', async () => {
    assert.equal((await request('/api/events', { appId: 'playground', events: Array.from({ length: 101 }, (_, index) => event(`large-${index}`)) })).status, 400)
    assert.equal((await request('/api/events', { appId: 'playground', events: [event('large-detail', { detail: { data: 'x'.repeat(17000) } })] })).status, 400)
    assert.equal((await request('/api/events', { appId: 'playground', data: 'x'.repeat(270000) })).status, 413)
    const malformed = await fetch(`${baseUrl}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{wrong' })
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json()).error.code, 'INVALID_JSON')
    assert.equal((await request('/api/not-found')).status, 404)
    assert.equal((await request('/api/not-found')).body.error.code, 'NOT_FOUND')
    assert.equal((await request('/api/events/missing-event')).status, 404)
    const wrongMethod = await fetch(`${baseUrl}/api/health`, { method: 'POST' })
    assert.equal(wrongMethod.status, 405)
    assert.equal((await wrongMethod.json()).error.code, 'METHOD_NOT_ALLOWED')
    const remoteOrigin = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'https://example.com' } })
    assert.equal(remoteOrigin.status, 403)
    const localOrigin = await fetch(`${baseUrl}/api/health`, { headers: { Origin: 'http://localhost:5173' } })
    assert.equal(localOrigin.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  })

  test('persists events across a new database client and provides real request test endpoints', async () => {
    const reopened = createDatabase(databaseUrl)
    try {
      assert.equal((await reopened.monitorEvent.findUnique({ where: { id: 'dedup' } }))?.id, 'dedup')
    } finally { await reopened.$disconnect() }
    assert.equal((await request('/api/test/success')).status, 200)
    assert.equal((await request('/api/test/failure')).status, 500)
    const start = performance.now()
    assert.equal((await request('/api/test/slow')).status, 200)
    assert.ok(performance.now() - start >= 1100)
  })
})
