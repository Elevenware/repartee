export interface DiscoveryDoc {
  issuer: string
  authorization_endpoint?: string
  token_endpoint?: string
  userinfo_endpoint?: string
  jwks_uri?: string
  end_session_endpoint?: string
  introspection_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
  grant_types_supported?: string[]
  response_types_supported?: string[]
}

export interface Capabilities {
  pkce: boolean
  auth_code: boolean
  client_credentials: boolean
  userinfo: boolean
  refresh: boolean
  logout: boolean
  introspect: boolean
}

export interface DiscoverResponse {
  doc: DiscoveryDoc
  raw: unknown
  capabilities: Capabilities
}

export interface StartInput {
  issuer: string
  client_id: string
  client_secret: string
  scopes: string[]
  flow: Flow
  use_pkce: boolean
}

export interface StartResult {
  redirect?: string
  tokens?: TokenResponse
}

export interface TokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  id_token?: string
  scope?: string
  raw?: unknown
}

export interface TokensState {
  tokens?: TokenResponse
  issuer?: string
  scopes?: string[]
  flow?: string
  used_pkce?: boolean
  jwks_uri?: string
}

export interface VerifyResult {
  valid: boolean
  alg?: string
  kid?: string
  header?: Record<string, unknown>
  claims?: Record<string, unknown>
  error?: string
  key_source?: 'jwks' | 'user'
}

export type Flow = 'auth_code' | 'client_credentials'

export type RuntimeMode = 'bff' | 'browser'

export interface OidcRuntime {
  mode: RuntimeMode
  discover(issuer: string): Promise<DiscoverResponse>
  start(input: StartInput): Promise<StartResult>
  completeCallback(url: URL): Promise<TokensState>
  tokens(): Promise<TokensState>
  verify(id_token: string, key?: string): Promise<VerifyResult>
  userinfo(): Promise<Record<string, unknown>>
  refresh(): Promise<TokenResponse>
  introspect(): Promise<Record<string, unknown>>
  logout(): Promise<{ redirect: string }>
}
