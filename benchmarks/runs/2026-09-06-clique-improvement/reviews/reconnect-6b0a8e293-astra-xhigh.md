# Independent reconnect code review

**Verdict: READY**

**Reviewed revision:** `6b0a8e2937d3754e575aba9b2ffe51cee0c7b1ef` against `21b21abd361c72fb7da968a0ae06ed82ef7436cc`, as supplied in the immutable review packet. Review date: 2026-09-06. Reviewer: Astra, independent source review.

No material changed-path defect found. The fix admits the intended sequence-only re-delivery while preserving content conflict checks, pooled-row sequence guards, and the existing atomic commit boundary.

## Scope and contract

Inspected the store change and its source-level dependencies: conditional admission, runtime authority checks, persistence projection and carriers, overlay retirement, and the owner/client resume path. Governing constraints are LLP 1012 §4 (atomic per-principal swaps), §7 (authoritative overlay retirement), and §8 (conditional validation and full re-delivery). Repository instruction files were read for scope. No other review or benchmark application was consulted; no tests, builds, network access, or source modifications were performed. The only written artifact is this report.

## Findings

1. **The sequence normalization is narrow.** At `snapback2/packages/snapback2/src/store/range-store.ts:1065`, the fingerprint payload preserves the previous field set: operation, arguments, state, data, next cursor, sequence, validator, receipt, rows, reason, and rule. At line 1078, the alternative comparison substitutes only the persisted original full-delivery sequence. It never reconstructs old content from shared rows and never accepts validator equality by itself. If the old full sequence equals the incoming sequence, the original conflict refusal remains in force.

2. **The intended transition follows from the code.** A full delivery at sequence 10 installs its digest and `nextSeq = 10`. Conditional refresh to 11 changes the held sequence but leaves both those fields bound to 10 (`range-store.ts:1040`). An identical full body at 11 therefore fails the direct digest comparison but passes comparison with sequence 10. It then proceeds through normal admission, installing the new digest and `nextSeq = 11` together (`range-store.ts:1136`). Changing any fingerprinted content field still refuses, even if the supplied validator is unchanged. A later byte-identical full delivery at 11 takes the existing duplicate no-op. Older frames remain ignored before the new branch.

3. **Shared-row conflicts still refuse atomically.** Successful normalization does not skip the pool loop (`range-store.ts:1084`). If another query already installed a different body for the same table/id at the incoming sequence, the row guard throws at line 1093. Rows with a strictly newer sequence are not overwritten; negative evidence remains effective. Coverage swaps operate on a clone, and `this.state` is published only after successful backend replacement (`range-store.ts:748`). A content conflict or a later pooled-row conflict therefore cannot leave a refreshed fingerprint, cursor, watermark, settlement, or overlay change partially committed.

4. **Persistence preserves the evidence used by the fix.** Full admission already wrote `nextSeq` before this patch; refresh initializes a missing value from the held sequence before advancing it, and later refreshes retain it. Carrier projection stores complete answer records, so reopen preserves both `nextSeq` and the digest. Existing normalization hashes legacy canonical-string fingerprints without changing their content. A missing `nextSeq` uses the held sequence conservatively; this code does not invent a lost original sequence or bypass conflict checks for an unproven legacy snapshot.

5. **Authority and continuation boundaries remain intact.** `OfflineRuntime.commitMany` checks current coverage revision, partition principal, authenticated epoch, and generation/schema custody before constructing store deliveries (`offline.ts:500`). This patch introduces no alternate entry around those checks. For continuation retirement, conditional refresh leaves `nextSeq` unchanged, and `cursorChain` requires a link recorded at or after the committed sequence (`store/overlay-retirement.ts:38`). Only a successfully admitted full delivery can renew the link in this changed path. Retirement still filters for intact, nonempty held pages and the selected query's proven cursor chain. A rejected full delivery cannot supply that evidence because the whole draft is discarded.

The reachability explanation is also supported by source: the owner returns an unchanged log only when the tail is empty and its validator matches (`writer_resume.rs:172`), while the client commits resume deliveries before draining the outbox (`client-offline.ts:472`). A valid full log at an already conditionally refreshed sequence can therefore encounter precisely the repaired comparison.

## Evidence limits

The implementation report claims nine failing-before/passing-after regressions, real-owner reductions for two nested-join spellings and a plain page, and a successful full script with 431 package tests, 753 Rust tests (four skipped and one leaky passing test), 216 evaluator cases plus two visibility checks, and 400 compiler checks. Those are implementation claims, not reviewer executions or independently verified logs.

This verdict makes no new browser, simulator, publication, or historical-incident acceptance claim. The optional browser witness reportedly stopped at bundling, and the missing raw sequence-1754 frames leave the precise historical field difference unestablished. Neither limitation undermines the source-level correctness of this bounded fix.
