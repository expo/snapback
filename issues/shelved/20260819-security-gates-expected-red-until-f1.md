# Security gates are expected red until LLP 0283 F-1

**Status:** Open

> **Publication note (2026-08-22, author ruling — LLP 0283 Revised g):** the
> npm publication hold is lifted until further notice. This ticket's gates
> remain RED by design and nothing here is allowlisted or waived; publications
> proceeding under the ruling must disclaim F-1 closure and
> adversarial-handler containment in their closure records.
**Owner:** LLP 0283 F-1
**Date:** 2026-08-19
**Related:** LLP 0283 F-1/F-2, LLP 0284 §§1, 7–8

The rewritten `kernel-raw-sql-api` and `security-boundaries` gates are
deliberately RED on the current tree. `cross-crate-path-includes` is green on
the product tree, but its committed negative corpus is red as required. This
ticket is the honest record of the known product findings; it is not an
allowlist, baseline, waiver, or permission for the APIs to remain public.

The expected findings are exactly the four open F-1 escalation families. The
2026-08-19 surgical final gate fix round reported 127 unallowlisted scanner
violations and 23 compiling attacks (33 inventoried attacks total). After the
LLP 0285 §6 steps 1–4 reachability half landed at `dc5d59efd`, the F-3
fix-forward audit reports **102** unallowlisted scanner violations and **15**
compiling attacks (35 inventoried attacks total). The reduced counts are real
progress, not a green claim: the direct authority root, clone, and shared-borrow
routes are closed, while the owner bridges and the forgery/test-confinement
halves remain open.

1. **Owner-reachable mint/admission bridges.** The root is now kernel-private
   and non-`Clone`, and the direct claim plus test join/bind witnesses are green.
   The scanner still reports `ServingDatabase` admission methods for
   system/user/other push and protected-record erasure; its public
   seed-returning/sink methods and fields; the `test-support` factory seam;
   `LocalEphemeralBackend::reserve_authorization_commit`,
   `EphemeralApi::reserve_authorization_commit`, and the public `LocalSnapback`
   promotion/ask-spend reservation seams. The compiler witnesses separately
   prove that the four public `ServingDatabase::*_pending_effect_admitted`
   operations still accept caller-selected facts. LLP 0284 R-2 also identifies
   the existing
   `PromotionContentionReservation` and `AskSpendReservation` return/consume
   pairs as seed-type heuristic hits; their obtainability witnesses are part
   of the expected pre-forgery-closure red set. Wholesale storage re-exports
   remain hygiene findings, but no longer expose the private root.
2. **Caller-closure factories.** The scanner reports
   `AuthorizationCommitCarrierFactory::{reservation,prepared}` and the
   `ServingDatabase::{authorization_commit_carriers,
   service_authority_terminal_factory,service_authority_commit_interlock}`
   bridges,
   `ServiceAuthorityTerminalFactory::prepared`,
   `ServiceAuthorityFenceRegistry::kernel_commit_interlock`, and
   the serving/local interlock installers, together with
   the public seed values and reachable sinks those factories expose.
3. **Caller-selectable raw SQLite.** The scanner reports
   `snapback_services::test_support::rusqlite` under
   `snapback-services/remainder-tests` and kernel `test-support` transaction
   ingress. The two separate, time-bounded read/connection-local ingress seams
   are tracked in their own tickets and allowlist rows; no F-1 escalation is
   allowlisted.
4. **Caller-selectable privileged membership authority.** The scanner's
   deliberately narrow I-16 ratchet reports caller-constructible
   `MembershipWriter`; `AuthorizedMembershipPlan::user_transition`; the nine
   `plan_membership_*` operation families on `LocalDatabase`,
   `MembershipPlansKernel`, and `MembershipPlansReadKernel`; and the fixed-name
   sanctioned, privileged-plan, bypass, and provenance signatures that name it
   directly, including the real transition-provenance writer,
   `record_membership_transition`. Its adjacent `ChangeOp` only labels the
   already-derived journal operation and is not an authority discriminator. It
   does not perform body-flow taint analysis. Independently, the direct-dependent
   compiler witness constructs `MembershipWriter::Admin`, plans a privileged
   insert, and commits the plan. F-1 must replace the caller-selected
   discriminator with a kernel-derived unforgeable carrier and revalidate
   writer class/provenance at commit.

The compile-fail gate is expected to report `attack compiled` for these exact
attack ids until the remaining F-1 halves land:

- `admit-system-push`
- `admit-protected-record-erasure`
- `admit-pending-effect-creation`
- `admit-pending-effect-approval`
- `admit-pending-effect-denial`
- `admit-pending-effect-settlement`
- `admit-pending-effect-refusal`
- `auth-commit-reservation-factory`
- `auth-commit-prepared-factory`
- `service-interlock-factory`
- `services-rusqlite-reexport` with
  `snapback-services/remainder-tests`
- `kernel-test-support-for-test-factory` with
  `snapback-kernel/test-support`
- `obtain-promotion-contention-reservation`
- `obtain-ask-spend-reservation`
- `forge-membership-writer-admin`
- `reserve-authorization-via-sync`

No other scanner item or compile-fail id is expected red. A new finding is a
new defect, not covered by this record.

Until F-1 closes, the three product-tree gates remain in the scheduled complete
battery and out of `alwaysGates`; the green `security-gate-fixtures` harness is
always-on. As part of F-1's landing, all three product gate ids move into
`alwaysGates`, this ticket closes with the green outputs, and the four
escalation families above must disappear without an allowlist row.
