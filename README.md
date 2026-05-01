# RePartee — a small, friendly relying party

(Yes, the name is a pun: "RP" for relying party, "repartee" for witty
back-and-forth, which is essentially what an OIDC handshake is.)

A pocket-sized OIDC relying party for kicking the tyres of any OpenID
Provider you point it at — including the `authentique` OP that lives in the
parent directory. Punch in an issuer, choose your scopes, pick a flow, and
it'll walk through the dance and lay the tokens out on the table for you to
inspect.

It's a dev tool. Don't deploy it.

## What it does

1. You give it an issuer URL.
2. It fetches the discovery document and shows you which scopes are on
   offer, whether PKCE is advertised, and which extras (userinfo, refresh,
   logout, introspection) the OP supports.
3. You pick a flow — Authorization Code, Authorization Code + PKCE, or
   Client Credentials — and the scopes you want.
4. You hit Go. It runs the flow.
5. It shows you the ID token (raw and decoded), verifies its signature
   against the OP's JWKS, and lets you paste your own key to override that
   verification. Access tokens are shown raw, and decoded if they happen to
   be JWTs.
6. Optional follow-ups: call `/userinfo`, refresh the access token,
   introspect, or trigger RP-initiated logout.

## Stack

- **Go BFF:** Go 1.22, standard library only (plus `github.com/golang-jwt/jwt/v5`
  for token verification). Best local DX, especially against an OP bound to
  `localhost`.
- **SPA:** Vue 3 + Vite + TypeScript + Tailwind.
- **Worker BFF:** TypeScript Cloudflare Worker that exposes the same
  `/api/...` contract as the Go BFF, with per-session state in a Durable
  Object. Hosted alternative for staged or public OPs; see
  [Cloudflare Worker mode](#cloudflare-worker-mode) below.
- The Go BFF serves the built SPA, so in production there's a single origin
  (`http://localhost:7080`) and no CORS to worry about. In dev, Vite proxies
  `/api` and `/callback` to the BFF (or the Worker, via `RP_BFF`).
- The SPA can also be built in **static browser mode** for hosts like GitHub
  Pages or Cloudflare Pages. That mode is a public OIDC client and only supports
  Authorization Code + PKCE against OPs whose discovery, token, JWKS, and
  optional userinfo/refresh endpoints allow browser CORS.

## Running it

You'll need Go 1.22+ and Node 20+. Two terminals.

**Terminal 1 — BFF:**

```sh
cd bff
go mod tidy        # first time only
go run .
```

The BFF binds to `:7080`. Its redirect URI is `http://localhost:7080/callback`,
so register **that** as a redirect URI when you create a client in your OP.

**Terminal 2 — SPA (dev mode with hot reload):**

```sh
cd web
npm install        # first time only
npm run dev
```

Visit http://localhost:5173. Vite proxies API calls to `:7080`.

**Production-style single-port mode:**

```sh
cd web && npm run build
cd ../bff && go run .
```

Then visit http://localhost:7080 — the BFF serves the built SPA.

## Static browser mode

Static mode removes the Go BFF and runs the OIDC flow entirely from the Vue app:

```sh
cd web
npm run build:static
```

The output in `web/dist` can be deployed to any static host. Register the static
site URL itself as the redirect URI, for example:

- Cloudflare Pages: `https://repartee.example.pages.dev/`
- GitHub Pages project site: `https://<user>.github.io/repartee/`

For GitHub Pages project sites, set Vite's base path when building:

```sh
cd web
VITE_REPARTEE_BASE=/repartee/ npm run build:static
```

If your registered redirect URI is not the same as the page URL used at runtime,
set it explicitly:

```sh
cd web
VITE_REPARTEE_MODE=browser \
VITE_REPARTEE_REDIRECT_URI=https://<user>.github.io/repartee/ \
vite build
```

Static mode deliberately does **not** support confidential-client features:

- no client secret
- no client credentials flow
- no confidential introspection
- refresh and userinfo only work if the OP allows public SPA use and CORS
- token/JWKS verification only works if the JWKS endpoint allows CORS, unless
  you paste a public key manually

Use the normal BFF mode when you need to test those features or an OP that does
not expose CORS-friendly endpoints.

## Cloudflare Worker mode

The `worker/` directory ships a TypeScript Cloudflare Worker BFF that
exposes the same `/api/...` contract as the Go BFF. Per-session state
lives in a Durable Object keyed by an HMAC-signed cookie, and the same
Worker serves the built Vue SPA via the `[assets]` binding so you get
single-origin behaviour like the Go BFF does.

It's the right choice when you want to drive RePartee against a public
OP from a hosted URL — the Worker keeps the client secret, PKCE
verifier, and tokens server-side, which static-browser mode can't.

**Prerequisites:**

- **Workers Paid plan** (~$5/month). Durable Objects aren't on the
  free tier; without them the session-binding approach in this Worker
  doesn't work.
- Wrangler 3.x or later, Node 20+.
- A Cloudflare account, logged in via `wrangler login`.

**One-time secret setup:**

The Worker HMAC-signs the session cookie with `COOKIE_SIGNING_KEY`.
Generate 32+ random bytes, base64-encoded, and store it as a Cloudflare
secret:

```sh
cd worker
openssl rand -base64 32 | wrangler secret put COOKIE_SIGNING_KEY
```

For local `wrangler dev`, copy `worker/.dev.vars.example` to
`worker/.dev.vars` and put a key in there (the file is gitignored).

**Local dev — single port (production-shaped):**

```sh
cd web && npm run build      # produces web/dist that the Worker serves
cd ../worker && npm run dev  # wrangler dev on :8787
```

Visit http://localhost:8787. Register `http://localhost:8787/callback`
as a redirect URI on the OP. The deployed Worker can't reach a
localhost OP, so for testing against a local `authentique` instance the
Go BFF dev loop remains the path of least resistance — see
[Networking caveat](#networking-caveat-important).

**Local dev — Vite hot reload + Worker:**

Two terminals.

```sh
# T1
cd worker && npm run dev

# T2
cd web && RP_BFF=http://localhost:8787 npm run dev
```

`web/vite.config.ts` already proxies `/api` and `/callback` to whatever
`RP_BFF` points at, so this slots in without changes.

**Deploy:**

```sh
cd worker
npm run deploy
```

The `predeploy` script (`cd ../web && npm ci && npm run build`) builds
the SPA into `web/dist` so the Worker's Assets binding has something
to serve. Wrangler then uploads the Worker, the assets, and (on first
deploy only) creates the SessionStore Durable Object via the `v1`
migration declared in `wrangler.toml`.

After deploying, set `REDIRECT_URI` in `wrangler.toml`'s
`[env.production.vars]` to the URL Cloudflare gave you (with `/callback`
appended) and register that exact value with your OP. For example,
`https://repartee-worker.<account>.workers.dev/callback`. Re-run
`npm run deploy` to push the updated config.

**What you can and can't do compared to the Go BFF:**

- Same `/api` contract — the same Vue SPA works against either backend.
- Same flows (Authorization Code with optional PKCE, Client Credentials,
  refresh, userinfo, introspection, RP-initiated logout) and same
  signature-verification scope (no claim validation).
- A deployed Worker can't reach an OP bound only to `localhost` or a
  private network. Use the Go BFF for that.
- First request after a cold start can take ~500 ms while the Worker
  isolate and Durable Object spin up. Subsequent requests are fast.
- User-entered client secrets stay only in the per-session Durable
  Object — they're never promoted to Cloudflare deployment secrets.

The pre-existing **don't deploy this** caveat at the top of this README
applies to the Worker too. It's a smoke-test tool with one-user-per-DO
session semantics; treat the workers.dev deployment as a hosted dev
tool, not a production RP.

## Deployment modes at a glance

| Capability                        | Go BFF | Worker BFF | Static browser |
|---|:---:|:---:|:---:|
| Authorization Code + PKCE         | yes    | yes        | yes            |
| Client Credentials                | yes    | yes        | no             |
| Refresh                           | yes    | yes        | CORS-dependent |
| Userinfo                          | yes    | yes        | CORS-dependent |
| Token introspection               | yes    | yes        | no             |
| RP-initiated logout               | yes    | yes        | yes            |
| ID-token signature verify         | yes    | yes        | CORS-dependent for JWKS |
| Confidential client (keeps secret server-side) | yes | yes | no |
| Reaches a localhost OP            | yes    | no         | only via host browser |
| Hosted (no Go runtime needed)     | no     | yes        | yes            |
| Free tier                         | yes    | no (Workers Paid for DOs) | yes |

## Running in Docker

A multi-stage `Dockerfile` builds the SPA, builds the BFF, and ships them as a
single ~8 MB image (distroless, runs as `nonroot`). The BFF serves the prebuilt
SPA, so it's a single port — no Vite, no separate origin.

**Build and run:**

```sh
docker build -t repartee:local .
docker run --rm -p 7080:7080 repartee:local
```

…or with compose:

```sh
docker compose up --build
```

Then visit http://localhost:7080.

### Networking caveat (important)

When the BFF runs inside a container, `localhost` means the container, not your
host. So if your OP is running on the host (e.g. authentique on
`http://localhost:8080`), pointing the form at `http://localhost:8080` will
fail — the BFF can't reach it.

You have two options:

1. **Point it at `http://host.docker.internal:8080`** (the form's Issuer field).
   The compose file already adds the `host.docker.internal:host-gateway` mapping
   so this works on Linux too. **But** this requires your OP to advertise its
   discovery / token / jwks endpoints under that hostname — otherwise the BFF
   will follow the discovery doc and end up trying to reach
   `http://localhost:8080` again. For authentique, set its issuer URL to
   `http://host.docker.internal:8080` before starting.

2. **Run RePartee directly with `go run`** instead of in Docker — same single
   port, no networking gymnastics. This is the path of least resistance for
   local smoke testing against an OP on the same host.

In every case, register `http://localhost:7080/callback` as the redirect URI on
the OP. The browser hits the host port, so `localhost:7080` is the right
address from its perspective.

## The easy way: the parent `docker-compose.yml`

The simplest way to drive RePartee against a local authentique is to use the
**parent project's** `docker-compose.yml`, which already wires both services
together:

```sh
cd ..
docker compose up --build
```

Then visit http://repartee.localtest.me:7080 (or http://localhost:7080 — they
both reach the same container).

The trick that makes this work is `*.localtest.me`: it resolves to `127.0.0.1`
in public DNS, and the parent compose adds an internal alias of
`authentique.localtest.me` to the OP container. So the same hostname
(`http://authentique.localtest.me:8095`) reaches authentique from **both** the
browser (via the host's published port) and from the RePartee container (via
Docker's internal DNS). No more "localhost means different things in different
contexts" headaches.

Use that hostname as the **Issuer URL** in the form, and register
`http://repartee.localtest.me:7080/callback` (and/or
`http://localhost:7080/callback`) as a redirect URI on whatever client you
create in authentique.

## Pointing it at authentique (manually)

> A friendly suggestion: create a **dedicated client** in your OP for this tool
> alone, and delete it when you're done. The credentials you type into the form
> are saved in your browser's `localStorage` until you hit
> **Forget saved credentials**, so a tool-specific client keeps your blast
> radius small.

In the parent `authentique` app, create a client with:

- **Redirect URI:** `http://localhost:7080/callback`
- **Allowed flows:** authorization_code, refresh_token (and client_credentials
  if you want to test that)

Then in the RePartee UI:

- **Issuer:** whatever authentique advertises (typically `http://localhost:8080`)
- **Client ID / secret:** the ones you just created
- Click **Discover**, tick the scopes you want, pick a flow, hit **Go**.

## What it deliberately doesn't do

- Persist anything. Sessions live in memory and die with the process.
- Support multiple concurrent users. It assumes one human, one browser.
- Implement implicit / hybrid flows.
- Pretend to be production-grade.

That's by design — see `../ADR_relyingpary.md`.
