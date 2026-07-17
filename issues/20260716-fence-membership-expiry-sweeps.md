# Fence membership expiry sweeps against concurrent changes

**Status:** Open
**Severity:** P1
**Systems:** RBAC, Membership expiry, Storage, Concurrency
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Time-bounded membership and §Writes
**Marker:** security, data-integrity, concurrency

`plan_membership_sweep_expired` in `src/storage.rs` selects expired rows,
prechecks protected-role survivors, builds deletes, and then returns an empty
`read_dependencies` vector.

The plan can consequently delete a row that was renewed after the scan. It can
also delete a row promoted to the sole protected holder after planning, or
remove a protected holder after the prechecked survivor became ineligible.
Those changes do not invalidate anything because the sweep captured neither
the target versions nor the holder-set/auth facts it relied on.

**Done when:**

- Every swept target carries an exact row-version/expiry dependency through
  commit.
- Protected-role decisions carry the required holder-range and durable
  eligibility facts into the shared final-state evaluator.
- A row is deleted only if it is still expired at the linearization point.
- Concurrency tests cover renewal, role promotion/demotion, survivor removal,
  survivor deactivation/revocation, and two expired protected holders.
- The result continues to report protected rows that were deliberately
  skipped without claiming that their expiry bounded authority.
