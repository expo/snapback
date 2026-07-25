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
