# Wave 3 program — local-sync flagship + agent-safe storage

**Status:** Closed 2026-08-08 (program of programs) — see the closing record at the end
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

1. **0158 F0a + F0b — safety substrate and first consumer landed 2026-08-03.** The four
   implementation tickets are closed with the custody/fidelity,
   scrub-and-mint, publication crash matrix, and deny-all corpus green.
   This removes the F0a dependency for 0160's G7/G7′ and 0164's
   derived-deployment legs. F0b adds create/list/diff/drop/reap, finite TTL,
   default secret scrubbing, and dated two-session Todo fleet dogfood. The F1
   operating-guide/acceptance-harness follow-up remains separately tracked;
   F0b makes no capability claim.
2. **Gates recorded 2026-08-03.** The step-0 dated performance baseline is
   `tests/acceptance/fixtures/agent-safe-storage/performance-baseline.2026-08-03.v1.json`;
   the OQ13 spike and dated record are
   `examples/snapshot_pinning_spike.rs` and
   `tests/acceptance/fixtures/agent-safe-storage/oq13-snapshot-pinning.2026-08-03.v1.json`.
   OQ13 narrows LLP 0165 to budgeted pin or stable refusal; neither artifact
   by itself passes Acceptance 13 or advertises a capability.
3. **0163 → 0164 → 0165 implementation slices landed in dependency order.**
   The integrated branch has durable operation envelopes/suppression/range
   lifecycle and ordinary history joins; immutable base/head isolation,
   replay-only strict promotion and aggregate provenance; domain-separated
   promotion/checkpoint proofs, budgeted named checkpoints, bounded history,
   generated artifacts, and focused corpus. Promotion now consumes LLP 0165's
   independent expected/actual proof and rolls back on mismatch.
   `issues/closed/20260803-branches-promote-postimage-deviation.md` closed with
   0164's replacement/disable correction.
4. **Dated performance evidence recorded 2026-08-03.** The clean comparable
   candidate observations are within their read/write/idle thresholds on the
   exact step-0 machine, but the runner ordinal-zips historical and candidate
   runs instead of producing experimental pairs. A post-run audit adds the
   committed baseline digest, but cannot retroactively make those observations
   measurement-time-bound experimental pairs. The fork/diff/promotion/reap
   historical absolute run records median/MAD but predates the final promotion
   hardening. A separate clean integrated-revision absolute run now records the
   hardened fork/diff/promotion/reap path; author-ratified bounds, p99
   contention evidence, the valid paired active-lane comparison, and applicable
   correctness gates remain missing. The public covered
   lane was not activated, so Acceptance 13 is Partial, not passed.
5. **Honest tail.** The remaining row-by-row corpus, production/public wiring,
   author decisions, and extracted-Spec review/acceptance gates are recorded in
   `issues/20260803-agent-safe-storage-acceptance-tail.md`. Specs 0163-0165 stay
   Draft and capabilities stay `Missing` until the corpus rows pass — no early
   claims or inferred acceptance.

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
milestone; wave 3 closes with a **green named commit** *(superseded — see
"Close-condition re-scope under LLP 0189 (2026-08-07)" below)*, the tracks'
exit criteria met or honestly re-scoped, and a closing corpus audit (LLP 0016
cadence).

**2026-08-06 amendment — "green main" restated as "green named commit"
(Charlie).** This rule previously read "wave 3 closes with a green main".
That criterion is unsatisfiable as written: `main` moves continuously for
days under many concurrent agent sessions, so there is no moment at which
"main is green" is a checkable fact — a proof run always finishes against
a commit that is already behind. Left as-is, wave 3 stays open
indefinitely no matter how much work lands. The same failure mode starved
the Track B C27–C33 loop of 2026-08-05/06 and is now a standing warning in
`AGENTS.md`.

*(This 2026-08-06 block is superseded by the LLP 0189 re-scope below; kept
for history.)* The close therefore names one commit and proves *that*:

1. Pick the closing candidate SHA and record it here, dated.
2. Run the proof against that exact SHA. Fleet commits landing during the
   run do not invalidate it and do not restart the loop.
3. Close wave 3 against that SHA, citing it in the closing record. Work
   that landed after it belongs to whatever comes next, not to this wave.

This mirrors what the npm capstone already requires of itself — its
preconditions are written against a `candidateSourceSha`, not against
"main" — so the two now use the same discipline. Any residual drift
between the named commit and later `main` is a re-scope note, not a
reopen.

## Track A milestone (2026-08-04) — the whole local-first arc COMPLETE

Track A ran spec → store → loop-closure → write lane end to end and
exited: the LLP 0166 implementation program (8 lanes), the
continuation program P0–P5 (both now in `issues/closed/`), and the
Move-3 Phase-1 program (M1 evaluator, M2 admission, M3 rebase, M4
generated-IR mutations + the Latency Kanban exit — gate 5/5
real-served). **Charlie accepted the Phase-1 exit 2026-08-04** (dated
ruling in LLP 0129); Phase-2 scheduling is back on 0129's machinery,
deliberately unscheduled. Follow-on Track-A threads live in their own
tickets (browser proof pair, 0146 live-target gaps, capability
publication parked on Charlie). Track B (agent-safe storage / forking)
continues per its own tickets.

## Close-condition re-scope under LLP 0189 (2026-08-07)

Author ruling: the "green named commit" close condition is re-scoped to the
LLP 0189 D-6 form. The wave 3 close requires (a) green evidence for the
specific claims the wave makes and (b) the most recent scheduled complete
battery green on the claim-relevant gates, with unrelated red gates ticketed
and named in the closing record rather than blocking it. No single exact
`main` commit needs to be wholly green.

## Closing record — 2026-08-08 (disposition sitting)

Closed under the LLP 0189 D-6 form adopted 2026-08-07: green evidence for the
claims this wave makes, plus the scheduled battery green on claim-relevant
gates, with unrelated red gates ticketed and named here rather than blocking.
No wholly-green `main` commit is required or claimed.

### Track A — local-first flagship: COMPLETE

Recorded at the 2026-08-04 milestone above and unchanged. Spec (LLP 0166) →
store → loop-closure → write lane ran end to end and exited; Charlie accepted
the Move-3 Phase-1 exit 2026-08-04 (dated ruling in LLP 0129). Phase 2 remains
deliberately unscheduled on 0129's machinery.

**Carried out of the wave, still author-gated:** capability publication for the
0166 surface. It is not claimed here and is not a wave residual to be assumed
done — it needs Charlie's disposition and continues as a Track-A follow-on.

### Track B — agent-safe storage: RE-SCOPED to a continuing program

The acceptance tail (`issues/20260803-agent-safe-storage-acceptance-tail.md`)
continues as an independent program beyond this wave. Its LLP 0162 corpus rows
remain Partial, Specs 0163/0164/0165 remain **Draft**, and the target
capabilities remain **Missing**. Nothing about this wave's close advances
those states, and no capability may move above Missing on the strength of this
closure — per-component evidence including row 13 remains the only path.

This is an honest re-scope, not a completion.

### Track C — experience, cadence, release

- **npm `latest` capstone: COMPLETE.** All ten packages are live on npm
  `latest` at **0.1.11**, published from clean revision `281eb17c78` under the
  LLP 0041 pre-consumer fast-path disposition, with a retained ledger and a
  read-only registry re-download that byte-verified all ten tarballs against
  its SHA-256 vector (`issues/closed/20260803-first-npm-latest-promotion.md`).
  The LLP 0134 soak continues as its own 14-day program, decoupled from
  promotion — the maturity machinery's first production use has **not**
  happened and is not claimed by this closure.
- **LLP 0160 migration experience: RE-SCOPED.** Tranche 1 landed; tranches 2–4
  continue as an independent program
  (`issues/20260803-0160-migration-experience-program.md`). G7/G7′ remains
  blocked on the dated LLP 0081 §7 amendment; G9b and G4′b remain
  author-routed.
- **LLP 0136 live search: RE-SCOPED.** Carried out of the wave as its own lane
  (`issues/20260802-wave1-0136-live-search.md`), with its recorded
  auto-release condition intact. It collides with LLP 0155 Move 1 and the
  register-cliff ticket on `src/live_matcher.rs`; sequencing stays with
  whoever starts it.

### Closing corpus audit (LLP 0016 cadence)

- `./ref-check --verbose` — **green**: 193 LLP docs, 3611 refs across 8616
  files, 0 errors, 0 unchecked.
- Guide validation — **red**, ticketed and named below.

### Named red gates at close (not claim-relevant, not blocking, per D-6)

- `issues/20260808-main-drift-ci-workflow-fixtures.md`
- `issues/20260808-main-drift-client-bundle-metrology.md`
- `issues/20260808-main-drift-local-store-carrier-receipt.md`
- `issues/20260808-guide-manifest-blocked-by-missing-todo-v2-snippets.md`

The first three were filed automatically by the LLP 0175 drift backstop's
scheduled runs — the mechanism is doing what it was built for, and these are
fix-forward work rather than wave residue. The fourth was found by this
sitting's audit.

### What this closure does not claim

Agent-safe storage acceptance, the extracted Specs' status, any capability
above Missing, the LLP 0134 soak, LLP 0160 tranches 2–4, LLP 0136, and
capability publication for the 0166 surface. Each has a named owner ticket
above.

**Status: Closed.** Wave 4 (identity, LLP 0151 Option D + LLP 0150) is
unblocked; its two deferred author decisions and two commissioned Specs are
the kickoff, recorded in the Deferred section above.
