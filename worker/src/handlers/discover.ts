import { computeCapabilities } from '@repartee/shared/capabilities'
import type { Env } from '../env'
import { readJSON, writeJSON, writeJSONError } from '../json'
import { DiscoveryError, fetchDiscovery } from '../oidc/discovery'

interface DiscoverRequest {
  issuer?: string
}

export async function discoverHandler(req: Request, _env: Env): Promise<Response> {
  let body: DiscoverRequest
  try {
    body = await readJSON<DiscoverRequest>(req)
  } catch (err) {
    return writeJSONError(400, `bad request: ${(err as Error).message}`)
  }

  try {
    const { doc, raw } = await fetchDiscovery(body.issuer ?? '')
    return writeJSON({ doc, raw, capabilities: computeCapabilities(doc) })
  } catch (err) {
    if (err instanceof DiscoveryError) {
      return writeJSONError(502, err.message)
    }
    throw err
  }
}
