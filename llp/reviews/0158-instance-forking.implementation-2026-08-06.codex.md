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
