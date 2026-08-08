# LLP 0166 finish-out residue

**Status:** Closed 2026-08-07
**Opened:** 2026-08-04
**Related:** LLP 0166 §D1–§D9; LLP 0135 OQ5;
`issues/closed/20260804-llp-0166-finish-out-program.md`

The 2026-08-04 listener-capable run produced the Triage 8/8 receipt, the
16 PASS / 1 Fleet GAP / 0 skipped carrier exit, and the immutable
result-transform supplemental baseline. The local contributor-source manifest
now publishes `single_table_v1@1`. Its current result-transform profile is
14,803 / 5,243 / 4,674 minified / gzip / Brotli bytes. Those completed items
are not residue.

The following work genuinely remains:
- **Fleet footprint/hydration row.** Remains an honest carrier-exit GAP. The
  LLP 0135 OQ5 product branch was ruled 2026-08-05: admit
  `relational_query_v1@1` narrowly through reserved `snapshot-batch.v2` /
  `sbsb2`. **The reviewed exact profile registration landed 2026-08-06 as
  LLP 0157 v0.11** (dual-family super-refine loop; §D1 registry row, §D8
  `sbsb2` cursor record/budget/total outcomes, §D4 classification, A14
  oracle, and the specified cross-language parity-vector obligations;
  boundary notes in LLPs 0080/0110/0135/0166). The row now waits only on
  implementation, the frozen cross-language vectors, and the fresh Fleet
  measurement (LLP 0157 §D1's gate list is canonical). Do not replace it
  with a synthetic application or inferred measurement.
- **LLP 0110 §1.1 stale `ParentIncarnationV1` spelling.** Review residue
  from the v0.11 loop (Claude R2 N10, pre-existing): §1.1 still shows the
  historical `sbpi1.<…>` spelling while the round-3 reconciliation (which is
  normative on conflict) and the shipped code use a canonical UUIDv7, and
  both cursor budgets now lean on the 36-byte template. Cheap owner edit:
  delete or annotate the §1.1 spelling.
- **DK-9 diagnostic spelling — Resolved 2026-08-05 by owner-document
  reconciliation.** LLP 0008 DK-9 and LLP 0166 §D1 now state that
  `SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE` is the authoritative emitted code for
  the successor RQS store, while DK-9's generic
  `SNAPBACK_CLIENT_STORE_LOCK_UNAVAILABLE` text is its semantic/documentation
  alias and remains emitted only by the predecessor localStorage adapter. No
  code was renamed or dual-emitted. A `rg --text` audit of `src/`, `packages/`,
  and `tests/` found two occurrences in two files for each spelling: one
  emitter and one matching test per carrier family.

The Fleet row remains open, but its owning product decision is made and its
reviewed successor amendment landed 2026-08-06. Its remaining blockers are
implementation, the frozen cross-language vectors, and the fresh witness;
the DK-9 owner-text residue is closed above.

## Resolution (2026-08-07)

Both remaining items are done; nothing residual is tracked here.

- **Fleet footprint/hydration row — CLOSED 2026-08-06** by the sbsb2
  implementation program, not by a synthetic substitute. On `main`:
  the §D8 budget-template reconciliation plus `sbsb2` codec, class-tagged
  admission, and mixed-batch executor (`1420e528e`, `4232b77ee`,
  `6b106f510`, `8299374c2`, fan-out `8743cf3cc`); the frozen cross-language
  parity vectors (`tests/fixtures/snapshot-batch-sbsb2-parity-v1.json`,
  sha256 `0f809791ade6f4524bb0ce5eb8f31bcc9b93b1d236bb0afce693759e5c102951`,
  exercised by the Rust emitter and
  `tests/conformance/snapshot-batch-sbsb2-parity-v1.mjs` in the local
  proof, gate classified in `7b7d4c0df`); and the real Fleet Observatory
  Move-1 app + fresh workload receipt
  (`demos/zero-bakeoff/apps/fleet-observatory`, witness `9ee550d57`,
  receipt
  `tests/acceptance/fixtures/fleet-observatory/move1-exit.2026-08-06.v1.json`,
  8/8 gates). The carrier-exit GAP flipped honestly in `29d4c3d46`:
  `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json`
  records **17 PASS / 0 GAP / 0 skipped** (prior state: 16 PASS / 1 Fleet
  GAP), with the Fleet leg validating the qualified receipt. LLP
  0157/0135/0166 carry the dated closure notes; maturity remains
  experimental and remote/hosted remain explicit nonclaims.
- **LLP 0110 §1.1 stale `ParentIncarnationV1` spelling — FIXED 2026-08-07**
  (this commit): the `sbpi1.<base64url-no-pad(JCS({createdAt,creationVersion}))>`
  derivation spelling is deleted and replaced with a dated note deferring to
  the round-2/round-3 reconciliations (host-minted canonical UUIDv7 in
  `_snapback_relation_incarnations_v1`; §D8 `sbsb1` 36-byte template,
  inherited by `sbsb2`). The same stale derivation sentence in §2's
  `create-owner.v1` paragraph was annotated identically; code agreement
  verified at `src/storage.rs` (`Uuid::now_v7()` mint into the registry).
