import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copy, Inbox, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { dateTime, metricDefinitions, metricValue, rating, ratingNames, typeNames } from './format'
import type { EventType, MetricSummary, MonitorEvent } from './types'

export function IconButton({ label, onClick, children, disabled = false, className = '' }: {
  label: string
  onClick?: () => void
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>
}

export function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="page-actions">{action}</div>}</div>
}

export function DataState({ loading, error, empty, retry, compact = false }: {
  loading?: boolean
  error?: string | null
  empty?: string
  retry?: () => void
  compact?: boolean
}) {
  return <div className={`data-state ${compact ? 'compact' : ''}`} role={error ? 'alert' : 'status'}>
    {loading ? <LoaderCircle size={24} className="spin" /> : error ? <AlertCircle size={24} /> : <Inbox size={28} strokeWidth={1.4} />}
    <span>{loading ? '正在加载数据' : error || empty || '暂无监控数据'}</span>
    {error && retry && <button type="button" className="button secondary small" onClick={retry}><RefreshCw size={14} />重试</button>}
  </div>
}

export function TypeBadge({ type }: { type: string }) {
  const isError = type.includes('error')
  return <span className={`badge ${isError ? 'error' : type === 'performance' ? 'performance' : type === 'behavior' ? 'neutral' : 'request'}`}>
    <span className="badge-dot" />{typeNames[type as EventType] || type}
  </span>
}

export function MetricCards({ metrics, selected, onSelect }: { metrics: MetricSummary[]; selected?: string; onSelect?: (name: string) => void }) {
  return <div className="vitals-grid">{Object.entries(metricDefinitions).map(([name, definition]) => {
    const metric = metrics.find(item => item.name === name)
    const state = rating(name, metric?.p75)
    const contents = <>
      <div className="metric-top"><span className="metric-code">{name}</span><span className={`rating-dot ${state}`} title={ratingNames[state]} /></div>
      <div className="metric-value">{metricValue(name, metric?.p75)}</div>
      <div className="metric-label">{definition.label}</div>
      <div className="metric-foot"><span>P75</span><span>{metric?.samples || 0} 个样本</span></div>
    </>
    return onSelect
      ? <button type="button" className={`vital-card ${selected === name ? 'selected' : ''}`} key={name} onClick={() => onSelect(name)} aria-pressed={selected === name}>{contents}</button>
      : <div className="vital-card" key={name}>{contents}</div>
  })}</div>
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="pagination"><span>共 {total.toLocaleString('zh-CN')} 条</span><div className="pagination-controls">
    <IconButton label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft size={16} /></IconButton>
    <span>{page} / {pages}</span>
    <IconButton label="下一页" disabled={page >= pages} onClick={() => onChange(page + 1)}><ArrowRight size={16} /></IconButton>
  </div></div>
}

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element?.open) element?.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="detail-heading" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal-header"><div><h2 id="detail-heading">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="关闭" onClick={onClose}><X size={20} /></IconButton></div>
    <div className="modal-body">{children}</div>
  </dialog>
}

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setFailed(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setFailed(true)
    }
  }
  return <div className="copy-control"><IconButton label={copied ? '已复制' : label} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</IconButton>{failed && <span className="inline-error">复制失败</span>}</div>
}

export function EventDetail({ event }: { event: MonitorEvent }) {
  const detail = event.detail || {}
  const stack = typeof detail.stack === 'string' ? detail.stack : undefined
  const rawDetail = { ...detail }
  delete rawDetail.stack
  const entries = [
    ['事件类型', typeNames[event.type]],
    ['采集时间', dateTime(event.timestamp)],
    ['应用标识', event.appId],
    ['会话标识', event.sessionId || '—'],
  ]
  return <div className="event-detail">
    <div className="detail-message"><TypeBadge type={event.type} /><p>{event.message || '—'}</p></div>
    <dl className="metadata-grid">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}<div className="full"><dt>页面地址</dt><dd className="mono break">{event.url || '—'}</dd></div></dl>
    {stack && <section className="detail-section"><div className="section-heading"><h3>错误堆栈</h3><CopyButton value={stack} label="复制堆栈" /></div><pre className="code-block stack">{stack}</pre></section>}
    {Object.keys(rawDetail).length > 0 && <section className="detail-section"><div className="section-heading"><h3>事件数据</h3><CopyButton value={JSON.stringify(detail, null, 2)} label="复制事件数据" /></div><pre className="code-block">{JSON.stringify(rawDetail, null, 2)}</pre></section>}
    <section className="detail-section"><div className="section-heading"><h3>操作链路</h3><span className="muted">{event.breadcrumbs?.length || 0} 条记录</span></div>
      {event.breadcrumbs?.length ? <ol className="breadcrumbs-list">{event.breadcrumbs.map((breadcrumb, index) => <li key={`${breadcrumb.timestamp}-${index}`}><span className="breadcrumb-time">{new Date(breadcrumb.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span><div className="breadcrumb-content"><span className="breadcrumb-type">{breadcrumb.type}</span><p>{breadcrumb.message}</p>{breadcrumb.data && Object.keys(breadcrumb.data).length > 0 && <details><summary>数据</summary><pre>{JSON.stringify(breadcrumb.data, null, 2)}</pre></details>}</div></li>)}</ol> : <div className="inline-empty">暂无操作记录</div>}
    </section>
  </div>
}
