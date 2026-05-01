export interface Env {
  ASSETS: Fetcher
  SESSIONS: DurableObjectNamespace
  COOKIE_NAME: string
  REDIRECT_URI: string
  SESSION_TTL_SECONDS: string
  COOKIE_SIGNING_KEY: string
}
