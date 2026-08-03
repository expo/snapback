# LLP 0160 super-refine loop — convergence record

**Document:** `llp/0160-ideal-migration-experience.rfc.md` (The ideal
migration experience)
**Loop:** LLP 0005 review loop at super-refine intensity, run 2026-08-03.
Rounds 1–2 under the author's original two-round cap; rounds 3–4 at the
author's first extension ("another round or 2"); round 5 at the
author's second extension ("run one more round") — see the addendum.
**Coordinator:** the authoring Claude (Fable 5) session — per LLP 0005 it
did not count itself as a reviewer; all reviews came from fresh
non-author contexts.
**Families:** Claude (Fable 5) via fresh Claude Code subagent sessions;
OpenAI Codex via `codex exec` (codex-cli 0.146.0, gpt-5.6-sol,
`model_reasoning_effort=xhigh`, read-only sandbox). All rounds mutually
blind; every round SHA-pinned its target (hashes in the per-family
artifacts).
**Final version:** v0.6 (SHA-256
`eb1c8f28026a6eb2b5c73e6511cc9aca7a92297b7c1af1db085376d5a7ef043e`);
Draft.

## Round ledger

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 1 | v0.1 | NOT READY (3 MAJOR, 4 MATERIAL, 2 MINOR) | NOT READY (1 BLOCKING, 6 MAJOR, 3 MATERIAL, 1 MINOR) | v0.2 — stale G3 removed (defect fixed+closed 2026-08-01); G4 narrowed to shipped `migrationBoundary()`; Moment 5 rebuilt around the untouched §7 binding; intent authoring added (Moment 2b); labeling/fence/rollback-line fixes; prior-art softenings |
| 2 | v0.2 | NOT READY (1 MAJOR, 1 MATERIAL, 5 MINOR) | NOT READY (3 MAJOR, 3 MATERIAL, 1 MINOR) | v0.3 — Moment 8 copy corrected to the custody contract and G4′ split; estimate label corrected; receipt drift (G10) + empty `preconditionRows` (G11) recorded; Moment 9 added; R/D/A classification; Appwrite+InstantDB added |
| 3 | v0.3 | **READY** (4 MATERIAL, 4 MINOR residuals) | NOT READY (4 MAJOR, 4 MATERIAL, 1 MINOR) | v0.4 — OQ6 born (tombstone-vs-resync is an author ruling, not a classification); G9 expanded, G12 (capability binding), G13 (dry-run semantics), G14 (refusal matrix) added; crash-resume reality; Moment 10; exhaustive Moment 4; OQ1 closed (default-on rendering) |
| 4 | v0.4 | **READY** (2 MATERIAL, 4 MINOR residuals) | NOT READY (3 MAJOR, 3 MATERIAL, 1 MINOR — all new-surface) | v0.5 — Moment 10's invented released-but-maintenance state removed (staged-before-publication per 0081 §4/0072); `published-held` restated (every apply passes through; actionable only via crash-resume locally); G9 → verb-by-verb matrix + OQ7 (rollback input conform-or-amend); fork accelerator restated amendment-blocked; **redaction contract** added; Supabase lesson narrowed to its invariants half; single-writer transport seam named; G15 (admin inspection); G2/G6 wording; timestamp-monotonicity note |

Loop closed on the corpus's **asymmetric stopping rule** (LLP 0154/0150
precedent): Fable READY in rounds 3 and 4 with shrinking residuals
(4 MAT → 2 MAT, all ledger-completeness); Codex NOT READY in all four
rounds but with monotonically narrowing, new-surface findings — round 4
found no defect in any round-1–3 repair, and its MAJORs (state-machine
phrasing, G9 scope, redaction) were each verifiable and are absorbed in
v0.5. The v0.5 repairs are **themselves unreviewed**. **The author
decides the status transition**; round-4 Fable recommended
accept-track, round-4 Codex recommended one more round.

## What the loop changed most

- Round 1: the ledger was stale on arrival (G3 fixed two days prior;
  G4 already shipped) — the verify-ledger-tense-at-revision-time rule
  is now the ledger's own discipline.
- Round 2 (both families independently): the Moment 8 end-user copy
  smuggled a semantics change (auto-replay across artifact upgrade);
  the three-lane R/D/A governance classification exists because of it.
- Round 3: the corpus itself is ambiguous on cross-artifact settlement
  (0081's acceptance line vs. its §4 wording vs. the shipped tombstone
  path) — reclassified as author ruling OQ6; four real drift rows
  (G12–G14 + expanded G9) entered the ledger.
- Round 4: two state-machine phrasing errors (released-but-maintenance;
  crash-resume-only `published-held`) and the missing redaction
  contract — a default-on stderr renderer printing backfill constants
  would violate 0081 §7's redaction rule.
- Net: the ledger grew from 8 rows (two of them wrong) to 17 verified
  rows across three governance lanes, and every prior-art claim now
  carries provenance that survived two independent full verifications.

## Open after the loop (author decisions / follow-ups)

1. **OQ6** — the tombstone-vs-resync-before-replay ruling (G4′b blocked
   on it; both families supplied decision input, recorded in Moment 8).
2. **OQ7** — the rollback-input conform-or-amend ruling inside G9's
   audit (the shipped code defends its divergence as deliberate).
3. OQ2–OQ5 as recorded in the document.
4. Immediately actionable regardless of status: G2's message-text slice
   (zero rendering infrastructure) and G1's golden-fixture rendering —
   candidates for `issues/` tickets; the drift block G9+G10+G12+G13
   rides one conformance pass.

## Round 5 addendum (2026-08-03, author-requested extension: "run one more round")

| Round | Target | Fable | Codex | Revision applied |
|---|---|---|---|---|
| 5 | v0.5 | **READY** (3rd consecutive; 4 MATERIAL, 2 MINOR — all copy/ledger-level) | NOT READY (4 MAJOR, 1 MATERIAL — further narrowed) | v0.6 (SHA eb1c8f28…) — the convergent redaction/approval tension ruled: face-specific redaction (review faces reveal by default, an approver never binds an unseen constant; narration/CI faces redact per 0081 §7's actual *log* scope); Moment 4 specifies render-before-mint with a non-interactive exact-digest acknowledgement (today's approve writes then emits); Moment 5 gains the rehearsal journey's missing first half (nothing creates the sealed rehearsal binding today) as new row G16, which also owns the unimplemented backup-preflight seam (`SNAPBACK_MIGRATION_BACKUP_REQUIRED` exists only in 0081's text; preview hardcodes `required: false`); preflight status classified apply-time observation, never approval authority; G8/G15 reclassified part-D (0081's acceptance already requires batch-boundary fault injection and same-identity admin inspection); G9 split into G9a (drift) and G9b (OQ7 conform-or-amend); G14 rescoped to the mechanically enumerated shipped code family with §8 as floor; PlanetScale over-dated provenance dropped; same-principal approval renders as disclosed exception |

Verdict pattern across five rounds: Fable NOT READY ×2 then READY ×3
with shrinking residuals; Codex NOT READY ×5 with monotonically
narrowing, new-surface findings (round 5 found no defect in rounds
1–4's repairs). The loop closes here per the asymmetric stopping rule;
the v0.6 repairs are themselves unreviewed. **The author decides the
status transition.** The ledger now holds 19 rows (G1–G16 with splits)
across three governance lanes plus two author rulings (OQ6, OQ7).

## Author decision — 2026-08-03

The author accepted this RFC ("promote all three as suggested"), adopting the accept-track recommendation from rounds 4–5. Acceptance adopts the G-ledger as the experience program; OQ6 and OQ7 remain open author rulings gating G4′b and G9b.
