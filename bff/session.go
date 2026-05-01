package bff

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

// Session is the per-browser state tracked by the BFF across the OAuth/OIDC
// flow and any subsequent token operations.
type Session struct {
	ID           string
	Issuer       string
	Discovery    *DiscoveryDoc
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Flow         string
	Scopes       []string
	State        string
	Nonce        string
	CodeVerifier string
	Tokens       *TokenResponse
	UpdatedAt    time.Time
}

// SessionStore persists Sessions keyed by ID. Implementations must be safe
// for concurrent use from multiple goroutines.
type SessionStore interface {
	Get(id string) *Session
	Put(s *Session)
	Remove(id string)
}

// MemoryStore is the default in-process SessionStore. It is safe for
// concurrent use; sessions are lost on restart and never expire.
type MemoryStore struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

// NewMemoryStore returns an empty in-memory SessionStore.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{sessions: make(map[string]*Session)}
}

func (s *MemoryStore) Get(id string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id]
}

func (s *MemoryStore) Put(sess *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess.UpdatedAt = time.Now()
	s.sessions[sess.ID] = sess
}

func (s *MemoryStore) Remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (s *server) sessionFromRequest(r *http.Request) *Session {
	c, err := r.Cookie(s.cfg.CookieName)
	if err != nil {
		return nil
	}
	return s.cfg.SessionStore.Get(c.Value)
}

func (s *server) ensureSession(w http.ResponseWriter, r *http.Request) *Session {
	if sess := s.sessionFromRequest(r); sess != nil {
		return sess
	}
	sess := &Session{ID: newID()}
	s.cfg.SessionStore.Put(sess)
	http.SetCookie(w, &http.Cookie{
		Name:     s.cfg.CookieName,
		Value:    sess.ID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return sess
}
