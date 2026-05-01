package bff

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// TokenResponse is a parsed token-endpoint response. Raw is the original JSON
// body so callers can recover provider-specific fields.
type TokenResponse struct {
	AccessToken  string          `json:"access_token,omitempty"`
	TokenType    string          `json:"token_type,omitempty"`
	ExpiresIn    int             `json:"expires_in,omitempty"`
	RefreshToken string          `json:"refresh_token,omitempty"`
	IDToken      string          `json:"id_token,omitempty"`
	Scope        string          `json:"scope,omitempty"`
	Raw          json.RawMessage `json:"raw,omitempty"`
}

// OIDCError is returned when the OP's token endpoint replies with a non-200
// status. Code carries the OAuth2 error code (when JSON-decodable), Body
// carries the raw response, Status the HTTP status.
type OIDCError struct {
	Status int
	Body   string
	Code   string
}

func (e *OIDCError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("token endpoint returned %d (%s): %s", e.Status, e.Code, truncate(e.Body, 200))
	}
	return fmt.Sprintf("token endpoint returned %d: %s", e.Status, truncate(e.Body, 200))
}

func (s *server) exchangeCode(ctx context.Context, sess *Session, code string) (*TokenResponse, error) {
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {sess.RedirectURI},
	}
	if sess.CodeVerifier != "" {
		form.Set("code_verifier", sess.CodeVerifier)
	}
	return s.tokenRequest(ctx, sess.Discovery.TokenEndpoint, form, sess.ClientID, sess.ClientSecret)
}

func (s *server) clientCredentials(ctx context.Context, sess *Session) (*TokenResponse, error) {
	form := url.Values{"grant_type": {"client_credentials"}}
	if len(sess.Scopes) > 0 {
		form.Set("scope", strings.Join(sess.Scopes, " "))
	}
	return s.tokenRequest(ctx, sess.Discovery.TokenEndpoint, form, sess.ClientID, sess.ClientSecret)
}

func (s *server) refreshTokens(ctx context.Context, sess *Session) (*TokenResponse, error) {
	if sess.Tokens == nil || sess.Tokens.RefreshToken == "" {
		return nil, fmt.Errorf("no refresh token available")
	}
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {sess.Tokens.RefreshToken},
	}
	return s.tokenRequest(ctx, sess.Discovery.TokenEndpoint, form, sess.ClientID, sess.ClientSecret)
}

func (s *server) tokenRequest(ctx context.Context, endpoint string, form url.Values, clientID, clientSecret string) (*TokenResponse, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("no token_endpoint advertised")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(url.QueryEscape(clientID), url.QueryEscape(clientSecret))

	resp, err := s.cfg.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &errResp)
		return nil, &OIDCError{Status: resp.StatusCode, Body: string(body), Code: errResp.Error}
	}
	tr := &TokenResponse{}
	if err := json.Unmarshal(body, tr); err != nil {
		return nil, err
	}
	tr.Raw = body
	return tr, nil
}
