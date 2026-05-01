import type { Env } from '../env'
import { withCookie, writeJSON, writeJSONError } from '../json'
import { expireCookieHeader, loadSessionStrict } from '../session/client'

export async function logoutHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  const data = session ? await session.get() : null
  if (!data || !data.discovery) return writeJSONError(400, 'no session')
  if (!data.discovery.end_session_endpoint) {
    return writeJSONError(400, 'no end_session_endpoint advertised')
  }

  let url: URL
  try {
    url = new URL(data.discovery.end_session_endpoint)
  } catch (err) {
    return writeJSONError(502, (err as Error).message)
  }

  if (data.tokens?.id_token) {
    url.searchParams.set('id_token_hint', data.tokens.id_token)
  }
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirect(env.REDIRECT_URI))

  await session!.delete()
  return withCookie(writeJSON({ redirect: url.toString() }), expireCookieHeader(env))
}

// Strip the path and query from the configured redirect URI to recover the
// SPA's origin root, mirroring bff/handlers.go:postLogoutRedirect.
function postLogoutRedirect(redirectURI: string): string {
  try {
    const u = new URL(redirectURI)
    u.pathname = '/'
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return 'http://localhost:8787/'
  }
}
