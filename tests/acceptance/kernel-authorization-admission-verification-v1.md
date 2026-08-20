# LLP 0285 forgery half — admission parameter verification table

This table is the review evidence required by LLP 0285 §7. It records the
kernel verification site for every parameter of each admission as that
admission converts. A row marked **OPEN** is intentionally not evidence of
closure: it names the missing verification rather than laundering a typed or
opaque caller assertion into a kernel fact.

## Durable principal resolvers (Step 5)

| Resolver parameter | Kernel verification site |
| --- | --- |
| `resolve_principal_from_session.digest` | `storage/resolved_principal.rs::resolve_principal_from_session` uses `auth_catalog_ops::lookup_presented_session` to match the digest to the current `_auth_sessions.token_hash` row inside one pinned SQLite snapshot. |
| `resolve_principal_from_session.now_ms` | `AuthSessionRecord::live_at` checks the row's durable revocation and expiry facts in that snapshot; portable-range validation precedes the read. |
| `resolve_principal_from_credential.credential` | `storage/resolved_principal.rs::resolve_principal_from_credential` uses `auth_agent_credentials::live_credential_by_hash` to match the secret digest to one non-revoked `_auth_agent_credentials` row inside the auth transaction. |
| `resolve_principal_from_credential.now_ms` | `require_agent_clock_on` verifies the durable auth clock; `require_agent_active_on` verifies the credential's `_auth_users` row is a live agent in the same transaction. |

`ResolvedPrincipal` has private fields, no public constructor, and no
`Clone`, `Copy`, `Default`, `Deserialize`, `From`, or `FromStr` implementation.
The retained row identity/generation is proof material for mandatory
commit-time revalidation; resolution alone is not a compare-and-commit.

## Admission conversion census

### Pending-effect decision — pre-conversion state

| Admission parameter | Kernel verification site / status |
| --- | --- |
| `id` | `pending_effects.rs::read_record` inside `with_auth_transaction`; the transition CAS later requires the same row to remain `pending`. |
| `approver_principal_id` | Compared with the effect row's optional `approver_principal_id` inside the transaction, but the principal's durable session/credential identity is **OPEN**: this caller string has not yet been replaced by `ResolvedPrincipal`. |
| `approve` | Operation choice; selects the closed `approved`/`refused` transition after row-state checks. It is not an authority fact. |
| `requires_step_up` | **OPEN / VULNERABLE before Step 6:** accepted from the caller and trusted to decide whether proof consumption runs. |
| `step_up` | When the caller says it is required, `consume_step_up_proof_on` verifies the named challenge row's address, key, digest, attempt bound, expiry, and unused state, then consumes it inside the decision transaction. The caller-controlled bypass above makes this conditional verification insufficient. |
| `now_ms` | Used by `lazy_expire` and `consume_step_up_proof_on`; portable timestamp validation is indirect through those operations. Step 6 must preserve the same-transaction check. |

The remaining pending-effect creation/settlement/refusal, protected-erasure,
and push admissions are not converted by this task. Their parameter rows must
be added when each conversion begins; this document does not claim LLP 0283
F-1 or any of its four defects closed.
