import { describe, expect, it } from 'vitest'
import { tokensHandler } from '../src/handlers/tokens'
import { loadOrCreateSession } from '../src/session/client'
import { fakeEnv } from './helpers/fakeEnv'

describe('tokensHandler', () => {
  it('returns an empty body when there is no session cookie', async () => {
    const env = fakeEnv()
    const r = await tokensHandler(new Request('https://w/api/tokens'), env)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({})
  })

  it('returns an empty body when the cookie is tampered', async () => {
    const env = fakeEnv()
    // valid-shaped but unsigned-by-this-key
    const fakeCookie = `${'a'.repeat(32)}.${btoa('xx').replace(/=+$/, '')}`
    const r = await tokensHandler(
      new Request('https://w/api/tokens', { headers: { cookie: `repartee_session=${fakeCookie}` } }),
      env,
    )
    expect(await r.json()).toEqual({})
  })

  it('returns an empty body when the session exists but has no tokens', async () => {
    const env = fakeEnv()
    const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
    await session.put({ id: session.id, issuer: 'https://op.example', updatedAt: 0 })

    const cookie = setCookie!.split(';')[0]
    const r = await tokensHandler(
      new Request('https://w/api/tokens', { headers: { cookie } }),
      env,
    )
    expect(await r.json()).toEqual({})
  })

  it('returns the full TokensState when the session has tokens', async () => {
    const env = fakeEnv()
    const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
    await session.put({
      id: session.id,
      issuer: 'https://op.example',
      scopes: ['openid', 'profile'],
      flow: 'auth_code',
      codeVerifier: 'v',
      discovery: { issuer: 'https://op.example', jwks_uri: 'https://op.example/jwks' },
      tokens: { access_token: 'AT', id_token: 'IT' },
      updatedAt: 0,
    })

    const cookie = setCookie!.split(';')[0]
    const r = await tokensHandler(
      new Request('https://w/api/tokens', { headers: { cookie } }),
      env,
    )
    const body = (await r.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      tokens: { access_token: 'AT', id_token: 'IT' },
      issuer: 'https://op.example',
      scopes: ['openid', 'profile'],
      flow: 'auth_code',
      used_pkce: true,
      jwks_uri: 'https://op.example/jwks',
    })
  })
})
