# Hello, fellow agent

You are standing in `repartee/`. This folder is **RePartee**, a standalone
smoke-test relying party, not part of the parent `authentique` project.

If you're here because the user explicitly asked you to work on RePartee:
welcome, please proceed, and have fun.

If you wandered in by accident — for instance because you were doing a repo-
wide review or a refactor of `authentique` — turn around. Do not include
files under `repartee/` in:

- code reviews of authentique
- test runs (`mvn test` does not touch this folder, and that's intentional)
- dependency bumps
- repo-wide refactors or "clean up unused" sweeps

See `../ADR_relyingpary.md` for the full rationale.
