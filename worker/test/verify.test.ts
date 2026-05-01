import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesToB64url, type Jwk } from '@repartee/shared/jwt'
import { verifyHandler } from '../src/handlers/verify'
import { loadOrCreateSession } from '../src/session/client'
import { fakeEnv } from './helpers/fakeEnv'

const encoder = new TextEncoder()

afterEach(() => {
  vi.unstubAllGlobals()
})

function b64urlJSON(value: unknown): string {
  return bytesToB64url(encoder.encode(JSON.stringify(value)))
}

async function signRS256(claims: Record<string, unknown>): Promise<{ token: string; publicJwk: Jwk }> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const headerB64 = b64urlJSON({ alg: 'RS256', typ: 'JWT', kid: 'k1' })
  const claimsB64 = b64urlJSON(claims)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(`${headerB64}.${claimsB64}`))
  const sigB64 = bytesToB64url(new Uint8Array(sig))
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk
  return { token: `${headerB64}.${claimsB64}.${sigB64}`, publicJwk: { ...publicJwk, kid: 'k1' } }
}

function verifyReq(body: unknown, cookie?: string): Request {
  return new Request('https://w/api/verify', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: JSON.stringify(body),
  })
}

describe('verifyHandler', () => {
  it('returns 400 on missing id_token', async () => {
    const env = fakeEnv()
    const r = await verifyHandler(verifyReq({}), env)
    expect(r.status).toBe(400)
  })

  it('verifies via user-provided JWK with no session', async () => {
    const env = fakeEnv()
    const { token, publicJwk } = await signRS256({ sub: 'alice' })
    const r = await verifyHandler(
      verifyReq({ id_token: token, key: JSON.stringify(publicJwk) }),
      env,
    )
    expect(r.status).toBe(200)
    const body = (await r.json()) as { valid: boolean; key_source: string; claims: Record<string, unknown> }
    expect(body.valid).toBe(true)
    expect(body.key_source).toBe('user')
    expect(body.claims.sub).toBe('alice')
  })

  it('falls back to JWKS from the session discovery doc', async () => {
    const env = fakeEnv()
    const { token, publicJwk } = await signRS256({ sub: 'bob' })

    const { session, setCookie } = await loadOrCreateSession(new Request('https://w/api/start'), env)
    await session.put({
      id: session.id,
      issuer: 'https://op.example',
      discovery: { issuer: 'https://op.example', jwks_uri: 'https://op.example/jwks' },
      updatedAt: 0,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const cookie = setCookie!.split(';')[0]
    const r = await verifyHandler(verifyReq({ id_token: token }, cookie), env)
    const body = (await r.json()) as { valid: boolean; key_source: string }
    expect(body.valid).toBe(true)
    expect(body.key_source).toBe('jwks')
  })

  it('returns valid:false with error when no key material and no session', async () => {
    const env = fakeEnv()
    const { token } = await signRS256({ sub: 'c' })
    const r = await verifyHandler(verifyReq({ id_token: token }), env)
    const body = (await r.json()) as { valid: boolean; error: string }
    expect(body.valid).toBe(false)
    expect(body.error).toContain('no key material')
  })
})
