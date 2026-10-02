import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMonitor, type Monitor, type MonitorEvent } from '../src'
import { onLCP, type LCPMetric } from 'web-vitals'

vi.mock('web-vitals', () => ({
  onLCP: vi.fn(), onCLS: vi.fn(), onINP: vi.fn(), onFCP: vi.fn(), onTTFB: vi.fn(),
}))

const reportUrl = 'http://localhost:3001/api/events'
let monitors: Monitor[]
let transport: ReturnType<typeof vi.fn>
let originalFetch: typeof window.fetch

function acknowledgement(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (String(input) === reportUrl) {
    const events = JSON.parse(String(init?.body)).events as MonitorEvent[]
    return Promise.resolve({ ok: true, status: 202, json: async () => ({ accepted: events.length, duplicates: 0 }) } as Response)
  }
  return Promise.resolve({ ok: true, status: 200 } as Response)
}

function build(options: Parameters<typeof createMonitor>[0] = { appId: 'test', reportUrl }): Monitor {
  const monitor = createMonitor(options).start()
  monitors.push(monitor)
  return monitor
}

function reports(): MonitorEvent[] {
  return transport.mock.calls
    .filter(([input]) => String(input) === reportUrl)
    .flatMap(([, init]) => JSON.parse(String(init?.body)).events as MonitorEvent[])
}

beforeEach(() => {
  vi.clearAllMocks()
  monitors = []
  originalFetch = window.fetch
  transport = vi.fn(acknowledgement)
  window.fetch = transport as typeof window.fetch
})

afterEach(() => {
  for (const monitor of monitors) monitor.destroy()
  window.fetch = originalFetch
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('browser monitoring', () => {
  it('collects final Web Vitals samples and suppresses callbacks after destroy', async () => {
    const monitor = build()
    const callback = vi.mocked(onLCP).mock.calls[0][0]
    expect(vi.mocked(onLCP).mock.calls[0]).toHaveLength(1)
    callback({ name: 'LCP', value: 1800, rating: 'good', id: 'metric-1', navigationType: 'navigate', delta: 1800, entries: [] } as LCPMetric)
    await monitor.flush()
    expect(reports().find(event => event.type === 'performance')?.detail).toMatchObject({ name: 'LCP', value: 1800, unit: 'ms', metricId: 'metric-1' })
    monitor.destroy()
    callback({ name: 'LCP', value: 2200, rating: 'good', id: 'metric-1', navigationType: 'navigate', delta: 400, entries: [] } as LCPMetric)
    expect(monitor.getStatus().queued).toBe(0)
    monitor.start()
    expect(onLCP).toHaveBeenCalledTimes(1)
  })
  it('captures runtime, non-Error rejection and resource errors with serializable privacy filtering', async () => {
    const monitor = build()
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Render failed', filename: '/assets/app.js?token=secret', lineno: 12, colno: 7,
      error: new Error('Render failed'),
    }))
    const reason: Record<string, unknown> = { password: 'secret', token: 'abc', code: 7 }
    reason.self = reason
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: reason })
    window.dispatchEvent(rejection)
    const image = document.createElement('img')
    image.src = '/missing.png?access_token=abc'
    document.body.appendChild(image)
    image.dispatchEvent(new Event('error'))
    await monitor.flush()
    const events = reports()
    expect(events.map(event => event.type)).toEqual(['behavior', 'js-error', 'promise-error', 'resource-error'])
    expect(events[1].detail.lineno).toBe(12)
    expect(events[1].detail.filename).not.toContain('secret')
    expect(events[2].detail.reason).toEqual({ password: '[REDACTED]', token: '[REDACTED]', code: 7, self: '[Circular]' })
    expect(events[3].detail.url).not.toContain('abc')
  })

  it('preserves fetch(url), Request, request options and original response', async () => {
    const monitor = build()
    const response = { ok: true, status: 201 } as Response
    transport.mockImplementation((input, init) => String(input) === reportUrl ? acknowledgement(input, init) : Promise.resolve(response))
    expect(await window.fetch('/api/list')).toBe(response)
    const request = new Request('http://localhost:5174/api/save?token=hidden', { method: 'POST' })
    expect(await window.fetch(request)).toBe(response)
    const signal = new AbortController().signal
    const options = { method: 'PATCH', signal, headers: { Authorization: 'Bearer hidden' }, body: 'password=hidden' }
    await window.fetch('/api/update', options)
    expect(transport).toHaveBeenCalledWith('/api/update', options)
    await monitor.flush()
    const events = reports().filter(event => event.type === 'request')
    expect(events.map(event => event.detail.method)).toEqual(['GET', 'POST', 'PATCH'])
    expect(JSON.stringify(events)).not.toContain('hidden')
    expect(events[0].detail.status).toBe(201)
  })

  it('keeps fetch rejection identity and does not recursively instrument telemetry', async () => {
    const monitor = build()
    const error = new DOMException('Aborted', 'AbortError')
    transport.mockImplementation((input, init) => String(input) === reportUrl ? acknowledgement(input, init) : Promise.reject(error))
    await expect(window.fetch('/api/slow')).rejects.toBe(error)
    await monitor.flush()
    const requestEvents = reports().filter(event => event.type === 'request')
    expect(requestEvents).toHaveLength(1)
    expect(requestEvents[0].detail).toMatchObject({ status: 0, success: false, error: 'Aborted' })
    expect(monitor.getStatus().queued).toBe(0)
  })

  it('records breadcrumbs without collecting input values or button text', async () => {
    const monitor = build()
    document.body.innerHTML = '<button>private@example.com</button><input value="my-password">'
    document.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('input')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    monitor.captureError(new Error('Click failure'))
    await monitor.flush()
    const error = reports().find(event => event.type === 'custom-error')!
    expect(error.breadcrumbs).toHaveLength(2)
    expect(JSON.stringify(error)).not.toContain('private@example.com')
    expect(JSON.stringify(error)).not.toContain('my-password')
  })

  it('collects reused XHR requests exactly once and restores wrappers', async () => {
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {})
    const send = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {})
    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send
    const monitor = build()
    const xhr = new XMLHttpRequest()
    Object.defineProperty(xhr, 'status', { configurable: true, value: 200 })
    xhr.open('GET', '/api/first')
    xhr.send()
    xhr.dispatchEvent(new Event('loadend'))
    xhr.dispatchEvent(new Event('loadend'))
    xhr.open('POST', '/api/second')
    xhr.send()
    Object.defineProperty(xhr, 'status', { configurable: true, value: 0 })
    xhr.dispatchEvent(new Event('loadend'))
    await monitor.flush()
    expect(reports().filter(event => event.type === 'request').map(event => event.detail.status)).toEqual([200, 0])
    expect(open).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(2)
    monitor.destroy()
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen)
    expect(XMLHttpRequest.prototype.send).toBe(originalSend)
  })
})

describe('report transport and lifecycle', () => {
  it('awaits every eligible batch and serializes concurrent flush calls', async () => {
    const monitor = build({ appId: 'test', reportUrl, batchSize: 10 })
    for (let index = 0; index < 49; index++) monitor.track(`event-${index}`)
    await Promise.all([monitor.flush(), monitor.flush()])
    expect(transport).toHaveBeenCalledTimes(5)
    expect(monitor.getStatus()).toMatchObject({ sent: 50, queued: 0, requests: 5 })
  })
  it('batches on quantity and time thresholds', async () => {
    vi.useFakeTimers()
    const monitor = build({ appId: 'test', reportUrl, batchSize: 10, flushInterval: 5000 })
    for (let index = 0; index < 8; index++) monitor.track(`event-${index}`)
    expect(transport).not.toHaveBeenCalled()
    monitor.track('event-9')
    await monitor.flush()
    expect(transport).toHaveBeenCalledTimes(1)
    expect(reports()).toHaveLength(10)
    monitor.track('later')
    await vi.advanceTimersByTimeAsync(4999)
    expect(transport).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(monitor.getStatus()).toMatchObject({ sent: 11, requests: 2, queued: 0 })
  })

  it('retries with stable event IDs and accepts server deduplication acknowledgements', async () => {
    vi.useFakeTimers()
    const monitor = build()
    transport.mockRejectedValueOnce(new Error('offline'))
    monitor.captureError('Saved error')
    await monitor.flush()
    const firstIds = reports().map(event => event.id)
    expect(monitor.getStatus()).toMatchObject({ queued: 2, failed: 2, sent: 0 })
    transport.mockImplementation(async (_input, init) => {
      const batch = JSON.parse(String(init?.body)).events
      return { ok: true, status: 202, json: async () => ({ accepted: 0, duplicates: batch.length }) } as Response
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(reports().slice(2).map(event => event.id)).toEqual(firstIds)
    expect(monitor.getStatus()).toMatchObject({ sent: 2, queued: 0, requests: 2, dropped: 0 })
  })

  it('limits queue growth and bounds retry attempts', async () => {
    vi.useFakeTimers()
    const monitor = build({ appId: 'test', reportUrl, maxQueueSize: 3, maxRetries: 1, batchSize: 10 })
    for (let index = 0; index < 6; index++) monitor.track(`event-${index}`)
    expect(monitor.getStatus()).toMatchObject({ queued: 3, dropped: 4 })
    transport.mockRejectedValue(new Error('offline'))
    await monitor.flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(transport).toHaveBeenCalledTimes(2)
    expect(monitor.getStatus()).toMatchObject({ queued: 0, dropped: 7, failed: 6 })
  })

  it('keeps beacon-queued events unacknowledged until a server response', async () => {
    const monitor = build()
    const beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
    monitor.captureError('Closing page')
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(monitor.getStatus()).toMatchObject({ queued: 2, sent: 0, beaconQueued: 2 })
    document.dispatchEvent(new Event('visibilitychange'))
    await monitor.flush()
    expect(monitor.getStatus()).toMatchObject({ queued: 0, sent: 2 })
    Reflect.deleteProperty(navigator, 'sendBeacon')
  })

  it('destroy removes listeners and only restores wrappers it still owns', async () => {
    const originalHistory = history.pushState
    const monitor = build()
    const wrappedFetch = window.fetch
    monitor.start()
    expect(window.fetch).toBe(wrappedFetch)
    const replacement = vi.fn(acknowledgement) as typeof window.fetch
    window.fetch = replacement
    monitor.destroy()
    expect(window.fetch).toBe(replacement)
    expect(history.pushState).toBe(originalHistory)
    const queued = monitor.getStatus().queued
    window.dispatchEvent(new ErrorEvent('error', { message: 'ignored' }))
    monitor.captureError('ignored')
    await monitor.flush()
    expect(monitor.getStatus()).toMatchObject({ active: false, queued })
    expect(transport).not.toHaveBeenCalled()
  })

  it('never lets failing status subscribers break business fetch', async () => {
    const monitor = build({ appId: 'test', reportUrl, onStatus: () => { throw new Error('subscriber failed') } })
    expect(await window.fetch('/api/list')).toMatchObject({ status: 200 })
    monitor.captureError('Still working')
    await monitor.flush()
    expect(reports().some(event => event.type === 'custom-error')).toBe(true)
  })
})
