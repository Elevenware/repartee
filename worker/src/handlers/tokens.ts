import type { TokensState } from '@repartee/shared/contract'
import type { Env } from '../env'
import { writeJSON } from '../json'
import { loadSessionStrict } from '../session/client'

export async function tokensHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  if (!session) return writeJSON({})

  const data = await session.get()
  if (!data || !data.tokens) return writeJSON({})

  const state: TokensState = {
    tokens: data.tokens,
    issuer: data.issuer,
    scopes: data.scopes,
    flow: data.flow,
    used_pkce: !!data.codeVerifier,
    jwks_uri: data.discovery?.jwks_uri,
  }
  return writeJSON(state)
}
