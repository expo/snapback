# LLP 0183 program plan v1 — workstream owners, dependencies, timeboxes

**Date:** 2026-08-05 · **Stage 0 step 4 record** · Companion to
[`../../../llp/0183-zerobugs-quality-surface.rfc.md`](../../../llp/0183-zerobugs-quality-surface.rfc.md)

This records the owner document, dependencies, and timebox for each LLP 0183
workstream, per Stage 0 step 4. Owner-document *authorship assignments* to
humans are proposals pending Charlie's ruling on OQ13; the document-level
authority mapping restates LLP 0183 §Scope and is not itself a new decision.

| WS | Deliverable | Owner document(s) | Depends on | Timebox / stage |
| --- | --- | --- | --- | --- |
| D1 | Acceptance manifest, current-surface control, receipts | LLP 0183 + `demos/zerobugs/` (authorities: LLP 0016, LLP 0138) | source pin (done 2026-08-05) | Stage 0 freeze done 2026-08-05; control app in Stage 0.5 |
| D2 | Bounded relational graph profile Spec | NEW successor Spec in the LLP 0080/0110/0135 family (owners amend) | D1 inventory (done); fixture-derived ceilings (OQ1) | Stage 1 |
| D3 | Authority-scoped projected facts + local graph evaluation, risk classes 1–4 | NEW Specs answering LLP 0155 OQ2; LLP 0166 successor identities; LLP 0008 DK-9, LLP 0053 constraints | D2 graph IR identity; D4 server-backed mode shipped first | Stage 2, one class at a time; each class separately admitted or refused |
| D4 | Headless windowed-query controller + React projection | NEW Spec beside LLP 0012/0107/0114 | D2 query identity; explicitly NOT D3 (server-backed mode first) | Stage 1 (server-backed), Stage 2 (local mode) |
| D5 | Mutation corpus lowering + per-verb IR admission | LLP 0129 (sole admission authority), LLP 0133 value policies | D1 inventory (done: 2 current-IR / 3 explicit-value-or-Lane-Q / 11 new-verb preliminary); control-app lowering evidence | Lowering evidence in Stage 0.5; admissions in Stage 2 |
| D6 | Portable derived fields + maintained search documents | NEW Spec(s); amendments to LLP 0065/0073/0080 | D1 measured needs (text search over title/description/comments is the one proven need) | Stage 1, workload-proven subset only |
| D7 | Supported production composition profile | Composition profile doc + owner amendments to LLP 0031/0045/0057/0060/0070/0108/0144/0153/0172 | D1 service inventory (done: GitHub OAuth, 9 routes, email/Discord effects, S3-class assets) | Stage 3 |
| D8 | One hosted target qualification | LLP 0046/0072/0128 owners | D2/D5/D6 capabilities landed; D7 profile | Stage 3 |

## Stage 0 completion record

1. **LLP 0182 claims** — re-verified against the pin
   (`0182-claim-verification.v1.md`); four factual corrections applied; 0182
   marked Active 2026-08-05.
2. **D1 manifest** — `../manifest/acceptance.v1.md` freezes surface, fixtures,
   actors, methodology, and claim rules. Numeric noninferiority margins are
   deliberately NOT frozen in v1: per LLP 0183 §"Freeze performance margins
   from evidence" they freeze in acceptance.v2 after repeated Zero-arm and
   current-control variability trials, before Stage 1 implementation begins.
3. **Demand inventory** — `inventory.v1.json` (canonical) + `inventory.v1.md`.
4. **This plan** — owners, dependencies, timeboxes.
5. **Diary + corpus audit** — diary created under LLP 0016; audit run at
   Stage 0 land time.

## Author-gated items (flagged, not decided here)

- **OQ13 orchestration owner** — proposal: Charlie owns the program; agent
  sessions execute workstreams under this plan.
- **Primary "better"-claim candidate** — the manifest names durable
  disconnected intent (LLP 0182 finding 10) as the candidate with a proposed
  threshold; it requires Charlie's ratification before Stage 1. Without it the
  strongest permitted claim is parity.
- **LLP 0183 acceptance** — the RFC remains Draft pending its LLP 0005 review
  loop; Stage 0/0.5 produce evidence and no new capability, so they proceed
  under the program charter without pre-empting that review.
- **Owner-Spec authors for D2/D3/D4/D6** — unassigned; needed before Stage 1
  specification begins.
