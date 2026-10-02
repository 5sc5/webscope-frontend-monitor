import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, Bug, CircleAlert, Code2, ExternalLink, FlaskConical, Globe, Layers, LoaderCircle, Radio, Send, ShieldCheck, Timer, Trash2, Zap } from 'lucide-react'
import { createMonitor, type MonitorStatus } from '@webscope/monitor-sdk'
import './styles.css'

const healthFetch = window.fetch.bind(window)
const monitor = createMonitor({ appId: 'playground', reportUrl: '/api/events', batchSize: 10, flushInterval: 5000 })
monitor.start()
if (import.meta.hot) import.meta.hot.dispose(() => monitor.destroy())

type Log = { id: number; time: string; title: string; result: string; severity: 'info' | 'error' | 'success' }
const dashboardUrl = import.meta.env.VITE_DASHBOARD_URL || 'http://127.0.0.1:5174'

function App() {
  const [status, setStatus] = useState<MonitorStatus>(monitor.getStatus())
  const [connected, setConnected] = useState<boolean | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [busy, setBusy] = useState('')
  const [path, setPath] = useState(location.hash || '#/overview')
  const [privacyResult, setPrivacyResult] = useState('')

  useEffect(() => monitor.subscribe(setStatus), [])
  useEffect(() => {
    let cancelled = false
    const check = () => healthFetch('/api/health').then(response => { if (!cancelled) setConnected(response.ok) }).catch(() => { if (!cancelled) setConnected(false) })
    void check()
    const timer = setInterval(check, 10000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  function log(title: string, result: string, severity: Log['severity'] = 'info') {
    setLogs(previous => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), title, result, severity }, ...previous].slice(0, 50))
  }
  function runtimeError() {
    log('JavaScript 异常', '触发 ErrorEvent', 'error')
    setTimeout(() => { throw new Error('Playground: questionnaire render failed') }, 0)
  }
  function promiseError() {
    log('Promise 异常', '触发 unhandledrejection', 'error')
    void Promise.reject(new Error('Playground: questionnaire save rejected'))
  }
  function resourceError() {
    const image = document.createElement('img')
    image.alt = ''
    image.style.cssText = 'width:1px;height:1px;position:absolute;pointer-events:none;opacity:0'
    image.addEventListener('error', () => setTimeout(() => image.remove(), 0), { once: true })
    image.src = `/missing-resource-${Date.now()}.png`
    document.body.append(image)
    log('资源加载异常', '触发图片加载错误', 'error')
  }
  async function request(kind: 'success' | 'failure' | 'slow' | 'abort') {
    setBusy(kind)
    const start = performance.now()
    const controller = new AbortController()
    const timer = kind === 'abort' ? setTimeout(() => controller.abort(), 100) : null
    try {
      const response = await fetch(`/api/test/${kind === 'abort' ? 'slow' : kind}`, { signal: controller.signal })
      await response.text()
      log(`HTTP ${response.status}`, `${Math.round(performance.now() - start)} ms`, response.ok ? 'success' : 'error')
    } catch (error) {
      log('请求中断', error instanceof Error ? error.name : String(error), 'error')
    } finally {
      if (timer) clearTimeout(timer)
      setBusy('')
    }
  }
  function xhrRequest() {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', '/api/test/success')
    xhr.addEventListener('loadend', () => log(`XHR ${xhr.status}`, '请求结束', xhr.status === 200 ? 'success' : 'error'))
    xhr.send()
  }
  function burst() {
    for (let index = 0; index < 50; index++) monitor.captureError(new Error(`Playground: item ${1000 + index} validation failed`))
    log('批量异常', '50 条异常已加入上报队列', 'error')
  }
  async function privacy() {
    setBusy('privacy')
    const marker = `privacy-${Date.now()}`
    monitor.track(marker, { password: 'demo-password-only', token: 'demo-token-only', authorization: 'Bearer demo-only', nested: { cookie: 'demo-cookie-only', note: 'public-note' } })
    try {
      await monitor.flush()
      const response = await healthFetch(`/api/events?appId=playground&keyword=${marker}&pageSize=1`)
      const data = await response.json()
      const detail = JSON.stringify(data.items?.[0]?.detail)
      const safe = detail && !detail.includes('demo-password-only') && !detail.includes('demo-token-only') && !detail.includes('demo-cookie-only') && !detail.includes('Bearer demo-only') && detail.includes('public-note')
      setPrivacyResult(safe ? '敏感字段已过滤，公开字段已保留' : '未查到已入库的脱敏事件')
      log('隐私检查', safe ? '通过' : '待检查', safe ? 'success' : 'error')
    } catch {
      setPrivacyResult('服务端不可用')
      log('隐私检查', '服务端不可用', 'error')
    } finally { setBusy('') }
  }
  async function flush() {
    setBusy('flush')
    try { await monitor.flush(); log('手动上报', `${monitor.getStatus().queued} 条待发送`) }
    finally { setBusy('') }
  }
  function route() {
    const next = path === '#/overview' ? '#/question/edit' : '#/overview'
    history.pushState(null, '', next)
    setPath(next)
    monitor.track('playground navigation', { path: next })
    log('路由切换', next, 'success')
  }
  function toggle(active: boolean) {
    if (active) monitor.start()
    else monitor.destroy()
    setStatus(monitor.getStatus())
    log('SDK 状态', active ? '采集已启用' : '监听与拦截已恢复')
  }
  const scenarios = [
    { title: 'JavaScript 运行时异常', tag: 'ErrorEvent', Icon: Code2, action: runtimeError },
    { title: 'Promise 未处理异常', tag: 'unhandledrejection', Icon: CircleAlert, action: promiseError },
    { title: '资源加载异常', tag: 'resource-error', Icon: Globe, action: resourceError },
    { title: 'Fetch 成功请求', tag: 'HTTP 200', Icon: ArrowUpRight, action: () => request('success'), busy: 'success' },
    { title: 'Fetch 失败请求', tag: 'HTTP 500', Icon: Bug, action: () => request('failure'), busy: 'failure' },
    { title: 'Fetch 慢请求', tag: '1,200 ms', Icon: Timer, action: () => request('slow'), busy: 'slow' },
    { title: 'Fetch 请求中断', tag: 'AbortController', Icon: Zap, action: () => request('abort'), busy: 'abort' },
    { title: 'XHR 请求', tag: 'XMLHttpRequest', Icon: Radio, action: xhrRequest },
  ]

  return <div className="app">
    <header className="topbar"><a className="brand" href={dashboardUrl}><Activity size={23} /><strong>WebScope</strong></a><span className="top-divider" /><span className="top-title">SDK 验证台</span><a className="dashboard-link" href={dashboardUrl} target="_blank" rel="noreferrer">监控看板 <ExternalLink size={15} /></a></header>
    <main>
      <div className="page-heading"><div><span className="eyebrow">PLAYGROUND</span><h1>SDK 验证台</h1></div><span className={`connection ${connected ? 'online' : connected === false ? 'offline' : ''}`}><span className="dot" />{connected ? 'API 已连接' : connected === false ? 'API 未连接' : '连接中'}</span></div>
      <section className="status-band" aria-label="SDK 状态">
        <div className="sdk-control"><div className="app-identity"><FlaskConical size={20} /><div><strong>playground</strong><span>验证环境</span></div></div><label className="switch"><input aria-label="采集启用" type="checkbox" checked={status.active} onChange={event => toggle(event.target.checked)} /><span />采集启用</label></div>
        <div className="status-number"><span>待发送</span><strong>{status.queued}</strong></div><div className="status-number"><span>已发送</span><strong>{status.sent}</strong></div><div className="status-number"><span>失败次数</span><strong>{status.failed}</strong></div><div className="status-number"><span>已丢弃</span><strong>{status.dropped}</strong></div>
        <button className="button primary" disabled={!status.active || !!busy} title={status.active ? '立即上报' : '采集已暂停'} onClick={() => void flush()}>{busy === 'flush' ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}立即上报</button>
      </section>
      <div className="workspace"><section className="scenario-section"><div className="section-heading"><h2>采集场景</h2><span>08 场景</span></div><div className="scenario-grid">{scenarios.map(({ title, tag, Icon, action, busy: key }) => <div className="scenario" key={title}><div className="scenario-icon"><Icon size={20} /></div><div className="scenario-text"><h3>{title}</h3><code>{tag}</code></div><button className="trigger" disabled={!!busy} onClick={() => void action()} aria-label={`触发${title}`}>{key && busy === key ? <LoaderCircle className="spin" size={16} /> : '触发'}</button></div>)}</div>
        <div className="section-heading secondary"><h2>工程验证</h2></div><div className="engineering-row"><div><Layers size={20} /><strong>批量队列 / 错误聚合</strong><span>50 条同类异常</span></div><button className="button" disabled={!status.active || !!busy} onClick={burst}><Zap size={15} />批量触发</button></div><div className="engineering-row"><div><ShieldCheck size={20} /><strong>敏感字段脱敏</strong><span>{privacyResult || 'password / token / authorization / cookie'}</span></div><button className="button" disabled={!status.active || !!busy} onClick={() => void privacy()}>{busy === 'privacy' ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}验证</button></div><div className="engineering-row"><div><Globe size={20} /><strong>路由行为记录</strong><span>{path}</span></div><button className="button" disabled={!status.active} onClick={route}><ArrowUpRight size={15} />切换路由</button></div>
      </section><section className="log-section"><div className="section-heading"><h2>操作日志</h2><button className="icon-button" title="清空操作日志" aria-label="清空操作日志" onClick={() => setLogs([])}><Trash2 size={17} /></button></div><div className="log-list">{logs.length === 0 ? <div className="empty-log"><Activity size={30} /><span>暂无操作记录</span></div> : logs.map(item => <div className="log" key={item.id}><span className={`log-mark ${item.severity}`} /><time>{item.time}</time><div><strong>{item.title}</strong><span>{item.result}</span></div></div>)}</div><div className="log-footer"><span className="dot" />{status.active ? '监控采集中' : '监控已暂停'}<code>batch: 10 · interval: 5s</code></div></section></div>
      <footer className="footer"><span>WebScope · Local development</span><span>SDK v0.1.0</span></footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
