import type { Env } from '../env'
import { redirect } from '../json'
import { OidcError, exchangeCode } from '../oidc/flows'
import { loadSessionStrict } from '../session/client'

export async function callbackHandler(req: Request, env: Env): Promise<Response> {
  const session = await loadSessionStrict(req, env)
  if (!session) return redirect('/?error=no_session')

  const url = new URL(req.url)
  const q = url.searchParams

  const errCode = q.get('error')
  if (errCode) {
    const desc = q.get('error_description')
    const msg = desc ? `${errCode}: ${desc}` : errCode
    return redirect(`/?error=${encodeURIComponent(msg)}`)
  }

  const data = await session.get()
  if (!data) return redirect('/?error=no_session')

  const state = q.get('state')
  if (state !== data.state) return redirect('/?error=state_mismatch')

  const code = q.get('code')
  if (!code) return redirect('/?error=missing_code')

  try {
    const tokens = await exchangeCode(data, code)
    await session.patch({ tokens })
    return redirect('/?ok=1')
  } catch (err) {
    const msg = err instanceof OidcError ? err.message : (err as Error).message
    return redirect(`/?error=${encodeURIComponent(msg)}`)
  }
}
