READY

Independent review of commit `3e923878783afbf4b25556cae3e4683d3481a6ee` (parent `4b87d8bd90d4a8a466a3b91a011216844c90b0f8`) in this immutable snapshot. No peer review, author narrative, moving worktree, or benchmark score was read. Product source was not edited. Assigned ports 52110–52119 were unused.

# Scope

The intended change is narrow: successful releases must stop consuming the 20/40 pending-object slots; receiving/cancellation custody and never-claimed ready uploads still count; original-byte admission, including released available ready originals and finalized-growth reservation, stays; numerical ceilings, full 86,400,000 ms grace, ordinary delete/replacement/reset liveness, affine/creator authorization, same-ID once history, transactional reconciliation, and restart reconstruction are preserved. No new aggregate physical-custody or bounded-sweep claim is in scope. Existing ready/failed cleanup, scratch, reset, and sweep defects are tracked, not solved. The rejected ordinary release-capacity redesign is not required as a prerequisite.

# Method

- Governing docs: `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, LLP 1006 (revision s), operator/offline guides, the two issues in this snapshot.
- Exact patch: `revision.patch` sha256 `db6890fd03eb2359c5580d0d7755a77cf81a61361714b6a05f99587a61584dbf`.
- Source-bound read of `assets_ledger.rs` predicates and every `asset_staging_usage` / `enforce_staging_caps` / `unclaimed_uploads` consumer, listing serialization, client types, diagnostics, docs, and tests.
- Selected author receipts in `factual-checks/` used only as command/exit observations. Their `cwd` is another tree; they are **not** treated as this-commit re-runs. Original failures are not product passes.
- Independent execution on **this** snapshot: `cargo test -j2 -p snapback2-core --test assets` (pending filter, then full 30). Exit 0. Public Quarry/owner tests were not re-run: this snapshot had no `target/` (before compile), no `packages/snapback2/dist`, and no `node_modules`. That limit is recorded, not filled in.

Source hashes before and after independent compile match `snapshot-before.json` for every hashed product path (`review-evidence/source-hashes-before.json`, `source-hashes-after.json`). Compile wrote `snapback2/target/` only.

# Product verdict

The ledger predicate matches the intended repair. I did not find a regression in object/byte admission, growth reservation, listing fields, client validation, diagnostic privacy, or the inherited lifecycle the change must preserve. The patch does not implement, and does not require, the rejected release-capacity redesign. It does not claim a physical-storage envelope or a bounded sweep.

# Predicate

`Store::asset_staging_usage` (`snapback2/crates/snapback2-core/src/assets_ledger.rs` 252–294) is the single object/byte total. Creator and global queries share one WHERE and differ only by `created_by`:

```
WHERE locator_table IS NULL
  AND (state = 'receiving' OR (state = 'ready' AND reclaiming = 0))
```

Objects changed from `COUNT(*)` to:

```
SUM(CASE WHEN state = 'receiving' OR released_at IS NULL THEN 1 ELSE 0 END)
```

Bytes are unchanged: `SUM(MAX(staged_bytes, COALESCE(bytes, 0)))` over that same row set.

That is equivalent to LLP 1006 §14 as patched:

- Unlocated **receiving** rows, including `reclaiming = 1` cancellation custody, always consume a slot.
- Unlocated **ready** rows consume a slot only if `released_at IS NULL` and `reclaiming = 0` (never-claimed available ready).
- Released available ready originals (`released_at` set, not reclaiming) stay in the byte sum and drop out of the object sum.
- Ready tombstones and failed rows remain excluded by the WHERE (inherited early admission credit).

Ceilings are unchanged: 20 / 256 MiB creator, 40 / 512 MiB owner (`STAGING_PER_*` / `STAGING_GLOBAL_*`).

`enforce_staging_caps` (219–247) still gates minting: objects first, then bytes, creator then owner. `asset_reserve_finalized_bytes` (296–335) still checks only byte growth; the receiving row already holds a slot. Growth messages now say byte admission includes released originals during grace.

Reconciler (`reconcile_row_assets`, 562–636) was not modified. Same-cell retention is still “id in both old and new ⇒ neither release nor claim,” so `released_at` and locator are unchanged. Claims still set `released_at = NULL`; releases still set `released_at` when clearing the locator. Independent run of `lifecycle_reconciler_preserves_same_cell_list_edits_and_refuses_reuse` and `optional_clear_and_list_shrink_release_removed_assets` passed.

Grace query (`reclaim`, 469–478) is unchanged: `MAX(created_at, COALESCE(released_at, created_at))` versus `now - 86_400_000`. Pressure does not shorten it. `ordinary_release_and_reset_do_not_require_byte_headroom` and the two `release_clock` tests passed on this snapshot.

# Consumers

| Site | Role | After this patch |
|---|---|---|
| `begin_asset_charged` → `enforce_staging_caps` | mint | objects = pending; bytes include released ready |
| `asset_upload_authorize` (`writer_assets.rs` 239–260) | HTTP pre-body | same function; `handle_upload` calls it before reading the body (`asset_http.rs` 146–164) |
| `asset_upload_begin` | mint with Content-Length | still `begin_asset_charged` |
| `asset_reserve_finalized_bytes` | growth | byte side only; includes released originals |
| `list_uploads` (`writer_assets.rs` 187–209) | public listing | `usage` is `usage.creator` from the new totals; `uploads` is `unclaimed_uploads` (includes released); `limits` remain 20 / 256 MiB |
| `registry.rs` forward | typed runtime | same function |
| `writer_assets` unit tests / `asset_gc` tests | bytes/objects of discarded receiving | still valid: receiving tombstones keep bytes until `mark_asset_failed` |

No leftover `COUNT(*)` on the staging row set. No second object counter.

# Listing, types, serialization

`unclaimed_uploads` (420–444) adds `released_at` and `reclaiming` to the SELECT. WHERE is unchanged, so GET `/api/uploads` already listed released ready rows; this patch makes that observable instead of changing membership.

`AssetUpload` is `serde rename_all = "camelCase"`. `list_uploads` serializes `Vec<AssetUpload>` through `json!({ "uploads": uploads, ... })`. Author public receipt `public-release-byte-witness.log` shows `"releasedAt": <i64>, "reclaiming": false` (observation of that author run, not this-commit re-run).

Public client (`packages/snapback2/src/types.ts` 178–195; `client-upload.ts` 73–79) requires `releasedAt: number | null` and `reclaiming: boolean`. `usage.objects` is documented as pending across pages, not page length. That matches the diary’s operational trap (`listUploads()` page length is not pending usage).

Privacy: listing remains `created_by = caller`. Guest `listUploads` / `discardUpload(foreign)` stay empty / false. Owner-ceiling errors report **the caller’s** `creator.objects` / `creator.bytes`, not other principals’ ids or totals (`enforce_staging_caps` 234–244). Caps-test diagnostic in the author log: `"your usage is 0 pending objects"` plus `"Other accounts must recover their own abandoned uploads"`, and `!error.message.includes(owned[0][1])`.

Recovery copy does not instruct discarding live claimed ids. Rewrite (`protocol.rs` 140–147) says discard **only abandoned** ids or wait for eligible cleanup. Guide `operator.md` 52–53: claimed ids refuse `E_ASSET_IN_USE`. Discarding a **released** original is abandoning future re-claim and, by the inherited ready-tombstone rule, drops its byte charge before blob deletion. That is existing ready-discard semantics applied to a row that is already unlocated; it is not a new capacity-on-release refusal.

# Diagnostics

`E_ASSET_TOO_LARGE` from `RuntimeError::AssetTooLarge` now distinguishes:

- creator pending objects (`pending object ceiling is full`)
- creator bytes (`byte admission ceiling would be exceeded` + released-original note)
- owner pending objects
- owner bytes

Guide page is still `operator` (pre-existing). HTTP generation/format `too_large` helpers in `asset_http.rs` / `image_walk.rs` still say “staging ceilings” / `assets/admission`; those paths are not the pending-slot repair. Column-bound `AssetTooLarge` from `validate_asset_use` still shares the runtime rewrite that mentions list/discard first; that pairing pre-existed.

# Docs

LLP 1006 revision (s) states the predicate, keeps original-byte admission, names 86,400,000 ms grace, and withdraws the “bounded whole-sweep” wording in §9a in favor of the open follow-up. §9/§14 explicitly do not claim aggregate physical storage. That matches the issues:

- `issues/20260906-snapback2-asset-custody-gc-follow-up.md` — inherited ready/failed credit-before-delete, reset unlink order, sibling sweep abort, unbounded enumerate, rung/view/scratch. Not solved here.
- `issues/20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md` — remains open for Clique/reseed attribution; isolated witness is not a benchmark pass.

`guide/operator.md` is the precise public recovery page: `usage.objects` vs listing, released bytes, 20/40 and 256/512 MiB, no capacity refusal on release/replace, full grace from creation or latest release.

`guide/offline.md` was condensed to stay under the build.mjs 4352-byte page budget (this file is 4341 bytes). It adds, under sending/recovery:

> Media can expire 24h after creation/latest release; grants/leases do not extend it.

Read next to queued intents, that is the unclaimed-upload grace rule. `operator.md` states the same rule with “Unclaimed uploads.” A claimed live original is not reclaimed at 24h from `created_at` (locator not null; LLP 1006 §9). I do not treat the offline sentence as a product regression: the recovery rewrite points at `operator`, and the paragraph is about replay of queued uploads. It is a residual wording risk, not a predicate bug. A one-word “Unclaimed” prefix would fit the 4352 budget (4341 + 10 = 4351) if later tightened.

§15 lane A still says `` `reset` = clear ledger + staging + sweep `` while §9a now describes tombstones plus the inherited staging-unlink order. Historical implementation-shape table, not a new capability claim.

# Tests

## Scope distinction (correct)

- **Core** (`tests/assets/pending.rs`): `Runtime` / `Store` APIs. Covers mixed alice/bob 43-claim / 40-release / restart, receiving vs never-claimed ready filling 20/40, released originals exhausting creator and owner **bytes** plus growth refusal, receiving tombstone keeps slot vs ready tombstone exclusion, release/reset without byte headroom, re-claim resetting grace without forgetting once history. Independent run: 6/6 pass, then 30/30 including inherited same-cell / once / grace.
- **Package / public** (`tests/asset-pending.test.ts`, `asset-pending-caps.test.ts`): `createClient` + authored Quarry `tests/fixtures/asset-pending/{schema,media}.q` (`keep` / `replace` / `release` / `inspect` / `get`). File substitution, `listUploads`, `discardUpload`, `assetUrl`, HTTP `POST /api/upload` with `X-Snapback-As`. Not a private core fixture. `SNAPBACK_URL` must be unset so they do not attach to an external owner.
- **Owner HTTP** (`crates/snapback2/tests/assets.rs` `guest_upload_churn_hits_global_cap_and_claim_and_reclaim_release_it`): pre-existing 40 guest uploads; still valid because those rows are never-claimed ready (still pending objects).
- **Owner writer** (`writer_assets.rs` tests): discarded finalizer / failed unlink — receiving charge retained; not claimed as a custody fix.

## Public tests vs supported APIs

- 43 `api.media.keep(File)` claims, 40 `api.media.release`, restart, fresh `upload`, re-claim of the **same record**, original-byte fetch: public mutation/query/upload/listing/delivery.
- Inspect-without-claim: `api.media.inspect` on an already-uploaded record; listing still pending.
- 20+20 never-claimed uploads, guest owner-cap refusal without foreign ids, 21 `api.media.replace` File substitutions: public.
- Byte-admission-before-body uses the public upload route with `Content-Length: 268435456` and no body, not `client.upload`. That is the supported HTTP admission seam (`AssetUploadAuthorize` before `copy`). Author log `public-release-byte-witness.log` shows `422` / `E_ASSET_TOO_LARGE` / `6240 / 268435456 charged bytes; requested 268435456` / `even with free pending slots`.
- Disk `readFile(.snapback/blobs/...)` in the public file is a private observation of original bytes across restart, in addition to the public fetch after re-claim. Not treated as a public-API pass by itself.

## First failures and deadlines (author receipts, not this-commit passes)

| Receipt | Exit | What it is |
|---|---|---|
| `core-pending-first` | 101 | Tests expected the new object CASE; code still `COUNT(*)`. First failure retained. Messages still said “staging usage is 20 / 20 objects”. |
| `core-assets-final` | 0 | Later core suite, other cwd, 30 passed in 1.04s. |
| `public-pending-witness` | 1 | `Failed to parse URL from [object Promise]` (missing `await` on `assetUrl`) then **file** 10s timeout / leaked owner. |
| `public-pending-witness-fixed` | 1 | `E_OWNER_PORT_TAKEN` on 52000 after that leak. |
| `public-release-witness` | 0 | Name-pattern run; log phase `restart-new-upload-and-replacements` and `finalUsage.bytes: 9360` (60×156) — **older combined test**, not the current split file. Not a combined-file pass of the current sources. |
| `public-release-final` | 1 | File 10s timeout after restart. |
| `public-release-byte-witness` | 0 | Current phase names `40-releases` / `restart-and-new-upload`; `finalUsage.bytes: 6084` (39×156). Matches **current** `asset-pending.test.ts`. Author-run, other cwd. |
| `public-pending-caps` | 0 | Caps file with one test (20+20). |
| `public-caps-replacements-final` | 0 | Both caps tests; **file** `duration_ms: 9839` against `--test-timeout=10000`. |
| `public-media-replay-controls` | 1 | Control timeout; not a product pass. |
| `public-media-replay-controls-ready` / `public-definitive-refusal-control` | 0 | Attached to `SNAPBACK_URL=http://127.0.0.1:52002`. Not used as evidence that this snapshot’s owner is healthy. |
| `caps-final` / `refs-final` | 0 | Author worktree, other cwd. |

Node `--test-timeout=10000` applies to the **file** because both new tests use top-level `await RealOwnerHarness.create`. That is why the missing-await leak cancelled the file, and why the author split two files instead of raising the bound. Current `test.sh` lists both files with the original 10s bound. No larger combined-file pass is claimed here.

`public-caps-replacements-final` at 9839 ms is an author observation of deadline tightness, not a red test. I did not independently re-time it.

# Independent execution (this snapshot)

```
CARGO_BUILD_JOBS=2 cargo test -j2 -p snapback2-core --test assets pending:: --no-fail-fast -- --test-threads=2
```

Exit 0. 6 passed in 0.31s after a 2m12s compile. Log: `review-evidence/independent-core-pending.log`.

```
CARGO_BUILD_JOBS=2 cargo test -j2 -p snapback2-core --test assets --no-fail-fast -- --test-threads=2
```

Exit 0. 30 passed in 0.70s. Receipt: `review-evidence/independent-core-assets.json`.

Public/package/owner HTTP tests: **not run**. Limit: no prepared `snapback2` binary, compiler worker, or node_modules in the snapshot as supplied. I did not inspect the live author worktree to borrow them.

# Inherited, not regressions

These remain as filed; the patch documents them rather than solving them:

1. Ready/failed admission credit before physical delete (`discard_upload` sets `reclaiming` then sweep). Receiving cancellation still counts until `mark_asset_failed` / close.
2. Reset unlinks staging before `reset_and_seed_at`.
3. `sweep_asset_blobs` / `enumerate` materialize the live/fork set and can abort siblings on one delete error.
4. Late rung/view vs GC; scratch unlink ignored on some paths.
5. Claimed originals never counted in staging objects/bytes — that is the existing located-row exclusion, not this repair. Release can therefore push **byte** totals above 256/512 MiB without refusing the delete (`ordinary_release_and_reset_do_not_require_byte_headroom`). Intended; the rejected redesign is not required.

# Residuals (non-blocking)

- `guide/offline.md` “Media can expire 24h…” is easy to read more broadly than unclaimed/queued uploads. `operator.md` is precise. Not a ledger bug.
- `SNAPBACK2_TEST_PORT` binds every harness/Rust `Owner` in the process to one port. `test.sh` does not set it. Parallel files collide only when that env is set (author port-leak receipt).
- Owner-harness log `args.at(-1)` is wrong if `--serve` is appended; these tests do not use serve.
- No author `scripts/test.sh` / `measure.mjs --check` receipt is in this snapshot. Adding two real-owner files to the 10s package invocation is a 60s-suite load risk I could not re-measure here.
- Committed issues/diary point at `/Users/ccheever/clique-improvement/revisions/asset-pending-r1/`; those paths are outside this snapshot and were not followed.

# What this review is not

- Not a Clique/reseed qualification (`20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md` stays open).
- Not a physical-custody, bounded-sweep, or scratch-budget proof.
- Not an endorsement of the rejected release-capacity policy, and not a demand for it.

# Conclusion

The object CASE is the right repair: released available ready originals free 20/40 slots and keep original-byte admission; receiving and never-claimed ready still fill slots; growth, grace, same-cell, once history, affine creator charges, restart SQL reconstruction, and ordinary release/replace/reset liveness are intact. Docs and tests distinguish pending objects from listing length and from physical disk. Independent core tests on this commit pass. Public owner witnesses were not re-run here due to missing prepared JS/binary artifacts; author later split-file receipts are consistent with the current sources but are not this-snapshot execution.
