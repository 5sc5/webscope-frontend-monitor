import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, ArrowRight, ArrowUpRight, CircleAlert, Clock3, Code2, Gauge, Globe, Plus, Search, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { query, request, useResource } from './api'
import { useScope } from './App'
import { CopyButton, DataState, EventDetail, MetricCards, Modal, PageHeading, Pagination, TypeBadge } from './components'
import { chartTime, dateTime, metricDefinitions, metricValue, number, pagePath, rating, ratingNames, typeNames } from './format'
import type { Application, EventType, Issue, MonitorEvent, Overview, PageResult } from './types'

const typeColors: Record<string, string> = {
  'js-error': '#a74860', 'promise-error': '#c7788b', 'resource-error': '#d9a4b0', 'custom-error': '#774055',
  request: '#3c8795', performance: '#44896b', behavior: '#aaa8a4',
}
const chartTooltipStyle = { border: '1px solid #e4e4e5', borderRadius: 6, boxShadow: '0 4px 20px #20202412', fontSize: 12 }
const pageSize = 12

function useScopeParams() {
  const { appId, from, to } = useScope()
  return { appId, from, to }
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return <form className="search-field" onSubmit={event => { event.preventDefault(); onChange(draft.trim()) }}>
    <Search size={16} /><input type="search" aria-label={placeholder} placeholder={placeholder} value={draft} onChange={event => { setDraft(event.target.value); if (!event.target.value) onChange('') }} />
    <button type="submit" className="search-submit" title="搜索" aria-label="搜索"><ArrowRight size={16} /></button>
  </form>
}

function IssueTable({ issues, onSelect, compact = false }: { issues: Issue[]; onSelect: (issue: Issue) => void; compact?: boolean }) {
  return <div className="table-scroll"><table className={`data-table issues-table ${compact ? 'compact-table' : ''}`}><thead><tr><th>问题</th><th>事件类型</th><th className="numeric">发生次数</th><th>最近发生</th>{!compact && <th>页面</th>}<th className="table-action-col"><span className="sr-only">详情</span></th></tr></thead>
    <tbody>{issues.map(issue => <tr key={issue.id}><td><button className="issue-title" type="button" onClick={() => onSelect(issue)}><span className="issue-symbol"><CircleAlert size={17} /></span><span><strong title={issue.message}>{issue.message}</strong><small className="mono">{issue.fingerprint.slice(0, 12)}</small></span></button></td><td><TypeBadge type={issue.type} /></td><td className="numeric count-cell">{number(issue.count)}</td><td className="date-cell" title={dateTime(issue.lastSeen)}>{dateTime(issue.lastSeen)}</td>{!compact && <td className="path-cell" title={issue.url}>{pagePath(issue.url)}</td>}<td><button className="row-action" title="查看问题详情" aria-label={`查看问题 ${issue.message}`} onClick={() => onSelect(issue)}><ArrowRight size={16} /></button></td></tr>)}</tbody>
  </table></div>
}

function IssueModal({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const scope = useScope()
  const params = useScopeParams()
  const samples = useResource<PageResult<MonitorEvent>>(query('/api/events', { ...params, issueId: issue.id, page: 1, pageSize: 20 }), scope.refreshKey)
  const [selectedEvent, setSelectedEvent] = useState('')
  const selected = samples.data?.items.find(event => event.id === selectedEvent) || samples.data?.items[0]
  return <Modal title="问题详情" subtitle={issue.fingerprint} onClose={onClose} wide>
    <div className="issue-summary"><div><span className="muted">发生次数</span><strong>{number(issue.count)}</strong></div><div><span className="muted">首次发生</span><span>{dateTime(issue.firstSeen)}</span></div><div><span className="muted">最近发生</span><span>{dateTime(issue.lastSeen)}</span></div></div>
    {samples.loading || samples.error ? <DataState loading={samples.loading} error={samples.error} retry={samples.retry} compact /> : selected ? <>
      <div className="sample-picker"><label htmlFor="event-sample">事件样本</label><select id="event-sample" value={selected.id} onChange={event => setSelectedEvent(event.target.value)}>{samples.data?.items.map(event => <option value={event.id} key={event.id}>{dateTime(event.timestamp)} · {event.id.slice(0, 8)}</option>)}</select></div>
      <EventDetail event={selected} />
    </> : <DataState empty="当前时间范围内暂无事件样本" compact />}
  </Modal>
}

function EventModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const event = useResource<MonitorEvent>(`/api/events/${encodeURIComponent(eventId)}`)
  return <Modal title="事件详情" subtitle={eventId} onClose={onClose} wide>
    {event.loading || event.error ? <DataState loading={event.loading} error={event.error} retry={event.retry} /> : event.data ? <EventDetail event={event.data} /> : <DataState empty="事件不存在" />}
  </Modal>
}

export function OverviewPage() {
  const scope = useScope()
  const params = useScopeParams()
  const overview = useResource<Overview>(scope.appId ? query('/api/overview', params) : null, scope.refreshKey)
  const issues = useResource<PageResult<Issue>>(scope.appId ? query('/api/issues', { ...params, page: 1, pageSize: 5 }) : null, scope.refreshKey)
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const data = overview.data
  const trend = data?.trend.map(point => ({ ...point, label: chartTime(point.time, scope.days) })) || []
  const distribution = data?.byType.filter(item => item.count > 0) || []
  const playgroundUrl = import.meta.env.VITE_PLAYGROUND_URL || 'http://127.0.0.1:5175'
  const statistics = [
    { label: '异常事件', value: data?.errorCount, icon: CircleAlert, tone: 'burgundy', footer: 'JavaScript / Promise / 资源' },
    { label: '网络请求', value: data?.requestCount, icon: Globe, tone: 'cyan', footer: `${number(data?.failedRequestCount)} 次失败请求` },
    { label: '请求失败率', value: data ? `${data.errorRate.toFixed(1)}%` : '—', icon: ShieldAlert, tone: 'amber', footer: '失败请求 / 总请求' },
    { label: '慢请求', value: data?.slowRequestCount, icon: Clock3, tone: 'green', footer: '请求耗时 > 1,000 ms' },
  ]
  return <>
    <PageHeading title="监控总览" subtitle={`${scope.appName} · 最近 ${scope.days === 1 ? '24 小时' : `${scope.days} 天`}`} action={<a className="button secondary" href={playgroundUrl} target="_blank" rel="noreferrer"><Code2 size={15} />测试应用<ArrowUpRight size={14} /></a>} />
    {overview.error && <div className="page-alert" role="alert"><CircleAlert size={17} /><span>{overview.error}</span><button onClick={overview.retry}>重试</button></div>}
    <div className="stats-grid">{statistics.map(stat => <div className={`stat-card ${stat.tone}`} key={stat.label}><div className="stat-heading"><span>{stat.label}</span><stat.icon size={18} strokeWidth={1.6} /></div><div className="stat-value">{typeof stat.value === 'string' ? stat.value : number(stat.value)}</div><div className="stat-footer">{stat.footer}</div></div>)}</div>
    <section className="vitals-section"><div className="section-heading"><h2>核心性能指标</h2><Link className="text-link" to="/performance">性能分析<ArrowRight size={14} /></Link></div><MetricCards metrics={data?.performance || []} /></section>
    <div className="overview-charts"><section className="chart-panel"><div className="section-heading"><div><h2>事件趋势</h2><span className="section-meta">{data ? number(data.totalEvents) : '—'} 条采集事件</span></div><div className="chart-legend"><span><i style={{ background: '#a74860' }} />异常</span><span><i style={{ background: '#3c8795' }} />请求</span></div></div><div className="chart-canvas">
      {overview.loading || !data || !data.totalEvents ? <DataState loading={overview.loading} error={overview.error} retry={overview.retry} /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 18, right: 12, left: -23, bottom: 0 }}><CartesianGrid stroke="#eeeeef" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8b8b91' }} tickLine={false} axisLine={false} minTickGap={38} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8b8b91' }} tickLine={false} axisLine={false} /><Tooltip contentStyle={chartTooltipStyle} /><Line type="monotone" dataKey="errors" name="异常" stroke="#a74860" strokeWidth={2} dot={false} activeDot={{ r: 4 }} /><Line type="monotone" dataKey="requests" name="请求" stroke="#3c8795" strokeWidth={2} dot={false} activeDot={{ r: 4 }} /></LineChart></ResponsiveContainer>}
    </div></section><section className="chart-panel distribution-panel"><div className="section-heading"><h2>事件分布</h2><Activity size={16} className="muted" /></div><div className="distribution-content">
      {overview.loading || !distribution.length ? <DataState loading={overview.loading} error={overview.error} retry={overview.retry} /> : <><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={distribution} dataKey="count" nameKey="type" innerRadius={52} outerRadius={70} paddingAngle={2} stroke="white" strokeWidth={2}>{distribution.map(item => <Cell key={item.type} fill={typeColors[item.type] || '#a5a5ac'} />)}</Pie><Tooltip contentStyle={chartTooltipStyle} formatter={(value, name) => [value, typeNames[String(name) as EventType] || name]} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{number(data?.totalEvents)}</strong><span>事件</span></div></div><div className="distribution-legend">{distribution.map(item => <div key={item.type}><span><i style={{ background: typeColors[item.type] || '#a5a5ac' }} />{typeNames[item.type as EventType] || item.type}</span><strong>{number(item.count)}</strong></div>)}</div></>}
    </div></section></div>
    <section className="table-section"><div className="section-heading"><div className="heading-with-count"><h2>最近异常</h2><span className="count-badge">{number(issues.data?.total)}</span></div><Link className="text-link" to="/issues">全部问题<ArrowRight size={14} /></Link></div>
      {issues.loading || issues.error || !issues.data?.items.length ? <DataState loading={issues.loading} error={issues.error} retry={issues.retry} empty="当前时间范围内暂无异常" compact /> : <IssueTable issues={issues.data.items} onSelect={setSelectedIssue} compact />}
    </section>
    {selectedIssue && <IssueModal issue={selectedIssue} onClose={() => setSelectedIssue(null)} />}
  </>
}

export function IssuesPage() {
  const scope = useScope()
  const params = useScopeParams()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const issues = useResource<PageResult<Issue>>(scope.appId ? query('/api/issues', { ...params, keyword, page, pageSize }) : null, scope.refreshKey)
  useEffect(() => { setPage(1) }, [scope.appId, scope.from, scope.to, keyword])
  return <>
    <PageHeading title="异常追踪" subtitle={`${scope.appName} · 按错误指纹聚合`} />
    <div className="list-toolbar"><SearchField value={keyword} onChange={setKeyword} placeholder="搜索错误信息" /><span className="toolbar-count">{number(issues.data?.total)} 个问题</span></div>
    <section className="table-section list-section"><div className="section-heading"><h2>错误问题</h2><span className="section-meta">最近发生优先</span></div>
      {issues.loading || issues.error || !issues.data?.items.length ? <DataState loading={issues.loading} error={issues.error} retry={issues.retry} empty={keyword ? '没有匹配的问题' : '当前时间范围内暂无异常'} /> : <IssueTable issues={issues.data.items} onSelect={setSelectedIssue} />}
      <Pagination page={page} pageSize={pageSize} total={issues.data?.total || 0} onChange={setPage} />
    </section>
    {selectedIssue && <IssueModal issue={selectedIssue} onClose={() => setSelectedIssue(null)} />}
  </>
}

export function EventsPage() {
  const scope = useScope()
  const params = useScopeParams()
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [eventId, setEventId] = useState<string | null>(null)
  const events = useResource<PageResult<MonitorEvent>>(scope.appId ? query('/api/events', { ...params, keyword, type, page, pageSize }) : null, scope.refreshKey)
  useEffect(() => { setPage(1) }, [scope.appId, scope.from, scope.to, keyword, type])
  return <>
    <PageHeading title="事件日志" subtitle={`${scope.appName} · 全部采集事件`} />
    <div className="list-toolbar"><SearchField value={keyword} onChange={setKeyword} placeholder="搜索事件信息或页面" /><select className="filter-select" aria-label="筛选事件类型" value={type} onChange={event => setType(event.target.value)}><option value="">全部类型</option>{Object.entries(typeNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select><span className="toolbar-count">{number(events.data?.total)} 条事件</span></div>
    <section className="table-section list-section"><div className="section-heading"><h2>事件记录</h2><span className="section-meta">采集时间倒序</span></div>
      {events.loading || events.error || !events.data?.items.length ? <DataState loading={events.loading} error={events.error} retry={events.retry} empty={keyword || type ? '没有匹配的事件' : '当前时间范围内暂无事件'} /> : <div className="table-scroll"><table className="data-table events-table"><thead><tr><th>事件信息</th><th>类型</th><th>页面</th><th>采集时间</th><th className="table-action-col"><span className="sr-only">详情</span></th></tr></thead><tbody>{events.data.items.map(event => <tr key={event.id}><td><button className="event-title" onClick={() => setEventId(event.id)}><strong title={event.message}>{event.message || '—'}</strong><small className="mono">{event.id.slice(0, 16)}</small></button></td><td><TypeBadge type={event.type} /></td><td className="path-cell" title={event.url}>{pagePath(event.url)}</td><td className="date-cell">{dateTime(event.timestamp)}</td><td><button className="row-action" title="查看事件详情" aria-label={`查看事件 ${event.message}`} onClick={() => setEventId(event.id)}><ArrowRight size={16} /></button></td></tr>)}</tbody></table></div>}
      <Pagination page={page} pageSize={pageSize} total={events.data?.total || 0} onChange={setPage} />
    </section>
    {eventId && <EventModal eventId={eventId} onClose={() => setEventId(null)} />}
  </>
}

export function PerformancePage() {
  const scope = useScope()
  const params = useScopeParams()
  const [metricName, setMetricName] = useState('LCP')
  const [eventId, setEventId] = useState<string | null>(null)
  const overview = useResource<Overview>(scope.appId ? query('/api/overview', params) : null, scope.refreshKey)
  const events = useResource<PageResult<MonitorEvent>>(scope.appId ? query('/api/events', { ...params, type: 'performance', page: 1, pageSize: 100 }) : null, scope.refreshKey)
  const samples = useMemo(() => (events.data?.items || []).filter(event => String(event.detail?.name).toUpperCase() === metricName && typeof event.detail?.value === 'number'), [events.data, metricName])
  const plot = useMemo(() => [...samples].sort((left, right) => left.timestamp - right.timestamp).map(event => ({ label: chartTime(event.timestamp, scope.days), value: event.detail.value as number, fullTime: dateTime(event.timestamp) })), [samples, scope.days])
  const definition = metricDefinitions[metricName]
  const metric = overview.data?.performance.find(item => item.name === metricName)
  const bucketCounts = samples.reduce<Record<string, number>>((acc, event) => {
    const state = rating(metricName, event.detail.value as number)
    acc[state] = (acc[state] || 0) + 1
    return acc
  }, { good: 0, 'needs-improvement': 0, poor: 0 })
  return <>
    <PageHeading title="性能分析" subtitle={`${scope.appName} · Web Vitals`} />
    {overview.error && <div className="page-alert" role="alert"><CircleAlert size={17} /><span>{overview.error}</span><button onClick={overview.retry}>重试</button></div>}
    <MetricCards metrics={overview.data?.performance || []} selected={metricName} onSelect={setMetricName} />
    <div className="performance-charts"><section className="chart-panel"><div className="section-heading"><div><h2>{metricName} 样本趋势</h2><span className="section-meta">最近 100 条性能事件 · {samples.length} 个 {metricName} 样本</span></div><span className="metric-unit">{definition.unit || '无单位'}</span></div><div className="chart-canvas performance-canvas">
      {events.loading || events.error || !plot.length ? <DataState loading={events.loading} error={events.error} retry={events.retry} empty={`暂无 ${metricName} 样本`} /> : <ResponsiveContainer width="100%" height="100%"><LineChart data={plot} margin={{ top: 24, right: 45, left: -12, bottom: 0 }}><CartesianGrid stroke="#eeeeef" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8b8b91' }} tickLine={false} axisLine={false} minTickGap={38} /><YAxis tick={{ fontSize: 10, fill: '#8b8b91' }} tickLine={false} axisLine={false} width={52} domain={[0, (maximum: number) => Math.max(maximum * 1.12, definition.good * 1.2)]} /><ReferenceLine y={definition.good} stroke="#7aa68d" strokeDasharray="4 4" label={{ value: '良好', position: 'right', fontSize: 10, fill: '#53846a' }} /><Tooltip contentStyle={chartTooltipStyle} formatter={value => [metricValue(metricName, Number(value)), metricName]} /><Line type="monotone" dataKey="value" stroke="#3c8795" strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer>}
    </div></section><section className="chart-panel ratings-panel"><div className="section-heading"><h2>样本评级</h2><Gauge size={17} className="muted" /></div><div className="rating-summary"><span className={`large-rating ${rating(metricName, metric?.p75)}`}>{ratingNames[rating(metricName, metric?.p75)]}</span><span>P75 · {metricValue(metricName, metric?.p75)}</span></div><div className="rating-bars">{(['good', 'needs-improvement', 'poor'] as const).map(state => <div className="rating-row" key={state}><div><span><i className={`rating-dot ${state}`} />{ratingNames[state]}</span><strong>{bucketCounts[state]}</strong></div><div className="rating-track"><span className={state} style={{ width: `${samples.length ? bucketCounts[state] / samples.length * 100 : 0}%` }} /></div></div>)}</div><div className="thresholds"><span>良好 ≤ {metricValue(metricName, definition.good)}</span><span>较差 &gt; {metricValue(metricName, definition.poor)}</span></div></section></div>
    <section className="table-section"><div className="section-heading"><h2>{metricName} 采集记录</h2><span className="section-meta">{samples.length} 个样本</span></div>
      {events.loading || events.error || !samples.length ? <DataState loading={events.loading} error={events.error} retry={events.retry} empty={`暂无 ${metricName} 样本`} compact /> : <div className="table-scroll"><table className="data-table performance-table"><thead><tr><th>页面</th><th>指标数值</th><th>评级</th><th>采集时间</th><th className="table-action-col"><span className="sr-only">详情</span></th></tr></thead><tbody>{samples.map(event => <tr key={event.id}><td className="path-cell" title={event.url}><button className="plain-link" onClick={() => setEventId(event.id)}>{pagePath(event.url)}</button></td><td className="metric-table-value">{metricValue(metricName, event.detail.value as number)}</td><td><span className={`rating-badge ${rating(metricName, event.detail.value as number)}`}>{ratingNames[rating(metricName, event.detail.value as number)]}</span></td><td className="date-cell">{dateTime(event.timestamp)}</td><td><button className="row-action" aria-label="查看性能事件" title="查看性能事件" onClick={() => setEventId(event.id)}><ArrowRight size={16} /></button></td></tr>)}</tbody></table></div>}
    </section>
    {eventId && <EventModal eventId={eventId} onClose={() => setEventId(null)} />}
  </>
}

export function SettingsPage() {
  const scope = useScope()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const snippet = `import { createMonitor } from '@webscope/monitor-sdk'\n\nconst monitor = createMonitor({\n  appId: ${JSON.stringify(scope.appId || 'your-app')},\n  reportUrl: ${JSON.stringify(`${window.location.origin}/api/events`)},\n})\n\nmonitor.start()`

  async function createApplication(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const application = await request<Application>('/api/applications', { method: 'POST', body: JSON.stringify({ appId: appId.trim(), name: name.trim() }) })
      setCreating(false)
      setName('')
      setAppId('')
      scope.setAppId(application.appId)
      scope.refresh()
      setNotice(`已创建应用「${application.name}」`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <PageHeading title="应用设置" subtitle="工作空间应用" action={<button type="button" className="button primary" onClick={() => { setCreating(true); setError(''); setNotice('') }}><Plus size={16} />新建应用</button>} />
    {notice && <div className="page-notice" role="status">{notice}</div>}
    <section className="table-section applications-section"><div className="section-heading"><h2>应用列表</h2><span className="count-badge">{scope.applications.length}</span></div>
      {scope.applicationsLoading || scope.applicationsError || !scope.applications.length ? <DataState loading={scope.applicationsLoading} error={scope.applicationsError} retry={scope.refresh} empty="暂无应用" /> : <div className="table-scroll"><table className="data-table applications-table"><thead><tr><th>应用名称</th><th>应用标识</th><th>创建时间</th><th>当前应用</th></tr></thead><tbody>{scope.applications.map(application => <tr key={application.appId}><td><div className="application-name"><span className="app-icon"><LayersIcon /></span><strong>{application.name}</strong></div></td><td className="mono">{application.appId}</td><td className="date-cell">{dateTime(application.createdAt)}</td><td>{application.appId === scope.appId ? <span className="current-app"><i />已选中</span> : <button className="button secondary small" onClick={() => { scope.setAppId(application.appId); setNotice('') }}>切换应用</button>}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="installation-section"><div className="section-heading"><div><h2>SDK 接入配置</h2><span className="section-meta">{scope.appName}</span></div><CopyButton value={snippet} label="复制接入配置" /></div><div className="installation-code"><div className="code-filename"><Code2 size={14} /><span>monitor.ts</span><span className="code-language">TypeScript</span></div><pre className="code-block">{snippet}</pre></div><dl className="settings-metadata"><div><dt>应用标识</dt><dd className="mono">{scope.appId || '—'}</dd></div><div><dt>数据接收地址</dt><dd className="mono break">{window.location.origin}/api/events</dd></div><div><dt>SDK 版本</dt><dd>0.1.0</dd></div></dl></section>
    {creating && <Modal title="新建应用" onClose={() => { if (!saving) setCreating(false) }}><form className="application-form" onSubmit={event => void createApplication(event)}><label htmlFor="application-name">应用名称</label><input id="application-name" value={name} onChange={event => setName(event.target.value)} placeholder="问卷平台" maxLength={80} required autoFocus /><label htmlFor="application-id">应用标识</label><input id="application-id" value={appId} onChange={event => setAppId(event.target.value)} placeholder="survey-platform" maxLength={64} pattern={'[A-Za-z0-9][A-Za-z0-9_\\-]*'} title="应用标识以字母或数字开头，支持短横线和下划线" required />{error && <div className="form-error" role="alert">{error}</div>}<div className="form-actions"><button className="button secondary" type="button" disabled={saving} onClick={() => setCreating(false)}>取消</button><button className="button primary" type="submit" disabled={saving}>{saving ? '创建中' : '创建应用'}</button></div></form></Modal>}
  </>
}

function LayersIcon() {
  return <Globe size={17} strokeWidth={1.7} />
}
