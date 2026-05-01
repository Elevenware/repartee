package bff

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type server struct {
	cfg *Config
}

type discoverRequest struct {
	Issuer string `json:"issuer"`
}

type capabilities struct {
	PKCE              bool `json:"pkce"`
	AuthCode          bool `json:"auth_code"`
	ClientCredentials bool `json:"client_credentials"`
	Userinfo          bool `json:"userinfo"`
	Refresh           bool `json:"refresh"`
	Logout            bool `json:"logout"`
	Introspect        bool `json:"introspect"`
}

type discoverResponse struct {
	Doc          *DiscoveryDoc   `json:"doc"`
	Raw          json.RawMessage `json:"raw"`
	Capabilities capabilities    `json:"capabilities"`
}

func (s *server) discover(w http.ResponseWriter, r *http.Request) {
	var req discoverRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad request: "+err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	doc, err := s.fetchDiscovery(ctx, req.Issuer)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	caps := capabilities{
		PKCE:              hasS256(doc.CodeChallengeMethods),
		AuthCode:          len(doc.GrantTypesSupported) == 0 || containsAny(doc.GrantTypesSupported, "authorization_code"),
		ClientCredentials: containsAny(doc.GrantTypesSupported, "client_credentials"),
		Userinfo:          doc.UserinfoEndpoint != "",
		Refresh:           containsAny(doc.GrantTypesSupported, "refresh_token"),
		Logout:            doc.EndSessionEndpoint != "",
		Introspect:        doc.IntrospectionEndpoint != "",
	}
	writeJSON(w, discoverResponse{Doc: doc, Raw: doc.RawJSON, Capabilities: caps})
}

type startRequest struct {
	Issuer       string   `json:"issuer"`
	ClientID     string   `json:"client_id"`
	ClientSecret string   `json:"client_secret"`
	Scopes       []string `json:"scopes"`
	Flow         string   `json:"flow"`
	UsePKCE      bool     `json:"use_pkce"`
}

type startResponse struct {
	Redirect string         `json:"redirect,omitempty"`
	Tokens   *TokenResponse `json:"tokens,omitempty"`
}

func (s *server) start(w http.ResponseWriter, r *http.Request) {
	var req startRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad request: "+err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	doc, err := s.fetchDiscovery(ctx, req.Issuer)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}

	sess := s.ensureSession(w, r)
	sess.Issuer = req.Issuer
	sess.Discovery = doc
	sess.ClientID = req.ClientID
	sess.ClientSecret = req.ClientSecret
	sess.RedirectURI = s.cfg.RedirectURI
	sess.Scopes = req.Scopes
	sess.Flow = req.Flow
	sess.Tokens = nil
	sess.CodeVerifier = ""
	sess.State = ""
	sess.Nonce = ""

	switch req.Flow {
	case "client_credentials":
		tr, err := s.clientCredentials(ctx, sess)
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, err.Error())
			return
		}
		sess.Tokens = tr
		s.cfg.SessionStore.Put(sess)
		writeJSON(w, startResponse{Tokens: tr})
	case "auth_code", "":
		sess.Flow = "auth_code"
		sess.State = newID()
		sess.Nonce = newID()
		params := url.Values{
			"response_type": {"code"},
			"client_id":     {sess.ClientID},
			"redirect_uri":  {sess.RedirectURI},
			"scope":         {strings.Join(sess.Scopes, " ")},
			"state":         {sess.State},
			"nonce":         {sess.Nonce},
		}
		if req.UsePKCE {
			v, c := newPKCE()
			sess.CodeVerifier = v
			params.Set("code_challenge", c)
			params.Set("code_challenge_method", "S256")
		}
		s.cfg.SessionStore.Put(sess)
		u, err := url.Parse(doc.AuthorizationEndpoint)
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, "bad authorization_endpoint: "+err.Error())
			return
		}
		u.RawQuery = params.Encode()
		writeJSON(w, startResponse{Redirect: u.String()})
	default:
		writeJSONError(w, http.StatusBadRequest, "unknown flow: "+req.Flow)
	}
}

func (s *server) callback(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionFromRequest(r)
	if sess == nil {
		s.cfg.Logger.Warn("callback: no session cookie")
		http.Redirect(w, r, "/?error=no_session", http.StatusFound)
		return
	}
	q := r.URL.Query()
	if errCode := q.Get("error"); errCode != "" {
		desc := q.Get("error_description")
		s.cfg.Logger.Warn("callback: OP returned error", "errCode", errCode, "desc", desc)
		msg := errCode
		if desc != "" {
			msg += ": " + desc
		}
		http.Redirect(w, r, "/?error="+url.QueryEscape(msg), http.StatusFound)
		return
	}
	if state := q.Get("state"); state != sess.State {
		s.cfg.Logger.Warn("callback: state mismatch", "gotState", state, "expectedState", sess.State)
		http.Redirect(w, r, "/?error=state_mismatch", http.StatusFound)
		return
	}
	code := q.Get("code")
	if code == "" {
		params := make([]string, 0, len(q))
		for k := range q {
			params = append(params, k)
		}
		s.cfg.Logger.Warn("callback: missing code", "params", params)
		http.Redirect(w, r, "/?error=missing_code", http.StatusFound)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	s.cfg.Logger.Info("callback: exchanging code")
	tr, err := s.exchangeCode(ctx, sess, code)
	if err != nil {
		s.cfg.Logger.Error("callback: token exchange failed", "err", err.Error())
		http.Redirect(w, r, "/?error="+url.QueryEscape(err.Error()), http.StatusFound)
		return
	}
	sess.Tokens = tr
	s.cfg.SessionStore.Put(sess)
	s.cfg.Logger.Info("callback: token exchange ok")
	http.Redirect(w, r, "/?ok=1", http.StatusFound)
}

type tokensResponse struct {
	Tokens   *TokenResponse `json:"tokens,omitempty"`
	Issuer   string         `json:"issuer,omitempty"`
	Scopes   []string       `json:"scopes,omitempty"`
	Flow     string         `json:"flow,omitempty"`
	UsedPKCE bool           `json:"used_pkce,omitempty"`
	JwksURI  string         `json:"jwks_uri,omitempty"`
}

func (s *server) tokens(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionFromRequest(r)
	if sess == nil || sess.Tokens == nil {
		writeJSON(w, tokensResponse{})
		return
	}
	var jwksURI string
	if sess.Discovery != nil {
		jwksURI = sess.Discovery.JwksURI
	}
	writeJSON(w, tokensResponse{
		Tokens:   sess.Tokens,
		Issuer:   sess.Issuer,
		Scopes:   sess.Scopes,
		Flow:     sess.Flow,
		UsedPKCE: sess.CodeVerifier != "",
		JwksURI:  jwksURI,
	})
}

type verifyRequest struct {
	IDToken string `json:"id_token"`
	Key     string `json:"key,omitempty"`
}

func (s *server) verify(w http.ResponseWriter, r *http.Request) {
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "bad request: "+err.Error())
		return
	}
	sess := s.sessionFromRequest(r)
	var jwksURI string
	if sess != nil && sess.Discovery != nil {
		jwksURI = sess.Discovery.JwksURI
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	res := s.verifyToken(ctx, req.IDToken, req.Key, jwksURI)
	writeJSON(w, res)
}

func (s *server) userinfo(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionFromRequest(r)
	if sess == nil || sess.Tokens == nil || sess.Discovery == nil {
		writeJSONError(w, http.StatusBadRequest, "no session or tokens")
		return
	}
	if sess.Discovery.UserinfoEndpoint == "" {
		writeJSONError(w, http.StatusBadRequest, "no userinfo_endpoint advertised")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", sess.Discovery.UserinfoEndpoint, nil)
	req.Header.Set("Authorization", "Bearer "+sess.Tokens.AccessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := s.cfg.HTTPClient.Do(req)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

func (s *server) refresh(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionFromRequest(r)
	if sess == nil || sess.Tokens == nil {
		writeJSONError(w, http.StatusBadRequest, "no session or tokens")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tr, err := s.refreshTokens(ctx, sess)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	if tr.RefreshToken == "" {
		tr.RefreshToken = sess.Tokens.RefreshToken
	}
	sess.Tokens = tr
	s.cfg.SessionStore.Put(sess)
	writeJSON(w, tr)
}

func (s *server) introspect(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionFromRequest(r)
	if sess == nil || sess.Tokens == nil || sess.Discovery == nil {
		writeJSONError(w, http.StatusBadRequest, "no session or tokens")
		return
	}
	if sess.Discovery.IntrospectionEndpoint == "" {
		writeJSONError(w, http.StatusBadRequest, "no introspection_endpoint advertised")
		return
	}
	form := url.Values{
		"token":           {sess.Tokens.AccessToken},
		"token_type_hint": {"access_token"},
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", sess.Discovery.IntrospectionEndpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(url.QueryEscape(sess.ClientID), url.QueryEscape(sess.ClientSecret))
	resp, err := s.cfg.HTTPClient.Do(req)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	sess := s.sessionFromRequest(r)
	if sess == nil || sess.Discovery == nil {
		writeJSONError(w, http.StatusBadRequest, "no session")
		return
	}
	if sess.Discovery.EndSessionEndpoint == "" {
		writeJSONError(w, http.StatusBadRequest, "no end_session_endpoint advertised")
		return
	}
	params := url.Values{}
	if sess.Tokens != nil && sess.Tokens.IDToken != "" {
		params.Set("id_token_hint", sess.Tokens.IDToken)
	}
	params.Set("post_logout_redirect_uri", postLogoutRedirect(s.cfg.RedirectURI))
	u, err := url.Parse(sess.Discovery.EndSessionEndpoint)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	u.RawQuery = params.Encode()
	s.cfg.SessionStore.Remove(sess.ID)
	http.SetCookie(w, &http.Cookie{Name: s.cfg.CookieName, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]string{"redirect": u.String()})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func hasS256(methods []string) bool {
	for _, m := range methods {
		if m == "S256" {
			return true
		}
	}
	return false
}

func containsAny(haystack []string, needles ...string) bool {
	for _, h := range haystack {
		for _, n := range needles {
			if h == n {
				return true
			}
		}
	}
	return false
}

type configResponse struct {
	RPRedirectURI string `json:"rp_redirect_uri"`
}

func (s *server) config(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, configResponse{RPRedirectURI: s.cfg.RedirectURI})
}

func postLogoutRedirect(redirectURI string) string {
	u, err := url.Parse(redirectURI)
	if err != nil {
		return "/"
	}
	u.Path = "/"
	u.RawQuery = ""
	return u.String()
}
