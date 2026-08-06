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
