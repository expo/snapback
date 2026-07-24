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
  service-authority + attempt-to-cursor cancellation signal — local arm
  landed 2026-07-24; open on the ServicePrincipal end-to-end witness and the
  Workerd arm
- `20260723-llp0076-boundedness.md` — 64 KiB buffer accounting, one in-flight
  pull per cursor, absolute wall-clock timers — local arm landed 2026-07-24;
  open on the Workerd arm only
- `20260723-llp0076-capability-honesty.md` — manifest maturity/`Missing` rows;
  capability admission resolved against the served instance manifest
- `20260723-llp0076-secret-scrubbing.md` — LLP 0036 opaque placement/redaction
  on `ctx.fetchStream`
- `20260723-llp0076-diagnostic-envelope.md` — preserve `_UNSUPPORTED` and the
  progress-rate code end-to-end; structured detail through the FFI/envelope

Decisions (forks to resolve, not code):

- `20260723-llp0076-semantics-decisions.md` — RESOLVED 2026-07-23 (all forks
  decided; LLP 0076 §Author decisions). Was: `ambiguous`'s residual meaning,
  which layer persists the certainty column, provider-idempotency trust, the
  progress-rate code rename, a monotonic clock/progress helper, and the gate-2
  hosted adapter

A concurrent session added an InstantDB-Streams prior-art subsection to the RFC
(no contract change); it does not affect these tickets.

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
