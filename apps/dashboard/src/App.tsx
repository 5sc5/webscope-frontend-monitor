import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowUpRight, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleAlert, Code2, Layers3, LayoutDashboard, Menu, RefreshCw, Settings2, X } from 'lucide-react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useResource } from './api'
import { IconButton } from './components'
import { EventsPage, IssuesPage, OverviewPage, PerformancePage, SettingsPage } from './pages'
import type { Application } from './types'

interface Scope {
  appId: string
  appName: string
  applications: Application[]
  applicationsLoading: boolean
  applicationsError: string | null
  days: number
  from: number
  to: number
  refreshKey: number
  setAppId: (id: string) => void
  setDays: (days: number) => void
  refresh: () => void
}

const ScopeContext = createContext<Scope | null>(null)
export function useScope() {
  const scope = useContext(ScopeContext)
  if (!scope) throw new Error('ScopeContext is missing')
  return scope
}

function initialApp() {
  try { return localStorage.getItem('webscope-app') || 'playground' } catch { return 'playground' }
}

const navigation = [
  { path: '/', label: '总览', icon: LayoutDashboard },
  { path: '/issues', label: '异常追踪', icon: CircleAlert },
  { path: '/events', label: '事件日志', icon: Code2 },
  { path: '/performance', label: '性能分析', icon: ChartNoAxesCombined },
  { path: '/settings', label: '应用设置', icon: Settings2 },
]

export default function App() {
  const [appId, changeApp] = useState(initialApp)
  const [days, setDays] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const apps = useResource<Application[]>('/api/applications', refreshKey)
  const applications = apps.data || []

  useEffect(() => {
    if (apps.data && !apps.data.some(application => application.appId === appId)) {
      changeApp(apps.data.find(application => application.appId === 'playground')?.appId || apps.data[0]?.appId || '')
    }
  }, [apps.data])
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    try { localStorage.setItem('webscope-app', appId) } catch { /* Storage may be disabled. */ }
  }, [appId])
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [menuOpen])

  const range = useMemo(() => {
    const to = Date.now()
    return { from: to - days * 86_400_000, to }
  }, [days, refreshKey])
  const currentApplication = applications.find(application => application.appId === appId)
  const appName = currentApplication?.name || appId || '暂无应用'
  const scope: Scope = {
    appId, appName, applications, applicationsLoading: apps.loading, applicationsError: apps.error,
    days, ...range, refreshKey,
    setAppId: changeApp,
    setDays,
    refresh: () => setRefreshKey(key => key + 1),
  }
  const activePage = navigation.find(item => item.path === location.pathname)?.label || '总览'
  const playgroundUrl = import.meta.env.VITE_PLAYGROUND_URL || 'http://127.0.0.1:5175'

  return <ScopeContext.Provider value={scope}>
    <div className="app-shell">
      {menuOpen && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-symbol"><Activity size={22} strokeWidth={2.3} /></span><span>WebScope<span className="brand-caption">前端监控</span></span><IconButton label="关闭导航" className="sidebar-close" onClick={() => setMenuOpen(false)}><X size={18} /></IconButton></div>
        <div className="workspace-label">工作空间</div>
        <div className="workspace-name"><span className="workspace-avatar">W</span><div>个人工作空间<small>LOCAL WORKSPACE</small></div><ChevronDown size={14} /></div>
        <div className="nav-caption">监控</div>
        <nav aria-label="主导航">{navigation.map(item => <NavLink key={item.path} to={item.path} end={item.path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span></NavLink>)}</nav>
        <div className="sidebar-bottom"><span className="version-tag">WS</span><div>WebScope<small>v0.1.0</small></div><span className="local-dot" /></div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-leading"><IconButton label="打开导航" className="mobile-menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></IconButton><span className="topbar-section">监控</span><ChevronRight size={14} className="topbar-chevron" /><span className="topbar-page">{activePage}</span></div>
          <div className="topbar-controls"><div className="application-select"><Layers3 size={16} /><select aria-label="选择应用" value={appId} onChange={event => changeApp(event.target.value)} disabled={!applications.length}>{applications.length ? applications.map(application => <option value={application.appId} key={application.appId}>{application.name}</option>) : <option value={appId}>{apps.loading ? '加载应用中' : apps.error ? '应用加载失败' : '暂无应用'}</option>}</select></div>
            <div className="range-switch" role="group" aria-label="时间范围">{[{ value: 1, label: '24 小时' }, { value: 7, label: '7 天' }, { value: 30, label: '30 天' }].map(item => <button type="button" key={item.value} className={days === item.value ? 'active' : ''} aria-pressed={days === item.value} onClick={() => setDays(item.value)}>{item.label}</button>)}</div>
            <IconButton label="刷新监控数据" onClick={scope.refresh}><RefreshCw size={17} /></IconButton>
          </div>
        </header>
        <main className="page-content"><Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></main>
        <footer className="footer"><span>WebScope <span className="footer-separator">/</span> {appName}</span><a href={playgroundUrl} target="_blank" rel="noreferrer">测试应用<ArrowUpRight size={13} /></a></footer>
      </div>
    </div>
  </ScopeContext.Provider>
}
