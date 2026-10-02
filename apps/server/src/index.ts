import { createApp } from './app.js'
import { createDatabase, seedApplications } from './database.js'

const database = createDatabase()
await database.$connect()
await seedApplications(database)
const app = createApp(database)
app.on('error', error => console.error('[WebScope API]', error))
const port = Number(process.env.PORT ?? 3301)
const host = process.env.HOST ?? '127.0.0.1'
const server = app.listen(port, host, () => console.log(`WebScope API: http://${host}:${port}`))

async function shutdown() {
  server.close(async () => {
    await database.$disconnect()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
