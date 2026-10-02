import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { databaseUrl } from '../src/config.js'

const require = createRequire(import.meta.url)
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prismaCli = require.resolve('prisma/build/index.js')
process.env.DATABASE_URL = databaseUrl()
// The schema engine's database-creation check needs info output; a shell RUST_LOG=warn suppresses it.
const cliEnvironment = { ...process.env, RUST_LOG: 'info' }
for (const command of [['generate'], ['db', 'push', '--skip-generate']]) {
  execFileSync(process.execPath, [prismaCli, ...command, '--schema', resolve(packageDirectory, 'prisma/schema.prisma')], {
    cwd: packageDirectory,
    env: cliEnvironment,
    stdio: 'inherit',
  })
}
const { createDatabase, seedApplications } = await import('../src/database.js')
const database = createDatabase()
try {
  await seedApplications(database)
  console.log('Applications are ready. Existing events were preserved.')
} finally {
  await database.$disconnect()
}
