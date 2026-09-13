# Lane completion checklist

Status: open
Date: 2026-08-25
Systems: process
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-the-critical-path-is-the-shared-surface-not-the-rows

## Why this exists

Across this programme, **eight of nine gated lanes returned DO NOT LAND**, and every single finding
was an *executed* composition rather than a style objection. The findings were not random. They
repeat, and by now they are predictable enough to check for in advance.

Each of those verdicts cost a full round — hours of implementation plus hours of review. This is the
list a lane should work through **before** claiming done, so the review finds nothing rather than
finding the same thing again.

It is written as a checklist because the failures are not subtle once named. They are missed because
nobody looked, not because they were hard to see.

## 1. Enumerate the siblings

LLP 0303 revision **(n)**: *a fix not accompanied by an enumeration of its siblings is not finished,
it is untested.*

List every path that reaches the same durable effect. Say which now go through your new mechanism and
which do not — **including the ones that came back clean**, because "I checked and it was fine" and
"I didn't check" are indistinguishable in a report that omits both.

Precedents: a guard-derivation lane was defeated by `identity_reap_guests_default_tombstone`, which
took a plain transaction with an empty commit guard and never entered the mechanism. A revalidation
lane claimed "every allocation" while `ObligationRegistry::register_live_scope` and `retire_scope`
never revalidated at all.

## 2. `#[doc(hidden)]` is not a capability boundary

Read it as `pub`. Same for sealed traits. Two lanes were defeated through `#[doc(hidden)]` bridges —
`auth_database_mut()` and a public binding constructor — after their authors treated the annotation
as protection.

## 3. Check the transaction's *scope*, not its existence

Being "inside a transaction" is not the property. The **read, the comparison, and the effect** must
all be inside the same one.

A lane read two rows in one deferred transaction, committed that transaction, *then* compared and
allocated. A reviewer delayed the process immediately after the read lock released and won the race:
generation 2 was issued from a retired boot. The lane that got this right took an IMMEDIATE
transaction that serialises the writer.

## 4. Check the root, not just the carrier

A derivation is only as strong as its root. Opacity, private fields and non-`Clone` on the carrier
are irrelevant if the *root* is caller-supplied.

The sharpest instance: a public `authenticate` verified an envelope against the
`admission_public_key` **supplied by that same caller**. An attacker-minted key installed a maximal
watermark and permanently locked out the genuine producer.

## 5. Look for the second handle and the second database

- A second handle to the same resource may start unguarded (revision (l)).
- A durable record read only at acquisition is a cache (revision (k)).
- Plan against database A, commit against database B.
- `Clone` produces a second carrier that passes the same checks (revision (j)).

## 6. For durable single-use, all five properties

1. the key is a PRIMARY KEY so collision happens in the database;
2. a separately stored request digest distinguishes replay-of-same from different-request-same-key —
   and it must be **derived by the producer**, not computed from a caller-presented plan;
3. retention exists: expiry column, index, and actual pruning;
4. the **refusal** is recorded, not only the success;
5. **a no-op must not consume** — and note that a no-op must also not *prune*: one lane's malformed
   no-op evicted another operation's genuine record and made it replayable.

## 7. Prove it from outside

Every claim needs an executed composition from an **external dependent crate with no features
enabled**, with a **watched fail-first** shown reaching its assertion. A test that dies in fixture
setup proves nothing and has fooled this programme more than once.

Prefer a compile-fail witness where the change makes the mismatch unconstructible — that is stronger
than a runtime refusal, and it is the difference between DERIVE and VERIFY.

## 8. Report numbers you actually measured

Two lanes reported a privilege-ratchet count that the reviewer could not reproduce (100 vs 102, 562
vs 563). Neither error was material; both cost credibility that the accurate parts of those reports
then had to carry.

State inherited reds as inherited **and show the check** — an inherited red and an introduced red are
identical in a summary line. Verify against `origin/main`, not against memory.

## 9. Know which check actually covers your claim

`cargo check -p <crate> --tests` does not support a cross-crate claim: it compiles that crate's unit
and integration tests and no other package's tests. Use
`cargo check --locked --workspace --all-targets --all-features`.

`node scripts/check-inventories.mjs` is the only check that sees the whole generated-artifact chain,
and the generators chain — regenerating one can leave the next stale.

## 10. Say what you could not do

A finding you could not execute, a sibling you could not close, a claim you could only read rather
than run — name it. One lane declined to report an uncovered sibling because it had no executed
witness yet; that absence read as absence from the surface. Name it as unproven and close it anyway.

Stopping with a clear account of a wall is a better outcome than a fix that relocates the defect.
One lane did exactly that — it hit a crate-boundary problem, refused to ship a narrower public seam
because it "merely relocates condition 4 again", and was right to.
