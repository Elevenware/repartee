import { ConfigError } from './config'
import type { Env } from './env'
import { writeJSON, writeJSONError } from './json'
import { errorFields, log } from './log'
import { isApiPath, matchRoute } from './router'

export { SessionStore } from './session/sessionDO'

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    const start = Date.now()
    const reqId = crypto.randomUUID()
    const base = { reqId, method: req.method, path: url.pathname }

    log.info('request', base)

    const handler = matchRoute(req.method, url.pathname)
    if (handler) {
      try {
        const res = await handler(req, env, ctx)
        log.info('response', { ...base, status: res.status, durMs: Date.now() - start })
        return res
      } catch (err) {
        log.error('handler threw', { ...base, durMs: Date.now() - start, ...errorFields(err) })
        return errorResponse(err)
      }
    }

    if (isApiPath(url.pathname)) {
      log.warn('no route', base)
      return writeJSONError(404, `no route for ${req.method} ${url.pathname}`)
    }

    const assetRes = await env.ASSETS.fetch(req)
    log.info('asset', { ...base, status: assetRes.status, durMs: Date.now() - start })
    return assetRes
  },
} satisfies ExportedHandler<Env>

function errorResponse(err: unknown): Response {
  if (err instanceof ConfigError) {
    return writeJSON({ error: err.message, hint: err.hint }, 500)
  }
  const message = err instanceof Error ? err.message : String(err)
  return writeJSONError(500, `internal error: ${message}`)
}
