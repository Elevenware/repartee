import { describe, expect, it } from 'vitest'
import worker from '../src/index'
import { fakeEnv } from './helpers/fakeEnv'

const ctx = {} as ExecutionContext

describe('GET /config', () => {
  it('returns rp_redirect_uri from REDIRECT_URI env binding', async () => {
    const env = fakeEnv({ REDIRECT_URI: 'https://app.example.com/callback' })
    const r = await worker.fetch!(new Request('https://w/config'), env, ctx)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('application/json')
    const body = (await r.json()) as { rp_redirect_uri: string }
    expect(body.rp_redirect_uri).toBe('https://app.example.com/callback')
  })

  it('returns an empty string when REDIRECT_URI is not set', async () => {
    const env = fakeEnv({ REDIRECT_URI: '' })
    const r = await worker.fetch!(new Request('https://w/config'), env, ctx)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { rp_redirect_uri: string }
    expect(body.rp_redirect_uri).toBe('')
  })
})
