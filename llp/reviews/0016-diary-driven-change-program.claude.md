# Review: LLP 0016 — Diary-driven change program

**Reviewed:** `llp/0016-diary-driven-change-program.plan.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-26
**Redacted:** No — reviewed locally against the in-repo LLP corpus; nothing sent
externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the document's
evidence base ([Diary 0001](../../diaries/0001-todo-demo.diary.md)) and the LLPs it
sequences or borrows from — the demo ladder ([LLP 0015](../0015-demo-application-suite.plan.md))
and its acceptance ladder ([LLP 0010](../0010-agent-dx-and-acceptance.spec.md)); the
artifact and capability-class vocabulary ([LLP 0012](../0012-headless-integration-contract.spec.md));
the buffered-write boundary and read-set capture ([LLP 0003](../0003-local-code-hosting-and-storage-core.rfc.md),
[LLP 0004](../0004-application-data-api.rfc.md)); the realtime model ([LLP 0008](../0008-local-first-sync-and-realtime.rfc.md));
the handler execution envelope ([LLP 0009](../0009-code-execution-security.rfc.md)); and the
authorization model ([LLP 0011](../0011-auth-and-permissions.rfc.md)). Requested as
"review … revise if you see ways to make the plan better"; this **applied** the
revisions marked below.

> **Independence (LLP 0005).** Drafted and self-revised by Codex; reviewed by Claude
> (cross-family), so this counts as one independent family pass and satisfies the
> Plan's own Status request for a separate review run. Caveat: this same pass also
> *edited* the document, so it is no longer fully independent of the revised text — a
> second family (GPT-5, the corpus's other reviewer) and Charlie should read the
> revisions. No GPT-5 companion review exists for 0016 yet; the loop is not complete.

## Overall assessment

This is a genuinely useful Plan and it does the thing a Plan should do: it converts a
concrete build record into sequenced product work, separates core from adapters from
Exact/Contract, and names the difference between acceptable v0 scaffolding and shippable
product surface. The Pain-to-change Map is the strongest single artifact — each diary
pain maps to a change, an owner, and a falsifiable proof — and the principle that
"missing capabilities are allowed; hidden fallbacks are not" is the right keystone for
an agent-first platform. The draft was also admirably honest about its own provenance
(self-revised, not independently reviewed).

The draft's weaknesses were not in its thesis but in three load-bearing dependencies it
left implicit and one sequencing inconsistency with a sibling Plan. The most important
was **security**: Phase 2 wires real `ctx.db` handler execution through Ibex but cited
only LLP 0003 and LLP 0010, never LLP 0009 — the RFC whose entire job is to bound that
execution path. The second was **authorization**: the demo ladder's card-game slice
presupposes LLP 0011's authorized-subscription model, but no phase, owner, or risk in
the draft delivered it, and LLP 0011 was not even in `Related`. The third was a **demo-
ladder conflict** with LLP 0015 (which owns the corpus): the draft asserted a different
order and silently dropped a demo. The revision closes all three plus four smaller
edges, and grounds the "Online vs Parity" vocabulary in LLP 0012, where it is actually
defined.

## Strengths

- **The Pain-to-change Map.** Pain → change → owner → proof, each proof falsifiable
  (`tsc` passes without aliases; a drift test fails on divergence). This is the
  agent-checkable spine the document needed and it is stated as tests, not vibes.
- **Capability honesty as the governing rule.** "A demo must not call itself
  fine-grained realtime if it reruns all subscriptions" is exactly the kind of
  anti-overclaim fence the platform's thesis needs, and it is carried into the
  acceptance gates (Phase 3's Online-not-Parity gate, Phase 4's coarse-mode honesty).
- **Ownership split.** Core / adapters / Exact-Contract / shared boundary is clean and
  prevents the "promote every Contract need into core" failure the Non-Goals also fence.
- **Faithful borrowing where it borrows.** Phase 2's buffered-write phrasing ("handler
  completion, buffered writes, one commit version, and commit-time validation") is
  verbatim-faithful to [LLP 0003](../0003-local-code-hosting-and-storage-core.rfc.md)'s
  boundary, and Phase 4's realtime model matches [LLP 0008](../0008-local-first-sync-and-realtime.rfc.md)'s
  fine-grained/coarse distinction and pluggable-carrier stance.
- **Self-honesty about provenance.** The original Status paragraph refusing to file
  itself as an independent review until one actually happened is the right instinct and
  is preserved.

## Concerns

Severity is the reviewer's; all were **applied** in the revise pass and are the
author's to confirm or revert.

- **C1 — Phase 2 wired handler execution without the LLP 0009 envelope. [High,
  security]** Phase 2 cited LLP 0003 and 0010 but not [LLP 0009](../0009-code-execution-security.rfc.md),
  whose requirements are load-bearing for exactly this path: one fresh-or-reset runtime
  per invocation; `ctx.db` as the only storage path with no ambient SQLite/filesystem/
  network/environment/secret access; "the host does not hold the database/storage lock
  across async work or microtask drains"; and resource limits "enforced or honestly
  reported" ("an unenforced limit is a security hole, not a soft default"). Shipping
  `ctx.db` for ergonomics without this is unvetted code execution. *Resolves when:*
  0009's envelope is in Phase 2's required changes and gate, with `Related` and Non-Goals
  updated. **Applied** (*Cross-cutting constraints*; *Phase 2*; *Non-Goals*; *Related*).
- **C2 — The card-game demo depends on authorization that no phase delivers. [High]**
  The demo ladder's card-game slice requires "different authorized views of the same
  underlying state," which is [LLP 0011](../0011-auth-and-permissions.rfc.md)'s model
  (rows not visible "must not enter the initial snapshot, realtime delta, or retained
  local store"; `resync_required` on permission change). No phase, owner, or risk
  delivered it, and 0011 was absent from `Related`. The demo presupposed an unbuilt,
  unsequenced capability. *Resolves when:* authorized sync is sequenced as a gating
  workstream, owned, risked, and `Related` updated. **Applied** (*Sequencing table* row
  X; *Cross-cutting constraints*; *Ownership*; *Risks* R3; *Related*).
- **C3 — Phase 4's matcher must be authorization-aware by construction, not later.
  [Medium-High, security]** [LLP 0008](../0008-local-first-sync-and-realtime.rfc.md)'s
  dependency summary already includes "auth predicates that affected visibility," so a
  matcher designed as pure data-dependency and then patched for auth would leak the
  existence of rows a subscriber cannot see by re-notifying on them. *Resolves when:*
  Phase 4 composes dependency matching with per-subscriber auth filtering and honors
  `resync_required`, and the gate asserts no notify/reveal on hidden rows. **Applied**
  (*Cross-cutting constraints*; *Phase 4* required changes + gate).
- **C4 — The demo ladder contradicted LLP 0015, which owns it. [Medium]** 0016's Scope
  disclaimed owning "the demo corpus structure from LLP 0015," yet the Demo Implications
  asserted a different order (kanban before messaging), split todo into two demos, merged
  party into "Partiful-style," and dropped the asset slice — while [LLP 0015](../0015-demo-application-suite.plan.md)
  follows LLP 0010's acceptance ladder (todo → messaging → kanban → card game → party →
  asset slice). A Plan must not silently reorder a corpus it disclaims owning. *Resolves
  when:* the section defers to 0015's order and reframes 0016's contribution as the
  admission rule + demo→capability mapping, keeping the asset slice. **Applied** (*Demo
  Implications*; *Risks* R6).
- **C5 — "Online vs Parity" was treated as undefined when LLP 0012 defines it.
  [Medium]** The draft used Online/Parity as acceptance vocabulary (Phase 3: "reports
  itself as Online rather than Parity") but also listed defining it as an Open Question
  and as something the shared boundary "owns." [LLP 0012](../0012-headless-integration-contract.spec.md)
  already defines the classes and the four Parity conditions, with the rule "no local
  handler execution means no local-first/parity claim." *Resolves when:* the classes are
  cited to 0012; the shared boundary owns *applying* them plus the version handshake; the
  Open Question narrows to the Contract-data-binding handshake. **Applied** (*Phase 3*;
  *Ownership*; *Non-Goals*; *Open Questions*; *Risks* R5).
- **C6 — `ContractDataManifest` is referenced as established but specified nowhere.
  [Medium]** It appears in the Summary, the Pain-to-change Map, and Phases 1 and 3, but
  no LLP defines its shape — 0012 defines `schemaManifest`, `functionManifest`, and
  `capabilityManifest`, not this. Phase 1 and Phase 3 Contract gates depend on it.
  *Resolves when:* it is flagged as unspecified, made a Phase 1 prerequisite, and listed
  as a blocking Open Question. **Applied** (*Cross-cutting constraints*; *Phase 1*;
  *Ownership*; *Open Questions*; *Risks* R1).
- **C7 — The critical path and phase dependencies were asserted but not legible.
  [Low-Medium]** The draft said phases "can advance in parallel if the owners are
  different" without showing which phase blocks which. Phase 1 is in fact the long pole
  for Phases 3/5/6; Phase 2 is independent; Phase 4 gates kanban/messaging. *Resolves
  when:* a dependency narrative and an at-a-glance status table exist, and each phase
  header carries a `Depends on` line. **Applied** (*Sequencing and dependencies* +
  table; per-phase `Depends on` lines).

## Suggestions (non-blocking)

- **Glue inventory as a metric, not a vibe.** The "demos should exercise product code"
  principle is only checkable if each diary reports the demo-local glue it still carries.
  The revision asks each diary for a counted glue inventory that should trend down; if it
  trends up, the relevant phase is not done. Consider standardizing the exact file
  categories so the number is comparable across diaries.
- **Phase 0's "one source of truth" was demo-local.** The draft listed "preserve one
  source of truth for … manifests" among behaviors to freeze, but that property currently
  lives in demo-local codegen, not the product; Phase 1 productizes it. The revision
  narrows Phase 0 to "protect the property from regressing." A reader could otherwise
  think the product already guarantees it.
- **Consider whether authorized sync deserves a numbered phase.** The revision tracks it
  as gating row X rather than renumbering Phases 0–6 (to avoid breaking references). If
  it grows beyond "enforce 0011 in queries/subscriptions," promoting it to a full phase
  may read better.

## Open questions (for the author / ratifying source)

- **`ContractDataManifest` ownership and shape.** It blocks the Phase 1 and Phase 3
  Contract gates and has no spec. Does it become a shared-boundary section in an existing
  LLP, a new LLP, or an Exact-side document?
- **When does authorized sync land relative to Phase 4?** The revision argues the matcher
  must be auth-aware from its first version regardless; the author should confirm the
  sequencing and who builds the Snapback-side enforcement of 0011's rules.
- **Single source-of-truth schema.** Large enough to warrant its own Decision LLP before
  Phase 1 — does the author agree, and which direction (Rust-first, schema-DSL-first, or
  a neutral IR)?
- **Demo-ladder reconciliation with LLP 0015.** The order is now deferred to 0015, but
  0015 itself may want 0016's demo→capability mapping back-referenced so the two Plans
  stay in sync.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** The revisions are dependency-closure, sequencing, and
   reconciliation — not a new direction.
2. **Gather a second family.** Every LLP 0000–0012 has a `.gpt-5.md` companion; 0016 does
   not. A GPT-5 pass is the honest completion of the multi-family loop, and matters more
   here because this Claude pass also edited the text and added two security/auth
   dependencies that deserve an independent read.
3. **Resolve the two Phase-1 blockers first.** The source-of-truth schema and the
   `ContractDataManifest` spec gate the long-pole phase; settling them (the schema as a
   Decision LLP) unblocks the most downstream work.
4. **Sequence authorized sync before treating the card-game slice as scheduled.** Until
   LLP 0011 enforcement is owned and dated, the card-game slice should be read as gated,
   not next.
