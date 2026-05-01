package bff

import (
	"context"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestVerifyToken_RS256_JWKS(t *testing.T) {
	op := newMockOP(t)
	srv := newTestServer(t, op.URL+"/cb")
	idToken := op.signIDToken(map[string]any{"email": "u@example.com"})
	res := srv.verifyToken(context.Background(), idToken, "", op.URL+"/jwks")
	if !res.Valid {
		t.Fatalf("expected valid, got error=%q", res.Error)
	}
	if res.Algorithm != "RS256" {
		t.Errorf("Algorithm = %q", res.Algorithm)
	}
	if res.KeyID != op.kid {
		t.Errorf("KeyID = %q, want %q", res.KeyID, op.kid)
	}
	if res.KeySource != "jwks" {
		t.Errorf("KeySource = %q", res.KeySource)
	}
	if res.Claims["email"] != "u@example.com" {
		t.Errorf("Claims missing email: %v", res.Claims)
	}
}

func TestVerifyToken_AlgNoneRejected(t *testing.T) {
	srv := newTestServer(t, "http://x/cb")
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{"sub": "x"})
	signed, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	res := srv.verifyToken(context.Background(), signed, "", "")
	if res.Valid {
		t.Fatal("alg=none must not validate")
	}
	if !strings.Contains(res.Error, "none") {
		t.Errorf("expected error to mention 'none', got: %q", res.Error)
	}
}

func TestVerifyToken_NoKeyMaterialOrJWKS(t *testing.T) {
	op := newMockOP(t)
	srv := newTestServer(t, op.URL+"/cb")
	idToken := op.signIDToken(nil)
	res := srv.verifyToken(context.Background(), idToken, "", "")
	if res.Valid {
		t.Fatal("must not validate without key material or JWKS")
	}
}

func TestVerifyToken_KidMismatch(t *testing.T) {
	op := newMockOP(t)
	srv := newTestServer(t, op.URL+"/cb")
	op.kid = "other-kid"
	idToken := op.signIDToken(nil)
	op.kid = "test-kid" // JWKS now advertises a different kid than the token
	res := srv.verifyToken(context.Background(), idToken, "", op.URL+"/jwks")
	if res.Valid {
		t.Fatal("kid mismatch must not validate")
	}
}
