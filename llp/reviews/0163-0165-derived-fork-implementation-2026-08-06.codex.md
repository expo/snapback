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

## Round 3 — 2026-08-06, commit cdc0fe03e

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7`
- **Redacted:** no
- **Method:** Independent round-3 delta review. I read both families' committed round-1 and round-2 artifacts, the root LLP, the fork-relevant portions of LLP 0163/0164/0165, LLP 0158's implementation review, and the instance-forks guide. I inspected the three named fix slices and their current code/tests at the pinned commit. In a disposable exact-revision checkout, after the required native-runtime qualification, I ran the focused committed tests listed below and added one temporary review-only continuity-row exploit variant. The pinned worktree remained unchanged except for the two requested review appends.

### Delta assessment

I found **no new MATERIAL defect** in the reviewed delta. The two Codex round-2 findings are closed, as are the armed-renewal and journal-pruning findings recorded by Fable. The three new slices preserve the narrow registered-connection/local-process boundary stated by LLP 0165; none silently expands it into same-user file containment (`llp/0165-proof-domains-and-checkpoints.spec.md:399-447`).

### Round-2 finding dispositions

1. **High — registered-manifest continuity exploit: CLOSED.** Both the active manifest and continuity table are protected carriers, writable only under the operation-ledger token (`src/storage/write_authority.rs:697-743`). Every registered writer reconstructs the database/file receipts, current stream, manifest, and `continuous` row before the authorizer and purpose token are installed; any gap records a monotonic database break and, for a managed fork, a create-once synced sidecar before refusing (`src/storage.rs:10735-10799`; `src/storage.rs:10821-10869`; `src/storage.rs:10871-11103`). Coverage activation cannot change a `broken` row back to `continuous` (`src/operation_ledger.rs:552-608`), and net-diff verification independently checks the gap sidecar and the exact continuity expectation (`src/instance_fork.rs:3627-3705`).

   The committed negative is substantive, not circular: it first proves a registered writer cannot delete the manifest, then uses an explicitly out-of-class raw connection to simulate the old gap, proves the next registered factory refuses and creates the gap sidecar, performs the former matching app/version/journal forgery, restores the exact manifest, and proves net diff still refuses (`src/instance_fork.rs:8097-8219`). I also ran a temporary stronger variant that deleted the continuity row rather than the manifest. After the registered factory persisted the break, the raw test deleted the new `broken` row and restored the original `continuous` row exactly; the irreversible sidecar still caused `SNAPBACK_FORK_WRITER_COVERAGE_GAP`. Deleting that filesystem evidence through the same raw same-user authority would already be outside the class, just as coordinated page/journal forgery is explicitly outside it.

2. **Medium — scanned-row bytes charged after expansion: CLOSED.** Each borrowed SQLite row is now preflighted and charged before `row_to_document`, text ownership, blob-to-hex conversion, JSON parsing, or vector decoding (`src/instance_fork.rs:4160-4252`). The bounds charge JSON-node overhead, blob expansion, and vector buffer/array expansion before allocation, then verify serialization through a bounded counting writer (`src/instance_fork.rs:4255-4387`; `src/instance_fork.rs:4436-4484`). The negative uses individual text/blob values beyond the global byte budget and a vector whose decoded representation exceeds its smaller budget, and proves refusal in `head-scan` (`src/instance_fork.rs:7640-7734`).

3. **High — armed `fork renew` checkpoint wedge: CLOSED.** The lifecycle writer admits only `wal_checkpoint(FULL)` under its `BranchRegistry` token (`src/storage/write_authority.rs:344-349`), and renewal runs that checkpoint before beginning the lineage transaction (`src/instance_fork.rs:3137-3170`). An ordinary later failure invokes compensation across database lineage, mint receipt, registry, and prior renewal receipt; a failed compensation reports `incomplete-recover-required` while the sentinel preserves fail-closed recovery (`src/instance_fork.rs:2995-3134`; `src/instance_fork.rs:3172-3217`). Crash cuts deliberately retain the intent and are replayed before quarantine clears (`src/instance_fork.rs:4977-5032`).

4. **High — journal maintenance denied on armed forks: CLOSED.** `JournalMaintenance` is a dedicated token whose only special authority is deleting retained `_snapback_changes` rows; it receives neither application DML nor journal-originating authority (`src/storage/write_authority.rs:40-84`; `src/storage/write_authority.rs:340-342`; `src/storage/write_authority.rs:755-775`). `prune_change_journal` holds that token for the retention transaction (`src/storage.rs:3183-3204`), and the armed-fork regression proves rows are removed and the monotonic retention floor advances (`src/instance_fork.rs:7902-7939`).

### New-slice regression review

- **Mint-time application binding:** the public managed mint APIs now require the opaque `ExpectedForkAppV1`, revalidate its canonical root receipt, persist a staging intent before cloning, and write a digest-bound fork receipt before registry intent/publication (`src/instance_fork.rs:93-110`; `src/instance_fork.rs:169-269`; `src/instance_fork.rs:2227-2294`; `src/instance_fork.rs:4487-4619`). A source-app-id mismatch refuses, recovery validates either the final receipt or staging intent, and legacy/unbound managed selection fails closed (`src/instance_fork.rs:1189-1269`; `src/instance_fork.rs:4929-4971`). The never-launched library-mint acceptance case proves immediate owning-root diff and sibling-root refusal (`tests/instance_fork_cli_v1.rs:765-873`). I found no in-boundary forgery or legacy wildcard.

- **Detached-child close-on-exec:** on Unix, the launcher marks every observed non-stdio descriptor close-on-exec and only then creates the new session (`src/cli.rs:3383-3433`). The fork server's only inherited necessities are configured as stdout/stderr, which `Command` maps to descriptors 1 and 2; it opens its database, listener, and readiness file after exec (`src/cli.rs:3591-3630`). The same helper's restart use has null stdio and no non-stdio handoff (`src/cli.rs:6982-6999`). The executable negative passes an unrelated non-CLOEXEC fd 198 through the create CLI and observes EOF while the detached server remains alive (`tests/instance_fork_cli_v1.rs:1894-1980`). I found no legitimate server descriptor that the sweep closes. The Unix implementation matches the initial macOS/Linux surface; it makes no unsupported-platform claim.

- **Bounded admission:** the guard owns the locked file, uses nonblocking `flock` with a monotonic 30-second deadline, returns the stable timeout diagnostic, and releases on every return through ordinary file-drop semantics (`src/instance_fork.rs:3323-3405`). Create keeps the guard from quota observation through registry intent and authoritative publication, then drops it explicitly (`src/cli.rs:3477-3513`). Validation or publication `?` paths also drop it. Polling is not FIFO, but contention cannot become the former TTL-length hang; a starved caller receives a bounded refusal. The zero-deadline regression proves both refusal under a held lock and immediate reuse after release (`src/instance_fork.rs:7110-7154`).

- **Renewal compensation:** the sentinel and durable intent precede mutation; database, mint, registry, and renewal receipt move in one replayable order; quarantine clears only after intent removal and final sync (`src/instance_fork.rs:2969-2993`; `src/instance_fork.rs:3063-3108`). The all-cut matrix proves recovery reaches one deterministic expiry with no residue (`src/instance_fork.rs:6836-6909`), while the executable armed-fork recovery test proves the upgraded coverage class survives an interrupted database update (`tests/instance_fork_cli_v1.rs:2342-2449`). A secondary I/O failure during compensation can still require explicit recovery, as reported, but cannot expose a normal bootable disagreement because the sentinel remains or all forward carriers were already written consistently.

### New findings

None. I found no Critical, High, Medium, or Low defect introduced by the three reviewed slices.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-3 assessment |
| --- | --- | --- |
| LLP 0163 | **READY** | The fork receipts continue to state `attribution: "absent-v1"`; the derived fork is expressly outside LLP 0163's attribution-consumer acceptance scope (`llp/0163-operation-identity-and-commit-envelope.spec.md:992-1006`). None of the three slices changes that boundary. |
| LLP 0164 | **READY** | The retained-base net diff still implements the delegated base-to-head surface and its v3 boundary/digest/absence facts remain accurately reconciled (`llp/0164-fork-and-promotion.spec.md:489-513`). Pre-expansion accounting strengthens, rather than changes, its semantics. |
| LLP 0165 | **READY** | The implementation now satisfies the narrow registered-connection whole-window rule: protected carriers, pre-authority reconstruction, irreversible gap evidence, no re-arm from `broken`, and journal/oracle verification (`llp/0165-proof-domains-and-checkpoints.spec.md:399-454`). The former manifest-restoration exploit and the independent continuity-restoration variant both fail closed. |

These are review verdicts for the fork-relevant surfaces, not edits to the documents' proposal statuses or claims about their broader acceptance rows.

### Scope 2 verdict

**READY for implementation/security publication of the narrow local `operating.instance-forks` surface reviewed here.** This verdict does not itself publish the capability: the guide correctly still calls the surface partial/unpublished, and the capability index remains target `none` pending its separate qualification, author-acceptance, and publication gates (`guide/operating/instance-forks.md:28-34`; `guide/capabilities.md:90`).

### Verification actually performed

The disposable checkout passed `scripts/bootstrap-ibex-runtime`, including exact-commit build, launch, and restricted no-eval handler-VM qualification. The following committed tests then passed individually at the reviewed SHA:

- `registered_manifest_gap_and_exact_restore_cannot_reearn_completeness`
- `net_diff_scan_preflights_huge_text_blob_and_vector_before_owned_decode`
- `armed_derived_fork_maintenance_sweep_prunes_the_change_journal`
- `root_wide_admission_deadline_is_stable_and_releases_cleanly`
- `renewal_crash_matrix_recovers_to_one_consistent_expiry`
- `detached_fork_server_closes_unrelated_inherited_descriptors_on_exec`
- `concurrent_fork_creates_bind_distinct_ports_and_drop_cleanly`
- `library_minted_never_launched_fork_diffs_only_for_its_owning_app_root`
- `executable_fork_renew_extends_a_live_fork_within_the_maximum`
- `executable_fork_recover_completes_interrupted_renewal_on_an_armed_fork`

The temporary continuity-row delete/break/exact-restore variant also passed with the expected fail-closed diagnostic. I did not run the entire repository test suite or re-review closed round-1 areas.

### Recommended next step

Treat the round-2 implementation blockers as closed and use these READY verdicts as input to the existing author/qualification/publication process. Do not change the `operating.instance-forks` target from `none` merely because this delta review is clean; first complete and verify the remaining named publication gates against the landed commit.

## Round 5 — 2026-08-06, oracle-defect closure at b08e835f1

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `b08e835f112517cf1629a842f5bcae12841ddcf0`
- **Redacted:** no
- **Method:** Independent bounded round-5 delta review. I inspected the four-file `0b8b0ff71..b08e835f1` publication-oracle fix, LLP 0162's v0.42 contract, both Codex review artifacts, the corresponding Fable artifacts, and the committed checker fixtures. I did not re-review the derived-fork implementation surface. I ran the committed JS oracle suite in the pinned worktree and four additional full-chain adversarial cases in a disposable clone at the same commit; the disposable cases re-bound review bytes, author acceptance, receipt, carrier, and anchor before invoking the production validator. The pinned worktree was changed only by the two requested review appends.

### Overall assessment

Two of the three round-4 defects are genuinely closed. Receipt custody now binds the same implementation digest at qualification C, in the receipt, and at publication P. The qualification-specific Rust literals are gone, and publication-record rotation no longer changes the qualified implementation digest. The verdict-parser defect survives in several independently reproducible forms, so the publication oracle is still fail-open for a blocked or ambiguous final review.

### Round-4 defect dispositions

1. **Receipt rotation: CLOSED.** `assertQualifiedImplementationDigestAtPublication` recomputes committed-tree digests at both C and P and requires each to equal the receipt value (`scripts/check-agent-safe-publication.mjs:544-570`). The validator separately requires C to be an ancestor of P, binds receipt/carrier source and tree identities, and returns the already-checked digest to the clean-working-tree comparison (`scripts/check-agent-safe-publication.mjs:1533-1593`). The committed negatives cover both rotation directions: a receipt changed to P while C differs, and a receipt retained at C while P differs (`tests/agent_safe_publication_checker_v1.mjs:935-979`). I found no remaining receipt-rotation route.

2. **Verdict parser: OPEN — High.** The substring bug itself is removed, but the replacement is not a safe parser for final-round authority. The full production validator accepted all four of these review shapes after every downstream digest was honestly recomputed:

   - A fenced Markdown quotation after a blocking final review contained a round heading, provenance, verdict heading, and positive statement. `finalReviewRound` scans raw lines without tracking fenced-code state, so it treated the quoted round as current (`scripts/check-agent-safe-publication.mjs:1271-1278`).
   - A lower-numbered historical appendix placed after a blocking higher-numbered round became authoritative because the function chooses the last textual match and neither enforces monotonic round numbers nor selects the greatest round number.
   - A CommonMark-valid final round using tabs after the ATX heading markers was invisible to both round and section regexes. The earlier positive round remained current even though the rendered final round was blocking (`scripts/check-agent-safe-publication.mjs:1271-1293`).
   - A Scope 1 section containing one positive table followed by a second conflicting table passed because `finalSpecReviewVerdictsAreReady` returns from the first recognized table without requiring a unique table or rejecting contradictory duplicate evidence (`scripts/check-agent-safe-publication.mjs:1355-1399`).

   These are oracle exploits, not isolated regex curiosities: each disposable fixture updated the review digest in author acceptance, updated the acceptance digest in the receipt, rehashed the receipt into the carrier, rehashed the carrier into the anchor, and then received `state: "published"` from `validatePublicationRecord`. This contradicts LLP 0162's positional/exact authority rule (`llp/0162-agent-safe-storage-profile.rfc.md:2365-2378`).

3. **Self-referential implementation digest: CLOSED.** `src/agent_safe_publication.rs` no longer embeds the qualification commit, implementation digest, candidate digest, or author-acceptance digest as qualification-specific literals. Its retained assertions are structural (`src/agent_safe_publication.rs:484-530`). Receipt, carrier, anchor, dated qualification outputs, and author acceptance remain in the closed cycle allowlist, while checker and Rust source remain in `IMPLEMENTATION_ROOTS` (`scripts/check-agent-safe-publication.mjs:39-89`). The committed stability case proves that adding and rotating the three publication records leaves the C digest unchanged (`tests/agent_safe_publication_checker_v1.mjs:888-912`). A later P can therefore carry a receipt naming an earlier immutable C without requiring C to contain its own commit or digest literal.

### Regression and storage-chain review

I found no new weakening outside the surviving parser defect. The anchor-to-carrier-to-receipt byte-digest chain remains exact; evidence paths, order, and bytes remain bound; candidate facts are reconstructed and hashed independently; derived author acceptance now binds the implementation digest, candidate digest, component list, source commit, and every non-self evidence digest (`scripts/check-agent-safe-publication.mjs:1429-1452`; `scripts/check-agent-safe-publication.mjs:1524-1573`). The same C/receipt/P equality is applied to both publication records. Both live anchors remain withheld at this commit, so this review does not publish either capability.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-5 assessment |
| --- | --- | --- |
| LLP 0163 | **READY** | Unchanged from round 4; the oracle-only delta does not touch the already-reviewed fork surface. |
| LLP 0164 | **READY** | Unchanged from round 4; the oracle-only delta does not touch the already-reviewed fork surface. |
| LLP 0165 | **READY** | Unchanged from round 4; the oracle-only delta does not touch the already-reviewed fork surface. |

These are review verdicts for the fork-relevant document surfaces, not proposal-status changes.

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local `operating.instance-forks` surface.**

### Verification actually performed

- `node --test tests/agent_safe_publication_checker_v1.mjs`: all 36 committed tests passed.
- Four disposable full-chain adversarial parser cases returned the published state: fenced quotation, appended lower-number historical round, tab-delimited final headings, and conflicting second Scope 1 table.
- `node scripts/check-agent-safe-publication.mjs`: both publication records reported `withheld` at the pinned commit.
- Source inspection confirmed the removed qualification-specific Rust literals and preserved structural assertions. I did not run Cargo tests or re-run the already-qualified fork implementation suites.

### Recommended next step

Keep both anchors withheld. Replace the raw-line authority scan with either a CommonMark-aware parser or a deliberately stricter machine-readable review-verdict sidecar. In either design, ignore fenced/quoted content, require exactly one terminal round with a strictly increasing number, reject unrecognized lookalike round headings, require exactly one authoritative section and one Scope 1 table, require each LLP row exactly once, and reject any contradictory verdict material. Add the four full-chain negatives above before re-qualification.
