import { verifyToken } from '@repartee/shared/jwt'
import type { Env } from '../env'
import { readJSON, writeJSON, writeJSONError } from '../json'
import { loadSessionStrict } from '../session/client'

interface VerifyRequest {
  id_token?: string
  key?: string
}

export async function verifyHandler(req: Request, env: Env): Promise<Response> {
  let body: VerifyRequest
  try {
    body = await readJSON<VerifyRequest>(req)
  } catch (err) {
    return writeJSONError(400, `bad request: ${(err as Error).message}`)
  }

  if (!body.id_token) {
    return writeJSONError(400, 'id_token is required')
  }

  // The session's discovery doc is the only place jwks_uri lives. If there's
  // no session yet (no /api/start happened), the JWKS fallback is unavailable
  // and the user must paste a key. verifyToken returns a structured error in
  // that case rather than a 4xx.
  const session = await loadSessionStrict(req, env)
  const data = session ? await session.get() : null

  const result = await verifyToken({
    idToken: body.id_token,
    keyMaterial: body.key,
    jwksURI: data?.discovery?.jwks_uri,
  })
  return writeJSON(result)
}
