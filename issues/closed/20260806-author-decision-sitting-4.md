# Author decision sitting #4 — 2026-08-06 (sitting record)

**Status:** Closed at landing (provenance record). This file is the
provenance record for the 2026-08-06 author decision sitting #4 (Charlie
Cheever, with Claude Fable 5 recording and propagating), modeled on
sittings #2 and #3. The decision packet was the pending-rulings compilation
presented in-session on 2026-08-06 (17 rulings across release/packaging,
the agent-efficiency program, golden path, storage/forking, and the
local-first program); Charlie ruled on each in one message. Rulings
propagate as dated notes in the owning documents per the propagation map
at the bottom. Two rulings commissioned fact-finding rather than an
immediate disposition; their owners are sibling agents of this session
(bundle attribution; storage-row code check) and their results land in
their own tickets, not this record.

## Rulings, 2026-08-06

1. **Bundle ratchet red (`client-bundle-ratchet-red-on-main`): attribute
   first, then dispose.** Run an attribution pass over the ~35%
   `react-external`/`external-react-application` step; if the growth
   attributes to the 2026-08-05 blessed family or to the Charlie-directed
   2026-08-06 program fixes, roll the baseline forward; otherwise hold
   the red and report. Owner: sibling attribution agent; disposition
   lands in the ticket.

2. **`@expo/snapback-expo` joins the publishable closure.** Widen from
   nine to ten packages at the next release (0.1.10), timing at the
   operator's discretion ("whenever you want to do it"). The
   first-publication auto-`latest` bootstrap case is accepted as recorded
   in LLP 0041 §First-publication latest bootstrap lineage.

3. **LLP 0134 does not govern npm packaging.** The 0134 evidence bar
   (soak windows, maturity receipts) is struck from npm-promotion
   checklists; LLP 0041 owns packaging evidence. The post-fast-path
   ceremony bar is qualified staging receipts once the EAS-provenance
   validator fix lands (`20260806-qualified-publish-eas-provenance-blocker.md`)
   — no 14-day soak. Version authority: the operator supplies the
   version at publish time; the publish lane must cross-check the guide
   fences (`guide/published-closure.json` + `since:` markers) — recorded
   as a dated LLP 0041 note.

4. **LLP 0146 remaining tranche.** D7 (typed remediations carried by
   refusals) is RATIFIED and pulled forward out of Wave 3 — it is the
   next 0146 construction item. D4 (semantic change-impact diff) is
   RATIFIED CONTINGENT on the LLP 0115 CV-14 custody owner's dated
   amendment (OQ7's boundary stands; no custody claim without owner
   ratification). D5 and D6 stay deferred for re-scope after Wave 1
   lands, per the RFC's own recommendation.

5. **Zerobugs (LLP 0183): review loop before acceptance.** An LLP 0005
   review loop scaled to foundational product work is commissioned; the
   Decision-requested acceptance is taken up after it completes.
   Owner-Specs for D-workstreams are named as each workstream starts,
   not all upfront.

6. **LLP 0160 OQ3: the compatibility-verdict split is BLESSED** as
   proposed — presentation half owned by 0160, protocol fact restated in
   LLP 0093. The program records the ruling and implements on its own
   schedule.

7. **0184 storage rows: classify from code evidence.** The proposed
   defaults (`storage.protected-erasure` → `apiOnly`/`direct` with
   `humanApprovalRequired`; `storage.operation-coverage.activate` →
   `direct` with a note) are adopted subject to a storage-code check —
   if activation can wedge mid-migration state, it drops to `internal`
   until LLP 0160 matures. Owner: sibling classification agent;
   disposition lands in the ticket.

8. **LLP 0129 OQ8: the Phase 1 gate SPLITS** into evaluator/conformance
   and end-to-end shipping slices, so SD-5 cannot advance the phase on
   the LLP 0051 D5 corpus alone.

9. **LLP 0129 OQ10: Candidate B is DEMAND-GATED.** No speculative
   definition; the decision lab is limited to Outcomes 0/1 until a
   concrete candidate arrives with a named adjudicating owner (same
   posture as LLP 0141 OQ1).

10. **LLP 0129 OQ11: execution-identity element 5 is OWNED BY LLP 0166**
    (local persistent store). Its owner inherits the store-semantics
    profile and mismatch disposition; exit criterion 3's element-5
    harness upgrades to conformance-on-both-executions plus
    mismatch-refusal tests under that ownership.

11. **LLP 0151 passkeys + shared delivery: wave-4 deferral AFFIRMED.**
    No early ruling. Advisory leanings recorded here only (non-binding):
    generated-domain passkeys lean preview-only on the
    tethered-continuity risk; shared email/SMS delivery leans yes with
    LLP 0104 shadow metering. Both are decided together at wave-4
    kickoff as the RFC asks.

12. **LLP 0176 dev-persona / LLP 0039: defer, then amend narrowly.**
    When LLP 0181 E1 concretely needs the declared-dev-persona contract,
    LLP 0039 receives a narrow dated amendment authorizing that contract
    only — no general unfreeze, and nothing now.

13. **Not-ripe set affirmed as sequenced.** 0160 OQ6 and OQ7 wait for
    their evidence packets (Moment-8 decision input; tranche-3 drift
    audit); 0163/0164 named-author acceptance waits for independent
    dual-family review plus the fixed-Air performance run. No action
    until the triggering evidence exists.

## Propagation map

- Ruling 1 → sibling agent; `issues/20260806-client-bundle-ratchet-red-on-main.md`
- Ruling 2 → `issues/20260806-snapback-expo-package-not-in-publishable-closure.md`
  (status updated: approved, awaiting 0.1.10 execution)
- Ruling 3 → LLP 0041 dated note;
  `issues/closed/20260806-llp0134-bar-vs-npm-promotion-ruling-needed.md`
- Ruling 4 → LLP 0146 dated status note
- Ruling 5 → LLP 0183 dated note (review loop commissioned)
- Ruling 6 → `issues/20260803-0160-migration-experience-program.md` dated note
- Ruling 7 → sibling agent; `issues/20260806-llp0184-storage-rows-await-owner-classification.md`
- Rulings 8-10 → LLP 0129 dated Open-questions notes
- Ruling 11 → LLP 0151 dated note (deferral affirmation only)
- Ruling 12 → LLP 0176 dated note
- Ruling 13 → no document edits (sequencing already recorded in owners)
