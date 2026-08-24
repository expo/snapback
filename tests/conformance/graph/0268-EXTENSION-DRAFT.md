# LLP 0268 exit extension draft — broadcast prover

Date: 2026-08-24  
Branch: `llp0268-exit-extension`  
Baseline: complete LLP 0209 G0 program ratified at v0.7

This is evidence for the orchestrator's LLP 0209 v0.8 re-record. It does not
edit, supersede, or accept either LLP. The disposition is scoped to the
broadcast-prover extension in the 2026-08-24 commission.

## Re-disposition

| LLP 0268 §7 label | Disposition | Extension evidence | Remaining condition |
| --- | --- | --- | --- |
| `G0-BCAST-CLASS` | **SATISFIED** | Corpus-local `publicRooms` has a class-1 root and projection; two paired-world cases hold arguments, windows, authorization version, and the delivered scope fixed while independently removing other-principal membership and the other room partition plus its policy row. Bytes, order, length, existence, and completeness are identical. Host counterfeit tests retain row 23 `SNAPBACK_GRAPH_BROADCAST_BASE_CLASS_INVALID`. | None for this extension. |
| `G0-BCAST-SEPARATION` | **SATISFIED** | The B2 source walk admits only a literal membership predicate at `broadcast.establishment.predicate`; codegen has no authored proof fields; the host reconstructs the admit-only/null-overlay certificate and retains row 24 `SNAPBACK_GRAPH_BROADCAST_SEPARATION_UNPROVABLE`. | None for the supported root/equality/bounded class-1 slice. Unsupported graph forms remain query-shaped. |
| `G0-BCAST-SCOPE` | **SATISFIED** | Codegen and Rust independently derive the scope argument from root equality flow, propagate it across admitted joins, and exact-compare canonical argument IDs. The executable P/Q case asserts that its selected principal is a member of P but not Q, then freezes distinct real graph instances and a `scope-unbound` query-shaped result. | None for the supported slice. |
| `G0-BCAST-SCOPE-BINDING` | **SATISFIED** | `resourceEqualities` is derived for every delivered data node; the installed-owner check verifies each bound field is a required nominal ID in the membership resource domain. Row 25 `SNAPBACK_GRAPH_BROADCAST_SCOPE_UNBOUND` remains executable. | None for the supported slice. |
| `G0-BCAST-AUDIENCE` | **SATISFIED** | Each principal is evaluated twice at one materialization/version: the establishment seam performs its own installed membership lookup; the strict seam freshly enforces the function's membership declaration and only then admits the closed delivered root/projection. For the admitted member, the frozen delivery is executed through main's snapshot-pinned G2-A evaluator and exact-checked for bytes, completeness proofs, structural work, and first-page ledger charging; the denied outsider never reaches the evaluator and receives no bytes. The complete vectors exact-match as `[allow, deny]` for both rooms. A fixture whose establishment admits `member` while strict function admission requires `moderator` is compiler-refused as `audience-parity-failed`. | None for the corpus-local closed evaluator slice. G2-C still owns scheduled delivery ordering, not this point evaluation. |
| `G0-BCAST-INVALIDATION` | **PARTIAL** | The compiler emits and Rust reconstructs all 18 selectors: permission-backing write, metadata activation, three incarnation causes, out-of-band revocation, and twelve authority-transition causes, each bound to the scope argument. Row 27 remains executable. | `authorityTransition` and `mixedCommit` still require G2-C's evaluator/scheduler to observe fence-before-delivery ordering. |
| `G0-BCAST-IDENTITY` | **SATISFIED** | Existing plan/instance/materialization/partition/version/cut reconstruction remains executable. The certificate additionally binds an installed-owner digest over declaration, schema, membership policy, and visibility policy; codegen emits it and the host recomputes it from the active `SchemaManifest`. | None for this extension. |
| `G0-BCAST-CORPUS` | **PARTIAL** | `audienceParity` and `scopeMismatch` execute in `corpus.v1.json`. The shared G2 sidecar retains its original four rows and six top-level keys; G0 prover dispositions are additive in `broadcast-prover-dispositions.v1.json`. | `authorityTransition` and `mixedCommit` still require G2-C delivery ordering. |
| `G0-BCAST-BOUNDS` | **PARTIAL** | The certificate and class-1 fixture carry ordinary analytical G0 bounds. | Do not claim this label: G2-C broadcast group/fanout observations and the already-open large/hot typed observations are still required. |

## Counterfeit posture

An authored manifest-level `classification:"broadcast"` is never downgraded.
Rows 23–27 refuse, in order, a non-class-1 base, unprovable separation,
unbound/doctored scope, a function audience or installed-owner identity that
does not reproduce from installed facts, and incomplete invalidation. Codegen
alone may emit `query-shaped` with `audience-parity-failed` when function
membership does not exactly imply the establishment predicate or when it
cannot form the installed-owner digest; the public-rooms divergent and unbound
declarations freeze those distinctions.

## Corpus movement

- `audienceParity`: executable in the main corpus as two exact-audience pairs,
  one for each frozen room scope. Each has real invocations for one member and
  one outsider, independent establishment and strict evaluation evidence, and
  exact complete allow/deny vectors. The admitted side additionally freezes
  and executes the delivered query through G2-A; the denied side executes no
  graph and exposes no result bytes.
- `scopeMismatch`: executable in the main corpus with two real P/Q instances
  of the compiler-emitted `scope-unbound` query-shaped carrier.
- `authorityTransition`: remains sidecarred because only G2-C can execute an
  authority-only commit and observe its fence before any new delivery.
- `mixedCommit`: remains sidecarred because only G2-C can coalesce data and
  authority invalidation in one commit and observe one fenced post-commit
  delivery.

The four G2 structural records are intentionally not removed or reshaped when
their G0 analogues become executable. `broadcast-prover-dispositions.v1.json`
records which two now have G0 proof and which two remain scheduler-dependent,
without changing the evaluator lane's input contract.
