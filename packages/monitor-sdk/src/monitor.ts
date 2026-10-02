import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'
import { describeError, sanitize, sanitizeText, sanitizeUrl } from './privacy'
import type { Breadcrumb, EventType, MonitorEvent, MonitorOptions, MonitorStatus } from './types'

type QueueEntry = { event: MonitorEvent; attempts: number; nextAttemptAt: number }
type RequestInfo = { method: string; url: string }
type XhrState = RequestInfo & { listener?: EventListener }
const maxReportBytes = 60_000

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value!) : fallback
}

function makeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export class Monitor {
  private readonly options: Required<Omit<MonitorOptions, 'onStatus'>>
  private readonly sessionId = makeId()
  private readonly subscribers = new Set<(status: MonitorStatus) => void>()
  private readonly cleanups: Array<() => void> = []
  private readonly breadcrumbs: Breadcrumb[] = []
  private queue: QueueEntry[] = []
  private inFlightEntries: QueueEntry[] = []
  private inFlight: Promise<void> | null = null
  private draining: Promise<void> | null = null
  private timer?: ReturnType<typeof setInterval>
  private retryTimer?: ReturnType<typeof setTimeout>
  private rawFetch?: typeof fetch
  private active = false
  private vitalsRegistered = false
  private sent = 0
  private failed = 0
  private dropped = 0
  private beaconQueued = 0
  private requests = 0

  constructor(options: MonitorOptions) {
    if (!options.appId?.trim() || !options.reportUrl?.trim()) {
      throw new Error('Monitor requires appId and reportUrl')
    }
    this.options = {
      appId: options.appId,
      reportUrl: options.reportUrl,
      batchSize: Math.min(100, positiveInteger(options.batchSize, 10)),
      flushInterval: positiveInteger(options.flushInterval, 5000),
      maxQueueSize: positiveInteger(options.maxQueueSize, 100),
      maxRetries: Number.isFinite(options.maxRetries) ? Math.max(0, Math.min(10, Math.floor(options.maxRetries!))) : 3,
      breadcrumbLimit: Math.min(100, positiveInteger(options.breadcrumbLimit, 20)),
      sampleRate: Number.isFinite(options.sampleRate) ? Math.max(0, Math.min(1, options.sampleRate!)) : 1,
    }
    if (options.onStatus) this.subscribers.add(options.onStatus)
  }

  start(): this {
    if (this.active || typeof window === 'undefined') return this
    this.active = true
    this.rawFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined
    this.safe(() => this.installErrors())
    this.safe(() => this.installFetch())
    this.safe(() => this.installXhr())
    this.safe(() => this.installBreadcrumbs())
    this.safe(() => this.installVitals())
    this.listen(window, 'pagehide', () => this.flushOnHide())
    this.listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushOnHide()
      else {
        for (const entry of this.queue) entry.nextAttemptAt = Math.min(entry.nextAttemptAt, Date.now())
        void this.flush()
      }
    })
    this.timer = setInterval(() => void this.flush(), this.options.flushInterval)
    this.track('Page view', { kind: 'page-view' })
    this.notify()
    return this
  }

  destroy(): void {
    this.active = false
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.timer = undefined
    this.retryTimer = undefined
    for (const cleanup of this.cleanups.splice(0).reverse()) this.safe(cleanup)
    this.notify()
  }

  getStatus(): MonitorStatus {
    return {
      active: this.active,
      queued: this.queue.length + this.inFlightEntries.length,
      sent: this.sent,
      failed: this.failed,
      dropped: this.dropped,
      beaconQueued: this.beaconQueued,
      requests: this.requests,
    }
  }

  subscribe(listener: (status: MonitorStatus) => void): () => void {
    this.subscribers.add(listener)
    this.safe(() => listener(this.getStatus()))
    return () => { this.subscribers.delete(listener) }
  }

  captureError(error: unknown, detail: Record<string, unknown> = {}): void {
    this.safe(() => {
      const described = describeError(error)
      this.captureEvent('custom-error', described.message, { ...described.detail, ...detail })
    })
  }

  track(message: string, detail: Record<string, unknown> = {}): void {
    this.captureEvent('behavior', message, detail)
  }

  captureEvent(type: EventType, message: string, detail: Record<string, unknown> = {}): void {
    if (!this.active) return
    this.safe(() => {
      if (Math.random() >= this.options.sampleRate) {
        this.dropped++
        this.notify()
        return
      }
      if (this.queue.length + this.inFlightEntries.length >= this.options.maxQueueSize) {
        if (this.queue.length) this.queue.shift()
        else {
          this.dropped++
          this.notify()
          return
        }
        this.dropped++
      }
      let sanitizedDetail = sanitize(detail) as Record<string, unknown>
      const detailJson = JSON.stringify(sanitizedDetail)
      if (new Blob([detailJson]).size > 14_000) {
        sanitizedDetail = { truncated: true, preview: detailJson.slice(0, 3000) }
      }
      this.queue.push({
        event: {
          id: makeId(),
          appId: this.options.appId,
          sessionId: this.sessionId,
          type,
          message: sanitizeText(message),
          url: sanitizeUrl(window.location.href),
          timestamp: Date.now(),
          detail: sanitizedDetail,
          breadcrumbs: sanitize(this.breadcrumbs) as Breadcrumb[],
        },
        attempts: 0,
        nextAttemptAt: 0,
      })
      this.notify()
      if (this.queue.filter(entry => entry.nextAttemptAt <= Date.now()).length >= this.options.batchSize) {
        void this.flush()
      }
    })
  }

  flush(): Promise<void> {
    if (this.draining) return this.draining
    if (!this.active || !this.rawFetch) return Promise.resolve()
    this.draining = (async () => {
      do {
        await this.flushBatch(false)
      } while (this.active && this.queue.some(entry => entry.nextAttemptAt <= Date.now()))
    })().finally(() => { this.draining = null })
    return this.draining
  }

  private flushBatch(keepalive: boolean): Promise<void> {
    if (this.inFlight) return this.inFlight
    if (!this.active || !this.rawFetch || !this.queue.length) return Promise.resolve()
    const batch = this.takeBatch()
    if (!batch.length) {
      this.scheduleRetry()
      return Promise.resolve()
    }
    this.inFlightEntries = batch
    this.notify()
    const payload = JSON.stringify({ appId: this.options.appId, events: batch.map(entry => entry.event) })
    this.inFlight = (async () => {
      let permanentFailure = false
      try {
        this.requests++
        const response = await this.rawFetch!(this.options.reportUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: payload,
          keepalive,
        })
        permanentFailure = response.status >= 400 && response.status < 500 && response.status !== 429
        if (!response.ok) throw new Error(`Report rejected: ${response.status}`)
        const ack = await response.json() as { accepted?: number; duplicates?: number }
        if (typeof ack.accepted !== 'number' || typeof ack.duplicates !== 'number'
          || ack.accepted + ack.duplicates !== batch.length) {
          throw new Error('Report acknowledgement does not match the batch')
        }
        this.sent += batch.length
      } catch {
        this.failed += batch.length
        for (const entry of batch) {
          entry.attempts++
          if (!permanentFailure && entry.attempts <= this.options.maxRetries) {
            entry.nextAttemptAt = Date.now() + Math.min(1000 * 2 ** (entry.attempts - 1), 30_000)
            this.queue.push(entry)
          } else this.dropped++
        }
      } finally {
        this.inFlightEntries = []
        this.notify()
      }
    })().finally(() => {
      this.inFlight = null
      if (!this.active) return
      this.scheduleRetry()
    })
    return this.inFlight
  }

  private takeBatch(): QueueEntry[] {
    const batch: QueueEntry[] = []
    const retained: QueueEntry[] = []
    let bytes = 256
    for (const entry of this.queue) {
      if (entry.nextAttemptAt > Date.now() || batch.length >= this.options.batchSize) {
        retained.push(entry)
        continue
      }
      const eventBytes = new Blob([JSON.stringify(entry.event)]).size + 1
      if (eventBytes + 256 > maxReportBytes) {
        this.dropped++
        continue
      }
      if (bytes + eventBytes > maxReportBytes) retained.push(entry)
      else {
        batch.push(entry)
        bytes += eventBytes
      }
    }
    this.queue = retained
    return batch
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const pending = this.queue.filter(entry => entry.nextAttemptAt > Date.now())
    if (!this.active || !pending.length) return
    this.retryTimer = setTimeout(() => void this.flush(), Math.max(1, Math.min(...pending.map(entry => entry.nextAttemptAt)) - Date.now()))
  }

  private flushOnHide(): void {
    if (!this.active || !this.queue.length) return
    this.safe(() => {
      const batch = this.takeBatch()
      if (!batch.length) return
      const body = new Blob([JSON.stringify({ appId: this.options.appId, events: batch.map(entry => entry.event) })], { type: 'application/json' })
      let queued = false
      try { queued = typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(this.options.reportUrl, body) } catch { /* Fall back to fetch. */ }
      if (queued) {
        // Beacon acknowledges browser queuing, not server delivery. Keep IDs for retry/deduplication.
        this.beaconQueued += batch.length
        for (const entry of batch) entry.nextAttemptAt = Date.now() + 30_000
        this.queue.unshift(...batch)
        this.scheduleRetry()
      } else {
        this.queue.unshift(...batch)
        void this.flushBatch(true)
      }
      this.notify()
    })
  }

  private installErrors(): void {
    this.listen(window, 'error', rawEvent => {
      const event = rawEvent as ErrorEvent
      if (typeof event.message === 'string') {
        this.captureEvent('js-error', event.message || 'Script error', {
          ...describeError(event.error).detail,
          filename: sanitizeUrl(event.filename || window.location.href),
          lineno: event.lineno,
          colno: event.colno,
        })
      } else {
        const target = event.target as HTMLElement | null
        if (!target?.tagName) return
        const resourceUrl = target.getAttribute('src') || target.getAttribute('href') || ''
        this.captureEvent('resource-error', `Failed to load ${target.tagName.toLowerCase()}`, { tagName: target.tagName, url: sanitizeUrl(resourceUrl) })
      }
    }, true)
    this.listen(window, 'unhandledrejection', event => {
      const described = describeError((event as PromiseRejectionEvent).reason)
      this.captureEvent('promise-error', described.message, described.detail)
    })
  }

  private installFetch(): void {
    if (typeof window.fetch !== 'function') return
    const original = window.fetch
    const monitor = this
    const wrapped: typeof fetch = function(input, init) {
      let info: RequestInfo = { url: '', method: 'GET' }
      monitor.safe(() => {
        const request = typeof input === 'object' && input !== null && 'url' in input ? input as Request : undefined
        info = { url: request ? request.url : String(input), method: String(init?.method ?? request?.method ?? 'GET').toUpperCase() }
      })
      const started = performance.now()
      const record = (status: number, success: boolean, error?: unknown) => {
        monitor.safe(() => monitor.recordRequest(info, status, started, success, error))
      }
      try {
        return original.call(window, input, init).then(response => {
          record(response.status, response.ok)
          return response
        }, error => {
          record(0, false, error)
          throw error
        })
      } catch (error) {
        record(0, false, error)
        throw error
      }
    }
    window.fetch = wrapped
    this.cleanups.push(() => { if (window.fetch === wrapped) window.fetch = original })
  }

  private installXhr(): void {
    if (typeof XMLHttpRequest === 'undefined') return
    const prototype = XMLHttpRequest.prototype
    const originalOpen = prototype.open
    const originalSend = prototype.send
    const states = new WeakMap<XMLHttpRequest, XhrState>()
    const pending = new Set<XMLHttpRequest>()
    const monitor = this
    const wrappedOpen: XMLHttpRequest['open'] = function(this: XMLHttpRequest, ...args: [method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null]) {
      const result = Reflect.apply(originalOpen, this, args)
      monitor.safe(() => {
        const old = states.get(this)
        if (old?.listener) this.removeEventListener('loadend', old.listener)
        pending.delete(this)
        states.set(this, { method: String(args[0]).toUpperCase(), url: String(args[1]) })
      })
      return result
    }
    const wrappedSend: XMLHttpRequest['send'] = function(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
      const xhr = this
      const state = states.get(xhr)
      const started = performance.now()
      let listener: EventListener | undefined
      monitor.safe(() => {
        if (!state || state.listener) return
        listener = () => monitor.safe(() => {
          pending.delete(xhr)
          state.listener = undefined
          monitor.recordRequest(state, xhr.status, started, xhr.status >= 200 && xhr.status < 400)
        })
        state.listener = listener
        pending.add(xhr)
        xhr.addEventListener('loadend', listener, { once: true })
      })
      try { return Reflect.apply(originalSend, xhr, args) } catch (error) {
        if (listener) {
          xhr.removeEventListener('loadend', listener)
          pending.delete(xhr)
          if (state) state.listener = undefined
        }
        throw error
      }
    }
    prototype.open = wrappedOpen
    prototype.send = wrappedSend
    this.cleanups.push(() => {
      if (prototype.open === wrappedOpen) prototype.open = originalOpen
      if (prototype.send === wrappedSend) prototype.send = originalSend
      for (const xhr of pending) {
        const listener = states.get(xhr)?.listener
        if (listener) xhr.removeEventListener('loadend', listener)
      }
      pending.clear()
    })
  }

  private recordRequest(info: RequestInfo, status: number, started: number, success: boolean, error?: unknown): void {
    if (!this.active || this.isReportUrl(info.url)) return
    const data = {
      method: info.method,
      url: sanitizeUrl(info.url),
      status,
      duration: Math.round((performance.now() - started) * 100) / 100,
      success,
      ...(error ? { error: describeError(error).message } : {}),
    }
    this.addBreadcrumb({ type: 'request', timestamp: Date.now(), message: `${info.method} ${status}`, data })
    this.captureEvent('request', `${info.method} ${success ? 'completed' : 'failed'}`, data)
  }

  private isReportUrl(value: string): boolean {
    try {
      const url = new URL(value, window.location.href)
      const target = new URL(this.options.reportUrl, window.location.href)
      return url.origin === target.origin && url.pathname === target.pathname
    } catch { return value === this.options.reportUrl }
  }

  private installBreadcrumbs(): void {
    this.listen(document, 'click', event => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      const element = target.closest('button, a, [role="button"]') ?? target
      this.addBreadcrumb({ type: 'click', timestamp: Date.now(), message: `Click ${element.tagName.toLowerCase()}`, data: { tagName: element.tagName, role: element.getAttribute('role') } })
    }, true)
    const recordRoute = () => {
      const url = sanitizeUrl(window.location.href)
      this.addBreadcrumb({ type: 'route', timestamp: Date.now(), message: 'Navigation', data: { url } })
      this.track('Navigation', { kind: 'page-view', url })
    }
    this.listen(window, 'popstate', recordRoute)
    this.listen(window, 'hashchange', recordRoute)
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method]
      const monitor = this
      const wrapped: History[typeof method] = function(this: History, ...args) {
        const result = Reflect.apply(original, this, args)
        monitor.safe(recordRoute)
        return result
      }
      history[method] = wrapped
      this.cleanups.push(() => { if (history[method] === wrapped) history[method] = original })
    }
  }

  private installVitals(): void {
    if (this.vitalsRegistered) return
    this.vitalsRegistered = true
    const report = (metric: Metric) => {
      this.captureEvent('performance', metric.name, { name: metric.name, value: metric.value, rating: metric.rating, unit: metric.name === 'CLS' ? 'score' : 'ms', metricId: metric.id, navigationType: metric.navigationType })
    }
    for (const register of [onLCP, onCLS, onINP, onFCP, onTTFB]) register(report)
  }

  private addBreadcrumb(breadcrumb: Breadcrumb): void {
    if (!this.active) return
    this.breadcrumbs.push(sanitize(breadcrumb) as Breadcrumb)
    if (this.breadcrumbs.length > this.options.breadcrumbLimit) this.breadcrumbs.shift()
  }

  private listen(target: EventTarget, name: string, listener: EventListener, capture = false): void {
    const guarded: EventListener = event => { if (this.active) this.safe(() => listener(event)) }
    target.addEventListener(name, guarded, capture)
    this.cleanups.push(() => target.removeEventListener(name, guarded, capture))
  }

  private notify(): void {
    for (const listener of this.subscribers) this.safe(() => listener(this.getStatus()))
  }

  private safe(action: () => void): void {
    try { action() } catch { /* Monitoring must not interrupt the application. */ }
  }
}

export function createMonitor(options: MonitorOptions): Monitor {
  return new Monitor(options)
}
