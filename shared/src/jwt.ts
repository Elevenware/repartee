// JWT signature verification over Web Crypto. Shared between the Worker BFF
// (POST /api/verify) and the browser runtime (browserRuntime.verify). Both
// runtimes only verify the signature; they deliberately don't validate
// iss/aud/exp/nonce — the Go BFF doesn't either, and §Risks #4 in the plan
// flags expanding scope as a future decision.

import type { VerifyResult } from './contract'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface DecodedJwt {
  encodedHeader: string
  encodedClaims: string
  signature: string
  header: Record<string, unknown>
  claims: Record<string, unknown>
}

export function decodeJWT(token: string): DecodedJwt | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return {
      encodedHeader: parts[0],
      encodedClaims: parts[1],
      signature: parts[2],
      header: b64urlJSON(parts[0]),
      claims: b64urlJSON(parts[1]),
    }
  } catch {
    return null
  }
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function b64urlBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlJSON(value: string): Record<string, unknown> {
  return JSON.parse(decoder.decode(b64urlBytes(value))) as Record<string, unknown>
}

// Structural shape so this file compiles under both DOM and
// @cloudflare/workers-types, which use different names (RsaHashedImportParams
// vs SubtleCryptoImportKeyAlgorithm). The actual algorithm objects are passed
// straight through to crypto.subtle and validated by each runtime there.
interface CryptoAlgParams {
  name: string
  hash?: string
  namedCurve?: string
  saltLength?: number
}

export interface WebCryptoAlg {
  importAlgorithm: CryptoAlgParams
  verifyAlgorithm: CryptoAlgParams
  jwkAlg: string
}

export function algorithmFor(alg: string): WebCryptoAlg | null {
  switch (alg) {
    case 'RS256': return { importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAlgorithm: { name: 'RSASSA-PKCS1-v1_5' }, jwkAlg: alg }
    case 'RS384': return { importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, verifyAlgorithm: { name: 'RSASSA-PKCS1-v1_5' }, jwkAlg: alg }
    case 'RS512': return { importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, verifyAlgorithm: { name: 'RSASSA-PKCS1-v1_5' }, jwkAlg: alg }
    case 'PS256': return { importAlgorithm: { name: 'RSA-PSS', hash: 'SHA-256' }, verifyAlgorithm: { name: 'RSA-PSS', saltLength: 32 }, jwkAlg: alg }
    case 'PS384': return { importAlgorithm: { name: 'RSA-PSS', hash: 'SHA-384' }, verifyAlgorithm: { name: 'RSA-PSS', saltLength: 48 }, jwkAlg: alg }
    case 'PS512': return { importAlgorithm: { name: 'RSA-PSS', hash: 'SHA-512' }, verifyAlgorithm: { name: 'RSA-PSS', saltLength: 64 }, jwkAlg: alg }
    case 'ES256': return { importAlgorithm: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-256' }, jwkAlg: alg }
    case 'ES384': return { importAlgorithm: { name: 'ECDSA', namedCurve: 'P-384' }, verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-384' }, jwkAlg: alg }
    case 'ES512': return { importAlgorithm: { name: 'ECDSA', namedCurve: 'P-521' }, verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-512' }, jwkAlg: alg }
    default: return null
  }
}

export interface Jwk {
  kty: string
  kid?: string
  alg?: string
  use?: string
  key_ops?: string[]
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
  ext?: boolean
}

export function findJwk(keys: Jwk[], kid: string | undefined): Jwk | null {
  if (kid) return keys.find((k) => k.kid === kid) ?? null
  return keys[0] ?? null
}

export function prepareJwk(jwk: Jwk, algorithm: WebCryptoAlg): JsonWebKey {
  const clean: Jwk = { ...jwk }
  delete clean.key_ops
  return { ...clean, alg: jwk.alg ?? algorithm.jwkAlg, ext: true } as JsonWebKey
}

// Accepts JWK JSON (string starting with `{`) or PEM SPKI ("-----BEGIN PUBLIC KEY-----").
// PKCS#1 ("RSA PUBLIC KEY") and CERTIFICATE PEM are not supported here — the
// Go BFF accepts them via x509, but Web Crypto only ingests SPKI directly.
// Documented limitation per the plan.
export async function jwkFromUserKey(material: string, algorithm: WebCryptoAlg): Promise<Jwk> {
  const trimmed = material.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Jwk
  if (!trimmed.includes('-----BEGIN PUBLIC KEY-----')) {
    throw new Error('expected JWK JSON or PEM PUBLIC KEY (SPKI)')
  }
  const body = trimmed
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
  const spki = b64urlBytes(body.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
  const key = await crypto.subtle.importKey('spki', spki, algorithm.importAlgorithm, true, ['verify'])
  return crypto.subtle.exportKey('jwk', key) as Promise<Jwk>
}

export interface VerifyTokenInput {
  idToken: string
  keyMaterial?: string
  jwksURI?: string
  fetcher?: typeof fetch
}

export async function verifyToken(input: VerifyTokenInput): Promise<VerifyResult> {
  const decoded = decodeJWT(input.idToken)
  if (!decoded) return { valid: false, error: 'not a JWT (expected 3 parts)' }

  const result: VerifyResult = {
    valid: false,
    header: decoded.header,
    claims: decoded.claims,
  }
  if (typeof decoded.header.alg === 'string') result.alg = decoded.header.alg
  if (typeof decoded.header.kid === 'string') result.kid = decoded.header.kid
  if (!result.alg) return { ...result, error: 'no alg in JWT header' }
  if (result.alg === 'none') return { ...result, error: 'alg=none is not accepted' }

  const algorithm = algorithmFor(result.alg)
  if (!algorithm) return { ...result, error: `unsupported alg: ${result.alg}` }

  let jwk: Jwk
  try {
    if (input.keyMaterial?.trim()) {
      jwk = await jwkFromUserKey(input.keyMaterial, algorithm)
      result.key_source = 'user'
    } else if (input.jwksURI) {
      const fetcher = input.fetcher ?? fetch
      const resp = await fetcher(input.jwksURI, { headers: { accept: 'application/json' } })
      if (!resp.ok) {
        return { ...result, error: `couldn't fetch JWKS: ${resp.status} ${resp.statusText}` }
      }
      const jwks = (await resp.json()) as { keys?: Jwk[] }
      const match = findJwk(jwks.keys ?? [], result.kid)
      if (!match) {
        return { ...result, error: `no matching key in JWKS: no JWK with kid="${result.kid ?? ''}"` }
      }
      jwk = match
      result.key_source = 'jwks'
    } else {
      return { ...result, error: 'no key material and no JWKS URI to fall back to' }
    }
  } catch (err) {
    return { ...result, error: `couldn't parse pasted key: ${(err as Error).message}` }
  }

  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('jwk', prepareJwk(jwk, algorithm), algorithm.importAlgorithm, false, ['verify'])
  } catch (err) {
    return { ...result, error: `couldn't import key: ${(err as Error).message}` }
  }

  const ok = await crypto.subtle.verify(
    algorithm.verifyAlgorithm,
    key,
    b64urlBytes(decoded.signature),
    encoder.encode(`${decoded.encodedHeader}.${decoded.encodedClaims}`),
  )
  return ok ? { ...result, valid: true } : { ...result, error: 'signature mismatch' }
}
