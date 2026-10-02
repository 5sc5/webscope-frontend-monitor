import { PrismaClient } from '@prisma/client'
import { databaseUrl } from './config.js'

export function createDatabase(url = databaseUrl()) {
  return new PrismaClient({ datasources: { db: { url: databaseUrl(url) } } })
}

export async function seedApplications(database: PrismaClient) {
  for (const application of [
    { appId: 'playground', name: 'SDK 验证台' },
    { appId: 'survey-platform', name: '问卷平台' },
  ]) {
    await database.application.upsert({
      where: { appId: application.appId },
      create: application,
      update: {},
    })
  }
}
