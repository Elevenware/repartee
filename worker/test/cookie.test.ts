import { describe, expect, it } from 'vitest'
import {
  newSessionId,
  parseCookieHeader,
  serialiseCookie,
  signSessionId,
  verifySessionCookie,
} from '../src/session/cookie'

const KEY = btoa('a'.repeat(32)) // 32 bytes, base64

describe('newSessionId', () => {
  it('returns 32 hex characters', () => {
    const id = newSessionId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('produces distinct IDs across calls', () => {
    const a = newSessionId()
    const b = newSessionId()
    expect(a).not.toBe(b)
  })
})

describe('signSessionId / verifySessionCookie', () => {
  it('round-trips a signed cookie', async () => {
    const id = newSessionId()
    const cookie = await signSessionId(id, KEY)
    expect(cookie.startsWith(`${id}.`)).toBe(true)
    expect(await verifySessionCookie(cookie, KEY)).toBe(id)
  })

  it('rejects a cookie signed with a different key', async () => {
    const id = newSessionId()
    const cookie = await signSessionId(id, KEY)
    const otherKey = btoa('b'.repeat(32))
    expect(await verifySessionCookie(cookie, otherKey)).toBeNull()
  })

  it('rejects a cookie whose ID payload was tampered with', async () => {
    const id = newSessionId()
    const cookie = await signSessionId(id, KEY)
    const tampered = newSessionId() + cookie.slice(32)
    expect(await verifySessionCookie(tampered, KEY)).toBeNull()
  })

  it('rejects a cookie whose signature was tampered with', async () => {
    const id = newSessionId()
    const cookie = await signSessionId(id, KEY)
    const tampered = cookie.slice(0, -2) + 'aa'
    expect(await verifySessionCookie(tampered, KEY)).toBeNull()
  })

  it('rejects a malformed cookie value', async () => {
    expect(await verifySessionCookie('no-dot-here', KEY)).toBeNull()
    expect(await verifySessionCookie('.', KEY)).toBeNull()
    expect(await verifySessionCookie('not-hex.abc', KEY)).toBeNull()
  })
})

describe('parseCookieHeader', () => {
  it('returns null for a missing header', () => {
    expect(parseCookieHeader(null, 'foo')).toBeNull()
  })

  it('finds a cookie among many', () => {
    const h = 'a=1; foo=bar; baz=qux'
    expect(parseCookieHeader(h, 'foo')).toBe('bar')
    expect(parseCookieHeader(h, 'baz')).toBe('qux')
    expect(parseCookieHeader(h, 'missing')).toBeNull()
  })
})

describe('serialiseCookie', () => {
  it('emits HttpOnly, Secure, SameSite=Lax, Path=/ by default', () => {
    const s = serialiseCookie({ name: 'k', value: 'v', maxAgeSeconds: 60 })
    expect(s).toContain('k=v')
    expect(s).toContain('Max-Age=60')
    expect(s).toContain('Path=/')
    expect(s).toContain('HttpOnly')
    expect(s).toContain('Secure')
    expect(s).toContain('SameSite=Lax')
  })

  it('omits Max-Age when not provided', () => {
    const s = serialiseCookie({ name: 'k', value: 'v' })
    expect(s).not.toContain('Max-Age')
  })
})
