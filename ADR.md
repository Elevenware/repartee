# ADR: Cloudflare Worker backend feasibility

## Status

Investigated. No implementation decision yet.

## Context

RePartee currently has two useful deployment shapes:

- a Go BFF that serves the Vue SPA and handles OIDC server-side
- a static browser mode that runs Authorization Code + PKCE entirely in the SPA

Static browser mode is useful for GitHub Pages or static Cloudflare hosting, but
it cannot preserve the full BFF behavior. In particular, it cannot safely keep a
client secret, cannot act as a confidential client, and depends on OP endpoints
allowing browser CORS.

The question was whether the Go backend could be ported to TypeScript and run as
a Cloudflare Worker.

## Finding

Porting the Go BFF to a TypeScript Cloudflare Worker is feasible.

The current backend responsibilities map cleanly to Worker APIs:

- fetch OIDC discovery and JWKS documents with outbound `fetch`
- build authorization redirect URLs
- receive the callback request
- exchange authorization codes at the token endpoint
- run client credentials and refresh token grants
- call userinfo and introspection endpoints
- verify JWT signatures using Web Crypto or a Worker-compatible JOSE library
- set HttpOnly cookies
- serve the built Vue assets alongside API routes

This would preserve the main advantages of the Go BFF over static browser mode:

- no browser CORS dependency for OIDC back-channel calls
- support for confidential clients
- support for client credentials
- support for introspection
- tokens and PKCE verifier can remain unavailable to frontend JavaScript

## Main Design Decision

The Go BFF uses an in-memory session map keyed by an HttpOnly cookie. That does
not translate directly to Workers, because Worker isolates are ephemeral and
must not be treated as durable storage.

Recommended session options:

- **Durable Object session store:** best behavioral match. Store issuer,
  discovery, client credentials, state, nonce, PKCE verifier, and tokens
  server-side. Cookie contains only an opaque session ID.
- **KV session store:** acceptable for a smoke-test tool, but less exact because
  consistency semantics are weaker.
- **Encrypted cookie session:** simplest infrastructure, but awkward because
  token payloads can exceed practical cookie limits.

The preferred option is Durable Objects if the goal is to preserve BFF behavior.

## Constraints

A deployed Worker cannot reach an OP bound only to a developer machine's
`localhost` or a private Docker network. The existing local Go BFF remains useful
for testing a local `authentique` instance.

Cloudflare Worker limits are not expected to be a problem for RePartee's normal
OIDC flows. Each flow uses only a small number of outbound subrequests, and the
frontend assets are small. Bundle size should still be watched if adding a JOSE
library.

User-entered client secrets should not become Cloudflare deployment secrets.
They are per-test inputs and should live only in the server-side session store.
Cloudflare secrets would be appropriate for application-level material, such as
a cookie-signing or encryption key.

## Recommendation

Do not replace the Go BFF immediately. Add a third deployment target:

```text
web/          Vue app
bff/          existing Go BFF
worker/       TypeScript Cloudflare Worker implementing the same /api contract
shared/       optional shared TypeScript types/helpers
```

The Worker should implement the same API contract as the Go BFF so the existing
frontend BFF runtime can talk to either backend.

This gives RePartee three complementary modes:

- **Go BFF:** best local developer experience, especially for local OPs
- **Static browser mode:** simplest static deployment, public-client PKCE only
- **Cloudflare Worker BFF:** hosted server-side RP behavior for public or staged
  OPs

## Consequence

The Worker backend would be a useful and realistic deployment target, but it is
not a complete substitute for the local Go backend. It should be treated as a
hosted BFF option rather than as a universal replacement.
