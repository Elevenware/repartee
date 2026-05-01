import { afterEach, describe, expect, it, vi } from 'vitest'
import { introspectHandler } from '../src/handlers/introspect'
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
    discovery: { issuer: 'https://op.example', introspection_endpoint: 'https://op.example/introspect' },
    clientId: 'cid',
    clientSecret: 'csecret',
    tokens: { access_token: 'AT' },
    updatedAt: 0,
    ...overrides,
  })
  return setCookie!.split(';')[0]
}

describe('introspectHandler', () => {
  it('returns 400 when there is no session', async () => {
    const env = fakeEnv()
    const r = await introspectHandler(new Request('https://w/api/introspect', { method: 'POST' }), env)
    expect(r.status).toBe(400)
  })

  it('returns 400 when the OP advertises no introspection_endpoint', async () => {
    const env = fakeEnv()
    const cookie = await withPreparedSession(env, { discovery: { issuer: 'https://op.example' } })
    const r = await introspectHandler(
      new Request('https://w/api/introspect', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(400)
  })

  it('posts the form with Basic auth and passes the response through', async () => {
    const env = fakeEnv()
    const cookie = await withPreparedSession(env)
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ active: true, sub: 'alice' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const r = await introspectHandler(
      new Request('https://w/api/introspect', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ active: true, sub: 'alice' })

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://op.example/introspect')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe(`Basic ${btoa('cid:csecret')}`)
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams((init as RequestInit).body as string)
    expect(body.get('token')).toBe('AT')
    expect(body.get('token_type_hint')).toBe('access_token')
  })
})
