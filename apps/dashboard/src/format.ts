import type { EventType } from './types'

export const typeNames: Record<EventType, string> = {
  'js-error': 'JavaScript 异常',
  'promise-error': 'Promise 异常',
  'resource-error': '资源异常',
  'custom-error': '自定义异常',
  request: '网络请求',
  performance: '性能指标',
  behavior: '用户行为',
}

export const metricDefinitions: Record<string, { label: string; good: number; poor: number; unit: string }> = {
  LCP: { label: '最大内容绘制', good: 2500, poor: 4000, unit: 'ms' },
  INP: { label: '交互响应', good: 200, poor: 500, unit: 'ms' },
  CLS: { label: '布局偏移', good: 0.1, poor: 0.25, unit: '' },
  FCP: { label: '首次内容绘制', good: 1800, poor: 3000, unit: 'ms' },
  TTFB: { label: '首字节时间', good: 800, poor: 1800, unit: 'ms' },
}

export function number(value: number | undefined | null): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('zh-CN')
}

export function dateTime(value: number | string | undefined): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

export function shortTime(value: number | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function chartTime(value: number | string, days: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return days > 1
    ? `${date.getMonth() + 1}/${date.getDate()} ${shortTime(value)}`
    : shortTime(value)
}

export function pagePath(value: string): string {
  try {
    const url = new URL(value)
    return url.pathname || '/'
  } catch {
    return value || '—'
  }
}

export function metricValue(name: string, value: number | null | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—'
  if (name === 'CLS') return value.toFixed(3)
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`
}

export function rating(name: string, value: number | undefined | null): 'good' | 'needs-improvement' | 'poor' | 'none' {
  if (value === undefined || value === null) return 'none'
  const definition = metricDefinitions[name]
  if (!definition) return 'none'
  return value <= definition.good ? 'good' : value <= definition.poor ? 'needs-improvement' : 'poor'
}

export const ratingNames: Record<string, string> = { good: '良好', 'needs-improvement': '需改善', poor: '较差', none: '暂无样本' }
