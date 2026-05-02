// Command bff runs RePartee's HTTP server: the BFF library mounted alongside
// the built SPA, configured from environment variables.
package main

import (
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/elevenware/go-bff"
)

func main() {
	addr := getenv("RP_ADDR", ":7080")
	redirect := getenv("RP_REDIRECT_URI", "http://localhost:7080/callback")
	spaDir := getenv("RP_SPA_DIR", filepath.Join("..", "web", "dist"))

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	b, err := bff.New(redirect, bff.WithLogger(logger))
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	b.Mount(mux)
	mux.Handle("GET /", spaOrPlaceholder(spaDir))

	logger.Info("starting", "addr", addr, "redirectURI", redirect, "spaDir", spaDir)
	if err := http.ListenAndServe(addr, b.LoggingMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func spaOrPlaceholder(dir string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(filepath.Join(dir, "index.html")); err != nil {
			placeholder(w, r)
			return
		}
		clean := filepath.Clean(r.URL.Path)
		path := filepath.Join(dir, clean)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			http.ServeFile(w, r, path)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func placeholder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><meta charset=utf-8><title>RePartee</title>
<body style="font-family:system-ui;margin:3em;max-width:36em;line-height:1.5;color:#222">
<h1>RePartee BFF is up and waiting</h1>
<p>The SPA hasn't been built yet. Two ways forward:</p>
<ul>
<li><b>Single-port (production-style):</b> <code>cd ../web && npm install && npm run build</code>, then refresh.</li>
<li><b>Dev with hot reload:</b> run <code>npm run dev</code> in <code>../web</code> and visit
<a href="http://localhost:5173">http://localhost:5173</a>. Vite proxies API + callback here.</li>
</ul>
</body>`))
}
