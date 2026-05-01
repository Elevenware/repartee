import type { DiscoveryDoc } from '@repartee/shared/contract'

const DISCOVERY_TIMEOUT_MS = 10_000

export interface DiscoveryResult {
  doc: DiscoveryDoc
  raw: unknown
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscoveryError'
  }
}

export async function fetchDiscovery(
  issuer: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscoveryResult> {
  const cleaned = issuer.trim().replace(/\/+$/, '')
  if (cleaned === '') {
    throw new DiscoveryError('issuer is required')
  }

  const url = `${cleaned}/.well-known/openid-configuration`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), DISCOVERY_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetcher(url, { method: 'GET', signal: ac.signal })
  } catch (err) {
    throw new DiscoveryError(`discovery fetch failed: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }

  const body = await resp.text()
  if (resp.status !== 200) {
    throw new DiscoveryError(`discovery returned ${resp.status}: ${truncate(body, 200)}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch (err) {
    throw new DiscoveryError(`decoding discovery: ${(err as Error).message}`)
  }

  return { doc: raw as DiscoveryDoc, raw }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
