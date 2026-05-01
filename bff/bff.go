// Package bff is a Backend-for-Frontend OpenID Connect Relying Party that
// any Go HTTP server can mount.
//
// It handles OIDC discovery, the authorization-code flow (with optional PKCE),
// the client-credentials flow, ID-token verification against a JWKS, refresh,
// introspection, userinfo and RP-initiated logout. Sessions are tracked via a
// pluggable SessionStore (in-memory by default).
//
// Typical use:
//
//	b, err := bff.New("https://app.example.com/callback")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	mux := http.NewServeMux()
//	b.Mount(mux)
//	mux.Handle("GET /", myFrontend)
//	http.ListenAndServe(":8080", mux)
package bff

import (
	"errors"
	"log/slog"
	"net/http"
	"time"
)

// Config holds the runtime configuration of a BFF instance. Most callers
// should use New together with the WithX options rather than constructing
// this struct directly.
type Config struct {
	// RedirectURI is the absolute URL the OP will redirect to after auth.
	// It must be reachable by the user's browser and must match what is
	// registered with the OP.
	RedirectURI string

	// CookieName is the name of the session cookie issued to the browser.
	// Defaults to "bff_session".
	CookieName string

	// SessionStore persists per-browser session state. Defaults to an
	// in-memory store (NewMemoryStore).
	SessionStore SessionStore

	// HTTPClient is used for all outbound calls to the OP (discovery,
	// token, userinfo, JWKS, introspection). Defaults to an http.Client
	// with a 10s timeout.
	HTTPClient *http.Client

	// Logger receives structured request/response and error logs.
	// Defaults to slog.Default.
	Logger *slog.Logger
}

// Option mutates a Config. Pass options to New.
type Option func(*Config)

// WithCookieName overrides the default session cookie name.
func WithCookieName(name string) Option {
	return func(c *Config) { c.CookieName = name }
}

// WithSessionStore plugs in a custom session store (e.g. Redis, SQL).
func WithSessionStore(s SessionStore) Option {
	return func(c *Config) { c.SessionStore = s }
}

// WithHTTPClient overrides the HTTP client used for all outbound OP calls.
func WithHTTPClient(client *http.Client) Option {
	return func(c *Config) { c.HTTPClient = client }
}

// WithLogger overrides the structured logger.
func WithLogger(l *slog.Logger) Option {
	return func(c *Config) { c.Logger = l }
}

// BFF is a configured Backend-for-Frontend instance. Use Handler or Mount
// to attach its routes to an HTTP server.
type BFF struct {
	srv *server
}

// New constructs a BFF. redirectURI must be the absolute callback URL
// registered with the OP. Options override any of the defaults documented on
// Config.
func New(redirectURI string, opts ...Option) (*BFF, error) {
	if redirectURI == "" {
		return nil, errors.New("bff: RedirectURI is required")
	}
	cfg := &Config{RedirectURI: redirectURI}
	for _, opt := range opts {
		opt(cfg)
	}
	if cfg.CookieName == "" {
		cfg.CookieName = "bff_session"
	}
	if cfg.SessionStore == nil {
		cfg.SessionStore = NewMemoryStore()
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &BFF{srv: &server{cfg: cfg}}, nil
}

// Handler returns an http.Handler covering every BFF route, wrapped in the
// built-in request/response logging middleware. Suitable for callers who
// want to mount the BFF as a single handler tree.
func (b *BFF) Handler() http.Handler {
	mux := http.NewServeMux()
	b.Mount(mux)
	return loggingMiddleware(b.srv.cfg.Logger, mux)
}

// Mount registers every BFF route on the supplied mux without applying the
// built-in logging middleware. Suitable for callers who compose their own
// middleware stack.
//
// Routes registered:
//
//	POST /api/discover
//	POST /api/start
//	GET  /callback
//	GET  /api/tokens
//	POST /api/verify
//	POST /api/userinfo
//	POST /api/refresh
//	POST /api/introspect
//	POST /api/logout
//	GET  /config
func (b *BFF) Mount(mux *http.ServeMux) {
	s := b.srv
	mux.HandleFunc("POST /api/discover", s.discover)
	mux.HandleFunc("POST /api/start", s.start)
	mux.HandleFunc("GET /callback", s.callback)
	mux.HandleFunc("GET /api/tokens", s.tokens)
	mux.HandleFunc("POST /api/verify", s.verify)
	mux.HandleFunc("POST /api/userinfo", s.userinfo)
	mux.HandleFunc("POST /api/refresh", s.refresh)
	mux.HandleFunc("POST /api/introspect", s.introspect)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("GET /config", s.config)
}

// LoggingMiddleware returns the BFF's built-in request/response logging
// middleware bound to the configured logger. Useful when calling Mount but
// still wanting the same access logs.
func (b *BFF) LoggingMiddleware(next http.Handler) http.Handler {
	return loggingMiddleware(b.srv.cfg.Logger, next)
}
