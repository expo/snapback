# single_table_v1@1 adoption implementation

**Status:** Open (follow-on commissioned by the 2026-08-03 ruling
landing 3f77ffe5b — Charlie's five rulings, decision 3 = Arm A; the
eleven-document amendment set is law)

Implement the registered class end to end, honestly dormant until its
oracles pass:

- **Codegen:** class selection binding the derived `rqsEligible` fact
  (authors cannot assert membership — LLP 0092 §0C.2 producer
  projection); `SingleTablePlanV1` (derived-only membership,
  full-document results, declaration-order bindings, single-node-only
  admission — LLP 0004 dated amendment).
- **Rust:** typed normalization + null/order/digest semantics + bounds
  (LLP 0007 §SingleTablePlanV1 portability); the NEW-CLASS-ONLY
  1,024 examined-entry refusal; `none.v1` cursor profile activation
  for exactly this class (LLP 0157 §D1 registry: class 4 of 6).
- **Client:** Arm A retention — `rqs-authority-independent-snapshot-v1`
  (LLP 0080 §4 single-table-only exception), `authorizedLeaseHash`
  null, durable+`pinned` store mapping (LLP 0166 §D2/§D3/§D4: the
  no-lease answer row), the exact connected prove-or-fresh atomic
  adoption switch (LLP 0166 §D6), retained-not-current custody under
  pending outbox (LLP 0043); no `AuthorizedLease` consumed, no
  anonymous-lease precedent (LLP 0053).
- **Delivery boundary:** the class consumes DK-3's additive-delivery
  ceiling; `live_delta` keeps the honest `live_replace` fallback;
  ordered/limited results remain replace (LLP 0008 DK-3 boundary).
- **Oracles before any capability motion:** cross-target parity per
  LLP 0007; S4 stays green; the staged migration rule (LLP 0157 §D1);
  capability rows stay as-is until the acceptance legs pass and the
  owner moves them.

Constraints: fresh worktree; owner machinery consumed, never
reimplemented; regen-before-landing; inventory counts updated.
