package bff

import (
	"context"
	"errors"
	"testing"
)

func TestExchangeCode_NoPKCE(t *testing.T) {
	op := newMockOP(t)
	srv := newTestServer(t, op.URL+"/cb")
	doc, err := srv.fetchDiscovery(context.Background(), op.URL)
	if err != nil {
		t.Fatal(err)
	}
	// Mint a code without PKCE.
	op.codes["plain-code"] = ""
	sess := &Session{
		Discovery:    doc,
		ClientID:     op.clientID,
		ClientSecret: "secret",
		RedirectURI:  op.URL + "/cb",
	}
	tr, err := srv.exchangeCode(context.Background(), sess, "plain-code")
	if err != nil {
		t.Fatalf("exchangeCode: %v", err)
	}
	if tr.AccessToken != "access-1" {
		t.Errorf("access_token = %q", tr.AccessToken)
	}
	if tr.IDToken == "" {
		t.Error("id_token should be present")
	}
}

func TestExchangeCode_BadGrantReturnsOIDCError(t *testing.T) {
	op := newMockOP(t)
	op.failNextToken = true
	srv := newTestServer(t, op.URL+"/cb")
	doc, err := srv.fetchDiscovery(context.Background(), op.URL)
	if err != nil {
		t.Fatal(err)
	}
	sess := &Session{
		Discovery:    doc,
		ClientID:     op.clientID,
		ClientSecret: "secret",
		RedirectURI:  op.URL + "/cb",
	}
	_, err = srv.exchangeCode(context.Background(), sess, "anything")
	if err == nil {
		t.Fatal("expected error")
	}
	var oe *OIDCError
	if !errors.As(err, &oe) {
		t.Fatalf("expected *OIDCError, got %T: %v", err, err)
	}
	if oe.Status != 400 || oe.Code != "invalid_grant" {
		t.Errorf("OIDCError = %+v", oe)
	}
}

func TestRefreshTokens(t *testing.T) {
	op := newMockOP(t)
	srv := newTestServer(t, op.URL+"/cb")
	doc, err := srv.fetchDiscovery(context.Background(), op.URL)
	if err != nil {
		t.Fatal(err)
	}
	sess := &Session{
		Discovery:    doc,
		ClientID:     op.clientID,
		ClientSecret: "secret",
		Tokens:       &TokenResponse{RefreshToken: "rt-1"},
	}
	tr, err := srv.refreshTokens(context.Background(), sess)
	if err != nil {
		t.Fatal(err)
	}
	if tr.AccessToken != "access-2" {
		t.Errorf("AccessToken = %q after refresh", tr.AccessToken)
	}
}

func TestRefreshTokens_NoRefreshToken(t *testing.T) {
	srv := newTestServer(t, "http://x/cb")
	sess := &Session{Tokens: &TokenResponse{}}
	if _, err := srv.refreshTokens(context.Background(), sess); err == nil {
		t.Fatal("expected error when refresh token missing")
	}
}

func TestClientCredentials(t *testing.T) {
	op := newMockOP(t)
	op.wantClientCredsScope = "api.read"
	srv := newTestServer(t, op.URL+"/cb")
	doc, err := srv.fetchDiscovery(context.Background(), op.URL)
	if err != nil {
		t.Fatal(err)
	}
	sess := &Session{
		Discovery:    doc,
		ClientID:     op.clientID,
		ClientSecret: "secret",
		Scopes:       []string{"api.read"},
	}
	tr, err := srv.clientCredentials(context.Background(), sess)
	if err != nil {
		t.Fatalf("clientCredentials: %v", err)
	}
	if tr.AccessToken != "cc-access" {
		t.Errorf("AccessToken = %q", tr.AccessToken)
	}
}
