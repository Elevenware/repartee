import type { Env } from './env'
import { callbackHandler } from './handlers/callback'
import { configHandler } from './handlers/config'
import { discoverHandler } from './handlers/discover'
import { introspectHandler } from './handlers/introspect'
import { logoutHandler } from './handlers/logout'
import { refreshHandler } from './handlers/refresh'
import { startHandler } from './handlers/start'
import { tokensHandler } from './handlers/tokens'
import { userinfoHandler } from './handlers/userinfo'
import { verifyHandler } from './handlers/verify'

export type Handler = (req: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>

// Frontend api.ts uses POST for /api/tokens; the Go BFF only registers GET.
// The Worker accepts both so the existing SPA code keeps working unchanged.
const routes: Array<[string, string, Handler]> = [
  ['GET', '/api/config', configHandler],
  ['POST', '/api/discover', discoverHandler],
  ['POST', '/api/start', startHandler],
  ['GET', '/callback', callbackHandler],
  ['POST', '/api/tokens', tokensHandler],
  ['GET', '/api/tokens', tokensHandler],
  ['POST', '/api/verify', verifyHandler],
  ['POST', '/api/userinfo', userinfoHandler],
  ['POST', '/api/refresh', refreshHandler],
  ['POST', '/api/introspect', introspectHandler],
  ['POST', '/api/logout', logoutHandler],
]

export function matchRoute(method: string, pathname: string): Handler | undefined {
  for (const [m, p, h] of routes) {
    if (m === method && p === pathname) return h
  }
  return undefined
}

// Paths the Worker owns. Anything else falls through to the Assets binding so
// the SPA's client-side router can handle it.
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/callback'
}
