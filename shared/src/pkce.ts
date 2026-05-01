// Port of bff/pkce.go: 32 random bytes -> base64url verifier, SHA-256 -> base64url challenge.
// The same algorithm is implemented in repartee/web/src/browserRuntime.ts and a future PR
// will refactor that file to import from here so the two runtimes share one source of truth.

const encoder = new TextEncoder()

export interface PkcePair {
  verifier: string
  challenge: string
}

export async function newPKCE(): Promise<PkcePair> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const verifier = base64urlEncode(bytes)
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  const challenge = base64urlEncode(new Uint8Array(digest))
  return { verifier, challenge }
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
