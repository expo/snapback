# LLP 1018 move two — count-backed cap probes lane review (Grok 4.6, xhigh, blind)

**Change:** `s2/clique-cap-count` — the engine's cap probe reads a same-`by` maintained count, the certificate reserves one row per write, the `E_BOUND` rewrite pastes the declaration, twin parity, corpus cases, LLP 1017/1001 amendments. Round 1 reviewed the lane's first commit (13e30e288 pre-rebase); round 2 the fix (cb1ce9d5c pre-rebase). Landed SHAs are recorded in LLP 1018 §10.
**Implementer:** codex `gpt-5.6-sol` at xhigh (lane); the fix round by the orchestrator.
**Orchestrator:** Claude Fable 5.1, session `session_01N6HHCXSkeacu8sJfsUH38L`.
**Provenance:** every review below was actually received from the named model; verbatim text per round; the two reviewers never saw each other's reviews.

| Round | Reviewed | Verdict |
|---|---|---|
| 1 | the slice | VERDICT: READY (minor 1, the stale LLP 1017 non-claims, fixed in the round-2 commit; minors 2–4 recorded as accepted) |

## Round 1 (verbatim)

## MATERIAL

None.

## MINOR

- **`llp/1017-cap-and-complete-fanout.rfc.md:78` and `:585`** — The summary and §6 still say “no maintained-count-backed cap check (a ticket)” while §2.4’s implementation record (`:300–309`) and LLP 1001 §9 say the opposite. A later reader can take the non-claim as current law.
- **`snapback2/packages/evaluator/src/runner.ts:881–898` vs `runner_ops.rs:492–500`** — Unheld, unproven count: the engine marks missing authority and skips the probe; the twin still scans the enforcement index and `hasCompleteRange`. Not an over-admit (Partial does not adopt writes; a complete scan is honest coverage), but it is not the same local outcome as the Rust client.
- **`snapback2/crates/snapback2-core/src/certificate/diagnostic.rs:114`** — Pasted name is `{table}Counts` (`membershipsCounts`, `followsCounts`). Valid Quarry and it materializes a target, but it is an odd double plural next to the template’s `memberCounts`.
- **`snapback2/crates/snapback2-core/src/engine/mod.rs:292–304`** — `Engine::seed` still bypasses maintain. A later count-backed probe on StoreAuthoritative treats a missing count as 0, so test-only seeded source rows can undercount. Product `Registry::seed` goes through insert+maintain and is fine.

## REFUTED-RISK

- **In-transaction exactness** (`runner_ops.rs:23` then `:48`; `cap_tests.rs:203–351` and `:353–474`). Probe runs before the row lands; `maintain` updates the count after. Same-group inserts in one program see 0,1,2,…; four inserts under cap 3 refuse at the fourth and roll back (Exists m1 is false). Deletes never probe (`:476`). Group-moving updates probe only the destination (`:471–474`) with `maintained_group` on `new`. Product seeds are upserts through this path (`registry.rs:1153–1176`).
- **Authority.** StoreAuthoritative / proven-absent missing count is 0 (`runner_ops.rs:502–506`). ReceiptOnly + unproven miss is `mark_missing_authority` and `continue`, not zero (`:492–500`); the mutation rolls back (`engine/mod.rs:662–678`). Twin: held row or `authorityAbsence` is the one-row probe (`runner.ts:874–880`); otherwise scan, never a fabricated zero. ClientStore does not adopt Partial writes (`client.rs:73–78`; TS `store.ts:91–93`). The 49-principal corpus case predicts only because the receipt holds 49 count=0 rows; without them the twin marks incomplete ranges and does not adopt.
- **Successor / rebuild.** `caps::validate_caps` (`successor/caps.rs:13–42`) still counts **base rows**, not the maintain target. Rebuild writes the target via `write_aggregate_row` (`engine/mod.rs:964–988`) and never re-checks source caps through the count. A new count after data exists is rebuilt; a retired maintain makes `count_maintain` miss and the probe scans again.
- **Certificate.** Enforcement index stays in `indexes_required`; `{target}.byId` is added (`certificate.rs:521–528`). `constraint_checks` keeps `memberships:Cap(...)` and adds `membershipCounts:Cap(...)` so the byId trace is in the certificate (`:600–604`). `canonicalSchemaJson` already hashes `tables.constraints` and `maintains` (`certificate-identity.ts:26–36`, `:177–183`); no extra identity field is required. Chat `groupCreate` is 50 examined / 50 index / 250 steps and still lists `memberships.byConversationPrincipal` and `memberCounts.byId` (`quarry-fanout-checks.ts:82–87`). Unbacked 49×1000 is `examined entries 49000` with the pasted maintain.
- **Rewrite.** `maintain {table}Counts = count {table} by {cols}:\n  read <- deny` (`diagnostic.rs:112–116`) is a complete Quarry maintain: colon, 2-space body, required `read <-` (`parser.ts:287–309`). `materializeMaintains` infers the target table, `byId`, grouping index, and deny write rules (`quarry/index.ts:153–200`). Emitted only for unbacked caps with `max > 1`. Column order is the cap’s `by`.
- **Files / process.** No file over 1,500 (`certificate.rs` 1398, `runner_ops.rs` 1333, `export_corpus.rs` 1478). No new gate, registry, or config. `certificationRewrite` is an optional corpus field, not a drift registry.

VERDICT: READY
