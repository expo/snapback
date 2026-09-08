# Snapback 2 indexed twin masks a predicted count after proved primary absence

**Status:** Closed — repaired in the architecture integration; shipped main zero-count fix remains closed
**Date:** 2026-09-07
**Systems:** indexed twin overlay projection, maintained Count, receipt integration
**Owner:** existing LLP 1018 architecture integration lane
**Source:** pinned architecture `02e13629b`; shipped proof source `2c86c722d`

`TwinStore.row` at `snapback2/packages/snapback2/src/twin-store.ts` suppresses
an overlay whenever a primary negative exists without a committed base:

```ts
if (negative !== undefined && (!base || (this.state.rowSeq[key] ?? -1) <= negative || entry.issuedSeq <= negative)) continue;
```

A missing maintained count deliberately has no base. The shipped zero-count
repair provides independently justified primary absence and full-group coverage
to authorize creation. Those facts must not then make the created count's
prediction invisible. Ordinary target survivors still make group and primary
addresses inequivalent; keep both proofs and all uniqueness checks.

## Executed evidence and limits

The [isolated projection results](../../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/zero-count-architecture-projection.json)
execute the complete pinned `TwinStore` module after TypeScript transpilation,
including its actual `sync`, `intent` and `row` methods. Source SHA256:
`2d0cb8572529117a0424150599de76f38404801a9f08cd3977b8668f61d1ab87`.
The fixture has no committed base, a whole-row count insertion in a `queued`
intent, canonical group key for `dev:alice`, and primary negative sequence 10.
Both cold snapshot and incremental overlay addition are exercised at issued
sequences 10 and 11. All four negative cases hide the row, retain the negative
receipt and keep the pending intent listed. All four matching controls without
the negative expose count 1. This isolates more than the `<=` sequence test:
issued sequence 11 still fails because the base is absent.

This is **isolated projection evidence**, not public integration or predictor
execution. Wire preparation, schema/identity helpers, ordered storage and the
underlying ClientStore are stubbed; the entry includes only consumed fields.
The probe lives in the local `20260907-1018-lifecycle-closeout` ship-run evidence.
The existing public regression is the required integration witness below.

## Bounded repair and integration

1. Distinguish absence held when a valid local creation is predicted from a
   later authority change that must suppress stale overlays. Do not remove
   revocation, extent-hole or viewed-row protection. A global issued sequence
   alone is insufficient: an immediate allocation can share its proof's
   sequence, and unrelated deliveries can advance that sequence.
2. Transfer the shipped `public count reads enable multi-principal offline cap
   prediction without inventing missing counts` test into the candidate's
   `tests/real-owner-prediction.test.ts`, where its pre-fix zero case now lives.
   Preserve actual public acquisition of both proofs, no source preloading,
   cold reopen, visible count 1 after prediction, second cold reopen, repeated
   allocations to cap 3 and overflow rejection. Merely flipping `predicted`
   would miss this regression. Retain unheld, survivor, denied/protected and
   atomic-overflow controls; add a later-negative control for the repair.
3. Adapt the native proof to the candidate's index representation. Use
   `Index.scalar_columns()` for both primary and grouping indexes, reject
   derived components, and retain exact unique grouping and typed scalar key
   validation. `PointTrace.key` is still `Vec<Value>`; range prefixes now wrap
   those values in `IndexAtom::Scalar`. Reject WordPrefix atoms when checking
   the derived receipt. Use `n2_suffix: None` and no halo.
4. Preserve the canonical maintained ID from the **unwrapped** value tuple:
   `Value::Id(canonical_json(&point.key))`. The canonical ID for this example is
   `[{"Id":"dev:alice"}]`, never a tuple serialized with Scalar wrappers.
   Candidate IndexAtom/ReceiptRange lack the old PartialEq derivation; compare
   the complete reconstructed proof shape, not only its site. Retain paired
   actual-size checking after accounting for the new prefix representation.
5. Reconcile certificate step/dependency/byte accounting with direct lowering,
   regenerate the corpus, and distribute native regressions before hitting
   the 1,500-line cap: candidate `engine/cap_tests.rs` already has 1,257 lines.

A read-only merge-tree preview of `02e13629b` with main `d7e130e54` reports
content conflicts in the certificate, split real-owner tests, generated corpus
and governing docs (plus concurrent diary evidence). A textual resolution
alone does not qualify these semantic adaptations. The active architecture
lane owns the repair and its integrated review; this ticket does not launch a
competing client implementation or reopen the already shipped main fix.

## Resolution — 2026-09-07

Runtime `1cab1f7f4b16c31d57b6ce2c82aa19a0daca07d0`, integrated in
`e94b0a61012c20dd2ba4538d7b8007d020355ea3`, binds an exact pre-admission
absence into the existing durable per-intent negative ledger. The twin projects
the authorized creation without weakening later-negative, same-sequence
tombstone, newer-base, extent-hole or viewed-row protections. Equivalent
refreshes and answer collection preserve the intent's uncontradicted custody
across cold reopen. The rejected memory-only owner-order experiment is not
the final implementation.

The native pair uses scalar index components and schema-aware typed validation,
including long maintained Ref addresses, with unchanged actual primary lookup,
canonical unwrapped IDs, resource reservations and receipt-only restrictions.
The 249-case corpus remains byte-identical after the schema-aware repair.

On the exact runtime source, the public multi-principal Count regression passes
with its cold-zero, visible prediction, cap and atomic-overflow controls; a long
maintained Ref also passes public wire/cold/prediction/replay. Focused absence
custody tests pass 2/2, store/overlay tests 130/130, and native Count tests 12/12.
PIDs 379990 and 384762; raw SHA256 values respectively
`7b9d5ce80ef97fb81e2fbff09b590c1b363ecf8758eec8eaf00e56f450803122` and
`7fd9acde5daa5166c2e10385d98a50ec3175743612130d9dc0dbae459c88d5b2`.
The integrated e94 package suite passes 781/781 with no timeout at unchanged
limits. Program-wide final qualification and delivery remain separately tracked
by LLP 1018.000; this closes the specific projection defect.
