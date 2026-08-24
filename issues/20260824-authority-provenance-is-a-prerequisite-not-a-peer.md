# Deriving from the authority is worthless while the authority is forgeable

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-auth, snapback-types
Related: LLP 0303, issues/20260824-liveness-row-bucket-assignment.md,
  issues/20260824-p1-ship-rows-enumerated.md

## The finding

LLP 0303 rules that the subject must be **derived from the authority** rather than supplied
alongside it. A review of the F053 fix — which correctly removed a public factory and derived the
durable `(session_id, generation)` from `PreparedAuthority` — found the derivation does not close
the hole, because **`PreparedAuthority` is itself caller-constructible**:

- `ResolvedAppAuthority::Session` is a public enum with public tuple fields
  (`crates/snapback-sync/src/auth/invocation.rs:327`).
- `InvocationGate::prepare_admitted_authority` is public and accepts that caller-supplied value
  (`invocation.rs:2714`).
- A sessions-mode lease can be manufactured through public `AuthModeStateRecord` fields and
  `AdmissionController::from_mode_state`
  (`crates/snapback-types/src/auth/mode.rs:172`, `crates/snapback-auth/src/auth/admission.rs:246`).

So a caller can construct the authority it will then be "derived" from. The derivation is
faithful; the input is forged.

## Consequence for sequencing

This reorders the program. The per-row derivations are not independent work items that can land in
any order:

> **Authority provenance (Q09, Q11, and C001/C005) is a PREREQUISITE for every other row.**
> Until `PreparedAuthority` can only be produced by a real resolution path, every "derive from the
> authority" fix inherits a forgeable input and its claim overstates what is enforced.

This does not invalidate the landed and in-flight per-row work — those fixes are correct and remain
necessary; the grant-revocation fix (`a5d66e941` + `23db84b46`) closed a genuine independent
parameter. But no row may claim its mismatch is *unconstructible* until the authority it derives
from is unforgeable. Claims must say "derived from the prepared authority" and stop there.

## Relation to the ruling

LLP 0303 already answers these two questions strictly:
- **Q09** — only the bearer/catalog resolution path may produce session authority.
- **Q11** — subject provenance must come from the engine authority graph; a mode-valid
  `AdmissionLease` is not sufficient.

The ruling was right; what was missing was that these two are *load-bearing for the other 43*. They
should be implemented first, and the remaining rows re-checked afterwards to see which of their
claims strengthen from "derived" to "unconstructible".

## Prior corroboration

An earlier verified finding pointed the same way and was recorded but not connected: admission
leases are cloneable with clones sharing one token, while `prepare_admitted_authority` accepts the
lease and the resolved authority as independent parameters, so one lease can prepare two different
authorities (`issues/20260824-unverified-findings-backlog-resolved.md`, V5). That was filed as
evidence against a lease-keyed correlation predicate. It was also evidence that authority
construction is unsealed, and that implication was missed at the time.
