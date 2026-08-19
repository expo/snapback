# Security gates are expected red until LLP 0283 F-1

**Status:** Open
**Owner:** LLP 0283 F-1
**Date:** 2026-08-19
**Related:** LLP 0283 F-1/F-2, LLP 0284 §§1, 7–8

The rewritten `kernel-raw-sql-api` and `security-boundaries` gates are
deliberately RED on the current tree. `cross-crate-path-includes` is green on
the product tree, but its committed negative corpus is red as required. This
ticket is the honest record of the known product findings; it is not an
allowlist, baseline, waiver, or permission for the APIs to remain public.

The expected findings are exactly the three open F-1 escalation families:

1. **Public claim/mint authority and duplicates.** The scanner reports
   `LocalDatabase::claim_kernel_commit_authority`; `KernelCommitAuthority`
   admission methods for system/user/other push, protected-record erasure, and
   all four pending-effect commands; `Clone` on the root and its
   privilege-bearing factories/carriers; public seed-returning/sink methods and
   fields reachable from those roots; the `test-support` claim/join/bind seams;
   `LocalEphemeralBackend::reserve_authorization_commit`; and wholesale
   `snapback_kernel::storage` re-exports from `snapback-auth`,
   `snapback-activation`, `snapback-engine`, and `snapback-server`.
   LLP 0284 R-2 also identifies the existing
   `PromotionContentionReservation` and `AskSpendReservation` return/consume
   pairs as seed-type heuristic hits; their obtainability witnesses are part
   of the expected pre-F-1 red set.
2. **Caller-closure factories.** The scanner reports
   `AuthorizationCommitCarrierFactory::{reservation,prepared}`,
   `KernelCommitAuthority::{authorization_commit_carriers,
   service_authority_terminal_factory,service_authority_commit_interlock}`,
   `ServiceAuthorityTerminalFactory::prepared`,
   `ServiceAuthorityFenceRegistry::kernel_commit_interlock`, and
   `LocalDatabase::install_service_authority_commit_interlock`, together with
   the public seed values and reachable sinks those factories expose.
3. **Caller-selectable raw SQLite.** The scanner reports
   `snapback_services::test_support::rusqlite` under
   `snapback-services/remainder-tests` and kernel `test-support` transaction
   ingress. The two separate, time-bounded read/connection-local ingress seams
   are tracked in their own tickets and allowlist rows; no F-1 escalation is
   allowlisted.

The compile-fail gate is expected to report `attack compiled` for these exact
attack ids until F-1 lands:

- `claim-kernel-commit-authority`
- `claim-via-auth-reexport`
- `claim-via-engine-reexport`
- `claim-via-activation-reexport`
- `claim-via-server-reexport`
- `admit-system-push`
- `admit-protected-record-erasure`
- `admit-pending-effect-creation`
- `admit-pending-effect-decision`
- `admit-pending-effect-settlement`
- `admit-pending-effect-refusal`
- `clone-kernel-commit-authority`
- `auth-commit-reservation-factory`
- `auth-commit-prepared-factory`
- `service-interlock-factory`
- `services-rusqlite-reexport` with
  `snapback-services/remainder-tests`
- `kernel-test-support-for-test-factory` with
  `snapback-kernel/test-support`
- `kernel-test-support-join-authority` with
  `snapback-kernel/test-support`
- `recording-interlock-bind` with `snapback-kernel/test-support`
- `obtain-promotion-contention-reservation`
- `obtain-ask-spend-reservation`

No other scanner item or compile-fail id is expected red. A new finding is a
new defect, not covered by this record.

Until F-1 closes, the three product-tree gates remain in the scheduled complete
battery and out of `alwaysGates`; the green `security-gate-fixtures` harness is
always-on. As part of F-1's landing, all three product gate ids move into
`alwaysGates`, this ticket closes with the green outputs, and the three
escalation families above must disappear without an allowlist row.
