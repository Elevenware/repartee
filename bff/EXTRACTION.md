# Extracting `bff` to its own repository

This is a plan for the eventual lift of `bff/` out of the `repartee` monorepo
into a standalone repo at **`github.com/Elevenware/bff`** (matching the module
path already chosen). It is intentionally not yet executed — the library is
still maturing in tree, where iteration is cheaper.

## When to do this

Trigger the extraction when **all** of the following are true:

- The public API has been stable across at least one repartee release cycle
  (no breaking changes in `bff.go` for ~a month of usage)
- A second consumer (real or planned) exists, justifying the cost of running a
  separate release process
- README and godoc are good enough that a third party could integrate without
  reading the test files

Until then, the in-repo `replace` directive in `cmd/bff/go.mod` is the right
trade-off.

## Target shape after extraction

```
github.com/Elevenware/bff               # new standalone repo
├── .github/workflows/ci.yml            # vet + test on PR/push
├── .github/workflows/release.yml       # on tag v*, publish + warm proxy
├── LICENSE                             # copied from repartee
├── README.md                           # already present, moves verbatim
├── go.mod / go.sum
└── *.go (bff package)

github.com/Elevenware/repartee          # unchanged otherwise
├── bff/                                # DELETED — pulled out
├── cmd/bff/
│   ├── go.mod                          # `replace` removed; pinned version
│   └── main.go
└── ...
```

## Step 1: Carve out history

Use `git filter-repo` (preferred over the deprecated `filter-branch`) to
preserve only commits that touched `bff/`, rewriting paths so files land at
the repo root.

```bash
git clone --no-local https://github.com/Elevenware/repartee.git bff-extract
cd bff-extract
git filter-repo \
  --path bff/ \
  --path-rename bff/:
```

Verify the result with `git log --stat` and `ls` — only library files should
remain. Discard test results from the repartee CI history (filter-repo will
already have removed them since they didn't touch `bff/`).

> **Sanity check:** `go test ./...` inside the rewritten clone must pass
> before pushing anywhere.

## Step 2: Create the new repository

1. Create empty `Elevenware/bff` on GitHub (no README, no .gitignore — the
   filtered history brings everything).
2. Push the rewritten history:
   ```bash
   git remote add origin git@github.com:Elevenware/bff.git
   git push -u origin main
   ```
3. Add a `LICENSE` file by copying repartee's, attributed to the same holder.
4. Configure branch protection on `main`: require PR + green CI before merge.
5. Set the repository description to match the README's one-liner.

## Step 3: CI workflow

Drop in `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        go: ['1.22', '1.23']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: ${{ matrix.go }}
          cache: true
      - run: go vet ./...
      - run: go build ./...
      - run: go test -race -coverprofile=coverage.out ./...
      - name: staticcheck
        uses: dominikh/staticcheck-action@v1
        with:
          version: latest
          install-go: false
```

Optional follow-up jobs (add when warranted, not on day one):
- `golangci-lint` for broader linting
- `codecov` upload of `coverage.out`
- `govulncheck` for vulnerability scanning

## Step 4: Release workflow

Go modules don't need a registry — consumers `go get` directly from a tag.
"Publishing" means: cut a semver tag, ensure tests passed, generate release
notes, and warm the public Go module proxy so the first downstream `go get`
isn't slow.

`.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ['v[0-9]+.[0-9]+.[0-9]+', 'v[0-9]+.[0-9]+.[0-9]+-*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: go test -race ./...
      - name: Create GitHub release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            --generate-notes \
            --title "$GITHUB_REF_NAME"
      - name: Warm proxy.golang.org
        run: |
          GOPROXY=https://proxy.golang.org \
            go list -m "github.com/elevenware/bff@$GITHUB_REF_NAME"
```

Cutting a release is then `git tag v0.1.0 && git push --tags`. The GitHub
release page will host auto-generated notes derived from merged PRs.

## Step 5: Versioning policy

- Stay on `v0.x.y` until the public API has not changed for ~a month under
  real usage. SemVer treats `v0.*` as unstable, so breaking changes are
  acceptable as long as the minor bumps.
- First post-stability release is `v1.0.0`; from there breaking changes
  require a major bump (which means a new module path `…/bff/v2`, per Go's
  semantic import versioning rules — avoid this if at all possible).
- Tag from `main` only. Pre-releases use `vX.Y.Z-rc1` etc.

## Step 6: Migrate repartee

Once `Elevenware/bff` has its first published tag:

1. In `cmd/bff/go.mod`:
   ```diff
   -require github.com/elevenware/bff v0.0.0
   -replace github.com/elevenware/bff => ../../bff
   +require github.com/elevenware/bff v0.1.0
   ```
2. Run `cd cmd/bff && go mod tidy` to refresh `go.sum`.
3. Delete the `bff/` directory from repartee.
4. Update the Dockerfile: drop the `COPY bff/` line; the `go mod download`
   step now fetches the library from `proxy.golang.org`.
5. Re-run repartee's end-to-end checks (`docker compose up --build`, browser
   auth round-trip against the dev OP) to confirm parity.
6. Open a single PR titled e.g. _"Move BFF to its own repository"_ that
   contains all of the above, ideally with the corresponding `Elevenware/bff`
   release linked from the description.

## Step 7: Communicate

After merge:
- Add a `<repo>/bff/` redirect note in the repartee README pointing at the
  new repo, in case anyone has it bookmarked.
- Pin the new repo on the Elevenware org page if it's intended for public
  consumption.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| History rewrite breaks blame for downstream forks | Document the cutover commit SHA in the new repo's first release notes |
| Repartee Dockerfile drift between the two repos | The library has no Dockerfile of its own; repartee continues to own the runtime image |
| Module path differs from repo name (`Elevenware` vs `elevenware`) | GitHub handles case-insensitive paths; `go.mod` line must stay lowercase as is. No change needed |
| First downstream `go get` is slow due to cold proxy cache | The release workflow's "Warm proxy.golang.org" step covers this |
| Breaking change leaks before v1.0.0 | Encouraged — that's what `v0.x` is for. Announce in release notes |

## Verification checklist

After the migration PR merges, both repos should pass independently:

- [ ] `Elevenware/bff` CI green on `main`
- [ ] `Elevenware/bff` has a tagged release visible at the GitHub Releases page
- [ ] `go list -m github.com/elevenware/bff@v0.1.0` resolves via the public proxy
- [ ] `cd cmd/bff && go build ./...` succeeds in repartee with no `replace`
- [ ] `docker compose up --build` in repartee starts the BFF and serves the SPA
- [ ] Full OIDC flow against the dev OP works: discover → start → callback → tokens → userinfo → refresh → logout
