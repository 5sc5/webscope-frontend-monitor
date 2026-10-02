import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { sanitizeJson, sanitizeUrl } from './privacy.js'

export const eventTypes = [
  'js-error', 'promise-error', 'resource-error', 'request', 'performance', 'behavior', 'custom-error',
] as const
export const errorTypes: string[] = ['js-error', 'promise-error', 'resource-error', 'custom-error']
export const metricThresholds = {
  LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800],
} as const

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validString(value: unknown, name: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new ApiError(400, 'INVALID_INPUT', `${name} must be a ${allowEmpty ? '' : 'non-empty '}string of at most ${maxLength} characters`)
  }
  return value
}

export function validAppId(value: unknown) {
  const appId = validString(value, 'appId', 64)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(appId)) {
    throw new ApiError(400, 'INVALID_INPUT', 'appId may contain letters, numbers, underscores and hyphens')
  }
  return appId
}

export function metricRating(name: keyof typeof metricThresholds, value: number) {
  const [good, poor] = metricThresholds[name]
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor'
}

function validateDetail(type: string, detail: Record<string, unknown>) {
  if (jsonSize(detail) > 16384) throw new ApiError(400, 'INVALID_INPUT', 'Event detail exceeds 16 KB')
  if (type === 'request') {
    if (typeof detail.duration !== 'number' || !Number.isFinite(detail.duration) || detail.duration < 0 ||
        typeof detail.status !== 'number' || !Number.isInteger(detail.status) || detail.status < 0 || detail.status > 599) {
      throw new ApiError(400, 'INVALID_INPUT', 'Request detail requires a non-negative duration and status 0-599')
    }
    if (detail.method !== undefined) validString(detail.method, 'detail.method', 16)
    if (detail.url !== undefined) validString(detail.url, 'detail.url', 2048)
  }
  if (type === 'performance') {
    if (typeof detail.name !== 'string' || !Object.hasOwn(metricThresholds, detail.name) ||
        typeof detail.value !== 'number' || !Number.isFinite(detail.value) || detail.value < 0) {
      throw new ApiError(400, 'INVALID_INPUT', 'Performance detail requires a supported Web Vital and a non-negative value')
    }
    detail.rating = metricRating(detail.name as keyof typeof metricThresholds, detail.value)
    detail.unit = detail.name === 'CLS' ? '' : 'ms'
  }
}

function jsonSize(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    throw new ApiError(400, 'INVALID_INPUT', 'Event JSON is too deeply nested or cannot be serialized')
  }
}

export function errorFingerprint(type: string, message: string, detail: Record<string, unknown>, appId = '') {
  const normalized = message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b0x[\da-f]+\b/gi, '<address>')
    .replace(/\b\d{3,}\b/g, '<number>')
  const stackFrame = typeof detail.stack === 'string'
    ? detail.stack.split('\n').find(line => /^\s*at\s|@.*:\d/.test(line))?.trim() ?? ''
    : ''
  const location = stackFrame || [detail.filename ?? '', detail.lineno ?? '', detail.colno ?? ''].join(':')
  return createHash('sha256').update(`${appId}\n${type}\n${normalized}\n${location}`).digest('hex').slice(0, 24)
}

export function validateEvent(value: unknown, appId: string): Prisma.MonitorEventCreateManyInput {
  if (!isRecord(value)) throw new ApiError(400, 'INVALID_INPUT', 'Every event must be an object')
  const id = validString(value.id, 'event.id', 128)
  if (value.appId !== undefined && value.appId !== appId) throw new ApiError(400, 'INVALID_INPUT', 'Event appId must match batch appId')
  const sessionId = validString(value.sessionId, 'sessionId', 128)
  const type = validString(value.type, 'type', 32)
  if (!eventTypes.includes(type as typeof eventTypes[number])) throw new ApiError(400, 'INVALID_INPUT', 'Unsupported event type')
  const message = validString(value.message, 'message', 2000, true)
  const url = sanitizeUrl(validString(value.url, 'url', 2048, true))
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp) ||
      value.timestamp < 946684800000 || value.timestamp > Date.now() + 300000) {
    throw new ApiError(400, 'INVALID_INPUT', 'timestamp must be epoch milliseconds from year 2000 to five minutes in the future')
  }
  const rawDetail = value.detail ?? {}
  if (!isRecord(rawDetail)) throw new ApiError(400, 'INVALID_INPUT', 'detail must be an object')
  validateDetail(type, rawDetail)
  const rawBreadcrumbs = value.breadcrumbs ?? []
  if (!Array.isArray(rawBreadcrumbs) || rawBreadcrumbs.length > 50 || rawBreadcrumbs.some(item => !isRecord(item)) ||
      jsonSize(rawBreadcrumbs) > 16384) {
    throw new ApiError(400, 'INVALID_INPUT', 'breadcrumbs must contain at most 50 objects and 16 KB')
  }
  const detail = sanitizeJson(rawDetail) as Prisma.InputJsonObject
  const breadcrumbs = sanitizeJson(rawBreadcrumbs) as Prisma.InputJsonArray
  return {
    id, appId, sessionId, type, message, url, timestamp: new Date(value.timestamp), detail, breadcrumbs,
    issueId: errorTypes.includes(type) ? errorFingerprint(type, message, detail as Record<string, unknown>, appId) : null,
  }
}
