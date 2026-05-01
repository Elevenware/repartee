import { describe, expect, it } from 'vitest'
import { configHandler } from '../src/handlers/config'
import { fakeEnv } from './helpers/fakeEnv'

describe('configHandler', () => {
  it('returns the REDIRECT_URI as rp_redirect_uri', async () => {
    const env = fakeEnv({ REDIRECT_URI: 'https://app.example/callback' })
    const r = configHandler(new Request('https://w/api/config'), env)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { rp_redirect_uri: string }
    expect(body.rp_redirect_uri).toBe('https://app.example/callback')
  })

  it('returns an empty string when REDIRECT_URI is not set', async () => {
    const env = fakeEnv({ REDIRECT_URI: '' })
    const r = configHandler(new Request('https://w/api/config'), env)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { rp_redirect_uri: string }
    expect(body.rp_redirect_uri).toBe('')
  })

  it('only exposes rp_redirect_uri (no other env vars)', async () => {
    const env = fakeEnv()
    const r = configHandler(new Request('https://w/api/config'), env)
    const body = await r.json()
    expect(Object.keys(body as object)).toEqual(['rp_redirect_uri'])
  })
})
