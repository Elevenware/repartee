import { newPKCE } from '@repartee/shared/pkce'
import { bytesToB64url, verifyToken } from '@repartee/shared/jwt'
import type {
  DiscoverResponse,
  DiscoveryDoc,
  OidcRuntime,
  StartInput,
  TokenResponse,
  TokensState,
  VerifyResult,
} from './types'

interface BrowserSession {
  issuer: string
  discovery: DiscoveryDoc
  clientId: string
  scopes: string[]
  state: string
  nonce: string
  codeVerifier: string
  redirectURI: string
  tokens?: TokenResponse
}

const SESSION_KEY = 'repartee:browser-session'

function loadSession(): BrowserSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as BrowserSession
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

function saveSession(session: BrowserSession) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    throw new Error(`${(e as Error).message}. Browser mode requires the OP endpoint to allow CORS.`)
  }

  const text = await res.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in body)
      ? String((body as { error: unknown }).error)
      : `${res.status} ${res.statusText}`
    throw new Error(msg)
  }
  return body as T
}

function trimIssuer(issuer: string): string {
  const v = issuer.trim().replace(/\/+$/, '')
  if (!v) throw new Error('issuer is required')
  return v
}

function currentRedirectURI(): string {
  const configured = import.meta.env.VITE_REPARTEE_REDIRECT_URI
  const u = new URL(configured || window.location.href)
  u.search = ''
  u.hash = ''
  return u.toString()
}

function has(values: string[] | undefined, value: string): boolean {
  return !!values?.includes(value)
}

function capabilities(doc: DiscoveryDoc): DiscoverResponse['capabilities'] {
  return {
    pkce: has(doc.code_challenge_methods_supported, 'S256'),
    auth_code: !doc.grant_types_supported?.length || has(doc.grant_types_supported, 'authorization_code'),
    client_credentials: false,
    userinfo: !!doc.userinfo_endpoint,
    refresh: has(doc.grant_types_supported, 'refresh_token'),
    logout: !!doc.end_session_endpoint,
    introspect: false,
  }
}

async function discover(issuer: string): Promise<DiscoverResponse> {
  const base = trimIssuer(issuer)
  const raw = await jsonFetch<unknown>(`${base}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
  })
  const doc = raw as DiscoveryDoc
  return { doc, raw, capabilities: capabilities(doc) }
}

async function start(input: StartInput) {
  if (input.flow === 'client_credentials') {
    throw new Error('Browser mode only supports Authorization Code + PKCE.')
  }
  if (input.client_secret.trim()) {
    throw new Error('Browser mode is for public clients; leave the client secret empty.')
  }

  const found = await discover(input.issuer)
  if (!found.capabilities.pkce) {
    throw new Error('Browser mode requires the OP to advertise PKCE S256 support.')
  }
  if (!found.doc.authorization_endpoint) {
    throw new Error('no authorization_endpoint advertised')
  }
  if (!found.doc.token_endpoint) {
    throw new Error('no token_endpoint advertised')
  }

  const state = randomURLSafe(16)
  const nonce = randomURLSafe(16)
  const { verifier: codeVerifier, challenge: codeChallenge } = await newPKCE()
  const redirectURI = currentRedirectURI()

  const session: BrowserSession = {
    issuer: input.issuer,
    discovery: found.doc,
    clientId: input.client_id,
    scopes: input.scopes,
    state,
    nonce,
    codeVerifier,
    redirectURI,
  }
  saveSession(session)

  const u = new URL(found.doc.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', input.client_id)
  u.searchParams.set('redirect_uri', redirectURI)
  u.searchParams.set('scope', input.scopes.join(' '))
  u.searchParams.set('state', state)
  u.searchParams.set('nonce', nonce)
  u.searchParams.set('code_challenge', codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return { redirect: u.toString() }
}

async function completeCallback(url: URL): Promise<TokensState> {
  const error = url.searchParams.get('error')
  if (error) {
    const description = url.searchParams.get('error_description')
    throw new Error(description ? `${error}: ${description}` : error)
  }

  const session = requireSession()
  if (url.searchParams.get('state') !== session.state) {
    throw new Error('state_mismatch')
  }

  const code = url.searchParams.get('code')
  if (!code) {
    throw new Error('missing_code')
  }

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: session.redirectURI,
    client_id: session.clientId,
    code_verifier: session.codeVerifier,
  })

  const tokens = await tokenRequest(session.discovery.token_endpoint, form)
  session.tokens = tokens
  saveSession(session)
  return tokensState(session)
}

async function tokenRequest(endpoint: string | undefined, form: URLSearchParams): Promise<TokenResponse> {
  if (!endpoint) throw new Error('no token_endpoint advertised')
  const raw = await jsonFetch<Record<string, unknown>>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form,
  })
  return { ...(raw as TokenResponse), raw }
}

function tokens(): Promise<TokensState> {
  const session = loadSession()
  return Promise.resolve(session ? tokensState(session) : {})
}

function tokensState(session: BrowserSession): TokensState {
  return {
    tokens: session.tokens,
    issuer: session.issuer,
    scopes: session.scopes,
    flow: 'auth_code',
    used_pkce: true,
    jwks_uri: session.discovery.jwks_uri,
  }
}

async function userinfo(): Promise<Record<string, unknown>> {
  const session = requireSessionWithTokens()
  if (!session.discovery.userinfo_endpoint) {
    throw new Error('no userinfo_endpoint advertised')
  }
  return jsonFetch<Record<string, unknown>>(session.discovery.userinfo_endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.tokens.access_token || ''}`,
    },
  })
}

async function refresh(): Promise<TokenResponse> {
  const session = requireSessionWithTokens()
  if (!session.tokens.refresh_token) {
    throw new Error('no refresh token available')
  }
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.tokens.refresh_token,
    client_id: session.clientId,
  })
  const fresh = await tokenRequest(session.discovery.token_endpoint, form)
  if (!fresh.refresh_token) fresh.refresh_token = session.tokens.refresh_token
  session.tokens = fresh
  saveSession(session)
  return fresh
}

function introspect(): Promise<Record<string, unknown>> {
  return Promise.reject(new Error('Browser mode does not support token introspection. Use BFF mode for confidential-client introspection.'))
}

function logout(): Promise<{ redirect: string }> {
  const session = loadSession()
  if (!session) throw new Error('no session')
  clearSession()
  if (!session.discovery.end_session_endpoint) {
    return Promise.resolve({ redirect: currentRedirectURI() })
  }
  const u = new URL(session.discovery.end_session_endpoint)
  if (session.tokens?.id_token) {
    u.searchParams.set('id_token_hint', session.tokens.id_token)
  }
  u.searchParams.set('post_logout_redirect_uri', currentRedirectURI())
  return Promise.resolve({ redirect: u.toString() })
}

function verify(idToken: string, keyMaterial?: string): Promise<VerifyResult> {
  return verifyToken({
    idToken,
    keyMaterial,
    jwksURI: loadSession()?.discovery.jwks_uri,
    fetcher: corsFriendlyFetch,
  })
}

async function corsFriendlyFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    throw new Error(`${(e as Error).message}. Browser mode requires the OP endpoint to allow CORS.`)
  }
}

function requireSession(): BrowserSession {
  const session = loadSession()
  if (!session) throw new Error('no session')
  return session
}

function requireSessionWithTokens(): BrowserSession & { tokens: TokenResponse } {
  const session = requireSession()
  if (!session.tokens) throw new Error('no session or tokens')
  return session as BrowserSession & { tokens: TokenResponse }
}

function randomURLSafe(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return bytesToB64url(b)
}

export const browserRuntime: OidcRuntime = {
  mode: 'browser',
  discover,
  start,
  completeCallback,
  tokens,
  verify,
  userinfo,
  refresh,
  introspect,
  logout,
}
