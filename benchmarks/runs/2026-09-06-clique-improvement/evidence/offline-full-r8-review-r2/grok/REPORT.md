# READY

Correctness review of the full R8 client/twin delta
`e1c6e2b79a9e13ceb363f647f52807218aa2b57a` → `cb578e197535290d9c3c7394246584e12459e77a`.

This is a correctness-only verdict. It is not landing, publication, phone, size,
movement-deadline, or resident-memory clearance.

## Verdict

No material correctness defect was found in the frozen full delta, including
`4e927c26` (not treated as a trusted base) and the later receipt-ownership,
carrier-preparation, coverage-atomicity, and entrypoint-isolation stages.

Private format 5, scoped versus global nonmembership, same-sequence
row-inside-extent contradiction, later compatible outside images, clock
ordering, ordinary-before-timed FULL revalidation, atomic standalone
rehydrate, per-owner absence dedup, typed bound validation before owner
mutation, shallow-frozen row isolation, and public denied/partial projection
are implemented consistently with the session contracts and native 26c9
identities.

## Resource bars (not part of READY)

These remain failed or pending. Correctness READY does not reopen them.

| Bar | Status | Bound evidence |
| --- | --- | --- |
| Complete local runtime gzip | **FAIL** | Final five-root measure **222,737 minified / 72,709 gzip**, **6,709 over 66,000** (target 64,000). Bundle SHA256 `fb9db4000cc2fa7469d50d5d1293036a7e6633cac845fb952cc8fa2599a6a8ee`. Latest repair **+154 gzip**, not a saving. Prior failures remain: 4e927 72,199; 02a5 72,229; 4fb 72,367; 47a7 72,555. |
| Original movement 10s | **FAIL** | R8 original `store-r8-final-movement.log`: 10 pass / 1 cancel / 10026.4675ms. Exploratory 43/43 at 23.819s under 120s is **not** original qualification. Carrier-stage original 10s (22 pass / 1 cancel / 10026.907ms) was the **pre-refusal-order candidate**, not final source. |
| Resident / realistic format-5 paginated history | **PENDING** | No current 10k ordinary paginated-format5 resident result. Historical format2 10k row-only RSS+383.8MB / heap+93.3MB / ArrayBuffers+42.8MB is a material resource concern with a different boundary. 100k index-only ~291MB is separate and must not be summed. Frozen 02a5/4fb/47a7 resident preparation was not executed and is not latest-repair evidence. |
| Cap 524,286 | Test-setup only | Pass at 524,286 independent absence guards within 524,288 slots was a byte-identical test allocation repair. No untouched-test or product-performance claim. |
| Exact 2 | Deferred | Unchanged. |

Muse ultra was unavailable per Root; no substitute was used. No peer review was read.

## Scope, provenance, and method

- **Base:** `e1c6e2b79a9e13ceb363f647f52807218aa2b57a`
- **Final:** `cb578e197535290d9c3c7394246584e12459e77a` (parent `47a7f491a7d7f3b3abd976f2767bf2856a5baf68`)
- **Packet:** `packet/manifest.json` created 2026-09-07T01:38:27Z
- **Native owner:** `packet/native/source` at `26c9fd5e0d3922ce7680493c0e8f7371f4793d59`; owner executable SHA256 `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e`
- **Identities:** `i53-codepoint-bytes-unicode-search-text-refinements-v5` / `bounded-spike-rust-search-text-refinements-4`
- **Private persistence:** FACT_FORMAT 5, independent of public v5
- **Writable area:** this review directory only. Packet source and evidence were treated as frozen read-only.
- **Not read:** sibling/peer reviews, prior review packets, mutable worktree product, same-session size-design analysis, drain/main epoch adoption (explicitly not imported).

Orientation used packet `AGENTS.md`, `snapback2/AGENTS.md`, `rules/RULES.md`, `NOT-DOING.md`, LLP 1000/1001/1011/1012, package `guide/offline.md` and `guide/live-query.md`, `contracts/root-contract.md` plus capacity and ordinary-conditional addenda, and native 26c9 decode/format/clock inputs. Session decisions override obsolete 34k/ASCII/timed-only-cap prose: Unicode 17 NFC(simplefold(NFC)) word/prefix semantics, Q2000/100scopes, 4N bound, 66,000 gzip ceiling / 64,000 target, 524,288 combined logical slots, 1M steps / 4MiB closure / 8MiB heap / 1MiB output.

**Checks performed:** independent source review of the full changed graph plus unchanged callees (value-runtime, certificate-identity, offline-protocol, swap-journal, twin-hydrate, native ArgType/TextFormat). Frozen stage logs/handoffs/tests were read as evidence, not as trusted conclusions. **No new probes, installs, builds, size/movement/cap/resident/native-rebuild, or remote work.** Copied packet binaries were not executed. Node/Bun hashes were not re-verified because no local execution was required.

## Stage graph (attribution preserved)

| Stage | Commit | What it owns |
| --- | --- | --- |
| Original R8 | `4e927c26` | Format 5, closed extents, all-ID, clock/conditional, Words metering, denied/partial projection, typed current-authority resume throw. Size 72,199 FAIL. Movement original 10s FAIL. |
| Receipt ownership | `02a5b980` | Drop ClientStore full ClosureReceipt map; CoverageIndex compact owner invalidations; rehydrate old-owner invalidation. +30 gzip. |
| Carrier preparation | `4fb998f2` | Transaction-local prepared images/frames, lazy ordinary payload, restored refusal order after eager-prep regression. +138 gzip. Movement 10s on **pre-fix candidate**. |
| Coverage atomicity | `47a7f491` | Per-owner absence identity dedup; atomic standalone rehydrate (validate then journal). +188 gzip. Closes ticket `20260906-snapback2-indexed-coverage-replacement-atomicity`. |
| Entrypoint isolation | `cb578e19` | Weak per-store row custody; shared scan bound validation before owner mutation; isolated expected keys/range metadata; held offlineView omits denied data and denied/partial next. +154 gzip. Final 72,709 FAIL. |

`4e927c26` is included in this review and is not a reviewed/trusted base.

## Findings

None that change the correctness verdict.

The previously reported P2s (duplicate per-owner absences tearing CoverageIndex on removal; standalone rehydrate publishing before verdict/row validation; shallow-frozen caller aliasing; invalid `after: {Id: null}` mutating coverage; public denied/partial `next`/denied `data`) have source-level repairs whose control flow matches the new regressions. Those regressions are synthetic or public-decoder paths as labeled in evidence; they do not establish a native/public authorization bypass.

## Review of required behaviors

### Extents, all-ID, movement, halo

`FactTransaction.close` / `check` / `blocking` (`fact-integrity.ts`) keep scoped nonmembership distinct from global `rowFacts` numeric absence/tombstone. Same-sequence image inside a closed extent whose `present` set omits that id throws `conflicting durable fact`. A later-seq compatible outside image is stored and deactivates a scoped mask rather than promoting the hole to `state.negative`. Unknown ids never held are still constrained (`store-review.test.ts` “closed extents retain all-ID…”, synthetic id `unknown` on native-certified schema). Halo ids join `present`; Limit first/last come from page `rowIds` suffixes, not reconstructed from later moved current rows. `CarrierIndex.receipt` clones once and stamps `heldSuffix` from the prepared image.

Incoming matching uses exact-sequence partitioned `FactIndex` and prefix/interval `ExtentIndex.matching` over the image’s own keys. Admission does not union row ids across sequences or scan all held history. Opaque (keyless) positives against a table that already has closed extents call `missing()` → authenticated FULL / clock reset rather than inventing Q.

Body GC can drop `state.rows` while `factImages` / `factExtents` remain referenced by guards and answer proofs (`finish` only deletes zero-ref images/extents). Overlay FIFO still uses authoritative negatives, including extent holes via `authoritativeNegatives`.

### Clock, conditionals, format 5

Seq-first, then strictly newer `readTime` at equal seq and matching `clockPlanHash`. Equal-clock different fingerprint refuses; older clock is ignored. Clock-only frames set `clockOnly`, do not compute hidden-ref eviction, and do not advance overlay-miss / watermark progress. Same-seq pooled row byte conflicts remain independent of clock.

Ordinary answers that cross newly enrolled timed guards without proofs get `needsFactProofs`; conditionals throw `FullRevalidationRequired` and `OfflineRuntime.accept` requests one authenticated FULL when a revalidator is supplied. Prior answer/seq/fingerprint/outbox are preserved on that path. Repeated saturated recovery (`factLimitReset` identity match) throws in `applySwap` before further mutation. Old private formats 0/2/3/4 reset coverage atomically on open while preserving outbox/seal; `unprojectState` omits a default `factFormat` so predecessor unmarked stores are not silently relabeled as format 5.

Auth-epoch change strips fingerprints/proofs/images/extent guards and keeps `extentNegative` slot count; a later authoritative image deactivates the mask. That is session-compatible with “reauth preserves history, next delivery is new.”

### ClientStore isolation, coverage atomicity, bounds

`ClientStore.prepareRow` no longer treats `Object.isFrozen` as ownership. External values are JSON-cloned, optionals materialized, recursively frozen, then validated. A per-store `WeakMap<object, table>` marks only that store’s successfully normalized row objects. Validation still runs on reuse. Constructor, `put`, and `rehydrate` share this path.

`rehydrate` prepares/validates every incoming row, builds a staged `CoverageIndex`, then applies the existing row journal with directories swapped to an empty map so notifications cannot fire mid-apply. Failure restores old facts, rolls back rows, then restores directory object identity. Success notifies against final rows/facts: new seed first, then discarded old owners. Nested prediction during rehydrate is refused. No full ClosureReceipt map returns.

`CoverageIndex.set` prepares ranges, typed keys, and unique absence identities **before** removing the previous owner. `indexTuple` / `prepareScanBounds` (extracted from `HeldIndex.scan`) validate after/before as complete tagged suffix tuples, gt/gte/lt/lte as first ordinary suffix scalars, Null, order, and held_suffix (empty suffix + `[]` remains distinct from an invalid empty cursor). `{Id: null}` fails `assertValue` (Id payload must be a string identity) with `E_INPUT` before contribution mutation. Expected ordinary keys and Limit endpoints are cloned off the cloned descriptor; tests mutate caller row/range objects after admission and check coverage identity.

Per-owner absences are `Set`-unique by `pointKey`; distinct owners still share the identity Set. Verdict duplicate multiplicities and allow/deny disagreement counts are unchanged. `wireJson` is applied to incoming absence values during preparation so malformed tags cannot publish then fail during directory invalidation.

### Offline projection and resume

`offlineView` (held branch): omit `data` when `state === 'denied'`; emit `next` only for complete/capped. Partial data is preserved. Private `HeldAnswer` data/next remain in the store (`store.answer` / inspect in tests). Conditional public projection in `accept()` matches. Non-envelope `denied`+`next` still fails `client-wire` (`must not carry next`). Forced-offline, hydrating, retry, and forced-offline subscription are tested through the real Client decoder/runtime with synthetic frames, not native emission.

`ensureAuthority` still throws typed `E_AUTH_SUPERSEDED` for current-authority resume/query; aborted resumes preserve `AbortError` without publishing a delivery refusal. Outbox is preserved on typed delivery refusal in the public control.

### Words, Unicode, v5 args

`Words` uses `searchWordWork` (same NFC/fold/tokens/first-occurrence dedup as indexing), charges derived steps/scratch, short-circuits `Null` to `[]` with no Unicode work. Single-token query counting before dedup remains in `searchQueryToken`. Optional null produces no index words (`searchFieldWords` skips `source === null`). ArgType.Text positive min is recursive; zero omitted; `format: null` is refused for args (`canonicalProgramJson` / `validateInputs`) while Constraint.Text `format: null` is omitted. Column Text still has no format field (extra `format` is `E_SCHEMA`). Native 26c9 `deserialize_text_format` likewise rejects non-handle/url present format. Handle/url predicates match the pinned native rules (not JS `\s`).

### Twin incremental path

`TwinStore.row` applies global negatives and scoped `extentNegative` before FIFO overlay replay; later overlays after a hole seq can apply only once the mask is inactive and `issuedSeq > hole.seq`. Answer receipts are rebuilt with `closureFromAnswer` from current refs plus stored `heldSuffix` / `evictedIds`, never a historical row-body scan. Warm `put` notifies `CoverageIndex.changed` so moved members become `lost` without rewriting the receipt.

## Inherited versus introduced

| Topic | Attribution |
| --- | --- |
| Format 5, extents, all-ID, clock contract, Words metering, typed resume throw | Introduced in original R8 (`4e927c26` and supporting files), reviewed here as untrusted. |
| Drop full receipt bodies from ClientStore | Introduced in `02a5b980`. |
| Lazy transaction image/frame prep; refusal-order restore | Introduced in `4fb998f2` (order bug was introduced then fixed in the same stage). |
| Absence identity dedup; atomic rehydrate | Inherited defects at 4e927/02a5; fix introduced in `47a7f491`. |
| Shallow-freeze isolation; bound validation before owner mutation; denied/partial held projection | Inherited/latent at 47a7; fix introduced in `cb578e19`. |
| Twin hydrating CoverageIndex expected keys from **current** `state.rows` rather than an immutable issuing-pool snapshot | Inherited e1c6 `closureFromAnswer` shape. Warm movement still updates `lost` via `put`→`changed`. See uncertainties. |
| Size over 66,000; original movement 10s; format2 10k resident | Inherited failures; latest stages add gzip, do not close the bars. |

## Material uncertainties (not findings)

1. **Cold Twin CoverageIndex exactness after in-place key movement.** `closureFromAnswer` supplies current row bodies as the receipt pool. On cold snapshot rebuild, expected keys are taken from those current keys, so a Limit member that moved without `evictedIds` / a new receipt can look exact again. Warm path is protected by `CoverageIndex.changed`. RangeStore extents still constrain same-seq inside images. No packet test isolates this cold ClientStore exactness case; it is not treated as a demonstrated defect.

2. **`referenceIndex.update` after a successful `backend.replace`.** If update throws, commit already persisted, `referenceIndex` is dropped, and the caller sees failure. Rebuild-from-state on the next use should restore; retry of an identical fingerprint is a skip. Not silent corruption; possible false failure / extra retry.

3. **Auth-epoch swap with `facts` only.** `changesCoverage` does not treat `facts` as coverage mutation, so `applyCoverage` is skipped after stripping proofs. Intended by the reauth comment; extent masks remain until a new image arrives.

4. **Serde / metering residual.** Native Words step/scratch equality against every Unicode edge is attested by the frozen 26c9 Words fixture in `test-indexed.ts`, not by a new native rebuild in this review. No independent scalar-by-scalar re-audit of `searchWordWork` versus Rust was performed here.

5. **Synthetic versus native emission.** Malformed standalone rows, duplicate absences, and forced-offline denied frames use native-certified schema or the public decoder as labeled. They are not owner-emitted packets.

## Structural notes (no size waiver)

Centralizing image/extent/receipt preparation reduced some duplicate hashing in a bounded 3-image/8-frame witness (carrier stage) but **increased** gzip at every later stage. Further helper extraction or a second retained index would likely add measured bytes. Relocating required algorithm out of the five roots is not a saving. No feature cut is recommended from this review.

Possible later consolidation, with semantic cost: persist issuing-pool ordinary keys beside `heldSuffix` so cold Twin rebuild does not rederive expected keys from current rows. That is a representation change, not a proven bugfix, and would need its own size accounting.

## Evidence actually used

Source hashes (packet/manifest, origin `git:cb578e19…`):

- `coverage.ts` `c02c4afa1fade5bc001cd38c57b321f5fddf8666ab87ebbeee9addf7dabd8ca5`
- `store.ts` `1192f1ddefbd1040796e74c970e73c3ced929a061a12691a2d6a6754b19b4d02`
- `index-store.ts` `709ec7ad948c18d8d69e5f99a31f3a641aafdf4ba5b69dd438919dc5ca3c23e3`
- `offline.ts` `b6097e78b7fbcc255ad69b55ca83ea5d93f48cbf5605bd3340b34261403f7dea`
- `range-store.ts` `920c489a931713c538b700f02e059ac72e38caf3f2f4ea98b3df618db3f00a56`
- `carrier-index.ts` `55a086697e62e398945509eb47e4af8b127772f7fc6a810f4ca1037542e84a6a`
- `fact-integrity.ts` `877f9fe773d3173a5ebab58dd1683187227a706b35b8ccbd77945f09c72be9cc`
- `extent-facts.ts` `154cd1d0af740d17615c3ac7e45f727e4ef59e0fac11e7a3a5b31a4c9239fa5c`
- `extent-index.ts` `07d00755e4809da6def9fc3d5be41021cf1f56dd94ba000159052237577072db`
- `fact-index.ts` `db3a3dd4013e15793fe18604a97400e9b707bc91c1dc3361041787e6ef5038bd`
- `projection.ts` `a1b0d838be15637150772607e5b0a70da46245270736ca2405337de54a057b7e`
- `twin-store.ts` `6ef3f3a9ea9321e25d1c9f3b7cf6d3c3a5b5c022c00f5e1125486b8a740852c0`
- `client.ts` `731a9969526357d53a18b9e3adec23bb74b0064076d7255c33469f876e995a3f`

Stage evidence (not re-executed): coding-r8-handoff; r8-receipt-ownership/transaction-preparation/coverage-atomicity/entrypoint-repair handoffs and logs; `r8-entrypoint-repair/standalone-comparison.json` (private standalone, `nativePublicAdmission: false`); public 24/24 and Twin 4/4 at original 10s; direct Bun indexed 25.887s with **no** original per-file deadline; refs-final 14.802s under 60s wrapper after a new 30s wrapper hit 124 (product deadline unchanged); capture-path EEXIST was external plumbing only.

Final entrypoint commit receipt: `cb578e19`, source checkpoint SHA256 `84212218d8cb9b88ffc8a99cf182657b9492cf339c23e7ae5970a341e17dcd04`, diff SHA256 `c76bd3124a3cf314d208386e03dae228a5a07a86aee53e545d28632bbd8be61c`.

## Explicit non-claims

READY does not mean: land on main, publish, import drain/authEpoch-from-main, close 66,000 gzip, pass original movement 10s, clear phone/RSS, or treat 43/43 @120s or 22/1cancel carrier movement as final-source qualification. Parent owns integration with excluded main/drain changes while preserving this lane’s typed current-authority throw and stricter denied/partial projection.
