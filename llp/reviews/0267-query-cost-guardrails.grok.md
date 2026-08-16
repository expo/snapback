# Review artifact: LLP 0267 — grok family

Target: `llp/0267-query-cost-guardrails.rfc.md`

## Round 1 — 2026-08-16

- **Reviewer:** Grok 4.6 (`~/.grok/bin/grok`, --reasoning-effort xhigh,
  --disable-web-search), fresh non-interactive session, blind to the other
  family's review.
- **Revision under review (v0.1):** sha256
  `c402362b6fd1b2dfd22d719db24be806536b7322f68514e2d392b5d7c27d2363`
  (authoring-worktree bytes, pre-commit).
- **Verdict:** NOT READY.


1. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:69` (§1.2)
The account of shipped per-query measurement is incomplete in a way that would leave a second bounds system in place. The RFC says `src/storage.rs` “currently has only” the `single_table_v1` 1,024 examined-entry guard, `cfg(test)` `KeysetScanStats`, and generic execution with no successful examined-entry count. I opened `src/storage.rs`: those three exist (`query_on_with_examined_entry_ceiling` / `SNAPBACK_SINGLE_TABLE_EXAMINED_ENTRY_CEILING_EXCEEDED` at 6199–6213; `KeysetScanStats` at 5987–5998; generic `query_on` with `examined_entry_ceiling: None`). The same file also ships `RelationalExecutionObservation { examined_root_entries, joined_lookups }` (5743–5750), filled as `examined_root_entries: root_window.rows.len()` (5871–5873) — result count, not physical candidates. `src/local.rs` already refuses on those facts: snapshot-batch children use `let examined = child_output.rows.len()` against `identity.node_examined_entry_ceilings` (31412–31415); relational nodes refuse `SNAPBACK_SNAPSHOT_BATCH_CEILING_EXCEEDED` when `examined_root_entries` or `joined_lookups` exceed owner-pinned ceilings (30775–30780, 31480–31486). `src/manifest.rs:5624` hard-pins `single_table_v1` `examined_entry_ceiling: 1_024`. The RFC never names those codes, never says they are result-count substitutes (which §1.2 itself forbids), and never decides whether `queryCost` replaces them. An implementer following §1.2 would add a parallel accumulator beside the already-enforced examined-entry machinery that G0 is supposed to inherit.

2. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:324` (§4.3)
§4.3 states “LLP 0209 §8 requires one pure `QueryCostPolicyV1` shared by local and server.” I opened `llp/0209-live-graph-profile.spec.md` §8 (368–397). That section is the D2–D3 interface: “One IR, two evaluators,” byte-identical graph results or `unknown`, and “Refusal parity. A graph the server would refuse (bounds, policy, admission) must refuse identically locally.” It does not name `QueryCostPolicyV1`, a host policy type, or src/local.rs-vs-src/server.rs sharing. The commission’s “local parity per LLP 0209 §8” is that graph-evaluator rule. The RFC then says “Clients do not reimplement it,” which is the opposite of a D3 local evaluator applying the same refusals. A shared host function is allowed as new work; presenting it as already required by §8, and treating that as fulfilling the charter’s §8 parity decision, would send implementers at the wrong seam.

3. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:121` (§1.6, §3.4, §6)
The 1,000 ms live-turn rule cannot be implemented from the text as one threshold. §1.6: each fixture cell takes ≥3 warm samples; “Evaluation and memo-delivery bases are their respective maxima × 1.25.” §3.4 item 3 refuses when “a live real-evaluation or memo-delivery basis is at least 1,000 ms.” Item 1 also refuses when a *measured* signal exceeds the effective hard maximum (instance `maxUnpreemptibleLiveTurnMs` = 1,000 at §2.2:189). Then §3.4:266 and §6:373 say “999.999 ms is below it; 1,000 ms refuses” and “Boundary fixtures at 999.999/1,000/1,000.001 ms must pass/refuse/refuse.” Those cannot all be true of a measured turn: 999.999 ms × 1.25 = 1,249.999 ms, which item 3 refuses. The only measured basis I opened is LLP 0209 §1 (57–58): one 5.5M-row evaluation p50 863 ms, max 3.6 s; v0.3 still records a ~900 ms real evaluation (544–545). Under §1.6 that p50 is already a 1,079 ms basis and refuses, so the “hard live-turn refusal boundary” in the instance table is 800 ms of measured time, not 1,000 ms. The RFC never says the 999.999 fixtures are post-scale policy inputs. An acceptance author writing a 999.999 ms *turn* and an admission author trusting the 1,000 ms table will build different gates.

4. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:227` (§1.1, §1.3, §3.2–3.3)
The ladder cannot be evaluated from the signals the observation defines. §1.1’s five signals are total `scannedRows`, `index ranges consulted` as “normalized consultations,” `resultBytes`, `evaluationTurnMs`, and the fan-out estimate. §1.3:89–90: range rows expose table, selected index or `fullScan`, bound shape, and `consultations`; `indexRangeCount` is their sum — not rows visited per consultation. §3.2:227–229 requires: ledger contains `fullScan` **and** “that consultation visits more than `maxUnindexedScannedRows` entries.” A mixed plan (full scan of 10 plus an indexed range of 300) cannot attribute 10 vs 300 from a total of 310 plus a `fullScan` flag. §3.3:241–242 and the §3.1 warn examples (214–216) require result *row* count (`maxUnpagedRows`, “128 unpaged result rows”). Row count is not one of the five signals, and §4.3’s policy inputs are declaration, target capability, instance config, qualification, and observer groups — not the result value. Offset pagination is correctly rejected; that does not supply the missing measurements. Implementers will have to invent a sixth signal and per-range scan counts, or silently substitute result count, which §1.2 forbids.

5. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:339` (§5)
Unification with LLP 0209 G0 is not a decision an implementer can execute, and one row misstates §2. I opened 0209 §2:120–123 and 0183 D2:283–286: every admitted graph declares **root, examined-entry, relationship, fanout, argument, byte, summed-window, and maintained-write** bounds, sized from fixtures; 0209 §9:415–417 repeats that G0 pre-commits no numbers. The RFC table (343–350) maps “root / examined-entry” together onto `maxScannedRows` with only “contributes to” / “per-node scan attribution,” and “relationship / fanout” onto “range consultations and structural child work,” with no rollup (sum vs max vs per-node check) and no code for a per-node miss vs `SNAPBACK_QUERY_COST_BOUND_EXCEEDED`. Those first two pairs are distinct in 0209/0183 and in shipped snapshot-batch (`take` vs `node_examined_entry_ceilings` vs `node_joined_lookup_ceilings`). The table also lists **live fanout** as a “G0 bound”; it is not in the 0209 §2 / 0183 D2 list. “One accumulator rolls them up” and “no `g0Bounds` twin” are architecture, not the consumption rules the commission asked for. Two G0 implementers can still build two different systems inside `queryCost`.

6. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:140` (§2, §2.2)
Charter item (b) — where each ladder threshold lives, and whether instance config may loosen it — is not closed. The §2 title says “instance policy may only tighten” the declaration. §2.2:192–196 says the effective value is min(declaration, target capability, instance) and that instance “may lower a default but may not raise” only four absolute ceilings: 4 MiB, 1,000 ms live-turn, 1,000 ms fan-out, 512 ranges. `maxUnindexedScannedRows` (256), `maxUnpagedRows` (256), and `maxUnpagedResultBytes` (256 KiB) are the index and pagination rungs and are **not** on that list. Combined with §2.1:157–159 (a `fullScan` is admitted only when its declared scan bound is ≤ the instance unindexed threshold), raising instance 256 to 10⁷ would admit huge full scans. The RFC never says those 256s are absolute, declaration-only, or operator-raisable. That is a missing decision on the charter’s require-index / require-pagination thresholds.

7. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:94` (§1.4)
`resultBytes` is specified as “exact canonical JSON length after result-contract validation.” I opened `src/result_contract.rs:76–84`: the shipped 4 MiB ceiling is `serde_json::to_vec(value).len()`, not JCS. LLP 0108:283 uses “canonical” / JCS for contract *identity* hashes, not this byte ceiling. If implementers use JCS here and `serde_json` there, the same result can pass one bound and fail the other.

8. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:295` (§4.1)
`SNAPBACK_QUERY_COST_INDEX_REQUIRED` / `PAGINATION_REQUIRED` are defined as “crossed 256” / “256 rows or 256 KiB.” Those are only the §2.2 defaults. The details payload correctly has `limit`; the register text will be wrong if instance config lowers those knobs (which §2.2 explicitly allows).

9. SEVERITY: MINOR — `llp/0267-query-cost-guardrails.rfc.md:247` (§3.3)
`notPageable` is allowed for “point, scalar, and closed-small aggregate contracts,” but “closed-small” is not sized against `maxUnpagedRows`. The shipped `single_table_v1` surface is a no-cursor whole result with a 1,024-entry examined ceiling (`guide` capability index; `src/manifest.rs:5624`). Under §3.3 a 1,024-row whole result needs keyset pagination, which that capability cannot express. The RFC does not say whether that class is `notPageable`, withdrawn from production, or exempt.

## Round 2 (delta) — 2026-08-16

- **Reviewer:** fresh Grok 4.6 xhigh session; delta review of v0.2 (sha256
  `bf7607970ba94a1b2fbe0ddda2eb5a21a8607b2f4ba7d5bd6004e76e3b2f0943`).
- **Verdict:** NOT READY (3 findings, including the convergent
  `query_cost_terminal` offer-gating defect).


1. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:59` (§1.1/`§1.5`/`§1.6`)
`executionKind` now distinguishes `liveEstablishment` from `liveReevaluation`, but only two timing seams are bound, and executed samples are pooled across both. Finite `evaluationTurnMs` inherits the `FUNCTION_QUERY` span (`src/local.rs:27329-27378` on the file-backed read lane; the mutex lane at `8252-8298` is the same span). A live scheduler turn inherits `CurrentLiveEvaluation.started_at` through `finish_current_live_evaluation` (`src/local.rs:23891-23967`), which encloses the nested query span **plus** serialize/enqueue. Live establishment is a third shipped path: subscribe wraps only `execute_query_invocation` in `FUNCTION_QUERY` (`src/local.rs:15910-15948`) and returns the first snapshot on HTTP, never `CurrentLiveEvaluation`. §1.6 then says real vs memo samples are “selected by status and never pooled” (line 119), so every `status: "executed"` sample — establishment, reevaluation, and any finite run of the same function — feeds one `rawRealEvaluationMaxMs`. Those measurements do not contain the same work. LLP 0209 §1 recorded ~61–68 MB of six-observer frame bytes; serialize/enqueue on that shape is large enough to flip the 800/1,000 ms gate. A qualification author who warms subscribe/`FUNCTION_QUERY` and a runtime that compares `CurrentLiveEvaluation` to the same refuse-at boundary will not build the same 1-second rule.

2. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:469` (§3.4)
`query_cost_terminal` is a new `LiveEnvelope` kind, but new durable kinds are not free additions. LLP 0094 §0C.2 (`llp/0094-wire-envelope-contract.spec.md:738`) and LLP 0093 (`llp/0093-client-protocol-and-native-clients.rfc.md:343-347`) require every new kind to be offer-gated on the CurrentAsOf pattern; `resync_required.reason` is the documented ungated escape hatch, which this RFC correctly rejects because both full and micro clients auto-resubscribe (`packages/snapback-client/index.mjs:13225-13246`, `13708-13765`; `packages/snapback-client/micro-live.mjs:177-180`). The RFC names no offer, no subscribe admission that requires it, and no fallback for a connection that did not offer. Shipped unknown-kind behavior is skip-not-crash (micro returns; full `applyDurable` only matches known `LIVE_DURABLE_KINDS`), so an ungated frame is neither terminal nor a resubscribe. An implementer cannot simultaneously obey this RFC, keep quarantine from being bypassed, and obey the accepted wire rule.

3. SEVERITY: MATERIAL — `llp/0267-query-cost-guardrails.rfc.md:595` (§5 summed-window)
The new window ledger both “stop[s] before charging a unit that would exceed” a remaining budget and “may publish” a page that reaches a maximum without a successor, while “exceeded maximum refuses the page; no result … is published.” When remaining `maxWindowScannedRows` (or root/row/byte/range) is smaller than the work needed to fill the declared page, those sentences split: one implementer publishes a short terminal page, the other refuses. A published short page with no continuation is indistinguishable from end-of-data and is not a 0209 completeness label (`prefix` / `window` / `refused` in `llp/0209-live-graph-profile.spec.md:190-199`). Two G0 implementers will not build the same summed-window system, and the publish-short reading silently truncates a keyset result.

## Round 3 (delta) — 2026-08-16

- **Reviewer:** fresh Grok 4.6 xhigh session; delta review of v0.3 (sha256
  `9dd28cd5baf8a4c4b93e2bbcf0572f7159310630fd70a3becef5cf31ef71341e`)
  against the round-2 findings.
- **Verdict:** READY. (The subsequent v0.4 delta was limited to the codex
  round-3 residual — the mixed-bundle timing seam — and was verified by the
  codex family's round-4 pass.)
