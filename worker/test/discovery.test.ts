import { describe, expect, it, vi } from 'vitest'
import { DiscoveryError, fetchDiscovery } from '../src/oidc/discovery'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('fetchDiscovery', () => {
  it('returns the parsed doc and the raw value for a 200', async () => {
    const doc = {
      issuer: 'https://op.example',
      token_endpoint: 'https://op.example/token',
      grant_types_supported: ['authorization_code'],
    }
    const fetcher = vi.fn(async () => jsonResponse(doc))
    const result = await fetchDiscovery('https://op.example', fetcher as unknown as typeof fetch)
    expect(result.doc.issuer).toBe('https://op.example')
    expect(result.raw).toEqual(doc)
    expect(fetcher).toHaveBeenCalledWith(
      'https://op.example/.well-known/openid-configuration',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('trims trailing slashes and surrounding whitespace from the issuer', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ issuer: 'x' }))
    await fetchDiscovery('  https://op.example///  ', fetcher as unknown as typeof fetch)
    expect(fetcher).toHaveBeenCalledWith(
      'https://op.example/.well-known/openid-configuration',
      expect.anything(),
    )
  })

  it('rejects an empty or whitespace-only issuer', async () => {
    const fetcher = vi.fn()
    await expect(fetchDiscovery('   ', fetcher as unknown as typeof fetch)).rejects.toBeInstanceOf(DiscoveryError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('throws DiscoveryError including the status and a truncated body for non-200', async () => {
    const longBody = 'x'.repeat(500)
    const fetcher = vi.fn(async () => new Response(longBody, { status: 503 }))
    await expect(fetchDiscovery('https://op.example', fetcher as unknown as typeof fetch))
      .rejects.toThrow(/503/)
  })

  it('throws DiscoveryError when the body is not JSON', async () => {
    const fetcher = vi.fn(async () => new Response('not-json', { status: 200 }))
    await expect(fetchDiscovery('https://op.example', fetcher as unknown as typeof fetch))
      .rejects.toThrow(/decoding discovery/)
  })

  it('wraps fetch transport failures in DiscoveryError', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('connection refused')
    })
    await expect(fetchDiscovery('https://op.example', fetcher as unknown as typeof fetch))
      .rejects.toThrow(/connection refused/)
  })
})
