package bff

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// VerifyResult is the outcome of an ID-token verification request. Valid is
// true only when the signature was checked against a key and matched.
type VerifyResult struct {
	Valid     bool           `json:"valid"`
	Algorithm string         `json:"alg,omitempty"`
	KeyID     string         `json:"kid,omitempty"`
	Header    map[string]any `json:"header,omitempty"`
	Claims    map[string]any `json:"claims,omitempty"`
	Error     string         `json:"error,omitempty"`
	KeySource string         `json:"key_source,omitempty"`
}

func (s *server) verifyToken(ctx context.Context, idToken, keyMaterial, jwksURI string) *VerifyResult {
	res := &VerifyResult{}
	header, claims, err := decodeJWTUnsafe(idToken)
	if err != nil {
		res.Error = "couldn't decode token: " + err.Error()
		return res
	}
	res.Header = header
	res.Claims = claims
	if alg, ok := header["alg"].(string); ok {
		res.Algorithm = alg
	}
	if kid, ok := header["kid"].(string); ok {
		res.KeyID = kid
	}
	if res.Algorithm == "" {
		res.Error = "no alg in JWT header"
		return res
	}
	if res.Algorithm == "none" {
		res.Error = "alg=none is not accepted"
		return res
	}

	var key any
	if strings.TrimSpace(keyMaterial) != "" {
		k, err := parseUserKey(keyMaterial)
		if err != nil {
			res.Error = "couldn't parse pasted key: " + err.Error()
			return res
		}
		key = k
		res.KeySource = "user"
	} else if jwksURI != "" {
		jwksDoc, err := s.fetchJWKS(ctx, jwksURI)
		if err != nil {
			res.Error = "couldn't fetch JWKS: " + err.Error()
			return res
		}
		k, err := jwksDoc.find(res.KeyID)
		if err != nil {
			res.Error = "no matching key in JWKS: " + err.Error()
			return res
		}
		key = k
		res.KeySource = "jwks"
	} else {
		res.Error = "no key material and no JWKS URI to fall back to"
		return res
	}

	method := jwt.GetSigningMethod(res.Algorithm)
	if method == nil {
		res.Error = "unsupported alg: " + res.Algorithm
		return res
	}
	parts := strings.Split(idToken, ".")
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		res.Error = "bad signature encoding: " + err.Error()
		return res
	}
	if err := method.Verify(parts[0]+"."+parts[1], sig, key); err != nil {
		res.Error = "signature mismatch: " + err.Error()
		return res
	}
	res.Valid = true
	return res
}

func decodeJWTUnsafe(token string) (header, claims map[string]any, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, fmt.Errorf("not a JWT (expected 3 parts, got %d)", len(parts))
	}
	h, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, nil, fmt.Errorf("header: %w", err)
	}
	p, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, fmt.Errorf("payload: %w", err)
	}
	if err := json.Unmarshal(h, &header); err != nil {
		return nil, nil, fmt.Errorf("header JSON: %w", err)
	}
	if err := json.Unmarshal(p, &claims); err != nil {
		return nil, nil, fmt.Errorf("payload JSON: %w", err)
	}
	return header, claims, nil
}

type jwks struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid,omitempty"`
	Alg string `json:"alg,omitempty"`
	Use string `json:"use,omitempty"`
	N   string `json:"n,omitempty"`
	E   string `json:"e,omitempty"`
	Crv string `json:"crv,omitempty"`
	X   string `json:"x,omitempty"`
	Y   string `json:"y,omitempty"`
}

func (j *jwks) find(kid string) (any, error) {
	var match *jwk
	for i := range j.Keys {
		k := &j.Keys[i]
		if kid != "" && k.Kid == kid {
			match = k
			break
		}
	}
	if match == nil && kid == "" && len(j.Keys) > 0 {
		match = &j.Keys[0]
	}
	if match == nil {
		return nil, fmt.Errorf("no JWK with kid=%q", kid)
	}
	return jwkToPublicKey(match)
}

func jwkToPublicKey(k *jwk) (any, error) {
	switch k.Kty {
	case "RSA":
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return nil, fmt.Errorf("RSA n: %w", err)
		}
		e, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, fmt.Errorf("RSA e: %w", err)
		}
		return &rsa.PublicKey{
			N: new(big.Int).SetBytes(n),
			E: int(new(big.Int).SetBytes(e).Int64()),
		}, nil
	case "EC":
		var curve elliptic.Curve
		switch k.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported EC curve: %s", k.Crv)
		}
		x, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			return nil, fmt.Errorf("EC x: %w", err)
		}
		y, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			return nil, fmt.Errorf("EC y: %w", err)
		}
		return &ecdsa.PublicKey{
			Curve: curve,
			X:     new(big.Int).SetBytes(x),
			Y:     new(big.Int).SetBytes(y),
		}, nil
	default:
		return nil, fmt.Errorf("unsupported key type: %s", k.Kty)
	}
}

func (s *server) fetchJWKS(ctx context.Context, uri string) (*jwks, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", uri, nil)
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
		return nil, fmt.Errorf("JWKS fetch returned %d", resp.StatusCode)
	}
	var j jwks
	if err := json.Unmarshal(body, &j); err != nil {
		return nil, err
	}
	return &j, nil
}

func parseUserKey(material string) (any, error) {
	material = strings.TrimSpace(material)
	if strings.HasPrefix(material, "-----BEGIN") {
		block, _ := pem.Decode([]byte(material))
		if block == nil {
			return nil, fmt.Errorf("PEM decode failed")
		}
		switch block.Type {
		case "PUBLIC KEY":
			return x509.ParsePKIXPublicKey(block.Bytes)
		case "RSA PUBLIC KEY":
			return x509.ParsePKCS1PublicKey(block.Bytes)
		case "CERTIFICATE":
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return nil, err
			}
			return cert.PublicKey, nil
		default:
			return nil, fmt.Errorf("unsupported PEM type: %s", block.Type)
		}
	}
	if strings.HasPrefix(material, "{") {
		var k jwk
		if err := json.Unmarshal([]byte(material), &k); err != nil {
			return nil, fmt.Errorf("not valid JWK JSON: %w", err)
		}
		return jwkToPublicKey(&k)
	}
	return nil, fmt.Errorf("unrecognised key format (expected PEM or JWK JSON)")
}
