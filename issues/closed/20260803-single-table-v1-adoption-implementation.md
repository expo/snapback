# single_table_v1@1 adoption implementation

**Status:** Closed — implementation, activation wiring, and the retained local
publication are complete. The remaining Fleet OQ5 and DK-9 follow-ups are
tracked in `issues/20260804-llp-0166-finish-out-residue.md`. This follow-on was
commissioned by the 2026-08-03 ruling landing 3f77ffe5b — Charlie's five
rulings, decision 3 = Arm A; the eleven-document amendment set is law.

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

## Resolution (2026-08-04)

Implemented dormant and landed (9143e3b56 + the s5_d10 reconciliation
74bfd7cb9/c98bd6146): codegen membership from derived rqsEligible facts
only; Rust single-node admission, none.v1 activation, class-scoped
1,024 examined-entry refusal, wire bytes unchanged (regression-pinned);
client Arm A (durable+pinned, authorizedLeaseHash null, no
AuthorizedLease anywhere on the path, atomic prove-or-fresh legacy
adoption preserving before-state under pending outbox). Cross-target
normalization pinned sha256:e98ec047…10ec5e. S4 74/74; full client +
codegen + Rust lib suites green outside the sandbox. Capability rows
deliberately NOT moved — owner motion once the acceptance legs and
staged-migration criteria are reviewed.

## Activation attempt (2026-08-04)

Lane C wired capability publication to the exact carrier/Triage receipt chain
and made codegen activate the shipped path only when that target publication is
verified. The controlled Triage rerun was attempted, but this execution sandbox
denied the server's loopback bind (`SNAPBACK_SERVER_LAUNCH_FAILED`), producing an
honest 1 PASS / 7 BLOCKED receipt. The publication predicate also checks the
carrier summary and Triage PASS leg, so the older 15 PASS / 2 GAP receipt cannot
activate the class. The capability therefore remained withheld at this stage;
the Lane F publication record below supersedes that intermediate state.

## Lane D reconciliation (2026-08-04)

The final publication predicate is executable and symmetric: the local source
target publishes only from a retained 16 PASS / 1 Fleet GAP / 0 skipped carrier
receipt plus Triage 8/8, while package and hosted targets retain structured
GAPs. `scripts/finalize-local-persistent-store-publication` is the one-command
receipt-binding and projection refresh after those producer runs. The remaining
environmental evidence work moved to the open finish-out residue ticket, so
this implementation ticket no longer presents completed code as open work.

## Lane F publication outcome (2026-08-04)

The socket-capable run produced the retained Triage 8/8 receipt and carrier
exit at 16 PASS / 1 Fleet GAP / 0 skipped. The publication carrier binds those
receipts and their source pins into the contributor-source local manifest,
which now advertises experimental `single_table_v1`. Remote-service and
Cloudflare targets remain capability gaps. The residue ticket now contains
only Fleet OQ5 and DK-9.
