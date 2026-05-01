import { afterEach, describe, expect, it, vi } from 'vitest'
import { startHandler } from '../src/handlers/start'
import { fakeEnv } from './helpers/fakeEnv'

const baseDiscovery = {
  issuer: 'https://op.example',
  authorization_endpoint: 'https://op.example/authorize',
  token_endpoint: 'https://op.example/token',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function startReq(body: unknown): Request {
  return new Request('https://w/api/start', { method: 'POST', body: JSON.stringify(body) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startHandler', () => {
  it('rejects bad JSON with 400', async () => {
    const env = fakeEnv()
    vi.stubGlobal('fetch', vi.fn())
    const r = await startHandler(
      new Request('https://w/api/start', { method: 'POST', body: 'not json' }),
      env,
    )
    expect(r.status).toBe(400)
  })

  it('returns 502 when discovery fails', async () => {
    const env = fakeEnv()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const r = await startHandler(
      startReq({
        issuer: 'https://op.example',
        client_id: 'cid',
        client_secret: 'csecret',
        scopes: ['openid'],
        flow: 'auth_code',
        use_pkce: true,
      }),
      env,
    )
    expect(r.status).toBe(502)
  })

  it('auth_code with PKCE returns a redirect URL with all required params and sets a cookie', async () => {
    const env = fakeEnv()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(baseDiscovery)))
    const r = await startHandler(
      startReq({
        issuer: 'https://op.example',
        client_id: 'cid',
        client_secret: 'csecret',
        scopes: ['openid', 'profile'],
        flow: 'auth_code',
        use_pkce: true,
      }),
      env,
    )
    expect(r.status).toBe(200)
    expect(r.headers.get('set-cookie')).toMatch(/^repartee_session=/)
    const body = (await r.json()) as { redirect: string }
    const url = new URL(body.redirect)
    expect(url.origin + url.pathname).toBe('https://op.example/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(env.REDIRECT_URI)
    expect(url.searchParams.get('scope')).toBe('openid profile')
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/)
    expect(url.searchParams.get('nonce')).toMatch(/^[0-9a-f]{32}$/)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('auth_code without PKCE omits code_challenge params', async () => {
    const env = fakeEnv()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(baseDiscovery)))
    const r = await startHandler(
      startReq({
        issuer: 'https://op.example',
        client_id: 'cid',
        client_secret: 'csecret',
        scopes: ['openid'],
        flow: 'auth_code',
        use_pkce: false,
      }),
      env,
    )
    const body = (await r.json()) as { redirect: string }
    const url = new URL(body.redirect)
    expect(url.searchParams.get('code_challenge')).toBeNull()
    expect(url.searchParams.get('code_challenge_method')).toBeNull()
  })

  it('returns 502 when the discovery doc has no authorization_endpoint', async () => {
    const env = fakeEnv()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ issuer: 'https://op.example' })))
    const r = await startHandler(
      startReq({
        issuer: 'https://op.example',
        client_id: 'cid',
        client_secret: 'csecret',
        scopes: ['openid'],
        flow: 'auth_code',
        use_pkce: true,
      }),
      env,
    )
    expect(r.status).toBe(502)
  })

  it('client_credentials calls the token endpoint and returns tokens directly', async () => {
    const env = fakeEnv()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(baseDiscovery))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'AT', token_type: 'Bearer' }))
    vi.stubGlobal('fetch', fetcher)

    const r = await startHandler(
      startReq({
        issuer: 'https://op.example',
        client_id: 'cid',
        client_secret: 'csecret',
        scopes: ['svc'],
        flow: 'client_credentials',
        use_pkce: false,
      }),
      env,
    )
    expect(r.status).toBe(200)
    const body = (await r.json()) as { tokens: { access_token: string } }
    expect(body.tokens.access_token).toBe('AT')

    // Confirms the token endpoint was actually called with client_credentials.
    const tokenCall = fetcher.mock.calls[1]
    expect(tokenCall[0]).toBe('https://op.example/token')
    const ccBody = (tokenCall[1] as RequestInit).body as string
    expect(new URLSearchParams(ccBody).get('grant_type')).toBe('client_credentials')
    expect(new URLSearchParams(ccBody).get('scope')).toBe('svc')
  })
})
