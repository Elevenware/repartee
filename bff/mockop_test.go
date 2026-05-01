package bff

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// mockOP is a stand-in OpenID Provider used by tests. It implements just
// enough of the spec for the BFF library to drive happy-path flows.
type mockOP struct {
	*httptest.Server

	t        *testing.T
	priv     *rsa.PrivateKey
	kid      string
	clientID string

	// codeStore links issued auth codes to the PKCE verifier the client must
	// present at the token endpoint (empty when PKCE was not used).
	codes map[string]string

	wantClientCredsScope string
	refreshCallCount     int
	failNextToken        bool
}

func newMockOP(t *testing.T) *mockOP {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	op := &mockOP{
		t:        t,
		priv:     priv,
		kid:      "test-kid",
		clientID: "test-client",
		codes:    map[string]string{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", op.discovery)
	mux.HandleFunc("/auth", op.auth)
	mux.HandleFunc("/token", op.token)
	mux.HandleFunc("/userinfo", op.userinfo)
	mux.HandleFunc("/jwks", op.jwks)
	mux.HandleFunc("/end_session", func(w http.ResponseWriter, r *http.Request) {})
	mux.HandleFunc("/introspect", op.introspect)
	op.Server = httptest.NewServer(mux)
	t.Cleanup(op.Close)
	return op
}

func (op *mockOP) discovery(w http.ResponseWriter, r *http.Request) {
	doc := map[string]any{
		"issuer":                                op.URL,
		"authorization_endpoint":                op.URL + "/auth",
		"token_endpoint":                        op.URL + "/token",
		"userinfo_endpoint":                     op.URL + "/userinfo",
		"jwks_uri":                              op.URL + "/jwks",
		"end_session_endpoint":                  op.URL + "/end_session",
		"introspection_endpoint":                op.URL + "/introspect",
		"scopes_supported":                      []string{"openid", "profile", "email"},
		"code_challenge_methods_supported":      []string{"S256"},
		"grant_types_supported":                 []string{"authorization_code", "client_credentials", "refresh_token"},
		"response_types_supported":              []string{"code"},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(doc)
}

func (op *mockOP) auth(w http.ResponseWriter, r *http.Request) {
	// Issue an auth code; record the PKCE challenge so /token can validate.
	q := r.URL.Query()
	code := "code-" + newID()
	op.codes[code] = q.Get("code_challenge")
	redirectTo, _ := url.Parse(q.Get("redirect_uri"))
	rq := redirectTo.Query()
	rq.Set("code", code)
	rq.Set("state", q.Get("state"))
	redirectTo.RawQuery = rq.Encode()
	http.Redirect(w, r, redirectTo.String(), http.StatusFound)
}

func (op *mockOP) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if op.failNextToken {
		op.failNextToken = false
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"nope"}`))
		return
	}
	grant := r.Form.Get("grant_type")
	switch grant {
	case "authorization_code":
		code := r.Form.Get("code")
		challenge, ok := op.codes[code]
		if !ok {
			http.Error(w, "unknown code", 400)
			return
		}
		delete(op.codes, code)
		if challenge != "" {
			verifier := r.Form.Get("code_verifier")
			sum := sha256.Sum256([]byte(verifier))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
				http.Error(w, "PKCE verifier mismatch", 400)
				return
			}
		}
		op.writeTokens(w, "access-1", "refresh-1", op.signIDToken(map[string]any{"sub": "user-1"}))
	case "refresh_token":
		op.refreshCallCount++
		op.writeTokens(w, fmt.Sprintf("access-%d", op.refreshCallCount+1), "", "")
	case "client_credentials":
		if op.wantClientCredsScope != "" && r.Form.Get("scope") != op.wantClientCredsScope {
			http.Error(w, "wrong scope", 400)
			return
		}
		op.writeTokens(w, "cc-access", "", "")
	default:
		http.Error(w, "unsupported grant_type", 400)
	}
}

func (op *mockOP) writeTokens(w http.ResponseWriter, access, refresh, idToken string) {
	body := map[string]any{
		"access_token": access,
		"token_type":   "Bearer",
		"expires_in":   3600,
	}
	if refresh != "" {
		body["refresh_token"] = refresh
	}
	if idToken != "" {
		body["id_token"] = idToken
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func (op *mockOP) signIDToken(claims map[string]any) string {
	merged := jwt.MapClaims{
		"iss": op.URL,
		"aud": op.clientID,
		"sub": "user-1",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	for k, v := range claims {
		merged[k] = v
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, merged)
	tok.Header["kid"] = op.kid
	signed, err := tok.SignedString(op.priv)
	if err != nil {
		op.t.Fatalf("sign id_token: %v", err)
	}
	return signed
}

func (op *mockOP) userinfo(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		http.Error(w, "unauthorized", 401)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"sub":"user-1","email":"user@example.com"}`))
}

func (op *mockOP) introspect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"active":true}`))
}

func (op *mockOP) jwks(w http.ResponseWriter, r *http.Request) {
	pub := op.priv.PublicKey
	doc := map[string]any{
		"keys": []map[string]any{{
			"kty": "RSA",
			"kid": op.kid,
			"alg": "RS256",
			"use": "sig",
			"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
		}},
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(doc)
}
