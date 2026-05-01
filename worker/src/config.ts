import type { Env } from './env'

// Thrown when a required deployment-time config value is missing or
// unusable. Index.ts catches these and surfaces a 500 with a deploy hint
// instead of letting the underlying Web Crypto / DO error bubble up
// opaquely.
export class ConfigError extends Error {
  hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'ConfigError'
    this.hint = hint
  }
}

const SIGNING_KEY_HINT =
  'Set it with: wrangler secret put COOKIE_SIGNING_KEY (value should be 32+ random bytes, base64-encoded). For local dev with `wrangler dev`, add it to worker/.dev.vars.'

export function ensureCookieSigningKey(env: Env): void {
  if (!env.COOKIE_SIGNING_KEY || env.COOKIE_SIGNING_KEY.trim() === '') {
    throw new ConfigError('COOKIE_SIGNING_KEY is not configured', SIGNING_KEY_HINT)
  }
}
