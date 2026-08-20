# LLP 0285 Step 6 — pending-effect decision verification table

This is the per-parameter evidence required by LLP 0285 §7 for the first Step
6 conversion. It does not claim that the pending-effect creation, settlement,
or refusal admissions are closed, and it does not claim LLP 0283 F-1 closed.

| Admission parameter | Kernel verification site / status |
| --- | --- |
| command database binding | `pending_effects.rs::verify_command_identity` compares the command's private binding with the committing database before `BEGIN IMMEDIATE`. Only that database's `KernelCommitAuthority` can mint the binding. |
| `id` | `pending_effects.rs::read_record` reads the exact `_snapback_pending_effects` row inside `with_auth_transaction`; the decision `UPDATE` then requires the same id still have `status = 'pending'`. |
| `approver_principal_id` | Compared inside the transaction with the effect row's optional durable approver id. Durable resolution of the supplied principal string is **OPEN** until a later conversion replaces it with `ResolvedPrincipal`; this row is not evidence that the complete admission is closed. |
| `approve` | Operation choice only. `true` selects the approved transition and durable-policy check; `false` selects the authority-reducing refused transition. It is not recorded as a caller-supplied authority fact. |
| `step_up` | When the durable scope-basis row says `authority_creating = 1`, `auth_catalog_ops.rs::consume_step_up_proof_on` verifies the named challenge row's address, key, digest, attempt bound, expiry, and unused state, then consumes it in the same decision transaction. Missing, stale, mismatched, or already-consumed proof refuses the decision. This conversion does not independently rederive the challenge's operation/target binding. |
| `now_ms` | `pending_effects.rs::lazy_expire` compares it with the durable effect expiry before any decision, and proof consumption applies its durable validity checks. The freshness source for this caller-selected clock is **OPEN**; this first conversion does not make the complete admission closed. |

The deleted `requires_step_up` parameter has no replacement assertion. After
the effect row is read, `auth_scope_bases.rs::current_authority_creating_on`
selects `present, authority_creating` from the exact function's durable
`_auth_scope_bases` row. A missing, kind-mismatched, or tombstoned row returns
`SNAPBACK_EFFECT_BINDING_STALE`; malformed booleans return
`SNAPBACK_AUTH_SCOPE_BASIS_CORRUPT`.

The function id/kind used for that lookup comes from a durable pending-effect
row, but creation of that row is still an unconverted admission. Step 6's first
conversion removes the direct bool bypass; it does not yet prove every fact in
the decision/creation family.

## Transaction order

The approval admission now executes in this order:

1. `BEGIN IMMEDIATE` and auth-catalog readiness check.
2. Lazy expiry against the durable pending-effect row.
3. Exact effect-row read and status/approver checks.
4. Exact `_auth_scope_bases` policy read for that effect's function id/kind.
5. Conditional durable step-up verification and consumption.
6. Pending-to-approved/refused compare-and-set and journal append.
7. Commit; only then is the resulting record projected to the caller.

This order makes policy verification and decision commit one SQLite write
transaction, so activation cannot change `authority_creating` between the
check and commit. The new scope-basis `SELECT` is reachable only from the
pending-effect approval admission. No SQL statement or canonical read shape
on a non-admission path changed, and no JOIN was added.
