# OpenAI-family review: LLP 0108 corrective target set

**Date:** 2026-07-28
**Reviewer:** Fresh GPT-family subagent, `gpt-5.6-sol`
**Effort:** ultra
**Session:** `/root/corrective_super_refine_gpt`
**Topology:** Fresh mutually blind corrective-delta review on the isolated
37-file capsule; no prior reviews or journals available.
**Target-vector SHA-256:** `fc2e6ad00668554937cce66052912cb5bbf7e0970606ac13fb77fbebd957ae59`
**Capsule SHA-256:** `7d6a7a8f817ffea9f52b3845ba96e1f187a0ec4a23795ffd72a22bac99567313`
**Instruction SHA-256:** `f7a2c9be63db967bf5ad8a370726b311ec2155c535fa5170ced17c33ee32be58`

## Verbatim review

Set verdict: **NOT READY**. The HTTP-400 invalidation reconciliation and candidate-to-final ledger linkage are coherent, but the following blockers remain.

1. **MATERIAL · IN-DELTA — LLP 0094, hidden-qualification wire amendments; LLP 0108 §3.** `liveSubscribe` requires its own signed, reserved `QualificationUseV1`, but the closed route matrix transmits no use on live subscribe and forbids free qualification carriers. The server cannot verify the required subscription-specific use. Smallest closure: define an exact HTTP/socket live-subscribe use carrier, including its exception to paired-grant rules and schema coverage.

2. **MATERIAL · IN-DELTA — LLP 0108 §3, `requestBodySha256`.** Connection open embeds `qualificationUse` in the body while that use hashes the request body, creating a recursive digest. Smallest closure: define a carrier-stripped canonical body projection and separately bind the byte-exact carriers, method, route, and function in the sender-proof digest.

3. **MATERIAL · IN-DELTA — LLP 0108 §§3.1–3.2.** The use-journal state machine is not total:

   - Step 1 can emit qualification diagnostics before ordinary authentication, contradicting auth-first diagnostic precedence.
   - Expiry and current ceilings precede journal lookup, so a 14-day retained replay after grant expiry returns 403 rather than its response; the promised 410 state is similarly unreachable.
   - `reserved` has no crash-recovery transition, permitting duplicate mutation/frame effects or permanent wedging.

   Smallest closure: provide one authoritative transition/precedence table separating bounded parsing from emitted diagnostics, classifying existing journal entries before current-validity checks, and defining atomic settlement/resume for every operation.

4. **MATERIAL · IN-DELTA — LLP 0104, “Registered qualification invocation”; LLP 0108 §3.** The grant is not closed consistently. LLP 0104 limits expiry to ten minutes while LLP 0108 permits thirty, and LLP 0108 says the use-signing device key is already grant-bound although LLP 0104 binds only subject/session. Smallest closure: choose one expiry limit and add the exact device-key fingerprint/key id, revocation generation, and operation-by-field required/forbidden matrix to the grant contract.

5. **MATERIAL · IN-DELTA — LLP 0108 §§2 and 5; LLP 0104, candidate promotion.** Candidate DDL and indexes exist only in the disposable restore, are expressly never copied to production, and the publication CAS changes only graph/claims/maturity. A graph needing its qualified DDL can therefore activate against an incompatible production schema. Smallest closure: require schema identity with production for this release or define a crash-safe transactional production-DDL prepare/commit protocol coordinated with graph activation.

6. **MATERIAL · IN-DELTA — LLP 0108 §§4–5; LLPs 0104/0105, first publication.** No executable provisional-activation transition exists. If final CAS activates the graph, provisional expiry no longer protects the post-CAS observation; a failed withdrawal leaves a non-expiring final claim live. If provisional state activates it, the capabilities remain proposed/unsupported and cannot be ordinarily observed. Smallest closure: define provisional activation CAS → bounded public observation → finalization CAS, including support, expiry, withdrawal, and every crash outcome.

7. **MATERIAL · IN-DELTA — LLP 0108 §§1 and 5; `src/manifest.rs`.** An external CAS cannot perform the stated maturity transition. Maturity is a code constant and both support predicates are hard-coded false. Smallest closure: ship code-owned experimental maturity while gating runtime support on a verified final family fact, or explicitly define and implement a code-owned effective-maturity derivation consistent with LLP 0058.

8. **MATERIAL · IN-DELTA — LLP 0108 §§4–5; LLP 0105 authority sections.** `CapabilityClaimFamilyV1` lacks a complete canonical envelope and signing authority: no schema version, closed family/claim vocabulary, key id, canonical signature preimage, or purpose-limited online signer. The offline root cannot continuously sign grants, claims, migration deadlines, and hosted admissions, while the enrollment intermediate is authorized only for operator certificates. Smallest closure: define purpose-limited root-certified service intermediates and complete domain-separated schemas, rotation, revocation, overlap, and verification rules.

9. **MATERIAL · IN-DELTA — LLP 0108 §5; LLP 0105, closed command registry.** No request/scope authorizes provisional issuance, publication finalization, or claim withdrawal. It is unclear whether `deploy.apply` silently includes customer-visible capability publication or publication is impossible. Smallest closure: explicitly bind these transitions to retained deploy approval or add exact publication request variants and scopes.

10. **MATERIAL · IN-DELTA — LLP 0094, “Hosted-ephemeral authority instance”; LLP 0105, “Ephemeral wire and custody.”** The wire contract is not singular: LLP 0105 retains a string protocol token while LLP 0094/code use numeric `1`; the document says “member” without identifying the HTTP header versus WebSocket-upgrade carrier; stale-instance codes/statuses are incomplete; and emitted authority diagnostics fall through the included HTTP mapper. Smallest closure: add one authoritative per-boundary table covering token, carrier, conditional presence, echo/stamping, refusal/status, and reconnect behavior, then align schemas and code.

11. **MATERIAL · IN-DELTA — LLP 0094 hosted-ephemeral closure; LLP 0105 implementation checkpoint.** Offerless hosted connections are not target-enforced. Included code accepts `(expected=None, presented=None)`, so callers can directly exercise hosted ephemeral routes without restart fencing despite capability discovery withholding. Smallest closure: bind “hosted authority required” into grant lineage and refuse offerless hosted ephemeral operations, retaining `(None,None)` only for legacy local operation.

12. **MATERIAL · IN-DELTA — LLP 0105, root custody.** The older contract requires root-signed enrollment bundles, while the correction makes the root offline and provides no intermediate issuance/renewal/unsealing ceremony or replacement bundle signer. Enrollment can stop after seven days or silently require the offline root online. Smallest closure: assign bundle/certificate signers explicitly and define 2-of-3 intermediate issuance/renewal, unsealing, zeroization, overlap, expiry, journaling, and commands.

13. **MATERIAL · IN-DELTA — LLP 0105, root recovery and command registry.** Recovery invalidates every operator certificate and target enrollment, but defines no first replacement-owner bootstrap or device/target rebind requests. With no valid operator, enrollment issuance can deadlock. Smallest closure: have recovery atomically emit a one-use recovery-key-bound owner bootstrap and exact device/target rebind commands and proofs.

14. **MATERIAL · IN-DELTA — LLP 0105, enrollment delegation.** Delegable subsets are asserted but absent from bundle/certificate payloads, and no root-confirmed admin-delegation command exists. `operator.enroll` can therefore amplify privilege or administrator succession becomes impossible. Smallest closure: bind issuer certificate, effective scopes, and delegable scopes; enforce subset delegation; and define admin delegation or make admin scopes nondelegable.

15. **MATERIAL · IN-DELTA — LLP 0105, supervisor request replay.** The external journal retains only the highest sequence and response digest, yet exact replay must reproduce certificates and effect responses. A digest cannot return a lost one-use result. Smallest closure: atomically retain bounded canonical response bytes or a content-addressed response reference, with retention/GC and replay precedence across expiry, revocation, rotation, and recovery.

16. **MATERIAL · IN-DELTA — LLP 0099, authority and corrective deadline; controlling LLP 0081 §4.** LLP 0099 imposes +140/+180 cuts after `published-held`, but LLP 0081 says the ceiling stops applying there, and LLP 0099 explicitly says LLP 0081 wins. An executor may lawfully ignore the correction. Smallest closure: amend LLP 0081 to authorize the stricter profile and revise LLP 0099’s precedence and corpus language.

17. **MATERIAL · IN-DELTA — LLP 0099, corrective deadline.** `MigrationDeadlineV1` lacks schema version, algorithm, key id/purpose, canonical preimage/domain, timestamp encoding, and immutable admission/audience binding. `admissionExpiresAt` is only “monotone,” allowing extension without a maximum TTL. Smallest closure: define the complete signed envelope and make admission expiry fixed, non-extendable, and bounded.

18. **MATERIAL · IN-DELTA — LLP 0041, nine-package candidate promotion.** Tag mutation has no release lease or expected-value ownership. Concurrent publishers can overwrite one another, and rollback can clobber a newer release. Additionally, failure restores only the CLI root while already-moved dependency/runtime `latest` tags remain partially promoted. Smallest closure: serialize mutation under a durable release epoch, compare before every write, and perform reverse-order, expected-value-guarded restoration/removal of the complete tag vector.

19. **DETAIL · IN-DELTA — LLP 0108 §§2–3.** The disposable destination is destroyed, while candidate terminal responses must remain replayable for fourteen days. Smallest closure: name the encrypted replay store, retained data class, quotas, cleanup exception, GC tombstone, and access rules.

20. **DETAIL · IN-DELTA — LLP 0105, `release.upload`.** The authority separation is correct, but the “bounded byte-stream” has no byte/time ceiling or partial-upload disposition. Smallest closure: specify streaming bounds, spend reservation, temporary-object handling, atomic receipt finalization, replay, and cleanup.

Per-target verdicts:

- LLP 0041 — **NOT READY**: publication mutation ownership and full-vector rollback remain unsafe.
- LLP 0094 — **NOT READY**: qualification-live and hosted-ephemeral wire contracts remain non-executable.
- LLP 0099 — **NOT READY**: controlling authority nullifies the new deadline, whose signed envelope is also incomplete.
- LLP 0104 — **NOT READY**: its qualification-grant and atomic-promotion reconciliation inherits material gaps.
- LLP 0105 — **NOT READY**: hosted enforcement and operator/root authority remain incomplete.
- LLP 0108 — **NOT READY**: qualification replay, data activation, maturity, and provisional publication are unresolved.
- Target set — **NOT READY**.

VERDICT: NOT READY
