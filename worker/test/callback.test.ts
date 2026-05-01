import { afterEach, describe, expect, it, vi } from 'vitest'
import { callbackHandler } from '../src/handlers/callback'
import { loadOrCreateSession } from '../src/session/client'
import type { SessionData } from '../src/session/sessionDO'
import { fakeEnv } from './helpers/fakeEnv'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface PreparedSession {
  cookie: string
  data: SessionData
}

async function preparedSession(env: ReturnType<typeof fakeEnv>, overrides: Partial<SessionData> = {}): Promise<PreparedSession> {
  const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
  const data: SessionData = {
    id: session.id,
    issuer: 'https://op.example',
    discovery: { issuer: 'https://op.example', token_endpoint: 'https://op.example/token' },
    clientId: 'cid',
    clientSecret: 'csecret',
    redirectURI: 'https://w/callback',
    scopes: ['openid'],
    flow: 'auth_code',
    state: 'STATE-EXPECTED',
    nonce: 'NONCE',
    updatedAt: 0,
    ...overrides,
  }
  await session.put(data)
  return { cookie: setCookie!.split(';')[0], data }
}

function callbackReq(cookie: string, qs: string): Request {
  return new Request(`https://w/callback?${qs}`, { headers: { cookie } })
}

describe('callbackHandler', () => {
  it('redirects to /?error=no_session when no cookie is present', async () => {
    const env = fakeEnv()
    const r = await callbackHandler(new Request('https://w/callback?code=abc&state=x'), env)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/?error=no_session')
  })

  it('redirects to /?error=no_session when the cookie is valid but the DO has no data', async () => {
    const env = fakeEnv()
    const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
    void session
    const cookie = setCookie!.split(';')[0]
    const r = await callbackHandler(callbackReq(cookie, 'code=abc&state=x'), env)
    expect(r.headers.get('location')).toBe('/?error=no_session')
  })

  it('forwards the OP error parameter (with description) into the redirect', async () => {
    const env = fakeEnv()
    const { cookie } = await preparedSession(env)
    const r = await callbackHandler(
      callbackReq(cookie, 'error=access_denied&error_description=user%20said%20no'),
      env,
    )
    expect(r.headers.get('location')).toBe('/?error=' + encodeURIComponent('access_denied: user said no'))
  })

  it('redirects to /?error=state_mismatch when state differs', async () => {
    const env = fakeEnv()
    const { cookie } = await preparedSession(env)
    const r = await callbackHandler(callbackReq(cookie, 'code=abc&state=WRONG'), env)
    expect(r.headers.get('location')).toBe('/?error=state_mismatch')
  })

  it('redirects to /?error=missing_code when code is absent', async () => {
    const env = fakeEnv()
    const { cookie } = await preparedSession(env)
    const r = await callbackHandler(callbackReq(cookie, 'state=STATE-EXPECTED'), env)
    expect(r.headers.get('location')).toBe('/?error=missing_code')
  })

  it('exchanges the code, persists tokens, and redirects to /?ok=1', async () => {
    const env = fakeEnv()
    const { cookie } = await preparedSession(env, { codeVerifier: 'V' })
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'AT', id_token: 'IT' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)

    const r = await callbackHandler(callbackReq(cookie, 'code=AUTHCODE&state=STATE-EXPECTED'), env)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/?ok=1')

    // Token endpoint was called with code + verifier
    const callBody = (fetcher.mock.calls[0][1] as RequestInit).body as string
    const params = new URLSearchParams(callBody)
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('AUTHCODE')
    expect(params.get('code_verifier')).toBe('V')
  })

  it('surfaces token-endpoint failures into the redirect', async () => {
    const env = fakeEnv()
    const { cookie } = await preparedSession(env)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } })),
    )
    const r = await callbackHandler(callbackReq(cookie, 'code=AUTHCODE&state=STATE-EXPECTED'), env)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toMatch(/^\/\?error=/)
    expect(decodeURIComponent(r.headers.get('location')!.replace('/?error=', ''))).toContain('invalid_grant')
  })
})
