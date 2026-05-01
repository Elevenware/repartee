package bff

import (
	"sync"
	"testing"
)

func TestMemoryStore_PutGetRemove(t *testing.T) {
	s := NewMemoryStore()
	if got := s.Get("missing"); got != nil {
		t.Errorf("Get on empty store should be nil, got %+v", got)
	}
	sess := &Session{ID: "abc", Issuer: "https://op"}
	s.Put(sess)
	got := s.Get("abc")
	if got == nil || got.Issuer != "https://op" {
		t.Errorf("Get after Put = %+v", got)
	}
	if got.UpdatedAt.IsZero() {
		t.Error("Put should stamp UpdatedAt")
	}
	s.Remove("abc")
	if got := s.Get("abc"); got != nil {
		t.Errorf("Get after Remove should be nil, got %+v", got)
	}
}

func TestMemoryStore_ConcurrentAccess(t *testing.T) {
	s := NewMemoryStore()
	const n = 100
	var wg sync.WaitGroup
	wg.Add(n * 3)
	for i := 0; i < n; i++ {
		id := newID()
		go func() { defer wg.Done(); s.Put(&Session{ID: id}) }()
		go func() { defer wg.Done(); _ = s.Get(id) }()
		go func() { defer wg.Done(); s.Remove(id) }()
	}
	wg.Wait()
}
