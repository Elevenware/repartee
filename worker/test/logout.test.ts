import { describe, expect, it } from 'vitest'
import { logoutHandler } from '../src/handlers/logout'
import { loadOrCreateSession } from '../src/session/client'
import type { SessionData } from '../src/session/sessionDO'
import { fakeEnv } from './helpers/fakeEnv'

async function withPreparedSession(env: ReturnType<typeof fakeEnv>, overrides: Partial<SessionData> = {}) {
  const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
  await session.put({
    id: session.id,
    issuer: 'https://op.example',
    discovery: { issuer: 'https://op.example', end_session_endpoint: 'https://op.example/logout' },
    tokens: { id_token: 'ID-TOKEN' },
    updatedAt: 0,
    ...overrides,
  })
  return { cookie: setCookie!.split(';')[0], session }
}

describe('logoutHandler', () => {
  it('returns 400 when there is no session', async () => {
    const env = fakeEnv()
    const r = await logoutHandler(new Request('https://w/api/logout', { method: 'POST' }), env)
    expect(r.status).toBe(400)
  })

  it('returns 400 when the OP advertises no end_session_endpoint', async () => {
    const env = fakeEnv()
    const { cookie } = await withPreparedSession(env, { discovery: { issuer: 'https://op.example' } })
    const r = await logoutHandler(
      new Request('https://w/api/logout', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(400)
  })

  it('builds the end-session URL with id_token_hint and post_logout_redirect_uri, deletes the session, and expires the cookie', async () => {
    const env = fakeEnv({ REDIRECT_URI: 'https://w.example/callback' })
    const { cookie, session } = await withPreparedSession(env)

    const r = await logoutHandler(
      new Request('https://w/api/logout', { method: 'POST', headers: { cookie } }),
      env,
    )
    expect(r.status).toBe(200)
    const body = (await r.json()) as { redirect: string }
    const url = new URL(body.redirect)
    expect(url.origin + url.pathname).toBe('https://op.example/logout')
    expect(url.searchParams.get('id_token_hint')).toBe('ID-TOKEN')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://w.example/')

    expect(r.headers.get('set-cookie')).toMatch(/repartee_session=;/)
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0')

    expect(await session.get()).toBeNull()
  })

  it('omits id_token_hint when no id_token is in the session', async () => {
    const env = fakeEnv()
    const { cookie } = await withPreparedSession(env, { tokens: {} })
    const r = await logoutHandler(
      new Request('https://w/api/logout', { method: 'POST', headers: { cookie } }),
      env,
    )
    const body = (await r.json()) as { redirect: string }
    const url = new URL(body.redirect)
    expect(url.searchParams.get('id_token_hint')).toBeNull()
  })
})
