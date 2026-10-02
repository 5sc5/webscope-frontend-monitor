const sensitiveKey = /password|passwd|secret|token|authorization|cookie|credential|api[-_]?key/i

export function sanitizeUrl(input: string): string {
  try {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(input)
    const url = new URL(input, 'http://local.invalid')
    url.username = ''
    url.password = ''
    for (const key of url.searchParams.keys()) {
      if (sensitiveKey.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    url.hash = ''
    return absolute ? url.href : `${url.pathname}${url.search}`
  } catch {
    return input.slice(0, 2048)
  }
}

export function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 10) return '[TRUNCATED]'
  if (Array.isArray(value)) return value.map(item => sanitizeJson(item, depth + 1))
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = Object.create(null)
    for (const [key, item] of Object.entries(value)) {
      output[key] = sensitiveKey.test(key)
        ? '[REDACTED]'
        : typeof item === 'string' && /^(url|href|src)$/i.test(key)
          ? sanitizeUrl(item)
          : sanitizeJson(item, depth + 1)
    }
    return output
  }
  return value
}
