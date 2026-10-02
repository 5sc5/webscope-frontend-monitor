import { useEffect, useState } from 'react'

export function query(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  return `${path}?${search.toString()}`
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string | { code?: string; message?: string }; message?: string } | null
    const serverError = payload?.error
    const knownErrors: Record<string, string> = {
      APPLICATION_EXISTS: '应用标识已存在',
      APPLICATION_NOT_FOUND: '应用不存在',
      EVENT_NOT_FOUND: '事件不存在',
      INTERNAL_ERROR: '服务暂时不可用',
    }
    const message = typeof serverError === 'string'
      ? serverError
      : serverError?.code && knownErrors[serverError.code] || serverError?.message || payload?.message
    throw new Error(message || `请求失败 (${response.status})`)
  }
  return response.json() as Promise<T>
}

export function useResource<T>(path: string | null, refreshKey = 0) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: !!path,
    error: null,
  })
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null })
      return
    }
    const controller = new AbortController()
    setState({ data: null, loading: true, error: null })
    request<T>(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ data, loading: false, error: null }) })
      .catch(error => {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: String(error.message || error) })
      })
    return () => controller.abort()
  }, [path, refreshKey, retryKey])

  return { ...state, retry: () => setRetryKey(key => key + 1) }
}
