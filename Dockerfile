# syntax=docker/dockerfile:1.7

# --- Stage 1: build the SPA ---
FROM node:20-alpine AS web-build
# web/package.json declares @repartee/shared as "file:../shared", so the
# shared/ tree must exist alongside web/ before `npm ci` resolves it.
WORKDIR /src
COPY shared/ ./shared/
COPY web/package.json web/package-lock.json ./web/
WORKDIR /src/web
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: build the BFF ---
# The deployable binary lives in cmd/bff and consumes the bff/ library via a
# local replace directive, so both module trees are needed at build time.
FROM golang:1.22-alpine AS bff-build
WORKDIR /src
COPY bff/ ./bff/
COPY cmd/bff/ ./cmd/bff/
WORKDIR /src/cmd/bff
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/bff .

# --- Stage 3: minimal runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=bff-build /out/bff /app/bff
COPY --from=web-build /src/web/dist /app/web

ENV RP_ADDR=:7080 \
    RP_SPA_DIR=/app/web \
    RP_REDIRECT_URI=http://localhost:7080/callback

EXPOSE 7080
USER nonroot:nonroot
ENTRYPOINT ["/app/bff"]
