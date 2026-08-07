# Local-first program — author gate packet (sitting request)

**Status:** Closed (ruled 2026-08-07 by Charlie Cheever; see Resolution)
**Severity:** P1 (program-blocking decisions)
**Systems:** Sync, Storage, Client integration, Realtime, Testing, Governance
**Date:** 2026-08-07
**Related:** LLP 0129, LLP 0155, LLP 0043, LLP 0107, LLP 0166,
`issues/closed/20260806-author-decision-sitting-4.md`,
`issues/20260806-phase2a-common-path-designation-absent.md`,
`issues/20260804-optimistic-matcher-strand-backstop.md`

## Why this packet

The 2026-08-06/07 orchestration run executed every lane of the local-first
program that could land without an author ruling. Everything below is now
blocked on decisions only the author can make. Each item carries its evidence
and a recommendation; none of the recommendations has been acted on.

Program state the decisions sit on (all on `main`):

- **Phase 2b (desktop ladder)** — promotion gate ran outside the sandbox at
  `e99d2a328`; settlement PoC and full suite PASS including the three
  fail-closed rollbacks; landed `54811f943`. Build is evidence-promoted at
  the first-rung stop/start boundary.
- **Phase 2a (browser ladder)** — coverage gate landed `27f7be470`:
  real-Chrome D5 37/37 byte-identical vs Node through IndexedDB; semantic
  coverage 12/13 = 92.3 % (PASS ≥90 %); common-path axis INDETERMINATE
  (item 3 below).
- **Phase 1 / Move 3** — evidence gate advanced 2026-08-03, Kanban exit
  accepted 2026-08-04; Lane-B re-verification reproduces green at HEAD
  (37/37 both sides; metrology 56/56). Residue: item 7 below and the
  provenance ticket (`issues/20260807-phase1-d5-receipt-provenance-refresh.md`).
- **Phase 0 (public half)** — browser public witness landed `5ef7950c3`:
  8/8 legs in real Chrome against the real runtime; three shipped client
  defects found and fixed by the witness
  (`whenLockSettled` adjudication, warm-establishment re-delivery,
  anonymous `/live/*` invalidation header). Ticket
  `20260801-guide-gap-js-arm-browser-indexeddb-proof` closed.
- **LLP 0043 leg 2 (sessions-custody offline queue)** — landed
  `55564b1018eb` (docs pin `91ee645ae`); the
  `SNAPBACK_OFFLINE_QUEUE_CUSTODY_UNSUPPORTED` fence is no longer
  producible; all four sitting-#3 rulings encoded; acceptance green against
  the real binary. Leg 1 (M1 lease custody) remains open.

## Decisions requested

1. **OQ7 — Phase 0 gate split-or-hold (LLP 0129 §Open questions 7).** The
   evidence now on main covers the Node/file/public half *and* the
   browser/public half. The authenticated/authorized conjunction witness
   remains open, triple-gated on M1 lease custody
   (`issues/20260731-js-arm-lease-custody-and-sessions-outbox.md` leg 1)
   and on this ruling. *Recommendation:* split the gate — record the two
   public halves as landed with dated pointers, keep the phase open on the
   authorized half, so SD-5 keys off an honest partial disposition.

2. **Phase owners and timeboxes (OQ5 remainder).** The 2026-08-03 ruling
   covered Phase 1 only, which has since exited. Phase 0's remainder
   (M1 lease custody + conjunction witness) and Phase 2a's disposition
   have no named owner or timebox. *Recommendation:* assign both at this
   sitting; the Phase-0 remainder has a prepared lane
   (board task: Lane A2) that can start on ruling.

3. **Phase 2a common-path designation freeze**
   (`issues/20260806-phase2a-common-path-designation-absent.md`). The OQ9
   gate's "designated browser common-path mutations" set was never frozen
   (Option B's `handler-coverage.v1.json` does not exist). Semantic and
   real-browser-D5 components PASS; the whole gate is NOT-DECLARABLE until
   the designation exists. *Recommendation:* freeze the designation (or
   bless a proposed set derived from the M1 admission census in the landed
   receipt: 22 ready / 10 refused / 5 server-only), then the existing
   runner re-runs and the gate becomes declarable without new build work.

4. **Decision-lab scheduling.** Sitting #4 ruling #8 lifted the OQ8
   scheduling bar; ruling #9 caps the lab at Outcomes 0/1 until a concrete
   Candidate B arrives with a named adjudicating owner. The lab (Candidate A
   under the exact proof protocol over the frozen Kanban/Calendar/Notebook
   manifests) is Move 4's prerequisite. *Recommendation:* either name an
   owner/timebox now or record an explicit deferral so Move 4's parked
   state is a decision rather than a drift.

5. **LLP 0107 strand-backstop bound**
   (`issues/20260804-optimistic-matcher-strand-backstop.md`). The
   ratified complete-receipt semantics leave a never-true `isAuthoritative`
   matcher stranding confirmed layers until store teardown. Option 1
   (bounded post-confirmation retirement) needs an LLP 0107 amendment
   ruling on what N/time bound is honest. *Recommendation:* rule the bound
   (or explicitly choose option 2/3); the fix is small once ruled.

6. **Zerobugs §13 durable-disconnected-intent candidate**
   (`demos/zerobugs/manifest/acceptance.v1.md` §13, awaiting ratification).
   The landed 0043 leg-2 queue plus the browser public witness provide the
   substrate its threshold names (durable-before-send ordering observable,
   browser-restart replay, exactly-once settlement, observer convergence
   all now have landed precedent on the public surface). *Recommendation:*
   ratify §13 as the primary-improvement candidate; its remaining delta
   over landed evidence is the authorized/revocation leg, which rides the
   same M1 lease-custody lane as item 2.

7. **Which artifact governs Phase 1's end-to-end slice.** The Phase-1 EXIT
   note (2026-08-04) records "OQ8's mechanisms shipped inside the program"
   via the Move-3 M1–M4 lanes; OQ8's pre-ruling body text still lists local
   execution, speculative receipts, and the receipt-wire freeze as
   "unshipped or owner-gated," and the owner-landing ledger's own text says
   rows 2–5 "still bar any `Parity`-by-construction claim," with rows 2–4
   unowned (row 5 now under LLP 0166 per ruling #10). *Recommendation:*
   state which artifact governs, and assign owners for ledger rows 2–4 —
   they are the concrete remaining Move-3 end-to-end work either way.

## Landed with this packet (not decisions)

- LLP 0129 §Open questions items 8/10/11 now carry inline ruling stamps
  pointing at sitting #4, matching item 9's convention (bodies retained).
- `issues/20260807-phase1-d5-receipt-provenance-refresh.md` filed for the
  three stale `sourceHashes` in the retained Phase-1 D5 receipt (content
  verified byte-identical at HEAD by the 2026-08-06 Lane-B re-run).

## Done when

Each numbered item has a dated ruling recorded in its owning document (or
an explicit deferral recorded here), and this ticket moves to
`issues/closed/` with pointers to those rulings.

## Resolution (2026-08-07)

Charlie Cheever ruled on all seven items on 2026-08-07. In every case the
ruling is **"recommendation accepted as stated"**, except item 3, whose
designation was **delegated to the orchestrating agent**. Dispositions and
landing locations:

1. **OQ7 — SPLIT.** Phase 0's evidence gate splits: the Node/file/public
   half and the browser/public half are recorded landed (browser public
   witness `5ef7950c3`, 8/8; the earlier Node/file evidence already cited
   in the Plan), and the authenticated/authorized half remains open,
   gating on M1 lease custody. SD-5 keys off this split disposition.
   Recorded: LLP 0129 §Open questions 7 (RULED 2026-08-07 stamp) and the
   Phase 0 §Phases dated note.
2. **Owners/timeboxes — ASSIGNED.** Phase 0's remainder (M1 lease custody
   + authenticated conjunction witness) and Phase 2a's disposition are
   both assigned to the standing orchestration lane (Charlie Cheever as
   deciding author, executing through the orchestrated fleet lane under
   session supervision — the Phase-1 formula,
   `issues/closed/20260803-p0-0129-phase1-ruling.md`), timebox ~one week
   each: Phase-0-remainder evidence presented by **2026-08-14**; Phase 2a
   disposition presented by **2026-08-14**. Recorded: LLP 0129 §Open
   questions 5 dated ruling, plus the Phase 0 / Phase 2a §Phases notes.
3. **Common-path designation — DELEGATED.** Delegated by the author to
   the orchestrating agent: "This whole project is about making something
   right for agents and you know agents better than I do." The frozen
   designation lands as the Option-B artifact
   (`tests/acceptance/fixtures/browser-lane/handler-coverage.v1.json`)
   with the delegation recorded verbatim in its provenance, and the
   coverage gate reruns against it in the same landing sequence.
4. **Decision lab — explicitly DEFERRED.** Reopen trigger, verbatim:
   "schedule the lab when a real application (zerobugs-class or a
   customer app) hits an expressiveness wall attributable to Candidate A,
   or when Move 4 becomes commercially wanted." Move 4 remains parked by
   decision, not drift. Recorded: LLP 0129 §Option-C empirical decision
   protocol, "When the lab can run" dated note.
5. **LLP 0107 strand backstop — options 2 + 3 RULED.** Absence-evidence
   retirement on the `projectRecordFields` path plus inspection
   surfacing. Recorded **here only** by design: a separate lane lands the
   LLP 0107 amendment together with the code, so neither `llp/0107` nor
   client code is touched by this packet's landing.
6. **Zerobugs §13 — RATIFIED.** Durable-disconnected-intent is the
   ratified primary-improvement candidate. Recorded:
   `demos/zerobugs/manifest/acceptance.v1.md` §13 dated ratification note
   (author: Charlie Cheever, 2026-08-07, via this packet); the remaining
   authorized/revocation leg rides the Phase-0-remainder lane (item 2).
7. **Phase-1 governance — the ledger governs the CLAIMS.** Phase 1 exited
   its evaluator/conformance slice legitimately; the 2026-08-04 EXIT
   note's "OQ8's mechanisms shipped" wording carries a dated correction
   (overstated; core machinery landed, ledger rows 2–4 remain); `Parity`
   labeling stays barred until rows 2–4 land. Row owners: receipt
   projection → LLP 0043 (dated acceptance in its header);
   schema/identity fencing → LLP 0081 (dated acceptance in its header);
   partial-read admission → retained in LLP 0129 with the orchestration
   lane as implementer. Recorded: LLP 0129 §The owner-landing ledger rows
   2–4 dated assignments + the Phase-1 EXIT dated correction at §Open
   questions 5, and the LLP 0043/0081 header notes.

All rulings are summarized in LLP 0129's consolidated 2026-08-07
"author gate packet RULED" Revised entry.
