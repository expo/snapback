# LLP 0076 bounded streamed actions — gate-2 program (index)

**Status:** Closed (2026-07-26)
**Severity:** P2
**Systems:** Actions, Runtime, Outbound fetch, Durable mutations, Diagnostics, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 (authority; the Evidence-status/staged-work ledger is the single source of truth), LLP 0074 gate 2, LLP 0075 (frozen fixture), LLP 0036/0058/0059/0070, llp/reviews/0076-bounded-streamed-actions.{fable,codex}.md
**Marker:** program-index, llp-0076, streaming, super-refine-residue

Umbrella index for the work surfaced by the 6-round /llp-super-refine on LLP
0076 (Fable READY at round 6). The Spec is internally sound and its ledger is a
verified-accurate record of what is implemented versus staged; these tickets
carry the staged half. LLP 0076 stays **Draft** and LLP 0074 gate 2 stays open
until this program lands with per-bullet acceptance receipts on both the local
arm and LLP 0075's selected hosted target (`single-instance-container-vm.v1`,
not the Cloudflare narrow proof). Each ticket references its ledger item; the
Spec's ledger stays authoritative.

Core control-plane (the spec's late-effect fence depends on all of these; land
first):

- `20260723-llp0076-attempt-control-plane.md` — host-owned `StreamAttemptV1`,
  trusted terminalizer, single-runner lease; durable winner returned verbatim
  — RESOLVED 2026-07-24 (landed on the local arm; residue reassigned to the
  initiation-state and per-read-fence tickets, the Workerd-arm note, and the
  prospective LLP 0075 amendment; see `issues/closed/`)
- `20260723-llp0076-initiation-state.md` — the crash-safe write-ahead
  `initiationState` and host-derived effect-certainty column — RESOLVED
  2026-07-24 (landed on the local arm: `_snapback_stream_attempts` SQLite
  substrate, startup reconciler, decision-5 downgrade; see `issues/closed/`)

Boundedness, authority, and honesty:

- `20260723-llp0076-per-read-authority-fence.md` — post-read revalidation +
  service-authority + attempt-to-cursor cancellation signal — RESOLVED
  2026-07-24 (all legs witnessed, including the ServicePrincipal tier end
  to end; see `issues/closed/`)
- `20260723-llp0076-boundedness.md` — 64 KiB buffer accounting, one in-flight
  pull per cursor, absolute wall-clock timers — RESOLVED 2026-07-24 (local
  arm in full; Workerd leg with named structural residues in the ledger; see
  `issues/closed/`)
- `20260723-llp0076-capability-honesty.md` — manifest maturity/`Missing` rows;
  capability admission resolved against the served instance manifest —
  RESOLVED 2026-07-24 (admission on BOTH targets landed earlier; the final
  residue, the LLP 0058 maturity marker, was decided by Charlie 2026-07-24
  and implemented the same day: registry maturity dimension, additive
  `capabilityMaturity` manifest map, and acknowledgment-gated admission of
  experimental capabilities on both arms; see `issues/closed/`)
- `20260723-llp0076-secret-scrubbing.md` — LLP 0036 opaque placement/redaction
  on `ctx.fetchStream` — RESOLVED 2026-07-24 (local value-mode + hosted
  descriptor seam, both witnessed; retained-receipt scans reassigned; see
  `issues/closed/`)
- `20260723-llp0076-diagnostic-envelope.md` — preserve `_UNSUPPORTED` and the
  progress-rate code end-to-end; structured detail through the FFI/envelope
  — RESOLVED 2026-07-24 (landed on the local arm with an out-of-band
  trusted-restore; Workerd detail-discard reassigned; see `issues/closed/`)

Decisions (forks to resolve, not code):

- `20260723-llp0076-semantics-decisions.md` — RESOLVED 2026-07-23 (all forks
  decided; LLP 0076 §Author decisions). Was: `ambiguous`'s residual meaning,
  which layer persists the certainty column, provider-idempotency trust, the
  progress-rate code rename, a monotonic clock/progress helper, and the gate-2
  hosted adapter

A concurrent session added an InstantDB-Streams prior-art subsection to the RFC
(no contract change); it does not affect these tickets.

## Program status (2026-07-24, after the local-arm execution pass)

Eight commits on main (ef6458e9 baseline, 6cd8898d control plane, dd26faaa
initiationState, b66f46e1 per-read fence, c69c368e boundedness, cf3d77d9
diagnostic envelope, edaac601 secret scrubbing, 065484e6 capability
admission). Closed: attempt-control-plane, initiation-state,
diagnostic-envelope (plus the pre-resolved semantics decisions). Open with
the local arm landed: per-read-authority-fence (ServicePrincipal end-to-end
witness), boundedness (Workerd arm), secret-scrubbing (hosted descriptor
seam + retained-receipt scans), capability-honesty (maturity-marker design —
an author/LLP 0058 choice — + Workerd arm). Evidence baseline at 065484e6:
`cargo test --lib` 1140, `action_stream_envelope_v0` 5/5, codegen
authoring-validation pass, capability_v0 3/3, LLP 0075 local-streaming
instrument PASS 6/6, ref-check clean, check-generated-artifacts clean.

Update 2026-07-24 (gate-2 remainder pass): protocol amendment v0.5 landed —
the fixture adopts the StreamAttemptV1 control plane with the read-only
certainty mirror, the instrument runs 7/7 (new certainty-mirror check), the
decision-5 downgrade is recorded, and the cross-user write expectations
track LLP 0065's Accepted anti-probing `SNAPBACK_ROW_NOT_FOUND` posture (a
lagging expectation this pass corrected; the regression predated it on
origin/main). Per-bullet acceptance receipts:
`demos/competitive-checkpoint/acceptance/llp0076-acceptance-receipts.v1.json`
(retained receipts scanned clean of fixture secrets). Guide coverage landed:
`guide/backend/streamed-actions.md` + the `backend.streamed-actions` partial
capability row + the resolving repair anchor (ENG-25423). Gate 2 now waits
on: the author's maturity-marker decision, and the
`single-instance-container-vm.v1` hosted receipt (which also carries the
durable-row secret scans).

Update 2026-07-24 (final ticket pass): six of seven implementation tickets
are RESOLVED; capability-honesty remains open solely as the tracking handle
for one undecided author question (the LLP 0058 proposed/experimental
maturity marker for a Draft-authority capability). What gate 2 still needs
beyond that author decision: the prospective
LLP 0075 amendment reconciling the frozen fixture's authored pattern with
`StreamAttemptV1` tokens and the certainty mirror, per-bullet acceptance
receipts, and the `single-instance-container-vm.v1` hosted receipt
(decision 7). The guide gap for the `#stream-a-response` repair anchor is
filed as ENG-25423.

Update 2026-07-24 (author-decision implementation pass): ALL SEVEN
implementation tickets are now RESOLVED. Charlie's two 2026-07-24
decisions are implemented: (1) the LLP 0058 capability-maturity amendment
(registry `proposed`/`experimental`/`stable` dimension; served
`capabilityMaturity` map; acknowledgment-gated admission of experimental
capabilities on both arms; `bounded_response_stream_v1` experimental until
LLP 0076 is Accepted) — capability-honesty closes and the RFC's
capability-overclaim ledger row closes; (2) the first
`single-instance-container-vm.v1` remote-drill provider is pinned by
protocol amendment v0.6 (Fly.io, region sjc, Tigris object store,
`FLY_API_TOKEN` credential backend — credential health pending, no live
drill target claimed) with Charlie Cheever recorded as the long-lived
program owner, narrowing `20260723-llp0075-program-ownership.md` to an
owner-confirmation residue. Evidence baseline this pass: `cargo test
--lib` 1180, `action_stream_envelope_v0` 6/6 (new unacknowledged-negative),
capability_v0 3/3, auth_artifacts_v1 3/3, codegen suite 17/17, egress
acceptance 29/29 (new served-maturity check), LLP 0075 local-streaming
instrument 7/7, check-generated-artifacts clean, guide check ok. Gate 2 now
waits on exactly: the `single-instance-container-vm.v1` hosted receipt
(provider pinned, credentials not yet provisioned) and LLP 0076 acceptance
itself.

Update 2026-07-25 (hosted receipt pass): the
`single-instance-container-vm.v1` hosted receipt EXISTS. The Fly.io drill
target pinned by amendment v0.6 was provisioned and drilled (protocol
amendment v0.7 pins app `snapback-drill`, machine `819701c927ee68`, sjc,
image, Tigris bucket, flyctl and instrument digests): remote instrument 7/7
against the served origin, durable-row secret scan PASS over post-run
on-machine dumps, Tigris backup byte-exact read-back PASS, and the
hosted-auth refusal witness (`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` — a
refusal, not a capability; the LLP 0077 gate stays open). Receipts under
`demos/competitive-checkpoint/acceptance/results/`; every receipt records
the `SNAPBACK_PROFILE=test` + `--allow-insecure-dev-auth` posture behind
Fly's TLS edge. The drill exposed and the landing fixed: the serve path
never installing `--allow-insecure-dev-auth` into request-path state
(src/cli.rs + regression test), and the fixture streamReply surfacing the
durable-cancel-vs-progress `SNAPBACK_MUTATION_CONFLICT` race as `failed`
(reconciled under amendment v0.7; local twin re-witnessed 7/7). Gate 2 now
waits on exactly: LLP 0076 acceptance itself (plus the authority's own
staged-work ledger items).

Update 2026-07-25 (acceptance — PROGRAM COMPLETE): Charlie Cheever ratified
LLP 0076 as **Accepted** (session-directed), and the registry flip landed as
the acceptance act: `bounded_response_stream_v1` is `stable` in
src/manifest.rs, codegen's mirror set, the committed schemas variants, the
served Workerd manifest, and every regenerated outbound-enabled demo
artifact; pre-promotion acknowledgments survive as witnessed no-ops, the
former unacknowledged-refusal integration test became the promotion
regression, and the experimental refusal path stays witnessed via
`relational_query_v1`. Gate 2 is closed. The RFC's recorded residues (OQ
6-7, the Workerd arm's narrower witness) remain open in the RFC's own
ledger as scoped refinements, not gate items — this program index tracks
nothing further.

## Workerd arm re-land (2026-07-24)

The stranded Workerd/Cloudflare streaming arm is re-landed on main. Method:
the streaming-slice diffs were copied read-only out of the primary
checkout's uncommitted working tree (base b77f9c92; the six touched files
had zero drift against main, so the hunks applied cleanly) and then adapted
to the landed contract — nothing was committed from, modified in, or
cleaned out of the primary checkout. Entanglement resolution: only
`cloudflare/src/{coordinator,host-ops}.js`, the stream probes in
`cloudflare/app/all-aboard.app.js`, and the three test files were taken;
the primary's harness/envelope diffs were already superseded by this
program's landed bridge, its generated-manifest diffs were reproduced
honestly rather than copied (the stranded runtime fact overclaimed
idle/wall/progress/watchdog/settlement evidence), and its LLP 0077 /
deploy-plane changes were left behind untouched. Deployment identities were
regenerated (`cloudflare/scripts/generate-deployment-identity.mjs`) because
the app and manifest digests changed. Adaptations beyond the port:
decision-4 rename, decision-5 safe-method-only downgrade, decision-6
`elapsedMs`/`deltaMs`, pre/post-pull abandonment revalidation with
late-byte discard, one-in-flight-pull-per-cursor, invocation-wide
carry-over accounting with a 64 KiB refusal path, fail-closed attempt-token
refusal (no control plane on this target), the LLP 0036 descriptor
placement seam with the authored-URL rule, and six new Miniflare witnesses.
Evidence: cloudflare local gate 21/21 suites, egress acceptance 27/27
checks (ten stream checks). Ticket effects: boundedness and
secret-scrubbing move to `issues/closed/`; per-read-authority-fence narrows
to the single ServicePrincipal-witness item; capability-honesty narrows to
the maturity marker plus the Workerd `ensureApp` admission leg.

## Baseline landing (2026-07-23, this worktree)

Program-start discovery: the reader-surface baseline the RFC ledger describes
as "witnessed" existed on **no** ref — it lived only as uncommitted working-tree
state in the primary checkout (entangled there with unrelated LLP 0077 and
deploy-plane work in the same files). The tickets all patch that baseline, so
the program's first landing ports the streaming-only hunks of the local arm
onto current main: runtime DTOs + host-op dispatch + envelope codes, the
detached-host reader implementation and rate fence, reviewed HTTP statuses,
the instance-live capability predicate + regenerated committed manifests +
codegen admission requirement, the `ctx.fetchStream` harness bridge, and the
decision-4 progress-rate rename with the fixture handler updated in the same
change (protocol amendment v0.4 pre-authorizes it). Witness: the pinned LLP
0075 local-streaming instrument passes 6/6 against this baseline. The
Workerd/Cloudflare arm of the stranded baseline is **not** yet landed; tickets
whose Done-when says "both hosts" cannot close until it is (tracked per
ticket). A guide gap also surfaced: stream diagnostics point at
`guide/backend/actions-and-fetch#stream-a-response`, which does not exist yet.

## Resolution (2026-07-26)

Closed from the program's own acceptance record: LLP 0076 is Accepted,
`bounded_response_stream_v1` is stable, the local and hosted instruments are
green, and gate 2 is closed. The RFC's explicitly scoped OQ 6–7 and narrower
Workerd evidence remain in the RFC ledger; they are refinements rather than
unfinished items in this umbrella.
