package bff

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestRoundtrip_AuthCodePKCE walks through discover → start → callback →
// tokens against a mock OP, exercising the full library through its public
// HTTP surface.
func TestRoundtrip_AuthCodePKCE(t *testing.T) {
	op := newMockOP(t)
	b, err := New("http://placeholder/cb")
	if err != nil {
		t.Fatal(err)
	}
	bffSrv := httptest.NewServer(b.Handler())
	t.Cleanup(bffSrv.Close)

	// The redirect URI inside the running BFF must point at /callback on the
	// test server, since the mock OP redirects the browser there.
	b.srv.cfg.RedirectURI = bffSrv.URL + "/callback"

	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Jar:           jar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	}

	// 1. Discover.
	postJSON(t, client, bffSrv.URL+"/api/discover", map[string]any{"issuer": op.URL}, http.StatusOK)

	// 2. Start auth code with PKCE.
	startBody := postJSON(t, client, bffSrv.URL+"/api/start", map[string]any{
		"issuer":        op.URL,
		"client_id":     op.clientID,
		"client_secret": "secret",
		"scopes":        []string{"openid", "email"},
		"flow":          "auth_code",
		"use_pkce":      true,
	}, http.StatusOK)
	var startRes startResponse
	if err := json.Unmarshal(startBody, &startRes); err != nil {
		t.Fatalf("decode /api/start: %v", err)
	}
	if startRes.Redirect == "" {
		t.Fatal("/api/start did not return a redirect URL")
	}

	// 3. Visit the OP's auth endpoint; it 302s back to /callback with code+state.
	resp, err := client.Get(startRes.Redirect)
	if err != nil {
		t.Fatalf("auth GET: %v", err)
	}
	resp.Body.Close()
	cb := resp.Header.Get("Location")
	if !strings.Contains(cb, "/callback?") {
		t.Fatalf("expected redirect to /callback, got %q", cb)
	}

	// 4. Hit the BFF's /callback (cookie jar carries the session cookie).
	resp, err = client.Get(cb)
	if err != nil {
		t.Fatalf("callback GET: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusFound || !strings.HasSuffix(resp.Header.Get("Location"), "/?ok=1") {
		t.Fatalf("callback should redirect to /?ok=1, got status=%d loc=%q", resp.StatusCode, resp.Header.Get("Location"))
	}

	// 5. /api/tokens reflects the exchanged tokens.
	tokensBody := getJSON(t, client, bffSrv.URL+"/api/tokens", http.StatusOK)
	var tr tokensResponse
	if err := json.Unmarshal(tokensBody, &tr); err != nil {
		t.Fatalf("decode /api/tokens: %v", err)
	}
	if tr.Tokens == nil || tr.Tokens.AccessToken != "access-1" {
		t.Errorf("/api/tokens unexpected: %+v", tr)
	}
	if !tr.UsedPKCE {
		t.Error("UsedPKCE should be true")
	}

	// 6. /api/refresh rotates the access token.
	refreshBody := postJSON(t, client, bffSrv.URL+"/api/refresh", nil, http.StatusOK)
	var refreshed TokenResponse
	if err := json.Unmarshal(refreshBody, &refreshed); err != nil {
		t.Fatalf("decode /api/refresh: %v", err)
	}
	if refreshed.AccessToken != "access-2" {
		t.Errorf("refresh access_token = %q", refreshed.AccessToken)
	}

	// 7. /api/userinfo proxies the OP's response.
	uiBody := postJSON(t, client, bffSrv.URL+"/api/userinfo", nil, http.StatusOK)
	if !strings.Contains(string(uiBody), "user@example.com") {
		t.Errorf("/api/userinfo body unexpected: %s", uiBody)
	}

	// 8. /api/logout returns a redirect URL pointing at end_session_endpoint.
	logoutBody := postJSON(t, client, bffSrv.URL+"/api/logout", nil, http.StatusOK)
	var logout map[string]string
	_ = json.Unmarshal(logoutBody, &logout)
	if !strings.Contains(logout["redirect"], "/end_session") {
		t.Errorf("/api/logout redirect unexpected: %q", logout["redirect"])
	}

	// After logout the session is gone — /api/tokens returns the empty shape.
	tokensBody = getJSON(t, client, bffSrv.URL+"/api/tokens", http.StatusOK)
	if !bytes.Contains(tokensBody, []byte("{}")) && !bytes.Contains(tokensBody, []byte("\n}")) {
		t.Errorf("expected empty tokens response after logout, got %s", tokensBody)
	}
}

func TestConfigEndpoint(t *testing.T) {
	b, _ := New("http://app/cb")
	srv := httptest.NewServer(b.Handler())
	t.Cleanup(srv.Close)
	body := getJSON(t, srv.Client(), srv.URL+"/config", http.StatusOK)
	if !strings.Contains(string(body), `"rp_redirect_uri": "http://app/cb"`) {
		t.Errorf("/config unexpected body: %s", body)
	}
}

func TestStart_UnknownFlow(t *testing.T) {
	op := newMockOP(t)
	b, _ := New(op.URL + "/cb")
	srv := httptest.NewServer(b.Handler())
	t.Cleanup(srv.Close)
	postJSON(t, srv.Client(), srv.URL+"/api/start", map[string]any{
		"issuer": op.URL, "client_id": "c", "client_secret": "s",
		"flow": "device_code",
	}, http.StatusBadRequest)
}

func postJSON(t *testing.T, c *http.Client, url string, body any, wantStatus int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	resp, err := c.Post(url, "application/json", &buf)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("POST %s: status=%d, want %d, body=%s", url, resp.StatusCode, wantStatus, out)
	}
	return out
}

func getJSON(t *testing.T, c *http.Client, url string, wantStatus int) []byte {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("GET %s: status=%d, want %d, body=%s", url, resp.StatusCode, wantStatus, out)
	}
	return out
}
