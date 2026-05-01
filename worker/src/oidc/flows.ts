import type { TokenResponse } from '@repartee/shared/contract'
import type { SessionData } from '../session/sessionDO'

const TOKEN_REQUEST_TIMEOUT_MS = 10_000

export class OidcError extends Error {
  status: number
  body: string
  code?: string
  constructor(status: number, body: string, code?: string) {
    super(
      code
        ? `token endpoint returned ${status} (${code}): ${truncate(body, 200)}`
        : `token endpoint returned ${status}: ${truncate(body, 200)}`,
    )
    this.name = 'OidcError'
    this.status = status
    this.body = body
    this.code = code
  }
}

export interface TokenExchange {
  endpoint: string
  form: URLSearchParams
  clientId: string
  clientSecret: string
}

export async function exchangeCode(
  sess: SessionData,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: sess.redirectURI ?? '',
  })
  if (sess.codeVerifier) form.set('code_verifier', sess.codeVerifier)
  return tokenRequest(
    {
      endpoint: sess.discovery?.token_endpoint ?? '',
      form,
      clientId: sess.clientId ?? '',
      clientSecret: sess.clientSecret ?? '',
    },
    fetcher,
  )
}

export async function clientCredentials(
  sess: SessionData,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  const form = new URLSearchParams({ grant_type: 'client_credentials' })
  if (sess.scopes && sess.scopes.length > 0) form.set('scope', sess.scopes.join(' '))
  return tokenRequest(
    {
      endpoint: sess.discovery?.token_endpoint ?? '',
      form,
      clientId: sess.clientId ?? '',
      clientSecret: sess.clientSecret ?? '',
    },
    fetcher,
  )
}

export async function refreshTokens(
  sess: SessionData,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  const refresh = sess.tokens?.refresh_token
  if (!refresh) throw new Error('no refresh token available')
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh })
  return tokenRequest(
    {
      endpoint: sess.discovery?.token_endpoint ?? '',
      form,
      clientId: sess.clientId ?? '',
      clientSecret: sess.clientSecret ?? '',
    },
    fetcher,
  )
}

export async function tokenRequest(
  { endpoint, form, clientId, clientSecret }: TokenExchange,
  fetcher: typeof fetch = fetch,
): Promise<TokenResponse> {
  if (!endpoint) throw new Error('no token_endpoint advertised')

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TOKEN_REQUEST_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        // RFC 7617: raw UTF-8 username:password, base64-encoded. The Go BFF
        // URL-escapes the credentials before encoding which is technically
        // wrong; this implementation deliberately does it correctly. See
        // §Risks #4 in the plan.
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: form.toString(),
      signal: ac.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const body = await resp.text()
  if (resp.status !== 200) {
    let code: string | undefined
    try {
      const parsed = JSON.parse(body) as { error?: string }
      if (typeof parsed.error === 'string') code = parsed.error
    } catch {
      // upstream did not send JSON; surface the raw body via OidcError
    }
    throw new OidcError(resp.status, body, code)
  }

  let parsed: TokenResponse
  try {
    parsed = JSON.parse(body) as TokenResponse
  } catch (err) {
    throw new Error(`decoding token response: ${(err as Error).message}`)
  }
  parsed.raw = JSON.parse(body)
  return parsed
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
