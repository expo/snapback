# Independent review: 82c43ca45 versus 23a0e54e

Reviewer: grok (this directory only).
Packet manifest SHA-256: `e2e33082e9dfbd7ceb2abf35731ce0aa6dc0b761871d2c197619b026a60ae40f`.
Source: `82c43ca456022682670941494dd828e099fca3d8`.
Parent: `23a0e54e82106ae28090bd379e197fcb0f7717d6`.
Historical context export (not independently cleared): `e1c6e2b79a9e13ceb363f647f52807218aa2b57a`.

Direct semantic delta: 11 paths (eight production, three tests), reviewed in the current execution graph rather than as isolated hunks.

## Verdict

**READY** for correctness and ownership of this delta.

This is not a size, landing, publication, native-integration, resident, or phone verdict. Packet-measured gzip remains **75815 FAIL** (9815 over 66000; target 64000). Parent was 75799 gzip / 231741 minified; this delta is 230321 minified (−1420) and 75815 gzip (+16). BytesInOutput is not additive gzip. READY does not waive that failure.

## What was reviewed, and what was not executed

Read in this packet: `context.md`; `contracts/`; `source/AGENTS.md`; `source/snapback2/AGENTS.md`; `source/rules/RULES.md`; `source/rules/NOT-DOING.md`; LLP 1000, 1001 §10, 1012 §§4–5 and §§8–9, 1013 §3; `source/snapback2/packages/snapback2/guide/offline.md` and `guide/live-query.md`; the 11-path `direct-delta.patch` plus current and parent bodies of those files; callers of the changed helpers (`offline.ts` accept/expand, `range-store.ts` commit/expand, `held-program.ts` plan-hash, `offline-schema.ts`, evaluator store/value-runtime/row-image, sqlite/indexeddb `replace`); `metadata.ts` split/restore; `row-image.ts` `RowImage`/`imageState`; `value-runtime.ts` `wireObject`; recorded probes under `evidence/` (unknown before/after, viewed-after-fix, pair-candidate1, work-count, normalization-original, check-summary, final-byte-delta).

No subagents. No installs, builds, native servers, native commands, remote work, resident runs, full suites, or size/cap/movement reruns. No probe was launched: no concrete bounded counterexample was identified that the packet did not already record. Citations of EPYC/Bun/Node exits below are packet records, not executions in this review.

## Delta in the current graph

The eight production files replace three families of recursive walkers with shared constructors, without new schema, IR, wire, registry, or input cache.

| Path | Role in current graph |
|---|---|
| `snapback2/packages/evaluator/src/certificate-identity.ts` | Certificate / plan / rule / schema identity for evaluator corpus, held-program planHash, schemaDigest, rule-hash, RowImage schema identity |
| `snapback2/packages/snapback2/src/store/row-values.ts` | Shared `$row` grammar, `ValueWalk`, `mapRowValues`/`collectRefs`/`purgeAnswerData`, `pairAnswer` |
| `snapback2/packages/snapback2/src/offline-protocol.ts` | Wire validation, canonical wire JSON, `expandRows` |
| `snapback2/packages/snapback2/src/offline.ts` | Public `accept` → `expandUnviewed` viewed masking |
| `snapback2/packages/snapback2/src/store/range-store.ts` | Hidden discovery, delivered-history restore, held expand, purge |
| `snapback2/packages/snapback2/src/store/projection.ts` | Generic vs journaled carrier projection |
| `snapback2/packages/snapback2/src/store/asset-policy.ts` | `nullOnceMedia` alias scrub |
| `snapback2/packages/snapback2/src/store/byte-cache.ts` | `assetIdsIn` lease walk, including nested `RowImage` |

Tests only: `evaluator/src/test.ts`, `tests/offline-protocol.test.ts`, `tests/sqlite.test.ts`. Line counts of changed production files remain under the 1500-line cap (`range-store.ts` 1457).

## 1. Canonical identity construction

`pick` still refuses unknown own fields via `known`, then copies in serde field order. Transforms run in a second loop over `Object.keys(transforms)`, so output key order and refusal order can differ. `SCAN` inserts `take` before `prefix`, matching parent `normalizeScan` object-literal evaluation (`take: normalizeBound` then `prefix.map`). A Scan whose `take.Arg` carries an extra field still refuses that field before an unknown prefix tag is examined. That is locked in the added evaluator assertion and is the required Scan.take-before-prefix boundary.

`struct` / `node` / `list` are finite static maps, not a registry. Unknown rule/constraint/column variants still go through `deepSorted`; unknown statements/domains/expressions still return the original tagged object (`unchanged`), matching parent switch defaults. `Return` remains a payload expression, not a struct. `Text` constraint still defaults `min` with `?? 0` and omits `format` when `== null`. Argument `format:null` hashing is unchanged in this file; admission of present argument `format:null` remains the separate evaluator/native predicate path.

Inherited-name statement tags (`constructor`, `__proto__`, `toString`, `hasOwnProperty`) are not `Object.hasOwn` keys of `STATEMENT`. Parent used `order[kind] ? pick(...)` and therefore called `pick` with `Object` / `Object.prototype` as the field list. Current code restores that boundary explicitly:

```ts
if (!Object.hasOwn(STATEMENT, kind) && kind in STATEMENT) pick(data, STATEMENT[kind] as any, kind);
return node(statement, STATEMENT, unchanged);
```

Without that guard, `node` + `unchanged` would hash those tags as novel constructors. Packet `evidence/unknown-before-fix.json` records that introduced dispatcher divergence; `evidence/unknown-after-fix.json` records 15 equal before/current outcomes, all refusals for the inherited names and identical JSON for `Novel`. Refusal is still a `TypeError` (`fields.includes is not a function` or `{} is not iterable`) rather than `E_SCHEMA` when the payload is an object. That TypeError shape is **inherited**, not newly chosen, and the added test only asserts `instanceof Error`. It is enough to keep those tags from becoming admitted identity bytes.

`canonicalProgramJson` stringifies immediately and does not retain the input tree. Mutating `scan.prefix[0].Scalar.Literal.Id` after the first stringify changes the next stringify. Callers (`held-program.ts` planHash, evaluator corpus hashes, `offline-schema.ts` schemaDigest, `value-runtime.ts` rule hash, `RowImage.prepare` schema identity) still go through these functions; standalone validation in the evaluator/compiler is not replaced by this hasher.

Uncertainty: this review did not re-execute the 280-input native 26c9 checker. Packet `check-summary.json` records evaluator-with-checker 225/225 plus 24 serverOnly, exit 0, on the frozen candidate; that is evidence in the packet, not a check run here.

## 2. Shared answer / reference traversal

`ValueWalk` is one transient walk. `build=false` uses `forEach` / entry iteration and allocates no reconstructed containers (`collectRefs`, `wire`, `validateReferences`, `assetIdsIn`). `build=true` reconstructs; `sort=true` uses JavaScript UTF-16 `Object.keys(...).sort()` for canonical **wire** JSON, distinct from value-runtime codepoint order. That matches parent `canonicalWire`.

`asRowRef` / `escapedFields` remain the `$row` grammar: exactly one own key `$row`; row refs have own keys `id,table`; escaped objects have exactly one inner key and a plain-object `$value`. Application `{ $row: { value: ... } }` is not escaped and is walked as data, which is what pair-candidate1 case 3 depends on.

Decode phase order in `decodeDeliveryEnvelope` is unchanged: `wire(data)` → rows → `receipt` → `validateReferences(data)` → `validator`. The added protocol test asserts: non-integer scalar path `$.data.scalar` before receipt; `receipt: null` before a missing pooled ref; missing nested ref path `$.data.$row.$value.child`. `validateReferences` now uses `asRowRef`/`escapedFields` (`object()`, any prototype) where parent used `plain()` (`wireObject`, prototype Object or null). On this decode path `wire()` already demanded `plain()`, so envelope admission is equivalent. `canonicalWire` still uses `plain()`.

`expandRows` still `structuredClone`s each pooled row at each occurrence, so two refs do not alias the same outward object, and later mutation of `envelope.rows` cannot change returned bodies. `mapRowValues` unwraps escaped objects and does not treat an escaped root whose `$value` is itself a marker as a row ref (it walks children of that marker). That is parent `mapRowValues` behavior as well.

`pairAnswer` keeps three policies on one walk:

- **hidden:** `next == null` collects every ref under `old` (via `collectRefs`); a surviving row ref stops; escaped wrappers unwrap on both sides; arrays walk `min(old,next)` only, so a truncated suffix is not a hidden signal (LLP 1012 §5); objects walk own keys of `old` with `Object.hasOwn(next, name)` (parent used `Object.prototype.hasOwnProperty.call`).
- **retained:** a hidden retained ref returns the original marker; truncated suffix / missing object keys are restored only if `collectRefs` hits `selected`; restored missing keys use `Object.defineProperty` so an own `"__proto__"` cannot become the prototype; copies are `JSON.parse(JSON.stringify)`, which is the store’s `jsonState` form (`range-store` `clone` is `jsonState(raw(...))`). Answer `data` on this path is already wire JSON, not `RowImage`.
- **viewed:** row-ref check runs **before** escaped unwrap. After unwrap, the walk does not re-test `asRowRef` on the escaped root. An escaped literal whose `$value` is a marker therefore stays a marker; a nested actual ref inside escaped fields still nulls. That is the parent `nullViewed` defect: after descending `$value`, it treated the inner marker as a viewed row and returned `null`.

`OfflineRuntime.expandUnviewed` expands first, then awaits `viewedRows`, then pairs `envelope.data` with the already-built expansion. Denied envelopes still skip expansion. Packet `evidence/viewed-after-fix/result.json` matches `{ actual: null, literal: { $row: { table: "messages", id: "a" } } }` under public `accept` with synthetic authority. The sqlite test additionally mutates `envelope.rows[1].row.nested.text` while `viewedRows` is suspended and expects the pre-await body.

`purgeAnswerData` still nulls literals and matching refs, re-wrapping escaped objects. Tombstone chronology and outbox rollback are not reimplemented here; `range-store` still assigns restored `data` only after hidden/retain decisions, and the sqlite abort test checks answer plus outbox unchanged on thrown `beforeCommit`.

`assetIdsIn` keeps the typed `RowImage` visitor at the root and re-enters it when `ValueWalk` meets a nested nominal image. Parent recursion into `assetIdsIn` did that automatically; the walk would otherwise `Object.entries` a branded image and miss tagged media. `nullOnceMedia` still nulls wire-shaped `{id,width,height}` records, including aliases.

`collectRefs` no longer builds discarded maps of reconstructed objects; packet `evidence/work-count/result.json` records 4 object reconstructions / 7 array maps → 0/0 with the same refs. That is a bounded work observation only, not memory or latency.

## 3. Generic ProjectionCache normalization

Unjournaled `prepare(state)` (no `changed`) now calls `projectState(state)` **before** metadata splitting. `projectState` is `jsonState(imageState(state))` then `metadata(rest)`: whole-state JSON omission of `undefined` object fields, array holes and `undefined` slots become `null` and keep length, `RowImage` rows become wire. Puts then reuse those already-normalized values and skip the extra `JSON.stringify`/`parse` child roundtrip. Trusted journal updates (`changed` truthy, including an empty `Map`) still visit only changed records, `imageRecord` rows, and key/root-only `committed()` ownership after the carrier transaction succeeds.

That is the F1 root-to-child deletion path: a missing metadata root is absent from `projectState` output, `compare` removes previously owned child keys, and the last owner disappearing drops the field (`!Object.hasOwn(open(), 'futureMetadata')` in the new sqlite test). Failed `beforeCommit`/`beforeReplace` does not call `committed()`, so ownership and persisted state stay on the previous snapshot. Caller mutation after `replace` returns a promise cannot alias into the projection: `jsonState` already copied. `retainedProjectionValues` still sees keys, not body strings; close still reclaims empty root buckets.

Journaled metadata remains the existing `metadataChanges` path and is not this delta’s generic-replace fix. File/IDB/SQLite still share `projection.ts`; sqlite/IDB still pass live state when `preparedProjection` is set. No full-row JSON baseline is restored.

## 4. Introduced versus inherited

Introduced and required:

- Scan transform order (`take` before `prefix`) with serde output order preserved.
- Inherited-name statement dispatch restored so those tags cannot hash.
- `pairAnswer` viewed: escaped literal roots are not re-read as markers; nested actual refs still mask.
- Expansion before `await viewedRows`.
- Generic replace normalizes whole JSON before metadata split; array length/`undefined` omission survive abort, retry, cold open, last-root delete.
- Nested `RowImage` re-entry in `assetIdsIn`.
- `collectRefs` without reconstructed containers.

Inherited, not cleared by this delta:

- Prototype statement tags still refuse with `TypeError`, not `E_SCHEMA`.
- `COLUMN_FIELDS[kind]` in unchanged `normalizeColumnType` still uses ordinary property lookup; `"constructor"` as a column tag is a pre-existing hasher footgun, not touched here.
- Unknown **statement** constructors other than inherited Object names still hash as the original tagged object (hasher is not admission).
- Canonical hasher TypeErrors vs evaluator `EvalError` families.
- `ir-contract.json` `valueModelVersion` v2 versus runner v5 constants: retained mismatch, not a native-integration claim.
- Gzip 75815 / minified 230321: measured FAIL in packet `final-measure` pid 3885172 exit 1. Parent also failed size.
- No current resident, phone, or native-owner execution in this packet for the identity diagnostic (synthetic malformed/unknown plus fixtures; 1372858 UTF-8 bytes recorded as matching at those graphs before the prototype-refusal correction).
- `validateReferences` `object()` vs parent `plain()` is equivalent only after `wire()`. Not a decode change.

Unsupported here: that this delta is safe on current-main, on a device, or under a native server; that work-count 0/0 is a memory win; that 16 extra gzip bytes are explained beyond the recorded non-additive gzip note.

## 5. Packet checks (not re-run)

From `evidence/check-summary.json` / `final-byte-delta.json` / `final-measure.json`:

- package build pid 3878349 exit 0, 3.171745s / 120s
- evaluator-with-checker pid 3878679 exit 0, 6.681339s / 120s; 225 cases, 24 serverOnly, 2 visibility
- protocol 9 tests exit 0; sqlite 8 exit 0 (includes the three new tests); retention 10 exit 0; bytes 7 exit 0; movement 43 exit 0
- final-measure pid 3885172 exit 1, 0.515533s / 60s — size failure
- Node 22.23.2 / Bun 1.3.12 as recorded on EPYC; not a new Node adapter
- Cap fixture and seven accounting declarations: packet says source-equal to 23a0 and **not** rerun; this review does not relabel them as current execution

Synthetic scope remains synthetic: viewed/unknown/pair probes are not native emitted frames, Client grant admission, or SQLite-on-device except where the sqlite tests use Node `node:sqlite` and FakeIDB as the packet states.

## Ownership

No new persistence format, no new envelope field, no new IR constructors, no input cache, no whole-row body baseline in `ProjectionCache`, no subtraction of logical facts by sharing references. Physical/transient ownership stays on existing projection key sets and carriers. Session contracts in `contracts/` (clock identity, ordinary-conditional-before-timed, 524288 integrity slots) are not implemented in these 11 paths and are not claimed here.

---

READY
