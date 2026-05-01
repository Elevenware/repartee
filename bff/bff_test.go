package bff

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

func TestNew_RequiresRedirectURI(t *testing.T) {
	if _, err := New(""); err == nil {
		t.Fatal("expected error for empty redirect URI")
	} else if !strings.Contains(err.Error(), "RedirectURI") {
		t.Fatalf("error should mention RedirectURI, got: %v", err)
	}
}

func TestNew_AppliesDefaults(t *testing.T) {
	b, err := New("http://x/cb")
	if err != nil {
		t.Fatal(err)
	}
	if b.srv.cfg.CookieName != "bff_session" {
		t.Errorf("default cookie name = %q, want bff_session", b.srv.cfg.CookieName)
	}
	if b.srv.cfg.SessionStore == nil {
		t.Error("default SessionStore not applied")
	}
	if b.srv.cfg.HTTPClient == nil {
		t.Error("default HTTPClient not applied")
	}
	if b.srv.cfg.Logger == nil {
		t.Error("default Logger not applied")
	}
}

func TestNew_OptionsOverride(t *testing.T) {
	store := NewMemoryStore()
	client := &http.Client{}
	logger := slog.Default()
	b, err := New("http://x/cb",
		WithCookieName("custom"),
		WithSessionStore(store),
		WithHTTPClient(client),
		WithLogger(logger),
	)
	if err != nil {
		t.Fatal(err)
	}
	if b.srv.cfg.CookieName != "custom" {
		t.Errorf("CookieName not overridden")
	}
	if b.srv.cfg.SessionStore != store {
		t.Errorf("SessionStore not overridden")
	}
	if b.srv.cfg.HTTPClient != client {
		t.Errorf("HTTPClient not overridden")
	}
	if b.srv.cfg.Logger != logger {
		t.Errorf("Logger not overridden")
	}
}

func TestOIDCError_Format(t *testing.T) {
	e := &OIDCError{Status: 400, Body: "boom", Code: "invalid_grant"}
	if !strings.Contains(e.Error(), "invalid_grant") || !strings.Contains(e.Error(), "400") {
		t.Errorf("unexpected error format: %s", e.Error())
	}
	var target *OIDCError
	if !errors.As(e, &target) {
		t.Errorf("errors.As failed for *OIDCError")
	}
}

func TestMount_RegistersRoutes(t *testing.T) {
	b, _ := New("http://x/cb")
	mux := http.NewServeMux()
	b.Mount(mux)
	// Ensure each declared route resolves to a handler (no panic on lookup).
	for _, p := range []string{
		"POST /api/discover", "POST /api/start", "GET /callback",
		"GET /api/tokens", "POST /api/verify", "POST /api/userinfo",
		"POST /api/refresh", "POST /api/introspect", "POST /api/logout",
		"GET /config",
	} {
		method, path, _ := strings.Cut(p, " ")
		req, _ := http.NewRequest(method, path, nil)
		_, pat := mux.Handler(req)
		if pat == "" {
			t.Errorf("route %q not registered", p)
		}
	}
}
