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

## Round 4 — 2026-08-06, re-qualification delta 0ee1fadc1..0b8b0ff71

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `0b8b0ff71bfc3eaa968b53a694a61f8a472ee295`
- **Redacted:** no
- **Method:** Independent bounded delta review. I read the prior Codex rounds, the governing fork/completeness/publication passages, and the exact user-specified implementation-scope diff from `0ee1fadc1` to `0b8b0ff71`. I inspected the current checker and focused tests, ran the checker tests named below, and reproduced the review-verdict regex behavior directly. I did not re-review closed rounds 1–3, run Rust tests, or inspect unrelated repository changes. This pinned worktree was changed only by the two requested review appends.
- **Verdict:** NOT READY

### Delta assessment

The earlier fork-behavior conclusions **carry forward**. The only derived-fork implementation edit makes both admission-lock opens explicitly `.truncate(false)` while retaining the same root-wide nonblocking `flock` interval (`src/instance_fork.rs:3363-3381`); the other `instance_fork.rs` edit is a test borrow cleanup. The `storage.rs` delta is test visibility, unused wrapper removal, lint annotations, and semantics-preserving `if let` collapse. It does not alter the registered-writer reconstruction, continuity, authorizer installation, or lane-token path (`src/storage.rs:10871-11103`). The server delta merely classifies the existing coverage-gap diagnostic with the other internal fork faults (`src/server.rs:42046-42070`). I found no change to isolation, credential scrubbing, egress quarantine, asset custody, TTL/renewal, admission semantics, completeness, or either v3 diff receipt, and no `vendor/ibex` gitlink change.

The narrowed digest scope itself is honest: it hashes every tracked byte under `IMPLEMENTATION_ROOTS`, excludes only the closed JSON/Markdown publication-cycle records, and separately incorporates the `vendor/ibex` gitlink (`scripts/check-agent-safe-publication.mjs:38-82`; `scripts/check-agent-safe-publication.mjs:520-537`). It deliberately makes no claim about bytes outside that scope, matching the residual guarantee stated in LLP 0162 (`llp/0162-agent-safe-storage-profile.rfc.md:2312-2344`). The two defects below are in how the checker binds that digest and interprets review evidence.

### Findings

#### 1. High — publication P can rotate the receipt to P's changed implementation instead of proving C == receipt == P

The new assertion compares `implementationDigestAt(P)` only with `receipt.implementationTreeSha256` (`scripts/check-agent-safe-publication.mjs:543-567`; `scripts/check-agent-safe-publication.mjs:1488-1501`). But the receipt, carrier, and anchors are all excluded publication-cycle records (`scripts/check-agent-safe-publication.mjs:51-66`). The chain validator proves only receipt ↔ carrier equality (`scripts/check-agent-safe-publication.mjs:1451-1467`). It computes `implementationDigestAt(C)` for the author-acceptance check, but compares that digest only with the acceptance fixture, never with the receipt (`scripts/check-agent-safe-publication.mjs:1345-1367`; `scripts/check-agent-safe-publication.mjs:1402-1403`).

Therefore a publication commit can change an in-scope behavior byte (including the checker itself), put P's new digest in the allowlisted receipt and carrier, refresh the anchor, and satisfy every implemented digest comparison while the acceptance fixture continues to name C's original digest. That contradicts the stated “qualified implementation bytes ... are identical at publication” guarantee (`llp/0162-agent-safe-storage-profile.rfc.md:2312-2321`).

**Required resolution:** require `receipt.implementationTreeSha256 === implementationDigestAt(C)` before the P comparison, and also bind the author-acceptance digest directly to the receipt. Add an end-to-end negative that changes an in-scope source byte at P and rotates only the allowlisted receipt/carrier/anchor to P's digest; it must refuse.

#### 2. High — a per-document `NOT READY` row is parsed as `READY`

`finalSpecReviewVerdictsAreReady` searches each LLP table row for the word-boundary token `READY`, so `| LLP 0165 | **NOT READY** | ... |` passes (`scripts/check-agent-safe-publication.mjs:1309-1315`). I reproduced that exact regex result. `validateDerivedForkReview` then accepts the artifact as final READY evidence (`scripts/check-agent-safe-publication.mjs:1318-1333`), contrary to the witness contract's exact-READY requirement (`llp/0158-instance-forking.rfc.md:1804-1807`).

**Required resolution:** parse an exact machine-readable verdict field/cell and accept only `READY`; explicitly reject `NOT READY`. Add negative tests for one blocked document and an overall blocked final round.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-4 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | The delta does not change either v3 receipt or its explicit `attribution: "absent-v1"` boundary (`llp/0163-operation-identity-and-commit-envelope.spec.md:992-1006`). |
| LLP 0164 | **READY** | Retained-base boundaries, canonical digests, completeness facts, and explicit omissions are unchanged (`llp/0164-fork-and-promotion.spec.md:489-518`). |
| LLP 0165 | **READY** | The registered-connection completeness implementation and its narrow threat boundary are untouched (`llp/0165-proof-domains-and-checkpoints.spec.md:399-460`; `src/storage.rs:10871-11103`). |

These are document/fork-surface verdicts only. They do not cure the publication-oracle findings.

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local `operating.instance-forks` surface at the re-qualified tree.** The shipping fork behavior reviewed in rounds 1–3 remains READY, but the publication oracle can accept a behaviorally different P tree and can misread a blocking per-document review. Round 3's Scope 2 verdict therefore does not carry forward.

### Verification actually performed

The focused Node checker run passed all eight selected existing tests for the dedicated derived witness and C-to-P scope, including refusal of an ordinary in-scope byte change and a `vendor/ibex` gitlink change. Those tests keep the expected digest fixed and therefore do not cover receipt rotation. A direct execution of the current Scope-1 regex returned `acceptedAsReady: true` for a `**NOT READY**` LLP 0165 row. `git diff --check` passed for the full user-specified delta. I did not run the Rust suite or the full repository proof.

### Recommended next step

Preserve the re-qualified fork implementation and Scope 1 READY conclusions. Before publication, bind the receipt digest to C as well as P, make review verdict parsing exact, add the two adversarial negatives, and commission a bounded re-review of those oracle fixes.

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


## Round 6 — 2026-08-06, qualification commit bdc682964

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `bdc68296499298f634d9aa461e90fb8d1a7d4ab0`
- **Redacted:** no
- **Method:** Independent round-6 review at the frozen qualification commit. I read LLP 0162's v0.43 publication contract, LLPs 0158 and 0163–0165, the production checker and Rust mirror, all four prose/sidecar pairs, the C-relative implementation diff, and the storage/fork test surfaces. I ran the committed checker suite in the pinned worktree, exact-commit Rust suites in a disposable checkout, and four additional full-chain adversarial fixtures against the production validator. I did not edit implementation, receipts, anchors, author acceptance, or status headers.

### Overall assessment

The structured sidecars close the seven round-4/5 Markdown-parser bypasses and the round-5 reviewed-commit omission, but the publication contract is still **NOT READY**. I reproduced three new full-chain blockers: duplicate JSON members are accepted with last-member authority; a verdict history can be replaced wholesale and renumbered from one; and the implementation digest ignores Git entry mode/type, so an in-scope executable-bit change preserves the supposedly exact tree digest.

The fork implementation itself remains sound within the reviewed local scope. I found no fork-code regression and retain all three Scope 1 `READY` verdicts.

### Blocking findings

1. **High — duplicate JSON members bypass the exact-shape verdict contract.** Verdict files are decoded by ordinary `JSON.parse` and only then checked with `Object.keys` (`scripts/check-agent-safe-publication.mjs:454-459`; `scripts/check-agent-safe-publication.mjs:647-652`). Duplicate names have already collapsed at that point. In a complete published-chain fixture, I encoded the authoritative implementation verdict with both `"status": "NOT_READY"` and a later `"status": "READY"`, recomputed every prose, sidecar, author-acceptance, receipt, carrier, and anchor digest, and `validatePublicationRecord` returned `published`. The same schema evasion applies to other known members. This violates the closed exact-field/fail-closed contract in LLP 0162 (`llp/0162-agent-safe-storage-profile.rfc.md:2366-2387`).

2. **High — the history is contiguous but not append-only.** The validator proves only that the currently presented array is indexed `1..N`, ancestry-monotonic, and ends at C (`scripts/check-agent-safe-publication.mjs:1305-1336`). It never compares the presented history with the sidecar committed at C or with a hash-chained predecessor. I replaced a three-round implementation history with only its final `READY` entry, renumbered that entry to round 1, rebound the complete evidence chain, and the production validator returned `published`. Thus an inconvenient historical verdict can be erased rather than appended, despite LLP 0162 calling this a history that starts at round 1 and requiring a fresh highest round (`llp/0162-agent-safe-storage-profile.rfc.md:2377-2387`; `llp/0162-agent-safe-storage-profile.rfc.md:2404-2410`).

3. **High — the implementation digest does not identify the exact Git tree.** `implementationDigestAt` hashes path and blob bytes, plus the Ibex gitlink, but not each entry's Git mode or type (`scripts/check-agent-safe-publication.mjs:519-545`). The C/P check asks for a changed-path explanation only after a digest mismatch (`scripts/check-agent-safe-publication.mjs:552-577`). In a committed C/P fixture, changing an in-scope file from mode `100644` to `100755` left the digest unchanged and `assertQualifiedImplementationDigestAtPublication` accepted it. Executability is behaviorally relevant for scripts inside `IMPLEMENTATION_ROOTS`, so the three-way equality does not yet bind the qualified tree as claimed.

### Contract attacks that did close

- Fenced quotations, appended lower-number prose rounds, tab-delimited headings, conflicting prose tables, and other verdict-shaped prose are irrelevant. The checker reads the prose as opaque bytes only to hash it (`scripts/check-agent-safe-publication.mjs:1292-1314`). A full-chain fixture whose bound “prose” body was arbitrary non-UTF-8 bytes still published based solely on the structured verdict, confirming the body is genuinely never consulted for authority.
- Missing prose or sidecars, malformed JSON, unknown ordinary fields, wrong prose path/digest, wrong final commit, reordered/missing array entries without compensating renumbering, family swaps, and same-family pairs fail closed in the committed cases (`tests/agent_safe_publication_checker_v1.mjs:773-909`).
- The fixed review locators require Codex/Fable in the correct pair and distinct families (`scripts/check-agent-safe-publication.mjs:1427-1462`). This closes structural family swapping, although the family string remains reviewer provenance rather than cryptographic model attestation.
- The authoritative entry must equal C and earlier reviewed commits must be ancestry-monotonic (`scripts/check-agent-safe-publication.mjs:1323-1336`). This closes the round-5 stale-commit chain when the history is honestly retained; finding 2 is the surviving way to discard that history.

### Commit, digest, delta, and regression review

At C, the byte-oriented implementation digest recomputes deterministically as `sha256:e6353dc27e83c0b8c4ab2b7fc52af18fb6c9cd1fa35c96b11ecedf746bbd2a75`. Publication-only record rotation is excluded from that digest, so the former self-reference is gone and a receipt can honestly name C's covered bytes. The current checked-in derived receipt still names the earlier withheld candidate `0ee1fadc1`; I did not rotate it. Finding 3 prevents calling the digest a complete Git-tree identity.

The exact `cdc0fe03e..bdc682964` diff over the fork implementation files reviewed in round 3 leaves `src/instance_fork.rs`, CLI/storage/ledger code, and the CLI/VM suites unchanged. The only fork-test delta is formatting in `tests/instance_fork_bench_v1.rs`. I also inspected the broader in-scope Rust delta: `src/agent_safe_publication.rs` adds the four verdict locators; `src/manifest.rs` rotates unrelated publication hashes; and `src/server.rs` adds unrelated packaged-store diagnostic inventory plus removes two fork binding codes from the internal-500 inventory because they remain explicitly classified as 400/403 (`src/server.rs:26300-26347`). I found no fork-semantic change hidden in the broader `IMPLEMENTATION_ROOTS` churn.

The storage anchor → carrier → receipt and evidence-byte chain remains exact (`scripts/check-agent-safe-publication.mjs:1486-1551`), and both live agent-safe anchors remain withheld. No storage regression was found.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-6 assessment |
| --- | --- | --- |
| LLP 0163 | **READY** | The derived receipts still say `attribution: "absent-v1"`, which remains outside LLP 0163's current fork-consumer acceptance scope (`llp/0163-operation-identity-and-commit-envelope.spec.md:992-1006`; `src/instance_fork.rs:3608`; `src/instance_fork.rs:4136`). |
| LLP 0164 | **READY** | The retained-base v3 net-diff boundary/digest/absence contract is unchanged and remains aligned with the delegated target surface (`llp/0164-fork-and-promotion.spec.md:489-513`; `src/instance_fork.rs:4132-4136`). |
| LLP 0165 | **READY** | The narrow `registered-connection-defensive-app-rows-v1` contract and fail-closed gap behavior are unchanged (`llp/0165-proof-domains-and-checkpoints.spec.md:399-454`; `src/instance_fork.rs:4114`). The registered-manifest restoration negative passed at C. |

These are fork-relevant review verdicts, not document status changes.

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local `operating.instance-forks` surface.**

### Verification actually performed

- `node --test tests/agent_safe_publication_checker_v1.mjs`: 50/50 committed tests passed at the unmodified frozen commit.
- Four disposable, fully rebound production-validator cases passed as observed: duplicate status members, wholesale history truncation/renumbering, arbitrary prose bytes, and an in-scope `100644 → 100755` C/P change with an unchanged implementation digest. The first, second, and fourth are blockers; the third confirms the intended prose boundary.
- `scripts/bootstrap-ibex-runtime` passed exact-commit build, launch, dynamic loading, and restricted no-eval handler-VM qualification in the disposable checkout.
- `cargo test --locked --lib instance_fork::tests`: 48/48 passed.
- `cargo test --locked --test instance_fork_cli_v1`: 15/15 passed.
- `cargo test --locked --test instance_fork_vm_egress_v1`: 1/1 passed.
- `cargo test --locked --test instance_fork_disk_pressure_v1`: 1/1 passed.
- `cargo test --locked --lib agent_safe_publication::tests`: 3/3 passed.
- The lifecycle benchmark target compiled but its sole test remained ignored by its committed default; I did not claim a fresh release-mode performance measurement.
- `./ref-check --verbose` passed before this append. `node scripts/check-guide.mjs` did not pass in the initially unprepared pinned checkout because ignored generated demo artifacts and root Node dependencies were absent; this was not a fork/storage test result.

### Recommended next step

Keep the derived anchor withheld. Reject duplicate object members before semantic JSON decoding; bind each new history to its predecessor or compare immutable prior entries with C so deletion/renumbering cannot pass; and hash Git mode/type (or a canonical `ls-tree` identity) alongside path and blob bytes in both committed and working-tree digests. Add the three exploit fixtures as permanent negatives, then cut a new qualification commit and obtain a fresh round from each family.

## Round 7 — 2026-08-06, qualification commit 2a5a6291a

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `2a5a6291a137ca3df41cfc826017e4de324b65a5`
- **Redacted:** no
- **Method:** Independent adversarial review in the exact detached qualification worktree. I read the governing LLP 0162 publication contract, LLP 0158 and the fork-relevant LLP 0163/0164/0165 sections, the production checker/build/Rust mirrors, all four prose/sidecar pairs, the receipt/carrier/acceptance records, and the round-4/5 artifacts. I ran the committed publication-checker suite and additional disposable schema/history/commit attacks, independently recomputed the v2 implementation digest, bootstrapped an exact-C disposable checkout, and ran the focused Rust fork/storage regressions listed below. I did not run the full repository proof or full Rust suite. The pinned worktree was changed only by the two required prose appends and two corresponding sidecar updates.
- **Verdict:** NOT READY

### Overall assessment

The fork-relevant contracts remain **READY** at C. The v2 checker also closes
the attacked prose-parser, structured-schema, history-head, commit-binding, and
mode/type digest defects in isolation. Publication remains **NOT READY** for
two frozen-tree defects: the canonical proof asserts that the required v2
histories must remain v1, and the actual review artifacts contain no round 6
from which an honest contiguous round 7 can be appended.

### Verdict-contract attacks

The derived checker reads the Markdown only as bytes, hashes those bytes, and
never interprets a heading, table, quotation, or verdict-shaped sentence
(`scripts/check-agent-safe-publication.mjs:1382-1424`). The typed JSON path
requires canonical bytes before exact top-level, entry, and verdict shapes;
requires recognized, stable families; contiguous rounds; predecessor hashes;
ancestry-monotonic 40-hex commits; and exact C at the authoritative head
(`scripts/check-agent-safe-publication.mjs:1404-1465`). The fixed review pairs
then require Codex/Fable separation and fixed-locator family identity
(`scripts/check-agent-safe-publication.mjs:1562-1597`). Named-author acceptance
binds each complete history's count and canonical head-entry digest in addition
to the prose and sidecar evidence digests (`scripts/check-agent-safe-publication.mjs:1494-1535`).

I exercised the round-4/5 shapes again (fenced quotation, appended lower round,
tab-delimited headings, and conflicting duplicate tables), plus duplicate JSON
members, non-canonical bytes, missing/malformed files, unknown top/entry/verdict
fields, wrong schema, prose/path/digest detachment, family swaps and same-family
pairs, missing/duplicate/gapped/reordered rounds, predecessor breaks, wrong C,
non-ancestral commit order, deleted-and-restarted histories, and truncated then
renumbered/rechained histories. The valid structured control passed despite
deliberately contradictory prose. Every mutation refused at the expected layer.
The isolated history parser necessarily accepts a freshly rechained shorter
history; the end-to-end author-accepted count/head comparison refused it, which
is the documented composition rather than a parser-local guarantee.

### Blocking findings

#### 1. High — any required v2 history invalidates C's own canonical proof

The test frozen inside C asserts that all four checked-in sidecars have
`schemaVersion: snapback.review-verdicts.v1`, exactly rounds 1–5, and final
commit `b08e835f1`; it further requires the v2 validator to reject them
(`tests/agent_safe_publication_checker_v1.mjs:709-730`). But the canonical
local proof always runs that test immediately before the live publication
checker (`scripts/verify-local-proof:181-186`), while `tests` itself is part of
the v2 implementation digest (`scripts/check-agent-safe-publication.mjs:42-52`).

I reproduced the cycle in an exact-C disposable checkout: changing one sidecar
from v1 to v2 made the named test fail at line 719. Publication requires all
four histories to become v2, so any honest reviewer update makes C's canonical
proof red. Updating the test after review is not available: that test edit
changes the qualified implementation digest, advances C, and makes the just-
written head verdicts name the wrong commit.

**Required resolution:** before the next qualification C, replace the
checked-in-transitional-state assertion with stable synthetic v1-rejection and
v2-acceptance fixtures that do not depend on the live review artifacts'
current version or round count. Then choose a fresh C and re-review it.

#### 2. High — the claimed round-6/v2 history is not in the frozen tree

This artifact proceeds from Round 5 directly to Round 7
(`llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md:285`;
`llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md:344`).
Before this append, both Codex sidecars were v1 histories ending at round 5;
the Fable pair is in the same state. LLP 0162 confirms that all four sidecars
are deliberately unmodified v1 historical records and still require fresh v2
histories (`llp/0162-agent-safe-storage-profile.rfc.md:2471-2485`).

The instruction to append a contiguous v2 round 7 to an already-v2 round-6
history is therefore not satisfiable from C. The checker requires `round ===
index + 1` and the correct predecessor digest (`scripts/check-agent-safe-publication.mjs:1430-1434`).
I recorded the actual round-7 verdict with a visible 5→7 gap and predecessor
binding to the last real entry; the validator correctly refuses it. I did not
invent round-6 prose or verdicts from a summary.

**Required resolution:** recover the actual round-6 prose and typed entries
from genuine reviewer transcripts for both families, or obtain an explicit
author decision to restart/renumber the review with fresh independent inputs.

### Commit and implementation-digest binding

The digest hashes each in-scope Git entry's mode, object type, path, byte
length, and bytes, with `vendor/ibex` required as a `160000 commit` gitlink
(`scripts/check-agent-safe-publication.mjs:540-592`). C/receipt/P must all
equal the same recomputed digest (`scripts/check-agent-safe-publication.mjs:604-635`),
and the build mirror uses the same tree/framing independently (`build.rs:414-483`).

Two independent arithmetic implementations and the exact-C build produced
`sha256:017bbd2675f31b68f0fd959b555588a1b6ccaf5ea4d89f68f2dc7d1ea86177a6`
over 801 entries: 797 regular non-executable blobs, three executable blobs,
and `vendor/ibex` as `160000 commit 4c34c831aa087d6783b0d68f281cdb374ed7fc89`.
The receipt-cycle records and reviews remain outside the digest, so a receipt
can arithmetically name C. The blocking cycle is the canonical test, not digest
rotation.

### Fork surface and regression evidence

The exact `IMPLEMENTATION_ROOTS` diff from the round-5 baseline `b08e835f1` to
C changes only publication machinery: `build.rs`, the JS checker, its Rust
mirror, three publication records, and checker tests. No diff exists in
`src/instance_fork.rs`, `src/storage.rs`, `src/storage/auth_invalidation.rs`,
`src/operation_ledger.rs`, `src/local.rs`, `src/server.rs`, or `vendor/ibex`.

The exact-C bootstrap passed native link/load, launch, and restricted no-eval
handler-VM qualification. The five focused library regressions at
`src/instance_fork.rs:6837`, `src/instance_fork.rs:7112`,
`src/instance_fork.rs:7640`, `src/instance_fork.rs:7903`, and
`src/instance_fork.rs:8098` passed. The five focused executable lifecycle
regressions at `tests/instance_fork_cli_v1.rs:769`,
`tests/instance_fork_cli_v1.rs:1896`, `tests/instance_fork_cli_v1.rs:1987`,
`tests/instance_fork_cli_v1.rs:2207`, and
`tests/instance_fork_cli_v1.rs:2342` passed. All three Rust publication-chain
tests passed. The full JS checker suite passed before artifact mutation,
including the storage duplicate-field negative; the storage parser now
requires exactly one declared field occurrence
(`scripts/check-agent-safe-publication.mjs:1211-1246`).

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-7 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No relevant implementation delta; operation-identity and receipt boundaries remain as reviewed. |
| LLP 0164 | **READY** | No lifecycle, custody, egress, isolation, private-base, or promotion-boundary delta. |
| LLP 0165 | **READY** | No completeness/authorizer/journal/net-diff delta; focused gap, preflight, and pruning tests pass. |

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local
`operating.instance-forks` surface at qualification commit `2a5a6291a`.**

### Verification actually performed

- Full committed JS publication-checker suite: pass before review-artifact
  mutation; 17 focused history/parser/digest attacks passed separately.
- Additional disposable schema/history/prose/commit attacks: expected
  pass/refusal results, including named-author rejection of rechained deletion.
- Exact-C bootstrap plus ten focused fork tests and three Rust publication
  tests: pass.
- Independent implementation-digest arithmetic and exact-C embedded digest:
  equal.
- I did not run the full Rust suite or the complete local proof.

### Recommended next step

Keep both anchors withheld. Fix the live-artifact assertion before choosing a
fresh qualification commit, restore only genuine missing review provenance (or
author-reset the numbering), and commission another cross-family review. Do
not publish from `2a5a6291a`.

## Round 8 — 2026-08-06, qualification commit 0e778b9a8

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `0e778b9a85f26c45df8af0068979e355893baaa3`
- **Redacted:** no
- **Method:** Independent adversarial review in the exact detached qualification worktree. I read LLP 0005, the root LLP, LLP 0162's publication amendment, LLP 0158, the fork-relevant LLP 0163/0164/0165 sections, the production checker/tests and publication records, all four prose/sidecar pairs, and the preserved Round-6/Round-7 provenance. I ran the full committed JS checker suite before artifact mutation, audited and exercised the parser/history/digest boundaries, independently recomputed C's v2 implementation digest, bootstrapped an exact-C disposable checkout, and ran the focused Rust fork/storage regressions below. I did not run the full Rust suite or complete local proof. The pinned worktree was changed only in the two Codex prose artifacts and their two sidecars.
- **Verdict:** NOT READY

### Overall assessment

The fork-relevant LLP 0163/0164/0165 contracts remain **READY** at C. The
canonical-reader repair closes F7-1 and the genuine transcript restoration
closes F7-2. The structured history, named-author head binding, ancestry,
family separation, prose detachment, and mode/type-aware digest withstood the
requested attacks.

Scope 2 remains **NOT READY** because the frozen canonical proof still asserts
that the mutable live histories end at round 6. Appending genuine rounds 7 and
8 necessarily fails that in-scope test; repairing it changes the qualified
tree and requires a fresh C.

### Round-7 closure and adversarial audit

Every publication-chain JSON reaches the canonical boundary at
`scripts/check-agent-safe-publication.mjs:737-756`. Review histories use it
before exact schema, entry, family, round, predecessor, ancestry, head-C, and
typed-verdict checks (`scripts/check-agent-safe-publication.mjs:1393-1494`);
acceptance binds all four counts and heads at
`scripts/check-agent-safe-publication.mjs:1505-1547`; anchor, carrier, and
receipt use the same boundary at
`scripts/check-agent-safe-publication.mjs:1649-1718`. I found no chain bypass.

A4 and A5 both refused as non-canonical, as did duplicate members in every
distinct chain JSON kind. Non-canonical bytes, missing/malformed inputs,
unknown fields, wrong schemas/types, prose/path/digest detachment, family
spoof/change or same-family pairs, round gaps/reordering, predecessor breaks,
wrong C, non-ancestral commits, deletion/restart, and rechained truncation all
refused. Earlier prose-parser shapes are inert: a structured control with
contradictory prose published, proving prose is not authority.

Both Codex Round-6 sections are byte-identical to the complete streaming
transcript, and both Fable sections are byte-identical to the original session
`Write` payload. All four histories preserve rounds 1–5's semantic entries and
add the real round-6 values at
`bdc68296499298f634d9aa461e90fb8d1a7d4ab0`: LLPs 0163/0164/0165 READY and
publication NOT_READY in both families. No verdict was altered, invented, or
renumbered. The Codex Round 7 above is verbatim from its preserved artifact.

### Blocking finding

#### High — C's proof pins live review state to round 6

`tests/agent_safe_publication_checker_v1.mjs:746-768` requires each live
sidecar to contain exactly rounds 1–6 headed at `bdc682964...`, with validated
round/count 6. The local proof runs it (`scripts/verify-local-proof:185`) and
`tests` belongs to `IMPLEMENTATION_ROOTS`
(`scripts/check-agent-safe-publication.mjs:42-52`). The required post-C append
makes the proof fail. Changing the test changes C's digest and invalidates the
new heads' commit binding. I reproduced that failure after this append.

**Required resolution:** replace the live snapshot with immutable synthetic
v1/v2 fixtures, cut a fresh C, and obtain new authoritative heads.

### Commit, digest, and delta verification

The v2 digest hashes Git mode, type, path, byte length, and bytes, with
`vendor/ibex` as a `160000 commit` gitlink
(`scripts/check-agent-safe-publication.mjs:529-596`). The checker requires
`digest(C) == receipt == digest(P)` (`scripts/check-agent-safe-publication.mjs:608-639`).
Independent arithmetic and the exact-C build agree on
`sha256:b77879fa08cb71a943b7f17aecdd03b290da7bd429e68426859161faab09a725`
with Ibex at `4c34c831aa087d6783b0d68f281cdb374ed7fc89`. Review append and closed-cycle
record rotation do not change it; v1 values fail closed.

The exact in-scope diff from Round-7 C `2a5a6291a` to `0e778b9a8` contains
only publication machinery/tests/withheld records. There is no fork behavior,
fork suite, or Ibex-gitlink delta. This verifies the rounds 1–3 carry-forward.

### Fork and storage regression evidence

The exact-C native bootstrap passed, including restricted handler-VM
qualification. The exact-C tests passed: 48/48 `instance_fork::tests`, 15/15
CLI, 1/1 VM egress, 1/1 disk pressure, and 3/3 Rust publication tests. The full
unmodified JS checker suite passed 64/64 before artifact mutation, including
the storage duplicate-field negative and a rebound final-READY control. Both
anchors remain withheld.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-8 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No fork-relevant delta; operation-identity and commit-envelope boundaries remain aligned. |
| LLP 0164 | **READY** | No lifecycle, custody, isolation, egress, retained-base, or promotion-boundary delta. |
| LLP 0165 | **READY** | No completeness, authorizer, journal, coverage-gap, or net-diff delta; regressions pass. |

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local
`operating.instance-forks` surface at qualification commit `0e778b9a8`.**

### Verification actually performed

- Full 64-test JS checker suite before artifact mutation and all JSON read paths.
- A4/A5 and the schema/history/prose/family/commit/digest attacks above.
- Byte-exact Round-6 provenance and semantic rounds 1–5 comparison.
- Independent v2 digest computation and exact-C build/bootstrap.
- Exact-C 48 library fork tests, 17 executable fork tests, and three Rust
  publication tests.
- Exact in-scope delta and post-append frozen-test failure reproduction.
- I did not run the full Rust suite, lifecycle benchmark, or complete local proof.

### Recommended next step

Keep both anchors withheld. Replace the live-history assertion with synthetic
fixtures, cut a fresh C, and obtain new independent highest-round verdicts. Do
not publish from `0e778b9a8`.

## Round 9 — 2026-08-07, qualification commit 42f699749

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-07
- **Commit:** `42f699749699f416b0015781a6bb729414db4464`
- **Redacted:** no
- **Method:** Independent adversarial review at the exact detached qualification
  commit. I read LLP 0005, the root LLP, LLP 0162's amended publication
  contract and review-recovery record, the production checker and synthetic
  checker tests, the four current prose/sidecar pairs, the preserved round-7
  and round-8 artifacts, the Fable round-6 primary reviewer transcript, the
  current lifecycle receipts, and the fork-relevant implementation delta. I
  ran the full committed JS checker suite, independent digest/provenance
  comparisons, and disposable real-Git publication and evidence-swap attacks.
  I did not run the Rust suite, lifecycle benchmark, or full local proof. The
  pinned worktree was changed only by the two required prose appends and two
  corresponding sidecar updates.
- **Verdict:** READY

### Overall assessment

The round-7/8 structural blockers are closed. The test fixture no longer
depends on a live round list or commit, the exact publication-cycle exclusions
do not reduce ordinary test coverage, and the excluded evidence remains bound
through canonical bytes, named-author acceptance, receipt, carrier, and
anchor. A disposable publication P built from this exact C passed the shipped
validator with the same implementation digest at C and P. The fork surface
also still merits the standing three Scope-1 `READY` conclusions.

One statement in the round brief is factually inaccurate but is not a gate
defect: the two platform receipts committed at C name `17366d2a4`, not C
(`tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json:9`;
`tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json:9`).
The checker requires exact C for those two records
(`scripts/check-agent-safe-publication.mjs:1569-1580`), so a real publication
must rebind their canonical `environment.commit` fields during the publication
cycle. LLP 0162 expressly permits evidence to be minted or rebound at or after
qualification (`llp/0162-agent-safe-storage-profile.rfc.md:2344-2353`). I made
that exact rebind in the disposable P; it validated without moving the
implementation digest.

### Review-record provenance

The four sidecars at C are v2 histories with exactly contiguous rounds 1–8. I
compared every round-7 and round-8 prose section against the surviving
`/tmp/review-preserve/r7-{codex,fable}` and `r8-{codex,fable}` artifacts, and
compared each structured `(family, round, reviewedCommit, verdict)` tuple. The
recovered sections are verbatim and the tuples are unchanged. The current
Fable round-7 tuple also exactly matches its round-7 preservation artifact; it
is the one genuine entry absent from the reset round-8 snapshot, not a newly
invented value. I found no altered, invented, reordered, or renumbered verdict.
The repository's recovery account accurately records the three
reset-before-commit losses and the source of each restoration
(`issues/20260806-derived-fork-publication-author-gate.md:257-266` and
`issues/20260806-derived-fork-publication-author-gate.md:304-324`;
`llp/0162-agent-safe-storage-profile.rfc.md:2506-2518`).

I also checked the disputed Fable round-6 paragraph against the primary
reviewer JSONL, not the repository summary. Its initial write used the draft
claim that digest binding defeated truncation; the subsequent Edit at
`2026-08-07T05:38:08.223Z` replaced it, and the append occurred after that edit.
The current text is the final wording: the tail-deletion/READY rewrite
published, and no oracle without an external signature can prevent it
(`llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md:1624-1631`).
That matches the round-8 reviewer's transcript account
(`llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md:2186-2216`),
not the retracted draft and not a reconstruction.

### Simplified-gate attacks

`tests` remains inside `IMPLEMENTATION_ROOTS`; only fixed artifact paths are
excluded (`scripts/check-agent-safe-publication.mjs:42-81`). The test suite now
builds synthetic three- and four-round histories without consulting the live
records (`tests/agent_safe_publication_checker_v1.mjs:768-825`). All 66 tests
passed. They include A4/A5, duplicate members for each distinct chain JSON,
non-canonical encodings, wrong and spoofed commits, prose detachment, family
swaps, duplicate/missing/restarted/truncated/rechained histories, and
author-accepted history-head binding
(`tests/agent_safe_publication_checker_v1.mjs:1035-1124`;
`tests/agent_safe_publication_checker_v1.mjs:1126-1336`). They also prove that
the evidence exclusions leave the digest fixed while an ordinary test edit,
Ibex gitlink change, executable-mode change, or file/symlink type change moves
it (`tests/agent_safe_publication_checker_v1.mjs:1597-1641`;
`tests/agent_safe_publication_checker_v1.mjs:1714-1778`).

The production digest preimage includes Git mode, type, path, byte length, and
bytes, with `vendor/ibex` required as a `160000 commit` gitlink
(`scripts/check-agent-safe-publication.mjs:534-601`). Its C/receipt/P check
recomputes both committed trees and requires three-way equality
(`scripts/check-agent-safe-publication.mjs:613-640`). I independently computed
the digest at the evidence parent `17366d2a4` and at C; both are
`sha256:d32763a4caf9cd3dc2bea7a603cfdfbef54f991645c9387079bc7b50b1af337a`,
and the qualified C-to-parent change list is empty.

All eleven current chain JSON artifacts round-trip to the checker's canonical
two-space-plus-newline encoding. The bench emitter explicitly normalizes
integral floats and emits that form
(`tests/instance_fork_bench_v1.rs:71-121`,
`tests/instance_fork_bench_v1.rs:433-485`). The checker has one canonical
publication parser (`scripts/check-agent-safe-publication.mjs:742-761`), treats
Markdown only as mandatory digest-bound bytes
(`scripts/check-agent-safe-publication.mjs:1398-1427`), and validates closed,
contiguous, ancestry-monotonic histories at fixed family locators before
requiring four authoritative `READY` heads
(`scripts/check-agent-safe-publication.mjs:1431-1481`,
`scripts/check-agent-safe-publication.mjs:1586-1622`).

I attacked the new evidence boundary directly in a disposable successful P.
Changing one valid macOS metric byte without rotating the chain refused at the
receipt evidence digest. Updating only that receipt digest refused at the
carrier/receipt binding. Updating the named-author acceptance plus every outer
digest accepted, which is the documented root of trust rather than a bypass:
the contract expressly does not claim signatures or an external append-only
log (`llp/0162-agent-safe-storage-profile.rfc.md:2476-2483`). Excluding the
evidence therefore permits publication-cycle rebinding, but not a silent or
partially rebound swap.

### Satisfiability by construction

In a disposable shared clone I started from exact C, appended clearly synthetic
round-9 `READY` controls to all four histories, rebound both platform receipts
to C, generated the v2 author acceptance, receipt, carrier, and published
anchor, and committed P as `41a35c13ec5236dc0e6d126e0d4929a14d982f26`.
The unmodified shipped validator returned `published` for
`agent_safe_derived_deployment_fork_v1`; C and P both computed the digest above,
and their qualified drift list was empty. None of those synthetic controls was
written to this repository.

That construction removes the last structural objection. After this genuine
Codex round-9 entry, the remaining independent-review objection is the missing
fresh Fable round-9 verdict. Fresh platform-receipt rebinding, Charlie's exact
four-head acceptance, and the receipt/carrier/anchor rotation remain required
publication steps, not unresolved gate-design claims. The checked-in anchor is
still correctly `withheld`.

### Fork implementation surface

From the standing Scope-1 convergence commit `cdc0fe03e8` to C, the reviewed
fork implementation/test surface changes only
`tests/instance_fork_bench_v1.rs`; that delta adds canonical receipt emission
and formatting without changing a lifecycle bound, measurement, or assertion.
The core still mints permanent `promotable: false` lineage while scrubbing and
rotating inherited authority (`src/instance_fork.rs:1462-1526` and
`src/instance_fork.rs:1595-1647`), refuses malformed/promotable boot evidence
(`src/instance_fork.rs:1829-1907`), binds product lifecycle/recovery to the
invoking app identity (`src/instance_fork.rs:1189-1313` and
`src/instance_fork.rs:4891-4971`), atomically clones the current SQLite head and
optionally retains a digest-bound private base
(`src/instance_fork.rs:4545-4588` and `src/instance_fork.rs:4728-4756`), and
durably denies outbound initiation (`src/instance_fork.rs:2074-2108`;
`src/admin.rs:4354-4363`; `src/server.rs:16861-16867`).

I did not rerun Rust tests because this checkout's `vendor/ibex` submodule is
uninitialized; read-only `scripts/ibex-doctor` reported that state, and the
required bootstrap would mutate the review worktree. The Scope-1 conclusion is
therefore a code/delta revalidation, not a claim of a new exact-C Rust run.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-9 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No operation-identity or commit-envelope implementation delta after the reviewed baseline. |
| LLP 0164 | **READY** | Lifecycle, custody, isolation, current-head copy, retained base, egress denial, and non-promotion boundaries remain intact. |
| LLP 0165 | **READY** | No authorizer, journal-completeness, coverage-gap, pruning, or net-diff semantic delta. |

### Scope 2 verdict

**READY for implementation/security publication of the narrow local
`operating.instance-forks` surface at qualification commit `42f699749`, subject
to the production chain containing the other family's genuine fresh `READY`
heads and the exact publication-cycle bindings described above.** This review
does not itself publish the capability or authorize Charlie's acceptance.

### Verification actually performed

- Exact-C ancestry/status and exact implementation-digest comparison against
  evidence parent `17366d2a4`.
- Full 66-test committed JS checker suite: pass.
- All-current-chain canonical-byte round trips: pass.
- Byte/tuple comparison of recovered rounds 7 and 8 and primary-transcript
  verification of the Fable round-6 final edit.
- Disposable real-Git P construction with the shipped validator: published,
  equal C/P digests, empty qualified drift.
- Disposable evidence byte-swap, partial-rebinding, and complete-authorized-
  rebinding attacks: refused, refused, and accepted at the documented layers.
- Fork implementation delta and current critical-path code review.
- I did not run Rust tests, the lifecycle benchmark, full local proof, or a
  production publication.

### Recommended next step

Keep the anchor withheld until an independent Fable round 9 records genuine
fresh `READY` heads at this exact C. Then rebind both platform receipt commits
to C, have Charlie inspect and accept the exact four history heads and evidence
digests, construct the canonical receipt/carrier/anchor at P, and rerun the
full publication checker there.

## Round 10 — 2026-08-07, qualification commit fac516e9a

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-07
- **Commit:** `fac516e9aaa83fda398ca684285f45a57192e826`
- **Redacted:** no
- **Method:** Bounded qualification-delta review from round-9 C
  `42f699749699f416b0015781a6bb729414db4464` to the exact detached successor
  C. I enumerated the production checker's `IMPLEMENTATION_ROOTS`, compared
  every changed leaf under those roots plus the `vendor/ibex` gitlink,
  inspected the underlying lockfile/workspace change, checked the named fork
  and publication-chain surfaces for drift, recomputed both implementation
  digests, validated the imported genuine Codex round-9 histories through the
  production history parser, and inspected the canonical in-flight evidence
  records. I did not rerun the Rust suites, lifecycle benchmarks, full local
  proof, or the full publication attack corpus because the delta did not reach
  those semantics.
- **Verdict:** READY

### Delta assessment

The ancestry is a four-commit linear mainline delta. Across the exact
`IMPLEMENTATION_ROOTS`, it changes one regular blob only:
`tests/fixtures/client-bundle-metrology/current.v1.json` (`20` insertions,
`20` deletions, mode still `100644`). Every changed value is the same
`lockfileSha256` replacement:

- old: `b417f685c10348238e63e527c3b54fcc8695c5a1115f1b11c07243de525e107e`
- new: `ad8a98cbad65849cc8e496a471b0c1ddb7bbf7a6292dd4cceb27a77339ab480d`

Those values exactly equal the SHA-256 of `bun.lock` at the two commits. After
removing `lockfileSha256` members, the old and new metrology records are
identical. The lockfile delta itself adds only the new
`create-snapback-app` workspace registration and no third-party dependency
version change. `vendor/ibex` remains the same `160000 commit` gitlink,
`4c34c831aa087d6783b0d68f281cdb374ed7fc89`, at both endpoints.

There is no delta in `src`, `build.rs`, Cargo metadata, either publication
checker/policy file, the checker test, the fork sources or suites, LLPs
0158/0162/0163/0164/0165, the instance-forks guide/capability row, the four
review records, the anchor/carrier, or the bound evidence records. The
generated guide aggregate moved only with unrelated scaffold/retrieval guide
content. The new R9-2 filesystem ticket records the already-disclosed prose
history residual; it changes no gate or claim.

The implementation digest therefore rotates, as it must for a changed
digest-covered test blob:

- round-9 C: `sha256:d32763a4caf9cd3dc2bea7a603cfdfbef54f991645c9387079bc7b50b1af337a`
- round-10 C: `sha256:d49f0353b3d41943f8dbe7ed4560027671c40d6e069dc0af90a6cd12823cc6ea`

That is qualification churn, not a derived-fork or oracle semantic change.

### Chain spot-check

Before this append, both genuine Codex v2 histories were contiguous through
round 9, ended at `42f699749`, and validated as `READY` through
`validateDerivedForkReview`: spec head
`sha256:1ac0d66c3be3892cf1abe96445497c083adec140643b3c1eccb3e2857b7020c5`
and implementation head
`sha256:935b7269692723a171d0eb713830d1dd2f2186421e8da97fa1276d61130c77e8`.
This round extends, rather than replaces or renumbers, those histories.

At inspection time the two platform lifecycle receipts, the v2 author
acceptance, and the v2 publication receipt in the parallel publication
worktree all round-tripped to canonical two-space-plus-newline JSON but still
named `42f699749`. Per the round brief, that is expected in-flight state, not
a finding. They must name `fac516e9a` and bind the new implementation digest
before P can publish.

Satisfiability remains intact. The checker and its allowlists are unchanged;
the changed metrology blob is in `IMPLEMENTATION_ROOTS` and is **not** a
publication-cycle exclusion, so P must retain the exact `fac516e9a` blob for
C/P digest equality. The review/evidence/acceptance leaves that must be
rebound remain the same fixed publication-cycle leaves. Round 9 already
constructed a successful real P through this unchanged oracle; this delta
changes only the digest input that both C and its P must share. No structural
contradiction or new bypass is introduced.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-10 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No operation-identity, commit-envelope, or reviewed test-surface delta. |
| LLP 0164 | **READY** | No fork lifecycle, custody, isolation, diff, egress, or non-promotion delta. |
| LLP 0165 | **READY** | No authorizer, journal-completeness, coverage-continuity, pruning, or net-diff delta. |

### Scope 2 verdict

**READY for implementation/security publication of the narrow local
`operating.instance-forks` surface at qualification commit `fac516e9a`,
subject to the unchanged production checker and P-time chain bindings.** This
review neither publishes the capability nor supplies the other family's
round-10 verdicts or Charlie's acceptance.

### Recommended next step

Keep the anchor and guide row withheld until both families' two histories end
at genuine round-10 `READY` entries for `fac516e9a`, the lifecycle evidence is
re-minted canonically at that C, and Charlie accepts the exact four new heads,
evidence digests, and `sha256:d49f0353…`. Then rotate the receipt, carrier,
## Round 11 — 2026-08-07, qualification commit `a127e9b47`

### Provenance

- **Reviewer family:** Codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-07
- **Commit:** `a127e9b474dd5bedb31c73afa57022f4d8b82aed`
- **Redacted:** no
- **Method:** Bounded delta review from the accepted publication commit
  `fac516e9aaa83fda398ca684285f45a57192e826` to the exact qualification C. I
  enumerated the production checker's `IMPLEMENTATION_ROOTS`, compared all
  changed leaves plus the `vendor/ibex` gitlink, inspected the Rust lifecycle
  assertion and distribution guard, ran its exact unit test, ran the mandatory
  committed-schema drift test, and spot-checked the four review histories and
  canonical evidence records. I did not rerun the full attack corpus because
  the targeted checks exposed a sufficient qualification blocker.
- **Verdict:** LLP 0163 **READY**; LLP 0164 **NOT_READY**; LLP 0165 **READY**

### Delta and fork-semantics assessment

Across the exact digest roots, `fac516e9a..a127e9b47` changes four regular
files: `src/agent_safe_publication.rs`, `src/manifest.rs`,
`tests/fixtures/client-bundle-metrology/current.v1.json`, and the new
`tests/fixtures/client-bundle-metrology/baseline.asset-delivery-selection.v1.json`.
The `vendor/ibex` gitlink remains mode `160000` at
`4c34c831aa087d6783b0d68f281cdb374ed7fc89`. The implementation digest rotates
from `sha256:d49f0353b3d41943f8dbe7ed4560027671c40d6e069dc0af90a6cd12823cc6ea`
to `sha256:0b5d8e7f88cf7899d8c1d53aac04a331da0fa8e2a147c17e55625af0e52ee577`.

The metrology fixture changes are unrelated digest churn. The
`agent_safe_publication.rs` change does not alter fork behavior or weaken the
distribution control: the production guard is byte-for-byte unchanged and
still false for both contributor-source and public-package builds. The actual
target and app-effective derived tuples remain wholly `Missing`, and the
capability remains a GAP. The new test exercises closed chain types, distinct
synthetic withheld and published shapes, and a structurally valid positive
published fixture before it checks the hard-false distribution guard. Its
exact test passed at C: `1 passed; 0 failed`.

The `src/manifest.rs` lower-camel serde spellings for positive egress and
promotion values align the actual publication candidate contract. They do not
change the instance-fork operation identity, create/inspect/diff/drop
lifecycle, custody/isolation enforcement, authorizer, journal completeness,
coverage-continuity, pruning, or net-diff behavior. They do change a public
wire contract owned by LLP 0164, however, and the committed projections were
not updated with it. Scope 1 therefore carries forward only for LLPs 0163 and
0165.

### Scope 1 re-verdict

| Document | Round-11 verdict | Basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No operation-identity, commit-envelope, or relevant test-surface regression. |
| LLP 0164 | **NOT_READY** | Its Rust-owned egress/promotion wire values changed while committed schemas and TypeScript declarations retained the old values. |
| LLP 0165 | **READY** | No authorizer, journal-completeness, coverage-continuity, pruning, or net-diff regression. |

### Cross-scope generated-contract blocker

Although the fork specifications remain conformant, the global manifest wire
rename leaves committed generated contracts stale. The committed capability
and inspect schemas and `packages/snapback-codegen/index.d.mts` still use
`DenyAll`, `CaptureOnly`, `NotPromotable`, and `Promotable`. At exact C, the
mandatory test
`cargo test --test artifact_schemas_v0 dk7_committed_schemas_match_rust_types -- --exact`
fails with `capability.manifest.schema.json drifted from the Rust types` (`0`
passed, `1` failed). The TypeScript declaration is inside
`IMPLEMENTATION_ROOTS`, so repair requires a new qualification digest. This is
both the LLP 0164 conformance blocker above and a Scope-2 **NOT_READY** result.

### Chain spot-check

Before this append, all four Codex/Fable v2 histories were canonical,
contiguous through round 10, ended at `fac516e9a`, and validated through the
production closed parser with `READY` heads. This entry extends the genuine
Codex specification history as round 11.

The canonical lifecycle/evidence records still named earlier qualification
commits when inspected, which the round brief identifies as expected parallel
re-minting rather than a finding. The anchor remained withheld and the guide
capability remained a GAP. Given the DK7 failure, no evidence or acceptance
chain should publish from this C.

### Recommended next step

Regenerate the schemas and TypeScript declaration, or isolate the publication
parser from the global manifest wire format; then qualify the resulting digest
as a new C, rerun DK7 plus the exact lifecycle test, and re-review LLP 0164's
projection. Keep the anchor and guide row withheld meanwhile.

## Round 12 — 2026-08-07, qualification commit `ad0ad5874`

### Provenance

- **Reviewer family:** Codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-07
- **Commit:** `ad0ad58748981010204b61eb5002e35b887a5093`
- **Redacted:** no
- **Method:** Bounded delta review from round-11 C
  `a127e9b474dd5bedb31c73afa57022f4d8b82aed` to the exact qualification C.
  I enumerated the implementation roots and `vendor/ibex` gitlink, inspected
  the Rust serde authority and every named schema/TypeScript projection,
  searched tracked machine-consumed files for an unreported stale spelling,
  recomputed the implementation digests, and ran the exact DK7 schema-drift
  test. I compared the unchanged publication source blob and re-inspected the
  guard and lifecycle test. An attempted lifecycle-test rerun did not reach
  the test because two ignored generated Todo manifests are absent from this
  clean checkout; I did not create files outside the four authorized review
  artifacts. Round 11's exact pass carries because the source blob is
  identical. No full attack-corpus rerun was warranted by this narrow delta.
- **Verdict:** LLP 0163 **READY**; LLP 0164 **READY**; LLP 0165 **READY**

### Delta and projection assessment

The range contains two linear commits and no unrelated churn.
`3664973bc` changes only the four committed capability/inspect schemas;
`ad0ad5874` changes only the two TypeScript unions in
`packages/snapback-codegen/index.d.mts`. Each schema and the consumer
declaration now agrees with Rust's closed values:
`Missing | denyAll | captureOnly` and
`Missing | notPromotable | promotable`. The schema regeneration also carries
the expected generator-derived egress description and nothing else.

The exact DK7 drift test passes (`1 passed; 0 failed`). Searching every use
of `AgentSafeForkEgressV1` and `AgentSafeForkPromotionV1`, followed by an
old-literal search over tracked machine-consumed file types, found no third
stale schema or declaration. The only remaining PascalCase string literals
are object-shaped `DenyAll`/`CaptureOnly` malformed inputs in two explicit
rejection tests; they are not projections of the scalar wire values.

The schemas are outside `IMPLEMENTATION_ROOTS`, so the digest stays
`sha256:0b5d8e7f88cf7899d8c1d53aac04a331da0fa8e2a147c17e55625af0e52ee577`
through `3664973bc`. The TypeScript declaration is inside the roots and is
the sole qualified implementation change, yielding
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`
at C. The `vendor/ibex` gitlink is unchanged at
`4c34c831aa087d6783b0d68f281cdb374ed7fc89`.

### Scope 1 re-verdict

| Document | Round-12 verdict | Basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No operation-identity, commit-envelope, or relevant test-surface delta. |
| LLP 0164 | **READY** | The Rust-owned egress/promotion wire values, all four committed schemas, and the public TypeScript declaration now agree; the sole round-11 conformance block is closed. |
| LLP 0165 | **READY** | No authorizer, journal-completeness, coverage-continuity, pruning, or net-diff delta. |

The full `src/agent_safe_publication.rs` blob is unchanged from round 11
(blob `7fef417acfbc38591fdcfb7c5b8c73c1eb03b5b0`). Its production distribution
guard remains literal hard-false for both build kinds. Its lifecycle test
still proves a synthetic published chain passes the private structural
verifier before separately asserting the hard-false public guard, so the
round-11 exact pass remains non-vacuous and carries forward.

### Cross-scope result and history integrity

The only Scope-2 blocker identified in round 11 was the same generated-contract
disagreement, and it is repaired. **Scope 2 is READY at `ad0ad5874`, subject
to the unchanged closed publication checker and exact P-time bindings.** This
review does not publish the capability or substitute for the other required
reviewer and author acceptance.

The checked-in Codex artifacts presented to this round ended at round 10. I
restored the authentic round-11 append and v2 entries from
`/private/tmp/review-preserve/r11-codex` after confirming the checked-in
round-10 files were byte-identical to their preserved round-10 copies. Round
12 extends, rather than recreates or renumbers, that genuine history.
# Independent implementation review: derived-fork requalification candidate

## Provenance and reviewed claim

- **Family:** codex
- **Date:** 2026-08-07
- **Qualification C:** `336a605bc808a340c71407c148af450789f420ad`
- **Scoped implementation digest:** `sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Declared scope:** `src/`; `.gitmodules`; `Cargo.lock`; `Cargo.toml`; `build.rs`; the `vendor/ibex` gitlink; `scripts/check-agent-safe-publication.mjs`; and `scripts/generated-artifact-policy.mjs`
- **Claim reviewed:** the narrow contributor-source local derived-deployment-fork capability on exactly `macos/aarch64` and `linux/x86_64`: fail-closed `deny-all-v1`, finite TTL, non-promotable lineage, host-mediated isolation, and no process-containment, npm/public-package, hosted/remote, or merge-back claim.
- **Independence:** I formed this review from the dispatched tree. I read the committed 2026-08-06 review history only as the requested historical baseline and did not seek, read, or reference any concurrent requalification review.

I independently recomputed the declared digest at C and obtained the exact dispatched value. The runtime delta is generally strong, and the fork library tests remain green, but the new D-3/D-4 custody implementation has two fail-open scope defects. I also found a conflicting-first-writer race at the app-root identity call site of the new atomic JSON helper. Those three findings block the claim.

## Findings

### 1. Critical — a v3 publication receipt chooses its own scope; the checker never requires the reviewed derived-fork scope

LLP 0189 D-3/D-4 requires the claim record to carry the semantically classified scope, requires the named author to accept that classification, and treats a later scope edit as an in-scope change. The implementation declares the intended derived-fork scope at `scripts/check-agent-safe-publication.mjs:64-79`, but the publication path does not bind a v3 receipt to that declaration:

- `validateReceiptShape` checks only that `receipt.implementationScope` is a nonempty, sorted, portable scope (`:997-1025`; the permissive validator is at `:467-497`).
- `implementationScopeForReceipt` returns that receipt-supplied scope unchanged (`:1049-1052`). The qualification digest, C-to-P drift check, claim snapshot, working-tree check, and author-evidence validation all then use it (`:1981-1986`, `:2045-2098`, `:2200-2205`).
- `validateDerivedForkCoverageTransfers` validates the hard-coded intended scope separately (`:616-628`), but never compares it with the receipt scope.
- The exact-key contract for derived-fork author acceptance has no `implementationScope` or scope digest (`:1877-1893`). Its implementation-tree digest cryptographically commits to an opaque scope preimage, but the record does not say which classification the named author accepted, contrary to D-4's explicit requirement.

Concrete demonstration, using the checker exported at C without changing the tree:

```text
scope = {"schemaVersion":"snapback.agent-safe-implementation-scope.v1","roots":[],"files":["scripts/check-agent-safe-publication.mjs"]}
implementationDigestAt(C, scope)
= sha256:2e14fad65d24450a472cab5ec8b9cf556921109be708201a4301f7360d398d23
```

That scope passes `validateImplementationScope`. A freshly constructed v3 receipt, carrier, review history, and author-acceptance record can consistently bind this alternate digest, and `validatePublicationRecord` will use the one-file scope. Every runtime byte under `src/`, the Ibex gitlink, Cargo/build inputs, and the generated-artifact policy then becomes out-of-scope by construction. The fixture builder illustrates the permissiveness too: its synthetic derived record selects an arbitrary `src` + `vendor/ibex` scope rather than the declared production constant (`tests/agent_safe_publication_checker_v1.mjs:610-615`, `:716-729`).

This is a direct mechanism for moving semantics-defining files out of the claim scope. The nine-file transfer assertion does not constrain it because that assertion is evaluated against the separate constant, not the receipt.

**Required resolution:** for this capability, require canonical deep equality between the receipt scope and `DERIVED_FORK_IMPLEMENTATION_SCOPE` before using the receipt anywhere. Add the exact scope (or a separately domain-separated digest of its canonical bytes) to the named-author acceptance contract and compare it with the receipt. Add publication-record negatives that delete `src`, `vendor/ibex`, each explicit file, or substitute an otherwise valid nonempty scope; each must refuse before accepting reviews or evidence. Any future scope edit must therefore rotate C/reviews/author acceptance as LLP 0189 requires.

### 2. High — the in-digest transfer checker has an out-of-scope, unpinned semantics-affecting input

The checker is inside the declared digest, but `validateDerivedForkCoverageTransfers` reads `scripts/local-proof-selection-policy.v1.json` from the current working tree (`scripts/check-agent-safe-publication.mjs:616-627`). That policy decides whether each of the nine departing files has a registered replacement gate, including its record paths, trigger coverage, and regeneration command. The policy file is neither in `DERIVED_FORK_IMPLEMENTATION_SCOPE` nor content-pinned in the receipt or author acceptance.

This violates LLP 0189 D-4's input-closure rule for semantics-affecting inputs of an in-digest checker. A later change to the policy is classified out of scope by `evaluateClaimSnapshot`, while the publication checker immediately trusts the changed policy. The structural check does not establish the stated gate-quality bar: `assertCoverageTransfers` requires only nonempty `records`, `recordPaths`, and `regenerateCommand`, plus a path match (`:561-610`). I supplied all four gate names with `records: ["not a frozen value"]`, `regenerateCommand: "true"`, and matching `recordPaths`; the function returned all `9` transfers as valid.

At this C, I manually inspected and ran the transferred gates that this environment supports. The current registrations are substantive: the publication fixture suite recomputes checker behavior, the CI test checks workflows/toolchain pins, the local inventory checks the proof graph and versioned-seed carriers, and bundle metrology recomputes frozen bundle measurements. That current quality does not close future custody: the unpinned policy can redefine what the in-scope checker considers coverage without invalidating the claim. Separate scheduled drift handling is not a substitute for D-4's categorical input closure.

**Required resolution:** include `scripts/local-proof-selection-policy.v1.json` in the derived-fork v3 scope, or pin its exact canonical content digest in the claim record and read the C-bound bytes. Add a post-C policy-tamper fixture proving that deleting a transferred gate, changing its record/trigger mapping, or replacing its regeneration command invalidates the claim. It would also be prudent for the transfer validator to recognize the exact admitted gate definitions rather than treating arbitrary nonempty prose and commands as proof of a frozen-record gate.

### 3. High — atomic JSON replacement is byte-atomic, but first app-root identity publication is still last-writer-wins

The filesystem durability repair itself is sound on the two claimed filesystems: `replace_bytes_sync` creates a unique same-directory temporary with `create_new`, writes and `sync_all`s it, renames it over the final path, and fsyncs the parent directory (`src/instance_fork.rs:1404-1440`). Same-directory rename gives atomic name visibility on the claimed macOS/Linux targets. The prior `write_json_sync` used `File::create`, so no caller actually inherited create-exclusive behavior from the old helper; existing overwrite call sites therefore did not lose such a guarantee.

One call site nevertheless needs a stronger logical operation than replacement. `ensure_expected_app` reads the app-root identity, and on `NotFound` unconditionally calls `write_json_sync`, then returns its own opaque expectation (`src/instance_fork.rs:192-239`). Two first writers for different app IDs can both observe `NotFound`, publish separate complete temporaries, rename in either order, and both return success. The new 32-writer test covers only the same app ID (`:5160-5194`), so last-writer-wins happens to look idempotent.

A deterministic refutation path is to reuse the existing pre-rename test hook with a two-party barrier: invoke `ensure_expected_app(root, "app-a")` and `ensure_expected_app(root, "app-b")`, hold both immediately before rename, then release both. Both calls return an `ExpectedForkAppV1`; only the last identity remains. The later root-wide creation-admission lock cannot serialize this because the CLI calls `ensure_expected_app` before `admit_creation` (`src/cli.rs:3462-3485`). A concrete harmful interleaving is:

1. A and B both read `NotFound`.
2. B installs identity B, obtains the admission lock, passes the one-time mint revalidation at `src/instance_fork.rs:2287-2319`, and starts publication.
3. A replaces the identity with A while B still owns admission, then waits for admission.
4. B completes its fork publication; A subsequently validates A and can publish too.

B's later runtime-registry attachment revalidates against the now-A root and can fail at `src/cli.rs:3743-3748` after its detached server has already launched, leaving a fork/server that the final A identity cannot select normally. This is an ordinary competing-create race inside the cooperating local boundary, not malicious same-user file tampering. It cuts across the claimed app binding and exact reap/drop lifecycle.

**Required resolution:** give immutable app-root identity a first-writer-wins compare-and-publish primitive. One portable approach on the claimed targets is a synced same-directory temporary followed by an atomic no-replace installation (for example a same-filesystem hard link), then read/compare the winner on `AlreadyExists`, remove the temporary, and fsync the directory. A lock-and-recheck design is also acceptable if its crash behavior is explicit. Add deterministic same-ID and conflicting-ID first-writer tests; conflicting writers must yield exactly one accepted identity and the loser must mint or launch nothing.

### 4. Informational — the remaining atomic-publication argument and regression tests are convincing

Outside Finding 3's immutable-identity requirement, I found no call site that depended on create-exclusive semantics. The helper now prevents readers from seeing truncated JSON, uses unique temporary names, cleans an unpublished temporary on failure, and reports directory-sync failure instead of claiming durability. The pre-rename hook test proves that the final path is absent while the complete synced temporary is visible (`src/instance_fork.rs:5126-5157`), and the 32-way identical-identity test proves the intended idempotent case. Both tests passed here. The complete `instance_fork::tests::` prefix also passed: 50 passed, 0 failed.

### 5. Informational — the descriptor failure was a test artifact; the production sweep remains directly proven

The production `configure_detached_child` path is unchanged: it snapshots a descriptor ceiling and, in child `pre_exec`, marks every non-stdio descriptor through that ceiling `FD_CLOEXEC` before `setsid` (`src/cli.rs:3383-3433`). The new isolated unit test atomically opens an `O_CLOEXEC` flock lease, deliberately duplicates it to descriptor 198, invokes the real production configurator on `/bin/sleep`, and proves after exec that the child no longer owns the lock (`src/cli.rs:9983-10051`). It passed here.

The live integration replacement is also a valid refutation of the old fixture: opening the lease with `O_CLOEXEC` removes the process-wide `pipe()`-then-`F_SETFD` window, and `dup2` occurs only in the spawned CLI child's `pre_exec`; a nonblocking flock probe tests retention of the same open-file description. I agree with the conclusion “old failure was a test artifact; production sweep is correct” for the claimed CLI path. I found no production regression in this delta.

### 6. Informational — review-prose and AgentSafe declaration hardening do not weaken custody

The prose-history change is additive and fail-closed: it enumerates the legacy round heads, requires new rounds to declare `frozen-per-round`, and binds each round to the SHA-256 and length of the exact review prefix. Legacy current-artifact digest checks remain in force. I found no route for a new unbound round or retrospective prose rewrite.

The declaration checker now inventories every `AgentSafe*` definition across four committed schemas, canonicalizes schema shape while excluding only descriptions, and requires exact TypeScript enum/object membership, required properties, and closed-object shape. `node scripts/check-agent-safe-publication.mjs --codegen-declarations-only` reported `ok (33 definitions, 4 schemas)`, and the 76-test publication-checker suite passed. These changes strengthen custody; they do not compensate for Findings 1-2.

### 7. Informational — runtime spot-checks found no other regression in the narrow claim surface

I compared the scoped delta from `ad0ad5874` through C and spot-checked the surviving LLP 0158 invariants. The 50 passing fork-library tests include finite maximum lifetime and renewal, deny-all coverage for classified and unknown egress families, disabled manual cron/provider paths, non-promotable minted identity, parent credential/cursor refusal, resource-admission boundaries, exact diff custody and work limits, evidence-bound registry/drop/reap behavior, expiry refusal, and publication/renewal crash matrices. The descriptor unit passed separately. The unrelated post-baseline auth-stream-reset carrier and local-store publication updates do not widen the fork claim. I found no new npm, hosted/remote, process-containment, or merge-back assertion.

## Execution record and supplied-evidence reliance

- Recomputed C's canonical v3 digest: exact match, `sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --lib instance_fork::tests:: -- --nocapture`: 50 passed, 0 failed.
- Focused detached-descriptor unit: 1 passed, 0 failed.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 76 passed, 0 failed.
- Full publication checker at the withdrawn tree state: clean exit; both agent-safe records correctly reported `withheld`.
- Codegen declaration check: 33 definitions across 4 schemas, passed.
- CI workflow fixture: passed, 9 workflows and 44 immutable action pins.
- Local-proof inventory: 3 passed, 0 failed.
- Client-bundle metrology failed closed before measurement because this shell is Node `v25.9.0`/zlib `1.2.12`, while the frozen method requires Node `v24.18.0`/zlib `1.3.1-e00f703`. I treat that as an environment mismatch and not as green evidence.
- The focused live descriptor integration could not reach readiness. An independent loopback probe failed with `EPERM: operation not permitted 127.0.0.1`, confirming that this review sandbox cannot bind loopback. I therefore do not treat the integration attempt as a candidate failure or success.
- As the dispatch permits, the platform-execution portion of this verdict relies on the supervisor-supplied live release-profile suites on exact C for `macos/aarch64` and `linux/x86_64`, plus the exact-C row-13 bench. That reliance cannot cure the static publication-custody or first-writer findings above.
- The repository worktree remained clean. I modified no repository file.

VERDICT: NOT READY — blocking findings 1, 2, and 3.
# Independent implementation review: derived-fork requalification round 2

## Provenance and disposition

- **Reviewer family:** codex
- **Date:** 2026-08-07
- **Round-1 baseline:** `review-codex.requalification-2026-08-07.md`
- **Qualification candidate C:** `622d61b9f29c18bdab3e4f0b23fa9de085eb3161`
- **Scoped implementation digest:** `sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Canonical scope:** `src/`; `.gitmodules`; `Cargo.lock`; `Cargo.toml`; `build.rs`; `scripts/check-agent-safe-publication.mjs`; `scripts/generated-artifact-policy.mjs`; `scripts/local-proof-selection-policy.v1.json`; and the `vendor/ibex` gitlink.
- **Reviewed delta:** the complete scoped delta `336a605bc808a340c71407c148af450789f420ad..622d61b9f29c18bdab3e4f0b23fa9de085eb3161`, plus the out-of-scope regression fixtures added for the fixes.
- **Patch provenance:** I verified that `236545215` and `3fbbbed7d` have the same stable patch id, `19f499eb0bcfedaabc5a0cc8a68063a1cf8d1f00`; `ed21704ef` and `622d61b9f` have the same stable patch id, `9cda606046527584b09c98efc11f838bbfce0505`.
- **Independence:** I did not open or consult any concurrent round-2 review.

I independently recomputed the v3 digest at C and obtained the exact dispatched value. All three round-1 blocking findings are closed to the requested bar, and each demonstrated attack now refuses. The scoped-delta scan found one new blocking provenance defect in the v3 named-author-acceptance closure, however: the new-C acceptance is required at the retained 2026-08-06 locator and must falsely retain the 2026-08-06 acceptance line. The candidate is therefore not ready as the requalification C.

## Round-1 finding closure

### 1. CLOSED — an alternate-scope receipt refuses before review or evidence authority

`DERIVED_FORK_IMPLEMENTATION_SCOPE` now includes the transfer policy and remains a closed, sorted scope (`scripts/check-agent-safe-publication.mjs:67-80`). For a v3 derived-fork receipt, `validateReceiptShape` validates the scope and then requires canonical deep equality with that constant (`:1121-1153`). `validatePublicationRecord` invokes that check at `:2165`, before carrier authority, review parsing, evidence semantics, or digest selection. The named-author v3 contract independently requires the acceptance scope to equal both the receipt and the canonical constant (`:1997-2028`).

I reran the production-fixture substitution attack. All ten receipt cases refused with `receipt scope does not equal the canonical derived-fork scope`: deleting `src`, deleting each of the eight explicit files (including the newly scoped transfer policy and the Ibex gitlink), and substituting the otherwise valid one-file checker scope. The deliberately corrupted review/evidence binding in those fixtures never became authoritative. A separate acceptance-scope substitution also refused with `named-author/source/component acceptance drifted`. The targeted run passed 11/11.

This meets the round-1 requirement: a receipt can no longer choose a narrower digest preimage, the author record states and binds the exact classification, and a future scope edit rotates C/review/acceptance.

### 2. CLOSED — prose-only transfer metadata no longer qualifies as a frozen-record gate

The semantics-affecting `scripts/local-proof-selection-policy.v1.json` is now an explicit v3 scope file (`scripts/check-agent-safe-publication.mjs:77`). The in-scope checker carries exact admitted definitions for the four transferred gates (`:82-160`). `assertCoverageTransfers` now requires canonical equality with that authority, tracked regular-blob record paths at `HEAD`, and actual trigger-rule coverage of each departing path (`:677-735`); record prose is no longer accepted as path coverage.

I reconstructed my round-1 attack exactly in spirit: all four gate names were present, every transferred path appeared in `recordPaths` and `triggerRules.files`, but `records` was only `"not a frozen value"` and `regenerateCommand` was `"true"`. The checker refused immediately:

```text
REFUSED: agent-safe-publication: coverage transfer tests/agent_safe_publication_checker_v1.mjs is not covered by registered drift gate agent-safe-publication-fixtures
```

The fixture suite also proved deletion, record/trigger remapping, and command replacement refuse, and that a post-C policy edit invalidates the snapshot as `M:scripts/local-proof-selection-policy.v1.json`. This meets the input-closure and gate-quality bar from round 1.

### 3. CLOSED — conflicting first writers now have one accepted app-root identity

`ensure_expected_app` delegates first publication to `install_app_root_identity_sync` (`src/instance_fork.rs:192-239`). The helper writes and fsyncs a unique same-directory temporary, atomically installs the final name with a no-replace hard link, removes the temporary, and fsyncs the directory (`:1390-1473`). `AlreadyExists` reads and compares the complete winner: the same identity succeeds idempotently; a conflicting identity returns `SNAPBACK_FORK_APP_BINDING_MISMATCH`. A successful return cannot occur for both distinct identities.

I reran the exact two-party pre-install barrier attack with `app-a` and `app-b`. It passed with one accepted identity, one mismatch refusal, `mint_attempts == 1`, `launch_attempts == 1`, one destination directory, and the final identity matching the accepted writer. The full 52-test `instance_fork::tests::` filter also passed, including the deterministic same-ID barrier and the original 32-writer case.

The normal crash residue after a process dies between hard-link installation and temporary unlink is an extra complete same-inode temporary, not a second identity or partial final file; success still requires the directory fsync. I found no regression in the claimed macOS/APFS and Linux/local-filesystem operation.

## New blocking finding

### 4. High — the v3 closure backdates the fresh acceptance and requires replacing its retained historical artifact

The fix changes the accepted shape at the fixed author-evidence locator from v2 to v3 and adds the new C/digest/scope bindings, but it leaves both the locator and the asserted author line frozen to the previous publication:

- `DERIVED_FORK_EVIDENCE` still names `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json` (`scripts/check-agent-safe-publication.mjs:26-40`).
- `validateDerivedForkAuthorAcceptance` now requires `schemaVersion: snapback.derived-fork-author-acceptance.v3`, `qualifiedSourceCommit === C`, the v3 digest and scope, but also requires `authorLine === "Charlie Cheever — accepted 2026-08-06"` (`:1997-2028`).
- Candidate C was created on 2026-08-07. The currently retained file at that locator is the historical v2 acceptance for `ad0ad58748981010204b61eb5002e35b887a5093` and the ambient v2 digest.

Consequently there is no honest artifact that satisfies the checker and the requalification ticket at once. Preserving the historical bytes fails the new v3 contract. Replacing them with a v3 record for C violates the ticket's byte-retention/no-rewrite rule and represents acceptance of an August 7 commit as having happened on August 6. A truthful `accepted 2026-08-07` line is rejected. The synthetic published fixture masks this by constructing its new v3/new-C acceptance with the stale 2026-08-06 line (`tests/agent_safe_publication_checker_v1.mjs:692-718`), and the 90-test suite therefore accepts the impossible provenance.

This is a blocking defect in the new acceptance closure, not a complaint about evidence that has not been collected yet. LLP 0189 D-3/D-4 and the requalification ticket require a **fresh named-author acceptance** binding the new scope, evidence, review heads, C, and digest. The checker must be capable of admitting that truthful fresh record without rewriting the historical acceptance.

**Required resolution:** before selecting the next C, allocate a new dated v3 author-acceptance locator, preserve the 2026-08-06 v2 file byte-for-byte, and make the v3 contract carry a truthful fresh acceptance date/line. Update the synthetic publication fixture and add a negative proving that the historical locator cannot be substituted or rewritten as the new acceptance.

Related but not counted as a second delta-introduced finding: the three platform/bounds locators at `scripts/check-agent-safe-publication.mjs:27-29` are likewise fixed to 2026-08-06, while this requalification requires fresh platform evidence. Candidate commit `622d61b9f` itself files `issues/20260807-lifecycle-bench-overwrites-dated-receipt.md`, records that the fresh run overwrote the dated macOS receipt, discards that overwrite, and says the emitter must mint a new dated path. That pre-existing evidence-emitter defect should be resolved in the same append-only locator pass; otherwise this C also cannot acquire the promised fresh lifecycle evidence without rewriting history.

## Remaining scoped-delta scan

The entire scoped delta contains only:

1. the checker changes reviewed above;
2. the app-root identity helper and tests reviewed above; and
3. a comment-only clarification in `scripts/generated-artifact-policy.mjs` about exact enumeration versus content-addressed leaves.

No Cargo/build input, Ibex gitlink, or other `src/` file changed in the scoped delta. I found no other semantic regression or claim widening. In particular, finite TTL, `deny-all-v1`, non-promotable lineage, host-mediated isolation, and the explicit exclusions for process containment, public packages, hosted/remote targets, and merge-back remain unchanged.

## Execution record

- Recomputed candidate C's canonical v3 digest: exact match, `sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`.
- Alternate-scope and author-scope targeted fixtures: 11 passed, 0 failed; every attack refused at the intended boundary.
- Direct prose-only transfer-gate attack: refused at the first transferred leaf.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 90 passed, 0 failed.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --lib instance_fork::tests:: -- --nocapture`: 52 passed, 0 failed.
- Focused conflicting-ID barrier: 1 passed, 0 failed.
- `cargo test --test instance_fork_cli_v1 --no-run`: compiled successfully. Per dispatch, I did not run loopback-dependent tests.
- `node scripts/check-agent-safe-publication.mjs`: clean exit; both publication records correctly report `withheld`.
- CI workflow fixture: passed, 9 workflows and 44 immutable action pins.
- Local-proof inventory: 3 passed, 0 failed.
- `./ref-check --verbose`: 190 LLP documents, 4,058 refs, 0 errors, 0 unchecked.
- `git diff --check` for the scoped delta: clean.
- `cargo fmt --check` reports existing formatting drift in files such as `src/admin.rs`, `src/cli.rs`, and `src/manifest.rs` that are unchanged by `336a605bc..622d61b9f`; I do not attribute that pre-existing main-tree condition to these fixes.
- The worktree remained clean at detached candidate HEAD. I modified no repository file and did not push.

VERDICT: NOT READY
# Independent implementation review: derived-fork requalification round 3

## Provenance and disposition

- **Reviewer family:** codex
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-07
- **Redacted:** no
- **Method:** independent delta/source review, independent digest reconstruction,
  adversarial fixture replay, and focused local verification
- **Round-2 baseline:**
  `review-codex.requalification-round2-2026-08-07.md`
- **Qualification candidate C:**
  `03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`
- **Candidate committer date:** `2026-08-07`
  (`2026-08-07T18:01:25-07:00`)
- **Scoped implementation digest:**
  `sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Canonical scope:** `src/`; `.gitmodules`; `Cargo.lock`; `Cargo.toml`;
  `build.rs`; `scripts/check-agent-safe-publication.mjs`;
  `scripts/generated-artifact-policy.mjs`;
  `scripts/local-proof-selection-policy.v1.json`; and the `vendor/ibex`
  gitlink, subject to the committed publication-cycle exclusions.
- **Reviewed delta:** the complete canonical-scope delta
  `622d61b9f29c18bdab3e4f0b23fa9de085eb3161..03f9d147cbf6798de2f74467cf5a2a3d8d3d756a`,
  plus the finding-4 test, lifecycle-emitter, and ticket changes.
- **Patch provenance:** `2d4d276d9` and its rebased candidate commit
  `c24ee93e1` have stable patch id
  `c48b246289a30706be158d936c0e63ab2ea88698`; `3c50c970e` and
  candidate HEAD `03f9d147c` have stable patch id
  `f9303a60d733beb70079429bb6b559014ee35323`.
- **Independence:** I did not open or consult another concurrent round-3
  review. This session did not author the candidate changes.

Finding 4 is closed to the bar in my round-2 review. The acceptance contract
can now admit a truthful fresh acceptance without replacing or backdating the
retained v1 artifact; current dated evidence is add-only at publication; and
the lifecycle emitter refuses a collision without changing the first bytes.
The three round-1 closures remain intact, and I found no new blocking defect in
the scoped delta. Candidate C is ready for the next qualification steps; this
review does not itself publish the capability or stand in for the still-needed
platform receipts, other-family review, or named-author acceptance.

## Finding 4 closure

### CLOSED — fresh acceptance is truthfully dated and cannot substitute the historical locator

The checker retains the 2026-08-06 chain separately as
`DERIVED_FORK_HISTORICAL_EVIDENCE` and admits a current v3 acceptance only at
`tests/acceptance/fixtures/instance-forks/author-acceptance.<date>.v3.json`
(`scripts/check-agent-safe-publication.mjs:30-55`). The locator date must be a
real ISO calendar date, and every current dated lifecycle, bounds, and
acceptance locator must be on or after qualification C's committer date and
absent from C (`:1141-1163`, `:1236-1248`). The acceptance validator derives
the required line from that locator and requires exactly
`Charlie Cheever — accepted <same date>`, while retaining the v3 C, digest,
scope, candidate, component, evidence-digest, and review-head bindings
(`:2062-2111`). C's committer date is 2026-08-07, so a truthful 2026-08-07 or
later record is admissible; a 2026-08-06 locator, a locator/line mismatch, or a
path already present at C refuses.

I re-attempted the round-2 substitution by making the current v3 receipt name
the historical
`author-acceptance.2026-08-06.v1.json` locator. The production validator
refused at receipt shape with `evidence 12 drifted`. The focused fixture run
also proved that a mismatched line date, pre-C acceptance, pre-C platform or
bounds dates, and a current locator pre-existing at C all refuse. The positive
synthetic v3 publication path, which uses the truthful 2026-08-07 locator and
line, passes in the complete checker suite.

I compared every one of the 13 retained historical evidence-chain files at
round-2 C and round-3 C. All are byte-identical. In particular, the retained
v1 acceptance remains
`sha256:82dbbcebe055f602d46b5fe5c64efc30fa460f459929d93014adf050c65f9e8c`;
the three 2026-08-06 lifecycle/bounds receipts remain respectively
`sha256:47c20cd5b05b4bdd5158d6cb1e3a651fc94611293afcc38df9b14c112999c38d`,
`sha256:e79d33fe1fdfe54aac823916145fad6528e5930c02a903dfbac0222ed12cdf1a`,
and
`sha256:bf73b3a6f09032fb166c25eea646c9f5170aab7301c43431ffe4eb21de886e4f`.

### CLOSED — evidence locators are append-only at the publication boundary

For the four dynamic current locator classes, `allowedPublicationPath`
recognizes only the exact dated filename grammars and
`allowedPublicationChange` accepts status `A` but rejects `M` (as well as all
other non-add statuses) (`scripts/check-agent-safe-publication.mjs:393-396`,
`:565-573`). The focused allowlist test exercised both results for both
platform paths, bounds, and acceptance. Independently, published semantics
require each selected current path not to exist at C, closing pre-existing-file
reuse. Receipt-bound paths, rather than fixed globals, are used for bounds,
platform, asset, review-history, and acceptance reads (`:1889-1904`,
`:1930-2059`, `:2114-2197`). There is no rolling locator for a later
requalification to overwrite.

### CLOSED — the lifecycle emitter mints with exclusive create

The bench now derives its filename date from UTC Unix days and opens the final
path with `OpenOptions::create_new(true)`, then writes and `sync_all`s it
(`tests/instance_fork_bench_v1.rs:103-136`, `:522-539`). The two focused Rust
regressions pass: UTC day 0 and 2000-01-01 map correctly, and a second write to
an existing dated path returns `AlreadyExists` while preserving the original
bytes exactly.

## Earlier closure regression check

1. **Round-1 finding 1 remains closed.** The canonical derived-fork scope is
   still closed and sorted; v3 receipt validation still requires canonical
   deep equality before review/evidence authority; acceptance still binds the
   same scope. The complete 95-test checker suite reran all ten noncanonical
   receipt-scope attacks and the acceptance-scope attack successfully.
2. **Round-1 finding 2 remains closed.** The transfer policy remains in scope,
   and the exact admitted frozen-record definitions, tracked record paths,
   trigger coverage, and regeneration commands are unchanged. The deletion,
   remapping, command-replacement, and post-C policy-tampering negatives all
   remain green in the complete checker suite.
3. **Round-1 finding 3 remains closed.** `src/instance_fork.rs` did not change
   in this delta. The full 52-test `instance_fork::tests::` filter passes,
   including same-ID publication and
   `conflicting_first_writers_accept_one_identity_before_mint_or_launch`.
   Exactly one conflicting identity remains accepted before mint or launch.

## Scoped-delta scan

The hash-relevant canonical-scope changes from round-2 C are the acceptance /
locator checker change and an unrelated one-line `src/manifest.rs` digest-pin
refresh. The two local-persistent-store JSON leaves under `src/` also changed
in ancestry but are committed publication-cycle exclusions; their carrier and
anchor digests agree, and the affected local-persistent-store conformance proof
reports published with `17 PASS / 0 GAP`, `8/8 PASS`, and `8/8 PASS`.

The finding-4 support delta contains the synthetic publication-fixture
updates, the UTC/exclusive-create lifecycle emitter, and the resolved
filesystem ticket. I inspected the complete changes, including receipt-shape
selection, date parsing/comparison, receipt-bound semantic reads, dynamic path
classification, acceptance construction, and collision behavior. I found no
claim widening, stale global-locator read, or new defect. The unrelated ambient
ancestry changes outside this review's canonical/support scope were not used as
evidence for the verdict.

## Execution record

- Independently reconstructed the v3 byte stream over 173 committed entries:
  exact dispatched digest
  `sha256:582ed92c5aa69e1aac52a009e95680131de6f743b713035e29d2eec90602bed5`.
  The production digest function returned the same value.
- Verified all 13 historical evidence-chain paths byte-for-byte between
  `622d61b9f` and C.
- Focused finding-4 fixture run: 6 passed, 0 failed (historical locator
  substitution, line-date mismatch, pre-C acceptance, pre-existing current
  acceptance, pre-C platform/bounds evidence, and A-versus-M allowlist).
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 95 passed, 0
  failed.
- `node scripts/check-agent-safe-publication.mjs`: clean exit; both live
  records correctly report `withheld`.
- `scripts/bootstrap-ibex-runtime`: exact-link, launch, and restricted
  no-eval handler-VM qualification passed for C with a clean build stamp.
- Focused lifecycle-emitter Rust filter: 2 passed, 0 failed.
- `cargo test --lib instance_fork::tests:: -- --nocapture`: 52 passed, 0
  failed.
- Affected local-persistent-store publication conformance: passed.
- JS syntax checks and focused Rust formatting check: passed.
- `./ref-check --verbose`: 190 LLP documents, 4,059 refs, 0 errors, 0
  unchecked.
- `git diff --check 622d61b9f..03f9d147c`: clean.
- The worktree remained clean at detached candidate HEAD. I modified no
  repository file and did not push.

VERDICT: READY
# Codex-family final delta review — derived-fork requalification

**Date:** 2026-08-09  
**Reviewer:** Codex-family reviewer  
**Candidate C:** `772c00649534d68b2ba63b98699e8ce2b2019057`  
**Prior reviewed head:** round 3 READY at `03f9d147c`  
**Policy-custody pivot:** `dcdcdc4be45f45fed622a90985097ed7b5d9f336`

## Verdict

I found no blocking regression in the final delta. The content-pin alternative now meets the bar stated in round-1 finding 2: post-C working-tree policy changes cannot change the transfer verdict or invalidate the scoped implementation digest, while a receipt pin that does not equal the qualification-C policy bytes is refused. The subsequent 144-commit fleet delta preserves the derived-fork invariants under review.

This review is independent. I consulted only my own prior round-1 through round-3 review artifacts in `/Users/ccheever/projects/requal-reviews/`; I did not consult another concurrent final review.

## Review basis

I confirmed the checked-out Snapback `HEAD` is exactly C. The range `dcdcdc4be..C` contains 144 commits and changes 48 files in the canonical derived-fork implementation scope, with 8,692 insertions and 1,209 deletions. The largest fork-adjacent raw diffs are:

| File | Raw delta | Classification after whitespace/semantic review |
| --- | ---: | --- |
| `src/cli.rs` | +746/-220 | Predominantly the `2844b8f75` repository-wide formatter sweep plus unrelated CLI fleet work; the relevant semantic change is constrained minted-token discovery. |
| `src/instance_fork.rs` | +130/-95 | Predominantly formatting; semantic changes are ordinary-error staging cleanup, one copied custody table, enum field accounting, and request-local mutation-settlement admission. |
| `src/fork_promotion.rs` | +60/-13 | Store-inventory visibility plus damaged-expired-branch reap self-healing. |
| `src/instance_lock.rs` | +32/-1 | Owner-only, descriptor-relative creation of an absent ordinary-startup instance directory. |

The governing constraints I used are LLP 0158's closed runtime plane and publication/lifecycle protocol, LLP 0164's strict fork-class separation and non-promotability, LLP 0165's authorizer-backed host-mediated isolation boundary, LLP 0185's finite managed lifecycle, and LLP 0189 D-3/D-4's claim-scoped and content-pinned qualification model.

## 1. Content-pin custody versus round-1 finding 2

### Recomputed identities

Using `implementationDigestAt` from `scripts/check-agent-safe-publication.mjs` at C, I independently recomputed:

`sha256:53e85a9f1958bcba44ceac12c24e70608b79ae9eeb47871bdd405fc6db796b75`

This exactly matches the expected v3 scoped digest. The exact C bytes of `scripts/local-proof-selection-policy.v1.json` hash to:

`sha256:405464036917695c3007f449d6e9f8272efa04822b0d62fa9b0f55b47b4e9c32`

### Custody analysis

The selection policy is deliberately outside `DERIVED_FORK_IMPLEMENTATION_SCOPE`, but is no longer ambient input:

- A derived-fork v3 receipt has an exact `selectionPolicySha256` field (`scripts/check-agent-safe-publication.mjs:1192-1235`).
- The named-author v3 acceptance has the same exact field and must equal the receipt (`:2100-2133`).
- Transfer validation requires a 40-hex qualification C and a canonical SHA-256 pin, reads the policy with `git show C:path`, hashes those bytes, refuses a mismatch, parses only those C-bound bytes, and evaluates transfers with `recordCommit: C` (`:760-797`).
- Published-record validation invokes that transfer validation using the carrier's qualified source commit and the receipt pin before accepting evidence (`:2261-2321`).
- The in-checker admitted-gate mirror still prevents a shape-valid prose stub from impersonating a canonical frozen-record gate (`:99-103` and the associated gate validation).

### Attack re-attempts

I re-ran the attacks in disposable checker fixtures rather than modifying the Snapback checkout:

1. Replacing the post-C working-tree policy with different valid policy bytes did not change the C-bound transfer result (`9` transfers), did not alter the scoped implementation digest, and did not invalidate the standing claim snapshot.
2. Supplying a receipt pin of `sha256:` followed by 64 `e` characters was refused with the expected qualification-C digest-mismatch diagnostic; the checker reported the actual C digest above.
3. The focused tests for C-bound validation, exact receipt/author pinning, and post-C out-of-scope policy evolution all passed.
4. The complete publication-checker test file passed: 97 tests, 0 failures.

This satisfies the alternative explicitly allowed by round-1 finding 2. Policy semantics are bound by content and source commit even though the selector file is not part of the implementation tree digest.

## 2. Fork-surface fleet delta

### Deny-all and host-mediated isolation

The derived host-op classifier remains exhaustive and fail-closed: an unknown operation maps to `UnclassifiedHostOperation`. The only new locally admitted operation is `mutation.settlement` (`src/instance_fork.rs:2157-2189`). Its implementation is a read-only projection of the current mutation request's client mutation identity and settlement digest; it creates no external effect and is refused for query/action contexts. No new fetch, stream, push, job-enqueue, telemetry, asset-provider, or unclassified initiation path was added.

The copied `_snapback_job_idempotency_tombstones_v1` custody row transfers durable state, not job authority; the fork runtime continues to deny job initiation. New store-export work refuses derived lineage rather than creating an escape. The admin-token discovery change accepts only the mechanically expected token path from a trusted readiness descriptor and reads only an owner-only regular file (`src/cli.rs:6589-6630`); it discovers an already minted fork-local credential and does not widen runtime authority.

The real-VM integration `instance_fork_vm_egress_v1` passed, confirming JavaScript actions still cannot fetch or stream through the actual VM on a fork. This remains host-mediated registered-connection isolation, not a claim of process or OS containment, consistent with LLP 0165.

### Finite TTL and non-promotability

Finite expiry stamping, boot refusal at expiry, renewal ceilings, and the explicitly non-promotable lineage write remain intact. The fleet delta does not introduce a path that clears the TTL or promotes a derived deployment. The 52 focused `instance_fork::tests` and 38 focused `fork_promotion::tests` include the expiry, renewal, strict class, and promotion-refusal matrices and all passed.

### First-writer-wins identity

The round-2 repair remains semantically unchanged. `install_app_root_identity_sync` writes and syncs a unique temporary file, attempts a no-replace hard link, and makes a losing writer compare the already-published complete bytes (`src/instance_fork.rs:1396-1450`). The concurrent same-identity and conflicting-first-writer tests remain present and passed. I found no return to replace/last-writer-wins behavior before mint or launch.

### Atomic evidence and publication

The S0-S5 publication sequence remains ordered: staging sentinel, cloned/scrubbed state, durable mint evidence and private assets, registry intent, atomic directory rename, parent sync, registry finalization, then sentinel removal. Commit `a646bb71a` wraps publication in a result boundary and removes the staging directory on ordinary errors while preserving injected crash cuts (`src/instance_fork.rs:4631-4752`). This closes credential-bearing staging residue without erasing crash-recovery evidence. A new asset-copy failure test exercises that cleanup. It does not turn any partial state into a successful publication.

### Exact reap/drop

The derived-fork registry/path validation and exact drop protocol remain unchanged. The semantic reap change is in managed in-app branch custody: an expired row is selected from canonical custody, transitioned `active -> tearing_down` with an exact one-row check, and only the deterministic `managed_workspace_files` set is removed before `dropped` is recorded (`src/fork_promotion.rs:840-885,925-987`). Failure to reopen or inspect a damaged expired workspace now falls back to a custody-derived non-promotable receipt instead of aborting the entire sweep. The new damaged-plus-healthy test confirms both exact file sets are removed and both custody rows become dropped (`:6161-6195`). This is self-healing within the same bounded deletion authority, not a broadened recursive delete.

### Directory-mode change

The `a646bb71a` directory-mode change applies to ordinary startup when the reserved target instance directory is absent. On Apple/Linux it uses descriptor-relative `mkdirat(..., 0700)`, pins the directory with no-follow semantics, enforces effective-UID ownership and exact `0700`, syncs the parent, and removes only the just-created matching directory if validation fails (`src/instance_lock.rs:554-624`). It is adjacent hardening; it neither bypasses fork staging/rename nor alters fork authority. Its focused owner-only test passed.

## 3. Survival of rounds 1-3 closures

1. **Round-1 finding 1 — receipt-chosen scope:** Still closed. The checker owns the exact canonical scope; derived-fork v3 receipt scope must canonically equal it. The recomputed digest matches C, and the full 97-test checker matrix passed, including noncanonical-scope refusals.
2. **Round-1 finding 2 — ambient selection policy:** Closed by the C-bound content pin described above. Both receipt and current named-author acceptance must bind the exact digest; post-C bytes are irrelevant; a wrong pin refuses.
3. **Round-1 finding 3 — last-writer-wins app identity:** Still closed. The no-replace first-writer protocol and concurrent conflict tests survive the fleet delta.
4. **Round-2 finding 4 — reused/backdated acceptance locator:** Still closed. The v3 dated-locator and freshness rules remain enforced, now with the policy digest added to the exact acceptance shape. All 13 historical evidence-chain files named by the checker are byte-identical between round-3 C `03f9d147c` and final C. The full checker suite's historical-locator, add-only, and fresh-current-acceptance cases passed.

No prior closure depends on ambient `HEAD` policy bytes or on accepting a rewritten historical evidence file.

## Verification record

- Candidate identity: exact C confirmed.
- Scoped v3 digest recomputation: exact expected digest.
- Direct policy attacks: working-tree evolution ignored; bad pin refused.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: 97 passed, 0 failed.
- `node scripts/check-agent-safe-publication.mjs`: passed; both capability records remain withheld pending an actual qualification publication.
- `cargo test --lib instance_fork::tests:: -- --nocapture`: 52 passed, 0 failed.
- `cargo test --lib fork_promotion::tests:: -- --nocapture`: 38 passed, 0 failed.
- `cargo test --test instance_fork_vm_egress_v1 -- --nocapture`: 1 passed, 0 failed.
- `cargo test --lib cli::tests::minted_token_discovery -- --nocapture`: 4 passed, 0 failed.
- `cargo test --lib instance_lock::tests::startup_creates_reserved_target_instance_owner_only -- --nocapture`: 1 passed, 0 failed.
- `rustfmt --edition 2024 --check` on `instance_fork.rs`, `fork_promotion.rs`, `cli.rs`, and `instance_lock.rs`: passed.
- Scoped `git diff --check dcdcdc4be..C`: passed.
- `./ref-check --verbose`: 203 LLP documents, 4,060 refs in 10,457 files, 0 errors, 0 unchecked.

The repository-wide `cargo fmt --all --check` is not globally green: it reports formatting drift in other fleet-touched root files and also traverses the pre-existing dirty `vendor/ibex` checkout. The four fork-sensitive Rust files above pass a direct Rust 2024 formatter check, and the scoped textual diff check is clean. I treat the broader formatter result as nonblocking repository hygiene, not a derived-fork claim-invariant failure.

Per the review assignment, I did not duplicate the supervisor's exact-C live suites or benchmark runs. This verdict covers the static delta, checker attacks, and local non-live/focused runtime tests; the supervisor retains custody of those live/platform measurements.

The Snapback worktree began and ended with only the pre-existing `vendor/ibex` submodule modification. I did not modify a Snapback repository file, commit, or push.

READY
# Codex-family closing delta review — derived-fork requalification true C

## Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex
- **Date:** 2026-08-09
- **Redacted:** no
- **Method:** independent delta/source review, independent v3 digest reconstruction,
  control-flow and trust-boundary audit, complete checker execution, and focused
  adversarial fixture replay
- **Prior Codex head:** READY at
  `772c00649534d68b2ba63b98699e8ce2b2019057`
- **Candidate C:**
  `7b590a169b75839847c4755bbf0d4e7ae053cadd`
- **Scoped v3 digest:**
  `sha256:15db39c790471a1f0d6afcb447dd008662a0232cff3b1042e254fa798df75128`
- **Digest contract:** `snapback:agent-safe-implementation-tree:v3`
- **Independence:** I consulted only my four named prior Codex review heads. I
  did not consult another concurrent review. This session did not author the
  candidate changes.

## Overall assessment

I found no blocking regression in `772c00649..7b590a169`. The candidate
implements the 2026-08-09 LLP 0189 D-3 clarification at the exact intended
boundary: only an already-published derived-fork record may turn post-C scoped
source evolution into a typed `requalificationDue` state. A qualification-C
digest mismatch, noncanonical scope, receipt/carrier/anchor inconsistency,
evidence mismatch, historical review-byte rewrite, named-author mismatch, or
non-ancestor C still refuses. Withheld records and the storage claim do not
receive the exception.

The 26-commit total delta contains eight ordinary commits that touch the v3
scope and the final D-3 commit. The ordinary changes rotate the scoped digest,
as they should, but do not weaken the narrow derived-fork invariants. Candidate
C is ready for the remaining qualification evidence and publication steps;
this review is not itself a platform receipt, named-author acceptance, or
publication action.

## 1. Independent candidate and digest verification

The checked-out detached `HEAD` is exactly candidate C. I independently
reconstructed the v3 preimage rather than relying only on the checker export:

1. enumerated the committed `src/` tree and the seven explicit scope files;
2. removed the six exact publication-cycle leaves admitted by the checker;
3. sorted the remaining 198 entries by repository-relative path;
4. hashed the v3 domain line, exact canonical scope JSON, and each entry's
   mode, type, path, big-endian byte length, and committed blob/gitlink bytes.

That reconstruction produced
`sha256:15db39c790471a1f0d6afcb447dd008662a0232cff3b1042e254fa798df75128`.
The production `implementationDigestAt` function independently returned the
same value.

## 2. D-3 due-state trust boundary

### Exactly scoped leniency

`evaluateClaimSnapshot` creates `requalificationDue` only when the caller
explicitly sets `allowRequalificationDue` and the C-to-P diff contains at least
one claim-scoped change (`scripts/check-agent-safe-publication.mjs:676`).
`validatePublicationRecord` supplies that flag only for capability id
`agent_safe_derived_deployment_fork_v1`, and only after the anchor has been
validated as `published`; the withheld branch returns before snapshot/digest
evaluation (`:2272`, `:2347`, `:2353`). The storage record therefore retains
strict generic custody.

The resulting record remains `state: published`, its snapshot remains
`state: stands`, and both carry the exact typed payload
`{ scopedChanges, since: qualificationCommit }`. The CLI emits the exact
`PUBLISHED_REQUALIFICATION_DUE` warning on stderr while retaining a successful
exit (`:2496`).

### Qualification identity cannot rotate to P

`assertQualifiedImplementationDigestAtPublication` still requires the digest
recomputed at C to equal the receipt unconditionally (`:1081`). It relaxes
only the publication-P digest comparison, and only when the same C-to-P tree
diff produced a nonempty due state. A receipt rotated to P cannot pass by
claiming the newer digest, because the independent C comparison fails first.
Mode-only changes, symlink/type swaps, additions/deletions, and the Ibex
gitlink all appear in the scoped name-status set and remain visible.

### Frozen-chain failures are not masked

The production validation order remains fail-closed:

1. canonical anchor/carrier/receipt parsing and exact shapes;
2. anchor-to-carrier and carrier-to-receipt SHA-256 bindings;
3. exact candidate, component, v3 digest-version, canonical scope, and
   selection-policy bindings;
4. every receipt evidence byte digest;
5. C ancestry;
6. qualification-C digest, followed by the narrowly relaxed P comparison;
7. the complete platform/bounds/review/named-author semantic validation
   (`validatePublishedEvidenceSemantics` is still called unconditionally at
   `:2355`).

Thus a pending due state cannot bypass a chain failure that occurs before it,
and cannot short-circuit the semantic checks that follow it. The fully rebound
historical-prose fixture remains important: even after review, verdict,
acceptance, receipt, carrier, and anchor hashes are recomputed consistently,
the per-round frozen-byte digest catches the rewrite. The new pending-due
fixture separately proves direct historical evidence tampering still fails.

The checker does not itself implement the scheduled ticket filer or four-run
aging/escalation mechanism. LLP 0189's implementation ticket continues to
track that repository-wide battery automation as open. I do not treat that as
a defect in this candidate's narrower author-ruled contract, which is the
typed visible state plus conspicuous warning consumed by that automation.

## 3. Ordinary scoped fleet delta

The eight pre-fix scoped commits are ownership/refactoring work:

- storage, server, and local god-file splits move implementations and tests
  into submodules; the relation-activity and sequence-allocation JSON records
  refresh their exact source inventories for the storage split;
- the asset-finalization prepare/commit seam moves database-free preparation
  into `src/assets.rs` without changing the fork asset-copy authority or the
  derived fork publication protocol;
- the contract/type leaf moves dependency-free manifest DTOs without changing
  their serde/wire shapes;
- the realtime leaf moves fan-out state and stats without changing fork
  runtime authority;
- the `src/lib.rs` visibility tightening leaves `instance_fork` and
  `fork_promotion` public as before and only demotes unrelated internal façade
  modules;
- the CLI split moves the fork command implementation to `src/cli/fork.rs`.
  Comparing the complete old `fn fork_root` through pre-next-function region
  against the new module, after normalizing only the deliberate `pub(crate)`
  re-exports, was byte-identical except for one leading blank line.

No ordinary commit in this range changes `src/instance_fork.rs`,
`src/fork_promotion.rs`, or `src/instance_lock.rs`. I found no change to
deny-all host-operation classification, finite TTL/renewal ceilings,
non-promotable lineage, first-writer-wins app identity, host-mediated
isolation, atomic publication ordering, or exact reap/drop authority.

## Verification record

- Candidate identity: exact C confirmed.
- Independent 198-entry v3 digest reconstruction: exact expected digest.
- Production digest recomputation: same exact digest.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **99 passed, 0
  failed**.
- Focused boundary matrix: **10 passed, 0 failed**. It covered published
  one-byte scoped evolution becoming due; historical evidence tamper while
  due; withheld behavior; withheld anchor authority smuggling; noncanonical
  receipt scope; named-author scope mismatch; historical-acceptance locator
  reuse; invalid/uppercase/sibling ancestry; receipt rotation to P; and the
  generic strict C-receipt/P-drift case.
- `node scripts/check-agent-safe-publication.mjs`: clean exit; both current
  live records correctly remain `withheld` before the fresh publication
  ceremony.
- JS syntax checks for checker and fixture: passed.
- Exact D-3 commit `git diff --check`: passed.
- Full `772c00649..C` `git diff --check` reports unrelated fleet whitespace
  and blank-at-EOF findings; none is in the D-3 patch or changes a fork claim
  invariant.
- The repository worktree remained clean. I modified no repository file and
  did not push.

READY
# Codex-family delta review — derived-fork publication C sibling-chain decoupling

## Provenance and scope

- **Reviewer family:** Codex
- **Date:** 2026-08-09
- **Prior Codex closing head:** READY at
  `7b590a169b75839847c4755bbf0d4e7ae053cadd`
- **Publication C / reviewed HEAD:**
  `866f5d025645ce20a9149d8ea20032bd2f31c9b0`
- **Target delta:** `866f5d025` (`fix(publication): decouple fork from
  sibling carriers`)
- **Complete ancestry range inspected:** `7b590a169..866f5d025` (32 commits,
  including 6 merges)
- **Scoped v3 digest:**
  `sha256:98aa92d6651e405fda750d84bd510c4db6fcccd29213b13bb0436607a39a06d0`
- **Method:** prior-chain review, commit/path census, source and control-flow
  review, independent digest reconstruction, checker and sibling-gate
  execution, direct carrier-tamper probes, and a disposable-repository
  coverage-removal attack.
- **Independence:** I read only the five prior Codex requalification artifacts
  named by the dispatch. I did not open or consult the other-family review.
  This session made no repository change and did not push.

## Overall assessment

The narrow code split itself is correctly placed. The storage publication
record still receives the exact qualification-C local-store transform check;
the derived-fork record alone stops borrowing that transform. The four sibling
paths are made visible as typed `requalificationDue` evolution, and the fork's
own anchor, carrier, receipt, evidence, canonical scope, qualification-C
digest, named-author acceptance, review-history, and ancestry checks are not
relaxed. The full checker suite and all three sibling conformance suites pass.

One blocking custody defect remains. The implementation says integrity moves
to four registered LLP 0175 gates, but the fork checker does not mechanically
admit or preserve any of those four registrations. Its C-bound policy validator
still checks only the earlier nine wave-leaf transfers. A policy that removes
all four newly named sibling gates remains valid and is accepted by
`validateDerivedForkCoverageTransfers`; after that removal, relation and
sequence carrier changes no longer select their owning drift gates. Because
post-C policy evolution is intentionally outside the fork scope and sibling
carrier evolution intentionally leaves the fork published with
`requalificationDue`, this creates the requested route for a tampered sibling
carrier to persist under a published fork claim without its transferred gate
running.

## Blocking finding

### High — the four sibling-gate custody transfers are prose-only, so coverage can vanish

The target commit adds `DERIVED_FORK_SIBLING_CHAIN_PATHS` and passes it to the
two snapshot/digest evaluations only for
`agent_safe_derived_deployment_fork_v1`. It also replaces the unconditional
local-store transform call with `validatePublishedResultCustody`, which calls
that transform only for `agent_safe_storage_v1`. Those are the intended D-4
state and storage boundaries.

The claimed replacement custody is not closed, however:

1. `DERIVED_FORK_ADMITTED_COVERAGE_GATES` contains only the four pre-existing
   wave-transfer gate definitions: `agent-safe-publication-fixtures`,
   `ci-workflow-fixtures`, `client-bundle-metrology`, and
   `local-proof-inventory`.
2. `DERIVED_FORK_COVERAGE_TRANSFERS` contains only the prior nine departed
   leaves. None of the four sibling-chain paths or newly named gate ids is
   represented.
3. `validateDerivedForkCoverageTransfers` reads the selection policy at C and
   calls `assertCoverageTransfers` only for those nine old transfers. It never
   requires `local-store-publication`, `local-store-carrier-receipt`,
   `relation-activity-publication`, or `sequence-allocation-publication` to
   exist, retain their exact record/trigger/regeneration definitions, or cover
   the four sibling paths.
4. The selection policy is deliberately outside
   `DERIVED_FORK_IMPLEMENTATION_SCOPE`; its old transfer meaning is content-
   pinned at C. The earlier checker suite explicitly proves that a different
   post-C policy is ignored by the standing fork claim. That is safe for the
   nine mechanically admitted gates, but not for these four unadmitted ones.

I re-attempted the attack in two stages.

First, against the actual policy, selection is correct:

| Changed path | Current selected drift custody |
| --- | --- |
| `src/local-persistent-store-publication.anchor.v1.json` | `guide`, `local-store-publication` |
| `src/local-persistent-store-publication.v1.json` | `guide`, `local-store-publication` |
| `src/local-relation-activity-publication.v1.json` | `guide`, `relation-activity-publication` |
| `src/local-sequence-allocation-publication.v1.json` | `guide`, `sequence-allocation-publication` |

Direct structural tampering of the relation and sequence carriers was refused
by their current gates. The complete checker suite's new local-store probe also
proved that a carrier-only structural edit selects and fails
`local-store-publication`. Thus the current records are green and the current
registrations work.

Second, I cloned C into a disposable repository and removed the four sibling
entries from `driftProneGates` and `driftFailClosedCoreGates`, without changing
the target repository. The resulting policy passed `validateSelectionPolicy`.
Calling `validateDerivedForkCoverageTransfers` with that commit and the exact
SHA-256 of its weakened policy returned all 9 old transfers successfully; the
weakened qualification commit was
`a8abf380d5f50674ad03e26eaa82558199fcd8e2`. In the same valid weakened
selection context, each sibling path selected only the unrelated `guide` drift
gate; the relation and sequence publication gates were absent.

This is not merely a hypothetical future-C issue. Starting from a correctly
published current C, a later coherent policy edit can remove or weaken these
four registrations without changing the fork snapshot, because policy
evolution is out of scope and the checker continues to validate C's policy.
A subsequent relation/sequence carrier tamper is then accepted by the new
derived-fork rule as visible `requalificationDue`, while the current selector
does not run the carrier's transferred gate. The due warning makes the source
change visible, but it does not supply the integrity custody LLP 0189 D-4 says
must never vanish.

Required resolution:

- Add an exact, in-checker admitted-custody definition for all four sibling
  gates, including record paths, carrier/anchor triggers, and regeneration
  commands.
- Validate the custody rows that are authoritative for the publication being
  checked. A post-C deletion, weakening, or trigger removal must not remain an
  irrelevant policy edit; it must either refuse or name an exact replacement
  gate in the same change.
- Add negatives for each of the four paths covering gate deletion, trigger
  removal/remapping, record substitution, and regeneration-command
  substitution, including the two-step sequence “post-C policy weakening,
  then carrier tamper.”
- Preserve the current D-4 state boundary: legitimate carrier regeneration may
  remain typed `requalificationDue`, but only while its mechanically validated
  current custody gate exists.

## Storage-record path and fork-chain bindings

The storage-record path is behaviorally unchanged. Before this delta,
`runChecker` called `validateLocalStorePublicationTransform(root,
result.commit)` for each published result. After this delta it calls
`validatePublishedResultCustody`; for a published `agent_safe_storage_v1`
result that function calls the same transform with the same `result.commit`.
The transform code itself is byte-identical. Its positive digest-only transform
fixture and both carrier/anchor extra-edit negatives passed in the 101-test
suite.

The derived-fork chain remains fail-closed at the same points:

- canonical anchor/carrier/receipt parsing and exact shapes;
- anchor-to-carrier and carrier-to-receipt digests;
- exact candidate facts, components, v3 digest version, and canonical scope;
- qualification-C selection-policy pin for the original nine transfers;
- every evidence byte digest;
- C ancestry;
- unconditional qualification-C implementation digest equality;
- platform, bounds, review-history, and named-author semantics.

`validatePublishedEvidenceSemantics` remains unconditional after snapshot and
digest evaluation. The target patch does not edit any of those validators.
The 101-test suite reran the noncanonical-scope, evidence tamper, historical
rewrite, review-chain, acceptance, wrong/nonexistent/sibling ancestry,
receipt-rotation, mode/type, gitlink, and withheld-authority negatives; all
passed.

## Fleet commit enumeration and review

The range contains 32 commits. I enumerated all of them so ancestry presence is
not confused with claim relevance.

### Scoped non-merge fleet commits

1. `5f7e262aa9` — route parity, server/schema error envelopes (`build.rs`,
   server/admin/schema-export sources). No fork runtime or chain change.
2. `8e369eaed6` — native CLI machine mode (`src/cli.rs`, `src/main.rs`). No
   change survives in `src/cli/fork.rs`; the fork command is byte-identical to
   the prior reviewed head.
3. `682441b93f` — control catalog, host-op, and auth refusal acquisition paths.
   No derived host-operation classifier or fork isolation change.
4. `a827683d24` — diagnostics registry and exact-code lookup. It evolves the
   fleet selection policy only for diagnostics; it does not alter the four
   current sibling registrations.
5. `591e7af32b` — MCP-control funnel changes in CLI/guide/server code. No fork
   lifecycle or publication-chain change.
6. `8489bdf1c0` — CLI/schema integration repairs. No fork-specific semantic
   delta.
7. `256e7404d5` — CLI review fixes plus `generation_activation`, `lib`, and
   `local` maintenance. The only fork-adjacent net CLI line is import ordering;
   no fork behavior changes.
8. `b4aa0c498d` — restores an LLP 0199 `@ref` after module ordering; comment
   only.
9. `fdb0d9b04c` — regenerates all four sibling carrier/anchor files after the
   god-file split and updates their manifest/test digest mirrors. This is the
   motivating structural regeneration; no behavior source changes in the
   commit. The three requested conformance suites are green at final C.
10. `d9f3d40468` — extracts the jobs/cron storage kernel façade and regenerates
    the same four carriers. The moved jobs bodies do not touch instance-fork
    egress, TTL, non-promotability, identity, publication ordering, or exact
    reap/drop authority. Final carrier source hashes and mirrors agree under
    all three conformance gates.

### Merge commits

- `6314d0b1b1` — reintegrates the LLP 0199 god-file split.
- `f2a6682804` — absorbs contract-types leaf and embedding visibility work.
- `ac6a07ca39` — absorbs the realtime boundary.
- `27cd852e44` — absorbs the already-reviewed derived-fork review artifacts.
- `f6c87d299b` — reintegrates the `cli.rs` split.
- `5d08a7a4cb` — absorbs the upstream carrier fix-forward.

I inspected the combined critical-path diffs for all six. None has a combined
diff in `src/instance_fork.rs`, `src/fork_promotion.rs`, `src/instance_lock.rs`,
`src/cli/fork.rs`, the fork publication checker, or the sibling conformance
gates. The final tree is exactly unchanged from `7b590a169` for the four fork
runtime/lifecycle paths. `src/manifest.rs` has no added/removed AgentSafe or
derived-fork definition in the range; its relevant changes are the regenerated
sibling mirrors and jobs/types work.

### Out-of-scope/support commits

The remaining commits are `1cebcc51e2`, `35fc38e21b`, `2b12652c03`,
`b76b72dd90`, `fce72f0819`, `8a82fc9275`, `fff7652231`, `5674a60266`,
`d9f44dec55`, `c1177e8dca`, `340eaba743`, `510689ec14`, `daffecfb9b`,
`7e1b2dd79a`, and `5df8206928`. They contain repository tooling, package/guide
metadata, generated projections, acceptance-path repair, retained reviews,
issue/LLP documentation, and Cloudflare deployment-identity refreshes. None
changes the derived-fork v3 implementation scope or the target checker logic.

The target commit `866f5d025` is reviewed separately above and is the only
commit in the range that edits `scripts/check-agent-safe-publication.mjs`.

## Digest and verification record

- Independent v3 reconstruction over 199 committed entries produced
  `sha256:98aa92d6651e405fda750d84bd510c4db6fcccd29213b13bb0436607a39a06d0`.
- Production `implementationDigestAt` produced the same value.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **101 passed, 0
  failed**.
- `node scripts/check-agent-safe-publication.mjs`: clean exit;
  `agent_safe_storage_v1:withheld` and
  `agent_safe_derived_deployment_fork_v1:withheld`.
- `node tests/conformance/local-persistent-store-publication-v1.mjs`: passed;
  published, `17 PASS / 0 GAP`, Triage `8/8`, Fleet `8/8`, carrier
  `sha256:12948f3b8d7af14ff271026b369484a0bc5c377cb0cec1e950b7bc4ef676e7c5`.
- `node tests/conformance/relation-activity-publication-v1.mjs`: passed;
  carrier
  `sha256:18ff723a6d443615e55396f01dfa86e3d35f4f9024127013a0d8afcbd50de77e`.
- `node tests/conformance/sequence-allocation-publication-v1.mjs`: passed;
  10 qualified cases, carrier
  `sha256:3beb4f1fe134c79f043d6aa3e8e4b1f33a20be8811645c553a2a0ca17e8ac315`.
- Direct disposable structural-tamper probes for relation and sequence: both
  gates refused with nonzero status. The checker suite's corresponding
  local-store tamper probe also refused.
- Weakened-policy attack: `validateSelectionPolicy` passed, while
  `validateDerivedForkCoverageTransfers` unexpectedly accepted all 9 old
  transfers after all four sibling registrations were removed.
- `git diff --check 7b590a169..866f5d025`: passed.
- `./ref-check --verbose`: 207 LLP documents, 4,802 refs in 11,354 files, 0
  errors, 0 unchecked.
- Final target worktree status: clean detached HEAD. No repository file was
  modified and no push was performed.

NOT READY
# Codex-family one-commit delta review — sibling-custody closure at publication C

## Provenance and scope

- **Reviewer family:** Codex
- **Date:** 2026-08-09
- **Prior Codex NOT READY head:**
  `866f5d025645ce20a9149d8ea20032bd2f31c9b0`
- **Candidate C / reviewed HEAD:**
  `04332ab8b73799bd3279b3150dbd8598df275530`
- **Target delta:** `04332ab8b` (`fix(publication): bind sibling custody
  transfers`)
- **Complete intervening range inspected:** `866f5d025..04332ab8b` (8
  commits, 0 merges)
- **Scoped v3 digest:**
  `sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`
- **Method:** prior-finding replay, one-commit source/control-flow review,
  complete intervening commit/path census, independent scoped-digest
  reconstruction, exact registry-definition review, checker and sibling-gate
  execution, and independent disposable-repository policy attacks.
- **Independence:** I consulted only my own prior Codex review at the path in
  the dispatch. I did not open or consult any other review. The review-only
  commit in the intervening range was enumerated by commit and path only. This
  session made no repository change and did not push.

## Overall assessment

The blocking custody defect is closed. Candidate C admits all four sibling
chain gates against exact definitions frozen in the claim-semantic checker,
requires every declared frozen-record blob to exist at C, and separately
requires each of the four sibling paths to match its mapped gate trigger. A
shape-valid C policy with the four registrations removed still passes the
generic selection-policy schema, but it now fails
`validateDerivedForkCoverageTransfers`; record-path, regeneration-command,
and mapped-trigger substitutions fail as well.

The closure preserves the intended LLP 0189 D-3/D-4 boundary. The four
sibling records remain visible as typed post-C `requalificationDue` evolution
instead of being re-bound to fork C. The storage publication retains its own
qualification-C transform. The fork anchor, carrier, receipt, evidence,
canonical scope, digest, acceptance, review-history, and ancestry checks are
unchanged. Integrity custody can no longer be removed from the C-bound policy
without the mechanically frozen transfer validator refusing.

The new real-HEAD positive supplies the current-policy half of the old
two-step attack. A change to
`scripts/local-proof-selection-policy.v1.json` classifies
`FAIL_CLOSED_FULL` and selects both `agent-safe-publication` and
`agent-safe-publication-fixtures`; therefore a post-C policy deletion reaches
the positive that validates that HEAD as C and fails before a later sibling
carrier change can inherit a green weakened policy. The four sibling paths
continue to select their owning gates under the real policy.

No blocking or material finding remains in this delta.

## Closure of the prior blocking finding

The implementation adds these exact claim-scoped authorities:

1. `DERIVED_FORK_SIBLING_CUSTODY_GATES` requires
   `local-store-publication`, `local-store-carrier-receipt`,
   `relation-activity-publication`, and
   `sequence-allocation-publication`.
2. `DERIVED_FORK_SIBLING_CUSTODY_TRANSFERS` maps the persistent-store carrier
   and anchor to `local-store-publication`, and maps the relation/activity and
   sequence-allocation carriers to their respective publication gates.
3. `DERIVED_FORK_ADMITTED_COVERAGE_GATES` freezes each gate's complete
   `records`, `recordPaths`, `triggerRules`, regeneration command, and optional
   dependency fields. Canonical equality rejects a prose stub or weakened
   substitute.
4. `admittedCoverageGateAtCommit` additionally proves every declared record
   path resolves to a regular committed blob at qualification C.
5. `assertSiblingChainCustodyTransfers` requires exact equality with the four
   sibling paths, checks mapped trigger coverage, and admits all four gate
   definitions before `validateDerivedForkCoverageTransfers` can return.
6. The validator still reads the exact policy bytes at C and verifies their
   SHA-256 binding before interpreting the registry.

The receipt-only `local-store-carrier-receipt` gate is correctly required as a
chain owner without being falsely mapped as the direct recomputing owner of
the persistent carrier or anchor. The direct mappings remain with
`local-store-publication`.

## Independent attack replay

I cloned C into a disposable local repository and constructed weakened C
commits with Git plumbing, without editing the target worktree. Each mutated
policy still passed `validateSelectionPolicy`, isolating the result to the new
claim-specific checks.

| Attack | Synthetic C | Result |
| --- | --- | --- |
| Delete all four sibling gates and remove them from the drift core | `9bba794322301939f937f5ee0a2f09956d07e5ee` | Refused: persistent-store carrier is not covered by `local-store-publication` |
| Substitute the relation gate's record-path set | `78b0340472a603d432283ccb850f8925bc6d471e` | Refused: relation gate does not retain its exact registered definition |
| Substitute the sequence gate's regeneration command | `7c32db75a5095e78ddacfd13da4b49be5baa9c49` | Refused: sequence gate does not retain its exact registered definition |
| Remove the persistent-store anchor trigger | `6138c1b2cb86685b710f1e78cccdd7ed552b7b55` | Refused: anchor is not covered by `local-store-publication` |

For the all-gates deletion, selecting the policy file itself produced
`FAIL_CLOSED_FULL` and included both agent-safe checker gates. Thus the
real-HEAD positive is not an inert test: the policy change's declared affected
selection reaches it, and the same independent refusal above is its result.

The requested direct attack therefore changed from the prior unexpected
acceptance to a hard refusal.

## One-commit code and test review

The target changes only the implementation ticket, the publication checker,
and its test corpus. The admission helper is shared with the original nine
departing-leaf transfers, so the sibling closure and the earlier wave-transfer
closure now use one exact-definition-and-record-existence predicate. The
sibling check intentionally omits the original transfer rule that a path must
leave the implementation scope: these four paths remain scoped evolution, as
LLP 0189 requires.

The added negatives cover deletion of each required gate and trigger removal
for each mapped sibling path. The new real-HEAD test validates the complete
current policy at the actual C. The fixture copies every sibling gate's record
paths into its synthetic qualification repository, preventing the positive
from succeeding merely because record existence was never exercised. Existing
exact-definition tests continue to cover record, trigger, and regeneration
substitutions for the shared admission predicate; the independent attacks
above exercise those substitutions against sibling gates specifically.

No fork publication-chain validator was relaxed. The only return-value change
in `validateDerivedForkCoverageTransfers` is local: it retains the public
nine-transfer return while requiring sibling custody as a side condition.

## Intervening fleet commit enumeration and review

I enumerated every commit in `866f5d025..04332ab8b` so ancestry presence is
not confused with claim relevance.

1. `f940bc62a` — LLP/issue documentation for the withdrawn 0207 program and
   owner follow-ups. Outside the derived-fork D-4 scope.
2. `96d50a742` — the only other commit that changes the derived-fork scoped
   source tree. It moves asset publication maintenance, GC, and runner
   transaction bodies from `src/local.rs` into the typed
   `src/storage/asset_maintenance.rs` kernel, adds the façade in
   `src/storage.rs`, and refreshes the four sibling carriers plus their
   manifest/conformance digest mirrors. It does not change
   `src/instance_fork.rs`, `src/fork_promotion.rs`, `src/instance_lock.rs`, or
   `src/cli/fork.rs`. The `src/manifest.rs` diff is confined to refreshed
   sibling carrier/source hashes. All three affected publication conformance
   gates pass at final C.
3. `2d6701196` — filesystem issue for the pre-existing asset-store environment
   race. Documentation only and outside scope.
4. `49c2ad3a` — ownership manifest/baseline assignment. Outside the exact
   derived-fork scope.
5. `147f4e2d4` — ownership-ratchet filesystem issue. Documentation only and
   outside scope.
6. `4050dc8da` — retained review artifacts only. Enumerated from commit/path
   metadata; no review body was opened or consulted, per the dispatch.
7. `9d83959b6` — authored-symbol lifecycle facts, generated reference material,
   and publish-tooling enforcement. It does not touch `src`, the derived-fork
   checker, the scoped generated-artifact policy, Cargo/build inputs, or the
   Ibex gitlink, so it is outside this claim's exact D-4 digest.
8. `04332ab8b` — the sibling-custody closure reviewed above. Its checker edit
   is claim-semantic and is included in the recomputed v3 digest.

There are no merge commits in the range. The final tree has no change from the
prior NOT READY head in the four critical fork runtime/lifecycle paths named
above.

## Digest and verification record

- Independent reconstruction over 200 committed scoped entries produced
  `sha256:42d8fdccbe42ed3699da014f1c3ec68aa8fd05ca99de423310b6a6885190708f`.
- Production `implementationDigestAt` produced the same value.
- Qualification-C selection-policy bytes hash to
  `sha256:9221291f95c690d455be3240b342010216b7e1b470cf21aba53104408a3f9075`.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **104 passed, 0
  failed**, including all new custody cases.
- `node scripts/check-agent-safe-publication.mjs`: clean exit;
  `agent_safe_storage_v1:withheld` and
  `agent_safe_derived_deployment_fork_v1:withheld`.
- `node tests/conformance/local-persistent-store-publication-v1.mjs`: passed;
  published, `17 PASS / 0 GAP`, Triage `8/8`, Fleet `8/8`, carrier
  `sha256:827f04914e509bca758b08e6762ad061b0d814f01ceed10933f25f7f113818db`.
- `node tests/conformance/relation-activity-publication-v1.mjs`: passed;
  carrier
  `sha256:4a5084411c2f2c5f03bcdc50757ffe5c4cf94f4816a844b6634b41020df1b8a9`.
- `node tests/conformance/sequence-allocation-publication-v1.mjs`: passed; 10
  qualified cases, carrier
  `sha256:46b0fa02b2b10239028db3b043584d9b05e1fc4070ebc9fe485463616ff88470`.
- `./ref-check --verbose`: 208 LLP documents, 4,810 refs in 11,365 files, 0
  errors, 0 unchecked.
- `git diff --check 866f5d025..04332ab8b`: passed.
- Final target worktree status: clean detached HEAD exactly at candidate C.
  No repository file was modified and no push was performed.

READY
