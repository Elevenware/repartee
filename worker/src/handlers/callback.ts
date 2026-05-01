import type { Env } from '../env'
import { redirect } from '../json'
import { errorFields, log } from '../log'
import { OidcError, exchangeCode } from '../oidc/flows'
import { loadSessionStrict } from '../session/client'

export async function callbackHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  if (!session) {
    log.warn('callback: no session cookie')
    return redirect('/?error=no_session')
  }

  const url = new URL(req.url)
  const q = url.searchParams

  const errCode = q.get('error')
  if (errCode) {
    const desc = q.get('error_description')
    const msg = desc ? `${errCode}: ${desc}` : errCode
    log.warn('callback: OP returned error', { errCode, desc })
    return redirect(`/?error=${encodeURIComponent(msg)}`)
  }

  const data = await session.get()
  if (!data) {
    log.warn('callback: session record empty')
    return redirect('/?error=no_session')
  }

  const state = q.get('state')
  if (state !== data.state) {
    log.warn('callback: state mismatch', { gotState: state, expectedState: data.state })
    return redirect('/?error=state_mismatch')
  }

  const code = q.get('code')
  if (!code) {
    log.warn('callback: missing code', { params: [...q.keys()] })
    return redirect('/?error=missing_code')
  }

  try {
    log.info('callback: exchanging code')
    const tokens = await exchangeCode(data, code)
    await session.patch({ tokens })
    log.info('callback: token exchange ok')
    return redirect('/?ok=1')
  } catch (err) {
    const msg = err instanceof OidcError ? err.message : (err as Error).message
    log.error('callback: token exchange failed', { kind: err instanceof OidcError ? 'OidcError' : 'Error', ...errorFields(err) })
    return redirect(`/?error=${encodeURIComponent(msg)}`)
  }
}
