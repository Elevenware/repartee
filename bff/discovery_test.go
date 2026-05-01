package bff

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFetchDiscovery_OK(t *testing.T) {
	op := newMockOP(t)
	srv := newTestServer(t, op.URL+"/cb")

	doc, err := srv.fetchDiscovery(context.Background(), op.URL)
	if err != nil {
		t.Fatalf("fetchDiscovery: %v", err)
	}
	if doc.TokenEndpoint != op.URL+"/token" {
		t.Errorf("token_endpoint = %q", doc.TokenEndpoint)
	}
	if len(doc.RawJSON) == 0 {
		t.Error("RawJSON should be populated")
	}
}

func TestFetchDiscovery_EmptyIssuer(t *testing.T) {
	srv := newTestServer(t, "http://x/cb")
	if _, err := srv.fetchDiscovery(context.Background(), ""); err == nil {
		t.Fatal("expected error for empty issuer")
	}
}

func TestFetchDiscovery_Non200(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	t.Cleanup(bad.Close)
	srv := newTestServer(t, "http://x/cb")
	_, err := srv.fetchDiscovery(context.Background(), bad.URL)
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("expected 500 in error, got %v", err)
	}
}

// newTestServer returns a *server with all defaults applied, suitable for
// tests that exercise non-handler library internals.
func newTestServer(t *testing.T, redirect string) *server {
	t.Helper()
	b, err := New(redirect)
	if err != nil {
		t.Fatal(err)
	}
	return b.srv
}
