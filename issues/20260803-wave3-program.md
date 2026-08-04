# Wave 3 program — local-sync flagship + agent-safe storage

**Status:** Open (program of programs)
**Opened:** 2026-08-03, ratified by Charlie: two fronts confirmed; 0158
F0a fleet-dogfood prioritized; Move 2 spec-first.
**Related:** LLP 0155 (Move 2 charter), LLP 0157 (Accepted — Move 1),
LLP 0158 (F0a green-lit), LLP 0162 (Accepted umbrella) + Specs 0163/0164/
0165, LLP 0160 (Accepted — experience program), LLP 0130 (standing
decisions), the 2026-08-02 author decision packet + its 2026-08-03
follow-on ratifications

## Track A — local-sync flagship (0155 Move 2)

Spec-first per Charlie's ruling: a dedicated authoring session writes the
Move-2 owning Spec (commission:
`issues/20260803-0155-move2-spec-commission.md`), dual-family loop,
acceptance Charlie's. The implementation program is scoped only after
acceptance. Track A owns answering the 0161-OQ5 seam (which agent-safe
properties the client store needs natively).

**2026-08-03 milestone — spec phase COMPLETE, implementation program
commissioned.** The Spec is **LLP 0166** (Accepted v1.0 by Charlie the
same day, after an 8-round dual-family loop converged dual-READY at
round 8); the four dated amendments (0008 DK-9, 0080, 0157, 0155
§Move 2) and the 0043/0053/0090 boundary notes landed with acceptance;
the 0161-OQ5 seam is answered in 0166 §D8 (nothing pulled forward from
Track B). **The implementation program EXITED 2026-08-03** — all eight lanes
landed same-day, carrier-exit evidence retained (13 PASS / 4 declared
GAP over real Chrome), bundle attribution recorded, four fake-vs-real
defects caught and fixed by the evidence run
(`issues/closed/20260803-0166-impl-program.md`). Capability publication
is the remaining explicit step, plus two follow-ons (logout bridge;
retained-render bridge blocked on the 0157 server half). Lanes L1–L8
(`20260803-0166-L*.md`): L1→L2 substrate first, then parallel lanes;
S4 legacy parity is a standing gate; capabilities stay unpublished
until the S1–S8 oracles + the 0157-consumed carrier exit pass.

**2026-08-03 sequencing (author decision sitting #2,
`issues/20260803-author-decision-sitting-2.md`): LLP 0136 live search
is the next Track-A lane after the 0166 umbrella closes.** Its held
implementation program (`issues/20260802-wave1-0136-live-search.md`)
carries a recorded auto-release condition keyed to the umbrella's
close (carrier-exit evidence run + closing audit) — no fresh explicit
release needed.

## Track B — agent-safe storage

1. **0158 F0a — safety substrate landed 2026-08-03.** The four
   implementation tickets are closed with the custody/fidelity,
   scrub-and-mint, publication crash matrix, and deny-all corpus green.
   This removes the F0a dependency for 0160's G7/G7′ and 0164's
   derived-deployment legs. The fleet-dogfood first consumer stays open on
   F0b's verb and remains the acceptance/graduation gate.
2. **Gates recorded 2026-08-03.** The step-0 dated performance baseline is
   `tests/acceptance/fixtures/agent-safe-storage/performance-baseline.2026-08-03.v1.json`;
   the OQ13 spike and dated record are
   `examples/snapshot_pinning_spike.rs` and
   `tests/acceptance/fixtures/agent-safe-storage/oq13-snapshot-pinning.2026-08-03.v1.json`.
   OQ13 narrows LLP 0165 to budgeted pin or stable refusal; neither artifact
   by itself passes Acceptance 13 or advertises a capability.
3. **0163 → 0164 → 0165** implementation in 0162's dependency order
   (**0163 initial substrate landed; 0164 first core in-app slice landed:**
   immutable base/head isolation, replay-only strict promotion, generated
   artifacts, focused corpus, and dated absolute-latency instrumentation;
   the per-row gaps recorded in LLP 0164 remain unpassed),
   against 0162's single acceptance corpus (rows split per Spec).
   `issues/closed/20260803-branches-promote-postimage-deviation.md` closed with
   0164's replacement/disable correction. Capabilities stay `Missing` until corpus rows pass — no early
   claims.

## Track C — experience and cadence

- The 0160 migration-experience program
  (`issues/20260803-0160-migration-experience-program.md`), tranche 1
  first.
- The first npm `latest` promotion capstone
  (`issues/20260803-first-npm-latest-promotion.md`) when wave-2's tail
  closes, then recurring promotions per Charlie's standing cadence
  guidance.
- The 0090 mixed-route successor: **LANDED 2026-08-03** on the contributor
  local target as Experimental `mixed_bundle_boot_v2`, using Accepted 0157's
  `exported_query_v1` / `mixed-route.v2` identity and a disjoint format-2
  artifact/wire; hosted publication remains a nonclaim.

## Deferred, with recorded sequencing judgment (Charlie delegated)

- **Identity implementation** (0151 Option D + 0150): wave-4 headline;
  the two 0151-commissioned implementing specs get owners and numbers at
  that kickoff. **Plus (2026-08-03, author decision sitting #2): the two
  0151 residual questions are deferred to the wave-4 kickoff with
  context recorded in 0151 §Open questions** — (a) the generated-domain
  passkeys tier (production tier-1 + disclosure vs preview-only;
  tethered-continuity risk is the crux) and (b) Expo-hosted shared
  email/SMS delivery for generated domains, shadow-metered via 0104
  (decide beside the passkeys question; the broker rejection does not
  automatically extend to delivery).
- **EAS Phase 0**: independent lane, gated on the WfP account purchase;
  starts the moment the probe passes, not tied to wave tracks.
- **LLP 0063 Step-6 ratification** (0068–0072): parked until Step 6 work
  resumes.
- **Staging-lane speedup** (90→15 min): capacity-permitting garnish.
- **0159 universal-layout question**: closed by its own verdict; its four
  reopen-triggers live in the doc.

## House rules

Wave-2 rules carry over, including the current landing policy
(own-correctness green per landing; drift batched to closing passes) and
the fleet coordination conventions. Update this ticket at each track
milestone; wave 3 closes with a green main, the tracks' exit criteria
met or honestly re-scoped, and a closing corpus audit (LLP 0016 cadence).
