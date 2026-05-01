import type { Env } from '../env'
import { writeJSONError } from '../json'
import { loadSessionStrict } from '../session/client'
import { basicAuthHeader, passthrough } from './_shared'

const INTROSPECT_TIMEOUT_MS = 10_000

export async function introspectHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  const data = session ? await session.get() : null
  if (!data || !data.tokens || !data.discovery) {
    return writeJSONError(400, 'no session or tokens')
  }
  if (!data.discovery.introspection_endpoint) {
    return writeJSONError(400, 'no introspection_endpoint advertised')
  }

  const form = new URLSearchParams({
    token: data.tokens.access_token ?? '',
    token_type_hint: 'access_token',
  })

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), INTROSPECT_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(data.discovery.introspection_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: basicAuthHeader(data.clientId ?? '', data.clientSecret ?? ''),
      },
      body: form.toString(),
      signal: ac.signal,
    })
  } catch (err) {
    return writeJSONError(502, (err as Error).message)
  } finally {
    clearTimeout(timer)
  }
  return passthrough(resp)
}
