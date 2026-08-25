# Local-store publication custody is hard-coded to dated receipts the registry no longer names

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Local persistent store, Capability publication, Generated records, Pre-push gates
**Date:** 2026-08-11
**Drift gate:** `local-store-publication`
**Failure signature:** `sha256:1da031ef72fa44cf8665d2c49e56176f5968da09536dc39dee9152e78876c21f`
**Last observed:** `ddbd581eb77b7cb468b9b5764422b3a178438278`
**Related:** LLP 0232 D-2; LLP 0189 D-4; `issues/20260811-record-inventory-summary.md`

## Problem

The carrier and anchor themselves are content-addressed, but the command that
refreshes them and the trigger registry disagree about which dated evidence is
authoritative. This makes a calendar-shaped pathname part of the control plane
and requires coordinated source/registry churn every time the retained receipt
date rotates.

Registered frozen records:

- `crates/snapback/src/local-persistent-store-publication.v1.json`
- `crates/snapback/src/local-persistent-store-publication.anchor.v1.json`

The carrier's relevant fields are content hashes
(`qualificationReceiptSha256`, `supportingReceiptSha256`, source SHA-256 maps,
and the anchor's `carrierSha256`), which are suitable stable identities.

## Offending inputs

- `scripts/local-proof-selection-policy.v1.json` selects the
  `carrier-exit.2026-08-04.v1.json`, Triage
  `budget-freeze.2026-08-04.v1.json`, and Triage
  `move1-exit.2026-08-04.v1.json` paths.
- `scripts/refresh-publication-carrier.mjs` hard-codes the corresponding
  2026-08-06 receipt paths.
- `tests/conformance/local-persistent-store-publication-v1.mjs` reads the
  2026-08-06 carrier receipt and fixed 2026-08-06 Fleet records while choosing
  the latest complete Triage pair by lexicographic date.
- `crates/snapback/src/manifest.rs` embeds the 2026-08-06 receipts.

The registry can therefore report obsolete record custody while the generator,
checker, and binary use a different epoch. Dates are not the semantic identity:
the carrier already pins exact receipt bytes.

The prescribed regeneration command also runs qualified JavaScript checks and
a Cargo capability test. Cold cost is conservatively multi-minute from the
shared Cargo-build evidence; it must receive D-1 reuse after the custody model
is repaired.

## Proposed remedy

Per LLP 0232 D-2:

1. Replace hard-coded calendar locators with one stable, explicit receipt
   locator (for example, an authored current-record pointer bound to receipt
   SHA-256, or a content-addressed record index).
2. Make the policy, refresh command, conformance reader, and Rust embed consume
   that one locator; do not independently choose fixed or lexicographically
   latest dates.
3. Declare and trigger on every receipt/index byte that can change the carrier.
4. Preserve LLP 0189 D-4 coverage: the change that removes dated custody must
   install the equally honest stable locator and its drift gate in the same
   landing.
5. Put the remaining expensive qualified regeneration behind LLP 0232 D-1
   closure-validated receipt reuse.

## Acceptance

- All four consumers resolve one identical content-bound receipt set.
- Adding an unrelated newer dated file cannot silently change authority.
- Rotating qualified evidence updates one stable locator rather than source,
  policy, and reader path literals.
- A receipt-byte change selects the publication gate and refreshes the carrier
  and anchor deterministically.
- Cold and warm execution are measured separately; expensive execution is
  reusable only for a byte-identical verified semantic closure.

