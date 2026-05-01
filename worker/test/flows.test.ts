import { describe, expect, it, vi } from 'vitest'
import { OidcError, clientCredentials, exchangeCode, refreshTokens, tokenRequest } from '../src/oidc/flows'
import type { SessionData } from '../src/session/sessionDO'

const baseSession = (): SessionData => ({
  id: 'sid',
  issuer: 'https://op.example',
  discovery: { issuer: 'https://op.example', token_endpoint: 'https://op.example/token' },
  clientId: 'cid',
  clientSecret: 'csecret',
  redirectURI: 'https://w/callback',
  scopes: ['openid'],
  flow: 'auth_code',
  updatedAt: 0,
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('tokenRequest', () => {
  it('rejects when no token_endpoint is configured', async () => {
    const fetcher = vi.fn()
    await expect(
      tokenRequest({ endpoint: '', form: new URLSearchParams(), clientId: 'a', clientSecret: 'b' }, fetcher as unknown as typeof fetch),
    ).rejects.toThrow(/no token_endpoint/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sets RFC 7617 Basic auth (raw, no URL escaping) and form encoding', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>jsonResponse({ access_token: 'AT' }))
    await tokenRequest(
      {
        endpoint: 'https://op.example/token',
        form: new URLSearchParams({ grant_type: 'authorization_code' }),
        clientId: 'cid',
        clientSecret: 'csecret',
      },
      fetcher as unknown as typeof fetch,
    )
    const [, init] = fetcher.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe(`Basic ${btoa('cid:csecret')}`)
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect((init as RequestInit).body).toBe('grant_type=authorization_code')
  })

  it('throws OidcError with the parsed error code on a non-200 JSON body', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>jsonResponse({ error: 'invalid_grant', error_description: 'bad' }, 400))
    try {
      await tokenRequest(
        { endpoint: 'https://op.example/token', form: new URLSearchParams(), clientId: 'a', clientSecret: 'b' },
        fetcher as unknown as typeof fetch,
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OidcError)
      const e = err as OidcError
      expect(e.status).toBe(400)
      expect(e.code).toBe('invalid_grant')
      expect(e.message).toContain('invalid_grant')
    }
  })

  it('throws OidcError with no code when the upstream is non-JSON', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>new Response('plain error', { status: 502 }))
    try {
      await tokenRequest(
        { endpoint: 'https://op.example/token', form: new URLSearchParams(), clientId: 'a', clientSecret: 'b' },
        fetcher as unknown as typeof fetch,
      )
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OidcError)
      const e = err as OidcError
      expect(e.code).toBeUndefined()
      expect(e.body).toBe('plain error')
    }
  })
})

describe('exchangeCode', () => {
  it('sends authorization_code with code_verifier when one is present in the session', async () => {
    const sess = { ...baseSession(), codeVerifier: 'V' }
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>jsonResponse({ access_token: 'AT', id_token: 'IT' }))
    const tr = await exchangeCode(sess, 'CODE', fetcher as unknown as typeof fetch)
    expect(tr.access_token).toBe('AT')
    expect(tr.id_token).toBe('IT')
    const body = (fetcher.mock.calls[0][1] as RequestInit).body as string
    const parsed = new URLSearchParams(body)
    expect(parsed.get('grant_type')).toBe('authorization_code')
    expect(parsed.get('code')).toBe('CODE')
    expect(parsed.get('redirect_uri')).toBe('https://w/callback')
    expect(parsed.get('code_verifier')).toBe('V')
  })

  it('omits code_verifier when the session has none', async () => {
    const sess = baseSession()
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>jsonResponse({ access_token: 'AT' }))
    await exchangeCode(sess, 'CODE', fetcher as unknown as typeof fetch)
    const body = (fetcher.mock.calls[0][1] as RequestInit).body as string
    expect(new URLSearchParams(body).get('code_verifier')).toBeNull()
  })
})

describe('clientCredentials', () => {
  it('sends grant_type=client_credentials and the joined scope string', async () => {
    const sess = { ...baseSession(), scopes: ['openid', 'profile'] }
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>jsonResponse({ access_token: 'AT' }))
    await clientCredentials(sess, fetcher as unknown as typeof fetch)
    const body = (fetcher.mock.calls[0][1] as RequestInit).body as string
    const parsed = new URLSearchParams(body)
    expect(parsed.get('grant_type')).toBe('client_credentials')
    expect(parsed.get('scope')).toBe('openid profile')
  })
})

describe('refreshTokens', () => {
  it('rejects when the session has no refresh_token', async () => {
    const fetcher = vi.fn()
    await expect(refreshTokens(baseSession(), fetcher as unknown as typeof fetch)).rejects.toThrow(/no refresh token/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sends grant_type=refresh_token with the stored token', async () => {
    const sess = { ...baseSession(), tokens: { refresh_token: 'RT' } }
    const fetcher = vi.fn(async (_url: RequestInfo, _init?: RequestInit) =>jsonResponse({ access_token: 'AT2' }))
    await refreshTokens(sess, fetcher as unknown as typeof fetch)
    const body = (fetcher.mock.calls[0][1] as RequestInit).body as string
    const parsed = new URLSearchParams(body)
    expect(parsed.get('grant_type')).toBe('refresh_token')
    expect(parsed.get('refresh_token')).toBe('RT')
  })
})
