# LLP 0076 bounded streamed actions — gate-2 program (index)

**Status:** Open
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
  admission landed on BOTH targets 2026-07-24 (local loaders + Workerd
  function-resolution seam, positive and negative witnesses); open SOLELY
  as the tracking handle for the author's LLP 0058 maturity-marker
  decision, which is deliberately not made on his behalf
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
