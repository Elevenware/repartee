import { describe, expect, it } from 'vitest'
import { ConfigError, ensureCookieSigningKey } from '../src/config'
import { fakeEnv } from './helpers/fakeEnv'

describe('ensureCookieSigningKey', () => {
  it('passes silently when the key is set', () => {
    expect(() => ensureCookieSigningKey(fakeEnv())).not.toThrow()
  })

  it('throws ConfigError with a deploy hint when the key is missing', () => {
    const env = fakeEnv({ COOKIE_SIGNING_KEY: '' })
    try {
      ensureCookieSigningKey(env)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const e = err as ConfigError
      expect(e.message).toContain('COOKIE_SIGNING_KEY')
      expect(e.hint).toContain('wrangler secret put')
      expect(e.hint).toContain('.dev.vars')
    }
  })

  it('rejects whitespace-only values', () => {
    expect(() => ensureCookieSigningKey(fakeEnv({ COOKIE_SIGNING_KEY: '   ' }))).toThrow(ConfigError)
  })
})
