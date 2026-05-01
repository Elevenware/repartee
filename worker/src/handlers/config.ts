import type { Env } from '../env'
import { writeJSON } from '../json'

export function configHandler(_req: Request, env: Env): Response {
  return writeJSON({ rp_redirect_uri: env.REDIRECT_URI ?? '' })
}
