export type EventType = 'js-error' | 'promise-error' | 'resource-error' | 'request' | 'performance' | 'behavior' | 'custom-error'

export interface Application {
  appId: string
  name: string
  createdAt: number | string
}

export interface Breadcrumb {
  type: string
  timestamp: number
  message: string
  data?: Record<string, unknown>
}

export interface MonitorEvent {
  id: string
  appId: string
  sessionId: string
  type: EventType
  message: string
  url: string
  timestamp: number
  detail: Record<string, unknown>
  breadcrumbs: Breadcrumb[]
  issueId?: string
}

export interface Issue {
  id: string
  fingerprint: string
  message: string
  type: EventType
  count: number
  firstSeen: number | string
  lastSeen: number | string
  url: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  page?: number
  pageSize?: number
}

export interface MetricSummary {
  name: string
  p75: number | null
  samples: number
  rating: string | null
}

export interface Overview {
  totalEvents: number
  errorCount: number
  requestCount: number
  failedRequestCount: number
  errorRate: number
  slowRequestCount: number
  performance: MetricSummary[]
  trend: Array<{ time: string | number; errors: number; requests: number }>
  byType: Array<{ type: string; count: number }>
}
