import type { DiscoverResponse, OidcRuntime, TokenResponse, TokensState, VerifyResult } from './types'

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers || {}) },
  })
  const text = await res.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in body)
      ? String((body as { error: unknown }).error)
      : `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  return body as T
}

export const bffRuntime: OidcRuntime = {
  mode: 'bff',
  discover(issuer: string) {
    return jsonFetch<DiscoverResponse>('/api/discover', {
      method: 'POST',
      body: JSON.stringify({ issuer }),
    })
  },
  start(input) {
    return jsonFetch<{ redirect?: string; tokens?: TokenResponse }>('/api/start', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  completeCallback() {
    return jsonFetch<TokensState>('/api/tokens')
  },
  tokens() {
    return jsonFetch<TokensState>('/api/tokens')
  },
  verify(id_token: string, key?: string) {
    return jsonFetch<VerifyResult>('/api/verify', {
      method: 'POST',
      body: JSON.stringify({ id_token, key }),
    })
  },
  userinfo() {
    return jsonFetch<Record<string, unknown>>('/api/userinfo', { method: 'POST' })
  },
  refresh() {
    return jsonFetch<TokenResponse>('/api/refresh', { method: 'POST' })
  },
  introspect() {
    return jsonFetch<Record<string, unknown>>('/api/introspect', { method: 'POST' })
  },
  logout() {
    return jsonFetch<{ redirect: string }>('/api/logout', { method: 'POST' })
  },
}

export const api = bffRuntime

export function fetchConfig(): Promise<{ rp_redirect_uri: string }> {
  return jsonFetch<{ rp_redirect_uri: string }>('/api/config')
}
