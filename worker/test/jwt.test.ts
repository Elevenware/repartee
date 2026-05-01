import { describe, expect, it, vi } from 'vitest'
import { bytesToB64url, type Jwk, verifyToken } from '@repartee/shared/jwt'

const encoder = new TextEncoder()

function b64urlJSON(value: unknown): string {
  return bytesToB64url(encoder.encode(JSON.stringify(value)))
}

interface SignedToken {
  token: string
  publicJwk: Jwk
}

async function signRS256(claims: Record<string, unknown> = {}, headerExtra: Record<string, unknown> = {}): Promise<SignedToken> {
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
  return signWith(pair.privateKey, pair.publicKey, 'RSASSA-PKCS1-v1_5', { alg: 'RS256', typ: 'JWT', ...headerExtra }, claims)
}

async function signES256(claims: Record<string, unknown> = {}, headerExtra: Record<string, unknown> = {}): Promise<SignedToken> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  return signWith(pair.privateKey, pair.publicKey, { name: 'ECDSA', hash: 'SHA-256' }, { alg: 'ES256', typ: 'JWT', ...headerExtra }, claims)
}

async function signWith(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  algorithm: string | { name: string; hash?: string },
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): Promise<SignedToken> {
  const headerB64 = b64urlJSON(header)
  const claimsB64 = b64urlJSON(claims)
  const data = encoder.encode(`${headerB64}.${claimsB64}`)
  const sig = await crypto.subtle.sign(algorithm, privateKey, data)
  const sigB64 = bytesToB64url(new Uint8Array(sig))
  const publicJwk = (await crypto.subtle.exportKey('jwk', publicKey)) as Jwk
  return { token: `${headerB64}.${claimsB64}.${sigB64}`, publicJwk }
}

function jwksFetcher(jwks: { keys: Jwk[] }) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(jwks), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
}

describe('verifyToken', () => {
  it('round-trips an RS256 signature when given the public JWK directly', async () => {
    const { token, publicJwk } = await signRS256({ sub: 'alice' })
    const result = await verifyToken({ idToken: token, keyMaterial: JSON.stringify(publicJwk) })
    expect(result.valid).toBe(true)
    expect(result.alg).toBe('RS256')
    expect(result.key_source).toBe('user')
    expect(result.claims?.sub).toBe('alice')
  })

  it('round-trips an ES256 signature when given the public JWK directly', async () => {
    const { token, publicJwk } = await signES256({ sub: 'bob' })
    const result = await verifyToken({ idToken: token, keyMaterial: JSON.stringify(publicJwk) })
    expect(result.valid).toBe(true)
    expect(result.alg).toBe('ES256')
    expect(result.key_source).toBe('user')
  })

  it('fetches a JWKS and selects the key with the matching kid', async () => {
    const expected = await signRS256({}, { kid: 'k-2' })
    const decoy = await signRS256({}, { kid: 'k-1' })
    const fetcher = jwksFetcher({
      keys: [
        { ...decoy.publicJwk, kid: 'k-1' },
        { ...expected.publicJwk, kid: 'k-2' },
      ],
    })
    const result = await verifyToken({
      idToken: expected.token,
      jwksURI: 'https://op.example/jwks',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(result.valid).toBe(true)
    expect(result.kid).toBe('k-2')
    expect(result.key_source).toBe('jwks')
  })

  it('returns an error when the JWKS has no key matching the kid', async () => {
    const { token } = await signRS256({}, { kid: 'absent' })
    const fetcher = jwksFetcher({ keys: [{ kty: 'RSA', kid: 'other', n: 'x', e: 'AQAB' }] })
    const result = await verifyToken({
      idToken: token,
      jwksURI: 'https://op.example/jwks',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('no matching key')
  })

  it('returns an error when JWKS fetch fails with a non-200', async () => {
    const { token } = await signRS256({}, { kid: 'x' })
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('boom', { status: 500, statusText: 'Server Error' }),
    )
    const result = await verifyToken({
      idToken: token,
      jwksURI: 'https://op.example/jwks',
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("couldn't fetch JWKS")
  })

  it('returns an error when neither key material nor jwksURI is provided', async () => {
    const { token } = await signRS256()
    const result = await verifyToken({ idToken: token })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('no key material')
  })

  it('rejects a malformed JWT', async () => {
    const result = await verifyToken({ idToken: 'not.a-jwt', keyMaterial: '{}' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('not a JWT')
  })

  it('rejects alg=none even if a key is supplied', async () => {
    const headerB64 = b64urlJSON({ alg: 'none', typ: 'JWT' })
    const claimsB64 = b64urlJSON({ sub: 'alice' })
    const token = `${headerB64}.${claimsB64}.`
    const result = await verifyToken({ idToken: token, keyMaterial: '{}' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('alg=none')
  })

  it('returns signature mismatch when the token was signed by a different key', async () => {
    const { token } = await signRS256()
    const { publicJwk: otherJwk } = await signRS256()
    const result = await verifyToken({ idToken: token, keyMaterial: JSON.stringify(otherJwk) })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('signature mismatch')
  })

  it('rejects an unsupported alg', async () => {
    const headerB64 = b64urlJSON({ alg: 'HS256', typ: 'JWT' })
    const claimsB64 = b64urlJSON({})
    const result = await verifyToken({ idToken: `${headerB64}.${claimsB64}.x`, keyMaterial: '{}' })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('unsupported alg')
  })
})
