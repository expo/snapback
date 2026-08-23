# R2 evidence gaps: the tests are weaker than the commit claimed

Status: Open — evidence only; no production defect
Created: 2026-08-23
Related: issues/20260823-stream-r2-r3-revalidation.md,
issues/20260822-landed-fence-tests-do-not-prove-non-substitutability.md

## Context

R2 (atomic stream-attempt batch persistence) landed after an independent review found the
**production implementation sound** against every stated constraint: no authority fence, no
ordering violation, no deadlock cycle, no signature drift, no startup-capability regression.

What the review did find is that the *evidence* was overstated. None of the five findings below is
a production defect. They are recorded because the R2 commit described its tests as
"mutation-audited", and that phrase should not stand for more than the tests actually pin.

## The findings

**1. Medium — the atomicity oracle omits `updated_at_ms`.**
The asserted preimage reads token, client key, and JSON (`settlement.rs:1128`), while the durable
row also carries `updated_at_ms` (`storage.rs:7291`). Autocommit a timestamp touch before the
containing transaction, then inject the row failure: **both atomicity tests stay green while the
durable row is not byte-identical.** So the claim of an "exact durable preimage" is false. The
implementation is nonetheless correct — it updates the timestamp inside the transaction.

**2. Low — the empty-batch test does not exercise a valid authenticated empty batch through the
public path.** At `settlement.rs:1390` the public call is invalid and exits during HMAC
verification; the valid no-transaction assertion calls the private raw helper separately. A
special case that opens and commits a transaction for an empty batch after successful public
authentication would stay green.

**3. Low — authentication ordering is not pinned on every error path or transaction spelling.**
`settlement.rs:1432` covers matching issuer plus bad HMAC and counts only
`TransactionOperation::Begin`. `SAVEPOINT preauth; RELEASE preauth;` before authentication opens a
transaction while the probe still reports zero `BEGIN`s; opening `BEGIN IMMEDIATE` only in the
untested missing-verifier or wrong-issuer branches also survives.

**4. Low — staging and guard tests are fixed at exactly three insert-path rows.**
`settlement.rs:1307` counts only `SQLITE_INSERT`, and `:1356` uses three fresh inserts. Invoking
the callback after the first three rows and staging the rest afterwards, or dropping the guard
early only when `rows.len() > 3`, leaves both green. Conflict-update staging is unobserved.

**5. Low — "one-use recovery" tests result takeability, not capability uniqueness.**
`settlement.rs:1486` proves `Option::take()` returns once. Constructing and consuming a second
startup capability, discarding its empty result and retaining the first, stays green. The source
does still construct exactly one capability (`storage.rs:1661`).

## Why this is worth a ticket rather than a footnote

Finding 1 is the instructive one: the lane genuinely did reject its own first red oracle for
failing on the wrong signal, rebuilt it, and watched it fail correctly. That is the practice this
program wants. It still shipped a preimage assertion narrower than the row it claimed to pin — so
**doing the fail-first discipline well does not by itself make an oracle complete**, and a
mutation audit is only as strong as the widest mutation it was asked to survive.
