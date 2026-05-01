import { ensureCookieSigningKey } from '../config'
import type { Env } from '../env'
import {
  newSessionId,
  parseCookieHeader,
  serialiseCookie,
  signSessionId,
  verifySessionCookie,
} from './cookie'
import type { SessionData } from './sessionDO'

export interface SessionHandle {
  id: string
  get(): Promise<SessionData | null>
  put(data: SessionData): Promise<void>
  patch(patch: Partial<SessionData>): Promise<SessionData>
  delete(): Promise<void>
}

export interface SessionLoad {
  session: SessionHandle
  setCookie?: string // present when a fresh session ID was minted on this request
}

// Reads (or mints) the session ID associated with the request and returns a
// typed handle to the corresponding Durable Object. Used by handlers that
// create or mutate session state, e.g. /api/start and /callback.
export async function loadOrCreateSession(req: Request, env: Env): Promise<SessionLoad> {
  ensureCookieSigningKey(env)
  const existing = await sessionIdFromRequest(req, env)
  if (existing) return { session: makeHandle(existing, env) }

  const id = newSessionId()
  const signed = await signSessionId(id, env.COOKIE_SIGNING_KEY)
  const ttl = Number(env.SESSION_TTL_SECONDS) || 3600
  const setCookie = serialiseCookie({
    name: env.COOKIE_NAME,
    value: signed,
    maxAgeSeconds: ttl,
  })
  return { session: makeHandle(id, env), setCookie }
}

// Returns null if the request has no valid session cookie. Used by handlers
// that read existing state without ever creating one, e.g. /api/tokens.
export async function loadSessionStrict(req: Request, env: Env): Promise<SessionHandle | null> {
  ensureCookieSigningKey(env)
  const id = await sessionIdFromRequest(req, env)
  return id ? makeHandle(id, env) : null
}

export function expireCookieHeader(env: Env): string {
  return serialiseCookie({ name: env.COOKIE_NAME, value: '', maxAgeSeconds: 0 })
}

async function sessionIdFromRequest(req: Request, env: Env): Promise<string | null> {
  const raw = parseCookieHeader(req.headers.get('cookie'), env.COOKIE_NAME)
  if (!raw) return null
  return verifySessionCookie(raw, env.COOKIE_SIGNING_KEY)
}

function makeHandle(id: string, env: Env): SessionHandle {
  const stub = env.SESSIONS.get(env.SESSIONS.idFromName(id))
  return {
    id,
    async get() {
      const r = await stub.fetch('https://session/get')
      const text = await r.text()
      return text === 'null' ? null : (JSON.parse(text) as SessionData)
    },
    async put(data) {
      await stub.fetch('https://session/put', {
        method: 'POST',
        body: JSON.stringify({ ...data, id }),
      })
    },
    async patch(patch) {
      const r = await stub.fetch('https://session/patch', {
        method: 'POST',
        body: JSON.stringify({ ...patch, id }),
      })
      return (await r.json()) as SessionData
    },
    async delete() {
      await stub.fetch('https://session/delete', { method: 'POST' })
    },
  }
}
