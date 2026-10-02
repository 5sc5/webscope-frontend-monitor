export type EventType =
  | 'js-error'
  | 'promise-error'
  | 'resource-error'
  | 'request'
  | 'performance'
  | 'behavior'
  | 'custom-error'

export type Breadcrumb = {
  type: 'click' | 'route' | 'request'
  timestamp: number
  message: string
  data?: Record<string, unknown>
}

export type MonitorEvent = {
  id: string
  appId: string
  sessionId: string
  type: EventType
  message: string
  url: string
  timestamp: number
  detail: Record<string, unknown>
  breadcrumbs: Breadcrumb[]
}

export type MonitorStatus = {
  active: boolean
  queued: number
  sent: number
  failed: number
  dropped: number
  beaconQueued: number
  requests: number
}

export type MonitorOptions = {
  appId: string
  reportUrl: string
  batchSize?: number
  flushInterval?: number
  maxQueueSize?: number
  maxRetries?: number
  breadcrumbLimit?: number
  sampleRate?: number
  onStatus?: (status: MonitorStatus) => void
}
