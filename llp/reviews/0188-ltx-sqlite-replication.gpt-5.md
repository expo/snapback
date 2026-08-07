# Review artifact — LLP 0188, GPT family

## Round 1 — 2026-08-06

- Reviewer: gpt-5.6-sol via `codex exec`, reasoning effort xhigh, sandbox read-only
- Target revision r1 sha256/16 `7ebdd582eb3f66b1`; capsule `e4ce1e4db4952e0f`; instructions `c6158ed93914dac6`
- Launch 1 of this round failed before reading the capsule (codex directory-trust refusal, no review content produced); this is launch 2. tokens used
- Body below is verbatim from the runner's final message.

---

1. **MATERIAL — correctness/safety — Design §2, §5; Open question 2.** The RFC incorrectly treats the data-plane and auth SQLite state as separate: `database.sqlite3` contains app, system, and protected auth tables, while LLP 0057 and `auth-backup.rs` require that database and its keyring to share one quiescence boundary. The fix must model the whole database as replicated auth-bearing state, define an atomic database/keyring checkpoint—or an explicitly accepted physical split—and route restoration through LLP 0057/0072 declaration, quarantine, and authority-invalidation semantics rather than combining an arbitrary LTX position with another backup’s keyring or manifest.

2. **MATERIAL — correctness/coherence — Design §3; Qualification G3.** `replicated_position ≥ P` plus bucket confirmation is not LLP 0099’s qualifying checkpoint, which must be content-addressed, integrity-checked, restored into isolation, and opened at the exact source schema, durable version, and replay floor; position ordering also proves no provenance across cloned/forked databases, as LLP 0158 explicitly demonstrates. The fix must define a proof envelope binding database and stream incarnation, LTX generation and position, exact Snapback head/schema/replay floor, immutable object identities and read-back results, and successful isolated-restore evidence before `MigrationCheckpointV1` can be appended.

3. **MATERIAL — safety — Design §4; Open question 4.** A generation record written on attach is detection, not fencing: concurrent or partitioned processes can both attach and write before either observes a newer generation, and the design does not require a fencing token on each externally visible advancement. The fix must use the hosted supervisor’s monotonic authority—or an equivalent local authority—with CAS/lease enforcement, or immutable per-epoch prefixes plus one conditionally advanced authoritative head, so stale writers are harmless and database/stream/restore identities cannot mix.

4. **MATERIAL — coherence/feasibility/security — Design §2 and §4.** Direct use of `assets_s3.rs` conflicts with LLP 0111’s hosted custody rule that backup bytes travel through the supervisor and that the application Machine receives no provider credential; moreover, the existing code is an asset-specific store with `staging`/`blobs` namespaces and no public arbitrary-key or ETag-CAS interface sufficient for LTX and the proposed generation record. The fix must define a neutral, qualified object-store protocol with the required conditional semantics and preserve the supervisor-mediated hosted credential boundary, while specifying a separate operator-only custody path for self-hosted use.

5. **MATERIAL — decision quality — Design §1; Open question 1.** The RFC decides to vendor under Apache-2.0 while leaving the exact crate license metadata unresolved, and the capsule does not independently substantiate the exact Litestream v0.5.11, LTX v0.5.1, and byte-for-byte differential-conformance claims beyond the target’s description and LLP 0083’s higher-level account. The fix must make adoption contingent on verification of the pinned commit’s crate and transitive licenses, required notices, test-vector and reference-binary provenance, and reproducible conformance results.

6. **[detail] — correctness — Summary, Motivation §1, Design §3.** “Bounded-RPO” currently means only a dynamically observed lag with no declared maximum or response when replication stalls; the implementation contract should define the lag clock and position mapping, freshness of the observation, outage behavior, and whether any configured ceiling is actually enforced.

7. **[detail] — feasibility — Design §2.** The implementation handoff should state explicitly that SQLite auto-checkpointing is disabled on every writer connection and that all checkpoint/truncation paths are mediated by the replicator; the capsule excerpt shows WAL mode but cannot establish the complete checkpoint behavior of the full file.

8. **[detail] — coherence — Design §6.** LLP 0134 requires a newly introduced capability to enter the closed registry as experimental and follow a source-owned support/publication route; the RFC should name the capability ID, support predicate, target scope, acknowledgment gate, and introduction carrier rather than treating G1–G3 alone as the complete manifest-publication contract.

The narrow decision to adopt only celld’s replication mechanism is sensible, but the current RFC defers or misstates the boundaries that make that mechanism safe: the actual replicated unit, auth/keyring consistency, checkpoint identity, split-brain fencing, and hosted credential custody. Those defects affect recoverability and authority, not merely implementation detail.

VERDICT: NOT READY

## Round 2 — 2026-08-06 (delta round)

- Reviewer: gpt-5.6-sol via `codex exec`, reasoning effort xhigh, sandbox read-only (fresh run)
- Target revision r2 sha256/16 `c1bf22035469511f`; capsule `048d85218a8d4a5c`; instructions `72af6886fd257b28`
- tokens used
- Body below is verbatim from the runner's final message.

---

1. **MATERIAL — IN-DELTA — correctness/safety — §§2, 3, 6.** Snapshotting the keyring “on every change” does not establish a durable position-to-keyring mapping, upload ordering, or retention rule; consequently a replicated or pinned database boundary may lack its required keyring despite the claimed bounded RPO. The fix must bind an immutable keyring identity to each governed position and checkpoint proof, order its durability correctly, pin it with the LTX boundary, and include keyring lag in recoverability claims.

2. **MATERIAL — IN-DELTA — correctness/safety — §4.** CAS serializes head replacements but does not prove that a proposed successor descends from the current lineage, nor does the RFC define writer-exclusive generation acquisition that makes the assertion that each stale writer writes only under “its own generation prefix” true. The fix must CAS-acquire a unique writer generation, bind its exact predecessor and immutable objects, and refuse reattachment or advancement from a divergent local state.

3. **MATERIAL — IN-DELTA — coherence/safety — §4 and OQ4.** Hosted epoch binding remains optional even though LLP 0072 requires every runtime mutation to carry the current external incarnation and fence so stale actors cannot advance a head; deployment identity plus bucket-CAS does not distinguish a superseded process within that deployment. The fix must make the control-plane epoch/fence mandatory for hosted head acquisition and every advancement, with stale authority unable to win CAS.

4. **MATERIAL — IN-DELTA — coherence/feasibility/safety — §§2, 4, 5.** The replication protocol requires put/get/CAS and makes the replicator resolve and advance the head, while the hosted server receives a write-only credential; this is internally incomplete and directly diverges from LLP 0111’s application→supervisor→Tigris backup path and prohibition on application provider credentials. The fix must define a workable role split—most naturally supervisor-owned reads, head advancement, read-back, and proof—or land an explicit governing-contract amendment with equivalent custody, fencing, and compromise containment.

R2 makes important improvements: whole-database scope, exact-boundary checkpoint evidence, declared-restore composition, provenance gating, and explicit confidentiality treatment are materially better decisions. However, the unresolved keyring atomicity, fencing, and hosted-authority contradictions prevent the durability and single-writer claims from holding; I found no additional PRE-EXISTING material concern. Because the capsule contains no celld/LTX source and review is confined to it, upstream license, behavior, performance, and conformance claims rely on the target’s description; G1 appropriately makes adoption contingent on verifying them.

VERDICT: NOT READY

## Round 3 — 2026-08-06 (delta round, final of budget)

- Reviewer: gpt-5.6-sol via `codex exec`, reasoning effort xhigh, sandbox read-only (fresh run)
- Target revision r3 sha256/16 `4734113fe106dd45`; capsule `b61eede8385c3f70`; instructions `8df66e2201a501b9`
- tokens used
- Body below is verbatim from the runner's final message.

---

1. **MATERIAL — IN-DELTA — correctness — §§2, 4, 6.** “Keyring coverage” is not defined in database-position terms, and neither the head nor another durable record binds a position interval to its governing snapshot digest; upload ordering alone therefore cannot support deterministic, verifiable snapshot selection. A fix must define that durable mapping and retain each snapshot for as long as any covered LTX boundary remains restorable.

2. **MATERIAL — IN-DELTA — coherence/correctness — §§3–4.** The checkpoint proof still binds “the stream incarnation,” while §4 now declares the replication incarnation and LLP 0072’s `streamIncarnation` to be distinct identities. A fix must unambiguously bind the replication incarnation/generation lineage and, on hosted targets, separately bind the applicable LLP 0072 data/reset identity.

3. **MATERIAL — IN-DELTA — feasibility/correctness — §4.** Resume requires the local database position to equal the head, but an ordinary crash of the default asynchronous lane commonly leaves the durable database ahead of its replicated head; such a restart would incorrectly require refusal or operator-directed succession. A fix must admit a provably continuous ahead-of-head database when its history and retained WAL extend the head, while still refusing rewound or divergent state.

4. **MATERIAL — IN-DELTA — correctness/safety — §4.** The mutable head records only the current generation’s immediate predecessor, yet restores must verify the entire succession chain; after a second succession, the earlier predecessor binding is no longer guaranteed to exist anywhere. A fix must retain immutable genesis/succession records per generation and make the head digest-bind a traversable chain, including the no-predecessor initial case.

5. **MATERIAL — IN-DELTA — safety/decision quality — §4 and OQ4.** Validating an LLP 0072 epoch before a separate head CAS leaves a supersession race, and choosing between an expiring deployment-operation fence and a first-class replication epoch is an authority/lifetime decision, not merely representation. A fix must choose the replication authority and atomically serialize its validation with head advancement so no old epoch can commit after supersession.

6. **MATERIAL — IN-DELTA — coherence — §5.** LLP 0111 explicitly requires backup bytes to travel through the supervisor with no application provider credential, whereas r3 grants one and merely calls the divergence out for later review. A fix must make accepted LLP 0072/0111 amendments and exact store-policy qualification explicit prerequisites for this role split; absent those, the supervisor-mediated byte path must remain mandatory.

7. **MATERIAL — IN-DELTA — safety/verification — §7.** G2 and G3 do not exercise the new fencing protocol’s critical cases: ahead-of-head restart, competing writers, CAS loss, stale hosted epoch, crashes around upload/head advancement, or multiple successions. A fix must add an acceptance matrix demonstrating refusal and recovery across those cases before the single-writer and lineage claims can be accepted.

8. **MATERIAL — PRE-EXISTING — safety/decision quality — §5 and OQ2.** The self-hosted policy still permits provider-side-only encryption even though the same readable prefix contains low-entropy verification-code digests and their HMAC keys; r3 now identifies the exposure but leaves the governing policy unresolved. A fix must prevent a bucket reader from obtaining both classes through independently custodied client-side encryption, or explicitly ratify and tightly scope the resulting weaker authentication threat model.

9. **MATERIAL — PRE-EXISTING — correctness — §3.** Pin lifetime is tied to a “consuming admission,” but an LLP 0072 backup manifest can remain retained for later or repeated restores after any particular admission concludes. A fix must keep boundary objects pinned for the full lifetime of every referencing backup, checkpoint, rehearsal, and rollback artifact.

R3 improves the proposal substantially by making keyring participation, restore identity, hosted custody, and the LLP 0057 dependency explicit. The remaining defects are concentrated in the new frontier and fencing protocols and are acceptance-critical rather than implementation detail. Because review was confined to this capsule, the external celld/LTX claims were not independently verified; this assessment relies on the target and the included LLP 0083 description, with G1 appropriately retaining external provenance verification.

VERDICT: NOT READY

## Round 4 — 2026-08-06 (delta round, extension round 1)

- Reviewer: gpt-5.6-sol via `codex exec`, reasoning effort xhigh, sandbox read-only (fresh run)
- Target revision r4 sha256/16 `e66652eb41751f80`; capsule `bc002288ee2d16f2`; instructions `6001fa51b3fc33e4`
- tokens used
- Body below is verbatim from the runner's final message.

---

1. **MATERIAL — IN-DELTA — correctness/safety — §§2, 4–5.** Coverage is mutable by addition: the append credential can later add a backdated or tied coverage record, while “greatest covered-from” changes or leaves undefined the governing snapshot because the head commits neither a coverage tip nor an exact LTX chain tip. The fix must make each head CAS select authenticated LTX and coverage roots/tips, link records to their predecessor and generation, and ignore or refuse unreachable, duplicate, or conflicting records.

2. **MATERIAL — IN-DELTA — feasibility/safety — §4 and OQ4.** Calling epoch validation and object-store head CAS “one operation” at the supervisor does not make them atomic when LLP 0072 authority and the bucket head have separate linearization points; OQ4 leaves the essential representation unresolved. The required amendment must choose one authoritative CAS domain and specify supersession, in-flight stale writes, crashes, and lost-response reconciliation.

3. **MATERIAL — IN-DELTA — decision quality/safety — §3.** The WAL cap is named but its behavior is not decided, leaving open materially different outcomes such as write refusal, shutdown, disk exhaustion, or loss of the unshipped replication tail. The fix must select a safe default that preserves unshipped frames and reserved disk headroom, with explicit write-admission and restart behavior at the cap.

4. **MATERIAL — IN-DELTA — safety/qualification — §7.** G2/G3 can pass without rotating or pruning the keyring, crashing around snapshot/coverage publication, testing conflicting coverage records, or exercising retention and pin transitions. The acceptance corpus must cover positions around keyring changes, every relevant crash window, encrypted-snapshot recovery, missing/wrong keys, and pin-preserving compaction/retention.

5. **[detail] — IN-DELTA — feasibility — §5 and OQ5.** Unconditional self-hosted keyring encryption needs an operator recovery-key carrier, but the described operator surface mentions only bucket configuration and credentials. The implementation contract should name external key provisioning, rotation, and clean-machine recovery.

R4 makes substantial improvements to resume semantics, succession evidence, identity separation, custody, and fencing qualification. However, authoritative history selection and hosted fencing still lack closed linearization protocols, while stall behavior and qualification leave core safety properties undecided. No separate PRE-EXISTING material concern was identified. The capsule contains no celld/LTX source, so upstream behavior and `differential_xtool` claims could not be independently verified within the required scope and were assessed using the RFC’s description.

VERDICT: NOT READY

## Round 5 — 2026-08-06 (delta round, extension round 2)

- Reviewer: gpt-5.6-sol via `codex exec`, reasoning effort xhigh, sandbox read-only (fresh run)
- Target revision r5 sha256/16 `bf3aa8b8ff2c819e`; capsule `653271b8a357d52d`; instructions `9dd3bfa8d1764ee4`
- tokens used
- Body below is verbatim from the runner's final message.

---

1. **MATERIAL — IN-DELTA — safety/feasibility — §4 and §7 (G3).** The claimed “one authoritative CAS domain” still depends on a second authority—the credential service—whose revoke/grant operations may overlap through propagation delay, non-revocable sessions, or already authorized requests; therefore revoke-then-grant alone does not justify the claim that a superseded supervisor can never advance the head. The fix must define a store-qualified revocation barrier or move epoch validation into the head’s actual linearization operation, specify reconciliation for every named in-flight/crash/lost-response window, and exercise those windows in G3 rather than only probing one superseded write.

2. **MATERIAL — PRE-EXISTING — coherence — §5 and Open question 4.** §5 still says head advancement is “where §4’s atomic LLP 0072 epoch check runs,” and Open question 4 still says the epoch is “validated atomically with the conditional write,” directly contradicting r5 §4’s explicit rejection of that model. The fix must replace both passages with the credential-handover decision and accurately delimit what remains open.

3. **MATERIAL — IN-DELTA — safety/coherence — §4, §5, and G2f.** Head separation is simultaneously absolute (“a compromised server can neither advance nor rewrite the head” and G2f always denies the append credential) and optional on self-hosted stores (“a separate lifecycle-scoped credential … where the store supports it”); moreover, without immutability, a compromised or cloned loser retains its object-write credential after losing CAS and need not halt, contradicting §4’s every-lane claim that stale-writer output is harmless. The fix must define where and how the self-hosted lifecycle credential executes and make the required separation/enforcement mandatory for the fencing claim, or explicitly downgrade the self-hosted threat model, gates, and stale-writer guarantees.

4. **[detail] — IN-DELTA — correctness — §2 and G2f.** The intended rule that reachable backdated records refuse appears only indirectly in G2f, while §2 explicitly names refusal only for reachable conflicts. The implementation contract should state the reachable-chain validation invariants—including coverage-position monotonicity, duplicate handling, and genesis anchoring—next to governing-snapshot selection.

5. **[detail] — IN-DELTA — feasibility — §3.** Refusing new writes once the WAL reaches its cap does not yet say how already admitted or concurrent writes are prevented from consuming the reserved headroom. The implementation should reserve or bound space per admitted write, or define a safe transaction-abort mechanism before disk exhaustion.

R5 makes strong progress: authenticated coverage reachability, the no-truncation WAL policy, explicit hosted dependencies, and per-store capability receipts are materially better decisions. It is not ready because the hosted fence still lacks a feasible single-authority handover contract and the self-hosted credential posture is internally inconsistent. Under the capsule-only constraint, the external celld/LTX claims were not independently verified; this assessment relies on the target’s descriptions and its G1 provenance contingency.

VERDICT: NOT READY

## Round 6 — 2026-08-06 (delta round, extension round 3 — final)

- Reviewer: gpt-5.6-sol via `codex exec`, reasoning effort xhigh, sandbox read-only (fresh run)
- Target revision r6 sha256/16 `cfaab18a75bb3801`; capsule `35cdac2fda64acb1`; instructions `f1a0e39e4c1e141f`
- tokens used
- Body below is verbatim from the runner's final message.

---

1. **MATERIAL — IN-DELTA — Correctness/coherence — §2.** A rewind succession from predecessor coverage tip `Q` to divergence `P < Q` makes the successor’s initial record chain `Q → P`, violating the newly unconditional covered-from monotonicity rule; succession at an existing boundary can likewise violate “duplicates refuse.” The fix must define an explicit generation-boundary reset and its validation/selection rules so rewinds and equal-boundary successions work without weakening ordinary-chain checks.

2. **MATERIAL — IN-DELTA — Correctness/safety — §2.** Masked post-divergence records can become indispensable authentication bridges because the successor chains from the predecessor’s final tip, yet the existing retention rule permits deleting a record once no restorable position uses its snapshot. The fix must retain the transitive authentication closure of every live head/genesis—or separate permanent chain metadata from collectible snapshots and LTX payloads—so valid retention or compaction cannot break lineage verification.

3. **MATERIAL — IN-DELTA — Safety — §4.** Expiry of a bounded credential TTL is listed as a sufficient revocation barrier even though the preceding text correctly observes that already-authorized requests may remain in flight; TTL expiry alone does not prove such a write cannot commit afterward. The fix must require a store-qualified drain or bound covering completion of previously authorized requests, treat stores lacking that guarantee as unsupported, and exercise a delayed pre-revocation write across the barrier.

4. **MATERIAL — IN-DELTA — Safety/coherence — §5.** Self-hosted head safety is conditioned only on store credential-separation support, but wrong-role denial does not protect the head from a compromised host if the lifecycle/head credential is also resident or usable there; the document places both roles in one operator custody domain without establishing process or off-host isolation. The fix must require custody that keeps the lifecycle credential outside the application host/process, or apply the full head-seizure downgrade even when the store supports separate credentials.

5. **[detail] — IN-DELTA — Feasibility — §3.** The implementation contract should state how reservations obtain an enforceable worst-case WAL bound—or grow before additional frames—and cover migrations, auth/background writes, triggers, and rollback overhead, not merely ordinary request admission.

6. **[detail] — IN-DELTA — Safety — §5.** The asymmetric/encrypt-only requirement is scoped explicitly to segments, while client-side keyring snapshots need the same outside-deployment decrypt custody; the 0072 amendment should pin that mechanism explicitly for both object classes.

Revision r6 improves the design substantially through explicit tip validation, honest self-hosted downgrades, stronger qualification gates, and a serious handover model. However, the new cross-generation chain is internally inconsistent under rewind and retention, while the barrier and self-hosted custody claims remain stronger than their mechanisms. The capsule contains no celld/LTX source, so upstream behavior and provenance claims could not be independently verified; this review relies on the RFC’s description, with G1 appropriately remaining a contingent verification gate. All reported concerns are in the r6 delta.

VERDICT: NOT READY
