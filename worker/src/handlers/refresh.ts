import type { Env } from '../env'
import { writeJSON, writeJSONError } from '../json'
import { OidcError, refreshTokens } from '../oidc/flows'
import { loadSessionStrict } from '../session/client'

export async function refreshHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  const data = session ? await session.get() : null
  if (!data || !data.tokens) return writeJSONError(400, 'no session or tokens')

  let fresh
  try {
    fresh = await refreshTokens(data)
  } catch (err) {
    if (err instanceof OidcError) return writeJSONError(502, err.message)
    return writeJSONError(502, (err as Error).message)
  }

  // Some OPs omit refresh_token from the response; retain the prior one to
  // keep refresh chains alive (matches bff/handlers.go:274-276).
  if (!fresh.refresh_token) fresh.refresh_token = data.tokens.refresh_token

  await session!.patch({ tokens: fresh })
  return writeJSON(fresh)
}
