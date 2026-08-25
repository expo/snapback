# Queued mutations lie at the call site: offline settlement rejects as an error; queued dispatch resolves indistinguishably from commit

**Status:** Resolved
**Severity:** P2 (correctness of the client contract; convergent evidence from two mutually-blind builder sessions)
**Systems:** snapback-react, Durable outbox, Offline, Diagnostics
**Date:** 2026-08-09
**Related:** LLP 0107 (optimistic lifecycle), LLP 0043 (offline
retention/outbox), LLP 0208 (pilot evidence; carries the follow-on
drain/observability design as its G1),
`issues/20260808-first-class-react-optimistic-create.md` (adjacent),
`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` (adjacent),
`issues/20260825-inspect-exposes-ledger-incarnation.md` (open reset-incarnation
gap)

## Problem

Two facets of the same contract defect — the durable outbox's behavior
is excellent, but its settlement signal misrepresents what happened:

**Facet A — queued-but-rejected (React arm).** Call a mutation through
`useSnapbackMutation` while offline: the intent IS queued durably and
DOES replay on reconnect — but the settlement promise **rejects** with
`SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED` when the mutation declares a
result contract the client can't install locally. Callers that treat
rejection as failure (the natural reading) roll back optimistic UI for
a write that then settles successfully — the UI lies in the pessimistic
direction.

**Facet B — queued-as-success (call-site ambiguity).** A transient
connectivity-classified refusal silently queues the mutation and
`mutate()` **resolves** `{queued: true}` — the same resolved promise
shape as a commit unless the caller inspects the flag. Every subsequent
mutation queues behind the wedged head. In the pilot this made a
settings screen "randomly broken under load" for ~2 hours of suite
flakes with zero diagnostics; the eventual lesson was "every screen
needs outbox awareness," which is the wrong place for that burden.

Evidence (LLP 0201 P2 pilot): facet B was the builder session's worst
debugging stretch (M6, holistic-cited moment); facet A was
**independently rediscovered blind** by the M7 fresh-engineer session,
whose rollback-on-error erased a poll-vote pending marker that settled
1s after reconnect. The original builder had implicitly absorbed the
same lesson (fire-and-forget text sends). Two mutually-blind sessions,
same bug shape — the strongest convergence signal the pilot produced.

## Done when

- A durably-queued dispatch never surfaces as an ordinary error: facet
  A's settlement either resolves `{queued: true}` (consistent with the
  imperative client) or rejects with a **distinct, documented
  diagnostic class** that the React hook docs call out at the point of
  use. Open ruling for the fixer: resolving is the truthful contract
  but breaking for callers that await settlement semantics; a distinct
  rejection class is non-breaking but still error-shaped. Record the
  choice and rationale here.
- The queued outcome is unmistakable at the call site in dev: queueing
  (and a queue head wedged past a threshold) emits a dev-mode console
  warning naming the queued mutation.
- Docs: the mutation hook page and offline page state the queue
  semantics and show the correct handling pattern (keep pending UI;
  roll back only on server refusals with an `appCode`).
- Out of scope here (LLP 0208 G1 carries it): the app-wide default
  drain and the queue-state observability hook.

## Resolution

Resolved 2026-08-09.

**Ruling: option (b), a distinct documented rejection class.** A durably
queued React dispatch rejects with the exported `SnapbackQueuedMutationError`
and stable code `SNAPBACK_REACT_MUTATION_QUEUED`, carrying `queued: true`, the
mutation name, `clientMutationId`, and sequence. It has no `appCode` and is a
pending-settlement signal, not a server refusal. The hook detects the queued
marker before result-contract validation, so it can no longer surface
`SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED` for a write the outbox accepted.

The rationale is type and migration honesty: `useSnapbackMutation` promises the
generated `FunctionResult<Ref>` on its resolved lane. Resolving an unrelated
`{queued:true}` marker would silently widen that contract for every caller and
make an awaited non-result look like an ordinary commit. Keeping rejection
shape preserves existing control flow while the exported class/code makes the
pending outcome machine-distinct. Documentation therefore teaches the safe
rule at the hook call site: keep pending UI for the queued class and roll back
only for a declared server refusal carrying `appCode`.

In a positively identified development build, each queued dispatch now emits
`SNAPBACK_REACT_MUTATION_QUEUED` naming the mutation and durable identity. A
provider-owned 30-second timer emits
`SNAPBACK_REACT_MUTATION_QUEUE_WEDGED` when pending work still blocks that
mutation and no replay/terminal diagnostic has advanced its identity. The
timer is cleared with the provider. It is diagnostic-only: the LLP 0208 G1
default drain and queue-state observability hook remain out of scope.

Coverage landed in the existing React optimistic/offline suites for the
distinct facet-A settlement, immediate queued warning, and blocked-head
warning. The React mutation page and offline page both record the imperative
versus React settlement shapes and the keep-pending/appCode-only rollback
pattern.

Resolution brought current through 2026-08-25. LLP 0218's follow-on work now
also supplies the headless dispatch union, a client-owned default drain, and
the read-only `outboxStatus()`, `mutationStatus()`, `settledMutations()`, and
optimistic-projection observation paths. Those reads no longer run whole-queue
custody reconciliation or otherwise mutate durable disposition. Replay runs
the scoped per-record custody transaction at its dispatch cut, re-reads the
record afterward, and applies the persisted enqueue-target fence before POST.
A target-mismatch/missing pause is treated as a stable drain level so its own
bookkeeping notifications cannot hot-loop the default drain. Target-bound
status reports the persisted enqueue target, while target-mismatched records
are excluded from optimistic and recovered-settlement projections.

One reset boundary remains deliberately open: the client/store plumbing can
compare a settlement-ledger incarnation once `/inspect` supplies it, but the
server does not yet expose that fact. The resulting reset-incarnation gap is
not resolved by this ticket and remains tracked in
`issues/20260825-inspect-exposes-ledger-incarnation.md`.
