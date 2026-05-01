import { beforeEach, describe, expect, it } from 'vitest'
import { dispatchSession, type SessionData, type SessionStorage } from '../src/session/sessionDO'

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

const exampleData = (): SessionData => ({
  id: 'abc',
  issuer: 'https://op.example',
  scopes: ['openid', 'profile'],
  updatedAt: 0,
})

describe('dispatchSession', () => {
  let storage: MemoryStorage
  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('GET on an empty store returns null', async () => {
    const r = await dispatchSession(new Request('https://session/get'), storage)
    expect(await r.text()).toBe('null')
  })

  it('round-trips PUT then GET, stamping updatedAt', async () => {
    const before = Date.now()
    await dispatchSession(
      new Request('https://session/put', { method: 'POST', body: JSON.stringify(exampleData()) }),
      storage,
    )
    const r = await dispatchSession(new Request('https://session/get'), storage)
    const got = (await r.json()) as SessionData
    expect(got.id).toBe('abc')
    expect(got.issuer).toBe('https://op.example')
    expect(got.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('PATCH merges over existing data and bumps updatedAt', async () => {
    await dispatchSession(
      new Request('https://session/put', { method: 'POST', body: JSON.stringify(exampleData()) }),
      storage,
    )
    const r = await dispatchSession(
      new Request('https://session/patch', {
        method: 'POST',
        body: JSON.stringify({ scopes: ['openid'], state: 'xyz' }),
      }),
      storage,
    )
    const merged = (await r.json()) as SessionData
    expect(merged.id).toBe('abc')
    expect(merged.issuer).toBe('https://op.example')
    expect(merged.scopes).toEqual(['openid'])
    expect(merged.state).toBe('xyz')
  })

  it('PATCH on an empty store creates a session from the patch', async () => {
    const r = await dispatchSession(
      new Request('https://session/patch', {
        method: 'POST',
        body: JSON.stringify({ id: 'new', issuer: 'https://op.example' }),
      }),
      storage,
    )
    const created = (await r.json()) as SessionData
    expect(created.id).toBe('new')
    expect(created.issuer).toBe('https://op.example')
  })

  it('DELETE wipes the stored session', async () => {
    await dispatchSession(
      new Request('https://session/put', { method: 'POST', body: JSON.stringify(exampleData()) }),
      storage,
    )
    await dispatchSession(new Request('https://session/delete', { method: 'POST' }), storage)
    const r = await dispatchSession(new Request('https://session/get'), storage)
    expect(await r.text()).toBe('null')
  })

  it('returns 404 for an unknown DO sub-path', async () => {
    const r = await dispatchSession(new Request('https://session/bogus'), storage)
    expect(r.status).toBe(404)
  })
})
