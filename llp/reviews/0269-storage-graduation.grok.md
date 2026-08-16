# Review artifact: LLP 0269 — grok family

Target: `llp/0269-storage-graduation.plan.md`

## Round 1 — 2026-08-16

- **Reviewer:** Grok 4.6 (`~/.grok/bin/grok`, --reasoning-effort xhigh,
  --disable-web-search), fresh non-interactive session, blind to the other
  family's review.
- **Revision under review (v0.1):** sha256
  `718350775234c41f2ee92894ff1a9a14d4d5540c4bcb59e20ca1ae4d10f435d5`
  (authoring-worktree bytes, pre-commit).
- **Verdict:** NOT READY.


1. SEVERITY: MATERIAL — `llp/0269-storage-graduation.plan.md:161` (§1.3 Phase 1 exit)  
   The exit gate says “Capability publication also follows LLP 0113 §6; adapter presence is not runtime support.” Opened `llp/0113-qualification-and-publication-authority.spec.md`. **§6 Acceptance** (line 688) is the acceptance corpus for the qualification/publication-authority machinery itself: candidate data isolation, grant/use journals, provisional CAS crash points, service-intermediate negatives, nine-package ledgers, and GitHub-hosted package receipts. It is not a rule about storage adapters or Postgres support facts. The nearby true rule is in 0113’s Summary/§1/Status: runtime support stays false until the verified claim family is finalized; accepting a spec or landing code does not flip support. As written, an implementer would treat the 0113 grant/CAS/GitHub corpus as the Postgres publication gate, or would fail to find any adapter-support rule at the cited section.

2. SEVERITY: MATERIAL — `llp/0269-storage-graduation.plan.md:146` (§1.3)  
   The Plan says the performance A/B “reports the separated clocks from LLP 0265 §§2–4, including admission, commit acknowledgement, settlement, and convergence.” Opened `llp/0265-runtime-performance-championship.spec.md`. **§2.2** (lines 176–205) names four families: optimistic paint, commit acknowledgement, settlement, and observer convergence. There is no admission clock; §2.1’s events are `T0` / `Tpaint` / `Tack` / `Tsettle` / `Tconv`. **§3** is the arm matrix; **§4** is load curves and health, not clocks. “Admission” is 0128’s measurement vocabulary (`llp/0128-popular-app-storage-scale.research.md:552`), not a 0265 family. A Phase 1 A/B built to this sentence will invent a metric 0265 forbids substituting for ack/settlement, and will miss paint.

3. SEVERITY: MATERIAL — `llp/0269-storage-graduation.plan.md:144` (§1.3 / Phase 1 exit)  
   Phase 1 requires “the same offered-load grid, dataset manifest, authorization shape, observer population, correctness receipts, and cost calculus,” plus “N≥3 correct repetitions per engineering cell.” Opened 0265 **§1.2** (lines 117–127): the committed harness does **not** provide frozen offered-load grids, cost collection, idle billing witnesses, N≥3 orchestration, p95/p99 curve publication, or an LLP 0189 qualification record. This Plan never lists implementing that instrument (or a named subset) as Phase 1 work. Trigger 1 in §0 can fire without the championship existing, so the A/B exit cannot actually gate. “Engineering cell” is also undefined against 0265’s “complete configuration” and 0189 D-8 axis cells.

4. SEVERITY: MINOR — `llp/0269-storage-graduation.plan.md:115` (§1.1)  
   The Plan says `MutationWritesKernel` and `VersionsKernel` “each holds a `LocalDatabase` reference and several operations still accept rusqlite types.” The `LocalDatabase` field is true (`src/storage/mutation_writes.rs:638–640`, `src/storage/versions.rs:254–256`). The rusqlite-typed operations are not: those kernel methods take `MutationPlan` / `HandlerInput` / version integers, not `rusqlite` types (no `rusqlite`/`Transaction`/`Connection` parameters on either kernel impl). The rusqlite `Connection` leak is on `DbRead::Pinned` in `src/storage.rs:6862–6865`, consumed by `QueryReadsKernel::with_pinned_read_view`, which this sentence does not name.

5. SEVERITY: MINOR — `llp/0269-storage-graduation.plan.md:108` (§1.1)  
   “Make it async and transaction/lease-aware per LLP 0007 §Transactions and Atomicity and LLP 0046 §Prerequisite.” Opened `llp/0007-storage-portability.spec.md` **§Transactions and Atomicity** (line 587): atomic write boundaries, read-set validation, durability vocabulary — no async/lease-aware mandate. That sentence is in **§Export and Engine Graduation** (lines 778–783). 0046 §Prerequisite does quote it correctly. The requirement exists; the 0007 section pointer does not.

6. SEVERITY: MINOR — `llp/0269-storage-graduation.plan.md:43` (§0)  
   The Plan sequences “a larger concurrent single-authority cell (family B).” Opened 0128: **family A** is larger single-authority cells; **family B** is “Postgres authority plus commit-order changefeed” (line 299). Phase 1.2 then makes the framework journal the support baseline and treats the WAL/LSN feed as a non-blocking spike (lines 123–129), which is 0007 DK-2 / 0046 fencing plus 0128 Finding 4, not family B’s defining feed. The later text is explicit; the family letter is not.

7. SEVERITY: MINOR — `llp/0269-storage-graduation.plan.md:88` (§0.2)  
   Invariant 3 cites “LLP 0128 §Contract guardrails 2–4” for “schema and bounded-operation manifests declare placement; runtime code does not infer it.” Opened 0128 lines 500–506: guardrail 2 is sequence scope, 3 is naming the atomicity domain, 4 is declared placement. Only 4 supports that sentence.

8. SEVERITY: MINOR — `llp/0269-storage-graduation.plan.md:89` (§0.2) and `:265` (§2 exit)  
   The Plan defines **cell** as a transactional authority domain, then says claims “name only evidenced cells … (LLP 0189 D-8)” and that Phase 2 evidence is “cell-explicit under LLP 0189 D-8.” Opened `llp/0189-verification-cadence-and-claim-gating.decision.md` **D-8** (lines 239–273): D-8 cells are axis combinations (auth mode, live-query family, scope construction, client arm, transport), not storage partitions. Applying D-8’s refuse-by-name / don’t-extend-evidence rule to transactional cells is reasonable Plan law; citing D-8 as if it already names storage cells overloads the word this document just defined.

## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Grok 4.6 xhigh session; delta review of v0.2 against
  both round-1 reviews.
- **Revision under review (v0.2):** sha256
  `f8d18fc61b609cdedf3bc39ef406e01b7c89dcf6abecb64094f66bb5a6533e46`.
- **Verdict:** READY (all round-1 findings verified fixed; no new defects).
