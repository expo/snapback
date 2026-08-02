# LLP 0154 minimal observability review — Codex family

## Round 7 — 2026-08-02 (spot-check of the v0.8 hunks; loop closed after)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0154).
SHA-pinned target and capsule. Codex-only round: the three v0.8 repairs
addressed exclusively this family's round-6 findings (Fable was READY in
rounds 5 and 6).
**Instruction capsule SHA-256:** `db08c43f5421d55efc1de4a7130f6f64cee9449505fbad2b4a5a54d3c43c2adf`
**Target:** `llp/0154-minimal-observability.rfc.md` (1110 lines, Draft, v0.8)
**Target SHA-256:** `896076b0f28831da9638a0b7c42f6ab0cf0708a0d3a7102efb4c4b7e99299fb0`
**Status:** completed
**Verdict:** NOT READY (1 MAJOR — per-row strict clock drifts under load;
1 missed unit-conversion site; 1 MINOR wording scope)

**Coordinator note (loop closure):** the round-7 findings were applied as
v0.9 (per-flush-batch strict issuance bounding drift to ≤1 ms per flush;
the missing day→millisecond conversion at the floor-advance site; the
no-resurrection claim scoped to raw rows). The loop was then closed under
the corpus's asymmetric stopping rule — Fable READY×2 (rounds 5–6),
Codex NOT READY×3 (rounds 5–7) with monotonically shrinking,
fix-of-the-fix findings — matching the LLP 0150 precedent. The v0.9
repairs follow Codex's own prescribed resolutions but are themselves
unreviewed. The author decides the status transition.

### Verbatim review (round 7)

1. **Per-repair verdict**

- **Strict observation clock — UNSOUND.** The rule closes post-re-enable invisibility, but incrementing a millisecond timestamp per row drives `recorded_ts_ms` ahead of wall time above 1,000 persisted rows/second, distorting the retention and hourly-bucketing semantics it governs (`llp/0154-minimal-observability.rfc.md:523`, `llp/0154-minimal-observability.rfc.md:527`, `llp/0154-minimal-observability.rfc.md:534`).
- **`max_days = 0` semantics — SOUND.** D4 explicitly hides both views while preserving aggregates for re-enable, and D7 consistently scopes “raw rows only” to enabled operation (`llp/0154-minimal-observability.rfc.md:668`, `llp/0154-minimal-observability.rfc.md:859`, `llp/0154-minimal-observability.rfc.md:862`).
- **Day-to-millisecond conversion — UNSOUND.** The two principal boundary formulas now multiply by `86_400_000`, but the normative floor-advance instruction still subtracts bare `max_days` from the millisecond clock (`llp/0154-minimal-observability.rfc.md:665`, `llp/0154-minimal-observability.rfc.md:680`).

2. **New defects**

- **MAJOR:** Strict scalar-millisecond issuance creates load-dependent clock drift, potentially placing events in future query ranges and buckets and shortening real-time retention (`llp/0154-minimal-observability.rfc.md:523`, `llp/0154-minimal-observability.rfc.md:527`).
- **MINOR:** Saying aggregate rows reappear after re-enable conflicts with the later unqualified claim that disable/re-enable can never resurrect “rows that were ever hidden”; the latter needs explicit raw-row scope (`llp/0154-minimal-observability.rfc.md:668`, `llp/0154-minimal-observability.rfc.md:686`).

3. **Overall**

The off-switch repair resolves its round-6 contradiction, but the strict-clock repair introduces a material physical-time drift defect and the unit repair remains incomplete in the floor-update protocol; the aggregate no-resurrection wording is additionally inconsistent but minor. Verdict: NOT READY

## Round 6 — 2026-08-02 (spot-check of the v0.7 hunks)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0154).
SHA-pinned target and capsule. Narrowest round: the six v0.7 repairs
only.
**Instruction capsule SHA-256:** `1608ebb92e5c0455ff5dbbcd9fba67a9517a6143bfaa02e9a5b0d625443183bc`
**Target:** `llp/0154-minimal-observability.rfc.md` (1079 lines, Draft, v0.7)
**Target SHA-256:** `0867e971ab6c5caaf250a400988d5140387d332688c76d212db2fb0865886fa7`
**Status:** completed
**Verdict:** NOT READY (5 of 6 repairs sound; 1 BLOCKING edge in the
strict-boundary repair, plus the plural-views contradiction and a
day-to-millisecond dimension bug — all one-line fixes)

### Verbatim review (round 6)

*(Coordinator note: citations were emitted as absolute-path links and are
preserved verbatim.)*

## 1. Per-repair verdict

1. **AUTOINCREMENT id — SOUND:** `telemetry_events.id` now uses `INTEGER PRIMARY KEY AUTOINCREMENT`, preventing committed IDs from falling below the durable rollup watermark after reclamation ([llp/0154:472–475](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:472), [line 810](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:810)).
2. **Strict/disabled boundary and unified formula — UNSOUND:** Although D2 and D4 now use the same strict predicate, the merely nondecreasing observation clock can stamp post-re-enable rows exactly at the disable floor during clock rollback, leaving those new rows invisible ([llp/0154:509–513](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:509), [line 643](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:643), [line 655](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:655)).
3. **`telemetry_meta` sketch — SOUND:** The sketch now includes `observation_clock_ms`, `aggregate_floor_hourly`, and `aggregate_floor_daily` alongside the retention and watermark state ([llp/0154:796–801](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:796)).
4. **D1 rollup-view scoping — SOUND:** D1 now scopes raw rows to the retention boundary and aggregates to tier horizons, with the requested subject-free C5 rationale ([llp/0154:389–395](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:389)).
5. **Whole-interval budget eviction — SOUND:** D7 evicts complete hour/day coverage intervals, advances durable per-tier floors, and marks overlapping queries not fully covered ([llp/0154:820–832](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:820)).
6. **Unconditional prefix registration — SOUND:** Deliverable 1 now requires both LLP 0148 registry rows unconditionally, matching D2’s normative requirement ([llp/0154:967–969](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:967), [line 440](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:440)).

## 2. New defects

- **BLOCKING — post-enable invisibility under clock rollback:** After disable sets `retention_floor = observation_clock`, re-enabling while wall time remains behind that clock produces `recorded_ts_ms == retention_floor`; the new strict predicate hides every such newly persisted row until the wall clock surpasses the floor ([llp/0154:509–513](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:509), [line 643](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:643), [line 655](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:655)).

- **MAJOR — raw/rollup visibility contradiction:** D1 and D7 say `max_days` governs raw rows only and rollups remain governed by tier horizons, but D4 says `max_days = 0` makes “the views” empty, leaving `telemetry_rollup_visible` behavior contradictory ([llp/0154:389–395](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:389), [line 641](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:641), [line 830](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:830)).

- **MAJOR — dimensionally incomplete boundary formula:** The asserted single formula subtracts `max_days` directly from a millisecond clock without specifying conversion to milliseconds, so its normative reading yields the wrong retention boundary ([llp/0154:497–500](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:497), [line 643](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:643)).

## 3. Overall

Five repairs are locally sound, but the strict-boundary repair creates a loss-of-visibility case under the RFC’s explicitly supported clock-rollback scenario, while the rollup-disable semantics remain contradictory and the unified formula lacks its required day-to-millisecond conversion. Verdict: NOT READY

## Round 5 — 2026-08-02 (spot-check of the v0.6 hunks)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (instructed not to read `llp/reviews/` for 0154).
SHA-pinned target and capsule. Narrowest round: spot-check of the v0.6
repairs only.
**Instruction capsule SHA-256:** `baae989f0ec8f9e3d9d5db6b9668807c824ca4a30b2e1831dca6d57cf6f036c8`
**Target:** `llp/0154-minimal-observability.rfc.md` (1037 lines, Draft, v0.6)
**Target SHA-256:** `54191faeead9104dd92e9aec46fffccee9135119de5bd5501b9aa379c361ca4f`
**Status:** completed
**Verdict:** NOT READY (2 BLOCKING mechanism catches — rowid reuse vs the
durable watermark, and the inclusive boundary at `max_days = 0` — plus
consistency residue shared with the other family's round-5 findings)

### Verbatim review (round 5)

*(Coordinator note: citations were emitted as absolute-path links and are
preserved verbatim.)*

## 1. Per-repair verdict

- **Observation clock — UNSOUND.** D2 defines the persisted high-water correctly, but the normative `telemetry_meta` shape omits any observation-clock field, leaving the repair inconsistent with its storage definition ([0154:482](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:482), [0154:764](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:764)).

- **Durable boundary protocol — UNSOUND.** D4 states the intended formula, but the visibility view still says `max(now − max_days, retention_floor)` and uses inclusive `>=`, so under rollback an `N→0` transition can leave rows exactly at the observation-clock high-water visible ([0154:470](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:470), [0154:617](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:617), [0154:623](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:623)).

- **Exact coverage partition and phase set — UNSOUND.** The partition relies on all new rows having `id > rollup_watermark_id`, but `telemetry_events.id` is only `INTEGER PRIMARY KEY` without a non-reusing allocator, so retention can empty the table and allow new IDs below the durable watermark ([0154:451](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:451), [0154:668](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:668), [0154:776](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:776)).

- **D7 tier coverage, horizon, eviction, and exactness — UNSOUND.** D7 says `max_days` governs raw rows only, contradicting D1’s requirement that `telemetry_rollup_visible` use the same retention boundary, while row-level budget eviction lacks a per-window completeness rule ([0154:373](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:373), [0154:468](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:468), [0154:786](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:786), [0154:794](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:794)).

- **LLP 0148 wording and registration — UNSOUND.** D2 and the v0.5 history now correctly recognize Accepted LLP 0148 and require unconditional registration, but deliverable 1 still conditions registration on “when the trees merge” ([0148:4](/Users/ccheever/projects/snapback/llp/0148-prefixed-identifiers.decision.md:4), [0154:81](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:81), [0154:418](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:418), [0154:926](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:926)).

- **Cloudflare `generation` provenance — SOUND.** D8 now derives generation from the control plane’s trusted target descriptor, specifies reset/redeploy rotation, and rejects caller-supplied identity ([0154:850](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:850), [0154:857](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:857)).

- **Expanded boundary-protocol fixtures — SOUND.** Deliverable 2 explicitly covers `7→1→7`, `N→0→N`, rollback across the floor and hour finalization, hatch/server parity, and mid-hour exact partitioning across restart ([0154:928](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:928), [0154:936](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:936)).

## 2. New defects

- **BLOCKING:** `max_days = 0` is not an empty visibility boundary because rows equal to the observation clock satisfy the view’s inclusive `>=` predicate.

- **BLOCKING:** The durable ID watermark is incompatible with a reusable SQLite `INTEGER PRIMARY KEY`; after complete raw-row reclamation, new rows can fall at or below the old watermark and disappear from both sides of the stats union.

- **MAJOR:** The observation-clock high-water is absent from the listed `telemetry_meta` schema, and the visibility-view snippet still names `now`, leaving two competing clock definitions.

- **MAJOR:** D1 makes aggregate visibility obey the raw retention boundary while D7 gives aggregates independent 90/730-day horizons.

- **MAJOR:** Budget eviction is specified per tier row rather than per complete coverage interval, without durable incomplete-bucket metadata sufficient to support the exactness claim.

- **MINOR:** Deliverable 1 retains the obsolete “when the trees merge” condition for LLP 0148 registration.

## 3. Overall

The Cloudflare provenance and fixture-list repairs are sound, and the phase filter itself is now explicit, but the v0.6 boundary remains incorrect at `max_days = 0`, while reusable event IDs invalidate the claimed exact watermark partition after full raw reclamation; the clock-schema and tier-retention contradictions add material implementation ambiguity. These exceed the READY threshold. Verdict: NOT READY

## Round 4 — 2026-08-02 (focused delta check of v0.5)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request)
**Method:** fresh non-author `codex exec` context, read-only sandbox,
mutually blind (states it read no LLP 0154 review artifact). SHA-pinned
target and capsule. Focused delta check of the v0.5 repairs.
**Instruction capsule SHA-256:** `75e708f3ed5af9318cd75549b2d369c47e9d37eeda446392360dd45752ab1663`
**Target:** `llp/0154-minimal-observability.rfc.md` (975 lines, Draft, v0.5)
**Target SHA-256:** `ac9237603cdf8bec1d5ed19431bf01f0583988a786b43a689a8d4673c14ed945`
**Repo revision at review start:** shared worktree advanced concurrently
(HEAD `cbbb58ec` at coordination time; the loop began at `4f7890eb`)
**Status:** completed
**Verdict:** NOT READY (2 BLOCKING in the v0.5 retention/rollup algebra,
2 MATERIAL, 1 MINOR)

### Verbatim review (round 4)

*(Coordinator note: citations were emitted as absolute-path links and are
preserved verbatim.)*

## 1. Overall assessment

I verified the 975-line target matches SHA-256 `ac9237603cdf8bec1d5ed19431bf01f0583988a786b43a689a8d4673c14ed945`, read it fully, and checked the relevant repository substrate without reading any LLP 0154 review artifact. Most identity, phase, privacy, export, authorization, and hosted-gateway repairs are sound. However, v0.5 introduces two blocking defects in its retention and rollup algebra, plus material timestamp/tiering defects. Phase 1 remains unimplemented, so runtime behavior and the dated external landscape claims were not verifiable; this is an RFC-and-substrate assessment. Verdict: NOT READY

## 2. Delta verification

- **Dual timestamps — PARTIAL.** Keeping `ts_ms` admission-bound correctly matches LLP 0104’s attribution rule ([llp/0104:67](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:67)). Using `recorded_ts_ms` makes late terminal observations visible and gives deterministic `(recorded_ts_ms,id)` ordering ([llp/0154:459](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:459)). It is not sufficient for append-ordered rollups under wall-clock rollback; see concern 3.

- **`phase` and per-class row rules — SOUND.** Explicit `point | admission | terminal | joined` rows, one joined row for short operations, paired rows for long-lived operations, and exclusion of admissions from `stats` give an unambiguous counting rule ([llp/0154:469](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:469)).

- **Identity and billable-instance rule — SOUND at RFC level.** Separating the correlation root from per-metric `eventId`s aligns with LLP 0104’s separate `eventId`, `schemaVersion`, metric, and quantity fields ([llp/0104:64](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:64)). The carrier/logical and scheduler/invoked-operation rules also match the accepted-logical-operation basis ([llp/0104:181](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:181), [llp/0154:419](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:419)). OQ1 appropriately remains a hard pre-implementation ratification gate.

- **`telemetry_meta` as shared authority — PARTIAL.** Mirroring generation and configuration into the telemetry database is a coherent way to make in-process and direct-file readers agree ([llp/0154:351](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:351)). The claimed irreversible retention floor is not maintained on all boundary advances; see concern 2.

- **Visibility views and SQL authorizer — PARTIAL.** Denying base tables while permitting reads attributed to the two views is implementable, and the dependency claim is correct: Snapback omits `hooks` directly while vendored Ibex enables it ([Cargo.toml:33](/Users/ccheever/projects/snapback/Cargo.toml:33), [vendor/ibex/Cargo.toml:59](/Users/ccheever/projects/snapback/vendor/ibex/Cargo.toml:59)). The existing Ibex policy is indeed only an allow-by-default precedent ([abi.rs:3075](/Users/ccheever/projects/snapback/vendor/ibex/src/host/abi.rs:3075)). The rollup view still lacks sound partial-boundary semantics; see concern 4.

- **`telemetry.stats` consistent SQLite authority — NOT SOUND.** Making SQLite rather than memory authoritative is correct, but the stated union omits rows already rolled into an open hourly bucket; see concern 1.

- **`telemetry.export` typed operation — SOUND.** It uses the same filters, visibility boundary, raw-read authority, and snapshot-bounded composition rather than creating a side channel ([llp/0154:639](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:639), [llp/0154:851](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:851)).

- **Tiered rollups and per-field exactness — PARTIAL.** Mergeable counters/histograms and heavy-hitter disclosure are sound. Open-bucket coverage, partial-window exactness, aggregate retention, and the daily-tier bound are incomplete; see concerns 1 and 4.

- **Cloudflare classification-only projection and operation gateway — SOUND.** The payload excludes free text and raw details, reports raw detail as unsupported, derives target identity from trusted descriptors, and separates caller authorization from provider-credential custody ([llp/0154:786](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:786)). That matches LLP 0072’s ownership of hosted metrics, credentials, narrow inspection grants, and target descriptors ([llp/0072:162](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:162), [llp/0072:190](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:190), [llp/0072:271](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:271)).

- **Subject/IP posture — SOUND.** Phase 1 makes `subject` invariantly NULL, removes IP capture entirely, and keeps raw details behind `AdminSecretRead` ([llp/0154:263](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:263), [llp/0154:523](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:523)). This matches LLP 0031’s raw-sensitive-data boundary ([llp/0031:183](/Users/ccheever/projects/snapback/llp/0031-server-route-taxonomy.spec.md:183)).

- **`obs_`/`gen_` grammar — PARTIAL.** The grammar matches LLP 0148 ([llp/0148:102](/Users/ccheever/projects/snapback/llp/0148-prefixed-identifiers.decision.md:102)), but the document’s “not in this checkout” and “when the trees merge” condition is now stale; see concern 5.

- **Expanded fixtures and OQ1 — PARTIAL.** The new identity, deduplication, reset-race, retention, raw-tail, late-completion, and export cases are valuable ([llp/0154:871](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:871)). They need the additional cases below before they prove the repaired design.

## 3. Concerns

1. **BLOCKING — `telemetry.stats` does not partition rolled and raw data.** Maintenance folds every row above the watermark into an hourly aggregate and advances the watermark ([llp/0154:575](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:575)). The current hour remains “open” after that operation ([llp/0154:730](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:730)), while `stats` reads only finalized rollups plus raw rows above the watermark ([llp/0154:632](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:632)). Rows rolled into the open hour are therefore neither finalized-rollup input nor raw-tail input.
   **Resolution:** Define an exact coverage partition. With open buckets behind the watermark, `stats` must include their rolled contributions through the watermark and raw rows strictly above it, with coverage metadata preventing overlap. Add a fixture that runs maintenance mid-hour and proves every row is counted exactly once before and after restart.

2. **BLOCKING — the monotonic floor does not make the live read boundary irreversible.** The floor advances only during a sweep ([llp/0154:577](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:577)), but the visibility boundary continuously uses live `now − max_days` and claims that config changes, disable/enable, and clock rollback cannot resurrect anything ([llp/0154:586](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:586)). Lowering then raising `max_days` before the next sweep resurrects rows; a clock rollback can resurrect rows hidden since the previous sweep; and `max_days = 0` short-circuits persistence, so it cannot rely on a later flush to advance the floor ([llp/0154:565](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:565)).
   **Resolution:** Choose a durable boundary protocol compatible with the read-only hatch—for example, a persisted observation-clock high-water plus `visible_after_ms`, advanced atomically on flush, boot, and every configuration transition. Alternatively weaken the contract to opportunistic retention rather than “ever hidden.” Add 7→1→7, N→0→N, no-sweep, hatch-parity, and clock-rollback fixtures.

3. **MATERIAL — `recorded_ts_ms` is not specified as monotonic, so it does not guarantee append-ordered rollups.** v0.5 says a persistence timestamp makes the stream strictly append-ordered ([llp/0154:459](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:459), [llp/0154:730](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:730)). A wall-clock rollback allows a newly inserted, higher-id row to land in an earlier, already-finalized hour. It can also sort before an issued event cursor and move the reported freshness timestamp backward.
   **Resolution:** Define `recorded_ts_ms` from a durable nondecreasing observation clock, or define late-bucket reopening/upsert semantics. Test rollback across an hour-finalization boundary, event pagination, and freshness reporting—not only rollback “against the floor.”

4. **MATERIAL — tier coverage, exactness, and bounded retention are underspecified.** The variance envelope promises exact window totals ([llp/0154:652](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:652)), while D7 says any window is a sum of hourly/daily rows ([llp/0154:747](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:747)). A query or retention boundary cutting through an hourly or daily bucket cannot obtain exact totals from that aggregate alone. Separately, the daily tier has no named horizon or eviction rule: “days × names beyond” is not itself bounded ([llp/0154:742](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:742)).
   **Resolution:** Give every aggregate row an explicit coverage interval; use raw visible rows for partial boundary buckets or require aligned windows and report the actual covered window. Define whether `max_days` governs raw rows, aggregates, or both, and specify the daily horizon/budget-eviction behavior. Adjust exactness labels accordingly.

5. **MINOR — the LLP 0148 merge condition is obsolete.** LLP 0154 still says LLP 0148 is absent and registration waits for a tree merge ([llp/0154:400](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:400)), but LLP 0148 is present, Accepted, and requires every new identifier kind to be a registry row ([llp/0148:193](/Users/ccheever/projects/snapback/llp/0148-prefixed-identifiers.decision.md:193)). The current generated registry contains neither prefix ([schemas/id-registry.v1.json:5](/Users/ccheever/projects/snapback/schemas/id-registry.v1.json:5)).
   **Resolution:** Remove the ancestry/merge qualification and state directly that Phase 1 adds `Observation`/`Generation` registry rows with their chosen body-randomness property.

## 4. Open questions

None. My position remains NOT READY.

## 5. Recommended next step

Revise to v0.6 with an explicit rollup coverage partition, a durable no-resurrection boundary protocol, monotonic observation-time semantics, and fully specified tier/window retention. Extend deliverable 2 with the exact fixtures named above, update the LLP 0148 wording, then run another focused delta review before the author considers moving the RFC to Review. `./ref-check --verbose` currently reports 0 errors. I could not record this review under `llp/reviews/` because the sandbox is read-only.

## Round 3 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request for a Codex design-partner review)
**Method:** fresh non-author `codex exec` context, read-only sandbox over
the working tree; mutually blind — instructed not to read any
`llp/reviews/` artifact concerning LLP 0154; the review states "did not
consult LLP 0154 review contents." SHA-pinned target and instruction
capsule. Focused re-review of the v0.4 round-2 repairs.
**Instruction capsule SHA-256:** `8dfed19adfe4ca0e6168a7c2529cb3d2f97a0b543fa67045e5ad0eee77828d99`
**Target:** `llp/0154-minimal-observability.rfc.md` (827 lines, Draft, v0.4)
**Target SHA-256:** `564dbdd9786d79733c842403a97cb29f44618493ebb42e37ff0dbf7ff6f55036`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

### Verbatim review (round 3)

*(Editorial note by the review coordinator: the reviewer's file citations
were emitted as absolute-path markdown links; they are preserved verbatim
below.)*

## 1. Overall assessment

v0.4 is a substantial improvement: the two-stage span, reset-incarnation binding, sensitivity split, typed-operation direction, idle-settle rule, and corrected authorizer description are well grounded in the repository. I verified the supplied SHA-256 and 827-line count, read the target fully, and did not consult LLP 0154 review contents. However, the metering identity still permits collisions, retention is reversible, rollups can omit flushed rows and grow without bound, and the Cloudflare authorization contract remains incomplete. I could not verify the external landscape claims or proposed performance numbers; no telemetry implementation exists yet to test, and LLP 0148 is absent from this checkout. Verdict: NOT READY

## 2. Strengths

- C4/D2 now correctly recognizes that billing attribution happens at admission while outcome and duration arrive later. That matches LLP 0104’s admission-bound `occurredAt` contract ([0154:228](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:228), [0104:64](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:64)).

- D1 is anchored to a real durable authority. The authorization incarnation rotates inside the destructive reset transaction, and the server keeps successor publication fenced afterward ([0154:305](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:305), [storage.rs:930](/Users/ccheever/projects/snapback/src/storage.rs:930), [server.rs:17335](/Users/ccheever/projects/snapback/src/server.rs:17335)). Filtering old in-flight batches rather than trying to race them is the right model.

- C5/D5’s aggregate-versus-raw split matches the existing route taxonomy: closed operator metadata may use ordinary admin authority, while raw application-derived material requires scoped secret-read authority ([0154:548](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:548), [0031:199](/Users/ccheever/projects/snapback/llp/0031-server-route-taxonomy.spec.md:199)). The implementation already has finite TTL, row, and byte budgets suitable for new telemetry scopes ([admin_secret_read.rs:30](/Users/ccheever/projects/snapback/src/admin_secret_read.rs:30)).

- The corrected rusqlite statement is verified: Snapback does not declare `hooks`, Ibex does, and Ibex’s existing authorizer is indeed allow-default except for attach/detach/extension loading ([Cargo.toml:33](/Users/ccheever/projects/snapback/Cargo.toml:33), [vendor/ibex/Cargo.toml:59](/Users/ccheever/projects/snapback/vendor/ibex/Cargo.toml:59), [abi.rs:3075](/Users/ccheever/projects/snapback/vendor/ibex/src/host/abi.rs:3075)). A new deny-by-default policy is accurately described.

- C2 and deliverable 5 now preserve the actual measured invariant by separating bounded provisioning settlement from the idle window ([0154:212](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:212), [0035:279](/Users/ccheever/projects/snapback/llp/0035-local-target-benchmarks.research.md:279)).

- The `log`, `_unmatched`, lifecycle allowlist, diagnostic-emission boundary, and field scrubbing make Phase 1 much more implementable ([0154:401](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:401)). `runtime.log` is a real existing host-call seam ([runtime.rs:1895](/Users/ccheever/projects/snapback/src/runtime.rs:1895)).

## 3. Concerns

1. **MATERIAL — An observation ID cannot also be the universal bill-event idempotency key.**

   Evidence: D2 calls the observation ID “the idempotency key for bill-grade sinks” ([0154:341](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:341)). LLP 0104 instead defines each usage event as an `eventId` plus one metric and integer quantity ([0104:64](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:64)); one logical operation can produce request, CPU, transfer, and shadow-meter facts. Reusing one ID would either collapse distinct meter events or require a new multi-metric event shape contrary to LLP 0104. The skeleton also makes `job run` admission billable and gives transport requests a fallback billable case ([0154:357](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:357)), while LLP 0104 bills accepted logical operations and does not independently enumerate scheduler runs ([0104:187](/Users/ccheever/projects/snapback/llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:187)). That risks job/action or carrier/logical-call double counting.

   Resolution: make `observation_id` the correlation root. Derive a distinct deterministic metering `eventId` from `(observation_id, metric_id, stage/sequence, schema_version)`. Replace “exactly one record per class is billable” with an operation-instance rule, and explicitly classify scheduler admission versus the invoked action.

2. **MATERIAL — The read-time retention boundary is reversible and incomplete for rollups.**

   Evidence: the view is defined as `ts_ms >= now − max_days` ([0154:389](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:389)), while sweeps are only opportunistic reclamation ([0154:501](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:501)). Raising `max_days`, toggling from `0` back to a positive value, or moving the clock backward can therefore reveal unswept rows that were previously hidden. The proposed metadata has no durable retention floor ([0154:612](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:612)). Moreover, D1 says every read uses `telemetry_events_visible`, but stats and the SQL hatch also read rollup views whose current-generation and retention semantics are not defined ([0154:538](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:538), [0154:568](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:568)).

   Resolution: persist a nondecreasing raw-retention floor or immutable per-event expiry policy, define whether policy increases may affect existing rows, and handle clock rollback explicitly. Define separate current-generation raw and rollup visibility views; deny every base table in the SQL hatch.

3. **MATERIAL — `telemetry.stats` can omit flushed-but-unrolled rows.**

   Evidence: a flush moves batches into SQLite ([0154:472](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:472)), while rollup maintenance runs only after the configured threshold or hour transition ([0154:485](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:485)). Stats nevertheless merges rollups with an “in-memory unrolled tail” ([0154:542](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:542)). Once a batch is flushed, its authoritative unrolled rows are in SQLite, not necessarily memory; an unspecified cache also fails across restart and before boot maintenance completes.

   Resolution: query `rollup rows ≤ watermark` plus visible raw rows `> watermark` in one consistent read. An in-memory cache may accelerate that union but must never be its authority.

4. **MATERIAL — The top-N rollup cannot simultaneously be incremental, indefinitely retained, bounded, and exact as written.**

   Evidence: rollup rows are kept indefinitely, with up to 200 names per kind per hour ([0154:631](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:631)), yet C8 requires hard file-size and total rollup-row budgets ([0154:267](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:267)). This still grows linearly forever. There is also an exactness problem: rows use admission time but joined rows arrive at terminal completion ([0154:339](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:339)); a late completion can change an already-folded hour’s top N, but its earlier contribution cannot be extracted from `_other`. The variance envelope currently says counts are exact without qualifying these breakdowns ([0154:556](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:556)).

   Resolution: define bounded rollup retention/downsampling and a total row budget. Either retain complete per-name state until a declared lateness/finalization boundary or use a bounded heavy-hitter algorithm and label per-name results approximate. Keep only total counts exact where that is actually guaranteed.

5. **MATERIAL — The Cloudflare repair fixes credential location, not the complete authorization contract.**

   Evidence: D8 correctly puts the account-scoped Analytics Engine credential in the control plane, but does not define how a caller’s admin authority is mapped to an immutable app/environment target, how the current reset generation is selected, or how raw-read budgets and audit apply ([0154:664](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:664)). Those obligations matter because raw events require `AdminSecretRead` ([0154:548](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:548)). LLP 0072 supplies credential-custody principles but explicitly does not define a hosted multi-tenant service ([0072:172](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:172), [0072:950](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:950)). Separately, D5’s operation list omits `telemetry.export`, despite presenting export as a cross-surface CLI capability ([0154:536](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:536), [0154:710](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:710)).

   Resolution: specify a Phase-2 control-plane authorization envelope with host-resolved deployment/environment identity, current stream incarnation, raw-read authority, row/byte budgets, audit, and `no-store`. Define export either as a typed streaming operation or explicitly as a snapshot-bounded composition over `telemetry.events`.

6. **MINOR — “Subject-free” is directionally right but internally imprecise.**

   Evidence: the RFC says Phase 1 persists no user identity ([0154:84](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:84)) while permitting optional IP persistence ([0154:445](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:445)). The shown schema contains no subject column, yet the text says its column position is reserved ([0154:374](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:374), [0154:396](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:396)).

   Resolution: say “no stable application subject identifier” and either remove Phase-1 IP capture or identify it as a separately opted-in address datum. Remove the nonexistent reserved-column claim or show the actual nullable column and invariant.

7. **MINOR — The identifier dependency is unavailable.**

   Evidence: D1/D2 rely on LLP 0148 for `gen_` and `obs_` identifiers ([0154:305](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:305), [0154:341](/Users/ccheever/projects/snapback/llp/0154-minimal-observability.rfc.md:341)), but this checkout contains no `llp/0148-*`; the root LLP says 0148 remains reserved on a parallel ref ([0000:9](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:9)). I therefore could not check the grammar.

   Resolution: land LLP 0148 before this dependency is normative, or define the required prefixes and entropy/uniqueness rules locally in LLP 0154.

## 4. Design proposals

- **Strong — Split correlation identity from projection-event identity.** Keep one stable observation ID across admission and terminal stages, then deterministically derive one ID per metering/log/telemetry projection event. This makes retries idempotent without conflating multiple metrics.

- **Strong — Make visibility durable state.** Add a singleton current-generation binding plus a nondecreasing raw-retention floor, and define current-generation raw and aggregate views separately. Raw-tail queries, export, and the SQL hatch should all consume those views.

- **Strong — Use persisted open buckets and bounded historical tiers.** Query raw rows above the watermark; maintain explicitly open hourly buckets; compact closed history into bounded daily/monthly tiers; state exactness independently for totals, names, and percentiles.

- **Moderate — Make the hosted projection a real operation gateway.** The control plane should resolve the deployment and generation from trusted descriptors, authorize the caller independently of its provider credential, and expose `events`, `stats`, and export through the same schemas and capability outcomes.

## 5. Open questions

- **OQ1:** Correctly identified as a hard gate, but it must resolve concern 1 before Review. The shared fixture should prove derived event IDs, accepted logical-operation classification, no job/action or carrier/logical double count, admission attribution, terminal metrics, retry/deduplication, and registry-version behavior.

- **OQ2:** Keep this entirely in Phase 3. Default don’t-link is right, and mutation-scoped events should release only on commit. Distinct-user metrics should not ship until deletion semantics choose either retractable per-subject contribution state or an explicit, honest non-retractability contract.

- **OQ3:** Safety limits should be settled independently of pricing. Phase 1 needs concrete bounds for raw days, total main/WAL/SHM bytes, rollup rows/history, query work, and behavior at capacity. Hosted defaults can be chosen at Phase-2 landing; commercial entitlements may only narrow within the safety envelope.

- **OQ4:** Cap Cloudflare history at the Analytics Engine window for v1. The variance envelope makes honest partial parity acceptable; Durable Object rollups add enough state and failure surface that they should require measured demand. Current-generation filtering and authorization still need to be defined even with the capped option.

## 6. Recommended next step

Revise to v0.5 while remaining Draft, resolving concerns 1–5 and folding concerns 6–7 into the cleanup. Add normative fixtures for multi-metric event IDs, reset/in-flight generation races, retention-policy changes and clock rollback, raw-tail queries across restart, late completion/top-N behavior, total-cap exhaustion, and snapshot-bounded export. Then run one focused round-4 re-review before moving to Review. The sandbox was read-only, so I could not create the LLP 0005 review artifact under `llp/reviews/`.

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request for a Codex design-partner review)
**Method:** fresh non-author `codex exec` context, read-only sandbox over
the working tree; mutually blind — instructed not to read any
`llp/reviews/` artifact concerning LLP 0154; the review states "I did not
inspect any LLP 0154 review artifact." SHA-pinned target and instruction
capsule. Design-partner framing per author directive.
**Instruction capsule SHA-256:** `cfbd3eea5fba77befaac97e07455aba915b8f14c25cef6a7f5fa1ec74aca799e`
**Target:** `llp/0154-minimal-observability.rfc.md` (648 lines, Draft, v0.3)
**Target SHA-256:** `2578344420fd8a13b4dcb395667e27da8a0b0a49adbad3d2205acf1206f23f72`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

### Verbatim review (round 2)

1. **Overall assessment**

v0.3 is a substantial improvement: removing network SQL, separating loss-tolerant telemetry from bill-grade metering, moving maintenance off cron, deferring identity-dependent analytics, and making hosted variance explicit are all sound moves. The local substrate and MCP corrections largely verify against the repository. However, the central “one envelope, three projections” contract remains temporally and taxonomically incomplete; sensitive-read/deletion rules are not closed; generation fencing conflicts with the SQL hatch; and rollup correctness is underspecified. These are architectural issues, not editorial cleanup, so the RFC is not yet a sound basis to enter Review. Verdict: NOT READY

2. **Strengths**

- The three-phase cut is disciplined. Phase 1 focuses on operational observability, Phase 2 isolates hosted-arm variance, and Phase 3 correctly defers typed product analytics and identity policy (`llp/0154-minimal-observability.rfc.md:56`, `llp/0154-minimal-observability.rfc.md:506`).

- The sibling-database decision fits the local storage substrate. App storage has one owned connection and a separate WAL reader pool (`src/storage.rs:802`), while telemetry is explicitly kept off that writer, journal, matcher, backup, and logical-byte paths (`llp/0154-minimal-observability.rfc.md:223`).

- Replacing cron maintenance is well founded. Cron state is persisted in `_snapback_meta` (`src/storage.rs:2676`, `src/storage.rs:2700`), and LLP 0028 defines durable scheduler/run-ledger state rather than generic internal maintenance (`llp/0028-cron-scheduled-execution.rfc.md:287`). Event-armed flush maintenance therefore preserves the intended separation better (`llp/0154-minimal-observability.rfc.md:369`).

- The network SQL endpoint should remain deleted. The local-only direction is consistent with LLP 0017’s explicit-local-escape-hatch posture (`llp/0017-admin-console-inspection-surface.rfc.md:84`) and avoids making arbitrary SQL a cross-arm contract (`llp/0154-minimal-observability.rfc.md:426`).

- The MCP correction is accurate. `src/guide_mcp.rs` advertises resources rather than tools (`src/guide_mcp.rs:178`, `src/guide_mcp.rs:312`), while the control MCP calls the host-ops surface (`packages/snapback-cli/mcp-control.mjs:444`) in accordance with LLP 0024’s one-core/thin-projections rule (`llp/0024-agent-operating-surface.spec.md:103`).

- Reclassifying telemetry as sensitive identity-derived application data is correct. Diagnostics can contain source paths, handler text, and arguments (`src/diagnostic.rs:31`), and LLP 0031 explicitly includes subjects, handler errors, source, arguments, and correlation data in `SensitiveApplicationData` (`llp/0031-server-route-taxonomy.spec.md:181`).

- Fixed-bucket histograms are the right correction to scalar percentiles, and deferring distinct-user metrics until identity semantics exist is sound (`llp/0154-minimal-observability.rfc.md:466`).

- The guide deliverable catches a real corpus gap: the capability index promises explicit GAP rows for uncovered capabilities (`guide/capabilities.md:20`), while the RFC correctly notes that observability currently has none (`llp/0154-minimal-observability.rfc.md:578`).

3. **Concerns**

1. **BLOCKING — The shared observation envelope is not yet a valid metering projection.**

   **Evidence:** D2 describes one envelope with an admission timestamp and terminal outcome (`llp/0154-minimal-observability.rfc.md:263`). LLP 0104, however, requires an idempotent `eventId`, schema version, both occurrence and observation times, ownership interval, durable environment identity, metric, quantity, receipt/cursor, and correction linkage (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:62`). It also binds attribution and budget reservation at admission (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:67`), before terminal status and duration exist. Moreover, D2 promises a “versioned operation-class table below,” but the table only lists telemetry kinds/seams (`llp/0154-minimal-observability.rfc.md:300`); the persisted schema has no classification version or application/system disposition (`llp/0154-minimal-observability.rfc.md:282`). LLP 0104’s actual versioned classification distinguishes logical calls, batches, live subscriptions, frames, and control operations (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:181`). Emitting both `http_request` and `function_run` also creates a double-counting risk unless a projection map selects exactly one billable observation.

   **Resolution:** Replace “one emitted envelope” with a versioned observation lifecycle: an admission record carrying stable observation identity, exact `operation-class` version, ownership/budget attribution and correlation; then a terminal record or completion patch carrying outcome, duration, and diagnostic. Add an exhaustive projection table declaring, per operation class and phase, whether it feeds telemetry, structured logs, metering, or multiple sinks—and exactly which record is billable. Close OQ1 before Review.

2. **MATERIAL — C5’s reclassification is correct, but its authority and deletion consequences are not carried through.**

   **Evidence:** Phase 1 persists subjects and potentially operator-only diagnostic details (`llp/0154-minimal-observability.rfc.md:276`, `llp/0154-minimal-observability.rfc.md:331`), yet Tier-1 routes are described only as “admin-gated” (`llp/0154-minimal-observability.rfc.md:397`). LLP 0031 requires raw/open identity-derived responses to use `AdminSecretRead`, not an ordinary admin or persisted console credential (`llp/0031-server-route-taxonomy.spec.md:181`, `llp/0031-server-route-taxonomy.spec.md:199`); existing raw inspect and table routes implement exactly that split (`src/admin.rs:1957`, `src/admin.rs:1974`). Phase 1 collects subjects, but subject deletion is deferred to Phase 3 (`llp/0154-minimal-observability.rfc.md:545`). Finally, HLL-class sketches are proposed alongside subject deletion (`llp/0154-minimal-observability.rfc.md:484`), without explaining how historical contributions are removed or rebuilt.

   **Resolution:** Make `/stats` a closed `OperatorMetadata` projection with no subject, details, or handler-controlled text. Require scoped, budgeted `AdminSecretRead` leases and `no-store` for `/events` and export. Either omit `subject` from Phase 1 or define Phase-1 erasure/rotation semantics and add the necessary index. Replace the asserted HLL solution with a Phase-3 decision gate requiring a deletion-compatible aggregate strategy. Define diagnostic details through an allowlist/redactor, not merely a byte cap.

3. **MATERIAL — Generation fencing lacks a durable protocol and contradicts the SQL hatch.**

   **Evidence:** D1 says old-generation rows become invisible to every query surface immediately (`llp/0154-minimal-observability.rfc.md:250`), while D3 gives only an in-memory “clear then rotate” sequence (`llp/0154-minimal-observability.rfc.md:362`). It does not identify the durable current-generation authority or specify crash/restart and commit-uncertainty behavior across the two databases. The existing reset path already rotates an authorization-stream incarnation in the app transaction (`src/storage.rs:930`) and emits the committed successor witness (`src/storage.rs:2467`), followed by an exact publication fence (`src/server.rs:17335`). That is a natural authority to reuse or explicitly supersede. Separately, the direct SQL hatch can select old-generation base rows, contradicting “every query surface” (`llp/0154-minimal-observability.rfc.md:434`).

   **Resolution:** Normatively bind telemetry generation to a named existing database/stream incarnation or introduce an equally explicit authority. Specify admission capture, reset commit, lost-ack recovery, restart reconciliation, query selection, and restore translation in a crash matrix. Either expose only a current-generation view through the hatch, physically purge predecessors before reopening it, or narrow the invisibility claim and document the local-operator exception.

4. **MATERIAL — Rollup maintenance is not yet lossless, idempotent, or bounded.**

   **Evidence:** D4 text orders retention deletion and old-generation deletion before rollup updates (`llp/0154-minimal-observability.rfc.md:369`), but defines no rollup high-watermark, idempotency key, or transaction coupling. An app can therefore go idle after its final events and resume after raw retention; the stated order can delete the only inputs before aggregation. D7’s schema contains aggregates but no maintenance state (`llp/0154-minimal-observability.rfc.md:471`). Its claim that rows are bounded by the operation-class table is also too strong: `name` includes app-defined route/function/job names (`llp/0154-minimal-observability.rfc.md:288`), which can accumulate across deployments while rollups are retained indefinitely (`llp/0154-minimal-observability.rfc.md:468`). Finally, histogram-derived percentiles are approximate, contradicting “locally everything is exact” in the variance envelope (`llp/0154-minimal-observability.rfc.md:411`, `llp/0154-minimal-observability.rfc.md:478`).

   **Resolution:** Add transactional rollup state with a durable high-watermark, process unrolled rows before retention, delete only rows covered by that watermark, and define how stats combine finalized rollups with the unrolled tail without double counting. Put explicit retention/cardinality budgets on rollups or define a compaction policy. Make exactness field-specific: counts may be exact while histogram percentiles carry bucket/error metadata.

5. **MATERIAL — The hosted Tier-1 query locus is internally inconsistent.**

   **Evidence:** D5 makes app-server routes under `/_snapback/api/telemetry/*` the canonical contract (`llp/0154-minimal-observability.rfc.md:397`). The Cloudflare design keeps the Analytics Engine query credential in the control plane and explicitly out of the app runtime (`llp/0154-minimal-observability.rfc.md:514`). LLP 0072 likewise assigns hosted logs, metrics, and gated inspection to the control plane and keeps its credentials out of the application plane (`llp/0072-trusted-single-tenant-control-plane.rfc.md:155`). The RFC does not define who answers the app-server route on Cloudflare or how the console reaches the control-plane-owned data. A variance envelope can describe approximation, but cannot manufacture deterministic cursor pagination or an events listing if the backend cannot provide them.

   **Resolution:** Define a transport-neutral telemetry query operation/schema as the contract. Locally, project it onto the admin routes; hosted, project it through the target adapter/control plane; MCP and CLI consume the same operation. Add capability outcomes such as `exact`, `approximate`, `bounded-window`, and `unsupported` per query, rather than requiring every backend to simulate every route.

6. **MINOR — `boot` lifecycle events contradict the strongest idle wording.**

   **Evidence:** C2 says no traffic means no events or writes (`llp/0154-minimal-observability.rfc.md:179`), D1 says the file stays absent until the first event (`llp/0154-minimal-observability.rfc.md:247`), but D2 includes boot as a lifecycle event (`llp/0154-minimal-observability.rfc.md:310`). The existing idle evidence measures a 120-second window after startup and provisioning, not zero startup writes (`llp/0035-local-target-benchmarks.research.md:277`).

   **Resolution:** Either arm the boot marker only when the first traffic event arrives, or weaken the claim to “no periodic writes after startup” and add separate startup-write evidence.

7. **MINOR — The SQL authorizer precedent is described inaccurately.**

   **Evidence:** D5 calls for a deny-by-default authorizer and says Ibex installs “exactly this authorizer” (`llp/0154-minimal-observability.rfc.md:434`). The Ibex authorizer is allow-by-default except for `ATTACH`, `DETACH`, and `load_extension` (`vendor/ibex/src/host/abi.rs:3075`); its isolated-I/O variant denies only selected pragmas before delegating to that allow-default policy (`vendor/ibex/src/host/abi.rs:3091`). Snapback’s rusqlite dependency currently lacks `hooks` (`Cargo.toml:33`), while Ibex enables it (`vendor/ibex/Cargo.toml:59`).

   **Resolution:** Say this is a new, stricter policy inspired by the Ibex precedent. Enumerate allowed authorizer actions, reject statement tails, deny all pragmas/attachment/extensions, and enforce both result-row and VM-step/time budgets. Add adversarial tests beyond the existing three Ibex refusal cases (`vendor/ibex/src/host/abi.rs:10831`).

4. **Design proposals**

- **[strong] Make the observation primitive a two-stage span, not a single terminal envelope.** Use an immutable admission event plus a terminal completion linked by one observation ID. Metering consumes admission; telemetry can join admission and completion; hosted logs can emit either or both under their own redaction and loss contract.

- **[strong] Make typed telemetry operations—not HTTP routes—the cross-target contract.** Treat local routes, control-plane adapter calls, CLI, MCP, and console as projections. This resolves the Cloudflare credential-locus conflict and matches LLP 0024’s existing architectural pattern.

- **[strong] Keep Phase 1 subject-free by default.** Operational debugging needs correlation, route/function identity, diagnostic code, release, generation, and timing; it usually does not need a durable user subject. Add subject-bearing analytics only with Phase 3’s identity, deletion, and retention policy.

- **[strong] Define rollups as a small state machine.** Persist `lastRolledEventId`, update buckets and the watermark atomically, retain an unrolled tail, and run retention only behind the watermark. Publish per-field variance rather than one response-wide exactness bit.

- **[moderate] Add a hard resource safety envelope independent of commercial entitlements.** Local configuration may remain operator-free, but `max_days`, telemetry bytes, rollup rows, operation-name cardinality, and query work should still have validated bounds to preserve C3.

- **[moderate] Either capture authored logs or rename the “Logs” page to “Events.”** The runtime already has a `runtime.log` host call (`src/runtime.rs:1895`), while the Phase-1 taxonomy contains no app-log event. If app logs remain excluded, the UI should not imply they are present.

- **[exploratory] Separate operational events from product events at the type level.** A `SystemObservationV1` and later `DeclaredProductEventV1` can share identity/correlation primitives without forcing lifecycle, request, analytics-property, and billing semantics into one oversized union.

5. **Open questions**

- **OQ1 — Envelope field set:** Must be resolved before Review. Ratify not just field names, but admission-versus-terminal timing, stable event identity, operation-class version, batch/retry rules, and the exact projection matrix.

- **OQ2 — Phase-3 identity policy:** Defer product analytics, but choose privacy-conservative semantics: no automatic retroactive anonymous-to-authenticated linking. Permit explicit app declaration later, with deletion applying to the complete link set. Until then, authenticated and anonymous identities remain separate.

- **OQ3 — Hosted retention ceilings:** Commercial entitlements can remain an LLP 0104 decision, but this RFC should still define non-commercial safety bounds for every arm. “Operator-free” should mean no plan gate, not unbounded storage.

- **OQ4 — Cloudflare rollup persistence:** Start with an honestly bounded Analytics Engine window rather than adding Durable Object rollups immediately. Add DO rollups only if the Phase-2 capability target requires longer-window Health parity and after the query-locus contract is settled.

- **OQ5 — Lifecycle seam inventory:** Close for Phase 1 with a small allowlist: process start/ready, release activation, migration success/failure, reset/restore generation boundary, detected unclean predecessor, and graceful shutdown. Keep config and secret rotation in control-plane audit unless only a non-sensitive version/digest marker is emitted.

- **Additional question — `ctx.track` settlement:** Decide whether events requested during a mutation are released only after successful commit. LLP 0110’s durable activity pattern commits activity and source effects together (`llp/0110-bounded-children-and-activity-patterns.spec.md:548`); telemetry remains best-effort, but should not silently count rolled-back product actions unless that semantic is explicit.

I did not inspect any LLP 0154 review artifact. I also did not independently verify the dated external vendor or Cloudflare Analytics Engine claims in the landscape section; this review used only repository evidence.

6. **Recommended next step.**

Revise to v0.4 while remaining Draft. First close OQ1 with the two-stage observation contract and exhaustive projection table; then pin route sensitivity/deletion rules, generation recovery, transactional rollup maintenance, and the target-neutral hosted query seam. Correct the idle and authorizer wording and run one focused cross-family re-review over those changes. The sandbox was read-only, so I did not create the required `llp/reviews/0154-…codex.md` artifact or change the RFC’s status.

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request for a Codex design-partner review)
**Method:** fresh non-author `codex exec` context, read-only sandbox over
the working tree; mutually blind — instructed not to read any
`llp/reviews/` artifact concerning LLP 0154, and verified after the fact
not to have done so (zero mentions of that path in its 12,539-line
transcript, which matters because the Fable round-1 artifact was already on
disk during part of this run). SHA-pinned target and instruction capsule.
Design-partner framing per author directive: reviewer explicitly invited
to propose significant design changes.
**Instruction capsule SHA-256:** `776514aa0897947ba44a88d74cb0ffc6723e00b1b782e7cb112e74bee95307d3`
**Target:** `llp/0154-minimal-observability.rfc.md` (489 lines, Draft, v0.2)
**Target SHA-256:** `a6fc5deec321f1ea8847b0f450d9402686845c053e275a3f75e040134117cfca`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

LLP 0154 has the right product instinct: recent operational visibility should be built in, agent-queryable, bounded, and isolated from the application write lane. I verified the target hash and read the full document plus the named repository authorities and source seams. The local sibling-store direction is credible, but the RFC is not yet a sound implementation basis: its SQL escape hatch lacks a sufficient security boundary; its privacy classification is incorrect; its metering/log compatibility claim is not borne out by the schemas; its rollups cannot compute several promised metrics; and reset, hosted, route-authority, and MCP semantics remain unresolved. I did not independently revalidate the external landscape and pricing claims, and this verdict does not depend on them.

Verdict: NOT READY

## 2. Strengths

- The scope boundary is unusually clear. Fixed operational views with short raw retention fit Snapback’s explicit exclusion of write firehoses and heavy OLAP (`llp/0154-minimal-observability.rfc.md:47-57`; `llp/0000-snapback.explainer.md:689-718`).

- The sibling-database decision is directionally correct. Snapback’s app database has a dedicated write connection and WAL reader pool (`src/storage.rs:802-809`, `src/storage.rs:1652-1663`, `src/storage.rs:7892-7939`), so isolating telemetry avoids app-writer lock contention, journal semantics, live-query matching, and backup pollution.

- The event-driven idle requirement is well grounded. The RFC preserves “no traffic, no writes” (`llp/0154-minimal-observability.rfc.md:141-146`), matching the measured local result of unchanged database/WAL files and no measurable CPU over 120 seconds (`llp/0035-local-target-benchmarks.research.md:277-306`) and the qualified Cloudflare observed-zero evidence (`llp/0000-snapback.explainer.md:584-614`).

- Bounded queues, explicit shedding, and visible drop counters are the correct failure posture (`llp/0154-minimal-observability.rfc.md:236-252`). That is consistent with the existing realtime rule that bounded loss must remain observable (`llp/0013-ephemeral-realtime-state.rfc.md:470-504`).

- “Agents first, dashboards as a client” is exactly aligned with the project. LLP 0010 requires stable machine-readable feedback (`llp/0010-agent-dx-and-acceptance.spec.md:38-47`, `llp/0010-agent-dx-and-acceptance.spec.md:64-81`), while LLP 0017 already makes the web console one consumer of a headless contract (`llp/0017-admin-console-inspection-surface.rfc.md:11-24`).

- Several substrate claims are verified: `Cargo.toml` has no direct `tracing` or `log` dependency (`Cargo.toml:15-47`), and `src/server.rs` has exactly two `eprintln!` calls (`src/server.rs:3848`, `src/server.rs:20420`). Cron already has a strong terminal seam carrying job identity, outcome, duration, and diagnostic (`src/cron.rs:894-944`).

- The capability-index debt is real. Its policy requires explicit GAP rows for uncovered capabilities (`guide/capabilities.md:20-29`), and the current capability table contains no observability row (`guide/capabilities.md:31-99`).

## 3. Concerns

1. **BLOCKING — The read-only SQL endpoint is not safely isolated as specified.**
   D5 asserts that `PRAGMA query_only = ON` means the connection “can only ever see” telemetry tables (`llp/0154-minimal-observability.rfc.md:296-308`). That does not define an SQL authorization boundary: it names no denial of `ATTACH`, `DETACH`, extension loading, unsafe pragmas, multiple statements, or non-telemetry objects. The repository’s own Ibex SQLite boundary separately installs an authorizer specifically to deny attach/detach and `load_extension` (`vendor/ibex/src/host/abi.rs:3075-3088`) and tests those refusals (`vendor/ibex/src/host/abi.rs:10831-10866`).
   **Resolution:** Remove network-exposed arbitrary SQL from v1, or specify a deny-by-default SQLite authorizer, fixed-table allowlist, single read statement, read-only open flags, disabled extensions, memory-only temp state, step/time/row/byte limits, and `AdminSecretRead` authorization. Do not expose a Cloudflare-native arbitrary dialect as the same contract.

2. **BLOCKING — “Telemetry is not customer data” is the wrong classification.**
   C5 says telemetry is not customer data (`llp/0154-minimal-observability.rfc.md:157-160`), yet the proposed store contains auth subjects, diagnostic details, URLs, user agents, referrers, optional IPs, device identifiers, and app-defined properties (`llp/0154-minimal-observability.rfc.md:198-234`, `llp/0154-minimal-observability.rfc.md:339-351`). The code explicitly warns that diagnostic messages/details can contain source paths, handler text, and arguments (`src/diagnostic.rs:31-33`). LLP 0031 classifies subjects and handler-controlled content as sensitive application/identity-derived data and requires stronger controls for raw reads (`llp/0031-server-route-taxonomy.spec.md:181-206`, `llp/0031-server-route-taxonomy.spec.md:339-343`). LLP 0072 also forbids arbitrary objects, credentials, raw bodies, and private payloads from default logs (`llp/0072-trusted-single-tenant-control-plane.rfc.md:719-735`).
   **Resolution:** Rename C5 to “telemetry is out-of-band application/identity-derived data”; define field-level safe projections, URL/query/referrer scrubbing, diagnostic redaction, file permissions, subject hashing/rotation, deletion semantics, and route sensitivity. Raw events and SQL should require scoped secret-read authority and row/byte budgets.

3. **MATERIAL — C4’s claimed compatibility with LLP 0104 is not real yet, and LLP 0072 already owns overlapping log semantics.**
   LLP 0154’s row has `id`, `ts_ms`, `kind`, `name`, status, duration, subject, code, and details (`llp/0154-minimal-observability.rfc.md:193-212`). LLP 0104 requires globally unique idempotent IDs, schema version, occurred/observed times, stable app/environment identity, ownership interval, release/deployment identity, request/job correlation, metric quantity, source receipt, correction relationships, deduplication, and completeness watermarks (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:62-93`). It also explicitly separates sampled observability from billable totals and says Analytics Engine is not billing authority (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:463-484`). Meanwhile LLP 0072 already requires structured application logs with deployment identities, correlations, event versions, redaction, source sequence, and delivery/drop counters (`llp/0072-trusted-single-tenant-control-plane.rfc.md:719-735`), contrary to LLP 0154’s characterization of hosted logs as merely supervisor logs (`llp/0154-minimal-observability.rfc.md:388-393`).
   **Resolution:** Share a typed admitted-operation classification and correlation envelope, not a loss-tolerant storage contract. Project it independently to telemetry, bill-grade metering, and structured hosted logging, each with its own delivery guarantees.

4. **MATERIAL — The proposed rollups cannot produce the Usage contract.**
   D5 promises DAU/WAU/MAU and weekly retention (`llp/0154-minimal-observability.rfc.md:319-321`), but D7 retains only one daily distinct-subject scalar (`llp/0154-minimal-observability.rfc.md:365-379`). Daily cardinalities cannot be combined into exact weekly/monthly unions or cohort intersections. Raw events cannot fill the gap because Usage “never scans raw events” and raw retention is seven days (`llp/0154-minimal-observability.rfc.md:361-377`). The phase boundary is also muddy: Usage ships in the main deliverable while `track()` is Phase 2.
   **Resolution:** Either drop WAU/MAU/retention and the Usage page from v1, or add a mathematically sufficient representation—mergeable sketches for unions and an explicit cohort representation for retention—with accuracy and privacy semantics. Use mergeable latency histograms if percentiles must aggregate across buckets.

5. **MATERIAL — Reset, restore, buffering, and cleanup lack one lifecycle model.**
   D1 says deleting the file is always safe and `app/reset` wipes it (`llp/0154-minimal-observability.rfc.md:184-191`), but a buffered producer can recreate the file with pre-reset events, and sibling-file deletion cannot be atomic with the app database reset. The current reset path is deliberately one carefully fenced durable transition (`src/server.rs:17116-17140`, `src/server.rs:17202-17310`). Restore behavior is not addressed at all. D4 also calls cleanup an LLP 0028 cron while requiring traffic-only activation (`llp/0154-minimal-observability.rfc.md:254-260`); LLP 0028’s declared policies are `always` or explicit live-demand gating, with scheduler state in the app database (`llp/0028-cron-scheduled-execution.rfc.md:265-310`).
   **Resolution:** Generation-bind every event to the app/database incarnation; fence and clear the buffer during reset/restore; query only the current generation; clean old generations opportunistically. Run cleanup and rollups inside the event-armed telemetry writer rather than through the application cron ledger.

6. **MATERIAL — The Phase-2 `track()` route violates the active route taxonomy and leaves identity/audit semantics unresolved.**
   An ordinary client is told to post to `/_snapback/api/telemetry/track` (`llp/0154-minimal-observability.rfc.md:339-347`), but LLP 0031 requires app-client operations at the root and reserves `/_snapback/api/*` for admin-gated system APIs (`llp/0031-server-route-taxonomy.spec.md:90-125`); the implementation enforces the same invariant (`src/server.rs:7118-7152`). Anonymous device activity also does not automatically merge with the later authenticated subject, so the claim that identity complexity “collapses” is incomplete. Finally, lossy `track()` must not be confused with LLP 0110’s atomic durable activity rows (`llp/0110-bounded-children-and-activity-patterns.spec.md:359-375`, `llp/0110-bounded-children-and-activity-patterns.spec.md:548-578`).
   **Resolution:** Give tracking a root app-data route or registered app-data operation with connection/session authority; explicitly declare it non-audit and best-effort; define anonymous-to-auth behavior; and preferably require source-declared event names/property schemas.

7. **MATERIAL — Cloudflare does not yet implement the supposedly stable Tier-1 contract.**
   Locally, Usage reads indefinitely retained rollup tables; D8 replaces the store with Analytics Engine and merely says the same routes query its SQL API (`llp/0154-minimal-observability.rfc.md:275-308`, `llp/0154-minimal-observability.rfc.md:388-400`). No equivalent rollup persistence, exactness, sampling/freshness marker, pagination contract, or reset incarnation is defined. OQ3 also proposes proxying an account-scoped token without resolving its custody (`llp/0154-minimal-observability.rfc.md:468-471`), while LLP 0072 sharply separates control-plane credentials from application-plane surfaces (`llp/0072-trusted-single-tenant-control-plane.rfc.md:155-174`).
   **Resolution:** Mark Cloudflare partial until a stable Tier-1 response contract is proven. Responses need exact/approximate, sampling, freshness, retention, and truncation facts. Keep account-scoped query authority in a control-plane gateway or another narrowly scoped binding, not an ordinary app-runtime secret.

8. **MATERIAL — The “query contract” is not specified deeply enough, and it names the wrong MCP seam.**
   D5 promises stable documented schemas but does not pin DTOs, ordering, cursor/filter binding, default windows, maximum work, partial-result behavior, freshness, drop counts, or error envelopes (`llp/0154-minimal-observability.rfc.md:267-308`). It also cites `src/guide_mcp.rs` as a tool surface, but that server intentionally exposes only read-only resources and rejects `tools/list` (`src/guide_mcp.rs:1-8`, `src/guide_mcp.rs:308-321`). The actual control MCP projects served operations one-to-one over host-ops (`packages/snapback-cli/mcp-control.mjs:1-8`, `packages/snapback-cli/mcp-control.mjs:444-479`).
   **Resolution:** Pin the Tier-1 request/response JSON Schemas and resource bounds in this RFC. Decide whether telemetry becomes LLP 0024 host operations—which fits the existing MCP—or whether the control MCP deliberately gains a second transport contract.

9. **MATERIAL — The capacity argument contains incorrect arithmetic and no target-scale proof.**
   One million requests/day is about 11.6 requests/second, not “~12 batched inserts/second” (`llp/0154-minimal-observability.rfc.md:381-384`). With 256 rows per batch it is about 0.045 full batches/second before accounting for multiple events per request. Conversely, the “three seconds after the most recent record” debounce can delay a continuous 1 event/second stream until 256 events accumulate—over four minutes. The RFC also gives no row-size, disk-footprint, retention-delete, percentile-query, or application-I/O interference measurement. The root LLP explicitly treats target scale as unproven until an acceptance workload and degradation behavior exist (`llp/0000-snapback.explainer.md:758-770`).
   **Resolution:** Correct the model and add a benchmark gate covering event amplification, sustained/burst traffic, file size, flush latency, cleanup/checkpoint stalls, query latency, drop behavior, and impact on app request latency. Flush after a maximum age from the first buffered event, not inactivity after the latest event.

10. **MINOR — C1 overstates current app-database behavior.**
    Not every internal commit bumps `_snapback_version`, journals `_snapback_changes`, and invokes live matching; for example, asset-system transactions commit directly (`src/storage.rs:1726-1743`), while ordinary mutation versioning is conditional on actual changed rows (`src/storage.rs:4075-4103`). The separate-file conclusion remains good, but its argument should be “same SQLite writer/file and a new infrastructure exception,” not “every commit necessarily journals and fans out.”

## 4. Design proposals

1. **Strong — Split the product into three phases.**
   Phase 1 should be the observability kernel: safe system events, recent local/container store, event-armed retention, Health and Events/Logs, Tier-1 JSON, CLI, and MCP. Phase 2 should add a proven hosted backend. Phase 3 should add declared product analytics, identity policy, Usage, and retention. Remove Usage and arbitrary SQL from Phase 1.

2. **Strong — Introduce one typed observation envelope with three projections.**
   Capture stable environment/release/incarnation identity, operation classification, admission and observation times, request/job correlation, outcome, duration, safe diagnostic identity, and optional subject. Project it to:

   - loss-tolerant local observability;
   - reliable, deduplicated metering;
   - structured hosted logs/export.

   This shares seams and semantics without pretending all three have the same reliability contract.

3. **Strong — Make app events declared, generated, and typed.**
   Prefer `defineTelemetry({ events: ... })` plus generated event references over arbitrary `track(name, props)`. A declared vocabulary makes cardinality genuinely bounded, enables field-level privacy review, gives agents exact types, and avoids `_other` silently swallowing unreviewed event names.

4. **Strong — Delete the remote SQL hatch from the paved path.**
   Tier-1 JSON plus NDJSON export answers the agent-first requirement safely. If local experts still need SQL, offer an explicitly local/offline CLI command that opens the telemetry file read-only with the repository’s hardened SQLite authorizer. Do not make native dialect divergence a public cross-arm contract.

5. **Strong — Simplify v1 aggregates.**
   Maintain mergeable counter and latency-histogram buckets. Ship request volume, errors, latency percentiles, jobs, connections, and drops. Defer distinct-user metrics until their identity, erasure, anonymous-linking, and aggregation algebra are specified.

6. **Moderate — Make lifecycle correctness generation-based rather than deletion-based.**
   Stamp every event with the current app/database incarnation. Reset and restore rotate the generation and clear the in-memory queue before new admissions; old generations become invisible immediately and are deleted opportunistically. This avoids pretending two SQLite files can reset atomically.

7. **Moderate — Make target variance explicit in Tier 1.**
   Every response should report store backend, exactness, sampling, freshness, raw-retention boundary, dropped count, and truncation. Cloudflare can then honestly remain partial without changing the stable data shape.

## 5. Open questions

- **OQ1 — Buffer policy:** Reserve capacity for failures and terminal job/connection outcomes; shed successful high-volume request events first. Prefer dropping oldest low-priority events so recent debugging survives. Count drops by kind, priority, and reason.

- **OQ2 — Track limits:** Do not ratify arbitrary numeric defaults yet. Require declared event schemas, per-event byte ceilings, per-connection and per-instance budgets, and a benchmark-derived target capability. Telemetry admission must not become billing authority.

- **OQ3 — Cloudflare query auth:** Keep the account-scoped credential in a control-plane telemetry gateway or narrowly scoped provider binding. Do not place a broad account token behind an app-serving route.

- **OQ4 — Retention ceiling:** Keep seven days as the default, but publish a target-specific hard ceiling. Hosted pricing may choose entitlements within that ceiling; commercial tiering should not define the storage safety bound.

- **OQ5 — Sessions:** Defer sessions and the weekly-retention tile. DAU plus operation counts are enough for the first operational slice; sessionization belongs with the later declared product-events phase.

- **OQ6 — Meter ordering:** Land the shared operation classification/envelope first. Metering and telemetry sinks can then land independently or together, but loss-tolerant telemetry must never supply billable totals.

- **OQ7 — SQL dialect:** Do not expose native dialect divergence. Keep arbitrary SQL local-only, or omit it entirely; Tier 1 should be the cross-arm contract.

- **Additional:** Which route classes count as application usage? Health probes, console polling, telemetry queries, static assets, and internal maintenance should be excluded explicitly through the versioned operation-class table.

- **Additional:** What is the subject deletion/rotation contract, and what happens when an anonymous device later authenticates? That decision is required before DAU/WAU/MAU claims.

## 6. Recommended next step

Revise the RFC to v0.3 while it remains Draft. The revision should:

1. replace C4/D2 with the shared-envelope-plus-independent-sinks model;
2. remove or fully sandbox Tier-3 SQL;
3. correct the data classification and route authorization;
4. narrow Phase 1 to Health and Events/Logs;
5. define generation-bound reset/restore and event-armed maintenance;
6. pin Tier-1 JSON Schemas and the hosted capability semantics; and
7. add a target-scale benchmark/acceptance matrix.

Then run a focused round-2 review over security, rollup algebra, and cross-arm semantics before moving to Review. Because this environment was read-only, I did not write the LLP 0005 review artifact; the review coordinator should preserve this response with Codex provenance if it is counted in the loop.
