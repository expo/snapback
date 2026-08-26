# F145's witness fails on stale arity, and the runner scores that as CLOSED

**Status:** open — F145 is **OPEN**; the corpus is about to report it CLOSED
**Found:** 2026-08-26, by a lane that reported a ledger discrepancy instead of silently rewriting it.

## What happens

`tests/fixtures/row-attacks/src/attacks/f145.rs:33` calls:

```rust
InvocationGate::prepare_admitted_asset_callbacks(admission, principal)
```

The consumer now takes **three** parameters
(`crates/snapback-sync/src/auth/invocation.rs:3572`):

```rust
pub fn prepare_admitted_asset_callbacks(
    profile: ServerProfile,
    admission: AdmissionLease,
    principal: AssetCallbacksServicePrincipal,
) -> SnapbackResult<PreparedAuthority>
```

So the witness fails to compile with `E0061` — *wrong number of arguments* — and a compile failure is
scored by the runner as **CLOSED**. The ledger still records F145 as OPEN, which is why the mismatch
was visible at all.

## Why this is a false closure, not a real one

The added parameter is `profile: ServerProfile`, **a caller-supplied enum, not a derived carrier**. The
function still accepts `admission` and `principal` as independent caller-chosen inputs. Nothing about
the subject/authority correlation changed. Repairing the witness to pass a `profile` would restore it
to OPEN.

This is the most dangerous failure mode in the whole measurement scheme: a witness that stops compiling
for a **mechanical** reason is indistinguishable, to the runner, from a witness that stops compiling
because the capability was removed. LLP 0303 revision (s) is about the same confusion from the other
direction — a removed *spelling* is not a removed capability. Here a removed *arity* isn't either.

## Why it nearly got through

The ledger recorded OPEN and the observation was CLOSED, so the runner flagged a mismatch. Had F145
been recorded CLOSED — as it would be after any lane "confirmed" the closure — the drift would have
been silent and permanent. **Signature drift on a consumer silently converts every stale witness for
that consumer into a false closure**, and there are 30 rows in the corpus.

## What to do

1. Repair `f145.rs` to pass the `profile` argument, and confirm it returns to OPEN with a runtime
   observation at the marked attack rather than a compile error.
2. **Systemic:** the runner cannot currently distinguish "refused because unrepresentable" from "failed
   to compile for an unrelated reason". At minimum, a row whose `expectedCode` is recorded should be
   required to fail with *that* code — `E0061` where `E0599` was expected is a harness error, not a
   closure. Rows without an `expectedCode` deserve one for exactly this reason.
3. Audit the other 29 rows for the same drift: any witness whose observed failure code differs from its
   recorded `expectedCode`, or which has no `expectedCode` at all, is a candidate.

## Related

- `issues/20260826-row-acceptance-ledger-62-units-remain.md` — flagged F094 and C009 as resting on
  compile refusal without executed alternate-route evidence; this is a third instance of the same class.
- `issues/20260826-f097-two-lanes-disagree-and-a-fork-composition-decides.md` — the F170 false closure.
- LLP 0303 revision (s).

## Second instance, same hour, unrelated lane

An independent review of the LLP 0313 landing A work found the identical defect class in **seven**
hostile probes at once:

> Seven hostile probes fail because they call **invented methods that never existed**, rather than
> proving the claimed clone/serde/conversion/exposure protections. They therefore lack meaningful
> fail-first evidence.

A probe asserting that `evidence.clone()` is refused, where `Clone` was never implemented and no
`clone` method was ever in scope, demonstrates only that an identifier can be misspelled. The harness
sees a compile failure and scores a protection that was never exercised.

## The generalisation

**A witness that fails for a mechanical reason is indistinguishable, to this harness, from a witness
that fails for a structural one.** The mechanical failures observed so far:

| Mechanism | Example | Scored as |
|---|---|---|
| Stale arity after a consumer gains a parameter | F145, `E0061` | CLOSED |
| Reference to a method that never existed | landing A, seven probes | protection proven |
| Refusal at a `use` line rather than the attack | rawsql F313 | CLOSED |
| Failure during setup before reaching the marked attack | recorded in every lane brief | CLOSED |
| Removed *spelling* rather than removed capability | LLP 0303 revision (s) | CLOSED |

All five produce a green result from a test that proved nothing, and all five are invisible unless
someone checks **which line failed and with which code**.

## Minimum viable defence

Require every row and probe to record an `expectedCode`, and make the harness **fail the row when the
observed code differs from the recorded one**. `E0061` where `E0599` was expected is a harness error,
not a closure. That single check catches arity drift, invented identifiers, and import-line refusals —
three of the five — at the cost of one field per row.

Structural failures (setup-stage aborts, removed spellings) still need the alternate-route execution
that LLP 0303 revision (s) already demands. But codes are cheap and currently optional, and making them
mandatory is the highest-value change available to the instrument.
