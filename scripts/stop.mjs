import { readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const statePath = path.join(root, '.runtime/dev.json')
let state
try { state = JSON.parse(readFileSync(statePath, 'utf8')) } catch { console.log('No recorded WebScope dev server.'); process.exit(0) }
if (state.root !== root || !Number.isInteger(state.pid) || state.pid <= 0) throw new Error('Invalid dev process record')
if (process.platform === 'win32') {
  const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${state.pid}'; if ($p -and $p.CommandLine -like '*scripts*dev.mjs*') { taskkill /pid ${state.pid} /t /f }`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
} else {
  try { process.kill(state.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
}
rmSync(statePath, { force: true })
console.log('WebScope dev services stopped.')
