# Independent implementation/security review: local derived-instance forks

## Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Redacted:** no
- **Method:** Fresh clean-context session; read-only worktree pinned at commit `7c2a27e0e90cf1d19b57825a187cb3be041ab92f`; mutually blind. I did not seek out or read another review. I verified claims against code and tests, inspected the dual-platform lifecycle receipts, and used a temporary database outside the worktree to check SQLite `writable_schema` behavior. I did not run Rust tests because the read-only `scripts/ibex-doctor` reported `vendor/ibex` uninitialized and the required bootstrap would mutate worktree state.

## Overall assessment

**Overall verdict: NOT READY for publication of the narrow local `operating.instance-forks` claim.**

The landed surface has strong, concrete safety work: consistent-copy publication, broad credential scrubbing/minting, real runtime DenyAll including Hermes, finite TTL/renewal, exact evidence-bound cleanup, fork-private asset custody with bidirectional GC tests, a pre-bind cold-start coverage cut, and useful fail-closed receipt checks. Those are credible foundations.

Publication is blocked by four implementation issues. Most seriously, lifecycle commands do not bind a registry selection back to the invoking app root, so an explicit shared `--fork-root` permits cross-app inspect/diff/renew/drop/reap selection—even for same-`appId` apps—contrary to LLP 0158 OQ9. The new completeness class also relies on a connection-local authorizer that admits schema-table/PRAGMA escape routes and does not control second writers. Finally, the diff receipts lack the canonical digest and stream-qualified boundaries needed to bind a review, and the advertised resource limits are not concurrency-atomic or actual bounds on net-diff work.

## Strengths

- **Publication and custody fail closed around unknown state.** The custody audit enumerates every `_snapback_*`/`_auth_*` table, refuses an unknown table, and refuses occupied incompatible subsystems before mint (`src/instance_fork.rs:650-686`). Scrub-and-mint rotates stream/signing authority, scrubs operation, session, grant, bearer, and promotion state in one transaction, and publishes non-promotable lineage only as quarantine is removed (`src/instance_fork.rs:1039-1231`).

- **Credential separation is broad and directly tested.** Fresh owner-only admin, auth, resume, and operation-detail sidecars are minted (`src/instance_fork.rs:1115-1150`), and the negative corpus checks absent parent sessions/agent credentials/grants, distinct sidecars/streams, rejected parent resume/search cursors, and invalid parent asset URLs (`src/instance_fork.rs:4268-4459`). The live CLI test also attempts each admin bearer against the opposite server and confirms fork writes remain absent from the parent (`tests/instance_fork_cli_v1.rs:977-1024`).

- **DenyAll reaches real handler VMs and fails future families closed.** Unknown host operations map to `unclassified_host_operation`, while local database/runtime ops remain admitted (`src/instance_fork.rs:1621-1649`). The Hermes test actually invokes `ctx.fetch` and `ctx.fetchStream`, requires the typed fork denial, checks the two durable payload-free markers, and verifies the parent never grows the marker table (`tests/instance_fork_vm_egress_v1.rs:103-164`). Provider, cron, jobs, telemetry, push-receipt, and asset egress have separate direct negatives rather than relying only on worker-disable flags (`src/instance_fork.rs:4462-4638`; `src/cli.rs:7861-7900`).

- **Asset custody evidence is unusually strong.** Metadata-named blobs are copied into the fork-private tree only after store/digest classification and content/length verification (`src/instance_fork.rs:3423-3526`). The live test proves parent URLs fail in the fork, copied/fork-uploaded assets serve from fork-private paths, fork GC cannot remove parent blobs, parent GC cannot remove fork blobs, and both drop and reap remove the exact fork tree (`tests/instance_fork_cli_v1.rs:1187-1363`).

- **TTL and cleanup are substantive, not metadata-only.** Boot refuses expired lineage; the serving process re-reads renewal state and exits at the live deadline (`src/instance_fork.rs:1265-1285`; `src/cli.rs:2767-2813`; `src/cli.rs:7913-7933`). Renewal refuses resurrection/shortening, caps total lifetime from creation, and crash-recovers three carriers through sentinel/intent state (`src/instance_fork.rs:2370-2548`). Cleanup rebinds registry, receipt, lineage, path, and ready evidence and serializes per-fork destructive operations with `flock` on the two supported release platforms (`src/instance_fork.rs:2079-2302`).

- **The new cold-start surface is conservative on its implemented dimensions.** The complete owner-only schema/function carrier is installed before launch; inherited admin environment authority is cleared; writer coverage arms before listener bind; mismatched/missing dual carriers refuse; partial layouts and retention gaps downgrade rather than upgrade (`src/cli.rs:3414-3514`; `src/cli.rs:7337-7371`; `src/cli.rs:7461-7490`; `src/instance_fork.rs:2812-2892`). The settled-Sessions app-id lookup correctly prefers the capability-aware schema slot over the poisoned legacy slot (`src/cli.rs:2816-2838`).

- **Parent behavior is intentionally kept dormant.** The writer authorizer is not installed without an active manifest, so ordinary databases retain their existing statement path (`src/storage/write_authority.rs:308-323`). The VM test contrasts the same fetch on the parent and proves it never receives the fork denial or marker table (`tests/instance_fork_vm_egress_v1.rs:141-164`).

## Concerns

### 1. Critical — lifecycle selection is not scoped to `(appId, instance identity)` or the recorded app root

LLP 0158 requires every multi-instance lookup/admin operation to be scoped by `(appId, instance identity)` (or an exactly resolving equivalent), says same `appId` is never sufficient, and specifically requires cross-selection/mutation negatives before publication (`llp/0158-instance-forking.rfc.md:1569-1597`). The implementation records `app_root` in each ready registry entry (`src/instance_fork.rs:1889-1923`) but never validates it in `managed_target`; that function accepts only `fork_root` and `fork_id` and binds local fork evidence, not the invoking app (`src/instance_fork.rs:2079-2225`).

The CLI permits an arbitrary explicit `--fork-root` independent of `app_root` (`src/cli.rs:2721-2727`). List/inspect/diff/drop/renew/reap then select every or one entry from that root and report the entry's own app id without comparing the canonical invoking app root; `list` even chooses the first entry's app id for a potentially mixed root (`src/cli.rs:3695-3753`; `src/cli.rs:3757-3866`; `src/cli.rs:3868-3947`). Therefore two worktrees/apps sharing an explicit root can inspect, diff, renew, stop, or delete each other's fork by id. This is an accidental cross-selection hazard within the cooperating local threat model, not merely the out-of-scope malicious-same-user case.

The live parent/fork mutation and cross-bearer test is valuable but does not exercise two same-`appId` app roots sharing a registry root (`tests/instance_fork_cli_v1.rs:894-1051`).

**Resolution:** require a canonical expected app root (and expected logical app id) in every registry bind; compare it with a mandatory receipt-bound/registry-bound app-root identity before inspect, diff, renew, stop, drop, reap, recover, and list projection; refuse legacy/missing or mixed-root ambiguity. Add a same-`appId`, two-app-root, shared-fork-root matrix proving schema/function loads, mutations, credentials, every lifecycle command, and cleanup cannot cross-select. Keep fork id/stream/endpoint as the distinct instance identity—do not use app id alone.

### 2. High — `authorizer-backed-app-rows-v1` is bypassable below the tested DML/DDL surface

The authorizer derives protected tables by name and allows every action except protected-table DML and a selected ordinary-DDL list (`src/storage/write_authority.rs:626-664`). It does not deny `PRAGMA writable_schema`, `ATTACH`/`DETACH`, or mutation of `sqlite_schema`; the connection configuration enables foreign keys, a busy timeout, and WAL, but not SQLite defensive mode (`src/storage.rs:7260-7270`). A protected table and its auto-index can consequently be renamed in `sqlite_schema`; after schema reload, the same B-tree is writable through a name absent from the manifest's `covered_tables` (`src/storage/write_authority.rs:338-345`; `src/storage/write_authority.rs:626-664`).

The enforcement is also connection-local. A production system-only vector path already opens a second write-capable connection without the authorizer, showing that the writer enum does not structurally prevent raw writable handles (`src/storage.rs:10725-10744`). The oracle rejects unjournaled raw changes and stale borrowed post-images, but a second connection that writes both the app row and a matching journal entry satisfies the implemented cross-check (`src/instance_fork.rs:2984-3046`; `src/instance_fork.rs:3126-3191`). Existing bypass tests cover direct DML, triggers, `ALTER TABLE`, unjournaled raw writes, and stale borrowed post-images—not schema aliasing or a matching-journal second writer (`src/storage.rs:26944-27050`; `src/instance_fork.rs:5781-5831`).

**Resolution:** deny unsupported authorizer actions by default while armed, enable/verify defensive mode, reject writable-schema and attach/detach operations, control every writable connection through one registry/lock, and add the full adversarial corpus (schema alias, ATTACH, temp triggers/views, DDL, savepoints, second connection, matching journal forgery, direct WAL/file mutation). Downgrade the completeness spelling until those tests pass.

### 3. High — diff artifacts cannot bind an exact review and the older surface misleadingly implies attribution

The governing contract requires stream-qualified base/head identities, operation/principal attribution on the attributed surface, and a digest over the canonical emitted diff (`llp/0162-agent-safe-storage-profile.rfc.md:1192-1235`). `ForkDiffReceiptV1` has none of those fields; its `operation` is merely row-level insert/update/delete (`src/instance_fork.rs:746-769`; `src/instance_fork.rs:2748-2809`). `ForkNetDiffReceiptV2` honestly says `attribution: "absent-v1"` and names its substrate/domains, but it also lacks a data-stream boundary and receipt/diff digest (`src/instance_fork.rs:832-849`; `src/instance_fork.rs:3196-3220`). The base-file SHA-256 does not bind the emitted head, rows, omissions, or completeness (`src/instance_fork.rs:2939-2957`).

This prevents reviewers from retaining or approving an exact receipt as required by LLP 0185 Phase 4 and makes the guide's “attributed receipt” terminology imply evidence the schema does not carry (`llp/0185-instance-forking-productization.plan.md:418-430`; `guide/operating/instance-forks.md:315-320`).

**Resolution:** version both wire artifacts with explicit base/head stream-qualified identities and a canonical, domain-separated digest over all receipt facts. Add `attribution: "absent-v1"` to the journal sequence or stop naming it attributed; add real operation/principal joins only when LLP 0163 is actually wired.

### 4. High — resource admission is racy and net-diff “max rows” is not a bound on diff work

Creation reads registry count and total bytes, returns a usage observation, and only afterward publishes the fork; no root-wide admission reservation is held across that sequence (`src/instance_fork.rs:2591-2651`; `src/cli.rs:3371-3409`). Two concurrent creates with `--max-forks 1` can both observe zero and publish; the same check/use race exists for total bytes. The concurrency test proves three default-limit creates can coexist and bind distinct ports, but never races at a count/byte boundary (`tests/instance_fork_cli_v1.rs:1480-1566`).

For net diff, `max_rows` is checked only after the entire retained journal has been inserted into in-memory sets/maps and every base/head application table has been fully materialized into `BTreeMap`s (`src/instance_fork.rs:2984-3046`; `src/instance_fork.rs:3049-3114`; `src/instance_fork.rs:3224-3297`). A huge journal that folds to no net rows or a huge unchanged database can consume unbounded time/memory and still be under the final row count. The executable resource test covers only the older attributed journal count (`tests/instance_fork_cli_v1.rs:1897-1950`).

**Resolution:** add a root-wide atomic admission/reservation lock covering count/byte observation through registry intent/publication and test simultaneous boundary requests. For net diff, stream/merge rows in canonical order and enforce journal-row, scanned-row, byte, time, and output limits before materialization; prove oversized unchanged and revert-heavy inputs refuse deterministically without residue or process exhaustion.

### 5. Medium — the governing publication gates are not yet internally current

LLP 0185 Phase 6 requires LLP 0163/0164/0165 to complete their review/acceptance loop before publication (`llp/0185-instance-forking-productization.plan.md:463-481`); all three headers remain Draft (`llp/0163-operation-identity-and-commit-envelope.spec.md:1-4`; `llp/0164-fork-and-promotion.spec.md:1-4`; `llp/0165-proof-domains-and-checkpoints.spec.md:1-4`). LLP 0162 still says the Linux row-13 run remains outstanding and points to the unqualified receipt, while this commit has landed both platform-qualified receipts (`llp/0162-agent-safe-storage-profile.rfc.md:1857-1882`; `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json:1-82`; `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json:1-82`). The capability index correctly remains a GAP/target `none`, so there is no premature public claim yet (`guide/capabilities.md:90`).

**Resolution:** after the implementation blockers close, reconcile the spec/row-13 text, complete the required acceptance decisions, and run Phase 6 item 5's corpus/guide/package/release checks before changing the guide target.

## Suggestions

- Retain the current explicit local threat-model wording; it accurately distinguishes DataIsolated and HostEgressMediated from OS ProcessContained (`llp/0158-instance-forking.rfc.md:792-823`).
- Preserve the dual-carrier coverage refusal and partial-layout downgrade. Those are good fail-closed patterns even after the completeness class is narrowed or repaired (`src/instance_fork.rs:2812-2892`; `tests/instance_fork_cli_v1.rs:1969-2030`).
- Add a fork-only regression suite that runs the same parent operation before and after derived changes. The existing dormant-authorizer and VM-parent contrasts are good seeds (`src/storage/write_authority.rs:308-323`; `tests/instance_fork_vm_egress_v1.rs:141-164`).
- Add an explicit machine-readable `containmentTier` to status/receipts so `deny-all-v1` cannot be mistaken for an OS sandbox; the guide already explains the distinction (`guide/operating/instance-forks.md:323-337`).

## Open questions

1. Is a shared explicit `--fork-root` intended for multiple app roots/worktrees? The CLI supports it and the guide emphasizes fork-per-worktree/parallel suites, so the safe answer must be encoded rather than assumed (`src/cli.rs:2721-2727`; `guide/capabilities.md:90`).
2. Is the new completeness class intended to cover trusted Snapback-generated writes only, or all physical writes to the file during the interval? The current receipt name suggests the latter while the explanatory text narrows to one process-owned connection (`llp/0165-proof-domains-and-checkpoints.spec.md:374-391`).
3. Are macOS aarch64 and Linux x86_64 the complete supported release-platform set for the initial narrow claim? The receipts prove only those named environments (`tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json:1-82`; `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json:1-82`).

## Recommended next step

Keep `operating.instance-forks` at target `none`. First bind every lifecycle command to the recorded canonical app root plus fork instance identity; then repair or downgrade the SQLite completeness class, make diff receipts stream-qualified and digest-bound, and make count/byte/diff-work limits real under concurrency and large inputs. Add the adversarial matrices named above, run the target release suites on both supported platforms, reconcile LLP 0162/0163/0164/0165, and commission a fresh mutually blind implementation/security review before publication.

## Round 2 — 2026-08-06, commit 96fd0ad1c

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `96fd0ad1c38109aa524e4cbc39439c8982e18766`
- **Redacted:** no
- **Method:** Independent round-2 delta review. I read both families' committed round-1 reviews, as authorized, but did not read or seek another family's round-2 review. I compared the fix with its parent, verified implementation claims against LLP 0158/0163/0164/0165 and the instance-forks guide, inspected adversarial tests, ran selected committed tests in a disposable exact-revision clone, and constructed and ran one temporary exploit test there. I made no change to this pinned worktree except appending the two requested review sections.

### Overall verdict

**NOT READY for publication of the narrow local `operating.instance-forks` capability.** The lifecycle binding and receipt redesign are closed convincingly, and root-wide admission is atomic. The claimed `registered-connection-defensive-app-rows-v1` class can still be re-earned after an in-process registered-writer coverage gap, and one oversized scanned row can exceed the advertised byte-work bound before refusal.

Document-level fork-surface verdicts are: **LLP 0163 READY; LLP 0164 READY; LLP 0165 NOT READY.** LLP 0164's dated receipt-evolution record accurately describes the v3 artifacts and has no residual v3 drift (`llp/0164-derived-state-and-incremental-views.spec.md:489-513`). Its readiness does not override LLP 0165's failed completeness-class implementation.

### Round-1 blocker dispositions

1. **Cross-app lifecycle selection: closed.** Lifecycle targets now bind a digest-checked application identity derived from canonical app root and logical app id, validate it during registry lookup and against fork-local evidence, and refuse missing legacy binding (`src/instance_fork.rs:170-241`; `src/instance_fork.rs:1104-1289`; `src/instance_fork.rs:2521-2547`; `src/instance_fork.rs:2721-2749`). The CLI passes that expectation into every selector and filters foreign entries from list (`src/cli.rs:3727-3771`). The two-root, same-app-id, shared-fork-root matrix adversarially exercises list, inspect/admin token, diff, renew, drop, recover, credentials, writes, and reap (`tests/instance_fork_cli_v1.rs:542-745`), while the module test covers lower-level mutation and legacy refusal (`src/instance_fork.rs:6500-6583`).

2. **Authorizer and below-surface bypasses: partially closed.** Defensive mode plus default-deny authorization now covers writable-schema aliases, `ATTACH`/`DETACH`, temp DDL, virtual tables, savepoint/raw app DML, integrity tables, and unknown actions (`src/storage/write_authority.rs:338-421`; `src/storage/write_authority.rs:659-762`). Production secondary writers use the registered factory (`src/storage.rs:10709-10769`), and adversarial schema-alias/second-writer tests are non-vacuous (`src/storage.rs:27256-27460`). WAL/page corruption checks and the raw matching-journal test support the revised tamper-evident boundary (`src/instance_fork.rs:7361-7525`). The registered-manifest continuity attack below remains in scope and keeps this blocker open.

3. **Receipt identity, digest, and attribution: closed.** Both journal and net diff are distinct v3 artifacts carrying stream-qualified base/head boundaries and `attribution: "absent-v1"` (`src/instance_fork.rs:904-931`; `src/instance_fork.rs:994-1014`). Digests are JCS-canonical, exclude only `receiptDigest`, and use distinct domain strings (`src/instance_fork.rs:1124-1160`). Production refuses stream rotation when binding the current head (`src/instance_fork.rs:3273-3324`). Golden-hash, domain-separation, and every-top-level-fact mutations make the unit test substantive (`src/instance_fork.rs:6738-6845`), and the CLI acceptance assertions check the v3 identities and digest (`tests/instance_fork_cli_v1.rs:318-381`). LLP 0158's wire contract (`llp/0158-instance-forking.rfc.md:1272-1289`; `llp/0158-instance-forking.rfc.md:1320-1344`) and the guide (`guide/operating/instance-forks.md:289-332`) agree.

4. **Resource admission and net-diff bounds: partially closed.** Root-wide `flock` protects count and aggregate-byte admission through publication (`src/instance_fork.rs:3198-3240`; `src/cli.rs:3405-3441`). The simultaneous boundary test proves exactly one creator wins at both limits and only one registry entry appears (`src/instance_fork.rs:6586-6665`). Net diff counts scan/journal/output work and preflights journal bytes before map construction (`src/instance_fork.rs:3573-3643`; `src/instance_fork.rs:3740-3758`); unchanged, revert-heavy, and byte-heavy cases are adversarial (`src/instance_fork.rs:6978-7088`). The remaining row-scan problem is described below.

### New findings

#### High — registered coverage can disappear, admit an unarmed writer, and be restored

The armed callback grants direct DML to most `_snapback_*` system tables; its special integrity restriction covers only `_snapback_changes` and `_snapback_version` (`src/storage/write_authority.rs:663-672`; `src/storage/write_authority.rs:711-730`). The committed corpus explicitly demonstrates successful deletion of `_snapback_operation_coverage_v1` while coverage is armed (`src/storage.rs:27541-27599`). When the manifest is absent, `open_registered_system_writer_v1` loads `None`, and `WriterAuthorityV1::install` returns without enabling defensive mode or installing the callback (`src/storage.rs:10731-10763`; `src/storage/write_authority.rs:338-351`).

I reproduced the full exploit in a temporary test at the exact commit: through registered process connections, save/delete the manifest; open a second writer and observe defensive mode off; write an application row, `_snapback_version`, and a matching journal post-image; restore the exact manifest; run net diff. The verifier awarded `registered-connection-defensive-app-rows-v1`. This is not out-of-scope raw-file forgery: it is a gap in the precise registered process-writer class LLP 0165 says is continuously armed from fork point through head (`llp/0165-proof-domains-and-checkpoints.spec.md:380-393`). It also contradicts the guide's current class description (`guide/operating/instance-forks.md:345-353`).

Make the activation/coverage boundary monotonic within this class: deny arbitrary DML to manifest, stream, and activation carriers or mediate exact transitions, and have every registered factory fail closed when fork evidence says coverage should exist but the active manifest is absent or mismatched. Commit the delete → unarmed writer → matching forgery → restore exploit as a negative that must not regain the upgraded class.

#### Medium — base/head scan bytes are checked after full row expansion

Manifest rows are decoded into a complete document and serialized into another allocation before `observe_scan` checks the budget (`src/instance_fork.rs:4040-4066`). Generic rows likewise expand blobs to hex, build the object, and serialize it before admission (`src/instance_fork.rs:4069-4111`). One SQLite value larger than `FORK_DIFF_MAX_BYTES` can therefore consume substantially more than the claimed in-flight byte limit before refusal. The current work-bound test does not contain an oversized single scanned row (`src/instance_fork.rs:6978-7088`). Preflight SQLite value lengths before conversion, bound decoding/serialization incrementally, and add huge text/blob/vector negatives.

### Fix-slice regression and drift review

I found no additional fail-open parent regression: without a manifest, the parent path intentionally stays dormant, while a legitimate durable manifest re-arms on reopen (`src/storage/write_authority.rs:338-351`; `src/storage.rs:27602-27670`). No other weakened prior guarantee was identified in the reviewed slice. The raw-file boundary is now described honestly as tamper-evident, not prevented. Receipt versioning and terminology are coherent across code, LLP 0158/0163/0164/0165, tests, and guide; LLP 0164's v3 receipt-evolution note needs no correction. The High finding is instead new code/spec drift: implementation does not maintain the whole-window registered-connection fact currently asserted by LLP 0165 and the guide.

### Verification actually performed

After the disposable clone passed `scripts/bootstrap-ibex-runtime` build, launch, and restricted no-eval handler-VM qualification, these committed tests passed at the reviewed SHA:

- `same_app_id_distinct_app_roots_cannot_select_or_mutate_each_others_forks`
- `root_wide_admission_is_atomic_at_count_and_total_byte_boundaries`
- `diff_receipt_v3_digests_are_domain_separated_canonical_and_bind_every_fact`
- `net_diff_streaming_limits_refuse_unchanged_revert_heavy_and_byte_heavy_work`
- `llp0165_armed_connection_is_defensive_default_deny_and_schema_alias_safe`
- `llp0165_registered_second_writer_uses_connection_local_defensive_authority`
- `net_diff_matching_journal_forgery_is_outside_the_registered_connection_class`
- `llp0162_writer_authority_rearms_from_durable_manifest_on_reopen`

The temporary registered-manifest-gap exploit test passed and produced the upgraded class, confirming rather than speculating about the bypass. `./ref-check --verbose` passed with 188 LLP documents, 3,427 references, and no errors or unchecked references. The guide checker could not complete because baseline generated demo artifacts and `ajv` were absent in this checkout; I did not treat those environmental failures as fix-slice defects.

### Recommended next step

Keep `operating.instance-forks` at target `none`. Preserve the closed lifecycle, v3 receipt, defensive-authorizer, registered-writer, and root-admission work; repair the manifest-continuity gap and make scanned-row byte enforcement pre-allocation. Then run the two new adversarial negatives and the existing exact-revision lifecycle/security suite before requesting a fresh implementation verdict. LLP 0163 and LLP 0164 need no further change for this fork slice; LLP 0165 and the corresponding guide class must stay unaccepted/unpublished until the registered-writer continuity claim is true.

## Round 3 — 2026-08-06, commit cdc0fe03e

### Provenance

- **Family:** codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-06
- **Commit:** `cdc0fe03e8d75c4a1d1d25f79fe820f20b772ef7`
- **Redacted:** no
- **Method:** Independent round-3 delta implementation/security review. I read both families' prior committed review rounds and verified their open findings against the pinned implementation, governing LLPs, guide, and committed tests. I reviewed only the three post-round-2 slices and their interactions with the previously closed surface. I qualified and tested an exact-revision disposable checkout and constructed one temporary continuity-carrier restoration variant there; this worktree was changed only by the two requested review appends.

### Overall result

**No new MATERIAL finding.** The round-2 manifest-continuity exploit, pre-expansion accounting gap, armed-renewal wedge, and armed journal-pruning denial are all closed. I found no regression in lifecycle binding, detached launch, admission release, or renewal consistency.

### Round-2 finding dispositions

1. **High — manifest deletion, unarmed registered writer, exact restoration: CLOSED.** Coverage manifest and continuity DML are now admitted only under the operation-ledger token (`src/storage/write_authority.rs:697-743`). The registered factory checks both receipt carriers, stream, manifest, continuity state, and prior sidecar before installing defensive authority or issuing its purpose token (`src/storage.rs:10871-11103`). A contradiction writes at least one durable irreversible carrier—a monotonic `broken` row and, for a fork, a synced create-once sidecar—and refuses (`src/storage.rs:10735-10799`; `src/storage.rs:10821-10869`). Activation refuses to re-arm a broken stream (`src/operation_ledger.rs:552-608`), and final diff verification separately requires no sidecar plus exact continuous state (`src/instance_fork.rs:3627-3705`).

   The committed negative accurately proves its claim: registered manifest deletion is authorization-denied; a raw connection then simulates the former missing-manifest interval; the next registered factory refuses and persists the gap; raw app/version/journal forgery plus byte-identical manifest restoration still cannot regain completeness (`src/instance_fork.rs:8097-8219`). My temporary variant deleted the continuity row, triggered the same break, then raw-deleted the new broken row and restored the original continuous row exactly. Net diff still returned `SNAPBACK_FORK_WRITER_COVERAGE_GAP` because the sidecar remained. A raw same-user actor that also removes filesystem evidence is explicitly outside this registered-connection class, and already has enough authority for the documented coordinated page/journal forgery (`llp/0165-proof-domains-and-checkpoints.spec.md:436-447`).

2. **Medium — row scan charged after owned expansion: CLOSED.** Scan work is computed from borrowed SQLite values and admitted before proportional decode or conversion (`src/instance_fork.rs:4160-4252`). JSON, text escaping, blob hex, and vector buffer/array costs are conservatively bounded before allocation, with a bounded serialization check afterward (`src/instance_fork.rs:4255-4484`). The committed huge-text, huge-blob, and vector negatives exercise refusal at `head-scan`, not after construction (`src/instance_fork.rs:7640-7734`).

3. **High — armed renewal checkpoint denied after lineage mutation: CLOSED.** The authorizer grants only `wal_checkpoint(FULL)` to the lifecycle `BranchRegistry` token (`src/storage/write_authority.rs:344-349`), and renewal checkpoints before opening the lineage transaction (`src/instance_fork.rs:3137-3170`). Forward mutation is sentinel/intent-fenced and ordinary failures compensate every expiry carrier; a compensation failure remains explicitly quarantined for recovery (`src/instance_fork.rs:2969-3134`; `src/instance_fork.rs:3172-3217`). The unit crash matrix and executable armed-recovery test both passed (`src/instance_fork.rs:6836-6909`; `tests/instance_fork_cli_v1.rs:2342-2449`).

4. **High — armed journal pruning denied: CLOSED.** A dedicated `JournalMaintenance` lane adds only retention deletion from `_snapback_changes` to the existing system-table authority, while application and journal-originating DML remain denied (`src/storage/write_authority.rs:40-84`; `src/storage/write_authority.rs:340-342`; `src/storage/write_authority.rs:755-775`). The production sweep enters that token, and the armed regression proves deletion plus floor advancement (`src/storage.rs:3183-3204`; `src/instance_fork.rs:7902-7939`).

### Three-slice defect review

#### Mint-time binding

Managed publication now requires a non-forgeable-at-the-Rust-API opaque expected identity, revalidates its canonical app-root receipt, and carries it through staging intent, final digest-bound binding, and both registry states (`src/instance_fork.rs:93-110`; `src/instance_fork.rs:169-269`; `src/instance_fork.rs:1189-1269`; `src/instance_fork.rs:4487-4619`). The source mint's app id must match; recovery refuses missing, legacy, or foreign binding (`src/instance_fork.rs:1200-1205`; `src/instance_fork.rs:4929-4971`). The passing never-launched library-mint test proves the owner can diff immediately while a sibling canonical root with the same app id cannot select it (`tests/instance_fork_cli_v1.rs:765-873`). The receipts are not keyed against a malicious same-user filesystem editor, but that actor is outside this local cooperating-process authority boundary; within scope I found no forgery or legacy wildcard.

#### Close-on-exec

The Unix pre-exec hook sets `FD_CLOEXEC` on all observed descriptors above stderr, retries `EINTR`, ignores only `EBADF`, and calls `setsid` afterward (`src/cli.rs:3383-3433`). It does not close descriptors in the hook; therefore spawn-error reporting remains possible, while successful exec closes inherited capture writers. Fork logs are mapped to descriptors 1 and 2 before this hook, and the server opens its own DB/listener/readiness resources after exec (`src/cli.rs:3591-3630`). Host restart likewise hands off no non-stdio descriptor (`src/cli.rs:6982-6999`). The passing fd-198 EOF negative proves the original macOS `Command::output()` inheritance wedge is gone while the server is still alive (`tests/instance_fork_cli_v1.rs:1894-1980`); the three-way concurrent-create test also passed (`tests/instance_fork_cli_v1.rs:1983-2031`). I found no legitimate inherited server descriptor lost and no platform claim beyond the Unix macOS/Linux target pair.

#### Admission deadline and release

The admission guard owns the locked file, acquires `flock` nonblockingly against a monotonic deadline, and reports `SNAPBACK_FORK_ADMISSION_TIMEOUT` after 30 seconds (`src/instance_fork.rs:3323-3405`). The CLI holds it across observation and publication and explicitly releases it once registry intent and rename are durable; every earlier `?`/error path releases through RAII (`src/cli.rs:3477-3513`). The lock is not FIFO, but starvation is bounded into a typed refusal rather than an indefinite wait. The zero-timeout held/released regression passed (`src/instance_fork.rs:7110-7154`).

#### Renewal compensation

The durable intent contains the previous expiry, and the forward path writes database lineage, mint, registry, and renewal receipt before removing intent and sentinel (`src/instance_fork.rs:2969-3108`). Ordinary errors restore the previous database lineage after a checkpoint, then the mint, registry, and prior renewal receipt before clearing quarantine (`src/instance_fork.rs:3111-3217`). Crash paths intentionally do not compensate and recovery idempotently replays the exact intent (`src/instance_fork.rs:4977-5032`). I found no ordinary single-failure path that exposes DB/receipt/registry disagreement. A secondary I/O failure can return `incomplete-recover-required`, but the sentinel still fences the partial state; if failure occurs after sentinel removal, all forward carriers have already reached the renewed cut and rollback recreates quarantine before mutating them.

### New findings

None. No Critical, High, Medium, or Low defect was identified in the reviewed delta.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Basis |
| --- | --- | --- |
| LLP 0163 | **READY** | Both derived receipts remain explicitly non-attributed, and LLP 0163 excludes this fork consumer from its current acceptance scope (`llp/0163-operation-identity-and-commit-envelope.spec.md:992-1006`). |
| LLP 0164 | **READY** | The retained-base v3 boundary, digest, and explicit absence contract remain aligned; the scan fix only makes its bounded execution honest (`llp/0164-fork-and-promotion.spec.md:489-513`). |
| LLP 0165 | **READY** | The protected carriers, registered-factory reconstruction, irreversible gap state, no-rearm rule, and oracle check implement the stated narrow class (`llp/0165-proof-domains-and-checkpoints.spec.md:399-454`). Both the committed exploit negative and my continuity-row variant fail closed. |

### Scope 2 verdict

**READY for implementation/security publication of the narrow local `operating.instance-forks` surface.** This is not a capability-publication action or a claim that the other gates are complete. The guide and capability index correctly remain partial/unpublished and target `none` until separate qualification, author acceptance, and publication evidence is satisfied (`guide/operating/instance-forks.md:28-34`; `guide/capabilities.md:90`).

### Verification actually performed

In the exact-revision disposable checkout, `scripts/bootstrap-ibex-runtime` passed build, launch, dynamic loading, and restricted handler-VM qualification. These focused committed tests passed individually:

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

The temporary continuity-row deletion and exact-restoration variant also passed by refusing the upgraded class. I did not run the full repository suite and did not re-review closed round-1 items.

### Recommended next step

Accept the round-3 delta as clean and use both READY verdicts in the existing governance flow. Keep the public tuple `Missing`/target `none` until the remaining capability qualification and publication gates have been run against the landed commit and accepted by the owner; no further code fix is recommended from this delta review.

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

The v2 checker implementation closes the prose-parser bypass class and the
mode/type-blind digest defect. The fork implementation surface itself remains
sound: no fork-behavior file changed after the round-5 baseline, and the focused
fork/storage regressions pass at C. Publication is nevertheless **NOT READY**
because the frozen qualification tree contains a new self-invalidating proof
cycle, and because the stated round-6/v2 review history is absent from the
actual artifacts. I will not fabricate that missing provenance.

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
written head verdicts name the wrong commit. This is the same class of
unsatisfiable qualification cycle that earlier rounds were intended to remove.

**Required resolution:** before the next qualification C, replace the
checked-in-transitional-state assertion with stable synthetic v1-rejection and
v2-acceptance fixtures that do not depend on the live review artifacts'
current version or round count. Then choose a fresh C and re-review it.

#### 2. High — the claimed round-6/v2 history is not in the frozen tree

The two Codex prose artifacts proceed from Round 5 directly to this Round 7
(`llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md:296`;
`llp/reviews/0158-instance-forking.implementation-2026-08-06.codex.md:355`).
Before this append, both Codex sidecars were v1 histories ending at round 5;
the Fable pair is in the same state. LLP 0162 itself confirms that all four
checked-in sidecars are deliberately unmodified v1 records and that fresh v2
histories are still required (`llp/0162-agent-safe-storage-profile.rfc.md:2471-2485`).

Therefore the instruction to append a contiguous v2 round 7 to an already-v2
round-6 history is not satisfiable from this tree. A v2 history must be
contiguous from round 1 (`scripts/check-agent-safe-publication.mjs:1430-1434`).
I recorded the actual round-7 verdict with a visible 5→7 gap and predecessor
binding to the last real Codex entry; the production validator correctly
refuses that gap. I did not synthesize a round-6 review from its summary.

**Required resolution:** recover the actual round-6 prose and typed entries
from genuine reviewer transcripts for both families, or obtain an explicit
author decision to restart/renumber the review with fresh independent inputs.
Do not fill round 6 from orchestration intent or this summary.

### Commit and implementation-digest binding

The digest implementation hashes the exact Git mode, object type, path, byte
length, and blob bytes for every in-scope leaf, and hashes `vendor/ibex` as the
`160000 commit` gitlink (`scripts/check-agent-safe-publication.mjs:540-592`).
The C/receipt/P check recomputes both committed trees and requires three-way
equality (`scripts/check-agent-safe-publication.mjs:604-635`). The Rust build
mirror independently enumerates the same tree and framing
(`build.rs:414-483`).

At C, two independent arithmetic implementations and the digest embedded by
the exact-C build all produced
`sha256:017bbd2675f31b68f0fd959b555588a1b6ccaf5ea4d89f68f2dc7d1ea86177a6`
over 801 entries: 797 mode-100644 blobs, three mode-100755 blobs, and the
`160000 commit 4c34c831aa087d6783b0d68f281cdb374ed7fc89` Ibex gitlink. Receipt,
carrier, acceptance, prose, and sidecar rotation remain outside that digest,
so a receipt can arithmetically name C without a digest self-cycle. The
publication process is still unsatisfiable because of finding 1, not because
the digest value rotates.

### Fork surface, storage chain, and regressions

`git diff --name-only b08e835f1..2a5a6291a` over the exact
`IMPLEMENTATION_ROOTS` changes only `build.rs`, the JS checker, its Rust mirror,
three publication records, and the checker tests. It has no change to
`src/instance_fork.rs`, `src/storage.rs`, `src/storage/auth_invalidation.rs`,
`src/operation_ledger.rs`, `src/local.rs`, `src/server.rs`, or the Ibex gitlink.
That verifies rather than assumes the round-5 carry-forward boundary.

The exact-C bootstrap passed native link/load, launch, and restricted no-eval
handler-VM qualification. Five library regressions passed at their current
definitions (`src/instance_fork.rs:6837`, `src/instance_fork.rs:7112`,
`src/instance_fork.rs:7640`, `src/instance_fork.rs:7903`,
`src/instance_fork.rs:8098`), as did five executable lifecycle regressions
(`tests/instance_fork_cli_v1.rs:769`, `tests/instance_fork_cli_v1.rs:1896`,
`tests/instance_fork_cli_v1.rs:1987`, `tests/instance_fork_cli_v1.rs:2207`,
`tests/instance_fork_cli_v1.rs:2342`). All three Rust
`agent_safe_publication::tests` passed. The full JS publication checker suite
passed before reviewer-artifact mutation, including the storage duplicate-field
negative; the legacy storage parser now requires exactly one occurrence of
each field (`scripts/check-agent-safe-publication.mjs:1211-1246`). Both live
anchors remain withheld.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-7 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No fork-surface delta after the already-reviewed baseline; focused regressions remain green. |
| LLP 0164 | **READY** | No lifecycle, custody, isolation, egress, or fork/private-base implementation delta. |
| LLP 0165 | **READY** | No completeness, authorizer, journal, or net-diff implementation delta; focused gap/preflight/pruning tests pass. |

These are fork-contract verdicts only and do not cure the publication blockers.

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local
`operating.instance-forks` surface at qualification commit `2a5a6291a`.**

### Verification actually performed

- Full committed `tests/agent_safe_publication_checker_v1.mjs`: pass before
  review-artifact mutation; the 17 focused history/parser/digest attacks also
  passed separately.
- Additional disposable direct-validator attacks covering schema, fields,
  canonical bytes, prose authority, ancestry, digest binding, round order, and
  missing/malformed inputs: expected pass/refusal results.
- Exact-C `scripts/bootstrap-ibex-runtime`: pass, including build, launch,
  dynamic load, and restricted handler-VM qualification.
- Ten focused fork tests and three Rust publication-chain tests: pass.
- Independent v2 digest arithmetic and exact-C build-embedded digest: equal.
- I did not run the full Rust suite or `scripts/verify-local-proof` end to end.

### Recommended next step

Keep both anchors withheld. Break the live-artifact test cycle inside the
implementation scope, recover real round-6 provenance (or author-reset the
numbering), choose a fresh qualification C, and commission a new bounded
cross-family review. Do not publish from `2a5a6291a`.

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

The canonical-reader and restored-provenance claims are real. The single
canonical parser closes A4/A5 and the earlier prose, schema, history, family,
and commit-spoofing attack class. The mode/type-aware v2 digest is stable at C,
and the fork implementation still merits the rounds 1–3 READY conclusions.

Publication at C is nevertheless **NOT READY**. The other Codex Round-7 blocker
survives: an in-scope canonical-proof test freezes the live histories at
exactly rounds 1–6 and commit `bdc682964`. Appending the genuine Round 7 and
this Round 8 makes C's own required proof fail. Repairing that test changes the
implementation digest and therefore requires a fresh C.

### Round-7 closure and contract attacks

**F7-1 is closed.** Every publication-chain JSON reaches the canonical reader
at `scripts/check-agent-safe-publication.mjs:737-756` before shape or authority
checks. Reviews use it at `scripts/check-agent-safe-publication.mjs:1393-1494`,
named-author acceptance at `scripts/check-agent-safe-publication.mjs:1505-1547`,
and anchor/carrier/receipt at
`scripts/check-agent-safe-publication.mjs:1649-1718`. A static read-path audit
found no publication-chain bypass.

I reran A4 (visible `"accepted": false` followed by duplicate true) and A5 (a
restarted fabricated READY history hidden behind duplicate
`reviewHistoryHeads`). Both refused as non-canonical. The per-artifact
regression refused duplicate members in every distinct derived chain JSON.
Non-canonical whitespace/newlines, malformed or missing inputs, unknown fields,
wrong schemas/types, prose/path/digest detachment, family spoof/change and
same-family pairs, round gaps/duplicates/reordering, predecessor breaks, wrong
C, non-ancestral commits, deletion/restart, and truncation followed by
renumbering/rechaining all refused. The round-4/5 prose shapes are inert: a
valid structured control with contradictory prose published, confirming that
Markdown is only mandatory digest-bound bytes, never verdict authority
(`scripts/check-agent-safe-publication.mjs:1393-1422`).

**F7-2 is closed.** I compared the current Codex Round-6 body byte-for-byte with
the complete Round-6 streaming transcript and the Fable body byte-for-byte with
the original session `Write` payload. Both Codex artifacts match the same
70-line source; both Fable artifacts match the same 268-line source. All four
histories preserve rounds 1–5's prior semantic entries and add one real round 6
at `bdc68296499298f634d9aa461e90fb8d1a7d4ab0`: Scope 1 READY for LLPs
0163/0164/0165 and Scope 2 NOT_READY in both families. I found no altered,
invented, or renumbered verdict. The genuine Codex Round 7 above was likewise
recovered verbatim from its preserved review artifact.

### Blocking finding

#### High — the frozen proof hard-codes the mutable live histories

`tests/agent_safe_publication_checker_v1.mjs:746-768` reads all four live
sidecars and requires exact rounds `[1, 2, 3, 4, 5, 6]`, head commit
`bdc68296499298f634d9aa461e90fb8d1a7d4ab0`, and validated round/count 6. The
canonical local proof runs that test (`scripts/verify-local-proof:185`), while
`tests` is inside `IMPLEMENTATION_ROOTS`
(`scripts/check-agent-safe-publication.mjs:42-52`). The required review append
therefore makes the proof red. Editing the assertion after review changes C's
in-scope tree and leaves the new heads bound to the wrong commit. I reproduced
the failure after this honest append.

**Required resolution:** replace the live-history snapshot with immutable
synthetic v1/v2 fixtures, then cut a fresh C and obtain new highest rounds.

### Commit, digest, and implementation delta

The v2 preimage covers Git mode, object type, path, byte length, and bytes, with
`vendor/ibex` required as a `160000 commit` gitlink
(`scripts/check-agent-safe-publication.mjs:529-596`). Publication independently
recomputes C and P and requires `digest(C) == receipt == digest(P)`
(`scripts/check-agent-safe-publication.mjs:608-639`). Independent arithmetic
and the exact-C build agree on
`sha256:b77879fa08cb71a943b7f17aecdd03b290da7bd429e68426859161faab09a725`;
the Ibex leaf is `4c34c831aa087d6783b0d68f281cdb374ed7fc89`. Review artifacts and closed
publication-cycle records do not rotate it. V1 records remain stale behind
withheld anchors and fail closed if presented as published.

The exact `IMPLEMENTATION_ROOTS` delta from Round-7 C `2a5a6291a` to this C
changes only the JS checker, two local-persistent-store publication records,
two withheld receipts, and checker tests. There is no fork implementation,
fork suite, or Ibex-gitlink delta. The carry-forward is verified, not assumed.

### Fork and storage regression evidence

The exact-C bootstrap passed build, native link/load, launch, and restricted
no-eval handler-VM qualification. After documented codegen prepared ignored
Todo/RBAC manifests in the disposable clone, these exact-C suites passed:

- `instance_fork::tests`: 48/48.
- `instance_fork_cli_v1`: 15/15.
- `instance_fork_vm_egress_v1`: 1/1.
- `instance_fork_disk_pressure_v1`: 1/1.
- `agent_safe_publication::tests`: 3/3.

The full unmodified JS checker suite passed 64/64 before artifact mutation,
including every-chain duplicate-member coverage, A4/A5, history replacement,
prose irrelevance, ancestry, mode/type/symlink/gitlink digest attacks, the
storage duplicate-field refusal, and a final-READY publication control. Both
checked-in anchors remain withheld.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-8 basis |
| --- | --- | --- |
| LLP 0163 | **READY** | No fork-surface delta; operation identity and commit-envelope boundaries remain aligned and the suites pass. |
| LLP 0164 | **READY** | No lifecycle, custody, isolation, egress, retained-base, or promotion-boundary delta. |
| LLP 0165 | **READY** | No authorizer, journal-completeness, coverage-gap, or net-diff delta; the 48-test corpus passes. |

These contract verdicts do not cure the proof-cycle blocker.

### Scope 2 verdict

**NOT READY for implementation/security publication of the narrow local
`operating.instance-forks` surface at qualification commit `0e778b9a8`.**

### Verification actually performed

- Full 64-test JS checker suite before artifact mutation and source-path audit.
- A4/A5 and the committed schema/history/prose/family/commit/digest attacks.
- Byte-exact Round-6 provenance and semantic rounds 1–5 comparison.
- Independent v2 digest computation and exact-C build/bootstrap.
- Exact-C 48 library fork tests, 17 executable fork tests, and three Rust
  publication tests.
- Exact in-scope delta and post-append frozen-test failure reproduction.
- I did not run the full Rust suite, lifecycle benchmark, or complete local proof.

### Recommended next step

Keep both anchors withheld. Move the live-history-state check to immutable
synthetic fixtures, cut a fresh C, and obtain new independent highest-round
verdicts. Do not publish from `0e778b9a8`.

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
anchor, and guide row and let the unchanged publication checker decide at P.

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
- **Verdict:** **NOT_READY**

### Delta and guard assessment

Across the exact digest roots, `fac516e9a..a127e9b47` changes four regular
files: `src/agent_safe_publication.rs`, `src/manifest.rs`,
`tests/fixtures/client-bundle-metrology/current.v1.json`, and the new
`tests/fixtures/client-bundle-metrology/baseline.asset-delivery-selection.v1.json`.
The `vendor/ibex` gitlink remains mode `160000` at
`4c34c831aa087d6783b0d68f281cdb374ed7fc89`. The implementation digest rotates
from `sha256:d49f0353b3d41943f8dbe7ed4560027671c40d6e069dc0af90a6cd12823cc6ea`
to `sha256:0b5d8e7f88cf7899d8c1d53aac04a331da0fa8e2a147c17e55625af0e52ee577`.

The metrology fixture changes are unrelated digest churn. The
`agent_safe_publication.rs` change is relevant and sound: the production
`derived_fork_publication_verified_for_distribution` body is byte-for-byte
unchanged and still returns `false` for every distribution; the live target
and app-effective tuples remain wholly `Missing`; the capability remains a
GAP and absent from supported capabilities. The replacement test parses the
closed anchor/carrier/receipt types, checks synthetic withheld and published
chains separately, and proves that the synthetic published fixture satisfies
the private structural verifier before separately asserting that both
contributor-source and public-package distribution guards remain false. This
is not a vacuous lifecycle-independent assertion. In a disposable checkout at
the exact C, its exact test passed: `1 passed; 0 failed`.

### Blocking finding R11-1 — manifest wire change leaves generated contracts stale

The same delta adds lower-camel serde spellings in `src/manifest.rs` for the
positive egress and promotion variants: `denyAll`, `captureOnly`,
`notPromotable`, and `promotable`. That makes the Rust publication parser agree
with the actual lower-camel candidate carrier, but it is a global public
manifest wire change, not a publication-test-only adaptation. The committed
`capability.manifest.schema.json`, `inspect.schema.json`, public/admin inspect
schemas, and `packages/snapback-codegen/index.d.mts` still declare the old
Pascal-case values.

At exact C, the mandatory drift gate fails:

```text
cargo test --test artifact_schemas_v0 dk7_committed_schemas_match_rust_types -- --exact
test dk7_committed_schemas_match_rust_types ... FAILED
capability.manifest.schema.json drifted from the Rust types; regenerate with cargo run --bin snapback-schemagen
test result: FAILED. 0 passed; 1 failed
```

This breaks qualification satisfiability at C. In particular,
`packages/snapback-codegen/index.d.mts` is itself inside
`IMPLEMENTATION_ROOTS`, so bringing the public declarations back into sync
cannot be performed only in the C-to-P publication leaves: it rotates the
implementation digest and requires a new qualification commit. The lifecycle
test passing does not compensate for a failing mandatory generated-contract
gate.

### Chain spot-check

Before this append, all four Codex/Fable v2 histories were canonical,
contiguous through round 10, ended at `fac516e9a`, and validated through the
production closed parser with `READY` heads. This entry extends the genuine
Codex implementation history as round 11; it does not replace or renumber
prior rounds.

At inspection time the macOS and Linux lifecycle receipts, author acceptance,
publication receipt, and carrier were canonical JSON but still named earlier
qualification commits; the anchor remained canonically withheld and the guide
capability remained a GAP. The round brief identifies those receipts as being
re-minted in parallel, so their old commit names are expected in-flight state,
not an additional finding. Because R11-1 blocks this C, no acceptance or
publication chain should advance using it.

### Scope verdicts

- **Scope 1:** LLP 0163 remains **READY**, LLP 0164 is **NOT_READY**, and LLP
  0165 remains **READY**. The delta does not change operation identity,
  lifecycle/custody/isolation enforcement, authorizer, journal completeness,
  pruning, or net-diff behavior. However, LLP 0164 expressly owns the fork and
  promotion contracts and artifact schemas, so the inconsistent global
  egress/promotion wire projection is a conformance failure even though no
  positive target/app fact is advertised.
- **Scope 2:** **NOT_READY** at `a127e9b47`. The distribution guard was not
  weakened, but the qualification commit fails the mandatory DK7
  generated-schema/type consistency gate.

### Recommended next step

Regenerate the committed schemas and generated TypeScript declaration, or
isolate publication-chain parsing so it does not mutate the global manifest
wire contract. Either repair changes digest-covered content, so qualify a new
C and rerun DK7 plus the exact lifecycle test before another bounded review.
Re-review the LLP 0164 projection and keep the anchor and guide row withheld.

## Round 12 — 2026-08-07, qualification commit `ad0ad5874`

### Provenance

- **Reviewer family:** Codex
- **Provider/runtime:** OpenAI Codex, GPT-5 family runtime
- **Date:** 2026-08-07
- **Commit:** `ad0ad58748981010204b61eb5002e35b887a5093`
- **Redacted:** no
- **Method:** Bounded delta review from round-11 C
  `a127e9b474dd5bedb31c73afa57022f4d8b82aed` to the exact qualification C.
  I enumerated the exact implementation roots and `vendor/ibex` gitlink,
  inspected both repair commits and the Rust serde authority, compared every
  named schema/TypeScript projection, searched tracked machine-consumed files
  for an unreported stale spelling, recomputed the implementation digests, and
  ran the exact DK7 committed-schema drift test. I compared the publication
  source blob at both Cs and re-inspected the hard-false guard and lifecycle
  test. An attempted exact lifecycle-test rerun stopped during compilation
  because this clean checkout lacks two ignored generated Todo manifests; I
  did not create files outside the four authorized review artifacts. The
  round-11 exact pass carries forward because the complete source blob is
  unchanged. I did not rerun the full attack corpus because the delta and
  focused checks were sufficient.
- **Verdict:** **READY**

### Repair and artifact assessment

The two commits in `a127e9b47..ad0ad5874` contain exactly the advertised
repairs. Commit `3664973bc` changes only the four committed capability and
inspect schemas, replacing the positive egress/promotion enums with
`denyAll`, `captureOnly`, `notPromotable`, and `promotable` (plus the
generator-derived enum description). Commit `ad0ad5874` changes only the two
corresponding unions in `packages/snapback-codegen/index.d.mts`. There is no
other mainline churn in this bounded range and no mode change.

The four schemas now expose the same three-value closed enums as Rust:
`Missing | denyAll | captureOnly` and
`Missing | notPromotable | promotable`. The public TypeScript declaration
matches those values exactly. The mandatory focused gate now passes:

```text
cargo test --test artifact_schemas_v0 dk7_committed_schemas_match_rust_types -- --exact
test dk7_committed_schemas_match_rust_types ... ok
test result: ok. 1 passed; 0 failed
```

A type-name search found the two declarations only in the Rust authority, the
four generated schema definitions/references, and the one exported TypeScript
declaration. A separate old-literal search over tracked Rust, JSON, and
JavaScript/TypeScript-family files found no stale generated or declared
artifact. It found only the object-shaped `DenyAll`/`CaptureOnly` values in
two deliberate rejection fixtures
(`src/manifest.rs::agent_safe_wire_tampering_is_rejected` and
`tests/artifact_schemas_v0.rs::agent_safe_capability_schema_rejects_axis_and_extension_tampering`);
those assert rejection of a malformed non-scalar axis and are not wire
projections. No third stale artifact was found.

### Exact implementation delta

The schema-only commit is outside `IMPLEMENTATION_ROOTS`: both
`a127e9b47` and `3664973bc` compute
`sha256:0b5d8e7f88cf7899d8c1d53aac04a331da0fa8e2a147c17e55625af0e52ee577`.
Across the exact roots, the only `a127e9b47..ad0ad5874` change is
`packages/snapback-codegen/index.d.mts`, producing C's digest
`sha256:fc6e3e58453b4700ce06c647aaef87132879e0da336e560eca834d1d42c5459a`.
The `vendor/ibex` gitlink remains mode `160000` at
`4c34c831aa087d6783b0d68f281cdb374ed7fc89`.

### Carry-forward and Scope 2 verdict

The complete `src/agent_safe_publication.rs` blob is identical at the two Cs
(blob `7fef417acfbc38591fdcfb7c5b8c73c1eb03b5b0`). The production
`derived_fork_publication_verified_for_distribution` still ignores the
distribution and returns literal `false`, covering contributor-source and
public-package builds. The unchanged lifecycle test remains non-vacuous: it
constructs distinct synthetic withheld and published chains, asserts the
published chain passes the private structural verifier, then separately
asserts the public distribution guard is false for both build kinds. Round 11
ran that exact test successfully; this delta cannot change its result.

**Scope 2 is READY at `ad0ad5874` for implementation/security publication of
the narrow local `operating.instance-forks` surface, subject to the unchanged
production checker and exact P-time evidence, acceptance, review-head, and
implementation-digest bindings.** This review does not itself publish the
capability.

### History integrity and next step

The checked-in Codex artifacts presented to this round ended at round 10. I
recovered the genuine round-11 Codex prose and v2 entries from
`/private/tmp/review-preserve/r11-codex`; the checked-in round-10 files were
byte-identical to their preserved round-10 copies, so this restores rather
than reconstructs or invents the missing history. Round 12 extends that
history and rebinds the current-state artifact hashes and predecessor chain.

Keep the anchor and guide row withheld until the other required reviewer,
lifecycle evidence, Charlie acceptance, and all P-time bindings name this
exact C and implementation digest; then let the unchanged closed checker
decide publication.
