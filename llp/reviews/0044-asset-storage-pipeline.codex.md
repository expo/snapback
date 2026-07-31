# LLP 0044 review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind on 0044 review artifacts and journals, network reachable (TUS 1.0.0 protocol page fetched); target = working-tree v3, uncommitted on top of a1a96df5, SHA-pinned
**Target SHA-256:** `e2ce07941a4e9202e81b1713fb5f7284bb1098eb923e24c97d15df6d18746511`
**Instruction SHA-256:** `a679739ab3802616567aacc0ba1702ce262c9c7aad72968a31f295414ae296f1`
**Status:** completed

## Verbatim review

Target SHA-256: `e2ce07941a4e9202e81b1713fb5f7284bb1098eb923e24c97d15df6d18746511` — matches the expected value.

Date: 2026-07-31

Method: Independently read the complete working-tree target, the required cited LLPs (0007, 0011, 0012, 0013, 0028, 0036, 0037, 0039, 0047, 0053, 0064, 0070, 0099, 0107, 0108, 0109, 0114, 0124, 0127, 0129), and the official TUS 1.0.0 protocol using network access; I did not read `llp/reviews/`, super-refine journals, or `issues/`.

1. **Overall assessment**

V3 is a major improvement over the asset-row-equals-object shape described in the revision history. Its separation of logical assets, upload attempts, blobs, and renditions is directionally sound; restricted staging, canonicalization before digesting, app-scoped deduplication, explicit delivery profiles, and immutable rendition publication are the right foundations.

It is not yet at the stated READY bar. Several central safety claims currently rest on named mechanisms rather than fully specified protocols. Most importantly, there is no actual asset read-authorization policy or invalidation integration; typed-reference enforcement can apparently be bypassed by an ordinary handler write; the lifecycle state machines do not close cancellation, deletion, retry, and required-rendition cases; and atomicity across the database and byte store is asserted without a recoverable publication protocol.

There are also verified corpus mismatches. LLP 0108’s controlling reconciliation explicitly removed the expected-operation carrier that this RFC appears to rely on. LLP 0070’s first durable-work profile admits host-plan actions, not trusted raw-byte processors. LLP 0109’s seed artifact is closed and cannot currently carry binary fixtures. LLP 0064 requires client claims per maintained distribution and OS, not merely protocol tests against local.

The document should remain Draft and undergo a design-closure revision before implementation begins. Prototyping individual byte-store or image-library choices may inform open implementation questions, but it will not resolve the authorization, transaction, identity, and state-machine defects below.

VERDICT: NOT READY

2. **Strengths**

- The four-record model assigns distinct identities and lifecycles to assets, attempts, blobs, and renditions, avoiding path identity and retry collisions (`llp/0044-asset-storage-pipeline.rfc.md:278`, `:298`, `:314`, `:331`).

- Restricted staging is treated as untrusted custody, and transport integrity is correctly separated from canonical content identity. In particular, the RFC rejects ETags and unverified client digests as canonical identity (`llp/0044-asset-storage-pipeline.rfc.md:349`, `:360`, `:378`).

- Image privacy rewriting occurs before digesting and publication, which makes deduplication operate on the deliverable canonical bytes rather than privacy-bearing source bytes (`llp/0044-asset-storage-pipeline.rfc.md:384`).

- App-scoped deduplication and logical rather than physical quota accounting are sound anti-oracle choices (`llp/0044-asset-storage-pipeline.rfc.md:391`, `:397`, `:403`).

- The three delivery profiles state materially different revocation semantics instead of treating signed URLs as permission truth (`llp/0044-asset-storage-pipeline.rfc.md:512`, `:517`, `:525`, `:538`).

- Immutable rendition objects plus generation-checked pointer switching are the correct basis for at-least-once regeneration (`llp/0044-asset-storage-pipeline.rfc.md:573`).

- The durable/ephemeral split is consistent with LLP 0013: durable readiness is observed through system-row changes, while transfer progress is expressly presentation state (`llp/0044-asset-storage-pipeline.rfc.md:621`, `:629`, `:645`; `llp/0013-ephemeral-realtime-state.rfc.md:55`).

- The RFC correctly limits LLP 0099 to executor precedent rather than claiming it authorizes asset processing (`llp/0044-asset-storage-pipeline.rfc.md:591`; `llp/0099-container-vm-migration-executor-profile.spec.md:46`).

- The named TUS core and extension names—creation, expiration, checksum, and termination—are real TUS 1.0.0 protocol elements. Authentication being supplied by Snapback rather than TUS is also faithful to the protocol (`llp/0044-asset-storage-pipeline.rfc.md:496`).

3. **Concerns**

1. **BLOCKING — No asset read-authorization policy is defined.**

   `llp/0044-asset-storage-pipeline.rfc.md:121` defines upload authorization, while `llp/0044-asset-storage-pipeline.rfc.md:648` asserts that metadata visibility and delivery pass the LLP 0039 gate. That gate resolves caller authority and an `authenticated` requirement; it does not decide which authenticated caller may read which asset (`llp/0039-auth-vertical-slice.rfc.md:283`). LLP 0011 distinguishes authentication from data-visibility authorization (`llp/0011-auth-and-permissions.rfc.md:169`) and states that no general permission language is implemented (`llp/0011-auth-and-permissions.rfc.md:446`).

   The upload authorizer’s `reads` list and returned `owner` do not answer whether readers are the owner, readers of an attached row, workspace members, explicit grantees, or callers admitted by a second generated handler. Consequently, `private-strict` cannot presently prove its per-request authorization or revocation claim. The RFC also does not connect asset dependencies to LLP 0053’s `permissionBacking` and obligation machinery (`llp/0053-authorization-invalidation.rfc.md:349`).

   Resolve this by defining a generated metadata/delivery authorization policy, its captured dependencies, attachment-derived access semantics if any, and its LLP 0053 invalidation projection. Acceptance must exercise membership removal, reparenting, logout, deletion, dropped invalidation delivery, metadata hiding, live renderer blanking, and ordinary/range delivery denial.

2. **BLOCKING — Typed asset references lack an enforceable anti-forgery and commit-time mechanism.**

   The RFC says arbitrary strings are not references and that the client cannot manufacture an admitted reference (`llp/0044-asset-storage-pipeline.rfc.md:429`, `:463`). But the example ultimately passes a value into an ordinary document update (`llp/0044-asset-storage-pipeline.rfc.md:437`). It never states how the storage boundary distinguishes the result of `ctx.assets.attach()` from a string written directly by app code, such as `ctx.db.update(..., {avatar: args.assetId})`.

   Attachment authorization also appears to execute before the ordinary write commits (`llp/0044-asset-storage-pipeline.rfc.md:445`). LLP 0007 requires read dependencies observed outside the final write lock to participate in commit-time validation (`llp/0007-storage-portability.spec.md:445`). Otherwise deletion, ownership change, lifecycle-generation change, or revocation can race between attachment checking and row/edge commit.

   Resolve this with either an unforgeable host-owned write operand or mandatory storage-layer validation of every `v.assetRef` field at commit. The same hook must cover Ibex, HostPlan, seed, import, migration, admin edits, row deletion, optional fields, and arrays. It must atomically compare asset generation and authorization, update reverse edges, and reject direct forged-string writes. Add fault/race tests, not merely helper-level tests.

3. **BLOCKING — The lifecycle state machines are incomplete and internally inconsistent.**

   Asset availability is `pending | ready | rejected | deleted` (`llp/0044-asset-storage-pipeline.rfc.md:290`), but the normative transition summary allows only `pending → ready | rejected` and then `ready | rejected → deleted` (`llp/0044-asset-storage-pipeline.rfc.md:635`). Pending-asset GC nevertheless removes pending assets (`llp/0044-asset-storage-pipeline.rfc.md:678`), and explicit deletion is described without excluding pending assets (`llp/0044-asset-storage-pipeline.rfc.md:692`).

   Attempt cancellation, expiry, and failure have no defined effect on the parent asset. Terminal attempts are append-only (`llp/0044-asset-storage-pipeline.rfc.md:311`), yet operator inspection can retry finalization (`llp/0044-asset-storage-pipeline.rfc.md:740`) without saying whether that creates a successor attempt, reuses staging, or violates terminality. The finalizer publishes asset availability in step 8 and only schedules renditions in step 9 (`llp/0044-asset-storage-pipeline.rfc.md:360`), while later text permits a required rendition to be part of the asset-ready contract (`llp/0044-asset-storage-pipeline.rfc.md:579`).

   Resolve this with an exhaustive transition table covering attempt outcome → asset outcome, pending deletion, retry eligibility, staging custody, required versus optional renditions, cancellation/finalization/deletion races, and every generation change. Acceptance should execute all legal transitions and reject all unlisted ones.

4. **BLOCKING — “Atomic” publication crosses substrates without a recovery protocol.**

   The finalizer “reuses or creates” a blob and atomically publishes the rendition and asset (`llp/0044-asset-storage-pipeline.rfc.md:369`). Database rows can commit atomically with each other, but filesystem/S3 object creation cannot join that transaction. A crash after writing an opaque object but before recording its key produces an undiscoverable orphan; recording the row first can expose a missing object. The same gap exists for rendition generation and store migration (`llp/0044-asset-storage-pipeline.rfc.md:417`, `:573`).

   Concurrent finalizers also need a uniqueness and conflict protocol for `(app, digest algorithm, digest, canonicalization policy)`. “May reuse” is insufficient to prove the acceptance claim that identical uploads yield one eligible blob (`llp/0044-asset-storage-pipeline.rfc.md:848`). Mutable reference counts add another corruption surface unless every transition and repair is defined.

   Resolve this with durable write-ahead publication records, deterministic or durably recorded object keys, idempotent store operations, database uniqueness constraints, explicit orphan states, and a reconciliation sweep. Specify crash recovery at every store/transaction boundary, including migration, pointer publication, reference-count changes, and physical deletion. Add fault-injection acceptance for every cut.

5. **BLOCKING — Quota and GC accounting is underdefined and remains gameable.**

   “Logical owned bytes” does not say whether usage means declared source length, received source length, canonical primary bytes, retained raw bytes, or primary plus derived renditions (`llp/0044-asset-storage-pipeline.rfc.md:403`). Canonicalization can change size, and generated renditions consume additional storage after the initial reservation settles. Deletion-time quota release is not defined.

   Referenced pending/rejected assets are retained indefinitely (`llp/0044-asset-storage-pipeline.rfc.md:678`), but there is no app/principal cap on asset records, reverse edges, failures, or renditions. A client able to attach pending assets can therefore pin unbounded metadata without consuming settled byte quota. On direct multipart uploads, cancellation and reservation release must also be ordered after signed upload instructions can no longer add staging bytes; the current text does not fix that linearization point (`llp/0044-asset-storage-pipeline.rfc.md:409`, `:502`).

   Resolve this with a complete accounting vector: reserved source bytes, received staging bytes, canonical logical bytes, rendition bytes, physical bytes, and bounded counts for attempts/assets/renditions/edges. Define atomic settlement and release rules, direct-upload invalidation ordering, canonicalization expansion failure, and referenced-failure retention caps. Acceptance must include adversarial create/attach/cancel, duplicate, expansion, and GC races.

6. **BLOCKING — Upload-intent reference identity relies on machinery the controlling corpus removed.**

   The RFC requires references carrying app, intent, contract, implementation, and capability identity and refusing stale references before effects (`llp/0044-asset-storage-pipeline.rfc.md:147`). LLP 0108’s controlling reconciliation is titled “No new expected-operation or compatibility protocol in v1” and removes `ExpectedOperationV1` carriage (`llp/0108-inline-handlers-and-result-contracts.spec.md:663`). LLP 0064 confirms that this was only a type/egress tightening and “adds no `ExpectedOperationV1` carrier” (`llp/0064-native-client-surfaces.rfc.md:251`).

   The RFC also does not state what happens when an intent implementation or privacy policy changes while an attempt is open: whether finalization uses the frozen admitted policy, current policy, an explicit compatibility intersection, or rejects and strands the asset.

   Resolve this by specifying the exact Rust-owned upload-reference DTO and identity bytes, its protocol-version registration, and its relationship to the existing whole-artifact reference. Define deployment overlap, artifact retention, revocation, stale in-flight attempts, and policy migration. Amend the owning reference/protocol LLPs rather than citing a carrier that does not exist.

7. **BLOCKING — Neither runner generation currently supports the claimed processing semantics.**

   The cron fallback is described only as a bounded sweep that “claims work” using unspecified generation-fenced transitions (`llp/0044-asset-storage-pipeline.rfc.md:600`). LLP 0028’s backoff retry remains unimplemented and rejected (`llp/0028-cron-scheduled-execution.rfc.md:607`). LLP 0127 also explicitly bars “cron-ledger job evidence” because successful sweeps can hide per-job failure (`llp/0127-parity-and-local-first-synthesis.rfc.md:567`).

   The successor is not a direct fit either. LLP 0070’s first profile admits generated host-plan actions only (`llp/0070-durable-background-work.rfc.md:98`); the asset processor is a trusted raw-byte system processor that ordinary actions are expressly denied. LLP 0070 remains Draft and forbids capability claims based on an ad hoc loop or cron sweep (`llp/0070-durable-background-work.rfc.md:524`).

   Resolve this by either fully specifying an asset-domain durable claim/lease/retry state machine for the compatibility runner, without claiming LLP 0070, or amending LLP 0070 with an admitted trusted built-in processor job class. In either case define capacity, retry ceilings, deadlines, crash recovery, stale-worker fencing, inspection, and deterministic drive semantics.

8. **MATERIAL — The TUS extension set does not cover the RFC’s deferred-length behavior, and checksum use is underspecified.**

   The RFC permits a streaming source that defers length (`llp/0044-asset-storage-pipeline.rfc.md:409`) but names only creation, expiration, checksum, and termination (`llp/0044-asset-storage-pipeline.rfc.md:496`). Under the [official TUS 1.0.0 protocol](https://tus.io/protocols/resumable-upload), deferred length is separately advertised as `creation-defer-length`.

   TUS checksums are also client-optional per `PATCH`; merely implementing the extension does not prove that every transferred chunk had a checksum. That matters because acceptance says transport integrity is verified (`llp/0044-asset-storage-pipeline.rfc.md:841`).

   Resolve this by forbidding deferred-length uploads on the TUS lane or adding `creation-defer-length` explicitly. State whether generated clients must checksum every `PATCH`; otherwise name the server-side read-back/stream mechanism that provides the transport-integrity claim. Use “TUS 1.0.0” as the exact protocol version.

9. **BLOCKING — Deduplicated blobs and asset-level delivery/deletion lack a URL identity model.**

   Two assets may share one blob (`llp/0044-asset-storage-pipeline.rfc.md:393`), while public renditions receive immutable URLs and asset deletion supposedly stops future canonical access (`llp/0044-asset-storage-pipeline.rfc.md:517`, `:692`). If the public URL exposes the shared blob object, deleting asset A cannot stop A’s origin access without also affecting asset B. If the URL is an asset/rendition alias, the RFC must say so and define how origin denial, CDN caching, retention, and blob GC compose.

   The same identity question affects signed URLs: issuance must be bound to asset/rendition/generation authorization rather than treating a shared blob path as the authorization object. Strict delivery also needs an explicit private/no-store cache posture.

   Resolve this by defining URL identity and cache keys for all three profiles, including whether object-store blobs remain private behind asset-specific delivery aliases. Specify deletion at origin, already-issued authority, cache behavior, dedup interaction, and retention for each profile.

10. **BLOCKING — Capability claims conflate target support, subsystem composition, and client distribution evidence.**

   `asset-lifecycle-v1` bundles the local store, TUS, typed references, strict delivery, ranges, receipts, the headless task, and first-party projections (`llp/0044-asset-storage-pipeline.rfc.md:750`), while delivery profiles and stores are later called independent facts (`llp/0044-asset-storage-pipeline.rfc.md:767`). It is unclear whether lifecycle is a target capability, a client-SDK capability, or a composite requiring both.

   The RFC then lets each SDK “claim `asset-lifecycle-v1`” after tests against the canonical local target (`llp/0044-asset-storage-pipeline.rfc.md:272`). LLP 0064 requires exact arm × lane × auth-profile evidence and per-OS claims (`llp/0064-native-client-surfaces.rfc.md:28`). It also states that Swift is the only maintained protocol-native artifact; Kotlin is reference evidence and Python is not named (`llp/0064-native-client-surfaces.rfc.md:94`).

   Resolve this with separate machine-readable target, protocol, client-distribution, OS, store, delivery, integrity, range, and image-pipeline predicates plus a dependency graph defining the composite product claim. JavaScript, Swift, Kotlin, and Python must be staged independently; protocol vectors alone must not establish packaging or OS support.

11. **MATERIAL — Binary seed fixtures contradict the closed LLP 0109 seed artifact.**

   The RFC says versioned seeds may carry bounded binary fixtures (`llp/0044-asset-storage-pipeline.rfc.md:786`). LLP 0109 defines a closed `SeedArtifactV1` containing `tables` (`llp/0109-versioned-seed-evolution.spec.md:133`) and requires unknown members to be rejected (`llp/0109-versioned-seed-evolution.spec.md:206`). No binary-member or asset-fixture extension exists.

   Resolve this by removing the claim or designing a separately versioned seed/asset-fixture artifact with digest, custody, install ordering, reset, authorization, quota, and cleanup semantics. Add its owning LLP amendment and acceptance cases.

12. **BLOCKING — Image processing lacks adversarial resource bounds.**

   The intent bounds encoded bytes but not decoded pixels, dimensions, frame count, decompression ratio, metadata size, decoder memory/CPU, generated output bytes, or cumulative rendition work (`llp/0044-asset-storage-pipeline.rfc.md:125`, `:559`). “Bounded renditions” is not an enforceable hostile-input contract. A small compressed image can still exhaust memory or CPU during trusted detection and privacy rewriting.

   LLP 0047 requires enforceable memory, time, host-call, and result bounds before hosted/untrusted claims (`llp/0047-hosted-execution-limits.rfc.md:65`). Trusted built-ins still need equivalent asset-specific limits because their input is adversarial.

   Resolve this with exact decoded-media and processing ceilings, safe decoder/subprocess isolation posture, timeout/cancellation behavior, output limits, and a malicious/truncated/decompression-bomb corpus. Make those facts prerequisites for `asset-image-pipeline-v1`.

13. **MATERIAL — Backup, restore, and export semantics remain open but are not capability-excluded.**

   The RFC defines store-to-store migration (`llp/0044-asset-storage-pipeline.rfc.md:417`) but leaves backup, object-store lifecycle, legal hold, and restore-epoch interaction open (`llp/0044-asset-storage-pipeline.rfc.md:908`). LLP 0007 requires both logical export/import and byte-level backup/restore to have explicit component boundaries (`llp/0007-storage-portability.spec.md:604`). Restoring database metadata without the matching blob cut can resurrect broken references; restoring bytes without tombstones can resurrect deleted content.

   Resolve this by defining an application-consistent asset backup manifest and restore epoch, or explicitly reporting backup/restore/export as missing for every asset capability. Acceptance must prove a consistent cut, missing/corrupt object refusal, restored authorization fencing, and non-resurrection after deletion.

14. **MATERIAL — Acceptance does not cover several normative commitments.**

   The Acceptance section does not test authority-change task blanking and late-work fencing (`llp/0044-asset-storage-pipeline.rfc.md:208`), signed-URL refresh and typed renderer fallbacks (`:223`), S3 multipart/CORS/provider qualification (`:475`, `:502`), store migration (`:417`), required-rendition readiness (`:579`), lifecycle callback idempotency (`:584`, `:615`), or trusted delivery headers/disposition (`:552`). The broad manifest assertion at `llp/0044-asset-storage-pipeline.rfc.md:883` is not an executable substitute for these scenarios.

   Resolve this with a normative-commitment-to-acceptance traceability table and named target/client/fault runners. Every unsupported row should become an explicit nonclaim or later capability rather than remaining untested prose.

4. **Suggestions**

- Add one consolidated transition table spanning asset, attempt, blob-publication, rendition, quota reservation, and background claim state. The current prose makes cross-record races difficult to audit.

- Add a capability dependency matrix showing the exact prerequisites for each intent shape. For example, image + strict + required thumbnail should mechanically require more than generic lifecycle.

- Add a threat-model subsection organized by attacker: unauthenticated caller, authenticated malicious app user, malicious app code, compromised signed URL, hostile media bytes, stale worker, and storage administrator.

- Separate the local-filesystem first slice from the S3 qualification design more visibly. The S3 seam can remain designed without making every provider-specific commitment part of the first implementation.

- Define `maxFiles` or remove it. The public task accepts one `file`, the stable identity is singular, and no batch identity or atomicity semantics are otherwise specified (`llp/0044-asset-storage-pipeline.rfc.md:128`, `:180`).

5. **Open questions**

- Is asset read authority owner-only, derived from authorized access to referencing rows, granted by a separate generated handler, or some combination?

- Is `ctx.assets.attach()` intended to return an unforgeable host value, or will every typed asset field be validated by the storage commit hook?

- What exactly consumes logical quota: source bytes, canonical primary bytes, all renditions, retained raw bytes, or a declared combination?

- Are public and signed delivery URLs asset/rendition-specific aliases, or do they expose blob-object identity?

- Does cancellation preserve a retryable pending asset, reject it, or delete it? What happens if that pending asset is already attached?

- Will the first lifecycle implementation contain its own durable processing ledger, or wait for an LLP 0070 processor class that can legally access raw bytes?

- Are asset bytes included in Snapback backup/export/restore claims, or is that an explicit separate capability?

6. **Recommended next step**

Revise v3 before implementation. The next revision should first close four invariants: asset read authorization/invalidation, commit-time typed-reference enforcement, the complete cross-record state machine, and recoverable database/object-store publication. Then add exact quota accounting, URL identity, runner admission, and capability algebra; convert every normative commitment into an acceptance row; and run a fresh blind dual-family review on the resulting hash.


## Round 2 — 2026-07-31 (delta)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, read own round-1 artifact only (mutual blindness on Fable artifacts and journal maintained), network reachable (TUS 1.0.0 re-fetched); target = working-tree v4, SHA-pinned
**Target SHA-256:** `e0ed81a4eec436a552fa5dd2c8aca87eec611163000146a322dde2ef12b77065`
**Instruction SHA-256:** `d9d975e56e17a3e3774e2cfbd4dcb8dc705aa30c16d0108cac90e929118db0f4`
**Status:** completed

## Verbatim review (round 2)

Target SHA-256: `e0ed81a4eec436a552fa5dd2c8aca87eec611163000146a322dde2ef12b77065` — computed independently; matches expected v4.

Date: 2026-07-31

Method: Read the complete v4 target, only the Codex-family round-1 artifact, the relevant governing corpus documents, and the official TUS 1.0.0 protocol; independently checked every prior concern and scrutinized all new text.

## 1. Overall assessment

V4 is substantially stronger. It adds real design structure rather than merely asserting desired outcomes: closed read-policy spellings, commit-boundary reference checks, lifecycle tables, write-ahead object publication, quota categories, asset/rendition URL aliases, a domain ledger, adversarial media limits, separated capability classes, and much better acceptance coverage.

Several round-1 blockers nevertheless remain only partially resolved. Most importantly:

- `via-references` depends on a reusable “row authorization” decision that the corpus does not currently define;
- the exact upload-reference DTO and the unforgeable attachment-admission carrier remain deferred to companion work;
- the publication, deletion, quota, and durable-ledger state machines are still not closed;
- the claimed integrity fallback for checksum-less TUS clients computes identity but does not verify the bytes against an independently known value;
- capability composition still mixes target and client facts and does not clearly explain an S3-only lifecycle target.

These are design defects, not implementation-choice questions. V4 therefore does not meet the stated READY bar.

VERDICT: NOT READY

## 2. Round-1 concern dispositions

1. **Read authorization — PARTIALLY RESOLVED.** V4 now defines `owner-only` and `via-references`, applies them to metadata and delivery, names captured dependencies, and adds strong invalidation acceptance (`llp/0044-asset-storage-pipeline.rfc.md:186`, `:433`, `:1316`). That resolves the previous total absence of a read policy. However, `via-references` delegates to “the row’s own read authorization” (`:443`) even though Snapback has no general implemented row-permission language (`llp/0011-auth-and-permissions.rfc.md:446`) and query visibility can be operation- and argument-dependent. The governing decision remains undefined; see new concerns 1–2.

2. **Typed-reference anti-forgery and commit-time validation — PARTIALLY RESOLVED.** V4 correctly makes the commit hook authoritative, revalidates lifecycle generation and authorization inside the final write lock, rejects raw strings, covers arrays and all named write paths, and atomically maintains reverse edges (`llp/0044-asset-storage-pipeline.rfc.md:661`, `:690`, `:703`, `:1299`). This adopts the LLP 0007 validation idiom. It still does not specify the host-owned admission value carried from `ctx.assets.attach()` to commit, how it resists construction/replay by app code, or how seed/import/migration/admin paths obtain legitimate admissions when raw ids are forbidden. Thus the security mechanism is named but not fully defined.

3. **Lifecycle state machines — PARTIALLY RESOLVED.** The attempt, asset, and rendition tables now cover pending deletion, successor attempts, required renditions, cancellation, expiry, and retry eligibility (`llp/0044-asset-storage-pipeline.rfc.md:468`, `:489`, `:499`, `:508`). The single-current-attempt invariant is also valuable (`:385`). But this is not yet the promised complete cross-record machine: asset deletion has no corresponding rendition/reference-count transition, and publication, quota, and work-ledger states are not incorporated. See new concern 3.

4. **Cross-substrate publication — PARTIALLY RESOLVED.** V4 explicitly rejects cross-store atomicity and adds durable write-ahead records, idempotent keys, database uniqueness, a dedup/GC fence, reconciliation, migration fencing, and fault cuts (`llp/0044-asset-storage-pipeline.rfc.md:563`, `:570`, `:580`, `:588`, `:594`). These directly address much of round 1. Remaining gaps include the publication record’s closed states/transitions, the concurrent uniqueness loser’s durable disposition, and the exact transactional cascade from asset deletion through renditions, blob references, and quota. “Staged” and “condemned” are used without a complete publication machine.

5. **Quota and GC accounting — PARTIALLY RESOLVED.** V4 defines reserved, logical, staging, and count categories; atomic reservation/settlement; expansion refusal; direct-upload fencing; and deletion release (`llp/0044-asset-storage-pipeline.rfc.md:617`, `:623`, `:637`, `:643`). It also adds adversarial acceptance (`:1287`). Physical bytes are still outside the accounting vector, and important durable counts—ready/rejected/zero-byte assets, publication records, and work-ledger rows—lack explicit ceilings. Required-rendition settlement and deletion-time rendition cleanup are also underdefined. See new concerns 3 and 5.

6. **Upload-reference identity versus LLP 0108 — UNRESOLVED.** V4 correctly states that it does not revive `ExpectedOperationV1` and instead proposes a Rust-owned generated DTO (`llp/0044-asset-storage-pipeline.rfc.md:162`). This is corpus-honest about LLP 0108’s removal (`llp/0108-inline-handlers-and-result-contracts.spec.md:663`). But the “companion 0037 amendment” said to freeze the exact DTO does not exist in the cited corpus, LLP 0012/0037 contain no asset reference registration, and exact spelling/registration remains an open question (`llp/0044-asset-storage-pipeline.rfc.md:1398`). Round 1 explicitly required the exact DTO, identity bytes, protocol registration, retention/revocation rules, and owning-LLP amendments. Those remain deferred.

7. **Processing runner — PARTIALLY RESOLVED.** The compatibility runner now has an asset-domain ledger with claims, leases, expiry, retry ceilings, deadlines, per-item receipts, deterministic driving, and explicit LLP 0070 boundaries (`llp/0044-asset-storage-pipeline.rfc.md:896`, `:906`, `:919`). This properly avoids relying on LLP 0028’s unimplemented cron backoff and respects LLP 0127’s bar against sweep-level evidence. It still lacks a closed ledger state/transition table, transactional enqueue rules, deletion/cancellation interaction, retry scheduling, terminal/ambiguous dispositions, and orphan-ledger GC. It therefore remains less specified than the durable machine round 1 requested.

8. **TUS deferred length and checksum semantics — PARTIALLY RESOLVED.** V4 correctly refuses deferred length, explicitly omits `creation-defer-length`, identifies TUS 1.0.0, and acknowledges that per-`PATCH` checksums are client-optional (`llp/0044-asset-storage-pipeline.rfc.md:746`, `:752`, `:1263`). This agrees with the [official TUS 1.0.0 protocol](https://tus.io/protocols/resumable-upload). However, the fallback for checksum-less clients—length plus computing a digest during full read-back—does not compare the bytes with any independent expected digest. It establishes canonical identity but cannot detect that transport/storage changed the intended bytes. See new concern 4.

9. **URL identity under deduplication — RESOLVED.** Every profile now uses an `(asset, rendition)` alias, never a blob path; cache keys, signatures, deletion, dedup interaction, and strict `private, no-store` behavior are explicit (`llp/0044-asset-storage-pipeline.rfc.md:782`, `:796`, `:804`, `:817`, `:1331`).

10. **Capability composition and SDK evidence — PARTIALLY RESOLVED.** V4 distinguishes target facts, protocol conformance, and supported client distributions; adopts LLP 0064’s JavaScript/Swift/Kotlin/Python staging; and requires per-OS packaging evidence (`llp/0044-asset-storage-pipeline.rfc.md:323`, `:329`, `:1079`). Nevertheless, the target-side image composite includes “responsive client rendering” (`:1109`), and the lifecycle composite hard-codes the local filesystem while S3 is described as layered above it (`:1094`, `:1120`). Those are unresolved composition errors; see new concern 6.

11. **Binary seed fixtures — RESOLVED.** V4 explicitly respects closed `SeedArtifactV1`, makes binary fixtures a later LLP 0109-amended capability, and routes current fixtures through ordinary uploads (`llp/0044-asset-storage-pipeline.rfc.md:1168`). This matches LLP 0109’s closed artifact and unknown-member refusal (`llp/0109-versioned-seed-evolution.spec.md:133`, `:206`).

12. **Adversarial image resource bounds — RESOLVED.** V4 names every important bound class, requires enforcement as capability evidence, specifies isolation/timeout/cancellation posture, and adds a hostile-input corpus (`llp/0044-asset-storage-pipeline.rfc.md:858`, `:1347`). Target-specific numeric values may properly be fixed by qualifying profiles rather than universally by this RFC.

13. **Backup, restore, and export — RESOLVED.** All asset-byte backup/restore and logical export/import claims are explicitly Missing in v1, with the consistency risk explained (`llp/0044-asset-storage-pipeline.rfc.md:1127`, `:1208`, `:1379`). The remaining open question does not widen the v1 claim.

14. **Acceptance coverage — PARTIALLY RESOLVED.** Acceptance has been comprehensively rebuilt and now covers nearly all omissions identified in round 1, including authority blanking, required renditions, migration, URL refresh, provider-independent SDK staging, range delivery, headers, hostile media, and runner failures (`llp/0044-asset-storage-pipeline.rfc.md:1220-1381`). Remaining normative commitments lack explicit rows, notably lifecycle-callback idempotency, signing-key rotation, persisted-task bearer-data exclusion, and the missing publication/deletion/ledger transitions identified above.

## 3. New concerns

1. **BLOCKING — `via-references` invokes a row-authorization primitive that does not exist.** A row may be returned by one generated query but withheld by another depending on query arguments and handler logic. V4 supplies the delivery request with neither a generated query reference nor arguments, yet says to use “the same authorization the row’s queries use” (`llp/0044-asset-storage-pipeline.rfc.md:443`). Reverse-edge existence only identifies rows; it cannot answer whether this principal is entitled to one under a particular application operation.

   **Resolution:** Define a generated, reusable, pushdown-compatible row-access policy for every asset-bearing table, including its exact inputs and captured dependencies; alternatively make `via-references` require a generated read-authorizer reference and arguments. Refuse schemas whose asset-bearing rows lack such a policy.

2. **BLOCKING — Policy-generation invalidation is asserted without a scalable or atomic mechanism.** V4 says an asset’s policy generation increments when its authorization dependencies change and that finalization refuses a revoked generation (`llp/0044-asset-storage-pipeline.rfc.md:355`). Membership changes may affect arbitrarily many assets, while LLP 0053 deliberately uses an enumerated authorization version and projected obligations rather than transactionally updating every dependent resource. V4 does not explain how a membership write finds and bumps all affected assets, nor how finalization atomically validates the relevant authorization witness.

   **Resolution:** Bind each attempt to an explicit authorization witness/version and, during finalization, either re-run the frozen authorizer under current authority or atomically compare the captured database/auth-version dependencies. Define how ordinary writes, `permissionBacking` events, activation, logout, and dropped delivery affect that witness without O(number-of-assets) fanout.

3. **MATERIAL — Asset deletion has no rendition/blob/quota cascade.** The asset table permits `ready → deleted` (`llp/0044-asset-storage-pipeline.rfc.md:489`), deletion releases logical quota at tombstone commit (`:646`), and blob GC waits until rendition references disappear (`:1006`). But rendition states have no deletion transition (`:508`), and no rule atomically removes rendition-to-blob references or decrements blob counts. As written, deletion either leaks blobs forever or releases quota while the supposedly charged renditions remain referenced.

   **Resolution:** Add the deletion transaction to the consolidated machine: tombstone asset, retire all rendition pointers/rows, decrement blob references, settle logical quota, condemn newly unreferenced blobs, and fence concurrent recipe/publication work atomically. Add crashes and concurrent deletion/regeneration to acceptance.

4. **MATERIAL — Full read-back plus a newly computed digest is not transport-integrity verification.** V4 correctly treats TUS checksums as optional, but claims a checksum-less foreign client cannot publish bytes that fail “full length/digest verification” (`llp/0044-asset-storage-pipeline.rfc.md:755`, `:1263`). Any byte string of the declared length has a computable digest. Without an independently authenticated expected digest or per-chunk checksum, this only names the bytes that arrived.

   **Resolution:** Either narrow the claim to transport completeness plus canonical identity, require an authenticated whole-upload digest for checksum-less clients, or require checksummed chunks for publication. Acceptance should corrupt bytes between receipt and finalization and distinguish detectable corruption from unclaimed end-to-end equivalence.

5. **MATERIAL — The accounting vector still permits unbounded durable metadata and temporary physical storage.** The count ceilings cover open attempts, pending assets, renditions, and edges (`llp/0044-asset-storage-pipeline.rfc.md:623`), but omit ready/rejected assets, publication records, ledger rows, receipts, and migration copies. Zero-byte or tiny rejected assets and repeated failed publication/ledger attempts can therefore grow durable state below the byte quota. Physical storage is only an operational report, not a bounded vector (`:617`).

   **Resolution:** Add per-app/principal ceilings and retention/GC rules for every durable record class, plus physical staging/canonical/orphan/migration headroom. Prove repeated zero-byte, rejection, retry, crash, and reconciliation-failure workloads remain bounded.

6. **MATERIAL — Target/client and local/S3 capability composition remains inconsistent.** `asset-image-pipeline-v1` is labeled a target composite but includes responsive client rendering (`llp/0044-asset-storage-pipeline.rfc.md:1109`). Meanwhile `asset-lifecycle-v1` requires the local filesystem (`:1094`), while S3 support is “layered above” it (`:1120`), leaving no clear predicate for an S3-only target implementing the same lifecycle semantics.

   **Resolution:** Keep client rendering exclusively in client-distribution claims. Define a store-parameterized lifecycle core or separate `asset-lifecycle-local-v1` and `asset-lifecycle-s3-v1` composites, each with explicit dependency edges to store, transport, integrity, delivery, and client facts.

## 4. Suggestions

All five round-1 suggestions were adopted at least in substance:

- lifecycle tables were added, though they still need publication/quota/ledger/deletion rows;
- a capability dependency discussion was added;
- a threat-model section was added;
- the local-first slice is now clearly separated from later S3 qualification;
- the unused `maxFiles` knob was removed and one-task/one-file made explicit.

Non-gating improvements:

- Give every durable record a closed state table in one place.
- Include a normative capability dependency matrix rather than only prose examples.
- Separate “integrity of received storage” from “equivalence to client-intended bytes” in terminology and receipts.

## 5. Open questions

- What exact generated policy answers “may principal P read row R?” independently of a particular query invocation?
- What are the concrete wire bytes and host-custody semantics of upload references and attachment admissions?
- Does finalization reauthorize current dependencies, compare an authorization version, or require per-asset generation fanout?
- What exact transaction retires renditions, blob references, quota, and in-flight work when an asset is deleted?
- Is the first lifecycle composite local-specific, or intended to be a store-neutral semantic core?

## 6. Recommended next step

Revise to v5 before implementation. Close the read-authority and policy-generation mechanisms first; freeze the upload-reference and attachment-admission artifacts in the owning LLPs; then complete the publication/deletion/quota/ledger machines and correct integrity and capability composition. After those changes, run another blind round against a new pinned hash.


## Round 3 — 2026-07-31 (delta)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, read own rounds 1-2 artifact only (mutual blindness maintained); target = working-tree v5, SHA-pinned
**Target SHA-256:** `081ab8c6919245ee54e31124f091e381e8bde8eafe10e673ba4ea744edcf4919`
**Instruction SHA-256:** `de2b4f358f82b46556e95c31b6328e194b057405fe9e5783f85d61eda75f6a57`
**Status:** completed

## Verbatim review (round 3)

Computed target SHA-256: `081ab8c6919245ee54e31124f091e381e8bde8eafe10e673ba4ea744edcf4919` — matches expected v5.

Date: 2026-07-31

Method: Read the complete v5 target, both prior Codex-family review sections, and the relevant portions of LLP 0007, 0011, and 0053; checked every still-open round-2 concern and reviewed the changed v5 mechanisms for new defects.

## 1. Overall assessment

V5 resolves most of round 2’s substantive concerns. It replaces per-asset authorization fanout with witnesses, specifies transaction-scoped attachment admissions, adds a deletion cascade, names integrity grades honestly, expands durable-count ceilings, closes most publication and ledger transitions, and repairs capability composition.

Three defects remain at the READY bar:

- `via-references` can still grant asset access based on only one layer of a row’s effective permission;
- the finalization authorization witness does not explicitly capture negative/range dependencies required by LLP 0007;
- the publication machine has an uncovered crash cut between object creation and the `staged` transition.

The primary/rendition accounting language also risks double charging and double decrementing the primary blob. These are not matters that can safely be left to implementation inference.

VERDICT: NOT READY

## 2. Open-concern dispositions

1. **Read authorization — PARTIALLY RESOLVED.** V5 supplies a pinned decision procedure and safely refuses to infer a predicate from function-only authorization (`llp/0044-asset-storage-pipeline.rfc.md:465-513`). However, a table possessing both a broad analyzable row policy and narrower function-level authorization does not fall back to owner-only. The direct asset decision ignores the latter even though LLP 0011 defines effective permission as their composition (`llp/0011-auth-and-permissions.rfc.md:203-211`). See new concern 1.

2. **Typed-reference anti-forgery and commit validation — RESOLVED.** Admissions are transaction-scoped host records keyed to placement and generation, cannot serialize or replay, and every system write path obtains a fresh admission under its own authority (`llp/0044-asset-storage-pipeline.rfc.md:769-795`). The exact schema/protocol encoding is explicitly gated on a companion amendment before implementation (`:807-811`, `:1554-1563`).

3. **Lifecycle completeness — PARTIALLY RESOLVED.** V5 adds rendition retirement and a one-transaction deletion cascade (`llp/0044-asset-storage-pipeline.rfc.md:555-570`). The primary-versus-rendition wording can nevertheless double-apply blob and quota transitions; see new concern 4.

4. **Cross-substrate publication — PARTIALLY RESOLVED.** The closed states, uniqueness-loser convergence, and reconciliation responsibilities are much clearer (`llp/0044-asset-storage-pipeline.rfc.md:621-667`). The object-write-before-`staged` crash cut is still not represented correctly; see new concern 3.

5. **Quota and GC accounting — PARTIALLY RESOLVED.** V5 adds ceilings for every named durable class, receipt retention, a minimum accounting unit, and physical-headroom reporting (`llp/0044-asset-storage-pipeline.rfc.md:691-728`). Primary/rendition double accounting remains ambiguous, and publication-record retirement is not specified; see new concerns 3–4.

6. **Upload-reference identity — RESOLVED BY EXPLICIT GATE.** The normative identity properties and protocol owners are fixed, `ExpectedOperationV1` remains rejected, and no implementation may land before LLP 0007/0037/0012 freezes the exact encoding and registration (`llp/0044-asset-storage-pipeline.rfc.md:178-197`, `:1554-1563`). This is an acceptable implementation-spec prerequisite rather than an asserted existing carrier.

7. **Processing runner — RESOLVED.** V5 defines closed ledger states, transactional enqueue, retry/backoff, exhaustion, ambiguity, cancellation, retention, reconciliation GC, and the LLP 0070 admission boundary (`llp/0044-asset-storage-pipeline.rfc.md:997-1053`). Lease reclamation could be spelled as an explicit self-transition, but the current semantics are sufficient.

8. **TUS integrity semantics — RESOLVED.** V5 distinguishes `end-to-end verified` from `received-bytes canonical`, expressly acknowledges what checksum-less read-back cannot prove, and carries the grade in receipts and capability evidence (`llp/0044-asset-storage-pipeline.rfc.md:840-861`, `:1388-1393`).

9. **Capability composition — RESOLVED.** `asset-lifecycle-v1` is now store-parameterized, and responsive rendering is correctly moved to client-distribution evidence (`llp/0044-asset-storage-pipeline.rfc.md:1195-1243`).

10. **Acceptance coverage — RESOLVED, subject to correcting the design defects below.** V5 adds explicit rows for the deletion cascade, integrity grades, authorization witnesses, signing-key rotation, durable ceilings, ledger transitions, callback idempotency, and store-parameterized capability evidence (`llp/0044-asset-storage-pipeline.rfc.md:1345-1537`).

11. **Round-2 new concern: nonexistent reusable row authorization — PARTIALLY RESOLVED.** The decision no longer invokes an unspecified query-relative primitive, but its deliberate exclusion of function-level authorization creates the composition defect in new concern 1.

12. **Round-2 new concern: policy-generation fanout — PARTIALLY RESOLVED.** Per-intent generation plus admission witnesses removes O(number-of-assets) fanout (`llp/0044-asset-storage-pipeline.rfc.md:374-396`). Witness completeness for negative and range reads remains underdefined; see new concern 2.

13. **Round-2 new concern: deletion cascade — PARTIALLY RESOLVED.** The missing cascade now exists, but its primary/rendition edge language needs correction; see new concern 4.

14. **Round-2 new concern: dishonest checksum fallback — RESOLVED.** The weaker result is no longer called transport verification.

15. **Round-2 new concern: unbounded metadata — PARTIALLY RESOLVED.** All named classes now have ceilings, but publication-record lifecycle retirement is missing.

16. **Round-2 new concern: target/client and local/S3 composition — RESOLVED.**

## 3. New concerns

### BLOCKING — `via-references` does not compose both authorization layers

V5 authorizes asset access using only the declared analyzable row-visibility predicate and rejects function-only tables (`llp/0044-asset-storage-pipeline.rfc.md:475-492`). That is safe for tables governed exclusively by row visibility. It is not safe for a table with both:

- an analyzable but broad row policy; and
- narrower function-level authorization.

LLP 0011 says effective read permission composes table visibility, query arguments, and function-level checks (`llp/0011-auth-and-permissions.rfc.md:203-211`). V5 instead treats the first component as independently sufficient. A tenant-visible row exposed only through an admin-authorized query could therefore confer tenant-wide direct access to its asset.

The revision header says v5 provides “an owner-only fallback for function-authorized tables” (`llp/0044-asset-storage-pipeline.rfc.md:8-13`), but the normative body only falls back when no analyzable row policy exists.

**Resolution:** Make `via-references` admissible only when the table declares a generated row-access policy explicitly sufficient for asset sharing and independent of function invocation. Alternatively, require owner-only whenever any additional function-level check narrows row access. Add a mixed-policy acceptance case proving that a broad row predicate cannot bypass a narrow function gate.

### BLOCKING — The authorization witness omits negative and range dependencies

The witness is described as recording declared reads and “their versions,” then comparing captured dependency versions during finalization (`llp/0044-asset-storage-pipeline.rfc.md:387-396`). That is insufficient when authorization depends on:

- the absence of a row;
- an empty query result;
- membership in a range or index predicate; or
- a relationship query into which a new row can be inserted.

LLP 0007’s commit-time-validation contract requires row ids, missing rows, query ranges, index cursors, table predicates, and auth/permission facts—not merely versions of rows returned by a read (`llp/0007-storage-portability.spec.md:445-452`). For example, an authorizer that admits only when no blocking row exists would capture no returned-row version; inserting that row after admission would not invalidate the witness unless the table happened to be separately classified `permissionBacking`.

**Resolution:** Define the authorization witness as the complete LLP 0007 read-set witness, including missing-row and predicate/range dependencies, plus the LLP 0053 authorization pair and activation-pinned policy identity. Acceptance must cover phantom insertion, deletion, relationship reparenting, and an initially empty authorization query.

### BLOCKING — Publication has an uncovered crash state

The machine records `planned`, writes the object, and only then records `staged` (`llp/0044-asset-storage-pipeline.rfc.md:628-642`). A crash after a successful object put but before the database transition to `staged` leaves:

- a real object;
- a publication record still in `planned`;
- no recovery rule for that combination.

The text incorrectly says a crash “between object write and row commit” leaves a recorded `staged` state (`:638-642`). It may instead leave `planned`. The reconciliation sweep is expressly said to resolve `staged`, condemned, and orphaned objects, but not `planned` records (`:656-660`). The closed transition spelling also lacks `planned → condemned`.

**Resolution:** Permit recovery to inspect every `planned` record: if the recorded key exists and verifies, transition it to `staged`; if it does not exist and retry is no longer eligible, transition it to `condemned` or a distinct terminal no-object state. Add the exact crash cut after object acknowledgement but before `staged` commit. Specify when committed/condemned publication records are safely retired so their ceiling does not eventually become a permanent upload limit.

### MATERIAL — Primary rendition accounting can double charge and double decrement

The model makes the primary a rendition: assets hold a `current primary-rendition id`, rendition variants include `primary`, and finalization “publishes the primary rendition” (`llp/0044-asset-storage-pipeline.rfc.md:369-370`, `:449-457`, `:594-598`).

Against that model:

- logical quota is “the asset’s canonical primary blob plus every rendition blob” (`:693-697`); and
- deletion decrements “the blob reference of the primary and each rendition” (`:562-565`).

If “every rendition” includes the primary rendition—as the record model says—it is charged and decremented twice. If it means only derived renditions, the normative text must say so. Double decrement can prematurely condemn a deduplicated blob; double charging violates the advertised exact accounting vector.

**Resolution:** Define one blob-reference edge and one quota charge per rendition record, including the primary exactly once. Use “primary rendition and every non-primary rendition” where enumeration is needed. Add acceptance with a primary plus two derived renditions sharing and not sharing blobs, followed by deletion and exact reference-count/quota assertions.

## 4. Suggestions

- Add an explicit publication-record retention/retirement rule beside the ledger retention rule.
- Spell lease expiry as a closed ledger transition or explicitly state that reclaim mutates claim metadata without changing the `claimed` state.
- Replace the revision-header claim about “function-authorized tables” with wording exactly matching the final normative rule after concern 1 is resolved.

## 5. Open questions

- Is a row-visibility policy intended to be sufficient asset-sharing authority, or merely one component of effective query permission?
- Does “declared reads and their versions” intentionally mean LLP 0007’s complete read-set witness, including negative and range dependencies?
- Are primary bytes represented exclusively by the `primary` rendition record, or by a second asset-to-blob edge in addition to that rendition?
- What event retires a committed publication record without losing future reconciliation evidence?

## 6. Recommended next step

Revise to v6 with four narrow corrections: make asset-sharing authority compose safely with function-level authorization; define authorization witnesses as complete LLP 0007 read-set witnesses; close recovery from `planned` after an acknowledged object write and define publication-record retirement; and count/decrement the primary rendition exactly once. Then rerun the delta review on the new pinned hash.


## Round 4 — 2026-07-31 (delta)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, read own rounds 1-3 artifact only (mutual blindness maintained); target = working-tree v6, SHA-pinned
**Target SHA-256:** `680a9980763c162c17b1cca08a6a204091c4ce7191a1634d2d7bdc68e59de179`
**Instruction SHA-256:** `7d42de7db45150b5d34ef410d7969039c31298dd84527c73ec19c7b393638b3c`
**Status:** completed

## Verbatim review (round 4)

Computed target SHA-256: `680a9980763c162c17b1cca08a6a204091c4ce7191a1634d2d7bdc68e59de179` — matches expected v6.

Date: 2026-07-31

Method: Read the complete v6 target, only the Codex-family rounds 1–3 artifact, and the load-bearing LLP 0007/0011/0053 provisions; checked every round-3 concern and scrutinized the identified v6 delta.

## 1. Overall assessment

V6 resolves all four concerns remaining from round 3:

- `via-references` now requires an explicit asset-sharing declaration rather than treating a broad row-visibility filter as sufficient authority;
- finalization now uses LLP 0007’s complete read-set witness and reauthorizes after movement;
- publication recovery now covers the acknowledged-object/`planned` crash cut and retires records safely;
- primary bytes now have exactly one rendition edge, reference-count transition, and quota charge.

The other delta changes are coherent with the corpus. Host-plan attachment is admitted authoritatively at the commit boundary; policy-generation revocation has closed triggers; reference GC is now a named `ready → deleted` cause; integrity grades are lane-neutral without overstating checksum-less transfers; and lease expiry is an explicit receipted ledger transition.

I found no new BLOCKING or MATERIAL defect. Two wording details should be cleaned up during the companion specification pass, but neither leaves the design unsafe or materially incomplete.

VERDICT: READY

## 2. Open-concern dispositions

1. **Via-references composition — RESOLVED.**

   V6 explicitly acknowledges LLP 0011’s composition of row visibility and function-level checks, then requires a separate schema declaration that the analyzable row policy is independently sufficient for asset sharing. Tables without that declaration—including mixed tables with narrower function gates—confer no asset authority (`llp/0044-asset-storage-pipeline.rfc.md:516-540`; `llp/0011-auth-and-permissions.rfc.md:203-211`).

   Acceptance now includes the precise mixed-policy counterexample and verifies that the broad row predicate cannot bypass the function gate (`llp/0044-asset-storage-pipeline.rfc.md:1556-1562`).

2. **Authorization-witness completeness — RESOLVED.**

   The witness now expressly includes row ids, missing rows, ranges, index cursors, table predicates, the LLP 0053 authorization pair, and policy identity (`llp/0044-asset-storage-pipeline.rfc.md:412-420`). This matches LLP 0007’s complete commit-time dependency vocabulary (`llp/0007-storage-portability.spec.md:445-450`).

   Movement triggers an in-transaction rerun under the frozen policy and current authority; materially identical authorization may publish, while denial or changed ownership refuses (`llp/0044-asset-storage-pipeline.rfc.md:422-437`). Acceptance covers phantom insertion, missing/deleted rows, relationship reparenting, empty queries, revocation, and benign churn (`llp/0044-asset-storage-pipeline.rfc.md:1563-1572`).

3. **Publication planned crash cut and retirement — RESOLVED.**

   The closed machine now admits `planned → staged | condemned`, records retirement rules for committed and condemned records, and makes retirement receipted (`llp/0044-asset-storage-pipeline.rfc.md:678-692`). Recovery probes the key of every stale `planned` record after the object-write-before-state-commit cut, stages a verified object, condemns abandoned work, and reconciles both `planned` and `staged` records (`llp/0044-asset-storage-pipeline.rfc.md:693-703`).

   Acceptance names the exact crash cut, superseded/cancelled planned records, record retirement, uniqueness-race convergence, and GC/reuse race (`llp/0044-asset-storage-pipeline.rfc.md:1487-1499`).

4. **Primary double accounting — RESOLVED.**

   Primary bytes are represented exclusively by the `primary` rendition record; no second asset-to-blob edge exists. Deletion therefore decrements each rendition edge exactly once (`llp/0044-asset-storage-pipeline.rfc.md:610-620`), and quota uses the same one-record/one-charge rule (`llp/0044-asset-storage-pipeline.rfc.md:752-760`).

   Acceptance verifies exact accounting for a primary plus two derived renditions, including shared-blob and non-shared-blob cases (`llp/0044-asset-storage-pipeline.rfc.md:1500-1508`).

## 3. New concerns

No new BLOCKING or MATERIAL concerns.

1. **DETAIL — The publication sweep’s summary sentence omits `planned`.**

   The recovery rule correctly says reconciliation resolves stale `planned` and `staged` records (`llp/0044-asset-storage-pipeline.rfc.md:695-703`), but the following sweep summary mentions only `staged` records (`llp/0044-asset-storage-pipeline.rfc.md:717-721`).

   **Resolution:** Change the summary to “resolves stale `planned` and `staged` publication records.” The governing recovery behavior is already unambiguous.

2. **DETAIL — Raw-string refusal should distinguish handler admission from schema-derived host-plan admission.**

   The RFC says raw strings fail on every write path, then correctly permits an intent-restricted host plan to obtain its admission directly at commit (`llp/0044-asset-storage-pipeline.rfc.md:832-867`; acceptance `:1533-1541`). The intended distinction is sound—an unadmitted handler write fails, while a generated host-plan operand undergoes the full authoritative schema-derived check—but “raw string” is overloaded because asset ids are string-shaped on the wire.

   **Resolution:** State that an *untyped or admission-bypassing* write fails. Explicitly distinguish that case from a generated host-plan asset operand whose commit-boundary admission validates intent, owner, policy, generation, and availability.

## 4. Suggestions

- In the companion implementation amendment, state whether lease reclamation increments the ledger attempt count or is bounded solely by the deadline. The explicit `claimed → enqueued` transition is sufficient here, but the implementation profile should remove that operational ambiguity (`llp/0044-asset-storage-pipeline.rfc.md:1082-1105`).
- Add a positive mixed-policy fixture where the asset-sharing declaration is intentionally present, complementing the new no-declaration denial fixture.
- Tighten “canonical bytes match what the client intended” to distinguish exact uploaded-source equivalence from deterministic privacy rewriting of those source bytes (`llp/0044-asset-storage-pipeline.rfc.md:921-936`).

## 5. Open questions

The document’s remaining open questions are appropriately routed rather than hidden:

- digest and image-library selection are implementation-profile choices;
- exact `v.assetRef`, sharing-declaration, protocol, diagnostic, capability, and LLP 0053 spellings are explicitly gated on companion LLP 0007/0037/0012 work;
- backup/restore, custom read authorization, raw-source retention, video finalization, and durable-work integration remain explicit nonclaims or later capabilities.

None invalidates the v1 design or widens a present capability claim.

## 6. Recommended next step

The round-4 Codex-family review is ready for the author’s acceptance decision. Preserve the RFC’s Draft status until the author acts; then freeze the gating LLP 0007/0037/0012 encodings and LLP 0053 classification before implementation, incorporating the two wording details above.
