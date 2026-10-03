# Round 5b timing control setup

Scope: LLP 3000.030 §15 (current), LLP 3000 §3 and §4 (current), and the
explicit timing-only commission. No implementation, cache key, deadline,
assertion, simulator selection policy or publication behavior is changed.
This is unpublished local candidate evidence, not registry qualification.
The author requested report/card/journal updates and a local commit only.

A = e1adc01ddc (round 4); B = adbabda71e (round 5). Work is retained at
`~/sb4-np/nx-r5b/`. Four separate project copies (`r4-plain`, `r4-social`,
`r5-plain`, `r5-social`) have independent native cache/snapshot/DerivedData
paths. Both use the existing identical starter dependency versions and native
artifacts. The committed product delta between A/B changes only the shim,
wrapper, driver custody/publication/recovery, audit pins and witness prose;
there is no client/wasm/Swift delta to rebuild.

The client and Expo tarballs contain the exact previously measured installed
candidate package trees, including `snapback4/src`, with unchanged manifests.
These are deliberately local snapshot packages rather than ordinary release
`npm pack` filtering: dropping those existing files would change the audited
dependency snapshot and conservatively force native rebuilding on every JS edit.
The revision-specific shim/wrapper bytes come from `git show`; all four complete
dependency digests and both Expo plugin trees match their revision's existing
committed pins (`dependency-audit.json`). No audit pin is edited.

Build each production CLI with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`
and `cargo build --profile production -p snapback4`. Package it as
`snapback4-darwin-arm64`. Verify all three tgz packages through an offline npm
installation in a separate consumer and launch that installed shim without
`SNAPBACK4_BIN`. `builds.json` records exact commands and binary/tarball hashes.
The measurement projects install the exact client/Expo tar contents and select
their fixed packaged CLI via `SNAPBACK4_BIN`, preserving the original audited
node_modules tree. This is the same binary override as the historical controls.

Prime every project at its final absolute path, then confirm a JS-edit warm
cache hit for each before measurement. Preparation failures and retries are
separately named, never cohort samples. `context.json` preserves setup mistakes.
Use only the new `sb4-nx-r5b-` simulator prefix. Do not target
`mini-verify-iphone` for any operation. Delete only this run's recorded device
under its state/home leases after measurements.

Planned measured sequence: A B B A for each starter, repeated three times;
plain/social, social/plain, plain/social block ordering. Six samples per
revision per starter. Each sample appends an application-JS comment and runs
pinned Node 24.18.0 `npm run export:ios`. All builds, installs and our suites
finish before this cohort. Record load1/load5/load15 plus the top 20 CPU
processes immediately before each command and again afterward. If load1 > 6,
wait and retain snapshots; if a quiet window is unavailable, explicitly label
contended samples and do not infer quiet-host qualification from them.

Measure the entire npm command with a monotonic clock. Native time is the
receipt's `durationMs`; outside time is whole-command minus that duration,
including Hermes export, shim/wrapper/publisher and evidence cleanup. Preserve
native invocation/lifecycle/segment timestamps and publication `verifiedAt`.
Native smoke must exit zero, hit cache, pass all three segments, load the exact
export and match publication/proof hashes. No skipped proof counts as success.
Raw receipts, logs/media and installable tgz bytes go to the existing
content-addressed archive, read back and SHA-256 checked; the report's archive
index names every stored item. Only small summaries/logs go in git.

The first load1 <= 6 cohort was interrupted by a separate checkout's builds and
tests, including a roughly nineteen-minute wait. Its complete 24-run sequence
is retained as the initial cohort, including every boundary-load crossing.
Before the final cohort, the starting threshold is tightened to load1 <= 4
(`NX_MAX_START_LOAD=4`, `NX_COHORT=quiet-control`). Run a separate full set of
three ABBA blocks per starter: six samples per revision per starter. Quiet
classification still requires load1 <= 6 at both boundaries. This condition is
based on host load, not elapsed time, and no initial result is discarded.
The final cohort is reported separately from the interrupted initial cohort.
