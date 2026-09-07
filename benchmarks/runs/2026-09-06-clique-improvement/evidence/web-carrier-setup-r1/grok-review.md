VERDICT: READY
Candidate: 620616271343fb302ede37f45bc285f5e39fb9b5
Base: 9ec668f6c345954ba474da1bcd1daf20ee54f11d

Five-file change: `snapback2/packages/snapback2/{build.mjs,guide/offline.md,src/client.ts,src/offline.ts,tests/offline-store.test.ts}`. Parent copies are under `before/`. Snapshot hashes match `source-manifest.json` and `evidence/raw/source-manifest.json`.

# Summary

The candidate fails the published web misspelling (`offline.store: indexedDbRangeStore` without calling the builder) at `createClient` with a `TypeError` that names `indexedDbRangeStore()`, instead of constructing a client that later refuses `E_OFFLINE_CARRIER` at `RangeStore.open` with `this.store.open is not a function`. Validation is minimum-open against the generic `RangeStore` contract, invokes the factory once, keeps genuine factory/carrier errors as refusals, and the guide addition is the correct builder call without a durability-bar claim. No material supported-behavior regression found.

# Assessment

## 1. Minimum-open structural validation vs RangeStore

`RangeStore` (`snapshot/snapback2/packages/snapback2/src/store/range-store.ts:300-314`) requires `open`, `unseal`, `seal`, `wipe`, `answer`, `commit`, `coverage`, and `outbox`. LLP 1012 §4 lists the same core surface (`open` first).

The check is only `typeof this.store?.open !== "function"` immediately after the single `options.store()` call (`snapshot/snapback2/packages/snapback2/src/offline.ts:220-224`). That is the minimum probe that distinguishes a `RangeStore` from the value the uncalled builder returns: `indexedDbRangeStore()` is a `RangeStoreFactory` (`(): RangeStore` plus optional `carrier`, `range-store.ts:316-319`), and a function has no `open`.

Optional chaining is required. Without `?.`, `null`/`undefined` would throw a native `TypeError` on property access inside the client constructor `try`, and that native `TypeError` is not `InvalidOfflineStoreError`, so it would be wrapped as `SnapbackRefusal` (`client.ts:190-195`). Counterexample: `store: () => null` must be a setup `TypeError`, not `E_OFFLINE_STATE`. The tests include `null` and `undefined` (`tests/offline-store.test.ts:615-618`).

Checking `commit`/`outbox`/etc. would be interface expansion. A result with only a callable `open` is accepted at setup and fails later on use; that matches “minimum-open”. ByteCache and OutboxLedger constructors only store the reference (`store/byte-cache.ts:242-245`, `store/outbox.ts:109`), so they do not secretly full-duck-type at setup.

## 2. Valid callable / inherited / custom stores remain accepted

`typeof store.open === "function"` walks the prototype chain and accepts function objects with own methods.

Counterexamples from `tests/offline-store.test.ts:623-646`:
- Inherited: `Object.create(methods)` — `open` is on the prototype, not an own property.
- Callable: `Object.assign(() => {}, methods)` — the store is a function and still has `open`.
- Unbranded: no `carrier` property, not a `PersistentRangeStore`.

Each factory is invoked once; `open` runs once during `ready` with `as: "alice"` and `startOffline: true`. Parent baseline already passed this test (`evidence/raw/baseline-regression.log`), so the new check did not newly reject these shapes.

Built-in carriers stay valid: `PersistentRangeStore.open` is a class method (`range-store.ts:660`). Existing file/IndexedDB/SQLite tests in the same file still pass in supplied logs (35/0). Templates already pass `store: indexedDbRangeStore()` (`templates/react/src/main.tsx:7-8`, `templates/chat/react/src/main.tsx:10`).

## 3. Factory evaluation is once-only; factory/carrier errors keep semantics

`options.store()` runs once in the `OfflineRuntime` constructor. `validateOfflineOptions` (`client-offline.ts:35-48`) only checks that `store` is a function and does not call it. Client calls validate twice (constructor then `createOfflineRuntime`) but still does not invoke the factory there.

Invalid returns: the factory is called, the result is rejected, and the factory is not called again (`tests/offline-store.test.ts:615-618`, `calls === 1`).

Throwing factories remain refusals, not setup TypeErrors (`tests/offline-store.test.ts:648-657`):
- `Error("factory failed")` → `SnapbackRefusal` `E_OFFLINE_STATE`, site `client.offline`
- `TypeError("factory failed")` → same (not `InvalidOfflineStoreError`)
- `TypeError` with `code: "E_OFFLINE_CARRIER"` → `SnapbackRefusal` `E_OFFLINE_CARRIER`

Unavailable IndexedDB still fails at `RangeStore.open`, not at setup: `indexedDbRangeStore({ indexedDB: {}, locks: {} })` returns a store whose `open` is a function that throws `OfflineStoreFailure` (`store/indexeddb.ts:275-284`). The new check must accept that store. Counterexample in tests (`offline-store.test.ts:658-668`) and browser evidence: `E_OFFLINE_CARRIER`, site `RangeStore.open`, message `IndexedDB and Web Locks are required`, rewrite `install or configure the IndexedDB carrier`. Parent already passed this test; candidate browser `unavailable` matches published.

## 4. Internal TypeError subclass and client catch boundary

LLP 1012 §15: a bad client option is a `TypeError`; carrier-thrown errors keep refusal semantics.

Parent catch (`before/.../src/client.ts:190-194`) wrapped every constructor error, including a setup `TypeError`, as `SnapbackRefusal`. The new error is thrown from inside `new OfflineRuntime`, which is inside that `try`, so a plain `TypeError` would become a refusal.

The boundary is the subclass (`offline.ts:178-179`, `@ref LLP 1012#15-diagnostics`) plus `if (error instanceof InvalidOfflineStoreError) throw error` (`client.ts:190-195`):
- Setup: missing/non-callable `open` → `InvalidOfflineStoreError` extends `TypeError` → rethrown. `error.name` stays `"TypeError"` (TypeError.prototype). Tests and browser JSON assert `instanceof TypeError` / `name: "TypeError"`, not the subclass name.
- Factory throws any `TypeError` that is not that subclass → still `offlineRefusal` → `SnapbackRefusal`. A catch of `instanceof TypeError` would have broken `TypeError("factory failed")`.
- Option-shape TypeErrors from `validateOfflineOptions` still throw *before* the `try` (`client.ts:189`; “must be a carrier factory”, fenceDays bounds). Unchanged.

`InvalidOfflineStoreError` is not re-exported from `dist/client.d.ts`. Public contract remains `TypeError`.

## 5. Browser example: executable, correct builder call, precise, no extra durability claim

Added text (`guide/offline.md:4-16`):

```js
import { createClient } from "snapback2/client";
import { indexedDbRangeStore } from "snapback2/react";
const client = createClient({
  url: "http://127.0.0.1:3210",
  offline: { store: indexedDbRangeStore() },
});
```

- `createClient` is the `snapback2/client` export (`package.json` `./client`).
- `indexedDbRangeStore` is the `snapback2/react` export (`src/react.tsx`; LLP 1012 §4: `snapback2/react` exports exactly one carrier, IndexedDB).
- `indexedDbRangeStore()` returns a `RangeStoreFactory`, which is what `OfflineClientOptions.store` is. This is the same spelling as the React templates. The published misspelling omitted `()`.
- Surrounding prose: call the builder to get the factory; custom factories return a RangeStore; missing `open()` is setup `TypeError`; IndexedDB and Web Locks required; no memory fallback. That matches LLP 1012 §4 (loud `E_OFFLINE_CARRIER`, never fall back to memory) and §15 (bad options are TypeErrors). It does not claim process-kill durability, queued-write qualification, or the offline bar (LLP 1012 §10/§12).

The fence is a `js` code block, so `build.mjs` `guideFailures` (`build.mjs:442-448`) does not require the snippet to appear in compiler fixtures (it only scans `ts` blocks). The snippet is still valid ESM for a React web app that already depends on `snapback2/react`. Construction does not open IndexedDB; `open` happens later, which is what the example is teaching.

## 6. 432-byte addition vs authorized +512 page limit

Guide bytes: 4352 → 4784 (delta 432). Limit: 4352 → 4864 (+512) in `build.mjs:204` only for `name === "offline"`. Remaining slack 80 bytes. Other page limits unchanged.

The added bytes are the executable builder example plus the three setup facts that name the published failure. That is the authorized use of the increase. No twin/gzip or unrelated budget change is in the diff.

## 7. Tests and browser evidence vs their claims

New tests (`offline-store.test.ts:606-669`):
- Wrong spelling `store: indexedDbRangeStore` throws the setup `TypeError` whose message includes `offline.store must return a RangeStore with open()`, `store: indexedDbRangeStore()`, and `snapback2 guide offline`, with custom `fetch` never called.
- Invalid returns: `undefined`, `null`, `1`, `true`, `"store"`, `{}`, `{ open: 1 }`, `Promise.resolve({})`, `() => ({})` — so thenables and nested factories are not awaited/re-invoked.
- Custom inherited/callable stores accepted; factory once.
- Throwing factories and unavailable carrier as above.

Parent baseline of those three tests: 2 pass / 1 fail (`evidence/raw/baseline-regression.log`). The only parent failure is the missing setup exception for the builder misspelling — the behavior being added. Candidate existing offline-store suite: 35 pass / 0 fail (`evidence/raw/final-offline-store.log`, 2.416s), including the three new tests as ok 14–16.

Browser probe (`evidence/raw/published-reproduction.mjs`) is not the original app and stubs auth. Claims it actually supports:
- Published: `store: indexedDbRangeStore` constructs, reaches `ready`, then login → `E_OFFLINE_CARRIER` at `RangeStore.open`, message `this.store.open is not a function`, rewrite using the minified factory name (`Tt2`).
- Candidate final (`evidence/raw/candidate-final-reproduction.json`): same misspelling throws at construction (`mistake.name: "TypeError"`, message with `indexedDbRangeStore()`); no `mistakeConstructed`/`mistakeReady`. Control: real IndexedDB, exclusive Web Lock `snapback2:dev:control`, custom wrapper factory once (still 1 after `offline()`), reopen reads `["stored in real IndexedDB"]`. Unavailable envelope unchanged. `errors: []`.

`evidence-facts.md` does not claim process-kill, queued-write qualification, benchmark repair, or publication. Tests and browser JSON match those limits. Caps and ref-check exit 0 in supplied logs. Package build is supplied as factual success (empty stdout logs).

# Optional suggestions (not blockers)

1. `guideFailures` does not execute or fixture-check ` ```js ` blocks. The snippet is correct by inspection and matches the templates; a later API rename would not fail the page build. Not required for this change.
2. `export class InvalidOfflineStoreError` appears in `dist/offline.d.ts` even though `./offline` is not a package export and `client.d.ts` does not re-export it. Leaving the class unexported would make the public contract “plain TypeError” slightly tighter. No runtime effect.

# Validation performed

Inspected (no product mutation):
- `snapshot/snapback2/AGENTS.md`, `snapshot/rules/RULES.md`, `snapshot/rules/NOT-DOING.md`, `snapshot/llp/1000-snapback2.explainer.md`, LLP 1012 §§4, 10, 15
- `evidence-facts.md`, `source-manifest.json`, `evidence/raw/source-manifest.json`, `revision.patch`, `workload.json`, `launch.json`
- Complete candidate and parent copies of the five changed files
- Callers/interfaces: `RangeStore` / `RangeStoreFactory`, `indexedDbRangeStore`, `validateOfflineOptions` / `createOfflineRuntime` / `offlineRefusal`, `Client` constructor and `openOffline`, `ByteCache` / `OutboxLedger` constructors, `package.json` exports, `src/react.tsx`, React templates, `build.mjs` `guideFailures`, `tests/live-fixture.ts`
- Supplied evidence: `baseline-regression.log`, `final-offline-store.log`, `candidate-offline-store.log`, `candidate-final-reproduction.json` / `.log`, `published-final-reproduction.json`, `published-reproduction.mjs`, `caps.log`, `ref-check.log`, `outcome-assertions.json`

New execution (integrity only, not a product test):
- Node SHA-256 of the five changed files, parent copies, `dist/client.mjs`, `dist/guide/offline.md`, `revision.patch`. All matched the packet manifests. Guide 4352→4784.

Not executed (no material uncertainty remaining; budgets are ceilings):
- The three new candidate setup tests
- Extra counterexample commands
- Client/browser bundle
- Headless browser probe (ports 52930–52939 unused)
- Baseline suite, full package build, compiler/Rust/native, original app

# Limits

- Packet omits compiler sources and full product build inputs; supplied successful package build was taken as factual.
- Guide snippet was not run in a browser; executability is from source plus the probe’s correct `indexedDbRangeStore(...)` control.
- Browser evidence uses stubbed authentication and a private origin, not the benchmark app, and is not a physical process-kill witness.
- No author `REPORT.md`, peer review, original benchmark audit, or other review directories were read.
- Requested model/effort are in `launch.json`; this file does not assert process identity or terminal completion.
