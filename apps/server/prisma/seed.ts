import { createDatabase, seedApplications } from '../src/database.js'

const database = createDatabase()
try {
  await seedApplications(database)
  console.log('Created playground and survey-platform applications. No monitoring events were seeded.')
} finally {
  await database.$disconnect()
}
