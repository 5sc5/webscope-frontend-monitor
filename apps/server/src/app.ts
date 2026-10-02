import Koa from 'koa'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
import type { MonitorEvent, Prisma, PrismaClient } from '@prisma/client'
import {
  ApiError, errorTypes, eventTypes, isRecord, metricRating, metricThresholds, validateEvent, validAppId, validString,
} from './events.js'

function serializeEvent(event: MonitorEvent) {
  return { ...event, timestamp: event.timestamp.getTime(), createdAt: event.createdAt.toISOString() }
}

function dateParameter(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value) throw new ApiError(400, 'INVALID_INPUT', `${name} must be an ISO date or epoch milliseconds`)
  const date = new Date(/^\d+$/.test(value) ? Number(value) : value)
  if (!Number.isFinite(date.getTime())) throw new ApiError(400, 'INVALID_INPUT', `${name} is not a valid date`)
  return date
}

function pagination(query: Koa.Context['query']) {
  function integer(value: unknown, name: string, fallback: number, maximum: number) {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) {
      throw new ApiError(400, 'INVALID_INPUT', `${name} must be an integer between 1 and ${maximum}`)
    }
    return Number(value)
  }
  const page = integer(query.page, 'page', 1, 100000)
  const pageSize = integer(query.pageSize, 'pageSize', 20, 100)
  return { page, pageSize, skip: (page - 1) * pageSize }
}

async function eventFilter(database: PrismaClient, query: Koa.Context['query']) {
  const where: Prisma.MonitorEventWhereInput = {}
  if (query.appId !== undefined) {
    where.appId = validAppId(query.appId)
    if (!await database.application.findUnique({ where: { appId: where.appId } })) {
      throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Application was not found')
    }
  }
  if (query.type !== undefined) {
    const type = validString(query.type, 'type', 32)
    if (!eventTypes.includes(type as typeof eventTypes[number])) throw new ApiError(400, 'INVALID_INPUT', 'Unsupported event type filter')
    where.type = type
  }
  if (query.issueId !== undefined) where.issueId = validString(query.issueId, 'issueId', 128)
  if (query.keyword !== undefined) {
    const keyword = validString(query.keyword, 'keyword', 200, true).trim()
    if (keyword) where.OR = [{ message: { contains: keyword } }, { url: { contains: keyword } }]
  }
  const from = dateParameter(query.from, 'from')
  const to = dateParameter(query.to, 'to')
  if (from && to && from > to) throw new ApiError(400, 'INVALID_INPUT', 'from must be earlier than or equal to to')
  if (from || to) where.timestamp = { ...(from && { gte: from }), ...(to && { lte: to }) }
  return { where, from, to }
}

function failedRequest(event: MonitorEvent) {
  const detail = event.detail as Record<string, unknown>
  return detail.status === 0 || typeof detail.status === 'number' && detail.status >= 400
}

function performanceOverview(events: MonitorEvent[]) {
  return Object.keys(metricThresholds).map(name => {
    const values = events
      .filter(event => event.type === 'performance' && (event.detail as Record<string, unknown>).name === name)
      .map(event => (event.detail as Record<string, unknown>).value as number)
      .sort((a, b) => a - b)
    const p75 = values.length ? values[Math.ceil(values.length * 0.75) - 1]! : null
    return {
      name, p75, samples: values.length,
      rating: p75 === null ? null : metricRating(name as keyof typeof metricThresholds, p75),
    }
  })
}

function eventTrend(events: MonitorEvent[], from: Date, to: Date) {
  const span = to.getTime() - from.getTime()
  const hour = 60 * 60 * 1000
  const interval = span <= 48 * hour ? hour : span <= 90 * 24 * hour ? 24 * hour : Math.ceil(span / (90 * hour)) * hour
  const start = Math.floor(from.getTime() / interval) * interval
  const bins = new Map<number, { time: string; errors: number; requests: number }>()
  for (let time = start; time <= to.getTime(); time += interval) {
    bins.set(time, { time: new Date(time).toISOString(), errors: 0, requests: 0 })
  }
  for (const event of events) {
    const bin = bins.get(Math.floor(event.timestamp.getTime() / interval) * interval)
    if (!bin) continue
    if (errorTypes.includes(event.type)) bin.errors++
    if (event.type === 'request') bin.requests++
  }
  return [...bins.values()]
}

export function createApp(database: PrismaClient) {
  const app = new Koa()
  const router = new Router()
  let ingestionTail = Promise.resolve()

  app.use(async (ctx, next) => {
    try {
      await next()
      if (ctx.status === 404 && ctx.body === undefined) {
        ctx.status = 404
        ctx.body = { error: { code: 'NOT_FOUND', message: 'API route was not found' } }
      } else if (ctx.status === 405) {
        ctx.body = { error: { code: 'METHOD_NOT_ALLOWED', message: 'HTTP method is not supported for this route' } }
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status
        : isRecord(error) && typeof error.status === 'number' ? error.status : 500
      ctx.status = status
      ctx.body = {
        error: {
          code: error instanceof ApiError ? error.code : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR',
          message: error instanceof ApiError ? error.message : status === 413 ? 'Request body exceeds 256 KB' : status === 400 ? 'Request body must be valid JSON' : 'An unexpected server error occurred',
        },
      }
      if (status >= 500) app.emit('error', error, ctx)
    }
  })

  app.use(async (ctx, next) => {
    const origin = ctx.get('Origin')
    if (origin) {
      let allowed = false
      try {
        const url = new URL(origin)
        allowed = ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      } catch { /* Invalid origins are rejected below. */ }
      if (!allowed) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Only local development origins are allowed')
      ctx.set('Access-Control-Allow-Origin', origin)
      ctx.vary('Origin')
      ctx.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      ctx.set('Access-Control-Allow-Headers', 'Content-Type')
    }
    if (ctx.method === 'OPTIONS') { ctx.status = 204; return }
    await next()
  })
  app.use(bodyParser({ enableTypes: ['json'], jsonLimit: '256kb' }))

  router.get('/api/health', ctx => { ctx.body = { status: 'ok' } })
  router.get('/api/applications', async ctx => {
    ctx.body = await database.application.findMany({ orderBy: { createdAt: 'asc' } })
  })
  router.post('/api/applications', async ctx => {
    if (!isRecord(ctx.request.body)) throw new ApiError(400, 'INVALID_INPUT', 'Application must be an object')
    const appId = validAppId(ctx.request.body.appId)
    const name = validString(ctx.request.body.name, 'name', 100).trim()
    if (await database.application.findUnique({ where: { appId } })) throw new ApiError(409, 'APPLICATION_EXISTS', 'Application appId already exists')
    try {
      ctx.body = await database.application.create({ data: { appId, name } })
    } catch (error) {
      if (isRecord(error) && error.code === 'P2002') throw new ApiError(409, 'APPLICATION_EXISTS', 'Application appId already exists')
      throw error
    }
    ctx.status = 201
  })

  router.post('/api/events', async ctx => {
    const body = ctx.request.body
    if (!isRecord(body)) throw new ApiError(400, 'INVALID_INPUT', 'Batch must be an object')
    const appId = validAppId(body.appId)
    if (!Array.isArray(body.events) || body.events.length < 1 || body.events.length > 100) {
      throw new ApiError(400, 'INVALID_INPUT', 'Batch must contain between 1 and 100 events')
    }
    if (!await database.application.findUnique({ where: { appId } })) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Register the application before reporting events')
    const events = body.events.map(event => validateEvent(event, appId))
    // Serialize SQLite ingestion so retries racing within this process stay idempotent.
    const result = ingestionTail.then(() => database.$transaction(async transaction => {
      const existing = await transaction.monitorEvent.findMany({
        where: { id: { in: events.map(event => event.id) } }, select: { id: true },
      })
      const seen = new Set(existing.map(event => event.id))
      const fresh = events.filter(event => {
        if (seen.has(event.id)) return false
        seen.add(event.id)
        return true
      })
      if (fresh.length) await transaction.monitorEvent.createMany({ data: fresh })
      return { accepted: fresh.length, duplicates: events.length - fresh.length }
    }))
    ingestionTail = result.then(() => undefined, () => undefined)
    ctx.body = await result
    ctx.status = (ctx.body as { accepted: number }).accepted ? 201 : 200
  })

  router.get('/api/events', async ctx => {
    const { where } = await eventFilter(database, ctx.query)
    const { page, pageSize, skip } = pagination(ctx.query)
    const [events, total] = await database.$transaction([
      database.monitorEvent.findMany({ where, orderBy: [{ timestamp: 'desc' }, { id: 'asc' }], skip, take: pageSize }),
      database.monitorEvent.count({ where }),
    ])
    ctx.body = { items: events.map(serializeEvent), total, page, pageSize }
  })
  router.get('/api/events/:id', async ctx => {
    const event = await database.monitorEvent.findUnique({ where: { id: ctx.params.id } })
    if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', 'Event was not found')
    ctx.body = serializeEvent(event)
  })

  router.get('/api/overview', async ctx => {
    const filter = await eventFilter(database, ctx.query)
    const to = filter.to ?? new Date()
    const from = filter.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000)
    if (from > to) throw new ApiError(400, 'INVALID_INPUT', 'from must be earlier than or equal to to')
    const events = await database.monitorEvent.findMany({ where: { ...filter.where, timestamp: { gte: from, lte: to } } })
    const requests = events.filter(event => event.type === 'request')
    const failedRequestCount = requests.filter(failedRequest).length
    ctx.body = {
      totalEvents: events.length,
      errorCount: events.filter(event => errorTypes.includes(event.type)).length,
      requestCount: requests.length,
      failedRequestCount,
      errorRate: requests.length ? Number((failedRequestCount / requests.length * 100).toFixed(2)) : 0,
      slowRequestCount: requests.filter(event => Number((event.detail as Record<string, unknown>).duration) > 1000).length,
      performance: performanceOverview(events),
      trend: eventTrend(events, from, to),
      byType: eventTypes.map(type => ({ type, count: events.filter(event => event.type === type).length })),
    }
  })

  router.get('/api/issues', async ctx => {
    const { where } = await eventFilter(database, ctx.query)
    const { page, pageSize, skip } = pagination(ctx.query)
    const events = await database.monitorEvent.findMany({
      where: { ...where, type: { in: errorTypes }, issueId: { not: null } }, orderBy: { timestamp: 'asc' },
    })
    const issues = new Map<string, { id: string; fingerprint: string; message: string; type: string; count: number; firstSeen: number; lastSeen: number; url: string }>()
    for (const event of events) {
      const id = event.issueId!
      const issue = issues.get(id)
      if (issue) {
        issue.count++
        issue.lastSeen = event.timestamp.getTime()
        issue.message = event.message
        issue.url = event.url
      } else {
        issues.set(id, { id, fingerprint: id, message: event.message, type: event.type, count: 1, firstSeen: event.timestamp.getTime(), lastSeen: event.timestamp.getTime(), url: event.url })
      }
    }
    const items = [...issues.values()].sort((a, b) => b.lastSeen - a.lastSeen)
    ctx.body = { items: items.slice(skip, skip + pageSize), total: items.length, page, pageSize }
  })

  router.get('/api/test/success', ctx => { ctx.body = { ok: true, message: 'A real successful request' } })
  router.get('/api/test/failure', ctx => {
    ctx.status = 500
    ctx.body = { error: { code: 'DEMO_FAILURE', message: 'An intentional HTTP 500 for SDK verification' } }
  })
  router.get('/api/test/slow', async ctx => {
    await new Promise(resolve => setTimeout(resolve, 1200))
    ctx.body = { ok: true, delay: 1200 }
  })

  app.use(router.routes())
  app.use(router.allowedMethods())
  return app
}
