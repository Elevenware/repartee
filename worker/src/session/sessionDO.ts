import type { DiscoveryDoc, Flow, TokenResponse } from '@repartee/shared/contract'
import type { Env } from '../env'

export interface SessionData {
  id: string
  issuer?: string
  discovery?: DiscoveryDoc
  clientId?: string
  clientSecret?: string
  redirectURI?: string
  flow?: Flow
  scopes?: string[]
  state?: string
  nonce?: string
  codeVerifier?: string
  tokens?: TokenResponse
  updatedAt: number
}

// Minimal storage surface so the routing logic is unit-testable against an
// in-memory map without spinning up workerd.
export interface SessionStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
}

const STORAGE_KEY = 'session'

export async function dispatchSession(req: Request, storage: SessionStorage): Promise<Response> {
  const url = new URL(req.url)
  switch (url.pathname) {
    case '/get':
      return jsonOrNull(await storage.get<SessionData>(STORAGE_KEY))
    case '/put': {
      const data = (await req.json()) as SessionData
      await storage.put(STORAGE_KEY, { ...data, updatedAt: Date.now() })
      return new Response(null, { status: 204 })
    }
    case '/patch': {
      const patch = (await req.json()) as Partial<SessionData>
      const current = (await storage.get<SessionData>(STORAGE_KEY)) ?? { id: patch.id ?? '', updatedAt: 0 }
      const next: SessionData = { ...current, ...patch, updatedAt: Date.now() }
      await storage.put(STORAGE_KEY, next)
      return new Response(JSON.stringify(next), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    case '/delete':
      await storage.delete(STORAGE_KEY)
      return new Response(null, { status: 204 })
  }
  return new Response('not found', { status: 404 })
}

export class SessionStore {
  private storage: SessionStorage

  constructor(state: DurableObjectState, _env: Env) {
    this.storage = state.storage as unknown as SessionStorage
  }

  fetch(req: Request): Promise<Response> {
    return dispatchSession(req, this.storage)
  }
}

function jsonOrNull(data: SessionData | undefined): Response {
  return new Response(data ? JSON.stringify(data) : 'null', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
