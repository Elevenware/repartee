import { describe, expect, it } from 'vitest'
import { computeCapabilities } from '@repartee/shared/capabilities'
import type { DiscoveryDoc } from '@repartee/shared/contract'

const base: DiscoveryDoc = { issuer: 'https://op.example' }

describe('computeCapabilities', () => {
  it('detects S256 PKCE only when listed', () => {
    expect(computeCapabilities(base).pkce).toBe(false)
    expect(computeCapabilities({ ...base, code_challenge_methods_supported: ['plain'] }).pkce).toBe(false)
    expect(computeCapabilities({ ...base, code_challenge_methods_supported: ['plain', 'S256'] }).pkce).toBe(true)
  })

  it('treats missing grant_types_supported as auth_code-allowed', () => {
    expect(computeCapabilities(base).auth_code).toBe(true)
    expect(computeCapabilities({ ...base, grant_types_supported: [] }).auth_code).toBe(true)
    expect(computeCapabilities({ ...base, grant_types_supported: ['client_credentials'] }).auth_code).toBe(false)
    expect(computeCapabilities({ ...base, grant_types_supported: ['authorization_code', 'refresh_token'] }).auth_code).toBe(true)
  })

  it('flags client_credentials and refresh from grant_types_supported', () => {
    const caps = computeCapabilities({
      ...base,
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
    })
    expect(caps.client_credentials).toBe(true)
    expect(caps.refresh).toBe(true)
  })

  it('flags userinfo, logout, introspect by endpoint presence', () => {
    expect(computeCapabilities(base).userinfo).toBe(false)
    expect(computeCapabilities(base).logout).toBe(false)
    expect(computeCapabilities(base).introspect).toBe(false)
    const full = computeCapabilities({
      ...base,
      userinfo_endpoint: 'https://op.example/userinfo',
      end_session_endpoint: 'https://op.example/logout',
      introspection_endpoint: 'https://op.example/introspect',
    })
    expect(full.userinfo).toBe(true)
    expect(full.logout).toBe(true)
    expect(full.introspect).toBe(true)
  })
})
