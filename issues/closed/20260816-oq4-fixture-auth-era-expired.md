# The 5.5M-row OQ4 measurement baseline no longer boots under current binaries

**Opened:** 2026-08-16 · **Closed:** 2026-08-16 (resolved same-day) ·
**Severity:** P2 measurement infrastructure ·
**Found by:** the LLP 0209 G1 D2-H1 measurement attempt (perf-direction
orchestration, 2026-08-15/16)

`demos/zerobugs/fixtures-local/hot-diag-baseline/` (built 2026-08-07/08,
9.1 GB, the basis for every OQ4/P1 A/B arm) fails startup under a current
main-era binary with `SNAPBACK_AUTH_PROJECTION_CORRUPT: session projection
source could not be read with its exact declared types`. Root cause: the
auth catalog evolved (e.g. `_auth_sessions` has no `authn_source` column,
which current `session_projection_source_inner` queries), and the catalog is
deliberately fail-closed at open (LLP 0055 refuse-at-open; no v(N)→v(N+1)
migration exists for these fixture eras).

Surgical repair was probed and does not converge — each step exposes the
next fail-closed gate, all working as designed:
1. delete stale `_auth_sessions` rows → same refusal (whole-source typed read);
2. drop `_auth*` tables + all `%auth%` meta → `SNAPBACK_AUTH_MODE_STATE_CORRUPT`
   (companion `schema_manifest_capability_aware` without mode state);
3. drop tables + catalog/stream/invalidation/epoch keys, keep mode state →
   `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` (with or without the era-old keyring
   sidecar; startup catalog activation does not proceed under the preserved
   settled email-code mode state).

**Blocked measurements:**
- LLP 0209 G1 **D2-H1** (memo on/off, six-observer same-partition settle p50
  + evaluation counts). The G1 code is landed with a 17-test family; the
  performance-shape hypothesis remains unmeasured.
- The `issues/20260809-mutate-stage-turn-cost-bisect.md` equal-boundary A/B
  (also needs era-matched binaries for BOTH endpoints, which that ticket's
  protocol already handles by building both).

**Ask (either resolves this):**
1. Regenerate the baseline with a current binary: the recipe lives in
   `demos/zerobugs/fixtures-local/hot-diag-baseline/run-ingest.sh` + README
   (large-seed42-v1 CSV shards + overlay are intact and era-independent).
   Hours of unattended ingest; produce a fresh `hot-diag-baseline` stamped
   with the generating commit, and record the generating-era rule below.
2. Or land a sanctioned fixture-era refresh path (auth-catalog-only rebuild
   for stores whose app data is wanted but whose auth catalog is expired) —
   only if such a path is wanted for production stores too; do not build a
   measurement-only bypass of the fail-closed catalog wall.

**Rule to record with the fix:** measurement fixtures are era-bound by the
fail-closed auth catalog; every fixture must carry its generating commit,
and every measurement program must either pin era-matched binaries or
regenerate. LLP 0265's environment-pinning section should absorb this once
the fixture story is settled.

## Resolution (2026-08-16)

Regenerated via ask 1. Working recipe (all steps required):
`snapback dev demos/zerobugs/control/snapback --db <dir>/diag.sqlite3
--ready-file <dir>/ready.json` with
`SNAPBACK_RUNTIME_BINARY=<worktree>/target/debug/snapback` (the CLI writes a
current-era `startup-artifacts.json` beside the ready file — do NOT feed the
old carrier: the loader then refuses with
SNAPBACK_ARTIFACT_IDENTITY_MISMATCH), `bun install` inside
`demos/zerobugs/control` first (the loader spawns `node_modules/.bin/snapback`
for `session mint`), then `bun scripts/load-large-fixture.mts --fixture-root
<primary>/demos/zerobugs/fixtures-local/large-seed42-v1 --ready-file <...>`
(~80 min, 6,176 batches). The new pristine lives at the g1-memo worktree's
`demos/zerobugs/fixtures-local/oq4-clone/` with `GENERATING_ERA.txt` naming
the generating commit (the era rule from this ticket, now in practice).

Caveat recorded in LLP 0209 v0.3: the regenerated store is *cooler* than the
2026-08-08 baseline (hot frames ~5 MB vs 61–68 MB) because the old store had
burned-in diagnosis history; byte-scale claims must requalify on a burned-in
store. LLP 0265's environment-pinning section should absorb the
fixture-era rule when next revised.
