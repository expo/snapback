# LLP 0102 final confirmation and provider-refresh report

**Observed:** 2026-07-29  
**Protocol aggregate:** `ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`  
**Final Snapback source freeze:** `4e5da63c33064082c73359f0ee02efcd11e360ff`  
**Stop-class provider defects:** Convex / Research Room only

## Result

All five Snapback applications reproduced their remediated product outcomes
from immutable staged packages in clean external projects. The three material
competitor-version refreshes also completed. No Snapback product source changed
after the final freeze.

| Final arm | Current package/version boundary | Result |
| --- | --- | --- |
| Todo / Snapback | staged `0.1.1-llp0102.1`, Linux x64 | 11 PASS / 3 GAP / 0 FAIL |
| Chat / Snapback | staged `0.1.1-llp0102.1`, Linux x64 | 14 PASS / 1 GAP / 0 FAIL |
| Linear / Snapback | staged `0.1.1-llp0102.1`, Darwin arm64 | 10 PASS / 4 GAP / 0 FAIL |
| Partiful / Snapback | staged `0.1.1-llp0102.1`, Darwin arm64 | 12 PASS / 3 GAP / 0 FAIL |
| Research Room / Snapback | staged `0.1.1-llp0102.1`, Darwin arm64 | 13 PASS / 2 GAP / 0 FAIL |
| Research Room / Supabase | JS 2.111.0, CLI 2.110.0 | 15 PASS / 0 GAP / 0 FAIL locally; hosted deploy unsampled |
| Chat / Firebase | Web 12.16.0, CLI 15.24.0, Admin 14.2.0, Functions 7.3.2 | 15 PASS / 0 GAP / 0 FAIL locally; hosted deploy unsampled |
| Linear / Firebase | Web 12.16.0, CLI 15.24.0, Admin 14.2.0, Functions 7.3.2 | 12 PASS / 1 GAP / 1 unavailable / 0 FAIL |

The final evidence is additive. It does not overwrite any of the 35 sealed
capsules, original timings, failed attempts, or remediation lineage.

## Snapback package boundary

The exact freeze produced seven-package host closures for Darwin arm64 and
Linux x64. Both official cold-install proofs passed:

- materialized tarball installation;
- offline local and remote code generation;
- bundled schemas and capability corpus;
- packaged CLI introspection and runtime doctor;
- scaffold, generate, deploy-build, and deploy verification;
- managed dev readiness, attach/watch, and stop; and
- browser adapter bundling without a sibling source checkout.

The closures are dry-run staged artifacts, not public npm releases. Public
registry alias and digest checks are therefore false by design and receive no
score credit. Linux used a receipt-tracked scope preset for the staged
packages; it is not represented as the final public naming surface.

The external arms exposed real productization friction:

- `@snapback/client/online` has no TypeScript declaration;
- installed lifecycle and public sessions inspection need custom glue;
- `snapback stop` leaves its owner-only secret-read root for outer scoped
  cleanup;
- secure startup-artifact refusal does not identify the failed inode
  predicate;
- Linux preparation needed exact Hermes and lane-local native dependencies;
  and
- Todo/Chat performance receipts hardcoded a Mac profile on a Linux run.

The raw Linux samples remain valid within their windows, but companion machine
receipts replace the contradicted labels and prohibit cross-machine latency
comparison. The product/lifecycle findings are tracked in
`issues/20260729-external-package-lifecycle-gaps.md`; the benchmark-only
metadata defect is tracked separately.

Evidence:

- `reports/final-confirmation/package/`
- `arms/todo/snapback/final-confirmation-handoff/linux-x64/`
- `arms/chat/snapback/final-confirmation-handoff/linux-x64/`
- `arms/linear/snapback/final-confirmation-handoff/`
- `arms/partiful/snapback/final-confirmation-handoff/`
- `arms/research-room/snapback/final-confirmation-handoff/`

## Supabase current-client refresh

The old Research Room lock actually installed `@supabase/supabase-js` 2.57.4,
so the complete arm needed a current 2.111.0 run.

Two evidence attempts precede the valid r3:

1. r1 stopped when builder redaction allowed credential-bearing CLI bytes into
   tool output. The provider did not disclose application data; this was a
   builder evidence Stop. The exact target was destroyed.
2. r2 used an OS-level fail-closed wrapper. The child started successfully, but
   the parser rejected the current pretty output. It emitted no carrier,
   destroyed private streams, and immediately retired the exact target. It
   makes zero scenario or performance claims.

Official CLI v2.110.0 source inspection identified the exact machine and pretty
field sets. A narrow parser correction passed nine adversarial containment
cases. Fresh r3 then completed all 15 scenarios plus two warmups and seven
samples. The wrapper, acceptance runner, and cleanup exposed no credential
value. Cleanup found zero containers, volumes, networks, listeners, carriers,
raw/parser files, or credential matches.

The local stack's database, RLS, Auth, Storage, pgvector, generated text search,
pg_cron, Edge Functions, and private Realtime Broadcast all passed. Hosted
deployment, hosted latency, and hosted cost were not sampled.

Evidence:

- `arms/research-room/supabase/final-refresh-handoff/`
- `arms/research-room/supabase/final-refresh-second-attempt-handoff/`

## Firebase current-major refreshes

Both affected arms moved from Admin 13.5.0 / Functions 6.4.0 to Admin 14.2.0 /
Functions 7.3.2. Their modular application functions required no semantic
migration; the declared Functions engine moved from Node 20 to Node 22.

Chat reproduced all 15 local scenarios, including cold-page persistent-cache
history, realtime messages, RTDB presence/typing, concurrent transactional
sends, revocation, export, and cleanup. Linear reproduced all 14 statuses,
including persistent offline queue/reconnect and conflict settlement. Native
full-text search remains Linear's GAP, and hosted credentials remain
unavailable.

Both first complete refresh runs revealed implicit Eventarc and Tasks
listeners on default ports `9299/9499`. Exact ownership and cleanup were
proved, but the coordinator did not accept those runs as final isolation
evidence. Both complete suites reran with explicit disjoint auxiliary ports.
All final ports, processes, profiles, and runtime state were absent after
cleanup.

The current locks retain substantial npm audit findings with zero critical
findings. No incompatible automatic fix was applied. These are dependency and
operations caveats, not observed Stop-class defects.

Evidence:

- `arms/chat/firebase/final-refresh-prep/`
- `arms/linear/firebase/final-refresh-handoff/`

## Retained providers

The primary-source audit found no acceptance-material current change for the
other competitor arms. Convex remains on the recommended current client/local
backend pair, and its Research Room argv credential is still a provider
Stop-class defect. InstantDB 1.0.53 changes persisted-object GC rejection
logging only. SpacetimeDB remains on the tested 2.7.0-hotfix3 line. Appwrite's
current CLI change affects the untested Cloud login path, not the retained
self-hosted arms.

See `provider-refresh-audit.md` for exact versions and source reasoning.

## Coordinator evidence audit

- All 35 sealed capsules still pass the repository verifier and strict
  Draft-2020 schema.
- All five final Snapback confirmation outcome sets equal their remediated
  frozen results.
- The current Supabase and Firebase refresh result sets contain every frozen
  scenario ID and preserve product GAP/unavailable classifications.
- Every final target has exact cleanup evidence.
- Final handoff JSON parses; handoff secret/path scans pass.
- The Supabase fail-closed suite independently reproduces 9/9.
- No file under `src/`, `packages/`, Cargo manifests, `build.rs`, or product
  scripts differs after the Snapback freeze.
- The package artifacts remain staged and no public-release claim is made.

Limitations remain explicit: most competitor work is local emulator or
free/shared-target evidence; hosted plan behavior, production scale, regional
latency, and real billable load were not normalized. Performance windows are
small frozen workloads, not production benchmarks.
