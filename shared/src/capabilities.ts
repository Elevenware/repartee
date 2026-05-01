import type { Capabilities, DiscoveryDoc } from './contract'

export function computeCapabilities(doc: DiscoveryDoc): Capabilities {
  const grants = doc.grant_types_supported ?? []
  return {
    pkce: hasS256(doc.code_challenge_methods_supported),
    auth_code: grants.length === 0 || containsAny(grants, 'authorization_code'),
    client_credentials: containsAny(grants, 'client_credentials'),
    userinfo: !!doc.userinfo_endpoint,
    refresh: containsAny(grants, 'refresh_token'),
    logout: !!doc.end_session_endpoint,
    introspect: !!doc.introspection_endpoint,
  }
}

export function hasS256(methods: string[] | undefined): boolean {
  return !!methods?.includes('S256')
}

export function containsAny(haystack: string[] | undefined, ...needles: string[]): boolean {
  if (!haystack) return false
  for (const h of haystack) {
    if (needles.includes(h)) return true
  }
  return false
}
