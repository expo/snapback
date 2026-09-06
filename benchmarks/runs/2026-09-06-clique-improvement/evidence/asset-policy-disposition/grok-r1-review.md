# Design review: Snapback2 released-asset grace custody

**Verdict: CHANGES_REQUIRED**

**Reviewer:** Grok 4.6, reasoning effort xhigh, native session, no subagents  
**Date:** 2026-09-06  
**Design:** `policy-design.md`  
**Design SHA-256 (frozen, unchanged):** `c5761dbc8e27e688ea462cf36cb1fe177e53526d32e93a5ef3ec308a5f26378d`  
**Scope:** design critique only. No product edits, tests, runtime services, credentials, or resource provisioning.

This is not a correct, minimal, implementable resolution of the demonstrated pending-slot exhaustion as written. The diagnosis of the 40-object coupling is right, the trilemma is named honestly, and several existing invariants (affine claim, 24h `max(created_at, released_at)`, creator-only discard, replay terminals, ambiguous upload retention) are preserved. The proposed envelope then puts regenerable derived rungs and 4 KiB view floors into the same quota that gates release, which makes individually undeletable assets a consequence of published helper ceilings rather than a rare oversized original. The diagnostic contract (`E_ASSET_CAPACITY` in family `assets`, HTTP 422 on upload, structured pool fields on mutation/replay terminals) does not fit the actual rejection carriers in source. A simpler complete design exists that still has a finite garbage bound and does not waive the 24-hour original-asset grace.

## 1. What was read

Complete `policy-design.md` (329 lines). Complete public-package `investigation-report.md` and its asset evidence under `revisions/010-assets-migration/evidence/` (including `a-committed/after-40-releases-database.json`, `a-dedup/two-identical-uploads-database.json`, and the stopped a-dedup blob files). No other reviews, benchmark runs, scores, narratives, or unrelated worktrees.

Governing docs and asset source were read with `git show` in `/Users/ccheever/projects/snapback` at the design’s pins, not from live worktrees:

| Pin | Identity (verified) |
|---|---|
| Public 0.0.10 | `967f857e66b504dcea6286f10565c80fd2bf7d64`; tree `7df954662eb4b66758f9b9d62d5946559a0002c8`; `snapback2` subtree `18a6b6059b78a4026ef30dbb00c5fb27b6e334a8` |
| Release lane | `e5ae9d09be1f30906a57f08bd3ba4d28dd7cbc5c`; only `snapback2/metrics/loop.jsonl` differs under `snapback2/` |
| Current committed | `5e066ccc010265c7df526483d44163ff32feb8be`; `snapback2` subtree identical to the release lane (`566b38bf…`) |
| Checkout trap | `/Users/ccheever/projects/snapback` HEAD is `08643f8b…`, as the design warns |

All extracted asset implementation files, LLP 1006, operator/offline guides, and `families.source.json` are byte-identical between `967f857` and `5e066ccc`. LLP 1000 / `NOT-DOING.md` differ only in the unrelated 66,000/64,000 local-runtime measurement budget. That grants no asset-storage increase.

Also read: `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000 decisions 1/4/7, LLP 1006 (Accepted; §§2a, 4–6, 9–10, 14), LLP 1006.001 as record only, LLP 1012 §7 “Writes offline” (envelope + replay) and §9 device bytes, `guide/operator.md` “Recovering abandoned media uploads”, `guide/offline.md`.

## 2. Evidence versus conjecture

**Established by investigation evidence + matching source (not conjecture):**

- Committed locators do not consume staging. `a-committed/before-releases-database.json`: 43 ready located rows, zero unlocated. Usage query is unlocated `receiving` or unlocated `ready` with `reclaiming = 0` (`assets_ledger.rs:247–259`).
- Forty successful deletes exhaust the owner object ceiling. `after-40-releases-database.json`: 43 ledger rows, 3 located, 40 unlocated ready with `released_at` set, `charged.objects = 40`, `charged.bytes = 6204` (payloads in `{128…158}`, not uniform 155). A fresh principal with usage 0 gets HTTP 422 at `/api/upload` before a mutation is sent. Message cites 40 objects / 536870912 bytes.
- The 20/40 and 256/512 MiB constants are `STAGING_PER_PRINCIPAL_*` / `STAGING_GLOBAL_*` (`assets_ledger.rs:14–17`). `enforce_staging_caps` runs on begin/growth, never on `reconcile_row_assets` (`assets_ledger.rs:214–232`, `542–616`).
- Ready tombstones drop out of usage immediately (`reclaiming = 1` fails `state = 'ready' AND reclaiming = 0`). Failed rows (`asset_mark_failed`, `assets_ledger.rs:378–388`) also leave the query. Forty is an admission ceiling, not an invariant that `_assets` cannot hold 41 unlocated rows.
- Immutable IDs do not deduplicate: two identical PNGs, two IDs, two 158-byte blobs, `st_blocks = 8` → 4096 bytes allocated, SQLite header page size 4096 on the stopped a-dedup store. The 4 KiB *logical* floor is a real fixture observation; it is not a measurement of every identity’s SQLite/index/APFS overhead. The design already says that.
- Client automatic File uploads are discarded after a definitive `rejected` result; explicit uploads and ambiguous/queued outcomes are retained (`client-upload.ts:105–141`). `dismiss` does not remove a queued intent (`store/outbox.ts:380–387`).
- Replay stores terminals, including rejections; conflict beats program rejection (LLP 1012 §7; `replay.rs:156–164`). Grant lifetime is 30 days (`offline.rs:14`, `REPLAY_GRANT_LIFETIME_MS`). Server asset grace is 24h (`ASSET_RECLAIM_GRACE_MS`, `assets_ledger.rs:13`). No server media pin exists.

**Conjecture (design or this review, labeled as such):**

- Ordinary edit rate, rung-size distribution, and whether a production Clique store would hit single-asset `C(i) > 512 MiB`. No workload evidence. The *possibility* of `C(i) > envelope` is not conjecture: it follows from 12 rungs (`IMAGE_WIDTH_RUNGS`, `asset_http.rs:20–22`) times `MAX_OUTPUT_BYTES = 64 MiB` (`media.rs:31`) plus original plus `H × W(i)`.
- Exact physical disk for a full 65,504-identity store. The design does not claim it; neither does this review.
- That 64 HTTP workers can all be in-flight once-consumes. **Bound:** `/api/asset/*` is `WorkerClass::Json` (`serve.rs:163–176`). JSON can occupy all 60 non-control slots (`MAX_NON_CONTROL_WORKERS = 60`, `serve.rs:27–31, 203–210`). Using 64 is conservative, not exact.

## 3. What the design gets right

The opening compatibility sentence is the right one: unlimited successful release, full 24h grace, and a fixed garbage bound cannot all be guaranteed for an arbitrarily large live application. Excluding `released_at IS NOT NULL` from the existing query alone would create an unbounded retained pool. Raising 20/40, adding a second 512 MiB, silently shortening grace, content-dedup, or auto-discard on commit are correctly rejected.

The pending-object split is the actual repair of observation A:

- Pending count = unlocated receiving (including a cancelled finalizer still holding a file) plus never-claimed ready (`released_at IS NULL`, not reclaiming).
- Released grace does not consume 20/40.
- Claimed locators stay outside the garbage envelope.
- The 40-delete fixture then has pending objects = 0 and a small `C` (~333,884 bytes under the published formula). A fresh upload can proceed. That matches the required product outcome for the demonstrated case.

Net final-state admission in the same application transaction is required. The reconciler currently **releases then claims** (`assets_ledger.rs:590–616`). An intermediate check after the release UPDATEs would charge both the old image and the still-unclaimed new image. Replacement at a full envelope would spuriously fail. Placing the check after `check_final_constraints` / `assert_bounds` and **before** `replay::finish_run` (`engine/mod.rs:634–649`) is the correct insertion point. Jobs must check before `save` of cursor/progress (`engine/jobs.rs:118–153`). Cross-creator attribution by immutable `created_by` matches `validate_asset_use` + the usage query.

Failed physical cleanup must keep a charge. Current ready discard sets `reclaiming = 1` and immediately frees the 20/40/byte query while blobs may still exist (`discard_upload` + `sweep_asset_blobs`). That is a real free-credit hole. Charging until `finish_asset_reclaims` closes it.

Scratch uniqueness is a real unbounded-disk hole: `allocate_path` mints a new `{label}-{hex}-{seq}.stage` every call (`blob_store.rs:156–168`); `render_rung` / HEIC normalize do not keep a failed path on a slot (`asset_http.rs:788–800, 950–987`). Attaching temps to the existing upload/rung guard and refusing to recycle the slot on unlink failure is the right shape. Boot `sweep_named_temporaries` already deletes matching names or refuses startup (`blob_store.rs:620–662`); the design’s “succeed or refuse positive allocation” matches that.

Offline/ambiguity policy matches LLP 1006 §10 and LLP 1012 §7: do not infer abandonment from `released_at`, age, or a `committed` return-only mutation; do not auto-rewrite queued args; document that 24h asset TTL is shorter than the 30-day replay grant. `withMutationUploads` already implements the custody boundary the design wants to keep.

Creator isolation is already in source (`unclaimed_uploads` + `discard_upload` created_by predicates; foreign/missing both return `false` except `E_ASSET_IN_USE` for own claimed IDs). Listing must not expose foreign IDs. The proposed `ownerCustodyFull` boolean without global exact totals is the right public surface.

The design does not fabricate proof that `C` is total disk, does not raise 256/512 MiB, and does not waive the 86,400,000 ms grace for ordinary unclaimed IDs.

## 4. Why it is not READY

### 4.1 Individually undeletable assets are a product of the envelope, not a footnote

The formula (`policy-design.md` §4):

```
C(i) = payload(i) + V(i) + H × (2 + K(i) + W(i))
```

`V(i)` is reserved/persisted derived-width sizes, `K(i) ≤ 12`. The helper may emit up to 64 MiB per rung. Twelve rungs plus an original can be `C(i) > 512 MiB − 262,144` **for one image**, using only published ceilings (`IMAGE_WIDTH_RUNGS` length 12, `MAX_OUTPUT_BYTES`). `W(i)` is every durable once-view. Guest mint is free (`LLP 1006 §4`); a popular `once` image can push `H × W(i)` past the envelope on release even with a small original.

While the asset is claimed, that footprint is “outside the garbage envelope.” Release is the first time it must fit. If `required > limit`, the design says waiting cannot help and the old locator remains live. That is a deadlock: rungs cannot be GC’d because the locator is still set; the locator cannot be cleared because `C` does not fit.

This is not the 50 MiB × 11 original-payload case the prose uses as illustration. It is any image that has materialized a near-ceiling rung ladder, or any `once` image with a large view table. The investigation never rendered rungs or once-views; there is **no evidence** this is rare. The published ceilings make it **legal**.

Charging regenerable rungs and 4 KiB-per-view into the release gate is unnecessary for a finite original-payload bound. LLP 1006 §8 treats rungs as a lazy cache (“renders a rung on its first request and keeps it”; eager rendering is a server-only switch). Grace in §9 is for the unlocated **asset** (original + identity), not for derived JPEGs. Dropping or immediately deleting unlocated rungs does not shorten the 24h original grace and does not invalidate a queued claim of that ID.

The 64-worker late-view margin (`64 × 4096 = 262,144` standing tax on every admission) exists only because `W(i)` is in `C` and `record_asset_view` can run after release (`assets_ledger.rs:125–147` does not check locator; `deliver_once` consumes after the body, `asset_http.rs:564–602`). `_asset_views` already preserves once-across-reclaim. Putting those rows in `C` creates the overflow the margin then papers over.

**Root is being asked to accept refuse-at-release.** That trade can be valid. It is not valid while `C` includes regenerable cache and a punitive view floor that can make a single legal asset undeletable.

### 4.2 Reset-gated-on-C invents a new incompatibility the 40-object bug does not require

`reset` already waives 24h preservation: it clears staging, `clear_assets` sets `reclaiming = 1` on every row, then the fork-aware sweep runs in the same owner action (`writer_assets.rs:8–42`, `assets_ledger.rs:648–662`, LLP 1006 §9a). Live application storage is explicitly uncapped by this policy. Requiring that the live set **fit in 512 MiB garbage** before reset can proceed means every successful app whose originals exceed the envelope can no longer reset. That is not “a large single-asset edge.” It is the normal `snapback2 reset` path.

Charging leftover **failed unlinks** after that sweep is the real discard-before-finish hole. Charging the entire live set as if it were 24h grace is not.

### 4.3 The capacity diagnostic is not implementable on the actual rejection carriers

The design wants one `E_ASSET_CAPACITY` in family **`assets`**, structured `pool` / `scope` / `resource` / delta / usage / limit / phase, HTTP 422 on upload, HTTP 200 `state: rejected` on mutation/replay, and “do not parse strings to decide which pool is full.”

Current carriers, all at the identical 0.0.10 / current pin:

1. `ExecutionState::Rejected` is `{ code, message }` only (`engine/mod.rs` and `offline.rs:88–97`). `Runtime::execute_certified` builds that from `rejection_code(&error)` plus `error.to_string()` (`registry.rs` `execute_certified`). There is no field for `pool`/`phase`.
2. `writer_wire.rs:25–34` and `offline.rs:88–97` both emit a **hardcoded** rewrite `"fix the rejected mutation input and retry"` and `guide: "{family}/runtime"`.
3. Family mapping for those JSON terminals is **not** in `writer_wire.rs`. `writer_util.rs:7–9` delegates to `snapback2_core::jobs::rejection_family` (`jobs.rs:143–160`), which maps anything other than `E_RULE*` / bound codes / `E_CONSTRAINT*` / `E_JOB*` to **`input`**. `offline.rs:123–135` is a third copy, also defaulting to `input`. `E_ASSET_VIEWED` is family `assets` only because `Refusal::from_runtime` special-cases it (`protocol.rs:149–157`). `E_ASSET_TOO_LARGE` is special-cased to family **`input`** (`protocol.rs:140–147`) — the conflation the design wants to split.
4. Upload HTTP 422 is `upload_refusal_status`: `code.starts_with("E_ASSET_") && family == "input"` (`asset_http.rs:1119–1125`). Family `assets` therefore becomes default `refusal_status` **400**, not 422. The design’s “upload capacity refusals remain HTTP 422” is false against this gate unless the gate or the family changes.
5. Job parking uses `JobRefusal::rejected` → `error.code()` + `jobs::rejection_family` (`jobs.rs:119–140`, `registry_jobs.rs:108–116`). A custody error on a chunk would park, which is acceptable, but it would not carry structured pool fields or family `assets` as specified.

Naming `writer_wire.rs` and `offline.rs` without `jobs.rs`, `execute_certified`, `ExecutionState::Rejected`, and `upload_refusal_status` is not an implementable diagnostic spec. Packing JSON into `message` would violate “do not parse strings.”

### 4.4 Other accounting/race/upgrade gaps (exact source)

**Late rung after release.** `ensure_rung` / `render_rung` do not reserve a ledger slot and do not re-check locator before `put` (`asset_http.rs:883–991`). GC deletes blobs for `reclaimed_ids` even when the id is still in `_assets` (`asset_gc.rs:27–32`: `reclaimed_ids.contains(id) || !live_ids.contains(id)`). MediaJobs rung/once sets are process-local and are not consulted. The design’s “if release wins before reservation, do not publish; GC skips IDs with active guards” is **new machinery**, required only if unlocated rungs remain charged. If rungs of unlocated IDs are deleted immediately, this race collapses to “don’t publish a rung for an unlocated id,” which is one locator check on the writer.

**Ordinary mutation vs replay.** The insertion before `finish_run` is right for replay. Ordinary `/api/mutation` still depends on `execute_certified` mapping the new error through `mutation_rejection_code` (`engine/mod.rs:1154–1166` already maps `AssetTooLarge` / `AssetInUse`). A new variant omitted from that match becomes `Refusal` (HTTP 400), not `state: rejected`. The design says to add it; it must also name `execute_certified` and the three family functions.

**Upgrade reconstruction.** “Do not backfill missing sizes as zero” is right. The design does not say what charge to use when a live ledger row’s original is unreadable (I/O) versus absent (GC treats missing keys as successful deletion, `policy-design.md` §5 GC row). Those must differ: I/O blocks positive allocation; absence must not invent a 0-byte undercount. Rung files today have **no** ledger size; reconstruction from `enumerate` + `{id}.w{width}` (`blob_store.rs:678–701`, `asset_http.rs:463`) is the only source. If rungs leave `C`, that backfill disappears.

**Over-capacity grandfather.** Non-increasing transactions until below the normal envelope is coherent. `max(measured pre-upgrade custody, new bound)` is then only an open/status ceiling, not a growth target. Say that in one sentence. Overhead can make a store “over” that was under the old payload-only query; the 40 × 158 investigation store is **not** over (`6204 + 40 × 8192 = 333,884`). Do not treat that fixture as a global upgrade bound — the design already says this.

**Fork-blocked tombstones.** `sweep_asset_blobs` keeps ids referenced by `.snapback/forks/*.sqlite` (`asset_gc.rs:22–36, 38–99`). Charging them until finish is honest. The `fork` CLI is deleted (`NOT-DOING.md` 2026-09-05 move). A leftover fork file can pin `C` with no public creator recovery. Operator recovery is “delete the fork file,” not a CLI. The design mentions this; it remains an owner-level saturation path.

**Cross-creator delete.** Affine claim requires `created_by == caller` (`assets_ledger.rs:599`). A later delete by another principal who may delete the row (operator/system, or a wide delete rule) charges the **uploader’s** `C`. If that envelope is full, Bob cannot delete a row that holds Alice’s image. Follows the stated attribution; it is a surprising operator failure mode and must be in the operator guide, not only the RFC.

**Begin-before-staging-file.** Current order is authorize → `staging.create()` → 64 KiB prefix → detect → `UploadCustody::new` → begin (`asset_http.rs:146–253`). Crash orphans are already names `sweep_named_temporaries` removes. Reordering is a small live-process improvement (ledger row with no file must enter failed cleanup). It is not the heart of the 40-object repair. Keep it if cheap; do not couple it to the envelope redesign.

**LLP 1006 line cap.** The RFC is 1499 lines. `rules/RULES.md` / `NOT-DOING.md`: no file over 1,500 lines, including Snapback 2 LLPs. Proposed edits to §§2a, 4, 6, 9, 9a, 9b, 10, 14 cannot land in-place. Implementation must extend `llp/1006.001` or split. Process constraint, not a policy hole.

## 5. A simpler complete design

Keep the trilemma choice the document already made: **full 24h grace on original unclaimed bytes, finite garbage, refuse a release only when the original transfer does not fit.** Do not put regenerable cache, view floors, or reset teardown into that envelope.

1. **Pending objects (the actual bug).** Count only unlocated receiving (including cancelled finalizer with an open file) and never-claimed ready (`released_at IS NULL`, not reclaiming). Limits stay 20/creator, 40/owner. This alone fixes observation A.

2. **Shared payload envelope `C`.** Sum `max(staged_bytes, finalized original bytes)` over every unlocated row, including `failed` and `reclaiming`, until `finish_asset_reclaims`. Same 256/512 MiB numbers, not an extra allocation. Check on begin/growth **and** on net final custody after constraints/bounds, before replay settle / mutation commit / job `save` / migration commit. Checked arithmetic. Attribution by `created_by`. Inherited over-capacity: non-increasing until back under the envelope.

3. **Identity bound without page theater.** Either keep a small per-unlocated-ID overhead **or** a hard unlocated-row cap derived from the same envelope (the design’s 65,504 is such a cap). Do not claim APFS/SQLite physical pages. Do not charge `_asset_views` at 4 KiB each.

4. **Derived rungs are cache.** On locator clear, do not publish new rungs; delete existing `{id}.w*` immediately (or on the next sweep without waiting 24h). Re-claim rebuilds lazily (already the §8 contract). Do not add 12 ledger slots, do not put `V(i)` in `C`, do not reserve 64-worker view margin. GC/rung races shrink to “no put if locator is null.”

5. **Once views stay in `_asset_views`.** Consume-after-body/before-completion-byte unchanged (`record_asset_view` + `deliver_once`). Late consume after release may insert a view; delivery of an unlocated id already 404s (`delivery_row`, `assets_ledger.rs:665–674`). Re-claim + same principal still hits the PK. No `W(i)` in `C`.

6. **Failed unlink.** Keep the full original charge and the temp path on the existing guard; do not recycle the physical-work slot; siblings continue; boot sweep must succeed or refuse positive allocation. This is the real disk bound, separate from 512 MiB.

7. **Reset.** Keep today’s waive-grace teardown: staging clear + tombstone + sweep in one owner action. Charge only ids whose physical delete failed. Do not require the live set to fit in 512 MiB.

8. **Diagnostics.** New `RuntimeError` (or equivalent) with structured fields, not a string. Extend `ExecutionState::Rejected` (or a sidecar on `Execution`) so `execute_certified`, `replay_mutation_response`, `writer_wire::execution_json`, and `JobRefusal::rejected` copy those fields. Put family `assets` in **`jobs::rejection_family`** (the function the wire actually calls), the `offline.rs` copy, and `Refusal::from_runtime`. Change `upload_refusal_status` so upload capacity is HTTP 422 with family `assets` (or keep upload on family `input` and say so). Keep `E_ASSET_TOO_LARGE` for generated/column/helper size only. Hardcoded rewrite in `writer_wire.rs:32` / `offline.rs:95` must be replaced, not documented around.

9. **Listing / guides.** Pending usage vs listed grace rows; `ownerCustodyFull`; no foreign IDs; operator text must stop saying ready discard “releases quota immediately” (`operator.md:50–51`) and must mention successful release, delayed physical credit, and the 24h vs 30-day mismatch. Offline guide: queued intent bytes survive; the referenced asset may not.

10. **Still refuse-at-release** when net original `C` would exceed 256/512 MiB. That is understandable byte pressure (eleven 50 MiB originals). It is no longer “this photo grew 12 cache JPEGs and can never be deleted.”

This is still larger than one predicate change. It is smaller than 12-slot schema + view scalars + standing 256 KiB margin + reset refusal + rung reservation protocol, and it does not create an unbounded garbage pool.

## 6. Invariants checklist (requested)

| Invariant | Assessment |
|---|---|
| Successful release stops consuming pending-upload slots | Correct, if pending predicate excludes `released_at IS NOT NULL`. Source today includes those rows (`assets_ledger.rs:247–259`). |
| Finite retained storage | Only if `C` is enforced and rungs/views are not an unbounded (or helper-ceiling) add-on. Current proposal’s `V(i)`/`W(i)` make the bound legal to exceed with one asset. |
| Same 24h grace | Preserved for originals (`ASSET_RECLAIM_GRACE_MS`). Not preserved for reset today; do not re-impose it as a 512 MiB gate. Do not evict under-age IDs under pressure (design correctly refuses). |
| Active authorization | Unchanged: delivery still requires locator + row rule (`delivery_row`). Released IDs undeliverable. |
| Creator isolation | Unchanged public discard/list. Global `C` can block a zero-usage principal; `ownerCustodyFull` is required. |
| Ambiguous/offline custody | Matches `withMutationUploads` and LLP 1012 §7. Replay of a capacity rejection must return the stored terminal, including structured fields (today it cannot). |
| Release saturation / undeletable assets | Documented but created by envelope contents. Must be reduced to original-payload overflow. |
| 64-worker late-view margin | Conservative vs 60 JSON workers; unnecessary if views leave `C`. |
| Derived/scratch ownership | Real hole (`allocate_path`, `render_rung`). Keep. |
| Failed physical cleanup | Must remain charged. Ready tombstones currently do not (`reclaiming = 1`). |
| Net transaction replay | Insertion point before `finish_run` is correct. Conflict still wins (`replay.rs:156–164`). Need structured terminal storage. |
| Legacy over-capacity | Non-increasing until under envelope is right. Measure on upgrade; the 40 × ~155 B fixture is not over. |

## 7. Verdict

**CHANGES_REQUIRED.**

Not READY: the envelope charges regenerable rungs and view floors that can make a single legal asset undeletable; reset is gated on an uncapped live set; the `E_ASSET_CAPACITY` contract cannot be implemented on `ExecutionState::Rejected`, `jobs::rejection_family`, and `upload_refusal_status` as they exist.

Not NEEDS_DECISION as the overall verdict: the refuse-at-release vs unbounded-garbage trilemma is a real root choice, and the design is honest about it. That choice can stand. The defects above are not that choice; they are extra complexity and broken diagnostic plumbing. If root later prefers “releases always succeed, uploads pause while `C` is over” (finite *admission*, temporarily oversize garbage bounded by the live set for 24h), that would be a different policy and would need an explicit ruling — it is the horn the design correctly rejected for this repair.

Root still must accept, after revision: (a) refuse-at-release for original-payload overflow, (b) no live-set reservation at claim time, (c) 24h vs 30-day mismatch remains. Those are the real remaining decisions. They are not an excuse to ship 12-slot rung accounting and a standing worker margin to protect a self-inflicted `W(i)` term.

Implementation of the revised policy should wait on that revision. The frozen `policy-design.md` hash above must stay the hash of this reviewed text.
