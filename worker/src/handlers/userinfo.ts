import type { Env } from '../env'
import { writeJSONError } from '../json'
import { loadSessionStrict } from '../session/client'
import { passthrough } from './_shared'

const USERINFO_TIMEOUT_MS = 10_000

export async function userinfoHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  const data = session ? await session.get() : null
  if (!data || !data.tokens || !data.discovery) {
    return writeJSONError(400, 'no session or tokens')
  }
  if (!data.discovery.userinfo_endpoint) {
    return writeJSONError(400, 'no userinfo_endpoint advertised')
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), USERINFO_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(data.discovery.userinfo_endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${data.tokens.access_token ?? ''}`,
        accept: 'application/json',
      },
      signal: ac.signal,
    })
  } catch (err) {
    return writeJSONError(502, (err as Error).message)
  } finally {
    clearTimeout(timer)
  }
  return passthrough(resp)
}
