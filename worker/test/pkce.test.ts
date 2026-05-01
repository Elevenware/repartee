import { describe, expect, it } from 'vitest'
import { base64urlEncode, newPKCE } from '@repartee/shared/pkce'

const VERIFIER_RE = /^[A-Za-z0-9_-]{43}$/
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

describe('newPKCE', () => {
  it('produces a 43-char base64url verifier and a 43-char base64url challenge', async () => {
    const { verifier, challenge } = await newPKCE()
    expect(verifier).toMatch(VERIFIER_RE)
    expect(challenge).toMatch(CHALLENGE_RE)
  })

  it('produces a different pair every call', async () => {
    const a = await newPKCE()
    const b = await newPKCE()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.challenge).not.toBe(b.challenge)
  })

  it('challenge is the SHA-256 of the verifier string, base64url-encoded', async () => {
    const { verifier, challenge } = await newPKCE()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    expect(base64urlEncode(new Uint8Array(digest))).toBe(challenge)
  })
})
