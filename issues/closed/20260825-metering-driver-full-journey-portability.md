# Metering driver: full-journey cell support + host portability (R3 prerequisite)

**Status:** Closed
**Opened:** 2026-08-25
**Closed:** 2026-08-25
**Systems:** Benchmarks, Metering
**Related:** LLP 0295 §R3, LLP 0201 D2/D0.6,
`benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/RUNBOOK.md`
(blocker inventory), `benchmarks/runs/2026-08-23-r2-published-0125/`

## Problem

The R2 driver stack (`r2-cell-admission.mjs`, `lane-controller.mjs`,
`r2-cell-driver.mjs`) is the only machinery that produces D0.6 per-milestone
metering blocks, and it cannot run the canonical full journey or leave its
original habitat. The capstone preparation round (authoring-only, source
inspection) found six fail-closed incompatibilities:

1. **Reduced-run-only semantics (the deep one):** `r2-cell-driver.mjs`
   writes `runScope: "reduced"`, appends an M1–M3-only handoff, launches one
   native harness session, and ends it after M3. It cannot express LLP 0201
   D1's continuous M1–M6+M8 session plus a separately metered fresh-M7
   session. Listing eight milestones in JSON does not change the executed
   scope.
2. **macOS-only host probes:** admission obtains `hardwareModel`, CPU brand,
   and physical CPU count via macOS `sysctl` keys; fails on Linux before
   host comparison.
3. **Git-required admission/finalization:** admission, seriality replay, and
   `r2-finalize-existing.mjs --publish` need Git object reads; a provisioned
   gitless tree (e.g. `git archive` deployment) cannot admit.
4. **Byte-binding acquisition:** exact Node executable SHA-256/size, kernel
   release, and `os.totalmem()` must be probed on the execution host by the
   tooling; there is no supported remote/deferred binding flow.
5. **M7 port blocks ignored:** `allCampaignPorts()` reads only `cell.ports`,
   never `m7Ports`, so the fresh all-campaign port probe misses the M7
   blocks the journey requires.
6. **No non-consuming smoke:** an ordinary admission acquires the production
   lock and issues a one-attempt transition; the old dry-run is pinned to
   `0.3.3-m8`. There is no way to smoke a new campaign config without
   consuming an attempt.

## Wanted

Full-journey (continuous M1–M6+M8 + fresh M7, with M7 metered separately)
cell semantics; Linux and gitless-tree host support (or a documented
provisioning contract that admission accepts); M7 ports in the campaign
probe; a non-consuming smoke mode current with the instrument pin. This is
the prerequisite for LLP 0295 R3 running as a full-journey, claim-eligible
wave rather than an M1–M3 calibration repeat.

## Interim

The 2026-08-25 capstone run executes in the manual shape with prompt-native
milestone clocks and `0.3.4-m8` receipts (see the run README amendment);
its cells are honestly scorecard-ineligible.

## Resolution

Resolved by the 2026-08-25 Lane D driver revision. The retained M1-M3 mode
keeps `social-messenger-r2-native-cli-driver.v1` and `runScope: reduced`; the
new exact full shape uses
`social-messenger-full-journey-native-cli-driver.v1` and refuses any milestone
or session-shape permutation outside these two registered modes.

1. **Full journey:** the driver holds one builder process across
   M1-M6+M8, closes M8 authoring at the first native usage settlement after
   its signal, retains the chronological scale attempt/continuation artifact
   on a separate replay clock, and then starts a second native process for M7.
   The M7 process gets only a hash-bound `m7-handoff.md` plus driver-owned M7
   instructions, uses the M7 port block and starter/pre-replay backend policy,
   and carries a new native session ID. The manifest joins both native streams,
   excludes post-M8 builder turns from authoring tokens, starts M7 wall at the
   fresh process launch, and projects M7 wall/tokens into both its D0.6 block
   and `clocks.m7Session`.
2. **Linux probes:** admission dispatches host identity by platform. Darwin
   retains the three existing `sysctl` reads. Linux reads CPU facts from
   `/proc/cpuinfo`; `hostname`, kernel `release`, architecture, logical CPU
   count and exact `os.totalmem()` bytes remain host probes. A fact not
   available from the platform is `null`, never synthesized, and exact allowed
   host comparison remains the admission policy.
3. **Gitless source contract:** admission, controller seriality replay and
   finalization accept `--provisioning-manifest <external-path>`. The external
   location prevents a self-hash cycle. The manifest contract is:

   - `version: snapback.gitless-source-provisioning.v1`;
   - `source.objectFormat` (`sha1` or `sha256`), `source.commit`,
     `source.tree`, canonical-base64 raw `source.commitObject.data`, and a
     path-sorted `source.gitlinks` list for any uninitialized submodules;
   - `content`, produced by `measureProvisionedSourceTree()` with the same
     object format and gitlink list. It inventories every deployed regular
     file and symlink by logical path, mode, size and SHA-256, records total
     bytes, and carries the recomputed Git root-tree object ID.

   The consumer hashes the raw commit object and requires it to equal
   `source.commit`, requires its first tree header to equal `source.tree`,
   computes every ordinary Git blob and every recursive tree object from the
   deployed bytes, reinserts only commit-bound gitlink IDs, and requires the
   resulting root tree to equal `source.tree`. It also recomputes the complete
   deployment inventory and SHA-256 content root. Thus commit/tree labels are
   not trusted metadata. A missing manifest on a Gitless tree refuses with
   `R2_ADMISSION_PROVISIONING_REQUIRED` or
   `R2_FINALIZE_PROVISIONING_REQUIRED` and names the required flag/contract;
   any byte/object mismatch uses `R2_ADMISSION_PROVISIONING_MISMATCH`.
4. **Execution-host byte binding:** `configuredExecutionBinding()` reads the
   executing Node binary and records its real path, SHA-256 and byte size at
   admission. `currentHostIdentity()` probes the kernel release and exact
   memory bytes in the same process. Verification recomputes the execution
   binding; newly registered `node.bytes` values are exact, while older R2
   configs that predate that field retain their original path/digest policy.
5. **M7 ports:** `allCampaignPorts()` unions every cell's main and M7 ranges;
   both admission and the repeated fresh launch-quiet probe consume that same
   list for IPv4/IPv6 checks.
6. **Non-consuming smoke:** `lane-controller.mjs --smoke` runs committed
   config/seriality/source/execution/host/harness/instrument/quiet/load checks,
   initializes the real observation controller, preflights the current pinned
   production driver, and exercises deterministic record composition in a
   temporary directory. Its result is explicitly `status: non-scored`,
   `publishable: false`, `attemptConsumed: false`, and
   `productionLockAcquired: false`; it never creates the campaign cell capsule
   or calls the production lock path.

Regression coverage lives in
`benchmarks/tools/social-messenger/metering/test/metering-portability.test.mjs`.
It covers the full/two-session join and clocks, replay-token exclusion,
handoff-only fresh M7 state, retained reduced record validation, Darwin/Linux
dispatch, Gitless acceptance/refusal/tamper detection (including gitlinks), M7
port probing, exact host/Node binding, and non-consuming current-pin smoke.

## Review fix round (2026-08-25)

The first driver revision overstated full-journey harness support and did not
exercise the production manifest loader. The supported contract is now exact:
full journey is available only for `codex-sol`. Claude and Grok retain their
registered reduced-run accounting paths, but a full-journey shape for either
is refused from the registered config during production admission, before the
admission host lock is acquired. The controller repeats the same pure support
check before claiming an admission lock, while driver preflight keeps the same
defense in depth. Refusal therefore creates no rendered prompt, attempt
capsule, native launch, or brief lock claim-and-release. This follows LLP 0295
R2 admission's fail-closed, pre-attempt philosophy; no attempt or host-lock
custody is consumed by a contract that cannot later compose.

The Codex full-journey manifest still retains the conservative 5-second
controller/native clock-correlation evidence. After the hash-bound native
signal ordinal and its exact following `token_count` ordinal recover a usage
settlement, the join uses the same shared-host zero-skew ordering contract as
the retained reduced driver. The compatibility event preserves both clock
contracts and the complete recovered settlement provenance. A production-path
test now runs `loadMeteringManifest()` and `joinUsageToMilestones()` with the
settlement timestamp exactly equal to the admitted token turn.

Scale replay now requires a separately hash-bound adapter receipt naming the
registered fixture action-log SHA-256 and action count, every reached 10%/50%
checkpoint prefix and prefix hash, the settled prefix, failed-action count,
and pass verdict. Both driver ingestion and final composition validate that
receipt; a syntactically self-consistent receipt for another action log is
rejected. Continuous authoring ends at M8's native settlement boundary, while
replay and fresh M7 carry separate wall and token phases whose sums equal the
record totals. M7 suite-status is cross-checked like every other green
milestone, and full-journey compatibility events are retained instead of
being emitted as an empty list.

All three retained R2 records are now exercised by the semantic validator and
all three retained slots by the complete finalized-slot validator. Their
current failures were reproduced byte-for-byte from local `origin/main` and
are therefore inherited, not caused or repaired by this lane; the retained
campaign directory remains unchanged:

| Retained cell | Semantic validation | Complete slot validation |
| --- | --- | --- |
| `opus-clique-explicit` | Invalid: missing current provenance fields | Invalid: legacy `completed` slot is not exact finalized single-attempt form |
| `sol-clique-explicit` | Pass | Invalid: M1 lacks a `0.3.4-m8` refusal-time attestation |
| `sol-clique-familiar` | Invalid: orphaned M3 correction episode | Invalid for the same semantic-replay failure |

## Review fix round 3 (2026-08-25)

The second Codex re-review found four further production-path gaps. All four
are fixed in the driver/validator contract rather than refuted:

1. The semantic record validator now invokes the same journey-aware accounting
   projection as the manifest loader, including M7 suite-status custody, the
   fresh-M7 wall origin, replay token separation, and the replay clock. Reduced
   records keep their prior inputs and exact validation path. A regression
   composes a full record from the production loader/join and writes it through
   `R2LaneController.writeCompleteRecord()`, whose semantic validator is the
   authoritative pre-write decision.
2. Codex usage turns retain their native record ordinal. Each recovered
   settlement also retains its internal native source identity, and the join
   requires the authorized `(source, ordinal, timestamp)` turn before selecting
   a prefix. Replay partitioning uses that ordinal boundary for the builder
   stream and timestamp only for other sources. A later token-count ordinal at
   the exact authorized millisecond is therefore replay usage, not M8 usage.
3. Waiting for scale replay is now a distinct driver phase after green M8. A
   mid-replay error retains a hash-bound `scale-replay-failure.json` with an
   `aborted` replay disposition and exact replay wall, leaves M8 green, records
   `scale-replay-aborted` as the orthogonal lane termination reason, and
   partitions post-M8 native usage into the replay token phase. Fresh M7 stays
   `not-run`; wall and token phases sum exactly to their totals.
4. Journey/harness support is a shared pure registered-config contract used by
   admission, controller pre-claim, and driver preflight. Unsupported full
   Claude/Grok configurations now refuse before either production lock path;
   the regression calls `createAdmissionArtifact()` and proves the lock
   acquisition callback is never reached.

The round changes metering-tree and validator bytes but does not change either
run-record schema. Instrument-manifest digest reconciliation is deliberately
left to the integration orchestrator, which must compute the complete combined
tree after all lanes are present.
