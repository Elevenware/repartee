package main

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

const sessionCookie = "repartee_session"

type session struct {
	ID           string
	Issuer       string
	Discovery    *discoveryDoc
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Flow         string
	Scopes       []string
	State        string
	Nonce        string
	CodeVerifier string
	Tokens       *tokenResponse
	UpdatedAt    time.Time
}

type sessionStore struct {
	mu       sync.Mutex
	sessions map[string]*session
}

func newSessionStore() *sessionStore {
	return &sessionStore{sessions: make(map[string]*session)}
}

func (s *sessionStore) get(id string) *session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[id]
}

func (s *sessionStore) put(sess *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess.UpdatedAt = time.Now()
	s.sessions[sess.ID] = sess
}

func (s *sessionStore) remove(id string) {
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

func sessionFromRequest(r *http.Request, store *sessionStore) *session {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	return store.get(c.Value)
}

func ensureSession(w http.ResponseWriter, r *http.Request, store *sessionStore) *session {
	if s := sessionFromRequest(r, store); s != nil {
		return s
	}
	s := &session{ID: newID()}
	store.put(s)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    s.ID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return s
}
