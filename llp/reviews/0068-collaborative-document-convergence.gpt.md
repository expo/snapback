**Reviewer family:** GPT (author-side pass; not independent)
**Provider / runtime:** OpenAI Codex API agent
**Date:** 2026-07-26
**Redacted:** no
**Method:** manual

# Review of LLP 0068: Collaborative document convergence

This is an author-side critical pass over the committed Draft at Snapback
`e87a630907a86494b56f7280ee2da0322ca295de`. Because the draft is attributed
to Charlie Cheever / Codex, this review does **not** count as the independent
cross-family review appropriate for a load-bearing replication protocol.

## Overall assessment

The narrow typed-document carve-out is a good boundary. The proposal correctly
keeps ordinary Snapback rows server-authoritative, keeps presence ephemeral,
and makes support depend on executable cross-platform convergence and
authorization witnesses rather than the RFC's existence.

The current text is not yet implementable as a deterministic wire/storage
protocol. Two identity problems are blockers: batched inserts do not define how
operation and atom counters share one sequence, and compaction does not define
how an offline operation whose anchor was compacted can ever become admissible
after resnapshot. Block moves also need a complete delete/move/cycle rule.
Those are protocol semantics, not implementation details.

## Strengths

- `## Why a separate model` preserves LLP 0008/0043's ordinary
  server-authoritative replay contract instead of generalizing CRDT semantics
  across the database.
- `## Authorization and sharing` rechecks current authority for every replay
  and correctly forbids replay under a replacement principal.
- `## Portability and target claims` has an honest capability ladder and does
  not equate a server-only implementation with Parity.
- `## Acceptance` includes duplication, opposite delivery order, restart,
  partial delivery, authorization revocation, compaction races, restore, and
  cross-platform corpus execution. That is substantially stronger than a
  happy-path editor demo.
- `## Build vs integrate` names the Yjs alternative and the real cost of a
  bespoke reducer rather than treating a custom CRDT as free.

## Concerns

### Critical — atom and operation identity cannot both occupy the described counter sequence

`## Identity and clocks` says `atomId` and `operationId` use the same
`(authorityInstanceId, counter)` sequence. `## Text and marks` then says one
insert operation may batch adjacent atoms and canonicalization expands the
batch into consecutive atom identities. The protocol does not say whether a
batch of N atoms consumes N counters, which counter is the operation id, what
the next non-insert operation's counter is, or whether a frontier acknowledges
operations, atom identities, or both.

This ambiguity affects uniqueness, dependency frontiers, idempotence,
settlement, and canonical hashing. Resolve it before acceptance with one of:

1. separate typed identity domains and counters for operations and atoms;
2. one sequence where every operation declares and atomically reserves an
   exact counter range, with canonical rules for its operation id and next
   counter; or
3. atom ids derived from `(operationId, offset)` while frontiers count only
   operations.

The third shape is the smallest and makes batch canonicalization explicit.
Golden vectors must cover one- and multi-scalar inserts followed by non-insert
operations, duplicate batches, gaps, and payload substitution.

### Critical — compaction has no replay rule for operations anchored to removed identities

`## History, comments, and compaction` permits replacing an operation prefix
with a snapshot. `## Offline replay and resynchronization` requires preserving
the original operation ids and payloads. An offline insert may therefore name
an atom or placement that the server compacted while the client was away.
Resnapshot does not change that immutable anchor, and the current
`compacted-but-unknown` refusal gives no operation-preserving repair.

The protocol must choose and witness one strategy:

- snapshots retain a bounded anchor skeleton/redirection map sufficient to
  resolve every still-admissible identity;
- client retention leases guarantee that no anchor reachable by a valid
  outstanding operation is compacted, with a precise expiry/quarantine rule;
  or
- a deterministic, receipt-bearing rebase creates a new operation and
  explicitly retires the old one.

The current text gestures at the first two without proving either is
sufficient. Add a fixture where a client edits from a pre-compaction snapshot,
the named predecessor is tombstoned and compacted, and the client later
reconnects.

### Major — block move, delete, and placement cycles are underspecified

The winning-placement rule chooses the greatest move operation id, but the RFC
does not define:

- delete concurrent with move (delete-wins, move-wins, or a new incarnation);
- a move anchored after a concurrently deleted or moved block;
- concurrent moves that create an ordering cycle, such as A-after-B and
  B-after-A; or
- whether a losing placement remains a legal future anchor.

Define a total materialization algorithm with deterministic cycle breaking and
fixtures for all four cases. Otherwise equal operation sets can still diverge
because traversal order is not fully specified.

### Major — canonical byte order and hash input are not pinned

Several decisions use "unsigned byte ordering" of tuple ids, but the RFC does
not define the tuple encoding, string normalization, integer width/endian,
schema-version framing, map-key ordering, or domain separation between
operation, snapshot, and frontier hashes. "Canonical JSON" is not enough unless
the exact profile is named and binary/image/reference fields are included.

Add a versioned canonical encoding section and cross-language golden bytes,
including non-ASCII authority ids, maximum counters, unknown-field refusal,
and distinct objects that would collide without length/domain framing.

### Major — mark endpoints and text editing need bias and grapheme semantics

Marks name atom endpoints, but the RFC does not state whether endpoints are
inclusive, their left/right affinity, what happens when either endpoint is
deleted, or how concurrent insertions at a boundary inherit a mark. One
Unicode scalar per atom also means a user-visible grapheme can span multiple
atoms. Reducer convergence does not by itself yield deterministic editor
selection/deletion behavior.

Specify canonical endpoint bias and materialization rules, and require adapter
fixtures for combining marks, emoji ZWJ sequences, regional indicators, and
concurrent insertion at both mark boundaries.

### Major — the bespoke/Yjs decision must close before acceptance

Open question 5 changes the wire/storage truth, authorization granularity,
editor integration, compaction, and the implementation program. It is too
architectural to leave open in an Accepted RFC. The Yjs critique should also
be narrowed: opaque updates preclude the RFC's proposed atom-level admission,
but a room-authorized service can still apply an update and validate bounded
materialized state. That may be insufficient for Snapback's desired audit
model, but it is not literally "accept the blob."

Choose the canonical model, Yjs, or an adapter architecture before acceptance,
then make the rejected alternatives and consequences explicit.

### Moderate — atomic settlement wording crosses a client/server boundary

`## Storage and transactions` says operation admission and "outbox settlement"
commit in one storage transaction. The server can atomically persist an
operation and a settlement record; it cannot atomically clear a client outbox.
State the server transaction and the client receipt/clear protocol separately,
including ambiguous-response recovery.

### Moderate — resource budgets are named but not preregistered

The 2 MiB / 10,000-block acceptance row requires memory, latency, and fan-out
budgets, but no method, owner, threshold formula, hardware/profile identity, or
calibration/holdout rule is named. Route those facts to a dated prospective
instrument before implementation so the judged document candidate cannot set
its own target.

### Moderate — storage and abuse bounds need operation-log limits

The profile caps visible text, blocks, batch operations, batch bytes, and
editors, but not total retained atoms/tombstones, dependency gaps, marks,
comments, history frontiers, outstanding leases, operations per document, or
reduction work per admission. A small visible document can have an unbounded
adversarial history. Add target-profile bounds and typed refusals for these
dimensions.

## Suggestions

1. Split the accepted design into a small wire/reducer Spec and this
   application-profile RFC. The identity, canonical encoding, reduction, and
   compaction rules deserve golden-vector stability independent of the
   Notion-shaped product surface.
2. Use `atomId = (operationId, scalarOffset)` and keep frontiers strictly over
   operations unless evidence favors a different identity model.
3. Add a model-checking/property-test plan before implementation: generate
   valid operation DAGs, delivery permutations, duplicates, restarts,
   compaction cuts, and authorization transitions, then compare at least two
   independently implemented reducers.
4. Keep an explicit cost ledger for the custom path versus Yjs: editor
   adapters, reducer implementations, fuzzing, storage amplification,
   compaction, and security review.

## Open questions for the author

1. Must old offline edits remain admissible after their retention lease
   expires, or is typed quarantine an intentional product boundary?
2. Is authorization document-wide for v1? The Yjs discussion cites per-block
   authorization, but the normative authorization section defines
   document-membership roles rather than block ACLs.
3. Are operation ids globally ordered only for deterministic tie-breaking, or
   is that order intended to carry user-visible causality?
4. Which component owns canonical snapshot generation during failover, and how
   is split-brain publication fenced on the hosted target?

## Recommended next step

Revise and remain `Draft`. Resolve the identity/counter, compaction-anchor,
move/delete/cycle, canonical-encoding, and build-vs-integrate decisions first.
Then obtain an independent non-GPT family review and a fresh adversarial
re-review before the author considers `Accepted`.
