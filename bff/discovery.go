package bff

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// DiscoveryDoc is the subset of an OpenID Connect discovery document the BFF
// cares about, plus the raw bytes for callers that need to inspect more.
type DiscoveryDoc struct {
	Issuer                 string          `json:"issuer"`
	AuthorizationEndpoint  string          `json:"authorization_endpoint,omitempty"`
	TokenEndpoint          string          `json:"token_endpoint,omitempty"`
	UserinfoEndpoint       string          `json:"userinfo_endpoint,omitempty"`
	JwksURI                string          `json:"jwks_uri,omitempty"`
	EndSessionEndpoint     string          `json:"end_session_endpoint,omitempty"`
	IntrospectionEndpoint  string          `json:"introspection_endpoint,omitempty"`
	ScopesSupported        []string        `json:"scopes_supported,omitempty"`
	CodeChallengeMethods   []string        `json:"code_challenge_methods_supported,omitempty"`
	GrantTypesSupported    []string        `json:"grant_types_supported,omitempty"`
	ResponseTypesSupported []string        `json:"response_types_supported,omitempty"`
	RawJSON                json.RawMessage `json:"-"`
}

func (s *server) fetchDiscovery(ctx context.Context, issuer string) (*DiscoveryDoc, error) {
	issuer = strings.TrimRight(strings.TrimSpace(issuer), "/")
	if issuer == "" {
		return nil, fmt.Errorf("issuer is required")
	}
	url := issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.cfg.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("discovery returned %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	d := &DiscoveryDoc{}
	if err := json.Unmarshal(body, d); err != nil {
		return nil, fmt.Errorf("decoding discovery: %w", err)
	}
	d.RawJSON = body
	return d, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
