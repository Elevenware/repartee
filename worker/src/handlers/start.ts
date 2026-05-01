import { newPKCE } from '@repartee/shared/pkce'
import type { StartInput, StartResult } from '@repartee/shared/contract'
import type { Env } from '../env'
import { readJSON, withCookie, writeJSON, writeJSONError } from '../json'
import { DiscoveryError, fetchDiscovery } from '../oidc/discovery'
import { OidcError, clientCredentials } from '../oidc/flows'
import { newSessionId } from '../session/cookie'
import { loadOrCreateSession } from '../session/client'
import type { SessionData } from '../session/sessionDO'

export async function startHandler(req: Request, env: Env): Promise<Response> {
  let body: StartInput
  try {
    body = await readJSON<StartInput>(req)
  } catch (err) {
    return writeJSONError(400, `bad request: ${(err as Error).message}`)
  }

  let discovery
  try {
    ;({ doc: discovery } = await fetchDiscovery(body.issuer ?? ''))
  } catch (err) {
    if (err instanceof DiscoveryError) return writeJSONError(502, err.message)
    throw err
  }

  const { session, setCookie } = await loadOrCreateSession(req, env)

  const base: SessionData = {
    id: session.id,
    issuer: body.issuer,
    discovery,
    clientId: body.client_id,
    clientSecret: body.client_secret,
    redirectURI: env.REDIRECT_URI,
    scopes: body.scopes,
    flow: body.flow === 'client_credentials' ? 'client_credentials' : 'auth_code',
    updatedAt: 0,
  }

  if (base.flow === 'client_credentials') {
    try {
      const tokens = await clientCredentials(base)
      await session.put({ ...base, tokens })
      const result: StartResult = { tokens }
      return withCookie(writeJSON(result), setCookie)
    } catch (err) {
      if (err instanceof OidcError) return writeJSONError(502, err.message)
      throw err
    }
  }

  // auth_code (default)
  base.state = newSessionId()
  base.nonce = newSessionId()
  let challenge: string | undefined
  if (body.use_pkce) {
    const pair = await newPKCE()
    base.codeVerifier = pair.verifier
    challenge = pair.challenge
  }

  if (!discovery.authorization_endpoint) {
    return writeJSONError(502, 'no authorization_endpoint advertised')
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: base.clientId ?? '',
    redirect_uri: base.redirectURI ?? '',
    scope: (base.scopes ?? []).join(' '),
    state: base.state,
    nonce: base.nonce,
  })
  if (challenge) {
    params.set('code_challenge', challenge)
    params.set('code_challenge_method', 'S256')
  }

  let url: URL
  try {
    url = new URL(discovery.authorization_endpoint)
  } catch (err) {
    return writeJSONError(502, `bad authorization_endpoint: ${(err as Error).message}`)
  }
  // Preserve any pre-existing query params on the authorization endpoint.
  for (const [k, v] of params) url.searchParams.set(k, v)

  await session.put(base)

  const result: StartResult = { redirect: url.toString() }
  return withCookie(writeJSON(result), setCookie)
}
