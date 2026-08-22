# Non-SQL durability census: 21 sinks, 11 reachable-and-unguarded, one Critical

Status: Open — supersedes the ad-hoc non-SQL list. The reset-wipe conflict is RESOLVED
against this document: see "CONFLICT RESOLVED" below. Remaining findings stand.
Created: 2026-08-21
Related: issues/20260821-durable-write-census-completeness-audit.md,
issues/20260821-nonsql-durable-effects-unguarded.md,
issues/20260821-durable-authority-to-effect-handoff-design.md, LLP 0058

## Why

The completeness audit found the SQLite census source-complete and the non-SQL class never swept
with the same rigour. This is that sweep: an independent inventory built from the sinks outward,
then diffed against the existing lists.

21 census rows; 11 ranked as reachable and unguarded.

## CONFLICT RESOLVED — this document was wrong; reset wipe is NOT Critical

Adjudicated 2026-08-21 against the source. **This census's Critical ranking of reset
`AssetStore::wipe_all` is withdrawn.** The remedy classification's "Neither" verdict is correct.
Confidence approximately 0.97.

There is no source-visible path where `wipe_all` deletes custody and the durable reset is later
refused or rolled back. `wipe_all` is reached ONLY on the known-`Committed` branch, after
`finish_committed_reset` has run. The three failure classifications each return before it:
`finalization_error`, `RolledBack`, and `CommitUncertain`. Commit certainty is itself proven by
readback of the exact fresh successor, so a failed COMMIT acknowledgement cannot be misread as
committed.

Later failures — partial local wipe, partial S3 wipe, after-Local batch error, issuer rebuild
failure, process death — do occur, but all of them leave the committed reset in force. The
process ends reset, fail-closed, wedged closed, or restarted from the committed successor. None
can restore or resume serving the predecessor database. So the feared state, a live instance whose
asset custody was destroyed, does not arise.

Two corrections to what this document said:

- The "Neither" row lives in `issues/20260821-authorized-effect-remedy-classification.md`, not in
  the handoff design; the handoff design has no `wipe_all` row.
- Local `wipe_all` does not remove directories at all — it only unlinks files. The
  "directory removal" observation applies to other cleanup such as `--dev-fresh`.

### What IS real, and is not an authorization problem

A partially wiped store after a crash is possible; which completed unlinks survive is INFERRED,
since no parent directory is fsynced. The reconciliation picture is uneven:

- Leftover STAGING objects are reconciled — mandatory GC compares enumerated staging keys against
  durable live attempts and removes orphans.
- Leftover BLOB objects are generally NOT reconciled. `AssetStore` exposes `list_staging_keys` but
  no blob enumeration, and blob GC follows durable condemned rows — which the reset just deleted.
  Orphan blobs persist until another namespace wipe or operator inspection.
- The database keeps no wipe-completion marker or partial-wipe state, so **from the application's
  perspective a partial wipe is indistinguishable from a successful one.** Only filesystem or
  S3-prefix inspection reveals leftovers.

That is a storage-reclamation and observability gap, not an admission-fence gap. Confirming the
crash behaviour needs a failpoint/SIGKILL test after the Nth unlink per filesystem; it would not
change the authorization verdict.

## Original conflict, retained for the record

This census ranks **reset `AssetStore::wipe_all` as Critical**. The landed authority-to-effect
handoff design classifies the same reset wipe as **"Neither" — needing no remedy**.

- The handoff design's argument: after the reset transaction commits, the files are unreferenced
  by construction, so the wipe is reset-owned best-effort continuation and a later mode change
  should not suppress cleanup.
- This census's argument: the admission guard ends with the reset *transaction*, and the wipe runs
  later during process-state publication, best-effort, namespace-wide — so it "can partially
  delete local or S3 custody before any later reset refusal"
  (`server.rs:23784`, `server.rs:23813`, `server.rs:23854`, `engine.rs:8616`, `engine.rs:8639`,
  `assets.rs:874`, `assets_s3.rs:833`).

**The deciding question is narrow and answerable:** is there any path where the wipe executes and
the reset is subsequently refused or fails to publish? If yes, this destroys custody without an
authorized reset and the Critical ranking stands. If the wipe is strictly downstream of an
irrevocably committed reset, the handoff design is right and this is correctly "Neither".

Do not act on either verdict until that is settled. Note also the census's INFERRED point that
local unlink and directory removal do not fsync the parent, so crash-stability of the deletion is
itself unconfirmed.

## Ranked reachable-and-unguarded

1. **Critical** — reset `wipe_all` (see conflict above).
2. **High** — owner-driven asset deletion and cleanup: cancel, terminate, explicit delete,
   finalize cleanup, failure cleanup can irreversibly remove local/S3 objects after authority
   validation but with no guard at deletion.
3. **High** — arbitrary mutating `ctx.fetch` / `ctx.fetchStream`: the remote service can accept an
   application-authored POST/PUT/PATCH/DELETE before the post-response authority check.
4. **High** — asset canonical/blob/variant publication: authority-free tickets can publish
   local/S3 objects between caller validation and later completion checks; local refusal can leave
   orphans and S3 acceptance is already external.
5. **High** — push and webhook delivery: provider/receiver acceptance is externally observable and
   cannot be undone by a later local settlement refusal.
6. **High** — `api.ask` provider call: the admitted caller's task and accumulated messages reach
   the provider with no guard spanning the POST. Disclosure is direct; charging is INFERRED.
7. **Medium** — TUS staging append: bytes are fsynced under the stale ticket before admission
   re-entry.
8. **Medium** — auth keyring rotations (password/recovery planning, lease signing, reset issuer
   rebuild): owner-only local effects, but the file can publish before the later guarded step.
9. **Low–medium** — RQS resume-key rotation; the subsystem treats key loss as availability-only.
10. **Low** — conditional derived-fork coverage-gap sidecar: fsynced before admission validation,
    but the egress is always refused and the sidecar is bounded and payload-free.
11. **Adjacent, durability unconfirmed** — opt-in JSONL traces; flushed outside guards with no
    fsync, so crash durability is unestablished.

Several of these (3, 5, 6, 7) are already covered by the authority-to-effect handoff design and
need withholding rather than fencing. Items 1, 2, 4 and 8 are the ones this census adds weight to.

## Examined and excluded

No app-admission carrier, so not in scope: scheduled asset GC, startup creation of
resume/completeness keyrings, and administrative metadata/backup/fork/replication operations,
whose host-operation contract requires `prepared_authority: None`.

## Completeness boundary

Source-complete for the enumerated production Rust sinks and admitted call chains: the complete
`AssetStore` mutation interface and its local/S3 implementations; direct owner-only file writes,
renames, removals and fsyncs on admitted chains; the operation-detail and fork-coverage sidecars;
admitted diagnostic appenders; and the production HTTP provider lanes for fetch, push, webhook,
ask and S3.

Explicitly NOT claimed: whole-system or provider-side completeness. Remaining INFERRED boundaries
are crash persistence of unlink/rmdir without parent fsync; exact provider state when a request
was transmitted but no response arrived; that no production admitted caller currently reaches S3
native multipart or `copy_blob`; and macro-generated, dynamically dispatched, hosted or
dependency-internal effects. This is a source census, not compiler-enforced effect analysis — the
same limitation the SQLite census records.

## Provenance

Read-only codex census against `48affb635`. Full inventory with file:line citations appended.

---

## Result

`AssetStore::wipe_all` is confirmed as the most severe non-SQL gap: reset holds the admission guard only through the SQLite attempt, drops it before reset publication, and both reset variants then invoke `wipe_all` best-effort; local storage unlinks every file in both namespaces, while S3 issues one DELETE per object under the instance prefix. [server.rs:23784](crates/snapback-server/src/server.rs:23784) [server.rs:23813](crates/snapback-server/src/server.rs:23813) [engine.rs:8616](crates/snapback-engine/src/local/engine.rs:8616) [engine.rs:8639](crates/snapback-engine/src/local/engine.rs:8639) [assets.rs:874](crates/snapback-services/src/assets.rs:874) [assets_s3.rs:833](crates/snapback-services/src/assets_s3.rs:833)

The classification rule is LLP 0058’s requirement that retired work cannot commit or publish, with generation and admission epoch rechecked atomically at the effect boundary; `AdmissionEffectGuard` implements that by retaining the admission-state mutex across the cut. [LLP 0058:764](llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:764) [LLP 0058:1306](llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1306) [admission.rs:947](crates/snapback-auth/src/auth/admission.rs:947)

## Census

| Operation | Durable cut | Admitted-context reachable | Guard live at cut | Structurally safe mechanism | Externally visible or irreversible |
|---|---|---:|---:|---|---|
| **Reset: local/S3 `AssetStore::wipe_all`** | Local: successful `remove_file`; crash-stable directory deletion is **INFERRED**, because no parent-directory fsync follows. S3: each provider DELETE acknowledged as 204/404. [assets.rs:877](crates/snapback-services/src/assets.rs:877) [assets.rs:889](crates/snapback-services/src/assets.rs:889) [assets_s3.rs:833](crates/snapback-services/src/assets_s3.rs:833) | **Yes.** Both reset routes carry an `AdmissionLease`. [server.rs:23674](crates/snapback-server/src/server.rs:23674) [server.rs:23724](crates/snapback-server/src/server.rs:23724) | **No.** The guard ends with the reset transaction at line 23813; wipe happens later during process-state publication. [server.rs:23784](crates/snapback-server/src/server.rs:23784) [server.rs:23813](crates/snapback-server/src/server.rs:23813) [server.rs:23854](crates/snapback-server/src/server.rs:23854) [engine.rs:8628](crates/snapback-engine/src/local/engine.rs:8628) | The stream-reset ticket blocks observation of a half-installed successor, but it is not an admission-epoch recheck at each deletion. [server.rs:23840](crates/snapback-server/src/server.rs:23840) | **Yes—destructive and irreversible.** Local unlink and S3 DELETE are not undone by later reset-finalization failure; errors are discarded, so partial wipes are possible. [engine.rs:8628](crates/snapback-engine/src/local/engine.rs:8628) [engine.rs:8650](crates/snapback-engine/src/local/engine.rs:8650) [assets_s3.rs:836](crates/snapback-services/src/assets_s3.rs:836) |
| **TUS PATCH staging append** | Local `write_all` → `flush` → `sync_data`; `sync_data` is the durable cut. [assets_store.rs:181](crates/snapback-services/src/assets_store.rs:181) | **Yes.** Route owns `PreparedAuthority`; preflight validates it, then an authority-free ticket carries only store and continuity facts into the blocking append. [asset_routes.rs:211](crates/snapback-server/src/server/asset_routes.rs:211) [asset_routes.rs:271](crates/snapback-server/src/server/asset_routes.rs:271) [assets.rs:494](crates/snapback-services/src/assets.rs:494) | **No.** Append and fsync occur before the route re-enters `LocalSnapback` and revalidates the caller. [asset_routes.rs:291](crates/snapback-server/src/server/asset_routes.rs:291) [asset_routes.rs:309](crates/snapback-server/src/server/asset_routes.rs:309) | Same-attempt mutex prevents competing same-offset writers, and the later offset/caller CAS can refuse acknowledgement; neither rechecks admission at `sync_data`. [asset_routes.rs:266](crates/snapback-server/src/server/asset_routes.rs:266) [engine.rs:12680](crates/snapback-engine/src/local/engine.rs:12680) | Restricted local staging bytes are not ordinarily public, but the durable append is not rolled back if the later caller check refuses. [assets.rs:552](crates/snapback-services/src/assets.rs:552) |
| **Finalize canonical rewrite** | Local: rename is the logical publication cut; parent sync completes crash durability. S3: provider PUT returning 200. [assets_store.rs:81](crates/snapback-services/src/assets_store.rs:81) [assets_store.rs:105](crates/snapback-services/src/assets_store.rs:105) [assets_s3.rs:666](crates/snapback-services/src/assets_s3.rs:666) | **Yes.** Finalize route has `PreparedAuthority`, but canonical preparation runs in an authority-free ticket between preflight and Phase A. [asset_routes.rs:142](crates/snapback-server/src/server/asset_routes.rs:142) [asset_routes.rs:156](crates/snapback-server/src/server/asset_routes.rs:156) [asset_routes.rs:167](crates/snapback-server/src/server/asset_routes.rs:167) | **No.** Canonical file/S3 writes occur during `ticket.prepare()` without an admission carrier. [assets.rs:335](crates/snapback-services/src/assets.rs:335) [assets.rs:346](crates/snapback-services/src/assets.rs:346) [assets.rs:706](crates/snapback-services/src/assets.rs:706) | Phase A rechecks authority afterward, but that cannot undo the canonical object. [asset_routes.rs:174](crates/snapback-server/src/server/asset_routes.rs:174) | Local restricted object is persistent; S3 object is provider-visible. Neither is automatically rolled back after refusal. [assets_s3.rs:666](crates/snapback-services/src/assets_s3.rs:666) |
| **Finalize primary blob publication** | Local rename plus parent sync; S3 PUT returning 200 or the idempotent existing-object 412 case. [assets_store.rs:208](crates/snapback-services/src/assets_store.rs:208) [assets_store.rs:219](crates/snapback-services/src/assets_store.rs:219) [assets_s3.rs:675](crates/snapback-services/src/assets_s3.rs:675) | **Yes.** Phase A validates authority, then hands an authority-free `FinalizePutTicket` to blocking Phase B. [asset_routes.rs:174](crates/snapback-server/src/server/asset_routes.rs:174) [asset_routes.rs:185](crates/snapback-server/src/server/asset_routes.rs:185) [assets.rs:594](crates/snapback-services/src/assets.rs:594) | **No.** Phase B explicitly owns no `LocalSnapback` or database borrow and performs copy/PUT before Phase C reloads the caller. [assets.rs:626](crates/snapback-services/src/assets.rs:626) [engine.rs:13114](crates/snapback-engine/src/local/engine.rs:13114) [engine.rs:13127](crates/snapback-engine/src/local/engine.rs:13127) | Idempotent keying and post-PUT hash verification protect object integrity, not admission epoch; Phase C’s caller reload is too late. [assets.rs:629](crates/snapback-services/src/assets.rs:629) [assets.rs:634](crates/snapback-services/src/assets.rs:634) [engine.rs:13138](crates/snapback-engine/src/local/engine.rs:13138) | S3 publication is external and non-rollbackable by local refusal; local publication can leave an orphan object. |
| **Required and on-demand variant publication** | Same local rename/parent-sync or S3 PUT cut as blob publication. [assets_store.rs:208](crates/snapback-services/src/assets_store.rs:208) [assets_s3.rs:675](crates/snapback-services/src/assets_s3.rs:675) | **Yes.** Required variants run during admitted finalize; on-demand variants run after an admitted delivery or signed-URL authorization probe. [engine.rs:13194](crates/snapback-engine/src/local/engine.rs:13194) [engine.rs:13640](crates/snapback-engine/src/local/engine.rs:13640) [engine.rs:13672](crates/snapback-engine/src/local/engine.rs:13672) | **No.** `asset_stage_prepared_variant` performs the store PUT between a publication-plan write and later staged-state commit with no effect guard. [engine.rs:12945](crates/snapback-engine/src/local/engine.rs:12945) [engine.rs:12959](crates/snapback-engine/src/local/engine.rs:12959) | Authorization before materialization and hash verification protect access and integrity, but there is no admission recheck at the store cut. [engine.rs:13576](crates/snapback-engine/src/local/engine.rs:13576) [engine.rs:12960](crates/snapback-engine/src/local/engine.rs:12960) | Same as primary publication: external at S3; persistent/orphanable locally. |
| **Owner-driven asset deletion and cleanup** — cancel/TUS terminate, superseded staging, finalize cleanup/refusal, explicit record delete | Local successful unlink; crash-stable deletion is **INFERRED** because these paths do not sync the parent. S3 DELETE returning 204/404. [assets_store.rs:286](crates/snapback-services/src/assets_store.rs:286) [assets.rs:935](crates/snapback-services/src/assets.rs:935) [assets_s3.rs:783](crates/snapback-services/src/assets_s3.rs:783) | **Yes.** The public cancel, terminate, and record-delete routes carry `PreparedAuthority`. [asset_routes.rs:121](crates/snapback-server/src/server/asset_routes.rs:121) [asset_routes.rs:318](crates/snapback-server/src/server/asset_routes.rs:318) [asset_routes.rs:598](crates/snapback-server/src/server/asset_routes.rs:598) | **No.** Caller validation/SQLite transition precedes store deletion, with no guard retained across the unlink/DELETE. [engine.rs:12571](crates/snapback-engine/src/local/engine.rs:12571) [engine.rs:13383](crates/snapback-engine/src/local/engine.rs:13383) [engine.rs:13779](crates/snapback-engine/src/local/engine.rs:13779) | Caller-lineage checks and idempotent NotFound handling do not close a retirement race at deletion. [engine.rs:12576](crates/snapback-engine/src/local/engine.rs:12576) [assets_store.rs:286](crates/snapback-services/src/assets_store.rs:286) | **Yes—destructive and irreversible.** Deleted bytes or S3 objects are not restored by a later refusal. |
| **Auth keyring rotation during request-code and step-up request** | Temp file fsync, rename publication, then parent-directory fsync. [keyring.rs:626](crates/snapback-kernel/src/auth/keyring.rs:626) [keyring.rs:646](crates/snapback-kernel/src/auth/keyring.rs:646) [keyring.rs:656](crates/snapback-kernel/src/auth/keyring.rs:656) | **Yes.** Both routes execute keyring-using plans from admitted contexts. [server.rs:16460](crates/snapback-server/src/server.rs:16460) [server.rs:14701](crates/snapback-server/src/server.rs:14701) [provider.rs:3896](crates/snapback-auth/src/auth/provider.rs:3896) [provider.rs:4014](crates/snapback-auth/src/auth/provider.rs:4014) | **Yes.** The route guard lexically encloses the plan and any rotation publication. [server.rs:16475](crates/snapback-server/src/server.rs:16475) [server.rs:14737](crates/snapback-server/src/server.rs:14737) | Guard itself. | Owner-only local file; not external. |
| **Auth keyring rotation during signup, recovery consume/rotate, and password set** | Same keyring rename plus parent-fsync cut. [keyring.rs:626](crates/snapback-kernel/src/auth/keyring.rs:626) | **Yes.** Signup/recovery consume carry `AdmissionLease`; password set/recovery rotation carry `PreparedAuthority`. [server.rs:16688](crates/snapback-server/src/server.rs:16688) [server.rs:16844](crates/snapback-server/src/server.rs:16844) [server.rs:17033](crates/snapback-server/src/server.rs:17033) [server.rs:17061](crates/snapback-server/src/server.rs:17061) | **No.** `with_active_key` may publish during planning; the admission guard is acquired only later for the SQLite issuance commit. [provider.rs:1591](crates/snapback-auth/src/auth/provider.rs:1591) [provider.rs:1968](crates/snapback-auth/src/auth/provider.rs:1968) [provider.rs:2284](crates/snapback-auth/src/auth/provider.rs:2284) [provider.rs:2307](crates/snapback-auth/src/auth/provider.rs:2307) [server.rs:15970](crates/snapback-server/src/server.rs:15970) | Keyring mutex serializes keyring writers; the later guarded issuance commit can refuse, but cannot undo the already-published ring. [keyring.rs:172](crates/snapback-kernel/src/auth/keyring.rs:172) [server.rs:15994](crates/snapback-server/src/server.rs:15994) | Not external; persistent owner-only key-state change, not rolled back by refusal. |
| **Auth keyring rotation during authorized-lease signing and post-reset issuer rebuild** | Same rename plus parent-fsync cut. [keyring.rs:626](crates/snapback-kernel/src/auth/keyring.rs:626) | **Yes.** Lease capture retains the original `AdmissionLease`; reset still owns its route lease and transition carrier. [engine.rs:4194](crates/snapback-engine/src/local/engine.rs:4194) [server.rs:23674](crates/snapback-server/src/server.rs:23674) | **No.** Lease signing runs after the capture guard and before the reservation guard; reset issuer authentication runs after reset publication with no reset guard. [engine.rs:14362](crates/snapback-engine/src/local/engine.rs:14362) [server.rs:26922](crates/snapback-server/src/server.rs:26922) [engine.rs:14438](crates/snapback-engine/src/local/engine.rs:14438) [server.rs:23868](crates/snapback-server/src/server.rs:23868) [provider.rs:2445](crates/snapback-auth/src/auth/provider.rs:2445) | Later lease reservation revalidates admission; reset’s stream ticket blocks successor exposure. Neither is atomic with the keyring cut. [engine.rs:14411](crates/snapback-engine/src/local/engine.rs:14411) [server.rs:23840](crates/snapback-server/src/server.rs:23840) | Not external; persistent owner-only rotation. |
| **RQS resume-key rotation during live token mint** | In-place truncate/write followed by `sync_all`. [rqs.rs:1265](crates/snapback-sync/src/rqs.rs:1265) [secure_file.rs:281](crates/snapback-kernel/src/secure_file.rs:281) | **Yes.** Initial live subscription has `PreparedAuthority`; delta refresh retains an admission lease. [engine.rs:18535](crates/snapback-engine/src/local/engine.rs:18535) [engine.rs:29202](crates/snapback-engine/src/local/engine.rs:29202) | **No.** `active()` may rotate/persist before the later live-publication guard. [engine.rs:17150](crates/snapback-engine/src/local/engine.rs:17150) [rqs.rs:1036](crates/snapback-sync/src/rqs.rs:1036) [engine.rs:18848](crates/snapback-engine/src/local/engine.rs:18848) [engine.rs:19015](crates/snapback-engine/src/local/engine.rs:19015) | Later publication guard can refuse the frame; key loss/rotation is explicitly availability-only, but it does not undo the file write. [rqs.rs:920](crates/snapback-sync/src/rqs.rs:920) | Not external; persistent local rotation affecting resume-token availability. |
| **Operation-detail key sidecar first publication** | Temp `sync_all`, atomic no-replace rename, then parent sync. [operation_detail.rs:196](crates/snapback-kernel/src/operation_detail.rs:196) | **Yes.** First seal is lazy and can occur while recording an admitted mutation’s retained operation detail. [operation_detail.rs:89](crates/snapback-kernel/src/operation_detail.rs:89) [operation_detail.rs:520](crates/snapback-kernel/src/operation_detail.rs:520) [storage.rs:21390](crates/snapback-kernel/src/storage.rs:21390) | **Yes on the traced mutation path.** The commit guard is acquired before `record_client_mutation_result`, which performs the seal. [storage.rs:5345](crates/snapback-kernel/src/storage.rs:5345) [storage.rs:5347](crates/snapback-kernel/src/storage.rs:5347) | Guard itself. | Owner-only local publication; not external. |
| **Config secure-file publication from watch creation and verification** | Owner-only temp write, rename, parent sync. [config.rs:707](crates/snapback-activation/src/config.rs:707) | **Yes.** Watch management has `PreparedAuthority`; config verification retains an `AdmissionLease`. [engine.rs:22677](crates/snapback-engine/src/local/engine.rs:22677) [engine.rs:21864](crates/snapback-engine/src/local/engine.rs:21864) | **Yes.** Watch guard precedes secret `config.set`; verification guard remains live through `record_verification`. [engine.rs:22683](crates/snapback-engine/src/local/engine.rs:22683) [engine.rs:22694](crates/snapback-engine/src/local/engine.rs:22694) [engine.rs:21925](crates/snapback-engine/src/local/engine.rs:21925) [engine.rs:21962](crates/snapback-engine/src/local/engine.rs:21962) | Guard itself. | Owner-only local file; watch-secret publication is security-sensitive but guarded. |
| **Protected-record checkpoint-copy erasure** | Successful `remove_dir_all`; directory crash persistence beyond the call is **INFERRED**. [proof_checkpoint.rs:2737](crates/snapback-kernel/src/proof_checkpoint.rs:2737) [proof_checkpoint.rs:2766](crates/snapback-kernel/src/proof_checkpoint.rs:2766) | **Yes.** Operation accepts `PreparedAuthority`. [engine.rs:6548](crates/snapback-engine/src/local/engine.rs:6548) | **Yes.** `try_fenced_publication` and `effect_guard` lexically enclose the erasure. [engine.rs:6611](crates/snapback-engine/src/local/engine.rs:6611) | Guard plus fenced-publication mechanism. | **Irreversible deletion, but guarded.** |
| **Derived-fork writer-coverage-gap sidecar** | Create-new file, `sync_all`, then parent-directory `sync_all`. [connections.rs:36](crates/snapback-kernel/src/storage/connections.rs:36) [connections.rs:60](crates/snapback-kernel/src/storage/connections.rs:60) [connections.rs:73](crates/snapback-kernel/src/storage/connections.rs:73) | **Conditionally yes.** `LocalIbexActionHost` contains `PreparedAuthority`; fork denial opens its registered writer before admission validation, and the sidecar is emitted only when fork evidence and a writer-coverage contradiction coexist. [engine.rs:4269](crates/snapback-engine/src/local/engine.rs:4269) [engine.rs:4277](crates/snapback-engine/src/local/engine.rs:4277) [connections.rs:122](crates/snapback-kernel/src/storage/connections.rs:122) | **No.** Admission validation follows the fork-denial write. [engine.rs:4280](crates/snapback-engine/src/local/engine.rs:4280) [engine.rs:4285](crates/snapback-engine/src/local/engine.rs:4285) | The outbound action is always refused and the marker is bounded/payload-free; that bounds severity but does not make the sidecar admission-safe. [instance_fork.rs:1427](crates/snapback-kernel/src/instance_fork.rs:1427) | Local operator-visible marker, not external. |
| **Opt-in spike/elevated-read JSONL traces** | Successful `flush`; no fsync. Therefore crash durability is **INFERRED**, not confirmed. [spike_trace.rs:57](crates/snapback-sync/src/spike_trace.rs:57) [elevated_read_trace.rs:96](crates/snapback-runtime/src/elevated_read_trace.rs:96) | **Conditionally yes**, only when the respective environment variable enables the trace; live and handler paths call them from admitted work. [spike_trace.rs:16](crates/snapback-sync/src/spike_trace.rs:16) [engine.rs:19001](crates/snapback-engine/src/local/engine.rs:19001) [host_glue.rs:2549](crates/snapback-engine/src/runtime/host_glue.rs:2549) | **No** at the shown calls. | None; diagnostic-only. | Operator-visible append, but not a confirmed crash-durable member of the class. |
| **`ctx.fetch` / `ctx.fetchStream` mutating request** | Remote receiver acceptance is the semantic cut; a response proves acceptance occurred, while a non-idempotent transport loss may leave initiation ambiguous. [server.rs:1737](crates/snapback-server/src/server.rs:1737) [server.rs:1744](crates/snapback-server/src/server.rs:1744) [server.rs:1793](crates/snapback-server/src/server.rs:1793) | **Yes.** Detached action host owns `PreparedAuthority`; both fetch surfaces allow POST/PUT/PATCH/DELETE. [server.rs:745](crates/snapback-server/src/server.rs:745) [server.rs:759](crates/snapback-server/src/server.rs:759) [server.rs:1600](crates/snapback-server/src/server.rs:1600) [server.rs:1893](crates/snapback-server/src/server.rs:1893) | **No.** Both sequences validate, send, then revalidate only after response metadata. [server.rs:1562](crates/snapback-server/src/server.rs:1562) [server.rs:1737](crates/snapback-server/src/server.rs:1737) [server.rs:1806](crates/snapback-server/src/server.rs:1806) [server.rs:1871](crates/snapback-server/src/server.rs:1871) [server.rs:2006](crates/snapback-server/src/server.rs:2006) [server.rs:2021](crates/snapback-server/src/server.rs:2021) | Service principals have an exact-token external-effect permit that delays matching terminalization, but ordinary sessions receive no such permit and the permit is not the admission-epoch mutex. [invocation.rs:1507](crates/snapback-sync/src/auth/invocation.rs:1507) [service_fence.rs:667](crates/snapback-auth/src/auth/service_fence.rs:667) | **Yes—arbitrary external and potentially irreversible.** A remote mutation, webhook-like call, payment, or disclosure cannot be rolled back locally; concrete downstream semantics are **INFERRED** from the authored destination. |
| **Expo push send** | Expo accepting the POST is the semantic cut; provider response/ticket confirms it, while transport/read uncertainty is classified ambiguous. [push.rs:47](crates/snapback-services/src/push.rs:47) [push.rs:72](crates/snapback-services/src/push.rs:72) [server.rs:662](crates/snapback-server/src/server.rs:662) | **Yes.** Action host owns `PreparedAuthority` and validates before reserving/transmitting. [server.rs:2053](crates/snapback-server/src/server.rs:2053) | **No.** Service permit and transmitting marker precede provider transmission; admission is checked again only during settlement. [server.rs:2109](crates/snapback-server/src/server.rs:2109) [server.rs:2134](crates/snapback-server/src/server.rs:2134) [server.rs:2143](crates/snapback-server/src/server.rs:2143) | Exact-service permit is partial protection for service-token termination, not the general admission epoch. | **Yes—external and non-rollbackable.** Provider acceptance can lead to device delivery after local refusal. |
| **Watch webhook delivery** | Receiver acceptance is the semantic cut; 2xx confirms success. A transport error after send is **INFERRED** ambiguous because the implementation retries without proof of non-initiation. [webhooks.rs:114](crates/snapback-services/src/webhooks.rs:114) [webhooks.rs:135](crates/snapback-services/src/webhooks.rs:135) [webhooks.rs:142](crates/snapback-services/src/webhooks.rs:142) | **Yes.** The durable job claim contains an `AdmissionLease`, and watch execution derives `PreparedAuthority` from it. [engine.rs:1728](crates/snapback-engine/src/local/engine.rs:1728) [engine.rs:1793](crates/snapback-engine/src/local/engine.rs:1793) [engine.rs:23042](crates/snapback-engine/src/local/engine.rs:23042) | **No.** Owner/watch/function/target/secret are rechecked immediately before spawning delivery, but no guard crosses the POST. [engine.rs:23305](crates/snapback-engine/src/local/engine.rs:23305) [server.rs:3407](crates/snapback-server/src/server.rs:3407) [server.rs:3415](crates/snapback-server/src/server.rs:3415) | Strong pre-send structural revalidation narrows stale state, but retirement can occur after the recheck and before receiver acceptance. [engine.rs:23310](crates/snapback-engine/src/local/engine.rs:23310) [engine.rs:23326](crates/snapback-engine/src/local/engine.rs:23326) [engine.rs:23346](crates/snapback-engine/src/local/engine.rs:23346) | **Yes—external and irreversible once accepted.** |
| **`api.ask` provider completion** | Provider acceptance of the chat-completions POST is the semantic cut; a successful response confirms acceptance. Provider receipt after a transport error is **INFERRED**. [ask.rs:278](crates/snapback-engine/src/ask.rs:278) [ask.rs:318](crates/snapback-engine/src/ask.rs:318) | **Yes.** Route receives `PreparedAuthority` and passes it into the ask loop. [server.rs:25006](crates/snapback-server/src/server.rs:25006) [server.rs:25205](crates/snapback-server/src/server.rs:25205) | **No.** The loop has the authority, but `chat_completion` receives only provider configuration, key, messages/tools, and budgets; no guard spans the POST. [server.rs:24580](crates/snapback-server/src/server.rs:24580) [server.rs:24645](crates/snapback-server/src/server.rs:24645) [ask.rs:278](crates/snapback-engine/src/ask.rs:278) | Local spend reservation/settlement bounds accounting but does not recheck admission at provider acceptance. [server.rs:25075](crates/snapback-server/src/server.rs:25075) [server.rs:25126](crates/snapback-server/src/server.rs:25126) | **Yes—task/messages leave the process irreversibly.** Provider billing is **INFERRED**; the code supports app or caller-key billing modes. [server.rs:25041](crates/snapback-server/src/server.rs:25041) |
| **Asset GC/reconciliation deletion** | Same local unlink/S3 DELETE cuts as asset cleanup. [engine.rs:13815](crates/snapback-engine/src/local/engine.rs:13815) [engine.rs:13925](crates/snapback-engine/src/local/engine.rs:13925) | **No—out of property scope.** The scheduled sweep takes `now_ms`, not an admission carrier. [engine.rs:13810](crates/snapback-engine/src/local/engine.rs:13810) | N/A | GC receipts and condemn/reconcile state, but no admission epoch to retire. [engine.rs:13911](crates/snapback-engine/src/local/engine.rs:13911) | Destructive, but not an admitted-caller race. |
| **S3 native multipart and `copy_blob`** | Multipart create/complete/copy: provider 200; abort: 204/404. [assets_s3.rs:484](crates/snapback-services/src/assets_s3.rs:484) [assets_s3.rs:523](crates/snapback-services/src/assets_s3.rs:523) [assets_s3.rs:551](crates/snapback-services/src/assets_s3.rs:551) [assets_s3.rs:818](crates/snapback-services/src/assets_s3.rs:818) | **No production admitted caller found—INFERRED.** The source labels multipart as activating with future S3 attempt routes, while proxied append is explicitly unsupported. [assets_s3.rs:481](crates/snapback-services/src/assets_s3.rs:481) [assets_s3.rs:655](crates/snapback-services/src/assets_s3.rs:655) | N/A | N/A until a caller exists. | Externally visible if activated. |

## Reachable and unguarded, ranked

1. **Critical — reset `wipe_all`.** It is authority-transition-time, namespace-wide, destructive, outside the reset guard, best-effort, and can partially delete local or S3 custody before any later reset refusal. [server.rs:23784](crates/snapback-server/src/server.rs:23784) [server.rs:23854](crates/snapback-server/src/server.rs:23854) [engine.rs:8625](crates/snapback-engine/src/local/engine.rs:8625) [assets_s3.rs:833](crates/snapback-services/src/assets_s3.rs:833)

2. **High — owner-driven asset deletion and cleanup.** Cancel, terminate, explicit delete, finalize cleanup, and failure cleanup can irreversibly remove local or S3 objects after authority validation but without a guard at deletion. [engine.rs:12571](crates/snapback-engine/src/local/engine.rs:12571) [engine.rs:13383](crates/snapback-engine/src/local/engine.rs:13383) [engine.rs:13417](crates/snapback-engine/src/local/engine.rs:13417) [engine.rs:13779](crates/snapback-engine/src/local/engine.rs:13779)

3. **High — arbitrary mutating `ctx.fetch` / `ctx.fetchStream`.** The remote service can accept an arbitrary application-authored POST/PUT/PATCH/DELETE before the post-response authority check. [server.rs:1600](crates/snapback-server/src/server.rs:1600) [server.rs:1737](crates/snapback-server/src/server.rs:1737) [server.rs:1806](crates/snapback-server/src/server.rs:1806) [server.rs:2006](crates/snapback-server/src/server.rs:2006)

4. **High — asset canonical/blob/variant publication.** Authority-free tickets and store calls can publish local or S3 objects between caller validation and later completion checks; local refusal can leave orphans, and S3 acceptance is already external. [asset_routes.rs:167](crates/snapback-server/src/server/asset_routes.rs:167) [asset_routes.rs:185](crates/snapback-server/src/server/asset_routes.rs:185) [assets.rs:626](crates/snapback-services/src/assets.rs:626) [engine.rs:12945](crates/snapback-engine/src/local/engine.rs:12945)

5. **High — push and webhook delivery.** Provider/receiver acceptance is externally observable and cannot be undone by later local settlement refusal; both lanes rely on preflight or service-token fencing rather than the admission mutex. [server.rs:2109](crates/snapback-server/src/server.rs:2109) [server.rs:2134](crates/snapback-server/src/server.rs:2134) [server.rs:3407](crates/snapback-server/src/server.rs:3407) [webhooks.rs:135](crates/snapback-services/src/webhooks.rs:135)

6. **High — `api.ask` provider call.** The admitted caller’s task and accumulated messages reach the provider without a guard spanning the POST; provider charging is **INFERRED**, but disclosure is direct. [server.rs:24580](crates/snapback-server/src/server.rs:24580) [server.rs:24645](crates/snapback-server/src/server.rs:24645) [ask.rs:318](crates/snapback-engine/src/ask.rs:318)

7. **Medium — TUS staging append.** Bytes are fsynced under the stale ticket before caller/admission re-entry; the same-attempt mutex and later offset CAS preserve upload continuity but not admission atomicity. [asset_routes.rs:266](crates/snapback-server/src/server/asset_routes.rs:266) [asset_routes.rs:291](crates/snapback-server/src/server/asset_routes.rs:291) [assets_store.rs:193](crates/snapback-services/src/assets_store.rs:193)

8. **Medium — auth keyring rotations during password/recovery planning, lease signing, and reset issuer rebuild.** These are owner-only local effects rather than external actions, but the file can publish before the later guarded database/reservation step. [provider.rs:1591](crates/snapback-auth/src/auth/provider.rs:1591) [provider.rs:1968](crates/snapback-auth/src/auth/provider.rs:1968) [provider.rs:2480](crates/snapback-auth/src/auth/provider.rs:2480) [server.rs:23868](crates/snapback-server/src/server.rs:23868)

9. **Low–medium — RQS resume-key rotation.** It can fsync a new key state before the live publication guard, but the subsystem explicitly treats key loss as availability-only. [rqs.rs:920](crates/snapback-sync/src/rqs.rs:920) [rqs.rs:1036](crates/snapback-sync/src/rqs.rs:1036) [engine.rs:19015](crates/snapback-engine/src/local/engine.rs:19015)

10. **Low — conditional derived-fork coverage-gap sidecar.** It is genuinely fsynced before admission validation, but the attempted egress is always refused and the sidecar is bounded and payload-free. [connections.rs:36](crates/snapback-kernel/src/storage/connections.rs:36) [engine.rs:4277](crates/snapback-engine/src/local/engine.rs:4277) [instance_fork.rs:1427](crates/snapback-kernel/src/instance_fork.rs:1427)

11. **Adjacent, durability unconfirmed — opt-in JSONL traces.** They flush outside admission guards, but no fsync establishes crash durability. [spike_trace.rs:73](crates/snapback-sync/src/spike_trace.rs:73) [elevated_read_trace.rs:112](crates/snapback-runtime/src/elevated_read_trace.rs:112)

## Irreversible or externally visible subset

- **Irreversible destruction:** reset wipe, owner-driven asset deletion/cleanup, and protected-checkpoint deletion; the checkpoint case is guarded, while reset and owner-asset deletion are not. [assets.rs:874](crates/snapback-services/src/assets.rs:874) [engine.rs:12571](crates/snapback-engine/src/local/engine.rs:12571) [engine.rs:13779](crates/snapback-engine/src/local/engine.rs:13779) [engine.rs:6611](crates/snapback-engine/src/local/engine.rs:6611)

- **External, non-rollbackable effects:** S3 PUT/DELETE, arbitrary mutating fetch, Expo push, webhook delivery, and ask-provider submission. [assets_s3.rs:666](crates/snapback-services/src/assets_s3.rs:666) [assets_s3.rs:783](crates/snapback-services/src/assets_s3.rs:783) [server.rs:1737](crates/snapback-server/src/server.rs:1737) [push.rs:72](crates/snapback-services/src/push.rs:72) [webhooks.rs:135](crates/snapback-services/src/webhooks.rs:135) [ask.rs:318](crates/snapback-engine/src/ask.rs:318)

- **Persistent but not ordinarily external:** TUS staging bytes, canonical local staging, auth/RQS keyrings, the fork-coverage sidecar, and diagnostic traces. Later admission refusal does not itself roll these effects back. [assets_store.rs:181](crates/snapback-services/src/assets_store.rs:181) [keyring.rs:626](crates/snapback-kernel/src/auth/keyring.rs:626) [rqs.rs:1265](crates/snapback-sync/src/rqs.rs:1265) [connections.rs:36](crates/snapback-kernel/src/storage/connections.rs:36)

## Completeness boundary for this class

This census covers the production source-visible non-SQL sinks in the current Rust workspace that are reachable from `AdmissionLease`, `PreparedAuthority`, `PreparedInvocation`, or `AdmittedJobClaim`: the complete `AssetStore` mutation interface and its local/S3 implementations; direct owner-only file writes, renames, removals and fsyncs on admitted chains; the operation-detail and fork-coverage sidecars; admitted diagnostic appenders; and the direct production HTTP provider lanes for fetch, push, webhook, ask, and S3. [assets_store.rs:38](crates/snapback-kernel/src/assets_store.rs:38) [secure_file.rs:281](crates/snapback-kernel/src/secure_file.rs:281) [server.rs:745](crates/snapback-server/src/server.rs:745) [engine.rs:1728](crates/snapback-engine/src/local/engine.rs:1728)

Examined but excluded because they have no app-admission carrier: scheduled asset GC, startup creation of resume/completeness keyrings, and administrative metadata/backup/fork/replication operations, whose host-operation contract requires `prepared_authority: None`. [engine.rs:13810](crates/snapback-engine/src/local/engine.rs:13810) [engine.rs:24550](crates/snapback-engine/src/local/engine.rs:24550) [engine.rs:24562](crates/snapback-engine/src/local/engine.rs:24562) [host_ops.rs:1129](crates/snapback-engine/src/host_ops.rs:1129)

Still unverified:

- **INFERRED:** crash persistence of local unlink/remove-directory operations that do not sync their parent directory, and flush-only diagnostic traces. [assets.rs:889](crates/snapback-services/src/assets.rs:889) [proof_checkpoint.rs:2750](crates/snapback-kernel/src/proof_checkpoint.rs:2750) [spike_trace.rs:73](crates/snapback-sync/src/spike_trace.rs:73)

- **INFERRED:** exact provider state after a request was transmitted but no response arrived; fetch explicitly models that ambiguity, while webhook, ask, and S3 expose only transport failure versus response status. [server.rs:1744](crates/snapback-server/src/server.rs:1744) [webhooks.rs:142](crates/snapback-services/src/webhooks.rs:142) [ask.rs:324](crates/snapback-engine/src/ask.rs:324) [assets_s3.rs:147](crates/snapback-services/src/assets_s3.rs:147)

- **INFERRED:** no production admitted callers currently reach S3 native multipart or `copy_blob`; their concrete implementations were reviewed, but future route activation would reopen that admission analysis. [assets_s3.rs:481](crates/snapback-services/src/assets_s3.rs:481) [assets_s3.rs:818](crates/snapback-services/src/assets_s3.rs:818)

- **INFERRED:** macro-generated, dynamically dispatched, hosted implementation, dependency-internal, or provider-side effects not visible in this source tree. This remains a source census, not compiler-enforced effect analysis—the same limitation the SQLite census records for its own class. [unguarded census:250](issues/20260821-unguarded-durable-writes-admission-fence.md:250)

Accordingly, this is source-complete for the enumerated production Rust sinks and admitted call chains, not a claim of whole-system or provider-side completeness.
---

# Appendix: reset-wipe adjudication (2026-08-21)

## Verdict

No—in the risk-defining sense, there is no source-visible path where `AssetStore::wipe_all` deletes custody and the durable reset is later refused or rolled back.

There are paths where deletion is followed by an API error, panic, incomplete process-state publication, or process death. But every such path is after the reset/seed SQLite transaction is known committed. Those failures leave the committed reset in force and the process either reset, fail-closed, wedged closed, or restarted from the committed successor. They cannot restore or continue serving the predecessor database.

Therefore:

- Reset `wipe_all`: **Neither / no admission-remedy finding**, not Critical.
- Confidence: **High, approximately 0.97**.
- The Critical entries in [20260821-nonsql-durability-census.md:97](issues/20260821-nonsql-durability-census.md:97), [line 105](issues/20260821-nonsql-durability-census.md:105), and [line 129](issues/20260821-nonsql-durability-census.md:129) need amendment.
- The substantive “Neither” conclusion is correct. On current main, that row is actually in [20260821-authorized-effect-remedy-classification.md:184](issues/20260821-authorized-effect-remedy-classification.md:184); the named handoff-design file contains no `wipe_all` row.

## Exact control flow

1. Both server families enter with an `AdmissionLease`: legacy `app.reset` at [server.rs:24136](crates/snapback-server/src/server.rs:24136), and versioned reset-install/clear at [server.rs:24199](crates/snapback-server/src/server.rs:24199) and [server.rs:24221](crates/snapback-server/src/server.rs:24221).

2. `coordinated_app_reset_inner` installs the stream-reset ticket before SQLite at [server.rs:23830](crates/snapback-server/src/server.rs:23830).

3. The admission effect guard is acquired around the database attempt at [server.rs:23843](crates/snapback-server/src/server.rs:23843). A guard refusal becomes `RolledBack`; no wipe follows.

4. Both variants run `reset_and_seed_transaction`. That single transaction:

   - deletes app rows;
   - deletes all 13 asset-system tables at [schema_seed.rs:85](crates/snapback-kernel/src/storage/schema_seed.rs:85);
   - rotates the data-version stream;
   - writes the authorization-stream successor at [schema_seed.rs:117](crates/snapback-kernel/src/storage/schema_seed.rs:117);
   - optionally installs the seed and versioned receipt.

5. The exact commit sites are:

   - Legacy: `tx.commit()` at [schema_seed.rs:570](crates/snapback-kernel/src/storage/schema_seed.rs:570).
   - Versioned reset: `tx.commit()` at [schema_seed.rs:719](crates/snapback-kernel/src/storage/schema_seed.rs:719).

   A failed COMMIT acknowledgement is classified `Committed` only if readback finds the exact fresh successor; otherwise it is `RolledBack` or `CommitUncertain` ([legacy readback](crates/snapback-kernel/src/storage/schema_seed.rs:578), [versioned readback](crates/snapback-kernel/src/storage/schema_seed.rs:727)). This fresh-successor equality is the commit-certainty proof.

6. `wipe_all` is not reached for:

   - `finalization_error`, handled at [server.rs:23875](crates/snapback-server/src/server.rs:23875);
   - `RolledBack`, returned at [server.rs:23905](crates/snapback-server/src/server.rs:23905);
   - `CommitUncertain`, returned at [server.rs:23912](crates/snapback-server/src/server.rs:23912).

7. Only the known-`Committed` branch retains the closed writer handoff at [server.rs:23920](crates/snapback-server/src/server.rs:23920), publishes reset-owned process state at [server.rs:23943](crates/snapback-server/src/server.rs:23943), and then invokes:

   - versioned wipe at [engine.rs:8824](crates/snapback-engine/src/local/engine.rs:8824);
   - legacy wipe at [engine.rs:8847](crates/snapback-engine/src/local/engine.rs:8847).

   In both functions, `finish_committed_reset` runs before `wipe_all`. Thus by the first deletion, both the durable reset and most local reset state are already installed.

Within Snapback’s SQLite durability model, that transaction is durable and irrevocable at this point. Source cannot establish guarantees against broken storage hardware, but no later program path can roll it back.

## What can still fail after deletion starts

| Later event | Control flow | Resulting state |
|---|---|---|
| Local wipe partially fails | `read_dir` can return early; entry errors are skipped by `.flatten()`; every `remove_file` result is discarded at [assets.rs:877](crates/snapback-services/src/assets.rs:877). The caller also discards `wipe_all`’s result. | Database reset remains committed. Some unreferenced files may remain. |
| S3 wipe partially fails | Objects are deleted individually at [assets_s3.rs:833](crates/snapback-services/src/assets_s3.rs:833). A transport error or non-204/404 response returns after earlier deletes; the caller discards that error. | Database reset remains committed. The S3 prefix may be partially populated. |
| Reset after-Local batch errors | The generic handoff wrapper can return an after-Local error at [writer_gate.rs:214](crates/snapback-server/src/server/writer_gate.rs:214), producing the early return at [server.rs:23957](crates/snapback-server/src/server.rs:23957). The exact reset batch currently queues infallible callbacks, so no concrete typed producer was found on this trace; this is a defensive edge. | Durable reset remains. The code clears issuer state and classifies the process fail-closed. |
| Sessions-mode issuer rebuild fails | Database reservation, successor match, provider authentication, or issuer installation can fail at [engine.rs:8084](crates/snapback-engine/src/local/engine.rs:8084). Server returns at [server.rs:23997](crates/snapback-server/src/server.rs:23997). | Durable reset remains; successor serving stays closed. |
| Final stream-ticket settlement fails | `finish_stream_reset` can fail through poisoned topology, its failpoint, exact-ticket finalization failure, or successor mismatch at [coordinator.rs:974](crates/snapback-sync/src/auth/coordinator.rs:974). Sessions and dev return errors at [server.rs:24023](crates/snapback-server/src/server.rs:24023) and [server.rs:24058](crates/snapback-server/src/server.rs:24058). | Durable reset remains; coordinator is made globally fail-closed. |
| Cleanup errors are ignored | Fail-closed cleanup and `fail_global_closed` results are deliberately discarded at [server.rs:23960](crates/snapback-server/src/server.rs:23960) and [server.rs:24036](crates/snapback-server/src/server.rs:24036). Current code uses `let _`, not a relevant `.ok()`. | No rollback. At worst, the process remains more tightly closed or wedged. |
| Panic during or after wipe | The publication closure is caught, its after-Local batch is attempted, and the panic is resumed at [writer_gate.rs:206](crates/snapback-server/src/server/writer_gate.rs:206). The owned task then fails and is mapped to an auth-projection error at [server.rs:537](crates/snapback-server/src/server.rs:537). Dropping `CommittedResetHandoff` does not reopen it ([writer_gate.rs:182](crates/snapback-server/src/server/writer_gate.rs:182)). | Durable reset remains; managed access stays closed. |
| Process death | Possible at any instruction between individual deletes and final ticket release. | Memory state disappears, but the database contains the committed successor. Startup rebuilds the coordinator from the durable admitted snapshot at [engine.rs:4718](crates/snapback-engine/src/local/engine.rs:4718). |
| Request disconnect/cancellation | The reset was transferred to an independently owned task at [server.rs:23740](crates/snapback-server/src/server.rs:23740). | It does not cancel the committed continuation. A lost HTTP response is only lost acknowledgement. |

Consequently, an API-level “reset failed” response after the wipe is possible. A live predecessor instance with deleted assets is not: durable reset state is already in force, and incomplete successor installation stays fail-closed.

## Stream-reset ticket

Yes, it blocks observation of a half-installed authorization successor.

Installing the ticket puts a pending ticket into the shared stream fence at [session_projection.rs:2305](crates/snapback-sync/src/auth/session_projection.rs:2305). Publication is admissible only when the incarnation matches and `pending_tickets` is empty ([session_projection.rs:411](crates/snapback-sync/src/auth/session_projection.rs:411)); pending reset therefore refuses new publication. Finalization changes the incarnation and removes the ticket atomically at [session_projection.rs:2358](crates/snapback-sync/src/auth/session_projection.rs:2358).

That matters for client-visible consistency and successor exposure. It is not what authorizes `wipe_all`; the already-committed reset transaction does that.

## Route split

- Legacy `app.reset`: known commit before wipe. **Neither.**
- Versioned `resetInstall` and `clear`: same shared transaction and ordering. **Neither.** An idempotent receipt replay returns before the reset coordinator and does not re-run the wipe at [server.rs:23790](crates/snapback-server/src/server.rs:23790).
- Direct-library `reset_with_seed`: also invokes publication/wipe only from `AuthTransactionAttempt::Committed` at [engine.rs:8614](crates/snapback-engine/src/local/engine.rs:8614). Same verdict.
- `snapback reset --dev-fresh`: not a `wipe_all` route. It validates local whole-store ownership and directly removes the database siblings and `assets/blobs` at [index.mjs:3439](packages/snapback-cli/index.mjs:3439) and [index.mjs:3546](packages/snapback-cli/index.mjs:3546), then starts and seeds a fresh process. It can report failure after deletion at [index.mjs:5316](packages/snapback-cli/index.mjs:5316), but that is a separate explicitly destructive offline workflow, not evidence against `AssetStore::wipe_all`.
- The ordinary packaged reset delegates to native `app.reset`; it is not data-preserving for app rows/assets, only for the broader managed-store configuration ([index.mjs:5575](packages/snapback-cli/index.mjs:5575)). A genuinely data-preserving live-evolution path does not call `wipe_all`.

## Crash durability and reconciliation

A partially wiped store after crash is possible and, at the namespace level, confirmed by the sequential implementation. Which completed local unlinks survive a power loss is **INFERRED** because no parent directory is fsynced.

Also, current local `wipe_all` does not remove either directory; it only unlinks files. The census’s “directory removal” observation applies to other cleanup such as `--dev-fresh`, not this function.

After restart:

- Leftover staging objects are reconciled. The mandatory GC compares enumerated staging keys against durable live attempts and removes orphans at [engine.rs:14451](crates/snapback-engine/src/local/engine.rs:14451); the autonomous loop runs that sweep at [server.rs:20044](crates/snapback-server/src/server.rs:20044).
- Leftover blob objects are not generally reconciled. `AssetStore` exposes `list_staging_keys` but no blob enumeration at [assets_store.rs:93](crates/snapback-kernel/src/assets_store.rs:93). Blob GC only follows durable condemned rows at [engine.rs:14528](crates/snapback-engine/src/local/engine.rs:14528), and reset deleted those rows. Orphan blobs therefore remain until another namespace wipe or operator-level inspection.
- The database contains no wipe-completion marker, partial-wipe state, or retained asset rows. From the application/database perspective, a partial wipe looks exactly like a successful one. Local filesystem or S3-prefix inspection can expose leftovers, but ordinary app state cannot.

The filesystem crash question cannot be strengthened beyond **INFERRED** from source. The confirming experiment is a failpoint/SIGKILL or power-cut test after the Nth unlink on each supported filesystem, followed by restart inspection of both namespaces and a maintenance sweep. That experiment would establish which directory-entry deletions survive without parent fsync; it would not change the authorization verdict.