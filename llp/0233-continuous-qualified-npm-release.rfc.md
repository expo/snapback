# LLP 0233: Continuous qualified npm release

**Type:** RFC
**Status:** Draft
**Systems:** Packaging, Publishing, CI, Testing, Developer experience, Agent operations
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-11
**Revised:** 2026-08-11 (initial draft)
**Related:** LLP 0041, LLP 0113, LLP 0175, LLP 0189, LLP 0232,
`issues/20260810-qualified-publish-after-0116-fix.md`

## Summary

Make a qualified Snapback npm release available under `latest` within a target
of three minutes by moving native builds, closure assembly, cross-platform
qualification, public-registry byte verification, and full cold-install proof
out of the operator-visible promotion critical section.

The repository continuously prepares one release-ready candidate from recent
meaningful `main` work. That candidate is an immutable, versioned eleven-package
closure already published under a non-default holding tag and proven on stock
macOS/arm64 and Linux/x64 hosts. The synchronous release operation then does
only the work whose truth changes when `latest` changes: acquire publication
authority, revalidate the prior and candidate vectors, move the eleven tags,
wait for bounded registry convergence, install and boot the selected root once,
and close the signed transition.

This RFC changes proof placement and orchestration, not the qualification bar.
It preserves LLP 0041's exact-byte, two-platform, fail-closed release posture;
LLP 0113's external publication authority; and LLP 0189's scoped-evidence and
claim-snapshot rules. A cold, previously unqualified source revision is not
claimed to become publishable within three minutes. The three-minute objective
applies only when a release-ready candidate already exists.

## Motivation

The first completed qualified ceremony, 0.1.18, established that the current
path is functionally capable but operationally too expensive.

- Staged qualification used an eight-job EAS workflow with two native builds,
  two assembly passes, platform receipt minting, two staged cold-install
  proofs, and final retention.
- Promotion needed twelve attempts. LLP 0041 records eleven lane defects found
  along the way, including lease-clock skew, double-reserved budget,
  quiet-`main` assumptions, an unsatisfiable run predicate, GitHub provenance
  mismatches, timestamp precision, and authority cold-start cost.
- Even the successful final attempt took 8 minutes 50 seconds, from
  `2026-08-11T02:09:48.398Z` to `2026-08-11T02:18:38.687Z` in the retained
  promotion receipt.
- The synchronous post-promotion GitHub proof consumed about 5 minutes 45
  seconds of that successful attempt. Its run began at `02:12:47Z` and its
  artifacts were collected at `02:18:32.091Z`.
- Before that dispatch, serial tag movement and observation consumed about 2
  minutes 17 seconds. The promoted-installability barrier then consumed about
  40 seconds, including a deliberate 30-second stability interval.

The expensive work is real, but most of it proves properties of immutable
candidate bytes rather than properties created by assigning `latest`. Running
it only after an operator asks to publish puts preparation, proof, registry
mutation, and recovery debugging into one wall-clock path. That contradicts
LLP 0041's rapid-publication ruling: meaningful landed surface should publish
often, and landed-but-unpublished work is a liability.

LLP 0189 provides the governing separation. Qualification and publication are
snapshots bound to scoped evidence. Unrelated movement of `main` does not
invalidate a candidate, and a complete exact-commit battery is not a release
precondition. The publication lane may therefore prepare and retain an
immutable qualified candidate ahead of the moment `latest` moves.

## Goals

1. Make ready-candidate promotion to a fully observed `latest` vector complete
   in at most three minutes at p95 under ordinary npm, authority, and GitHub
   availability.
2. Remove native builds and full cross-platform proof from the synchronous
   promotion critical section without removing their assertions.
3. Make every phase resumable from durable, content-bound state.
4. Preserve exact tarball identity, two-platform consumer evidence, explicit
   prior-vector rollback, and fail-closed handling of ambiguous registry state.
5. Make latency visible per phase so a regression names its owner instead of
   appearing as an undifferentiated multi-hour ceremony.

## Non-goals

- This RFC does not promise three-minute qualification from a cold arbitrary
  commit.
- It does not weaken runtime readiness, packaged-store qualification, admin
  console sealing, telemetry currentness, or the staged cold-install matrix.
- It does not require `main` to be quiet while a candidate is prepared or
  promoted.
- It does not make npm's eleven-package tag update atomic. It bounds and
  journals the unavoidable transition and preserves rollback.
- It does not treat an asynchronous red as green. Post-release audits retain
  ordinary LLP 0189 ticketing and claim-triage consequences.
- It does not introduce release scarcity or a manual batching queue.

## Definitions

### Qualification latency

Wall time from selection of a source revision until a release-ready candidate
receipt exists. This includes native builds, staging, platform qualification,
candidate publication, and full public-registry proofs. It is a conveyor-health
metric, not the interactive release SLO.

### Release latency

Wall time from an operator or automation requesting promotion of an existing
release-ready candidate until the publication authority records a closed
successful transition and every package's `latest` tag is observed at the new
version.

### Release-ready candidate

An immutable candidate for one exact version and source revision with all of
the following:

1. a clean source-bound closure ledger;
2. both release runtime artifacts and their build attestations;
3. both packaged-store qualification receipts bound to the same pass-one
   closure;
4. the receipt-bearing restaged tarball vector;
5. successful candidate-tag publication for all eleven packages;
6. registry tarball digests equal to the staged vector;
7. successful full cold-install receipts on stock GitHub-hosted macOS/arm64 and
   Linux/x64 machines, selecting the immutable candidate version; and
8. the newest eligible LLP 0189 battery assessment, with every unrelated red
   named and ticketed.

The release-ready receipt closes over all of those artifacts and identifies
the exact candidate tag. It is append-only. Repair creates a new candidate
version or a new pre-publication staging generation; it never rewrites bytes
already accepted by npm.

## Design

### D1 — operate a continuous qualification conveyor

After a release closes, publication automation reserves the next patch version
as the open release slot. Meaningful publication-surface changes on `main`
select a candidate through the checked affected-scope policy. Selection is
debounced: at most one candidate qualification runs, and newer eligible work
coalesces into one pending successor rather than starting an unbounded queue.

The conveyor does not require the candidate to remain the tip of `main`.
Normal unrelated landings do not invalidate it. Claim-relevant changes are
handled by the LLP 0189 D-3/D-4 scope calculation: before candidate publication
they supersede the prepared candidate; after immutable candidate publication
they become the next release slot unless the published candidate is discovered
to be factually wrong.

Version reservation is durable and single-writer. A version has exactly one of
`open`, `candidate-published`, `promoted`, or `abandoned`. `open` may be
restaged because no npm bytes exist. `candidate-published` is immutable and
must either be promoted as the qualified snapshot or explicitly abandoned
with a reason and successor version. npm version existence, not a local file,
is authoritative against accidental reuse.

The conveyor emits a small machine-readable pointer naming:

- the newest release-ready candidate, if any;
- the source revision and version;
- qualification completion time and evidence digest;
- whether newer claim-relevant `main` work is pending; and
- any blocking phase with its stable diagnostic and resumable state.

This pointer is advisory until its complete receipt is independently
validated. It never substitutes for the receipt.

### D2 — publish candidate bytes before the release request

The qualified closure is published to npm under an immutable non-default tag
such as `candidate-<version>-<sha12>` as part of qualification, not as part of
promotion. Publication uses the same exact tarballs and ledger checks required
by LLP 0041. All eleven packages are then downloaded and their registry bytes
verified against the staged SHA-256 vector.

Candidate publication is an irreversible external action and therefore runs
only after staged qualification is green, npm authority is confirmed, the
ledger is retained, and the candidate version is durably reserved. It does not
change `latest` and creates no default-consumer claim.

Publishing under a holding tag before final proof is acceptable because the
candidate tag is explicitly non-default and the bytes cannot later be changed.
If public-registry proof fails, the version is marked `abandoned`; remediation
uses a successor patch version. The lane never promotes partially proven
candidate bytes.

### D3 — run the full consumer proof against the immutable candidate

After candidate publication and byte verification, dispatch the existing
stock GitHub-hosted macOS/arm64 and Linux/x64 cold-install matrix against the
exact candidate version or immutable candidate tag. Each platform must prove
the complete package closure, runtime selection, generated scaffold,
typecheck, boot, sealed admin surface, declared capability, and live
acceptance required by LLP 0041.

The receipts bind:

- candidate ledger and tarball vector;
- registry integrity and SHA-256 for every package;
- source revision and exact version;
- workflow identity, run identity, runner provenance, and platform;
- candidate tag; and
- the complete acceptance result.

This moves the existing proof earlier; it does not replace it with staged-only
evidence. The candidate proof exercises public npm bytes on independent stock
hosts before those bytes can become the default.

### D4 — narrow the synchronous promotion critical section

Promotion of a release-ready candidate performs only these ordered phases:

1. validate the release-ready receipt, exact-current obligations such as
   telemetry, and the newest eligible claim-relevant battery assessment;
2. observe and retain the complete prior `latest` vector;
3. acquire the externally signed publication lease;
4. move the eleven `latest` tags under D5;
5. observe the complete new vector until stable;
6. perform one fresh-cache root install through `latest`, verify that every
   resolved Snapback package belongs to the candidate vector, and run the
   minimal packaged boot/capability smoke;
7. reopen the registry vector and publication-authority head; and
8. write the post-promotion ledger and close the authority transition.

No native build, closure restaging, full scaffold matrix, browser installation,
or GitHub workflow dispatch belongs to this critical section.

The fresh install is load-bearing. A raw tag-vector read cannot detect stale
packuments or a dependency tree that selects the signed prior root. The smoke
must use an empty cache, install the public `latest` root, verify the resolved
tree, launch the packaged CLI/runtime seam, observe the required capability,
and complete one query. It may reuse the compact behavior already established
by `scripts/published-closure-boot-smoke.mjs`; it must not silently grow into
the full cross-platform qualification suite.

### D5 — use bounded concurrency for npm operations

Candidate publication and registry re-download verification are independent
per package and run with bounded concurrency. A default of four concurrent npm
operations is proposed, configurable downward but never upward without a
measured registry-rate and failure-isolation check.

`latest` movement uses two waves:

1. runtime and library leaves move concurrently; then
2. install roots and user entry points move concurrently.

All intra-closure dependencies remain exact-version pinned, so a new root
cannot resolve a mixed internal dependency generation. The signed transition
journal records the pre- and post-vector around every mutation. Any partial
failure enters reverse-wave rollback and is not reported as success until the
complete prior vector is observed again. Ambiguous observation fails closed
and preserves the external lease for reconciliation.

The precise wave membership is generated from the staged package dependency
graph and checked against the publication inventory. It is not maintained as
an independent handwritten package list.

### D6 — make the release state machine resumable and idempotent

The conveyor and promoter share one durable operation record. Every external
effect has a stable operation id and transitions by compare-and-swap from one
closed state to the next. Retrying an already successful transition returns
its retained result; it does not reserve budget again or repeat an npm
mutation.

At minimum the record distinguishes:

`selected → built → staged → candidate-published → candidate-proven →
release-ready → lease-acquired → tags-moving → tags-stable → smoke-passed →
promoted-and-closed`, with terminal `abandoned` and `rolled-back` outcomes.

The runner resumes from the first incomplete state after reopening and
validating all prior receipts. Local checkout state is never the sole source
of progress. A dirty checkout, a different candidate revision, substituted
helper bytes, or an inconsistent npm vector refuses before a new effect.

External service unavailability is not converted into a failed candidate.
Bounded transient outcomes retain an explicit retryable state. Semantic proof
failure, byte drift, or an unreconciled partial registry transition remains a
hard refusal.

### D7 — shorten qualification without putting it back on the release path

The EAS workflow keeps the two independent native builds but reduces avoidable
serial work:

- build Linux and Darwin runtimes in parallel;
- assemble pass one once;
- mint Linux and Darwin store receipts in parallel from the same immutable
  pass-one artifact;
- restage once with both receipts;
- run Linux and Darwin staged/public-candidate proofs in parallel;
- retain one aggregate release-ready artifact;
- use prepared runner images for the pinned Rust, CMake, Ninja, browser, and
  system-package prerequisites; and
- cache native outputs by their semantic input closure rather than exact
  candidate SHA when the embedded build-identity contract permits reuse.

The last item is deliberately conditional. A runtime whose public identity
must name the exact candidate revision is rebuilt or re-attested according to
that identity contract; this RFC does not relabel old binary bytes as a new
source build.

Qualification has an initial target of 20 minutes p95 after runner allocation.
That target improves release freshness and conveyor capacity, but missing it
does not change the three-minute release-latency definition.

### D8 — keep the full post-`latest` audit asynchronous

After synchronous promotion closes, dispatch the existing full two-platform
`latest`-root proof as an audit. It validates the selector-specific behavior
against the live default vector and retains the historical evidence currently
carried by the post-promotion ledger.

The audit is not part of release latency and does not hold the publication
lease open. Its outcomes follow LLP 0189:

- green augments the release record;
- an unrelated infrastructure failure is retryable and ticketed if persistent;
- a claim-relevant behavioral red or selector mismatch opens a P0 filesystem
  ticket, marks the published record with the known red, and enters the
  existing factual-invalidity/withdrawal triage; and
- automatic rollback is not authorized by this RFC after the synchronous
  lease has closed.

The synchronous vector, install-tree, and boot smoke are therefore the
promotion gate. The asynchronous audit is defence in depth, not deferred
permission to publish unproven bytes.

### D9 — define latency evidence and SLOs

Every run emits monotonic duration fields for:

- queue wait;
- checkout and dependency provisioning;
- each native build;
- pass-one assembly;
- each store qualification;
- receipt-bearing restage;
- candidate publication;
- registry propagation and byte verification;
- each platform's full candidate proof;
- lease acquisition;
- each tag wave and rollback, if any;
- stable-vector observation;
- fresh-install boot smoke; and
- authority close.

The canonical release receipt reports both qualification latency and release
latency and labels retries by stable root cause. It also reports p50 and p95
over the latest 20 completed operations when enough samples exist.

The target service levels are:

| Measure | Target |
|---|---:|
| ready-candidate release latency | p95 ≤ 3 minutes |
| synchronous `latest` unavailability or mixed-vector window | p95 ≤ 60 seconds |
| qualification execution after runner allocation | p95 ≤ 20 minutes |
| resumable transient retry | no repeated completed phase |

Queue time is reported separately and never hidden inside execution time.
Until 20 samples exist, each receipt reports the individual durations without
claiming a percentile.

## Safety argument

The current ceremony proves two classes of fact:

1. **candidate-byte facts** — builds, seals, receipts, tarball identity,
   platform installability, scaffolding, and behavior; and
2. **default-selector facts** — `latest` names the intended complete vector,
   npm serves that vector through a fresh root install, and rollback authority
   remains available during mutation.

Candidate-byte facts are stable after npm accepts immutable versioned
tarballs. Proving them before moving `latest` is equivalent in subject and
stronger in timing: a broken candidate never becomes the default. Default-
selector facts do not exist until tags move, so D4 retains their synchronous
checks.

The proposal is unsafe if the pre-promotion proof selects different bytes from
the later default install. The ledger closes that gap by binding registry
digests, exact versions, candidate tag, and proof receipts, while the
post-move fresh install verifies that `latest` resolved precisely that bound
vector. Any mismatch refuses closure and rolls back.

## Operational latency budget

The three-minute target is allocated as follows:

| Critical-section phase | Budget |
|---|---:|
| receipt/preflight and lease | 20 s |
| two-wave `latest` mutation | 40 s |
| registry convergence and stable vector | 50 s |
| fresh install and minimal boot | 60 s |
| final reopen, ledger, and authority close | 10 s |
| contingency | 0–20 s |

These are budgets, not per-phase timeouts. A phase may borrow unused time from
another while the total remains within the SLO. Safety timeouts remain large
enough to reconcile or roll back rather than terminating midway merely to
protect the latency metric.

## Rollout

### Phase 0 — measure one unchanged ceremony

Add phase timing to the current qualified lane and run one real release without
changing proof placement. This establishes the steady-state baseline now that
0.1.18's eleven discovered ceremony defects are repaired.

Exit: one retained receipt accounts for queue, qualification, candidate
publication, tag movement, convergence, hosted proof, and close time without
unattributed gaps.

### Phase 1 — continuous release-ready candidate

Implement version reservation, candidate state, automatic affected-scope
selection, resumable EAS qualification, candidate-tag publication, byte
verification, and the release-ready pointer. Keep the existing promotion
ceremony unchanged.

Exit: the newest meaningful eligible `main` surface produces a validated
release-ready candidate without an operator manually chaining commands.

### Phase 2 — proof-placement cutover

Run the full GitHub-hosted consumer matrix against candidate npm bytes and add
its receipts to release-ready validation. Replace synchronous post-promotion
dispatch with the bounded vector/install/boot gate. Dispatch the former full
proof asynchronously after close.

Exit: mutation fixtures demonstrate that changing a tarball, tag resolution,
optional runtime selection, receipt, admin seal, or boot capability is caught
by at least one synchronous or pre-promotion gate at the intended phase.

### Phase 3 — concurrent registry operations

Introduce bounded candidate publication, download, and two-wave tag
concurrency. Exercise partial success, npm timeout, stale packument, rollback,
process crash, and exact retry in a controlled registry fixture before using
concurrency against public npm.

Exit: three consecutive real promotions complete without manual repair, no
phase executes twice after an injected restart, and the ready-candidate release
latency is at most five minutes for each run.

### Phase 4 — three-minute SLO and qualification economics

Adopt prepared runner images, semantic caches where identity permits, and
remaining measured critical-path improvements. Tighten the operational target
from five minutes to three only after at least 20 successful or safely rolled-
back real operations provide a p95.

Exit: measured p95 release latency is at most three minutes, and qualification
execution p95 after allocation is at most 20 minutes.

## Acceptance

1. The state machine can resume after process termination at every external-
   effect boundary without repeating a completed npm mutation or consuming a
   second authority budget.
2. A release request with no release-ready candidate refuses immediately and
   reports qualification state; it never silently begins a multi-hour
   synchronous release.
3. Both public-registry platform proofs are complete before authority
   acquisition.
4. The synchronous promotion installs through `latest` from an empty cache and
   proves the resolved tree equals the candidate ledger.
5. Partial tag movement rolls back to the exact signed prior vector, including
   crash/reopen cuts between every mutation wave.
6. Registry ambiguity never produces `promoted-and-closed`.
7. A newer unrelated `main` commit neither cancels nor invalidates a release-
   ready candidate.
8. A newer claim-relevant change is represented according to LLP 0189 without
   rewriting immutable candidate evidence.
9. Candidate publication, byte verification, and full platform proof may run
   concurrently where independent, but every receipt binds the same version,
   source revision, and tarball vector.
10. The asynchronous full `latest` audit is visible in the release record and
    cannot retroactively masquerade as synchronous evidence.
11. Timing receipts account for every phase and distinguish queueing,
    execution, propagation, retry, rollback, and operator idle time.
12. After rollout Phase 4, 20 consecutive completed operations establish a
    p95 ready-candidate release latency of at most three minutes without a
    weakened or deleted LLP 0041 assertion.

## Risks and counterweights

### Candidate versions accumulate

An immutable candidate that fails public proof consumes an npm version.
Counterweight: reserve one patch version at a time, promote qualified snapshots
promptly, record abandonment explicitly, and never recycle a version.

### Pre-promotion proof misses a `latest`-only defect

The candidate tag and `latest` exercise different selectors. Counterweight:
the synchronous fresh-cache `latest` install verifies the complete resolved
tree and boots it; the full two-platform `latest` audit still runs after close.

### Concurrent tag movement widens ambiguity

Concurrency reduces elapsed time but creates more simultaneous partial
effects. Counterweight: two dependency-derived waves, exact internal versions,
an external lease, per-mutation journaling, full-vector barriers, and tested
reverse-wave rollback.

### Continuous qualification wastes compute during bursts

`main` can advance every few seconds. Counterweight: affected-scope selection,
one active run, one coalesced successor, and no tip-of-`main` validity rule.
Qualification of an already valuable snapshot is allowed to finish.

### The three-minute number incentivizes hidden waiting

Counterweight: candidate selection time, queue time, qualification time,
operator idle time, and promotion time are separately retained. The release
SLO is never reported as end-to-end source-to-registry latency.

## Open questions

1. Should the conveyor reserve every next patch version automatically, or
   should an operator create the release slot while all later phases remain
   automatic?
2. Is four the right initial npm concurrency, or should the first public run
   begin at two and increase only from retained rate-limit evidence?
3. Which package roots belong in tag wave two? The implementation should derive
   the answer, but the user-visible roots may warrant an explicit checked
   classification.
4. Should a hard red from the asynchronous full `latest` audit receive a
   separately authorized automatic rollback policy? This RFC deliberately does
   not grant that authority.
5. Does the current build-identity contract permit semantic native artifact
   reuse across source revisions that do not affect runtime bytes, or must that
   remain exact-revision rebuild-only?

## Required updates if accepted

- Amend LLP 0041 to replace the synchronous full post-promotion proof with the
  candidate-proof plus narrow `latest` selector gate defined here.
- Amend LLP 0113 if the release-ready receipt or shortened lease transition
  changes publication-authority request, lifetime, or closure semantics.
- Register the release-ready receipt, version-slot record, and timing record in
  the relevant frozen-record and generated-artifact inventories.
- Update `.eas/workflows/qualified-package-staging.yml`, the publication and
  promotion scripts, their state-machine fixtures, and the operator guide.
- Add an affected-scope corpus audit for LLPs 0041, 0113, 0175, 0189, and this
  RFC before implementation lands.

## Status

Draft. This RFC records the proposed separation of continuous qualification
from minute-scale promotion. It does not alter the current qualified ceremony,
authorize candidate publication automation, or change publication-authority
semantics until accepted and implemented.
