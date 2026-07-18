# Preserve committed mutation truth after publication failure

**Status:** Closed
**Severity:** P1
**Systems:** Mutations, Authorization, Live queries, Receipts, Storage
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0032; LLP 0053
**Marker:** postcommit, authorization, fanout, receipt, durable-truth

Mutation completion mixed two different facts: whether SQLite had committed and
whether later permission/live/receipt publication still held an admissible
authority carrier. A post-COMMIT head read or admission guard failure could
therefore surface a rejection even though the row and journal entry were
durable. Several fan-out loops also propagated one subscriber's guard or rerun
failure, which could starve later subscribers in the same frame. Finally, a
failed receipt guard replaced an already-confirmed commit with a rejected
receipt, contradicting storage.

**Done when:**

- Internal permission-epoch invalidation derived from an already-durable write
  advances regardless of a later publication failure.
- The committed frame version is carried through post-COMMIT fan-out; an
  impossible head mismatch records a diagnostic and suppresses unsafe
  publication without changing mutation truth.
- Every subscription's admission, projection, rerun, and recovery failure is
  localized to that subscription; later subscribers are still attempted.
- Recovery/resync helpers are best-effort post-COMMIT operations and cannot
  return a mutation failure.
- A failed receipt-publication guard suppresses retention and caller-visible
  handler output, but emits a `Confirmed` receipt with the exact commit version
  when SQLite already committed.
- Deterministic regressions corrupt the head and retire admission in the
  post-COMMIT hook, proving durable row/journal state, permission invalidation,
  diagnostic emission, and receipt truth.

## Resolution

`finish_mutation_commit` now separates internal invalidation truth from
external publication. It advances preflighted permission epochs first, carries
the exact committed frame version through permission, authorization, and live
fan-out, and treats a failed head-coherence check as a publication diagnostic.
Fan-out guards and reruns are handled per subscription; failure recovery records
the original and recovery diagnostics and attempts a bounded resync without
propagating an error across the commit boundary.

One receipt helper now owns every recorded mutation seam. If publication is no
longer authorized, the helper records the diagnostic, retains nothing, and
suppresses the handler result. When its input is an existing commit, however,
it still constructs a `Confirmed` receipt at that commit's version; only an
actually failed transaction produces `Rejected`.

Focused proof on 2026-07-17:

- `cargo test --lib postcommit_ -- --nocapture` — 6 passed.
- `cargo test --lib postcommit_head_corruption_preserves_confirmed_receipt_and_durable_truth -- --nocapture` — passed.
- `cargo test --lib postcommit_publication_guard_failure_confirms_without_retaining_sensitive_output -- --nocapture` — passed.
- `cargo test --lib --no-run` — passed.
- `cargo test --lib` — 1,098 passed, 0 failed.
