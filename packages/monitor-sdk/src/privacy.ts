const sensitiveKey = /password|passwd|token|authorization|cookie|secret|api[-_]?key|credential/i
const maxStringLength = 2000

export function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passwd|token|authorization|secret|api[_-]?key)\s*[=:]\s*)[^\s&,;]+/gi, '$1[REDACTED]')
    .slice(0, maxStringLength)
}

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href)
    url.username = ''
    url.password = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (sensitiveKey.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    // Fragments can contain OAuth tokens and are not needed to identify a page.
    url.hash = ''
    return sanitizeText(url.toString())
  } catch {
    return sanitizeText(value)
  }
}

export function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'string') return sanitizeText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return `[${typeof value}]`
  if (seen.has(value)) return '[Circular]'
  if (depth >= 5) return '[Truncated]'
  seen.add(value)
  if (value instanceof Error) {
    return { name: sanitizeText(value.name), message: sanitizeText(value.message), stack: sanitizeText(value.stack ?? '') }
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1, seen))
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).slice(0, 30)) {
    if (sensitiveKey.test(key)) {
      result[key] = '[REDACTED]'
      continue
    }
    try {
      const item = (value as Record<string, unknown>)[key]
      result[key] = typeof item === 'string' && /^(?:url|href|src)$/i.test(key)
        ? sanitizeUrl(item)
        : sanitize(item, depth + 1, seen)
    } catch {
      result[key] = '[Unreadable]'
    }
  }
  return result
}

export function describeError(reason: unknown): { message: string; detail: Record<string, unknown> } {
  if (reason instanceof Error || (reason !== null && typeof reason === 'object' && typeof (reason as { message?: unknown }).message === 'string')) {
    const error = reason as { message: string; name?: string; stack?: string }
    return { message: error.message || error.name || 'Unknown error', detail: { name: error.name ?? 'Error', stack: error.stack ?? '' } }
  }
  const normalized = sanitize(reason)
  return {
    message: typeof normalized === 'string' ? normalized : JSON.stringify(normalized) ?? String(reason),
    detail: { reason: normalized },
  }
}
