
## Precedent #3 — 2026-08-10 (remediation carrier + connected-client landing)

The consolidated LLP 0146 OQ6 + LLP 0222 landing changes
`packages/snapback-client/index.mjs` (remediation-set decoder,
connected-client typings), so the retained local-persistent-store receipts
are stale again in exactly the class this ticket records. The remint remains
blocked on the same signed-activation ceremony
(`issues/20260809-signed-composition-activations-need-remint-after-s0-toolchain-rotation.md`).
Following the S0 and clique-defects precedents: pushed with the documented
loud bypass, with this note as the record. Every other gate obligation was
run manually in the landing worktree first (module-ownership PASS with both
new modules assigned and one reviewed frozen edge; guide/check-inventories/
ref-check/diary-identity/contract-meta PASS; deployment-identity
regenerated; full targeted Rust + JS suites and clippy all-targets green).
The scheduled backstop continues to dedupe against this open ticket.
