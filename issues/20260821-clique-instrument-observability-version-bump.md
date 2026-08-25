# Ship the coordinated Clique instrument-observability version bump

**Status:** Open
**Opened:** 2026-08-21
**Systems:** Benchmarks, Clique UI kit, Choreography, Run records, Agent
experience, Testing
**Governing:** LLP 0281 W2/W3/W5-W8; LLP 0201; LLP 0295 W6
**Related:** `issues/20260815-clique-choreography-typing-observation-boundary.md`;
`issues/20260809-per-milestone-token-metering.md`;
`issues/20260820-matrix-lane-skill-routing-context-budget.md`

## Problem

The frozen instrument still cannot drive or observe media composition,
semantic receipt transitions, sender-avatar identity, or membership lifecycle.
It also permits late suite-status linkage failures, broad text selectors,
shared-page poisoning, and repeated rediscovery of layout assumptions. These
defects create correction loops and can steer product design toward fixing the
measurement artifact.

LLP 0281 intentionally batches the observable UI/driver changes into one
versioned kit and choreography migration so the freeze cost is paid once.

## Scope

- Add structural media picker/attachment vocabulary and two-client media
  delivery checks.
- Add semantic receipt, avatar-identity, group aggregate, and member
  add/remove/promote/leave vocabulary and drivers.
- Require first-line outcome classification: application, Snapback/platform,
  external provider/setup, or instrument.
- Refuse runner startup when required suite-status linkage or setup identity is
  absent.
- Replace text-regex matches with structural selectors where available and
  isolate assertion retries so one poisoned route/page does not manufacture
  unrelated timeouts.
- Make profile-navigation and heading/layout obligations explicit in the kit
  or choreography contract.
- Record qualified-binary versus wrapper identity, packed/prepack closure,
  declared toolchain, host load, and API interruption as structured setup
  fields.
- Generate the mechanical run/diary aggregates from one structured record
  while retaining qualitative narrative separately.

The typing-boundary ticket remains its own corruption-class repair; this bump
depends on its disposition and carries its migrated observation boundary.
Per-milestone token metering and context routing remain their own tickets but
must be schema-compatible with this version.

## Implementation update — 2026-08-23 (LLP 0295 R2 start blockers)

The R2-gating observability slice is implemented in this change. No measured
R2 cell has started:

- The social-messenger extension remains `extensionVersion: 2` and gains
  optional additive, hash-linked per-milestone fields for the closed semantic
  action taxonomy/dispositions, failure-to-recovery carrier/attribution/outcome
  projections, restart/reseed counts, suite/choreography assertion attempts and
  wait wall, host-load samples/breaches, and API-interruption windows. The
  validator resolves every retained sidecar, verifies its digest and typed
  event shape, and recomputes the action/episode join plus all six projections.
  Every `0.3.3-m8` attempted milestone must carry a claimed block or an
  explicit non-claim; semantic-action/recovery non-claims automatically make
  the correction-action target ineligible.
- `suiteStatusLinkage` hash-binds the input plus retained suite receipts.
  Choreography now refuses a missing input or a missing selected-segment entry
  before credentials, Playwright import, receipt creation, or browser startup,
  stats and hashes every passing receipt then. The meter stats and re-hashes
  the same files at record-write time; the record validator repeats that
  verification and rejects `pass:true` with no receipt.
- The instrument is bumped to `social-messenger@0.3.3-m8` / choreography
  `0.3.3-m8`; UI remains `0.3.1-m8` and schema remains `0.3.0-m8`. The frozen
  manifest now pins both record schemas, their validator, and the extended W2
  metering directory so the coordinated bump cannot discard landed metering.
- The migration note and static choreography-to-`CONTRACT.md` vocabulary check
  ship with the bump. Old version-2 records and retained `0.3.2-m8` metering
  receipts remain valid.

Major-fix verification at the implementation boundary: metering `20/20`, lane
setup/schema `10/10`, quoted-reply UI `1/1`, choreography calibration green
including missing/partial/dangling startup refusals, typed wait observations,
receipt digests, M1/M8 green, and the deliberate M8 failure path. The frozen
twelve-cell R2 `validate-plan.mjs` is green from its preregistered
`sbs/0295-r2-rerun` worktree. `./ref-check --verbose` is green with 0 errors
and 0 unchecked references.

### Round 3 review closure — 2026-08-23

The first implementation review exposed four fail-closed gaps; this follow-up
closes them without claiming the broader LLP 0281 scope:

- The production R2 lane controller now consumes the frozen harness config,
  refuses any plan pin other than `social-messenger@0.3.3-m8`, constructs the
  observation harness, samples host load for every attempted milestone, wraps
  lifecycle/API operations at their execution points, records actual suite
  settlement waits, hash-registers all producer streams, and invokes the
  record writer.
- Browser-wait custody is owner-scoped. Suite and choreography have independent
  claims/non-claims; choreography reports only locator/predicate/page-event
  settlement intervals and can no longer turn whole assertion-attempt wall
  into a complete browser-wait claim.
- Current records require an explicit `instrumentVersion` binding plus the
  exact orientation/protocol markers. Omitting or downgrading the marker fails
  the current/R2 path instead of selecting legacy validation.
- Every retained `0.3.3-m8` receipt line is validated against
  `receipts.schema.json` both when the meter writes and when the final record
  is validated. A recomputed outer digest cannot bless fabricated receipt
  JSON. Failed or aborted attempts may retain zero or one segment summary;
  green still requires exactly one bound, matching summary.

Round 3 verification: the exact tooling battery is green `39/39`; the real
Playwright choreography calibration passes; the preregistered twelve-cell R2
`validate-plan.mjs` remains green and prepared-blocked with no cell started;
and `./ref-check --verbose` reports 0 errors and 0 unchecked references.

### Round 4 runnable-branch closure — 2026-08-23

The preregistered R2 plan and the 0.3.3-m8 instrument now live on one branch.
Every cell carries a concrete `lane-controller.mjs --driver
r2-cell-driver.mjs` command. `validate-plan.mjs` resolves all twelve commands,
imports the production hooks, checks each Codex/Grok/Claude CLI path, and asks
the controller to resolve the cell against the external 0.3.3-m8 pin.

The controller now makes all non-load custody claims explicit, requires real
green suite/choreography attempts and native semantic actions, and always
writes both `metering.json` and a composed, semantically validated
`record.json`. Its finally path retains an aborted attempted milestone plus
`not-run` successors when a driver throws before choreography. The two-minute
no-model dry-run exercises the same typed observations, receipts, manifest,
metering join, complete record, and checked validator; a focused forced-crash
probe separately validates the failure-shaped record path.

`instrumentVersion` is now in the unconditional extension required set. A
test removes both current markers and downgrades orientation together; it is
rejected for the missing version instead of entering legacy validation.

Round 4 verification: the exact tooling battery is green `39/39`; the pinned
Node 24 Playwright choreography calibration passes with 8 observed assertions,
missing-linkage startup refusal, M1/M8 green, and its deliberate M8 failure
rejected. `validate-plan.mjs` verifies the digest-bound instrument and all 12
accepted production commands. The default no-model dry cell retained 120.094
seconds of authoring wall and validated M1/M2/M3 green; the forced M1
pre-choreography failure separately validated an `aborted` M1 plus `not-run`
M2/M3. `./ref-check --verbose` reports 0 errors and 0 unchecked references.

This ticket remains open: the broader LLP 0281 media/receipt/avatar/membership,
selector-isolation/layout, setup-identity, and generated-report acceptance is
outside this R2 start-blocking slice and is not claimed complete here.

## Implementation update — 2026-08-25 (E4 instrument remainder)

This lane preserves the 2026-08-23 delivery rather than reimplementing it. That
earlier delivery already supplied the additive D0.6 semantic-action/recovery/
restart/suite-wait/host-load/API-interruption observations, hash-bound
suite-status custody and early linkage refusal, `social-messenger@0.3.3-m8` /
choreography `0.3.3-m8`, the migration/static-vocabulary checks, the production
controller's exact plan-pin refusal, owner-scoped waits, current-record markers,
receipt validation, and record lifecycle.

E4 implements the remaining instrument surfaces within LLP 0307's ruled scope:

- The coordinated kit is UI `0.3.2-m8`. Composer attachment/media semantics,
  exact actor/chat identity, sent/delivered/read/pending receipt states, group
  aggregate and add/promote/remove/leave controls, removed-member history/live
  cutoff, explicit profile heading/feed navigation, and poll option/tally/
  pending state are frozen in `CONTRACT.md` and source-tested.
- M2 image/video composition and two-client delivery, M3 sender/avatar/receipt/
  group-membership checks, and a fresh-session M7 live plus offline-reconcile
  poll segment are implemented. `all` remains exactly one continuous
  M1–M6/M8 session; M7 refuses a mixed invocation. No session-shape change or
  M7 handoff self-containment enters this bump.
- The typing measurement now records synthetic typing-action wall separately;
  render and expiry clocks start immediately before the final keystroke action.
  Broad text-regex selectors were removed where structural identity exists.
  Failed best-of-three attempts restore online/base-route state and retry only
  their owning assertion; a focused test proves the earlier assertion is not
  rerun.
- Every startup/final red uses the bounded application/platform/setup/instrument
  taxonomy on its first outcome line. Failed choreography prints one compact
  structured miss; raw receipt JSONL stays on disk. Missing suite status or
  setup identity refuses before Playwright, browser, receipt, or observation
  creation.
- `social-messenger.setup-identity.v1` records separate hash-verified qualified
  binary and wrapper claims/nonclaims, backend version, workspace/hosted/packed
  package closure, verified prepack closure for packed artifacts, declared
  Node/Bun/npm/Playwright/browser toolchain (including an exact loaded
  Playwright-version match), and host identity. Choreography
  summaries embed both the setup and its source digest; the run driver copies
  one consistent setup into the structured run record.
- Detached scale observation consumes only a bounded atomically replaced status
  record and has no process-control or raw-log-tail authority. A second helper
  generates run and diary mechanical blocks from one source-record digest while
  leaving qualitative diary narrative separate.
- The frozen manifest now carries the UI, choreography, record-extension,
  metering, and observability closure. No new `SNAPBACK_*` diagnostic code was
  introduced.

### E4 independent-review fix round — 2026-08-25

The dual-family review found four material defects in that first E4 cut. The
fix round moves the instrument and choreography to `0.3.4-m8` while leaving UI
at `0.3.2-m8`:

- M7's three retained live attempts now use Alice/option-A,
  Alice/option-B, and Bob/option-A; the offline assertion uses Bob/option-B.
  Every assertion therefore starts from an unused user/option pair even though
  retry resets preserve backend state, matching the brief's idempotent
  set-state semantics.
- Typing receipts, assertion metadata, M3 summaries, and run records stamp
  observation boundary `v2`. Schema and semantic validation reject an absent
  or mismatched current stamp and reject v2 on retained `0.3.3-m8` records;
  pre-bump records remain valid as implicit v1 only under their own pin.
- Removed-member live cutoff no longer relies on a 500 ms sleep. After the
  post-removal group message, a subsequent direct-message marker must reach a
  second Dave page under the ordinary assertion timeout before the still-open
  removed-group page is inspected for leakage and retained history.
- Required `dm-live-messages` is separate again. Avatar identity is checked
  only if the app mounts the kit's conditional `sm-convo-sender-avatar` node,
  so the default no-avatar 1:1 layout stays conforming. `CONTRACT.md` also now
  identifies `sm-compose-file` as an optional app-shell-owned web input and
  the RN kit's `sm-compose-attach` as the sufficient chooser fallback.

The self-test fixture grows an actual two-option, one-vote-per-user,
changeable/idempotent poll backend and runs fresh M7 with application state
retained across all attempts. A static branch guard prevents live DM and
conditional avatar proof from being merged again; full M3 browser calibration
still belongs to the clean control lane below.

Focused verification is green: UI source tests `2/2` plus TypeScript; startup,
setup identity, retry isolation, and M7 receipt-schema tests `8/8`;
observability tests `3/3`; lane setup/schema/manifest/plan pin `11/11`; and the
focused current metering/linkage paths `2/2`. On a browser-capable fleet host,
the instrument self-test passes with 10 observed assertions, missing
suite/setup refusals, M1/M7/M8 green, retained idempotent vote state, the
DM/avatar split guard, and one bounded classified deliberate-failure miss.
`./ref-check --verbose` reports 0 errors and 0 unchecked references.

This ticket remains **Open**. The implementation checklist is present, but the
acceptance evidence is not complete: a clean control lane still must exercise
the new M2 media, M3 typing/avatar/receipt/group-lifecycle, and fresh M7 poll
paths end to end; force each non-setup outcome class and a timing-sensitive
retry on that lane; and retain the LLP 0281 W9 two-browser/native-host proofs.
Those proofs, rather than code presence alone, are the condition for closure.

## Acceptance

One versioned kit/choreography release carries a migration note and static
vocabulary check. A clean control lane can drive every newly required behavior,
classify every forced failure on the first line, and retry one failed assertion
without rerunning unaffected checks. Missing setup/linkage refuses before the
authoring clock. LLP 0281's recurring structural skips are either required and
observable or explicitly retained as scoped nonclaims—never silent optional
folklore.

## Capstone real-lane evidence (2026-08-25)

The `2026-08-25-clique-pair-published-0127-capstone` run exercised the
`0.3.4-m8` instrument end-to-end on real lanes: typing boundary v2 stamped
through receipts in both arms; the standalone fresh-session M7 choreography
green (Explicit); the strengthened removed-member cutoff assertion firing
on a real delivery leak (Familiar,
`issues/20260825-familiar-removed-member-live-cutoff-leak.md`); and
green/aborted/blocked outcome classes exercised naturally. Remaining for
closure: the dedicated clean control lane with forced non-setup outcome
classes and a timing-sensitive retry, and the LLP 0281 W9
two-browser/native-host proofs.
