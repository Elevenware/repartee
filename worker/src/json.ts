export function writeJSON(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function writeJSONError(status: number, message: string): Response {
  return writeJSON({ error: message }, status)
}

export async function readJSON<T>(req: Request): Promise<T> {
  return (await req.json()) as T
}

// Response.headers is immutable in some runtimes, so rebuild rather than mutate.
export function withCookie(response: Response, setCookie: string | undefined): Response {
  if (!setCookie) return response
  const headers = new Headers(response.headers)
  headers.append('set-cookie', setCookie)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location })
  if (setCookie) headers.append('set-cookie', setCookie)
  return new Response(null, { status: 302, headers })
}
