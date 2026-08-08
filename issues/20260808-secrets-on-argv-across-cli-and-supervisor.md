# Secrets passed on argv in several CLI/supervisor paths (visible via `ps` / `/proc`)

**Opened:** 2026-08-08 · **Severity:** P2 (local secret exposure; contradicts the repo's own no-secrets-on-argv policy) · **Area:** cli / hosted-supervisor

The repo already enforces "never accept a secret as a command-line argument" in
`ConfigCommand::Set` (`--value-stdin`/`--value-fd`, cli.rs:1418-1440) and passes
supervised session tokens via env with an `@ref LLP 0181` custody comment. These
sites deviate:

1. **`secret-read-mint --token`** — `src/cli.rs:872-873`, consumed ~6770-6773.
   `#[arg(long)] token: Option<String>` accepts the admin token on argv; lands
   in shell history and is visible via `ps` for the command's duration.
   *Fix:* replace with `--token-stdin`/`--token-fd`, or drop it in favor of env
   + owner-only file discovery.

2. **Admin token on spawned native argv** — `packages/snapback-cli/index.mjs:1994`
   (used 2048-2052, 2140-2144): `['--token', adminToken]`. On Linux
   `/proc/<pid>/cmdline` is world-readable; any local user can harvest the
   dev-server admin token while `load`/`reset` runs (every watch-triggered
   regeneration re-runs `load`). *Fix:* pass via `SNAPBACK_ADMIN_TOKEN` env like
   `mintSupervisedOrdinarySession` (expo-dev.mjs:185-199), or the admin-token
   file path the binary already understands.

3. **Keychain writes via `security add-generic-password -w <value>`** —
   `packages/snapback-hosted-supervisor/bootstrap.mjs:242-248`,
   `target-onboarding.mjs:151-159`. Fly tokens, Tigris secret keys, admission
   seeds, and mTLS bundles are positional argv args, visible in the process
   table for the spawn's lifetime; `run()`'s `redact` only scrubs error output,
   not argv. *Fix:* feed the secret via stdin/fd to a helper rather than argv.

## Failure scenario

A local unprivileged process (multi-user host, or a compromised dependency in
another process) enumerates `ps`/`/proc` and harvests admin tokens or provider
root credentials during the window each command runs.

## Confidence

High on the mechanism at each site; medium on impact (local threat model, all
dev/bootstrap-tier). Grouped because the fix is one policy — route every secret
through stdin/fd/env, never argv — applied at three sites.
