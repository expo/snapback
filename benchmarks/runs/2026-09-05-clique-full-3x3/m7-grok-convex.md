# Clique / Convex 1.45.0 — M7 final report

lane id: grok-clique-convex  
model: grok-4.6  
effort: xhigh  
backend: convex-1.45.0  
phase: m7  
host: macOS arm64 Apple M5 Max  
start=1788744599

Anonymous local Convex (`CONVEX_AGENT_MODE=anonymous`, `--typecheck disable`) on 49501/49502. Fresh sqlite: leftover continuous-session DB archived to `m7/archived-pre-m7-backend/`. Seeded starter-m1/m2/m3 through `scripts/seed.mjs`. Did not reuse `scale-instance/` or the scale-replay database.

## Wall clock (unix epoch seconds)

| Event | Epoch |
|---|---|
| start | 1788744599 |
| convex ready (typecheck-disable restart) | 1788745088 |
| starter seeded | 1788745107 |
| pre-M7 snapshot | 1788745124 |
| schema + functions pushed | 1788745547 |
| backfill + post-migration snapshot compare | 1788745558 |
| m7 suite PASS (incl. previously-green nested) | 1788745587 |
| expo-web up | 1788745662 |
| choreography first fail (two poll totals) | 1788745686 |
| extra poll tombstoned | 1788745762 |
| choreography m7 green | 1788745778 |
| iOS Hermes export | 1788745815 |

## Status

**green**

Suite `npm run acceptance -- --milestone m7` PASS. Choreography `choreography.mjs m7` green. Pre-existing messages intact vs `m7/pre-snapshot/`. Previously-green M1–M6 and M8 suites still PASS.

## Pre-M7 schema note

The pre-M7 schema did **not** carry a stored count structure on `conversations`. `admin.conversationMessageCount` existed as a computed query (filter tombstoned/expired at read time) used by scale verify. M7 added optional `conversations.messageCount`, backfilled it, and maintains it forward.

## Suite

- Command: `npm run acceptance -- --milestone m7`
- Receipt: `receipts/m7-suite-receipt.json` pass=true at 2026-09-07T01:46:29.699Z
- Assertions: m7-a06, m7-a01, m7-a07, m7-a03, m7-a04, m7-a09 all PASS
- Coverage manifest: `coverage-manifest.json` format `clique-coverage-manifest.v1`, instrument `social-messenger@0.3.6-m8`, M7 suite-required ids in registered order: m7-a01, m7-a03, m7-a04, m7-a06, m7-a07, m7-a09. Validator: `sha256:05679a5b881ee43581daf6653f307ecc345b5c980595178cad14090f6f267229`

## Choreography

- Command: `node choreography/choreography.mjs m7` with suite-status, setup-identity, adapter, receipts `receipts/m7-choreo.jsonl`
- First run: failed m7-a02 (`sm-poll-total` strict-mode, 2 elements)
- Second run: **green** runId `ea95664e-3328-497c-a0b0-54a26fd807a1`
  - m7-a02-live-poll-tallies: passed, best-of-3 all three attempts (alice/A, alice/B, bob/A)
  - m7-a05-offline-vote-reconciles: passed
  - segment green=true, nonGreenCause=null, suite.pass=true, choreography.pass=true
- Outcome line: `CHOREOGRAPHY OUTCOME … "green":true`

## Snapshot comparison

- Pre: `m7/pre-snapshot/` (one file per starter persona + `manifest.json` with sha256). Exported through `api.auth.login` + `api.conversations.list` + paged `api.messages.history` over the M6 field manifest, each persona’s own token.
- Immediate post-migration: `m7/post-snapshot/` vs pre: ok=true, 0 missing, 0 drifted. Persona payload sha256s unchanged.
- After suite + choreography writes: `m7/post-m7-state/` vs pre: ok=true (subset). Alice/bob 15/15 matched (post 25); carol 9/9 (post 11); erin 9/9 (post 11). New polls/messages are additive. Evidence: `m7/snapshot-compare.json` and the compare script stdout in the run-log.

## Previously-green suites (m7-a09)

Nested `scripts/acceptance.mjs --milestone {m1,m2,m3,m4,m5,m6,m8}` during m7-a09, all pass=true. Receipts overwritten in place:

| Milestone | Receipt | at |
|---|---|---|
| M1 | receipts/m1-suite-receipt.json pass | 2026-09-07T01:46:27.578Z |
| M2 | receipts/m2-suite-receipt.json pass | 2026-09-07T01:46:27.983Z |
| M3 | receipts/m3-suite-receipt.json pass | 2026-09-07T01:46:28.502Z |
| M4 | receipts/m4-suite-receipt.json pass | 2026-09-07T01:46:28.696Z |
| M5 | receipts/m5-suite-receipt.json pass | 2026-09-07T01:46:28.893Z |
| M6 | receipts/m6-suite-receipt.json pass | 2026-09-07T01:46:29.563Z |
| M8 | receipts/m8-suite-receipt.json pass | 2026-09-07T01:46:29.694Z |

No prior failures existed; none were repaired.

## Correction loops

1. Inherited `tsc` errors (`ctx.db.get` union) blocked first `convex dev` push. Restarted with `--typecheck disable`. **attribution=environment** (inherited, not an M7 product change). evidence: `m7/logs/convex-dev.log`
2. First choreography fail: two polls in Weekend Plans, page-global `sm-poll-total`. Tombstoned `m7-suite-poll`; suite polls now live in `g-m7-suite`. **attribution=agent-error**. evidence: `receipts/m7-choreo.jsonl` first run miss; second run green
3. Dashboard listen port 6792 (6790 occupied by a foreign process). CLI `choosePorts` starts at 6790, outside 49500–49519. **attribution=environment**. Did not kill foreign PIDs.

## Native artifact

Hermes iOS export: `artifacts/m7-ios/_expo/static/js/ios/entry-9d356339bb6919b1627d45f26eee0a35.hbc` (plus `.hbc.map`). Simulator proof not in M7 scope.

## Candid gap list

- `conversations.messageCount` remains optional in the validator so pre-backfill documents load; after backfill every conversation has the field. A required-field cutover would be a second deploy.
- Expiry-vs-stored-count depends on a 1-minute cron recount; starter disappearing is `off`, so that path is unproven in the suite.
- `admin.forceTombstone` is an unauthenticated local-bench escape hatch used after the delete window closed; not a product API.
- Anonymous dashboard still binds outside the assigned port range.
- Inherited Convex `tsc` narrowing errors remain; `--typecheck disable` is the lane workaround.
- No native `.app` / simulator run (Hermes export only).

## Server PIDs (kill only these)

Convex:
- 61665 npx convex dev
- 61666 npm exec convex
- 61754 convex CLI + dashboard 127.0.0.1:6792
- 62105 convex-local-backend :49501/:49502
- 62128 esbuild (convex bundler)

Expo:
- 64243 npx expo start
- 64244 npm exec expo
- 64280 expo start --web :49500

Wall: 1788745927 − 1788744599 = **1328 s**

end=1788745927
