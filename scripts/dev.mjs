import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'

const root = fileURLToPath(new URL('../', import.meta.url))
const statePath = path.join(root, '.runtime/dev.json')
if (existsSync(statePath)) {
  let previous
  try { previous = JSON.parse(readFileSync(statePath, 'utf8')) } catch { /* A stale record may be overwritten. */ }
  if (previous?.root === root && Number.isInteger(previous.pid)) {
    let running = false
    try { process.kill(previous.pid, 0); running = true } catch { /* Previous process exited. */ }
    if (running) {
      console.log(`WebScope is already running: http://127.0.0.1:${previous.dashboardPort}`)
      process.exit(0)
    }
  }
}
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
if (!existsSync(npmCli)) throw new Error('Run this project with npm run dev.')
const used = new Set()
async function freePort(start) {
  for (let port = start; port < start + 30; port++) {
    if (used.has(port)) continue
    const available = await new Promise(resolve => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (available) { used.add(port); return port }
  }
  throw new Error(`No available port near ${start}`)
}

const apiPort = await freePort(Number(process.env.API_PORT || 3301))
const dashboardPort = await freePort(Number(process.env.DASHBOARD_PORT || 5174))
const playgroundPort = await freePort(Number(process.env.PLAYGROUND_PORT || 5175))
const env = {
  ...process.env,
  PORT: String(apiPort),
  API_PORT: String(apiPort),
  DASHBOARD_PORT: String(dashboardPort),
  PLAYGROUND_PORT: String(playgroundPort),
  VITE_PLAYGROUND_URL: `http://127.0.0.1:${playgroundPort}`,
  VITE_DASHBOARD_URL: `http://127.0.0.1:${dashboardPort}`,
}
const services = [
  ['api', '@webscope/server'],
  ['dashboard', '@webscope/dashboard'],
  ['playground', '@webscope/playground'],
]
const children = []
let closing = false
mkdirSync(path.join(root, '.runtime'), { recursive: true })
writeFileSync(statePath, JSON.stringify({ pid: process.pid, root, apiPort, dashboardPort, playgroundPort }, null, 2))
function stop(code = 0) {
  if (closing) return
  closing = true
  rmSync(statePath, { force: true })
  for (const child of children) {
    if (child.exitCode !== null) continue
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 600)
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
console.log(`WebScope dashboard: http://127.0.0.1:${dashboardPort}`)
console.log(`SDK playground:    http://127.0.0.1:${playgroundPort}`)
console.log(`API:               http://127.0.0.1:${apiPort}`)
for (const [name, workspace] of services) {
  const child = spawn(process.execPath, [npmCli, 'run', 'dev', '--workspace', workspace], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => process.stdout.write(`[${name}] ${data}`))
  child.on('error', error => { console.error(`[${name}] ${error.message}`); stop(1) })
  child.on('exit', code => { if (!closing) { console.error(`[${name}] stopped (${code})`); stop(code || 1) } })
}
