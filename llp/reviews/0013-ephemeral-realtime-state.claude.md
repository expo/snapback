# Review: LLP 0013 — Ephemeral realtime state

**Reviewed:** `llp/0013-ephemeral-realtime-state.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against the in-repo LLP corpus; nothing sent
externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the documents
0013 governs or borrows from — the parent realtime RFC ([LLP 0008](../0008-local-first-sync-and-realtime.rfc.md),
which explicitly defers the ephemeral carrier to this RFC), the Valet retrospective
([LLP 0006](../0006-valet-retrospective.research.md), the evidence base for the
two-client-presence and 50 msg/s-burst claims), and a cross-document consistency
sweep over LLP 0004, 0007, 0009, 0010, 0011, and 0012 for vocabulary and capability
alignment. Requested as "review … revise as appropriate"; this **applied** the
revisions marked below.

> **Independence (LLP 0005).** Drafted by Codex; reviewed by Claude (cross-family),
> so this counts as one independent family pass. Caveat: this same pass also *edited*
> the document, so it is no longer fully independent of the revised text — a second
> family (GPT-5, the corpus's other reviewer) and Charlie should read the revisions.
> No GPT-5 companion review exists for 0013 yet; the loop is not complete.

## Overall assessment

This is a strong, well-scoped RFC that does exactly the job [LLP 0008](../0008-local-first-sync-and-realtime.rfc.md)
and [LLP 0000](../0000-snapback.explainer.md) hand it: define the *product boundary*
for presence/cursor/typing state so agents stop encoding high-frequency awareness as
durable table writes by default. The governing rule — "ephemeral state is not faster
durable data; it is lossy, TTL-bound realtime state with an explicit recovery model"
— is the right keystone, and the three-way *Vocabulary* split (durable / ephemeral /
internal cache) is precisely the kind of crisp, agent-checkable boundary the
project's agent-first thesis needs. The draft was already honest about its biggest
limit: it answers the carrier question at the product level and leaves the empirical
fan-out ceiling — 0008's and 0000's actual open unknown — to the first prototype.

The draft's gaps were not in its thesis but in a few load-bearing semantic edges left
half-stated, and in cross-references that named other subsystems' not-yet-fixed
vocabulary without flagging the debt. The most important was the **recovery model for
a lost remove**: the TTL is in fact the universal backstop for *any* dropped remove
(disconnect and explicit delete, not only expiry), which is the real reason
connection-owned entries must still carry a TTL — the draft stated the expiry case
and stopped. The revision closes that and four sibling edges (per-subscriber auth
revocation vs. room-wide `scopeEpoch`; post-commit publish staying outside the
single-writer lock; user-owned leases across tabs; routing-narrowing as an enforced
error), and aligns the capability and seam vocabulary with LLP 0012.

## Strengths

- **The governing rule and the *Vocabulary* section.** Durable vs. ephemeral vs.
  cache, each with a "choose this when…" test, is the agent-disambiguation the whole
  document exists to provide, and it is stated as a rule an agent can apply, not a
  vibe.
- **Delivery lanes** (*Delivery lanes*, *Backpressure and coalescing*). Two logical
  lanes on one socket, durable scheduling priority over ephemeral floods, per-client
  bounded queues "not one broadcast channel" — this correctly lifts the exact lesson
  Valet paid for (the mpsc-256-not-broadcast queue, [LLP 0006](../0006-valet-retrospective.research.md)
  §Realtime Delivery), and the "durable-lane delay … should be zero" diagnostic makes
  the priority claim measurable rather than aspirational.
- **Conflict-model honesty** (*Conflict behavior*). "Last accepted publish wins per
  entry," explicitly flagged as a *different* contract from durable last-write-wins-
  per-field, with CRDT/OT explicitly out — consistent with 0006's finding that Valet
  designed CRDTs in full and never shipped them.
- **Server-handler reads unsupported on the paved path** (*App API boundary*). The
  conservative call is the correct one; "a handler that enforces inventory, payment,
  authorization, ordering, or ownership from ephemeral state is outside the paved
  path" is the right fence and prevents ephemeral state from becoming a shadow source
  of truth.
- **Validation requirements** are concrete and testable and mirror the 0008/0010
  acceptance shape — especially "high-frequency ephemeral publishing does not delay
  durable mutation acks," which turns the delivery-lane priority into an acceptance
  gate.

## Concerns

Severity is the reviewer's; all eight were **applied** in the revise pass and are the
author's to confirm or revert.

- **C1 — The lost-remove recovery model only covered expiry. [Medium-High]** A
  disconnect-driven or explicit remove can be dropped just like an expiry remove, and
  the TTL is the backstop for all three — which is *why* connection-owned entries need
  a TTL even though disconnect "should" clean them up. *Resolves when:* the recovery
  rule is stated for any lost remove. **Applied** (*TTL and leases*).
- **C2 — `scopeEpoch` and the authorization epoch could be conflated. [Medium]** Auth
  revocation is per-subscriber (remove one user, re-authorize who could see them); a
  `scopeEpoch` bump is room-wide (everyone resnapshots). Treating a permission change
  as an epoch bump would over-resync the whole room; treating sequencing loss as
  per-subscriber would under-recover. *Resolves when:* the two are named as distinct
  mechanisms. **Applied** (*Authorization and privacy*).
- **C3 — Post-commit publish needed to be tied to the single-writer lock, and room
  maps located outside the JS sandbox. [Medium]** "Publish after commit" is
  load-bearing because the durable path holds one writer lock for the whole handler
  ([LLP 0003](../0003-local-code-hosting-and-storage-core.rfc.md), [LLP 0008](../0008-local-first-sync-and-realtime.rfc.md)
  §Local Store); fan-out inside that lock would re-create the write-path pressure this
  subsystem exists to remove. Room maps are Rust host state, so `ctx.ephemeral` is a
  host call orthogonal to [LLP 0009](../0009-code-execution-security.rfc.md)'s
  per-invocation isolation. *Resolves when:* both are stated. **Applied** (*App API
  boundary*).
- **C4 — User-owned presence across multiple connections was underspecified.
  [Medium]** The draft offered user-owned keys for "online status" but did not say how
  the entry is kept alive or cleaned up when a user has two tabs. *Resolves when:* the
  shared-lease / last-connection-out rule is stated (and the exact model is an open
  question). **Applied** (*Scope and keys*) + open question.
- **C5 — Routing-narrowing safety was a convention, not an enforced rule. [Medium,
  security]** A narrower `routing` that collapses two auth domains into one room leaks
  presence across them; "only when it does not merge domains" should be a generated-
  validation *rejection*, not author discipline. *Resolves when:* generated validation
  must reject a narrowing it cannot prove safe. **Applied** (*Routing and rooms*).
- **C6 — Illustrative syntax named other subsystems' un-fixed vocabulary without
  flagging it. [Low-Medium]** `defineEphemeral` / `ephemeral.collection` / `v.id` /
  `ctx.ephemeral` are owed by LLP 0004 (itself illustrative), and `allow.boardMember`
  assumes the permission-rule syntax LLP 0011 still lists as an *open question*. The
  draft disclaimed "concrete syntax" generally; the debt should be explicit so this
  doesn't read as established API. *Resolves when:* the forward references are named.
  **Applied** (*Proposal*) + open question.
- **C7 — Capability vocabulary should align with LLP 0012. [Low-Medium]** "Ephemeral
  capability error" is an instance of 0012's capability manifest and "surface, don't
  silently fall back" rule, and an ephemeral-only collection is 0012's **Online**
  class (no local-first parity). The snapshot-then-delta contract is 0012/0008's
  "current value plus subscription" seam and should cite it. *Resolves when:* terms
  are aligned and the seam cited. **Applied** (*Backend adapters*, *Proposal*).
- **C8 — The 0007 bundle-exclusion claim was true but not enumerated in 0007. [Low]**
  Ephemeral state is excluded from the logical SQLite→Postgres bundle *by construction*
  (in-memory, never durable), but [LLP 0007](../0007-storage-portability.spec.md) lists
  sessions/verification-codes/secrets and not ephemeral state. *Resolves when:* 0013
  cites it precisely and hands 0007 the enumeration. **Applied** (*Relationship to
  durable sync*) + open question.

## Suggestions (non-blocking)

- The *V1 local budgets* and the worked `boardCursors` example are internally
  consistent (1 KiB / 20 Hz / 60 burst / 33 ms / 30 s max all match). Consider stating
  once that the example deliberately mirrors the defaults, so a reader doesn't hunt for
  a difference.
- *Related* omits LLP 0005 (the React-integration explainer) even though generated
  clients will render ephemeral overlays beside durable query results; a back-reference
  there would help when the client adapter layer is specified.

## Open questions (for the author / ratifying source)

- **The empirical fan-out ceiling stays open — correctly.** The "100 publishers/
  subscribers per room" number is diagnostic-only; the real many-high-frequency-client
  ceiling is 0008/0000's unmeasured unknown, and the first local-process prototype is
  where it gets answered. 0013 should not be read as closing it.
- **Syntax ownership.** Who fixes `defineEphemeral`/`ctx.ephemeral` (LLP 0004) and
  `allow.*` (LLP 0011, currently an open question there)?
- **0007 enumeration.** Should 0007 list ephemeral state in its bundle-exclusion set?
- **Adapter representation of `scopeEpoch`/`entryVersion`** on Redis-compatible and
  Durable Object targets (already in 0013's own open questions; flagged here as the one
  most likely to bite portability).

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** The revisions are precision and edge-closure, not a new
   direction.
2. **Gather a second family.** Every LLP 0000–0012 has a `.gpt-5.md` companion; 0013
   does not. A GPT-5 pass is the honest completion of the multi-family loop, and
   matters more here because this Claude pass also edited the text.
3. **Build the local-process prototype and measure the fan-out ceiling** — the single
   empirical unknown 0008 and 0000 keep flagging — before any hosted (Redis / Durable
   Object) adapter is treated as settled.
