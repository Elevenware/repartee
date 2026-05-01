import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshHandler } from '../src/handlers/refresh'
import { loadOrCreateSession } from '../src/session/client'
import type { SessionData } from '../src/session/sessionDO'
import { fakeEnv } from './helpers/fakeEnv'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function withPreparedSession(env: ReturnType<typeof fakeEnv>, overrides: Partial<SessionData> = {}) {
  const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
  const data: SessionData = {
    id: session.id,
    issuer: 'https://op.example',
    discovery: { issuer: 'https://op.example', token_endpoint: 'https://op.example/token' },
    clientId: 'cid',
    clientSecret: 'csecret',
    tokens: { access_token: 'AT', refresh_token: 'OLD-RT' },
    updatedAt: 0,
    ...overrides,
  }
  await session.put(data)
  return { cookie: setCookie!.split(';')[0], session }
}

describe('refreshHandler', () => {
  it('returns 400 when there is no session', async () => {
    const env = fakeEnv()
    const r = await refreshHandler(new Request('https://w/api/refresh', { method: 'POST' }), env)
    expect(r.status).toBe(400)
  })

  it('persists fresh tokens and returns them on success', async () => {
    const env = fakeEnv()
    const { cookie, session } = await withPreparedSession(env)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ access_token: 'AT2', refresh_token: 'NEW-RT', token_type: 'Bearer' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const r = await refreshHandler(
      new Request('https://w/api/refresh', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(200)
    const body = (await r.json()) as { access_token: string; refresh_token: string }
    expect(body.access_token).toBe('AT2')
    expect(body.refresh_token).toBe('NEW-RT')

    const stored = await session.get()
    expect(stored?.tokens?.access_token).toBe('AT2')
    expect(stored?.tokens?.refresh_token).toBe('NEW-RT')
  })

  it('retains the prior refresh_token when the OP omits one in the response', async () => {
    const env = fakeEnv()
    const { cookie, session } = await withPreparedSession(env)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ access_token: 'AT2', token_type: 'Bearer' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const r = await refreshHandler(
      new Request('https://w/api/refresh', { method: 'POST', headers: { cookie } }),
      env,
    )
    const body = (await r.json()) as { access_token: string; refresh_token: string }
    expect(body.refresh_token).toBe('OLD-RT')
    const stored = await session.get()
    expect(stored?.tokens?.refresh_token).toBe('OLD-RT')
  })

  it('surfaces token-endpoint failures as 502', async () => {
    const env = fakeEnv()
    const { cookie } = await withPreparedSession(env)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const r = await refreshHandler(
      new Request('https://w/api/refresh', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(502)
  })
})
