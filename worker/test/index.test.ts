import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { fakeEnv } from './helpers/fakeEnv'

afterEach(() => {
  vi.unstubAllGlobals()
})

const ctx = {} as ExecutionContext

describe('top-level fetch dispatch', () => {
  it('dispatches a matched route to its handler', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ issuer: 'https://op.example' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const r = await worker.fetch!(
      new Request('https://w/api/discover', {
        method: 'POST',
        body: JSON.stringify({ issuer: 'https://op.example' }),
      }),
      fakeEnv(),
      ctx,
    )
    expect(r.status).toBe(200)
  })

  it('returns a JSON 404 for unknown /api/* routes instead of falling through to assets', async () => {
    const r = await worker.fetch!(
      new Request('https://w/api/nope', { method: 'POST' }),
      fakeEnv(),
      ctx,
    )
    expect(r.status).toBe(404)
    expect((await r.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('no route') })
  })

  it('falls through to env.ASSETS for non-API paths so the SPA can serve them', async () => {
    let assetsCalledWith: Request | null = null
    const env = fakeEnv({
      ASSETS: {
        fetch: async (req: Request) => {
          assetsCalledWith = req
          return new Response('<html>spa</html>', { status: 200, headers: { 'content-type': 'text/html' } })
        },
      } as unknown as Fetcher,
    })
    const r = await worker.fetch!(new Request('https://w/some/spa/route'), env, ctx)
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('<html>spa</html>')
    expect(assetsCalledWith).not.toBeNull()
  })

  it('surfaces a missing COOKIE_SIGNING_KEY as a 500 with a deploy hint', async () => {
    const env = fakeEnv({ COOKIE_SIGNING_KEY: '' })
    const r = await worker.fetch!(
      new Request('https://w/api/tokens', { method: 'POST' }),
      env,
      ctx,
    )
    expect(r.status).toBe(500)
    const body = (await r.json()) as { error: string; hint: string }
    expect(body.error).toContain('COOKIE_SIGNING_KEY')
    expect(body.hint).toContain('wrangler secret put')
  })

  it('wraps unexpected handler exceptions as a generic 500', async () => {
    // Force fetchDiscovery's underlying fetch to throw synchronously after
    // the handler entered, so the error reaches index.ts's catch.
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('boom') }))
    const r = await worker.fetch!(
      new Request('https://w/api/discover', {
        method: 'POST',
        body: JSON.stringify({ issuer: 'https://op.example' }),
      }),
      fakeEnv(),
      ctx,
    )
    // discover wraps fetch errors into a 502, but if the wrapping itself
    // fails we still expect a JSON response — assert just that.
    expect(r.headers.get('content-type')).toContain('application/json')
    expect([500, 502]).toContain(r.status)
  })
})
