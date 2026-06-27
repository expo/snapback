# Review: LLP 0008 — Local-first sync and realtime

**Reviewed:** `llp/0008-local-first-sync-and-realtime.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the on-machine
Valet repository; nothing sent externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the Valet
retrospective evidence. Valet *shipped* this subsystem, so its sync-protocol,
mutation-log, wire-protocol, realtime-pipeline, websocket, sqlite-serialization,
and deterministic-testing specs — plus the multiplayer diaries — are unusually
direct evidence. Requested with "revise to make them better"; this **applied** the
edits documented below.

> **Independence (LLP 0005).** Drafted by Codex; reviewed/revised by Claude
> (cross-family). The applied contracts are Valet's shipped decisions
> (`[observed - Valet LLP NNNN]`) or firsthand demo behavior
> (`[confirmed - Valet diaries]`), not invention. The fan-out ceiling and other
> production-scale unknowns are kept open.

## Overall assessment

This is the document where the gap between "well-reasoned proposal" and "what a
shipped local-first system actually requires" was widest — and, happily, the one
where the evidence is richest. The draft correctly chose query-result sync as one
system spanning offline and realtime, and correctly named read-sets, retention, and
authorization-aware sync as the hard parts. But many of its load-bearing contracts
were left as "the server returns ordered deltas; messages are idempotent" when Valet
had already worked out *exactly how* — the replay environment, the optimistic
suppression rule, the conflict default, the retention rule (and its trap), full-docs
vs. diffs, membership-driven delta typing, and the brute-force path for opaque
queries. The revision folds these in, so the RFC now reads as grounded in a system
that ran rather than proposed cold. Two items are the headline: **adopt Valet's
replay environment verbatim**, and **do not adopt Valet's retention rule** (it grows
without bound).

## Strengths

- **One system, not two** (*Summary*, *Proposal*) — unifying offline replay and
  realtime invalidation on one changeset/version contract is exactly the convergence
  LLP 0001 identified and Valet validated.
- **Read-sets named as the reactivity mechanism** (*Reactivity and Read Sets*) — the
  right hinge, and the draft was honest that opaque queries are not automatically
  safe (Valet's brute-force `replace` is the concrete fallback, now added).
- **Authorization-aware sync treated as backend, not visual** — consistent with the
  card-game reference app and Valet's enforced RLS.

## Concerns

Grouped; all are "the draft was underspecified where Valet had a shipped answer,"
except C2 which is a trap to *avoid*.

- **C1 — The replay environment was underspecified; adopt Valet's contract verbatim.
  [High]** Capture `{ids, random, now}` locally, transmit only `{generatedIds,
  now}`, declare `Math.random()` non-deterministic server-side (server authoritative,
  client rebases). This is the precise "local/server disagree about time/random/ids"
  risk LLP 0006 lists. **Applied** (*Mutation Replay*).
- **C2 — The retention rule the draft was reaching for is the trap to avoid. [High]**
  Valet GC'd the change log only after *every* subscription advanced (a min
  watermark) with no time bound — one zombie subscription pinned it forever. The
  draft's instinct (version+time + forced resnapshot) is the *fix*. **Applied**
  (*Retention and Resume*), with the anti-pattern cited.
- **C3 — The initial subscription result must be authoritative, not raced. [High]**
  Every Valet/Contract demo hit a cold-start `subscribe` that returned nothing until
  the next change and hand-primed from `getAllDocs`. **Applied** (*Subscription
  Contract*; cross-linked from LLP 0012's runtime-state seam).
- **C4 — Optimistic-overlap and conflict defaults were unspecified. [Medium-High]**
  Idempotency alone doesn't cover the optimistic case: Valet suppresses incoming
  deltas for a doc with a pending local mutation by **doc-id, not version**, and its
  v1 conflict default is **per-field LWW + delete-wins**. Both **applied** (*Mutation
  Replay*).
- **C5 — Multi-row optimistic mutations need the atomic boundary on the client too.
  [Medium-High]** Valet rendered half-applied moves in other tabs until it routed
  multi-row changes through one server-authoritative changeset. **Applied** (*Mutation
  Replay*; storage side in LLP 0007).
- **C6 — Delivery mechanics: full-docs-not-diffs, membership-typed deltas,
  per-client bounded queue, and designed backpressure. [Medium]** Full documents are
  *why* idempotency is trivial; delta type is a function of membership (with a resync
  escape valve); a 50 msg/s silent-drop limit stranded mutations forever; a broadcast
  channel lets one slow consumer block all. **Applied** (*Subscription Contract*,
  *Realtime Delivery*), with Valet's measured latency/limit baselines added as
  acceptance targets.
- **C7 — Portability of the change-notification mechanism (Cloudflare). [Medium]**
  Polling doesn't port (Workers can't poll; DOs use alarms); keep the trigger/change
  table behind a swappable change-notification seam. **Applied** (*Realtime
  Delivery*).
- **C8 — Local store and resume scope. [Medium]** Valet's local store is SQLite on
  every platform with a single-connection mutex as a *correctness* requirement;
  delta-resume-with-pending-offline-replay was never shipped (it full-synced).
  **Applied** (*Local Store*, *Retention and Resume*).
- **C9 — Opaque server queries: state the honest fallback. [Low-Medium]** They are
  live-syncable only via whole-result re-execution + `replace`; incremental deltas
  are for analyzable single-table filters. **Applied** (*Reactivity and Read Sets*).

## Suggestions (non-blocking)

- The CRDT/collaborative-text deferral is reinforced by Valet (designed in full,
  never shipped); when conflicts surface, use a typed conflict payload. The
  externally-added collaborative rich-text acceptance slice (LLP 0010) is the right
  place to force that decision later, not now.
- Carry Valet's measured baselines (median 50–100ms, P99 ~1s under contention; 50
  msg/s; 100 subs/client) into LLP 0010 until Snapback measures its own.

## Open questions (for the author)

- The realtime fan-out ceiling — the key unmeasured unknown (LLP 0000); Valet's
  two-client presence worked but many-high-frequency-clients was never stress-tested.
- Cursor/sequence encoding across local stores; presence/ephemeral state design.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** Revise again after the first local prototype measures
   matching/retention/reconnect/replay — especially fan-out.
2. **Charlie reviews the applied contracts** (C1–C9). C1 (replay env) and C2
   (retention) are the two to ratify first; both are adopt/avoid-verbatim calls from
   a shipped system.
3. **Build the deterministic harness with handler replay first-class** (LLP 0010) —
   Valet's harness omitted exactly that path.
