# LLP 0324: Compact the root document

**Type:** RFC
**Status:** Review
**Systems:** Project, Documentation, Corpus hygiene, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — round-1 fold; see Revision history)
**Related:** LLP 0000, LLP 0016, LLP 0032, LLP 0189, LLP 0232, LLP 0259,
LLP 0286, LLP 0314.002,
[upstream LLP 0000 §Current and foundation](https://github.com/ccheever/llp/blob/v0.5.2/llp/0000-linked-literate-programming.explainer.md#current-and-foundation)

## Summary

`llp/0000-snapback.explainer.md` is the orientation point the LLP
overlay is built around. It is **1,102 lines / 79,097 bytes**. Its
`**Related:**` line names **162 LLPs**. Its metadata header runs 25 lines
before the summary.

Snapback adopted `llp/foundation/` and `llp/current/` — a 12-document
kernel and a small working set — precisely to answer "where do I start in
a 332-document corpus." That overlay works. It has not been applied to
the document that introduces it.

This RFC proposes re-shelving 0000: the ratification ledger moves to a
sub-LLP, the revision history moves below the body, and a generated
corpus index replaces the hand-maintained 162-name list — while
`Related:` itself stays curated. It also records a second, separate
orientation defect found while reviewing this batch (§2) and already
repaired.

**Audience, corrected.** This serves agents *engineering Snapback*, not
the LLP 0259 read budget. 0259 scopes its budget to cold **app-building**
agents and makes telling them to read LLPs a non-goal; `AGENTS.md` routes
those agents to `guide/start/` and away from this corpus entirely. The
population that pays for a 79 KB root is the one working on Snapback
itself.

Confidence is **0.85** on the direction. The contested questions are
where the ledger lives and what happens to the material that is neither
ledger nor header (§4).

## 1. Measurement

| Property | Value |
|---|---|
| `llp/0000-snapback.explainer.md` | 1,102 lines, 79,097 bytes |
| Lines before `## Summary` | 25 |
| Ratification ledger | lines 67–429 — **363 lines, ~32%** |
| Remainder after removing ledger + every `Revised:` + `Related:` | **724 lines, 43,894 bytes** |
| LLPs named in `**Related:**` | 162 |
| Files in `llp/` | 332 (`ref-check` recognizes 331 as LLP documents) |
| `llp/foundation/` entries | 12 |
| `llp/current/` entries | 15 |

Two comparisons, stated correctly this time. LLP 0259's caps are **3 KiB**
for a mental-model page, **6 KiB** for a full start packet, and a
**16 KiB** steering ceiling; the generated `start` section flat is
**21,502 bytes**. At 79 KB the root is roughly 5× the steering ceiling.
(The 44,677-byte figure that appears in 0259 is `guide/clients/react.md`,
which 0259 cites as the *over-read problem* — not a budget. And `du`
reports `guide/start/` as 44 KB only because that is block allocation;
its logical size is 20,950 bytes.)

**Not findings, recorded and deliberately not acted on here:**

- `llp/current/` contains one entry as a 58-byte path file (the
  documented `core.symlinks=false` form — legitimate, but inconsistent
  inside a single checkout) and one whose link name carries an `llp-`
  prefix its target does not.
- `LLP 0315` is cited from LLP 0310 with no `llp/0315-*.md` in this
  checkout; `0316` is unallocated while `0317` exists.
- Several documents carry non-standard `**Status:**` strings. This
  observation is **unconfirmed**: the values found were body-local
  `**Status:**` labels, and `ref-check` reads the first occurrence in the
  header window. It must be re-run through the actual metadata parser
  before anyone treats it as drift.

These are `llp-maintain` work. They are listed because a document about
corpus hygiene should say what it noticed and chose not to fix.

## 2. The second orientation defect (found in review, already repaired)

While this batch was under review, both reviewer families independently
found that several sibling RFCs asserted things the guide contradicts:
that the `source`/`exportName` handler split is the ordinary explicit
form (it is the documented compatibility lane), that `generated/` has no
custody model (`artifacts.json` classifies every artifact and
`guide/getting-started/generated-artifacts.md` documents it), and that
`@expo/snapback-react` has no narrow entry (`./core` ships and the guide
references it in 88 places).

All three facts are stated plainly in the guide. All three RFCs were
written from the code, the LLP corpus, and `demos/` — the sources
`AGENTS.md` routes a Snapback engineer to.

That routing is right for orientation and wrong for facts. The guide
records the **current paved form** of each authoring surface; the LLP
corpus records the *history of decisions* about it. An engineer reading
only the corpus gets a stale picture, and `demos/todo` — the demo the
guide lists first — deliberately sits on a compatibility lane, so reading
the canonical demo actively teaches the non-paved form.

**Repair (landed with this revision):** `AGENTS.md` §The Snapback Guide
gains a bullet instructing Snapback engineers to read the guide page for
any authoring surface they are about to change, naming the four entry
points and citing this section as the evidence. That is the whole fix; it
needs no further design.

This section is retained because the evidence is otherwise only in review
artifacts, and because it is the more consequential of the two
orientation problems in this document.

## 3. Proposal for the root document

### 3a. Move the ratification ledger to `0000.000`

363 lines, append-only by nature, cited across the corpus. It belongs in
`llp/0000.000-ratification-ledger.decision.md`, linked from the root, so
it can grow without growing the orientation surface.

`0000.000` must carry an explicit **"append ratifications here, not to
0000"** rule. Without it the root regrows, because appending to 0000 is
the habit the corpus taught.

### 3b. Move the revision history below the body

Reverse-chronological history above the summary means the first screen a
cold reader sees is a changelog. Keep the most recent one or two entries
in the header; move the rest to a `## Revision history` section at the
foot. (The bulk is not the first entry — that one is roughly 28 words —
but the oldest bundled `Revised:` line, which runs several hundred.)

### 3c. Generate a corpus index; keep `Related:` curated

`Related:` is defined upstream as "nearby documents worth reading," and
`llp-orient` follows it one hop to build a context pack. A generated
link-graph header cannot judge semantic relevance, and a 331-name
`Related:` would expand one-hop orientation across most of the corpus —
strictly worse than the 162-name list it replaced.

So: **the root's `Related:` stays curated and gets shorter**, and a
generated `llp/index.md` becomes the complete inventory the root points
at. This is the proposal, not an alternative to one.

### 3d. Disposition every remaining heading before editing

The arithmetic does not close on its own: removing the ledger, every
`Revised:` line, and `Related:` still leaves 724 lines. The residue is
ratified material — audience guidance, cross-cutting requirements,
subsystem boundaries, reference applications, design principles, scale
limits, implementation direction — and other documents already deep-link
into it (for example LLP 0027, which links `0000-snapback.explainer.md#reference-apps`).

Therefore this RFC sets **no line-count target**. It requires a
disposition table naming, for every existing heading, one of: *retain in
0000*, *move to a named authoritative document*, or *explicitly
supersede*. Anything moved needs a compatibility anchor or a
citation-migration pass. Remeasure after the table exists; do not
promise a number before it does.

## 4. Open questions

- **OQ1 — Ledger identity and foundation membership are two decisions,
  not one.** Whether `0000.000` is a sub-LLP is separate from whether it
  is linked into `foundation/`. If it is linked, it stays in the
  prescribed foundation-first orientation path and most of the budget
  benefit evaporates. If it is not, that must be reconciled with
  LLP 0286's reconstruction truth hierarchy, which names LLP 0000's
  ratification ledger as the highest authority. Decide identity,
  foundation membership, default-read status, and citation compatibility
  independently.
- **OQ2 — Citation shape does not survive automatically.** Existing
  references of the form `LLP 0000#…` into ledger anchors become
  `LLP 0000.000#…`. Sub-LLP numbering does not preserve them; a
  redirect note in 0000 or a citation sweep is required, and `ref-check`
  should be the arbiter of whether any break.
- **OQ3 — Compacting 0000 is a kernel edit.** 0000 is itself a
  `foundation/` member. This is fine and reversible, but it is not
  "editorial work in `current/`," and the author should treat it as a
  foundation change.
- **OQ4 — Who does the rewrite?** Mechanical relocation is safe for an
  agent. Rewriting the summary is not: the document states its own
  provenance as the author's project brief, and its direction is the
  author's to set.

## 5. What this does not do

- **It does not change the product direction.** Every ratified word
  survives, relocated, with a disposition recorded.
- **It does not touch other documents' size.** LLP 0059 (240 KB) and
  LLP 0209 (232 KB) are large because they are complete specifications.
  Size is only a defect in the document whose job is orientation.
- **It does not add a gate.** No check should refuse a landing because
  0000 grew. LLP 0189 and LLP 0232 govern; this is fix-forward editorial
  work.
- **It does not fix the corpus-hygiene items in §1.** Those go to
  `llp-maintain`, and one of them is unconfirmed.

## 6. Cost

An afternoon of editing plus a small generator for `llp/index.md`, after
the §3d disposition table exists. No code changes. The risk is dropping a
ratified statement during relocation, which the disposition table and a
diff review are there to prevent.

## 7. Why it matters

This is the smallest item to survive the batch review and the one most
directly upstream of agent behavior — for the population that reads it,
which is Snapback engineers, not app builders. The corpus invented
`foundation/` and `current/` to make orientation cheap and then left its
own front door at 79 KB. §2 is the sharper half: the same review that
scoped this document down produced direct evidence that engineering
orientation currently routes past the only place the paved forms are
written down.

## Revision history

- **2026-08-27 (b)** — round-1 `llp-super-refine` fold. Both families
  returned NOT READY (codex 3 MATERIAL, grok 1 MATERIAL); the surviving
  direction is unchanged and every correction is a fact or a scope
  narrowing. Applied: the LLP 0259 contrast rebuilt on the real caps
  (3/6/16 KiB) and the real start-flat size (21,502 bytes), with the
  44 KB figure withdrawn as `du` block allocation; audience reframed to
  Snapback-engineering orientation after codex showed 0259 scopes to
  app-building agents whom `AGENTS.md` routes away from the corpus; the
  under-150-line target withdrawn and replaced by the §3d disposition-
  table requirement after codex showed the arithmetic leaves 724 lines
  and that other documents deep-link the residue; generated `Related:`
  withdrawn in favor of a generated `llp/index.md` with `Related:` kept
  curated, after codex showed `llp-orient` follows it one hop; OQ1 split
  into independent identity/membership/citation decisions against
  LLP 0286's truth hierarchy; the "first `Revised:` entry is several
  hundred words" claim corrected to ~28; the status-vocabulary
  observation marked unconfirmed pending a re-run through the metadata
  parser; counts corrected to 331 documents and 15 `current/` entries;
  local LLP 0011 (the auth RFC) removed from `Related:` and replaced
  with the upstream overlay document; §2 added to record the
  guide-routing defect and its repair.
  Reviews:
  [codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
  [grok](./reviews/0322-tiered-diagnostic-codes.grok.md);
  run journal
  [`0322-tiered-diagnostic-codes.run.md`](./reviews/0322-tiered-diagnostic-codes.run.md).
- **2026-08-27 (a)** — Draft → Review at `llp-super-refine` loop start,
  the one authorized transition.
