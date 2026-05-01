// Mirror upstream status + body verbatim, defaulting Content-Type to JSON when
// the OP doesn't set one. Used by /api/userinfo and /api/introspect, which
// pass the OP's response straight back to the SPA.
export async function passthrough(resp: Response): Promise<Response> {
  const body = await resp.text()
  return new Response(body, {
    status: resp.status,
    headers: { 'content-type': resp.headers.get('content-type') ?? 'application/json' },
  })
}

// RFC 7617 Basic auth header: raw UTF-8 username:password, base64-encoded.
// Deliberately raw (no URL escaping) — see §Risks #4 in the plan.
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}
