// Cookie value format: `${sessionId}.${base64url(HMAC-SHA-256(sessionId, key))}`.
// HMAC binds the cookie to a server-side secret so a forged session ID can't
// be used to address an arbitrary Durable Object.

const encoder = new TextEncoder()

export interface CookieAttrs {
  name: string
  value: string
  maxAgeSeconds?: number
  path?: string
  sameSite?: 'Lax' | 'Strict' | 'None'
  httpOnly?: boolean
  secure?: boolean
}

export function newSessionId(): string {
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function signSessionId(id: string, signingKey: string): Promise<string> {
  const key = await importHmacKey(signingKey)
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(id))
  return `${id}.${b64urlEncode(new Uint8Array(sig))}`
}

export async function verifySessionCookie(value: string, signingKey: string): Promise<string | null> {
  const dot = value.lastIndexOf('.')
  if (dot <= 0 || dot === value.length - 1) return null
  const id = value.slice(0, dot)
  const sigB64 = value.slice(dot + 1)
  if (!/^[0-9a-f]{32}$/.test(id)) return null
  const sigBytes = b64urlDecode(sigB64)
  if (!sigBytes) return null
  const key = await importHmacKey(signingKey)
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(id))
  return ok ? id : null
}

export function parseCookieHeader(header: string | null, name: string): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    if (p.slice(0, eq).trim() === name) return p.slice(eq + 1).trim()
  }
  return null
}

export function serialiseCookie(attrs: CookieAttrs): string {
  const segments = [`${attrs.name}=${attrs.value}`]
  if (attrs.maxAgeSeconds !== undefined) segments.push(`Max-Age=${attrs.maxAgeSeconds}`)
  segments.push(`Path=${attrs.path ?? '/'}`)
  if (attrs.httpOnly !== false) segments.push('HttpOnly')
  if (attrs.secure !== false) segments.push('Secure')
  segments.push(`SameSite=${attrs.sameSite ?? 'Lax'}`)
  return segments.join('; ')
}

async function importHmacKey(signingKey: string): Promise<CryptoKey> {
  const raw = b64Decode(signingKey)
  if (!raw) throw new Error('COOKIE_SIGNING_KEY must be base64-encoded')
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function b64urlDecode(s: string): Uint8Array | null {
  const padded = s.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return b64Decode(padded)
}

function b64Decode(s: string): Uint8Array | null {
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}
