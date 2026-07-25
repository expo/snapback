# hosted: migrate root-level system routes under /_snapback/*

**Opened:** 2026-07-25
**Decision:** Charlie, 2026-07-25 — migrate; no LLP 0031 exception
(LLP 0093 former OQ6, decided in v0.10).
**Systems:** Cloudflare arm, Server routes, LLP 0031

Active LLP 0031's invariant: system operations live under the reserved
`/_snapback/*` prefix; "no system operation lives at the root" — so a
proxy can gate the entire system surface with one prefix rule. The hosted
gateway violates this: `/cron/run` and `/cron/status`
(`cloudflare/src/gateway.js:128-135`), plus `/config/status`,
`/host-call`, `/reset`, `/evict`, and the `/__test/*` family are served at
the root (each carries its own auth gate, so this is a spec violation and
proxy footgun, not a live vulnerability). Found by the LLP 0093
super-refine (Round 3 Codex; widened Round 4 Fable).

## Scope

- Enumerate the actual hosted root system-route set from the gateway
  source (the list above is non-exhaustive by declaration).
- Move each under `/_snapback/*` (gateway routing + coordinator handlers),
  preserving auth gates; decide per route whether a temporary root alias
  with a deprecation window is needed for existing suites/tools.
- Update the hosted acceptance suites (`cloudflare/test/*`) and any diary
  or guide references to the old paths.
- Land LLP 0031 route-taxonomy entries for the migrated routes; record
  the outcome in LLP 0093 P-0's arm × route matrix.
- Redeploy the shared Cloudflare environment (coordinate with concurrent
  fleet sessions before touching it).

Belongs to the LLP 0093 P-0 cluster; graduate to Linear if it needs
cross-session scheduling.

## Resolution (2026-07-25) — RESOLVED

Executed as part of the LLP 0093 P-0 landing (spec: LLP 0094 §0A.3; LLP
0031 dated amendment 2026-07-25 carries the route-taxonomy rows).

- **Enumeration.** The gateway's actual root system-route set at
  `6fe11376` was seven families: `/cron/run`, `/cron/status`,
  `/config/status`, `/host-call`, `/reset`, `/evict`, and the `/__test/*`
  family (22 coordinator operations). `/health`, `/inspect`,
  `/capability`, and the kit/app-data routes are app-data and stayed
  at the root.
- **Migration.** `/_snapback/api/cron/run`, `/_snapback/api/cron/status`,
  `/_snapback/api/config/status`, `/_snapback/api/app/reset`,
  `/_snapback/api/object/evict`, `/_snapback/host-call`, and
  `/_snapback/test/*` — gateway routing + coordinator handlers, each
  preserving its existing auth gate (admin token / public-bounded
  projection / per-invocation host-call token / `SNAPBACK_TESTING=1`).
  The gateway additionally refuses unmatched `/_snapback/*` paths with a
  JSON 404 (never the SPA asset fallback). The shared workerd harness and
  the local loopback listener (`packages/snapback-harness/workerd/
  handler-server.mjs`, `src/workerd_exec.rs`) moved to the same
  `/_snapback/host-call` path so both arms share one seam path.
- **No root aliases.** All consumers are in-repo and were repointed in
  the same change: `cloudflare/test/*` suites (local and remote),
  `cloudflare/deploy.sh`, `cloudflare/config-set.mjs`,
  `cloudflare/README.md`, `cloudflare/src/platform-errors.js`, and the
  deployment-identity manifests were regenerated.
- **Verification.** `node cloudflare/test/local-suite.mjs` (the full
  non-remote inventory) green on the migrated paths; Rust
  `workerd_exec` transport tests updated and green.
- **Redeploy executed (2026-07-25, later the same day).** Both proofs
  redeployed from main at `951d7d21` with a fresh Workers-scoped API
  token: all-aboard gateway version `c98e51e6`, notes gateway version
  `3e69104f`. Live verification: `/_snapback/api/cron/status` serves
  real JSON, old-path `/cron/status` falls to the SPA (no root aliases,
  as designed). Notes remote suite 11/11 (including the analytics
  billing read). All-aboard remote suite 16/17 — the one failure
  (`live 511 refresh writes real future departure rows`) is
  environmental: the refresh committed through the real 511 key but
  upstream returned 0 monitored visits at 04:35 PT on a Saturday,
  before the first weekend Caltrain departure; rerun during service
  hours. Deploy friction hit along the way is filed as
  `issues/20260725-deploy-stale-schema-hash-reset-race.md`.
