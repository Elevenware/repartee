import { afterEach, describe, expect, it, vi } from 'vitest'
import { userinfoHandler } from '../src/handlers/userinfo'
import { loadOrCreateSession } from '../src/session/client'
import type { SessionData } from '../src/session/sessionDO'
import { fakeEnv } from './helpers/fakeEnv'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function withPreparedSession(env: ReturnType<typeof fakeEnv>, overrides: Partial<SessionData> = {}): Promise<string> {
  const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
  await session.put({
    id: session.id,
    issuer: 'https://op.example',
    discovery: { issuer: 'https://op.example', userinfo_endpoint: 'https://op.example/userinfo' },
    tokens: { access_token: 'AT' },
    updatedAt: 0,
    ...overrides,
  })
  return setCookie!.split(';')[0]
}

describe('userinfoHandler', () => {
  it('returns 400 when there is no session', async () => {
    const env = fakeEnv()
    const r = await userinfoHandler(new Request('https://w/api/userinfo', { method: 'POST' }), env)
    expect(r.status).toBe(400)
  })

  it('returns 400 when the discovery doc has no userinfo_endpoint', async () => {
    const env = fakeEnv()
    const cookie = await withPreparedSession(env, {
      discovery: { issuer: 'https://op.example' },
    })
    const r = await userinfoHandler(
      new Request('https://w/api/userinfo', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(400)
  })

  it('passes the OP response through and sends a Bearer token', async () => {
    const env = fakeEnv()
    const cookie = await withPreparedSession(env)
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ sub: 'alice', email: 'a@x' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const r = await userinfoHandler(
      new Request('https://w/api/userinfo', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ sub: 'alice', email: 'a@x' })

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://op.example/userinfo')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer AT')
  })

  it('mirrors a non-200 OP status verbatim', async () => {
    const env = fakeEnv()
    const cookie = await withPreparedSession(env)
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('{"error":"invalid_token"}', { status: 401, headers: { 'content-type': 'application/json' } })))
    const r = await userinfoHandler(
      new Request('https://w/api/userinfo', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual({ error: 'invalid_token' })
  })
})
