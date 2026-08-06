# Independent review: LLP 0163–0165 derived-fork implementation

## Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Redacted:** no
- **Method:** Fresh clean-context session; read-only worktree pinned at commit `7c2a27e0e90cf1d19b57825a187cb3be041ab92f`; mutually blind. I did not seek out or read another review. I inspected the governing documents, implementation, and tests directly. I also reproduced SQLite `writable_schema` table/auto-index renaming in a temporary database outside the worktree. I did not run Rust tests: `scripts/ibex-doctor` reported the vendored Ibex submodule uninitialized, and bootstrapping it would have violated this review's read-only-worktree constraint.

## Scope notes

This review covers only the derived-deployment-fork portions of LLP 0163, LLP 0164, and LLP 0165: operation-attribution non-involvement, the two fork diff surfaces, retained-base substrate and folding, and the fork-local journal-completeness profile. It does **not** review Track B's storage-wide Acceptance rows 1–4 or 10–14, except where the derived-fork legs and the separately narrowed row-13 lifecycle receipts bear directly on this surface. It does not review promotable in-app branches or strict promotion.

The local threat boundary is also respected: Snapback explicitly does not contain a malicious same-user process with raw access to the database or network (`llp/0158-instance-forking.rfc.md:792-823`). That limitation does not, however, make a connection-local SQLite authorizer a file-wide or compile-enforced write choke point.

## Overall assessment

| Document | Fork-relevant verdict | Assessment |
| --- | --- | --- |
| LLP 0163 | **NOT READY** | The new net receipt honestly emits `attribution: "absent-v1"`, and the fork-only coverage lanes do not project operation-envelope coverage. But the simultaneously public `snapback.fork-diff.v1` surface is still called an “attributed” sequence while carrying neither operation/principal identity nor a machine-readable absence fact. The spec's correction discusses only the net receipt, so 0163 non-involvement is not consistently represented across the fork surface (`llp/0163-operation-identity-and-commit-envelope.spec.md:992-1004`; `src/instance_fork.rs:746-769`). |
| LLP 0164 | **NOT READY** | Retained-base comparison, substrate naming, pre/post images, deterministic ordering, and core folding work are integrated. The wire artifacts nevertheless omit the required stream-qualified base/head identities and canonical emitted-diff digest, and the alleged attributed sequence has no operation or principal attribution (`llp/0162-agent-safe-storage-profile.rfc.md:1192-1235`; `src/instance_fork.rs:746-769`; `src/instance_fork.rs:832-849`). |
| LLP 0165 | **NOT READY** | Pre-bind fork-local arming and fail-closed carrier verification are real, but `authorizer-backed-app-rows-v1` overstates the enforcement. The authorizer permits unhandled actions—including `PRAGMA`, `ATTACH`, and writes to `sqlite_schema`—and it is installed on only one connection. The writer enum is an inventory, not a compiler-enforced prohibition on opening another writable connection (`src/storage/write_authority.rs:626-664`; `src/storage.rs:10725-10744`). |

## Strengths

- **The LLP 0163 non-claim is correctly encoded on the new net surface.** `ForkNetDiffReceiptV2` has a required `attribution` field and always emits `absent-v1`; the fork coverage test separately proves that the derived journal lanes do not activate 0163's ordinary/host-child operation lanes (`src/instance_fork.rs:834-849`; `src/instance_fork.rs:3193-3220`; `src/instance_fork.rs:5625-5636`).

- **The net diff uses an actually independent substrate.** The retained base is digest-checked before use, the head is pinned in one read transaction, and physical base/head rows—not journal post-images—produce the net row set (`src/instance_fork.rs:2931-2978`; `src/instance_fork.rs:3049-3113`). The corpus proves multi-table inserts, updates, deletes, update/revert, insert/delete, schema divergence, sibling no-op behavior, and pre/post images rather than merely asserting them (`src/instance_fork.rs:5490-5606`).

- **The new completeness upgrade has useful fail-closed pieces.** Complete-pair startup applies the carrier, arms the serving connection before bind, and refuses creation when the expected coverage evidence is absent or invalid (`src/cli.rs:7461-7490`; `src/cli.rs:7909-7914`; `src/cli.rs:3567-3589`). Verification requires identical database/file carriers, a self-digest, exact fork point, active stream, exact manifest, and activation time (`src/instance_fork.rs:2812-2892`). Partial layouts, late arming, retention gaps, unexplained rows, stale borrowed journal post-images, base tampering, and one-carrier tampering are all exercised as downgrades or refusals (`src/instance_fork.rs:5760-5925`; `tests/instance_fork_cli_v1.rs:1969-2030`).

- **The direct negatives are not vacuous.** Covered direct DML is observed as SQLite `AuthorizationForStatementDenied`; preinstalled and in-token trigger effects are denied; ordinary `ALTER TABLE` is denied; and statement caching is cleared/rechecked at activation and reopen (`src/storage.rs:26944-27050`; `src/storage.rs:27278-27407`). These prove the implemented cases even though they do not close the cases below.

## Concerns

### 1. High — LLP 0165's authorizer is not the claimed out-of-seam write choke point

The authorizer protects only DML whose current SQLite table name appears in `covered_tables`, plus a selected list of ordinary DDL actions. Every other `AuthAction` is allowed (`src/storage/write_authority.rs:626-664`). In particular:

- `PRAGMA writable_schema` is not denied, and `UPDATE sqlite_schema` is not a protected-table update. The connection configuration enables foreign keys, a busy timeout, and WAL, but not defensive mode; in that posture SQLite permits renaming a protected table and its automatic index in `sqlite_schema`, after which the same application B-tree is addressable under an alias absent from `covered_tables` (`src/storage.rs:7260-7270`; `src/storage/write_authority.rs:630-663`; `src/storage/write_authority.rs:338-345`).
- `ATTACH` and other unhandled schema actions are admitted by the same default branch (`src/storage/write_authority.rs:648-664`). Savepoints do not themselves bypass the callback, and trigger-mediated app writes are correctly denied, but those facts do not repair the schema-alias route (`src/storage/write_authority.rs:638-646`).
- The callback is connection-local. The code already has a production path that opens a second write-capable connection without this authorizer for system-only vector quarantine; nothing in the `LocalWriterLaneV1` enum makes a new raw `Connection::open` a compile error (`src/storage.rs:10725-10744`; `src/storage/write_authority.rs:25-81`).
- The independent oracle detects an unjournaled raw write or a raw write that borrows a stale journal post-image, which the tests prove (`src/instance_fork.rs:5781-5831`). It does not distinguish a second connection that writes both the app row and a matching `_snapback_changes` post-image: the upgrade condition only checks that every net row has a journal key and the final journal post-image equals the scanned head (`src/instance_fork.rs:2984-3046`; `src/instance_fork.rs:3126-3191`).

This conflicts with LLP 0165's normative “authorizer denying out-of-seam writes” contract (`llp/0165-proof-domains-and-checkpoints.spec.md:139-146`) and makes `authorizer-backed-app-rows-v1` unsafe as a whole-window physical-write completeness spelling.

**Resolution:** make the SQLite policy deny-by-default while armed; explicitly deny `PRAGMA writable_schema`, `ATTACH`/`DETACH`, schema-table mutation, temp schema objects that can affect `main`, and unsupported action variants; enable and verify SQLite defensive mode; centralize/wrap all writable connection construction so an armed database cannot obtain an unregistered writer; and add adversarial tests for schema aliasing, attached databases, savepoints, triggers, DDL, a second connection, matched-journal forgery, and raw WAL/file mutation. Until then, downgrade the class to a name that states “serving-connection direct-DML guarded and oracle-cross-checked,” not application-row write completeness.

### 2. High — LLP 0163/0164's “attributed sequence” has no operation or principal attribution and no absence marker

The umbrella definition is unambiguous: the attributed sequence includes operation and principal attribution (`llp/0162-agent-safe-storage-profile.rfc.md:1198-1201`). `ForkDiffRowV1` contains only numeric version, table, row id, SQL operation (`insert`/`update`/`delete`), and post-image; its receipt has no operation identity, principal, or `attribution` status (`src/instance_fork.rs:746-769`; `src/instance_fork.rs:2748-2809`). Yet the guide and LLP 0158 call it the attributed receipt/sequence (`guide/operating/instance-forks.md:315-320`; `llp/0158-instance-forking.rfc.md:1245-1253`). The new net receipt is honest, but the older public surface means the answer to “is nothing implying LLP 0163 attribution?” is no.

**Resolution:** either publish a new journal-sequence schema carrying `attribution: "absent-v1"` and rename all projections away from “attributed,” or add real stream-qualified operation/principal joins. Update LLP 0163's scope correction to cover both fork diff schemas, not only the net receipt.

### 3. High — LLP 0164's receipt contract lacks stream-qualified boundary identities and a canonical emitted-diff digest

LLP 0162, which LLP 0164 imports normatively, requires stream-qualified base/head identities and a digest over the canonical emitted diff (`llp/0162-agent-safe-storage-profile.rfc.md:1222-1235`; `llp/0164-fork-and-promotion.spec.md:103-115`). Neither `ForkDiffReceiptV1` nor `ForkNetDiffReceiptV2` has a data-stream/checkpoint identity or receipt/diff digest (`src/instance_fork.rs:756-769`; `src/instance_fork.rs:832-849`). The base-file digest proves only that the retained base file is unchanged; it does not bind the head snapshot, rows, ordering, domains, or completeness facts in the emitted receipt (`src/instance_fork.rs:2939-2957`). A reviewer therefore cannot bind approval to the exact receipt as LLP 0185 Phase 4 requires (`llp/0185-instance-forking-productization.plan.md:418-430`).

**Resolution:** version both schemas, add explicit base/head stream-qualified identities, define canonical serialization/domain separation, and include a digest binding the complete emitted receipt (including omissions, coverage, and ordering). Add golden vectors and tamper tests for every bound field.

### 4. Medium — LLP 0164's reconciliation text and derived folding evidence are incomplete

The reconciliation record still says the derived target emits `snapback.fork-net-diff.v1`, while the integrated incompatible replacement is v2 (`llp/0164-fork-and-promotion.spec.md:489-500`; `src/instance_fork.rs:3196-3207`). Its derived corpus proves update/revert and insert/delete, but does not exercise delete/reinsert-identical versus delete/reinsert-different, despite the canonical folding contract naming both (`llp/0162-agent-safe-storage-profile.rfc.md:1210-1216`; `src/instance_fork.rs:5520-5582`). The direct base/head algorithm should yield the right result, but the required adversarial evidence is absent.

**Resolution:** reconcile 0164 to v2 and add the complete deterministic/randomized derived corpus, including both delete/reinsert outcomes and explicit system-field expectations.

## Suggestions

- Separate three facts in names and schemas: serving-connection admission, closed process writer inventory, and independent journal/oracle agreement. They are useful individually and should not be collapsed into one completeness adjective (`llp/0165-proof-domains-and-checkpoints.spec.md:374-391`).
- Preserve `journal-enumerated-v1` as the compatibility downgrade; its current retention-gap and partial-layout behavior is appropriately conservative (`src/instance_fork.rs:3171-3191`).
- Keep the retained-base choice. It makes folding mechanically reviewable and provides a better foundation than attempting to infer net state from post-images (`src/instance_fork.rs:3049-3113`).

## Open questions

1. Is `authorizer-backed-app-rows-v1` intended to cover only the one long-lived serving connection in a trusted process, or every process-owned connection that can touch the fork file? LLP 0165 uses the singular connection in its explanatory text, while its normative choke-point language and “whole-window” receipt read more broadly (`llp/0165-proof-domains-and-checkpoints.spec.md:353-404`). The wire schema must make the chosen boundary explicit.
2. Should system fields such as `_version` make a content update/revert remain a net update? The implementation deliberately says yes (`src/instance_fork.rs:5747-5757`), while the generic folding sentence says update/revert folds away and separately asks system fields to state coverage (`llp/0162-agent-safe-storage-profile.rfc.md:1213-1216`). The spec should state this derived-target rule directly.

## Recommended next step

Do not accept LLP 0163, 0164, or 0165 for this fork-relevant publication surface yet. Close the authorizer/second-writer bypass, version and digest-bind both diff artifacts, make attribution absence consistent across both surfaces, complete the folding corpus, revise the three specs, and then commission a fresh mutually blind implementation review. LLP 0163 can become independently ready once the legacy sequence stops implying attribution; it need not wait for storage-wide Track B work.

## Round 2 — 2026-08-06, commit 96fd0ad1c

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `96fd0ad1c38109aa524e4cbc39439c8982e18766`
- **Redacted:** no
- **Method:** Independent delta review of the round-1 blockers and their fix slice. I read both families' committed round-1 artifacts, as permitted, but did not read or seek another family's round-2 work. I inspected the parent-to-fix diff, the governing LLP and guide text, implementation, and adversarial tests. I ran selected committed Rust tests in a disposable exact-revision clone after qualifying the vendored runtime, and added and ran one temporary review-only exploit test there; the pinned review worktree remained read-only except for this append.

### Re-verdict

| Document | Fork-relevant verdict | Round-2 assessment |
| --- | --- | --- |
| LLP 0163 | **READY** | Both derived diff artifacts now state `attribution: "absent-v1"`; the v3 boundaries and digests do not imply an operation envelope, and the derived lanes still do not claim LLP 0163 operation coverage (`src/instance_fork.rs:904-931`; `src/instance_fork.rs:994-1014`; `llp/0163-operation-identity-and-commit-envelope.spec.md:992-1006`). |
| LLP 0164 | **READY** | The retained-base/net semantics and dated receipt-evolution record match the implemented v3 journal and net artifacts: stream-qualified `(base, head]` identities, distinct digest domains, JCS canonicalization, and explicit attribution absence (`llp/0164-derived-state-and-incremental-views.spec.md:489-513`; `src/instance_fork.rs:1124-1160`; `src/instance_fork.rs:3273-3324`). I found no residual v3 drift in LLP 0164. This verdict is for LLP 0164's fork slice; the delegated completeness-class implementation remains blocked under LLP 0165. |
| LLP 0165 | **NOT READY** | Most SQLite escape routes are closed, but a registered in-process writer can delete the durable coverage manifest, cause the next registered writer to open unarmed, forge a matching app/journal change, and restore the manifest. The final verifier then re-awards `registered-connection-defensive-app-rows-v1`, contradicting the required whole-window registered-writer continuity (`llp/0165-proof-domains-and-checkpoints.spec.md:359-416`). |

### Round-1 blocker dispositions

1. **Cross-app lifecycle selection through a shared explicit `--fork-root`: closed.** Expected app identity is now derived from canonical app root plus logical app id (`src/instance_fork.rs:170-241`), bound into a digest-checked application receipt (`src/instance_fork.rs:1104-1122`; `src/instance_fork.rs:1162-1289`), checked at registry selection and again against fork-local evidence (`src/instance_fork.rs:2521-2547`; `src/instance_fork.rs:2721-2749`), and passed by every CLI lifecycle selector; list filters rather than projects foreign entries (`src/cli.rs:3727-3771`). The same-app-id/shared-root CLI matrix uses two real app roots and adversarially covers list, inspect including the admin-token path, diff, renew, drop, recover, credentials, writes, and reap (`tests/instance_fork_cli_v1.rs:542-745`). The lower-level selector test also covers legacy fail-closed behavior (`src/instance_fork.rs:6500-6583`). I found no remaining cross-selection route within the documented cooperating-process boundary.

2. **Armed-authorizer and second-writer bypasses: partially closed.** Defensive mode is enabled and verified before authorizer installation; armed actions are default-deny across schema aliases, `ATTACH`/`DETACH`, temp DDL, virtual tables, unsupported actions, direct app/integrity DML, and schema-changing pragmas (`src/storage/write_authority.rs:338-351`; `src/storage/write_authority.rs:391-421`; `src/storage/write_authority.rs:659-762`). Production secondary writers now go through a registered factory that reconstructs authority per connection (`src/storage.rs:10709-10769`), with direct adversarial tests for schema aliases and a second writer (`src/storage.rs:27256-27460`). WAL/page validation and the explicit matching-journal raw-file forgery negative correctly delimit out-of-class tampering (`src/instance_fork.rs:7361-7414`; `src/instance_fork.rs:7445-7525`). However, the in-class continuity bypass in Finding 1 below remains.

3. **Receipt identities, canonical digest, and attribution naming: closed.** Journal and net are distinct v3 artifacts with required stream-qualified base/head boundaries and explicit `absent-v1` attribution (`src/instance_fork.rs:904-931`; `src/instance_fork.rs:994-1014`). Digest construction removes only `receiptDigest`, applies JCS to every remaining field, and hashes under separate domain strings (`src/instance_fork.rs:1124-1160`). Receipt production binds the mint stream to the current head and refuses stream rotation (`src/instance_fork.rs:3273-3324`). The test fixes golden hashes, checks cross-domain separation, and mutates every top-level receipt fact (`src/instance_fork.rs:6738-6845`); the live acceptance assertions require v3, both boundaries, attribution absence, and digest coherence (`tests/instance_fork_cli_v1.rs:318-381`). LLP 0158, LLP 0163, LLP 0164, LLP 0165, and the guide consistently describe this reality; older v1 text in historical/superseded context is not current derived-v3 drift.

4. **Atomic admission and bounded net-diff work: partially closed.** A root-wide `flock` now serializes count and byte admission (`src/instance_fork.rs:3198-3240`), and create holds it from measurement through publication (`src/cli.rs:3405-3441`). The concurrent boundary test synchronizes two creators at count and aggregate-byte limits and proves exactly one success, one typed refusal, and one registry entry (`src/instance_fork.rs:6586-6665`). Net diff now counts scanned rows, journal rows, output rows, and bytes, preflights journal byte work before building its Rust maps, and validates WAL work within the same bounded process (`src/instance_fork.rs:3573-3643`; `src/instance_fork.rs:3740-3758`; `src/instance_fork.rs:4438-4507`). The unchanged, revert-heavy, and journal-byte adversarial cases are substantive (`src/instance_fork.rs:6978-7088`). The row-scan byte bound is nevertheless applied after materialization, as detailed in Finding 2.

### New findings

#### 1. High — a durable-manifest gap can re-earn the upgraded completeness class

The armed authorizer treats most `_snapback_*` tables as system DML and allows them without an app-write token; only `_snapback_changes` and `_snapback_version` receive the integrity-table restriction (`src/storage/write_authority.rs:663-672`; `src/storage/write_authority.rs:711-730`). A committed test already demonstrates that an armed connection can durably delete `_snapback_operation_coverage_v1` (`src/storage.rs:27541-27599`).

The registered-writer factory reads only the *currently active* manifest. If the row is absent, it installs `None`; `WriterAuthorityV1::install` then returns before defensive mode or the authorizer is installed (`src/storage.rs:10731-10763`; `src/storage/write_authority.rs:338-351`). In a disposable exact-commit clone I wrote and ran a review-only regression that used only registered process connections: save and delete the manifest, open a second registered writer and confirm defensive mode is off, write an app row plus matching `_snapback_version` and `_snapback_changes`, restore the exact manifest, and request net diff. The diff incorrectly upgraded to `registered-connection-defensive-app-rows-v1`. The test passed, reproducing the bypass rather than merely inferring it.

This is inside the documented registered process-writer class, not the acknowledged raw same-user file-forgery boundary. It violates LLP 0165's requirement that every process-owned registered writable connection remain armed for the entire fork-point-to-head window (`llp/0165-proof-domains-and-checkpoints.spec.md:380-393`) and makes the guide's class wording too strong (`guide/operating/instance-forks.md:345-353`).

**Required resolution:** make activation continuity monotonic and tamper-evident within the registered-writer class. At minimum, deny direct DML to coverage/stream/activation carriers (or mediate exact monotonic transitions), and make the registered factory fail closed when fork coverage evidence says the class is active but the current manifest is absent or mismatched. Add the delete → unarmed writer → matching forgery → restore sequence as a committed negative and require refusal/downgrade that cannot later be re-earned.

#### 2. Medium — the scanned-row byte limit is post-allocation

For manifest-backed rows, `row_to_document` fully decodes the row and `serde_json::to_vec` allocates a serialized copy before `observe_scan` checks the byte budget (`src/instance_fork.rs:4040-4066`). The generic path likewise converts blobs to hex strings, builds the whole object, and serializes it before checking (`src/instance_fork.rs:4069-4111`). A single text/blob/vector row far larger than `FORK_DIFF_MAX_BYTES` can therefore allocate and expand well beyond the declared in-flight bound before receiving the typed refusal. Existing work-limit tests cover many unchanged rows, revert-heavy journals, and journal bytes, but not one oversized scanned SQLite row (`src/instance_fork.rs:6978-7088`).

**Required resolution:** preflight SQLite value lengths before document conversion and enforce incremental decoding/serialization limits. Add oversized text, blob, and vector-row cases that prove the refusal occurs before proportional Rust allocation.

### Regression and coherence checks

I found no additional parent-path regression: a database without an active manifest retains the dormant path, and the durable-reopen test still proves re-arming when the manifest is legitimately present (`src/storage/write_authority.rs:338-351`; `src/storage.rs:27602-27670`). The matching-journal raw-file test and revised LLP/guide wording now honestly call cross-process raw access tamper-evident rather than prevented. Receipt versioning is coherent across code, LLP 0158/0163/0164/0165, CLI assertions, and guide; in particular, LLP 0164's dated evolution record matches the current v3 wire format. These checks do not mitigate the in-class manifest-gap attack.

### Verification actually performed

In a disposable clone pinned to the reviewed SHA, `scripts/bootstrap-ibex-runtime` completed its build, launch, and restricted no-eval handler-VM qualification. The following committed tests passed:

- `same_app_id_distinct_app_roots_cannot_select_or_mutate_each_others_forks`
- `root_wide_admission_is_atomic_at_count_and_total_byte_boundaries`
- `diff_receipt_v3_digests_are_domain_separated_canonical_and_bind_every_fact`
- `net_diff_streaming_limits_refuse_unchanged_revert_heavy_and_byte_heavy_work`
- `llp0165_armed_connection_is_defensive_default_deny_and_schema_alias_safe`
- `llp0165_registered_second_writer_uses_connection_local_defensive_authority`
- `net_diff_matching_journal_forgery_is_outside_the_registered_connection_class`
- `llp0162_writer_authority_rearms_from_durable_manifest_on_reopen`

The temporary registered-manifest-gap exploit test also passed, demonstrating the High finding. `./ref-check --verbose` passed in the pinned worktree with 188 LLP documents, 3,427 references, and no errors or unchecked references. `node scripts/check-guide.mjs` could not complete because this checkout lacked baseline generated demo artifacts and the `ajv` dependency; the observed failures were environmental/pre-existing rather than evidence about this fix slice.

### Verdict and recommended next step

LLP 0163 and LLP 0164 are **READY** for their fork-relevant surfaces. LLP 0165 is **NOT READY**, and the narrow local `operating.instance-forks` publication remains **NOT READY**. Preserve the lifecycle binding, v3 receipts, defensive/default-deny authorizer, registered-writer factory, and root admission work. Close the registered-manifest continuity gap and make scanned-row byte admission pre-allocation, then rerun the two new adversarial negatives plus the existing exact-revision suite before commissioning the next independent implementation/security verdict.
