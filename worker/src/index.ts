import { ConfigError } from './config'
import type { Env } from './env'
import { writeJSON, writeJSONError } from './json'
import { isApiPath, matchRoute } from './router'

export { SessionStore } from './session/sessionDO'

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    const handler = matchRoute(req.method, url.pathname)
    if (handler) {
      try {
        return await handler(req, env, ctx)
      } catch (err) {
        return errorResponse(err)
      }
    }

    if (isApiPath(url.pathname)) {
      return writeJSONError(404, `no route for ${req.method} ${url.pathname}`)
    }

    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>

function errorResponse(err: unknown): Response {
  if (err instanceof ConfigError) {
    return writeJSON({ error: err.message, hint: err.hint }, 500)
  }
  const message = err instanceof Error ? err.message : String(err)
  return writeJSONError(500, `internal error: ${message}`)
}
