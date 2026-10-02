import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleParent = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDirectory = basename(moduleParent) === 'dist' ? resolve(moduleParent, '..') : moduleParent

export function databaseUrl(input = process.env.DATABASE_URL ?? 'file:./dev.db') {
  if (!input.startsWith('file:')) return input
  const separator = input.indexOf('?')
  const path = input.slice(5, separator < 0 ? undefined : separator)
  const parameters = separator < 0 ? '' : input.slice(separator)
  const absolutePath = isAbsolute(path) ? path : resolve(packageDirectory, 'prisma', path)
  return `file:${absolutePath.replaceAll('\\', '/')}${parameters}`
}
