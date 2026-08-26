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
