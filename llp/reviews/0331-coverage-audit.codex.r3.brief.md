**Artifact:** the brief given to the Codex delta review of LLP 0331 §"Coverage" (round 3)
**Author:** Claude Fable 5 (orchestrator), 2026-08-30
**sha256 of the brief body below:** `9c6a6be7c4e4f5d5c244d2f7a408cb0cb4e3270afecf731e1480fda6673edea0`

---

You are an independent reviewer from the GPT/Codex family, running read-only inside /Users/ccheever/projects/snapback. Do not edit any file. Cite everything as `file:line`. This is ROUND 3 of a delta review your family ran twice today; the round-1 and round-2 artifacts are both in `llp/reviews/0331-coverage-audit.codex.md` (read it first — it is your own family's prior work).

# Target

`llp/0331-scoped-roles-diary-feedback.research.md` (Research, Draft, uncommitted), §"Coverage — the model against the thirty-seven paper applications", including its subsections "Author rulings (2026-08-30)", "Delta from LLP 0329.014.004", "Codex delta-review dispositions (round 1)", "Codex delta-review dispositions (round 2)", and "Amendment to ruling 0 (ruled 2026-08-30)"; plus the sentences it changed in the Summary, the model table (rows "Hierarchy", "Non-human actors", "Guests and links"), the non-human-principal paragraph under "The account model", and "Sequence and acceptance bar" rows 4b, 4c, 6, 7.

Since round 2 the orchestrator folded all three round-2 MATERIAL items: (1) every operative "declared view" phrase was rewritten to table-rule authorization and the budget line now says the reserved `system` principal may appear only as a literal compared with `viewer`, never as a `principal.kind` test; (2) Tier 1 gained a "One trusted domain" paragraph that accepts the cross-program authority of one shared system principal explicitly, cites the auction v0's warning, and requires the RFC's negative/flow claims of system programs whose reads exceed their callers'; (3) the RFC delta table gained rows for `ctx.replica`, `ctx.session`/`ctx.device`/`fresh`, named-program write grants, and the v1.2 program inputs, and its completeness claim was narrowed. Part A item 7 ("every v0") was also fixed.

# Your job

## Part A — verify round-2 resolution

For each round-2 item, RESOLVED / PARTLY / NOT RESOLVED with a one-line reason and a citation into the current document:
1. MATERIAL 1 — the fold is now consistent: no operative text still makes a per-program view grant access; the budget no longer contradicts `viewer === system`. Grep-level thoroughness is expected: name any remaining operative occurrence.
2. MATERIAL 2 — the "One trusted domain" paragraph: is the accepted consequence stated honestly, and are the isolation obligations (reviewed write/read sites; the RFC's `independentOf` and taint claims for system programs whose reads exceed their callers') sufficient for a Research document feeding a spec? Cite RFC lines 202–204 if you rely on them.
3. MATERIAL 3 — the delta table is now complete for the RFC's rule-language and program-input vocabulary that bears on authorization (check §3 lines 272–314 and §2.1/§2.2 rows N, G, C, L against the table).
4. Part A item 7 — the "every v0" wording.

## Part B — anything new

Any NEW material concern introduced by the round-2 fold. If none, say so explicitly.

# Output

`## Part A` table (item · verdict · reason · citation), then `## Part B`, then a final line exactly `READY` or `NOT READY`: is §"Coverage", as it now stands, ready to serve as the design input for the Snapback 2 authorization spec (LLP 1001+)? Do not edit files. Do not fabricate line numbers.
