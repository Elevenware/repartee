# bff

A small Go library that turns any `net/http` server into an OpenID Connect
**Backend-for-Frontend** for a single-page app: the SPA never sees client
secrets or tokens, the BFF holds the session.

```go
import "github.com/elevenware/bff"

b, err := bff.New("https://app.example.com/callback")
if err != nil {
    log.Fatal(err)
}
mux := http.NewServeMux()
b.Mount(mux)
mux.Handle("GET /", myFrontend)
http.ListenAndServe(":8080", b.LoggingMiddleware(mux))
```

## What it covers

- OpenID Connect discovery (`/.well-known/openid-configuration`)
- Authorization code flow, with optional **PKCE** (S256)
- Client credentials flow
- Token refresh and introspection
- Userinfo proxy
- ID-token verification against a JWKS (RS\* and ES\*) or caller-supplied
  PEM/JWK key
- RP-initiated logout
- Cookie-based session storage with a pluggable backend

## HTTP routes registered by `Mount`

| Method | Path              | Purpose                          |
|--------|-------------------|----------------------------------|
| POST   | `/api/discover`   | Fetch + summarise OP discovery   |
| POST   | `/api/start`      | Begin auth-code or client-creds  |
| GET    | `/callback`       | OAuth2 redirect target           |
| GET    | `/api/tokens`     | Tokens held in the session       |
| POST   | `/api/verify`     | Verify a JWT (id_token)          |
| POST   | `/api/userinfo`   | Proxy to OP userinfo             |
| POST   | `/api/refresh`    | Refresh the access token         |
| POST   | `/api/introspect` | Proxy to OP introspection        |
| POST   | `/api/logout`     | Build RP-initiated logout URL    |
| GET    | `/config`         | Echo the configured redirect URI |

Pass your own `*http.ServeMux` and add middleware/prefixes as you like.

## Configuration

```go
b, _ := bff.New(
    redirectURI,
    bff.WithCookieName("my_app_session"),
    bff.WithSessionStore(myRedisStore),    // SessionStore interface
    bff.WithHTTPClient(&http.Client{...}), // outbound calls to the OP
    bff.WithLogger(slog.New(...)),
)
```

`SessionStore`:

```go
type SessionStore interface {
    Get(id string) *bff.Session
    Put(s *bff.Session)
    Remove(id string)
}
```

The default `NewMemoryStore()` is fine for tests and single-process dev; for
production with more than one replica, plug in your own.

## Errors

Token-endpoint failures arrive as `*bff.OIDCError`:

```go
var oe *bff.OIDCError
if errors.As(err, &oe) && oe.Code == "invalid_grant" { ... }
```

## Non-goals (for now)

- Persistent session stores (Redis / SQL / etc.) — bring your own
- Session TTL or GC
- Static file / SPA serving — compose with `http.FileServer`
- Metrics / OTel — wrap `Mount`'s mux with your own middleware
