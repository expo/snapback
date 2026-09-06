# Indexed client coverage replacement must preserve state on refusal

Status: Open
Date: 2026-09-06
Scope: indexed-client branch `s2/clique-search-twin`, observed at `02a5b980b705d4cfacea6d06dd04e0d9ae654e6d` and its parent `4e927c26df5b1cec4f2ce885f9521474586b54a3`; not a claim about a published package.

Fresh native Astra xhigh review reproduced two inherited P2 defects in the evaluator coverage/store boundary. The focused receipt-body ownership delta received READY; that approval does not clear these defects or the remaining resource limits.

1. Give one receipt owner two identical absence entries, then remove or replace that owner. `CoverageIndex` keeps duplicate per-owner identities but counts owners in a Set. Removal deletes the last map entry on the first occurrence and throws on the second, leaving removal partly applied and invalidation incomplete. Two distinct owners sharing the same absence work in the retained control. The duplicate envelope passes the actual delivery decoder and receipt tagger; no native owner emission or end-to-end native delivery is proven.
2. Start a standalone `ClientStore` with a row and valid absence, then rehydrate with no rows and a nonboolean verdict. Rehydration deletes prior rows and resets coverage before rejecting the incoming proof with `E_INPUT`. The old row and absence are lost. This is malformed private standalone input; public verdict decoding checks booleans. It is not a demonstrated public authorization bypass.

Required resolution: deduplicate each owner's absence identities while preserving distinct-owner counts, and prepare/validate or transactionally apply whole-store rehydration so rejected input leaves rows, proofs, registered directories and dependencies unchanged. Cover replacement and removal, seed and non-seed owners, malformed replacement, and valid final-state invalidation with source-bound parent/candidate regressions. Preserve the ownership change's absence of retained full receipt bodies.

Both cases were independently reproduced on parent and candidate with a bounded copied-source Bun probe. Root read the complete report; supervisor verified the 392-file review packet, 54 copied parent/candidate source inputs and executable/probe/output bindings with no mismatch. No new native or broad-suite run is implied.

Original evidence: `/Users/ccheever/clique-improvement/reviews/receipt-ownership-02a5-r1/astra/REPORT.md`, `probe.ts`, `probe.log`, `probe-inputs.json`, and `../astra-supervisor-verification.json`. The second independent review is still running. Corrections are authorized in the same native Astra writer after the currently active carrier-local consolidation stage releases; this ticket does not expand that active stage.
