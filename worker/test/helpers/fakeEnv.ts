import type { Env } from '../../src/env'
import { dispatchSession, type SessionStorage } from '../../src/session/sessionDO'

class MemoryStorage implements SessionStorage {
  private map = new Map<string, unknown>()
  async get<T>(key: string) {
    return this.map.get(key) as T | undefined
  }
  async put<T>(key: string, value: T) {
    this.map.set(key, value)
  }
  async delete(key: string) {
    return this.map.delete(key)
  }
}

class FakeStub {
  constructor(private storage: MemoryStorage) {}
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const req = input instanceof Request ? input : new Request(input as string, init)
    return dispatchSession(req, this.storage)
  }
}

class FakeNamespace {
  private storages = new Map<string, MemoryStorage>()
  idFromName(name: string): { name: string; toString(): string } {
    return { name, toString: () => name }
  }
  get(id: { toString(): string }) {
    const key = id.toString()
    let s = this.storages.get(key)
    if (!s) {
      s = new MemoryStorage()
      this.storages.set(key, s)
    }
    return new FakeStub(s)
  }
}

export function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('', { status: 404 }) } as unknown as Fetcher,
    SESSIONS: new FakeNamespace() as unknown as DurableObjectNamespace,
    COOKIE_NAME: 'repartee_session',
    REDIRECT_URI: 'http://localhost:8787/callback',
    SESSION_TTL_SECONDS: '3600',
    COOKIE_SIGNING_KEY: btoa('a'.repeat(32)),
    ...overrides,
  }
}
