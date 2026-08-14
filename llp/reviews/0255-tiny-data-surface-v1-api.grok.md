# Grok family reviews — LLP 0255 (tiny data surface v1 API)

Review artifacts for `llp/0255-tiny-data-surface-v1-api.spec.md` from the
Grok family, one dated section per round, bodies verbatim.

## Round 1 — 2026-08-13

- **Runtime:** Grok CLI, model `grok-4.6`, `--reasoning-effort xhigh`,
  `--output-format plain`, `--disable-web-search`, launched blind in the
  round-1 capsule by the orchestrating session (launch 1).
- **Revision reviewed:** r1, SHA-256
  `8d7d63ff8459e9e8fcca086e5fb4ea280423d6ef011135fe4435321a2db69358`
  (64,741 bytes); hash and byte count verified in-capsule.
- **Capsule inventory SHA-256:**
  `73d50b7ca674cfc14f86b0d80fdb481bfd89526f937c6d8c5b6d2282849f4b30`;
  instruction SHA-256
  `6ba2498e8e4f1a3e460a54417d807bd2740b21534b53c32d057557b780c72593`.
- **Transport note:** the plain-format stream prefixes interstitial
  progress narration before the artifact heading; the raw stream is
  preserved by the orchestrator and the body below is byte-verbatim from
  the artifact heading onward.
- **Verdict:** NOT READY (5 MATERIAL, 5 DETAIL; direction retained).
  Self-attested capsule-only; disclosed reading the landed 0254 grok
  review as permitted corpus history; harness-injected context
  disclosed.

---

# LLP 0255 r1 review

**Reviewer:** Grok 4.6 (xAI), Grok Build agent runtime  
**Date:** 2026-08-13  
**Target:** `llp/0255-tiny-data-surface-v1-api.spec.md`  
**Type / Status:** Spec / Review  
**Revision:** r1  
**SHA-256 (verified in-capsule):** `8d7d63ff8459e9e8fcca086e5fb4ea280423d6ef011135fe4435321a2db69358`  
**Byte count (verified in-capsule):** 64,741

**Notable files actually read or searched (capsule only):**  
`REVIEW_INSTRUCTIONS.md`; `llp/0255-tiny-data-surface-v1-api.spec.md`; `llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0065-generated-data-pattern-soundness.rfc.md`; `llp/0218-outbox-settlement-contract.rfc.md`; `llp/0043-offline-replay-retention.rfc.md`; `llp/0238-explicit-client-lifecycles.rfc.md`; `llp/0157-composition-algebra-and-completeness.spec.md`; `llp/0253-familiar-profile-v1-api.spec.md`; `llp/0252-convex-familiar-authoring-profile.rfc.md` (via 0253/0254 citations); `llp/0108-inline-handlers-and-result-contracts.spec.md`; `llp/0004-application-data-api.rfc.md`; `llp/0155-local-sync-product-direction.rfc.md`; `llp/0241-semantic-artifact-generation.rfc.md`; `llp/0242-bounded-query-composition.rfc.md`; `llp/0243-policy-aware-protected-retention.rfc.md`; `llp/0247-ordinary-client-normalization-and-recovery.rfc.md`; `guide/backend/standard-patterns.md`; `packages/snapback-codegen/{define.mjs,define.d.ts,standard-patterns.mjs,standard-patterns.d.ts,familiar.mjs,index.mjs,semantic-generation.mjs,result-contracts.mjs}`; `packages/snapback-client/{index.mjs,index.d.mts,materialization-bridge.mjs,generated-mutation-ir.mjs,materialization-store.mjs,outbox-shared.mjs,app-data.mjs,package.json}`; `packages/snapback-react/{index.d.mts,familiar.mjs}`; `packages/snapback-umbrella/package.json`; `src/{admin.rs,data_tier.rs,value_expr.rs,storage.rs}`; `llp/reviews/` listing (no `0255*` entries); `llp/reviews/0254-tiny-ordinary-data-surface.grok.md` (allowed landed corpus; not a review of this target). Attempted `llp/0080-query-visibility-and-derived-projections.rfc.md` (not present under that name).

## Overall assessment

This Spec is a real Phase 0 contract, not a restated RFC. It does the work LLP 0254 assigned: it freezes `.data` as a terminal closed table method; derives owner assignment from explicit owner visibility rather than an authored default; folds sync into an application default plus `dataSync:"disabled"` opt-out; chooses fluent builder, static catalogue plus runtime validation, and mandatory `.take`; pins 16-chunk atomic transactions; keeps settlement obligatory across the four prediction × custody cells; gives the tiny surface a distinct `/data` doorway; writes S3 amendments as proposed-pending rather than silently rewriting Accepted owners; enumerates LLP 0252/0253 dispositions; names the OQ8–OQ12 defaults; and supplies a mechanical withdrawal table. S0’s shipped-code citations that I checked are accurate: `TableBuilder` has no `.data` (`packages/snapback-codegen/define.d.ts:589-606`); absent visibility still only warns (`packages/snapback-codegen/index.mjs:2770-2847`); `defineOwnedCrud` refuses a missing `listIndex` (`packages/snapback-codegen/standard-patterns.mjs:257-270`); QMK already includes function, plan, args, and authority partition (`packages/snapback-client/materialization-bridge.mjs:167-182`); shipped `QueryState` is the six-arm union with `error`/`connection`/`freshness`/`retention` (`packages/snapback-react/index.d.mts:151-157`); dispatch is still `settled|queued` (`packages/snapback-client/index.d.mts:383-394`); a pending outbox record cannot infer outcome-unknown (`packages/snapback-client/index.mjs:7263-7267`); codegen policy has no `dataSync` key (`packages/snapback-codegen/index.mjs:15221-15223`); the umbrella exports only `/server|values|react` (`packages/snapback-umbrella/package.json:27-39`).

It is **not ready as implementation authority**. The query identity story that LLP 0254 D4 made the security/materialization boundary is internally contradictory: S2 reuses `defineOwnedCrud` documents results and take-only lists, S5.3 makes every data query a `DataPageV1` cursor page, and S6.1 requires equal result-contract hashes before two spellings may share a function slot. The hashed query core is not a closed schema (`DataFilterTemplateV1` is used and never defined; filter-array order and cursor-versus-QMK are decided both ways). Multi-chunk `db.transact` has artifact fields but no ordinary function identity 0043 can replay. Sync-on is written as if it bundled 0065-disclaimed retention. The 0218/0043 amendment introduces `intentId` without binding it to the shipped durable key. Those are defective decisions, not Phase 1–3 altitude leftovers.

The direction is the right one. Fix the identity and amendment holes in this document before treating it as the Phase 1–3 build law.

## Concerns

### 1. MATERIAL — S2 / S5.3 / S6.1 — Exact function-slot match is dead against the reused CRUD result and pagination profile

**Defect.** LLP 0254 D4 requires function-slot sharing: when a descriptor lowers to an existing generated operation’s plan and contract, it must copy that operation’s exact `FunctionReference` and share the complete LLP 0157 preimage. This Spec repeats that rule (S6.1, lines 825-836) and forbids a second policy/plan implementation (S2, lines 225-229).

Shipped `defineOwnedCrud` list/get are `defineLiveQuery` plans whose effective result is `kind: 'documents'` (`packages/snapback-codegen/standard-patterns.mjs:315-334`; `packages/snapback-codegen/result-contracts.mjs:874-880`). That is an array of table documents, with `listLimit` default 100 and **no** cursor page wrapper. LLP 0065’s Implemented list is that helper; cursor pages are a *different* helper (`owned-keyset-pages.v1`) that requires a unique `[visibilityField, cursorField]` index (`llp/0065-generated-data-pattern-soundness.rfc.md:235-244, 260-262`). Appendix A1’s `by_owner_created` is not unique, so it cannot be that helper either.

S5.3 nevertheless makes **every** data-query result `DataPageV1<{rows, cursor, complete}>` (lines 754-763) and defines an opaque `dc1.` cursor over a non-unique index plus `_id` totalizer (lines 765-770). S6.1’s match predicate includes equal `resultContractHash` (lines 829-832). Those three clauses cannot be true together:

- If list/get keep documents results, no catalogued descriptor can exact-match them, so the data spelling and the generated named operations never share invocation identity or QMK. That violates 0254 D4 for the default Todo list in Appendix A1 (`using("by_owner_created").orderBy("createdAt", "asc").take(100)` is exactly the owned-crud list plan, but not its result contract).
- If decoration rewrites list/get to `DataPageV1`, that is a new plan/result, not `defineOwnedCrud` reuse, and it is a new pagination profile 0065 does not ship.
- S6.1 also excludes handwritten, promoted, and synthesized members from the candidate set (lines 827-828, 842-843). The only remaining candidates are the CRUD reads whose contracts do not match. The “exactly one match” path is empty by construction.

This is not an open question. It is a closed, inconsistent identity rule.

**Resolve.** Pick one and write it as law: (a) the data lowerer emits read operations whose result contract **is** `DataPageV1` (a named new helper, not `owned-crud.v1` documents), and S6.1 matches only those; or (b) keep `defineOwnedCrud` documents/get-empty-array semantics, make `DataPageV1` a tiny-client facade over that contract, and put the function `resultContractHash` on the documents contract so A1’s list shares `todos.list`; or (c) state that generated `list`/`get` are promotion/withdrawal artifacts only and that every descriptor synthesizes S6.2, and delete S6.1’s “share invocation identity” sentence. Do not leave all three in force.

### 2. MATERIAL — S4.3 / S5.1–S5.2 / S6.2–S6.3 — The hashed query template and materialization preimage are not closed

**Defect.** `NormalizedDataQueryCoreV1.filters` is `readonly DataFilterTemplateV1[]` (line 519). `DataFilterTemplateV1` is never defined anywhere in the document. The witness `normalizedDataQueryId` hashes that core (lines 376, 561). An implementer cannot produce a deterministic catalogue.

Three adjacent identity decisions are also both-ways:

1. **Filter-array order.** S4.1 says arrays whose order is not semantic are sorted by UTF-8 before hashing, and that index field sequences are semantic (lines 367-370). It does not classify `filters`. Conjoined predicates commute; source-object enumeration does not. `{completed:false, priority:1}` versus `{priority:1, completed:false}` can therefore mint two witnesses and two synthesized exports.
2. **Scalar equality versus `{eq}`.** S5.2 admits both `T` and `{eq:T}` (lines 716-719). S5.1 says operators are compile-time shape and values are slots (lines 698-700). The document never says the scalar form is canonicalized to `{eq}` before hashing.
3. **Cursor versus QMK.** S4.3 splits `arguments` from `cursor` on the envelope and says the QMK remains the LLP 0157 hash over function, plan, **canonical arguments**, and authority partition (lines 551-567). S6.2 says cursors occupy the synthesized member’s closed slots (lines 867-868). S6.3 then passes “the resolved reference and canonical slot arguments” unchanged into the shipped bridge (lines 873-876), whose preimage is exactly those four fields and does **not** have a side cursor (`packages/snapback-client/materialization-bridge.mjs:167-182`; `llp/0157-composition-algebra-and-completeness.spec.md:752-778, 838-844`). If cursor is a slot, it must be in `canonicalArgs` and therefore in QMK (each page is a distinct materialization). If cursor is only an envelope field, two pages share one QMK and will overwrite each other. The Spec asserts both.

S3.4’s “no 0157 amendment” claim is true only if an ordinary member’s args already carry every runtime slot the bridge will hash. The cursor split, as written, is either a silent 0157 preimage change or a page-aliasing bug.

**Resolve.** Publish a closed `DataFilterTemplateV1` (field, operator, slot index). Pin filter order (index-field order, or UTF-8 key sort with a stated “not semantic” label). Canonicalize bare equality to `{eq}` before hashing. State in one sentence that `after(cursor)` is a named argument of the resolved function and therefore part of 0157 `canonicalArgs`, **or** that pagination mutates a single materialization and cursor is excluded from QMK by a dated 0157 amendment. Slot numbering must be total for `in` arrays and range endpoints.

### 3. MATERIAL — S4.4 / S7.1–S7.2 — Multi-chunk `transact` has no replayable function identity

**Defect.** S7.1 admits 1..16 chunks as `atomicity: "single-authoritative-transaction"` (lines 900-905, 582). S4.4 stores per-chunk `functionId`s and a transaction witness that **excludes** `intentId` and values (lines 572-630). There is no S6 analogue: no rule that one chunk **is** that generated mutation’s `FunctionReference`, and no synthesized ordinary `Mutation` (name, `{appId}:{exportedName}`, one plan, one implementation hash) for two or more chunks.

LLP 0043 replays durable intents by captured function identity and canonical arguments (`llp/0043-offline-replay-retention.rfc.md:266-286, 352-357`). S3.2 says a queue-eligible record “may then replay exactly as LLP 0043 specifies” (lines 296-300). A 16-chunk `DataTransactionV1` is not an LLP 0043 mutation. Replaying sixteen functions is not one authoritative transaction. Inventing a new runtime batch endpoint is the rewrite 0254 listed as a non-goal (`llp/0254-tiny-ordinary-data-surface.rfc.md:222-223`).

Single-chunk `db.transact(db.tx.todos.create(...))` can be `mutate(todos.create, args)`. That path is determined. The multi-chunk path — the reason the ceiling is 16 rather than 1 — is not.

**Resolve.** Add a transaction-resolution section parallel to S6: one chunk copies the generated mutation reference; two or more chunks emit one ordinary generated `Mutation` whose plan is the sequenced chunk plans, whose stable id is `{appId}:{exportedName}` under a closed `IDENT.IDENT` spelling, and whose IR is what 0043 stores and replays. Refuse composition that cannot lower to one HostPlan. Do not send `DataTransactionV1` over a new wire as a second manifest authority.

### 4. MATERIAL — S1.3 / S4.2 / S5.4 — Sync-on bundles 0065-disclaimed retention

**Defect.** LLP 0065 v1 generated queries are callable and `live_replace` only: “Generated queries claim no retained/offline capability in v1: retention requires LLP 0053’s lease rules plus the LLP 0008 L4-style `authScopeField` convergence fixture, and is a future profile, not a default” (`llp/0065-generated-data-pattern-soundness.rfc.md:302-305`). LLP 0254 Phase 2 repeats that this is 0065 OQ5 and requires the follow-on Spec to **name** that admission and the 0053 lease/convergence-fixture obligations before any generated query claims retention (`llp/0254-tiny-ordinary-data-surface.rfc.md:878-882`).

This Spec’s only 0065 amendment is S3.1 (sole-candidate `listIndex`). S1.3 nevertheless says opt-out “removes live/local/retained capability” (line 217), which treats retained as part of the sync-on bundle. S4.2 then has required booleans `live`, `localMaterialization`, `retained`, `offlineCustody` (lines 474-481) with no default-false pin and no 0065 OQ5 close-out. S5.4 cites LLP 0243 as a later check (line 810) but does not say a generated data query is `retained:false` until the 0243/0053/0065 package is present on that plan. `.data({...})` has no retention opt-in, so the only source for `retained:true` is this sync switch.

Live delivery and query-scoped materialization of an **active** watch are 0065/`live_replace` plus 0155. Protected retention is not. Bundling them is a silent 0065 capability claim.

**Resolve.** Pin defaults: sync-on ⇒ `live:true` and active-query local materialization; `retained:false` unless the generated plan carries the named 0065 OQ5 / 0243 / 0053 lease and `authScopeField` convergence-fixture facts. Sync-off ⇒ `Query` rather than `LiveQuery`, as already written. Do not use “removes retained” as proof that sync-on granted it.

### 5. MATERIAL — S3.2 / S4.4 / S7.3 / S8 — `intentId` is a second settlement primary key

**Defect.** S3.2 is the right *kind* of amendment (declared custody; non-replayable online-only observation; `blockedReason:"outcome-unknown"`). Shipped code really cannot infer that reason (`packages/snapback-client/index.mjs:7263-7267`), and dispatch is only `settled|queued` (`packages/snapback-client/index.d.mts:383-394`; `llp/0218-outbox-settlement-contract.rfc.md:137-142`). 0218 already says identity-horizon-passed must surface as pending with an outcome-unknown blocked reason (`llp/0218-outbox-settlement-contract.rfc.md:170-172`); S3.2 does not misstate that.

What it does not do is name the durable primary key LLP 0043 already owns. 0043/0218 identity is `clientMutationId` (plus sequence on the queued dispatch arm). This Spec’s settlement, recovery, and `pendingWrites` key is `intentId` (S4.4 lines 613-624; S7.3 lines 957-974; S8 lines 1018-1034). S7.3’s queued arm also drops 0218’s `sequence` and `clientMutationId`. S3.2 never says `intentId === clientMutationId`, never says a second key is being added to the 1,024-record outbox, and never says how `db.transaction(intentId)` maps onto `mutationStatus(clientMutationId)`.

That is an incomplete 0043 amendment, not a projection. Two keys in one store is a new identity authority.

**Resolve.** In S3.2 and S7.3, write that `intentId` is the existing `clientMutationId` byte-for-byte. Tiny `DataDispatchV1` may omit `sequence` as a projection; the outbox record must still carry it. Do not mint a parallel id.

### 6. DETAIL — S11 / 0254 D11 — `.data` and data-table `.sync()` need a dated 0253 Appendix A splice

**Defect.** 0254 D11 forbids treating the RFC as implementation authority for familiar `.data` and requires a reviewed amendment or successor disposition (`llp/0254-tiny-ordinary-data-surface.rfc.md:770-778, 792-794`). 0253 Appendix A’s table-builder list has no `.data()` and admits authored `.sync()` verbatim (`llp/0253-familiar-profile-v1-api.spec.md:843-852`). S11 does enumerate the addition and the S1.3 `.sync()` change (lines 1124-1130). S3, which claims “this Spec does not silently rewrite those owners” (lines 253-256), does not include a dated 0253 paragraph.

0253 is Draft and D11 authorized this Spec to dispose it, so this is not the same class of hole as S3.1–S3.3. It is still a missing splice: an implementer of the 0253 fail-closed table cannot see the exact Appendix A rows.

**Disposition.** Add an S3.5 proposed-pending / successor-disposition block that quotes the Appendix A rows: `.data()` disposition 1 (shared schema vocabulary); `.sync()` remains disposition 2 for non-data tables and is refused as authored on a `.data` table per S1.3.

### 7. DETAIL — S1.1 / S5 / S7.1 — Generated `get` has no tiny doorway

**Defect.** Owner and public-read resources generate `<table>.get` (S1.1 lines 144-146; S2 lines 235-236). The tiny query grammar is only `using/where/orderBy/select/take/after` (S5.1 lines 686-694). `db.tx` has create/update/delete only (S7.1 lines 888-892). `_id` is not an authored index field (S5.2 line 743). The four-concept path cannot express get-by-id. Get exists only for promotion, withdrawal, and the dead S6.1 candidate set.

**Disposition.** Phase 2: either add `db.todos.get(id)` as a reserved descriptor that exact-matches the generated get operation, or state that get is not a tiny-client member.

### 8. DETAIL — S2 / S11 — No-drop is bound to the wrong table

**Defect.** 0254 requires a field-complete data-surface disposition of canonical function fields (`llp/0254-tiny-ordinary-data-surface.rfc.md:845-847`). S2 points that rule at S11 (lines 248-250). S11 is 0253’s *authored familiar* key matrix, not generated function IR (`retainable`, `authorityCreating`, `authorizationDependence`, `implementationHash`, …). S2’s freeze list (lines 245-248) is closer to the required table but is not fail-closed against the shipped function record (`packages/snapback-codegen/index.mjs:9730-9763`).

**Disposition.** Replace the S11 pointer with an explicit include/exclude table over the generated function record. Keep S11 for familiar source keys.

### 9. DETAIL — S3.3 — Do not replace 0238 D4’s hook grammar

**Defect.** S3.3 correctly supersedes D4’s illustrative `diagnostic` field with shipped `error` and keeps `pendingWrites` off base `QueryState` (lines 332-347; `packages/snapback-react/index.d.mts:151-157`). 0238 D4’s recommended object still includes `refresh` as a field and a different freshness enum (`llp/0238-explicit-client-lifecycles.rfc.md:266-276`). Rewriting “the canonical React query state” to `QueryState` is broader than 0254 D6’s “fork neither; shipped names govern the tiny projection.”

**Disposition.** Scope S3.3 to: shipped arm names govern; `refresh` is the D3 handle method; `pendingWrites` is a facade projection. Leave `useSnapbackLiveQuery`’s recommended spelling to 0238 except for the `diagnostic`→`error` note.

### 10. DETAIL — S5.3 / S4.4 / S7.3 — Several closed leaves are prose-only

**Defect.** `DataCursorV1`, `DataQueryExplainV1`, `AuthorityCaptureV1`, and `DataDiagnosticV1` are used in hashed or wire positions. Cursor and explain have prose inventories (lines 765-770, 814-821). S12 says diagnostics are `snapback.client-diagnostic.v2` (line 1139). `AuthorityCaptureV1` is undefined. S5.3 does not pin `complete === true ⇔ cursor === null`. S4.4 mentions speculative ids only as witness exclusions (line 627); create-id references across chunks already escape (line 903), but optimistic paint of create still needs 0155 provisional-id reconciliation, which 0254 listed on `DataTransactionV1`.

**Disposition.** Phase 2/3: type those four leaves; pin cursor nullity to `complete`; reference 0043’s enqueue capture for `AuthorityCaptureV1`; specify speculative-id rebase against the settlement receipt.

## Implementer-probe result

### (a) Author a small `todos` table and enumerate what generates

From the document alone, the complete explicit declaration is Appendix A1 plus S1.1–S1.3:

```ts
import { defineSchema, defineTable, v } from "@expo/snapback-codegen/define";
export const todos = defineTable({
  title: v.string(),
  completed: v.boolean(),
  ownerId: v.principal(),
  createdAt: v.integer(),
})
  .index("by_owner_created", ["ownerId", "createdAt"])
  .visibility({ kind: "owner", field: "ownerId" })
  .data({
    createDefaults: { createdAt: "now" },
    immutable: ["createdAt"],
  });
export default defineSchema({ todos }, { auth: { mode: "sessions" } });
```

Determined:

| Item | Value |
| --- | --- |
| `listIndex` | filled as `by_owner_created` under S3.1 (exactly one owner-leading ordinary index) |
| Operation names | `todos.list`, `todos.get`, `todos.create`, `todos.update`, `todos.delete` |
| Stable ids | `{appId}:todos.list` … `{appId}:todos.delete` (`OPERATION_NAME` already allows `IDENT.IDENT` at `packages/snapback-codegen/index.mjs:206`) |
| Args | list `{}`; get `{id}`; create `{title, completed}`; update `{id, title, completed}`; delete `{id}` |
| Owner / `createdAt` | not arguments; owner stamped from principal; `createdAt` is `"now"` |
| Writes on `db.tx` | `create` / `update` / `delete` only |
| Delivery | `list`/`get` are `LiveQuery` unless `dataSync:"disabled"`, then `Query` |
| Artifacts once any `.data` exists | `DataResourceV1`; `semanticInput.dataSurface`; generated `data.mjs` / `data.d.ts`; function-manifest members; `/data` and `/react/data` doorways |
| Zero `.data` | all of the above absent, not empty (S4.5) |

**UNDERDETERMINED (defective, not an OQ):** whether Appendix A1’s `db.todos.using("by_owner_created").orderBy("createdAt", "asc").take(100)` resolves to `todos.list` or to `todos.query_<16 hex of normalizedDataQueryId>` (concern 1); the template witness itself (concern 2); `capabilities.retained` / `localMaterialization` / `offlineCustody` for this resource (concern 4); `appId` (existing app identity, not this Spec’s hole).

Capability facts I can state only as ranges: `read:true`, `write:true`, `live` iff sync on, `cursor:"data-cursor.v1"`, `offlineCustody` intended queue-eligible when the target has a settlement ledger — not a pinned boolean vector.

### (b) Server-side admission of one `db.useQuery(...)` to first row

Reconstructed from S5, S6, S8, and 0157, with holes marked:

1. Client finishes the typestate chain and holds a `DataQueryV1` (template + runtime slot values + optional cursor). Shape-controlling arguments must have been compile-time literals in the catalogue.
2. Missing/unseen template ⇒ `SNAPBACK_DATA_QUERY_NOT_CATALOGUED`. **Hole:** whether this check is codegen-only, client-only, or an on-the-wire witness the server sees. S5.1 says the server admits an exact active witness; S6.3 says the client then invokes the existing bridge with a function reference.
3. `useQuery` capability gate: `sync.enabled`, live delivery, admitted local materialization, target support; else `SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE`. `"skip"` returns `skipped` with `pendingWrites:[]` and stops.
4. Server (or generation) rebuilds plan, policy, contracts, bounds, and resolution from the template; compares `normalizedDataQueryId` and `planHash`. Policy is the generated owner (or public-read) node, not `where`. Owner field is injected and forbidden in `where`.
5. Index prefix, at-most-one `in`/range, `orderBy` field, `take ∈ 1..200`, and every `DataCeilingsV1` check; first failure refuses; no truncation.
6. Cursor, if present: `dc1.<base64url>`, ≤ 2048 bytes, bound to app/generation/plan/args/authority/last total key; malformed or cross-boundary refuse identically. **Hole:** whether cursor is in 0157 `canonicalArgs` (concern 2).
7. Resolution must be the artifact’s `existing-generated` or `synthesized-generated` function. Multi-match already failed at generation. **Hole:** concern 1 makes `existing-generated` unreachable for the default list.
8. Auth/admission follows existing generated-query gates (0065/0058 order: target, credential, grant, then principal). Not-visible keyed reads project the same as not-found.
9. Execute the admitted indexed plan; work accounting `maxCandidateRows:1024`, `maxResultBytes:65536`; return `DataPageV1`. **Hole:** shipped CRUD execution returns documents, not that page (concern 1).
10. Live path: compute QMK via the shipped bridge (`function + planHash + canonicalArgs + authorityPartitionDigest`); store rows only under that owner; first snapshot becomes a `QueryState` arm; intersect `pendingWrites` from canonical optimistic/outbox/settlement by intent id (S8). One-shot `read` skips subscription and retention claims.

Steps 2, 6, 7, and 9 are UNDERDETERMINED in the sense of concerns 1–2, not named open questions.

## Direction assessment

**Retained.** Four concepts, profile-neutral cores, explicit policy, function escape, distinct doorway, obligatory settlement, staged Chat/Swift/evaluation, and mechanical withdrawal are the correct Phase 0 shape. The document is not a third authoring profile and does not reopen the 0254-r1 `ownerId: "authUserId"` hole. I do not dissent from the direction. I dissent from treating this revision as a closed implementation contract.

## Self-attestation

I complied with the confinement and blindness rules. I read and searched only paths inside this capsule directory tree. I did not use the network or web search. I listed `llp/reviews/`; no `0255*` review file exists, and I did not read any. I read `llp/reviews/0254-tiny-ordinary-data-surface.grok.md` only as allowed landed corpus for another document. I verified the target SHA-256 and byte count in-capsule; they match the recorded identity.

Deviations: none of workspace path. Context the harness injected that I did not request: `user_info` (OS, workspace path, date 2026-08-13); always-applied workspace rules excerpting `Agents.md`; a user rule about browser verification; the session skill list and an MCP Linear auth-failure reminder; and generic communication/tool-use instructions. I did not treat any of that injected text as evidence about LLP 0255. I did not reconstruct or infer other r1 reviewers’ views.

VERDICT: NOT READY


## Round 2 — 2026-08-13 (delta round)

- **Runtime:** same as round 1 (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-2 capsule
  (launch 2).
- **Revision reviewed:** r2, SHA-256
  `3c532efdc4ac7edafcd4f71153e34ad36dc093dd8bcdd155e3b633ebf7dcfdf2`
  (77,400 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `108098949a3764c4ec243124ca81b3d4a2b372d7d37f3f1a1a2bdfbe5e4402bf`;
  instruction SHA-256
  `128c3cc314a3f414c25d73ade5e54462fd99fb65cc00546dfa5081e7779d7e5f`.
- **Transport note:** as in round 1, the plain-format stream prefixes
  interstitial narration; the body below is byte-verbatim from the
  artifact heading onward.
- **Verdict:** NOT READY (3 MATERIAL, 2 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained). Self-attested
  capsule-only; no deviations reported.

---

# LLP 0255 r2 review — tiny data surface v1 API/artifact Spec

- **Reviewer:** Grok 4.6 (xAI), capsule-local independent family review
- **Date:** 2026-08-13
- **Target:** `llp/0255-tiny-data-surface-v1-api.spec.md` (Type: Spec, Status: Review)
- **Revision:** r2; SHA-256 `3c532efdc4ac7edafcd4f71153e34ad36dc093dd8bcdd155e3b633ebf7dcfdf2` (verified); `77400` bytes (verified)
- **Notable files:** `llp/0254-tiny-ordinary-data-surface.rfc.md`; `packages/snapback-codegen/{define.mjs,standard-patterns.mjs,index.mjs}`; `packages/snapback-client/{index.mjs,materialization-bridge.mjs,generated-mutation-ir.mjs}`; `src/{manifest.rs,value_expr.rs,local.rs,storage.rs}`; `llp/{0043,0065,0080,0155,0157,0238}*`
- **0255 reviews:** none present under `llp/reviews/0255*`
- **Delta audit:** every enumerated r1→r2 item is present in this text. No earlier 0255 revision exists in the capsule, so completeness of the orchestrator’s delta list cannot be independently audited; no additional r2-shaped topic was found that the list omits.

## Overall assessment

r2 does the right architectural work: witnesses are pre-resolution and app-neutral, `retained` is pinned false, the wire is an ordinary generated-function carrier, multi-chunk writes are one mutation with one `clientMutationId`, and dispatch is ledger-gated. Those moves match LLP 0254 D1/D4/D5 and the shipped identity/replay owners.

The closures that make those moves contract-bearing are not implementable on the shipped plan and result machinery as written. The new `data-resource.v1` read profile (`DataPageV1` + optional `after`) is not a legal Query/LiveQuery result contract and is not served by single-table HostPlan pagination; S3.4 simultaneously declines a LLP 0004 amendment. The S7.1b “closed result tuple” of up to 16 chunk results cannot be constructed by HostPlan `ReturnValue`/`ValueExpr`, and `v.tuple` is capped at 8. The r2 wire rule never names the slot→argument mapping that QMK and route binding require.

This is still the correct Spec direction. It is not ready to bind implementers.

## Concerns

### 1. [MATERIAL] [IN-DELTA] `data-resource.v1` + optional `after` is not expressible as an ordinary generated Query

S2 names list/get as this Spec’s own read profile: `DataPageV1` with `_id` totalizer and optional `after`, “not the shipped `owned-crud.v1` `documents` contracts” (`llp/0255-tiny-data-surface-v1-api.spec.md:246-256`, `:271-275`). S4.3/S5.1 then put `after` on the resolved member as a final optional named argument and keep it out of the hashed core (`:651-684`, `:847-856`). S5.3 closes `DataCursorV1` as `dc1.` + base64url(JCS({… `lastKey: [orderValue, id]`})) and pins `complete === true ⇔ cursor === null` (`:913-928`). S6.1 claims contract equality is satisfiable because candidates are “the data lowerer’s own” operations (`:1010-1019`). S3.1 says that lowerer still makes “the canonical `defineOwnedCrud` call” (`:306-312`). S3.4 proposes **no** LLP 0004/0108/0157 amendment (`:432-442`).

Shipped facts contradict that cluster:

- Query/LiveQuery result contracts may be only `Documents`, `Records`, or `LegacyQueryRowsV0`. `Value` is illegal on queries (`src/manifest.rs:3708-3721`, `SNAPBACK_RESULT_CONTRACT_KIND_MISMATCH`). `DataPageV1` is a page object, not a documents/records array.
- Ordinary HostPlan `QueryPlan` returns `QueryOutput { version, rows, cursor? }`, and `cursor` is “Absent for every non-relational query” (`src/manifest.rs:10554-10564`). `invoke_query` returns `QueryOutput` (`src/local.rs:7522`).
- Pagination that does mint a cursor is a different family: LLP 0065 `defineOwnedKeysetPages` is a **first/next pair**, unique index `[owner, cursorField]`, MAC’d token (`llp/0065-generated-data-pattern-soundness.rfc.md:260-273`; `packages/snapback-codegen/standard-patterns.mjs:410-485`; `guide/backend/standard-patterns.md:141-149`). Runtime keyset minting is gated on `owned-keyset-pages.v1` | `membership-keyset-pages.v1` (`src/local.rs:30193-30198`). LLP 0080’s single-query optional `cursor` is `RelationalQuery`, not `QueryPlan`. LLP 0065 OQ1 — compound `(cursor, _id)` continuation for non-unique sort keys — is still open (`llp/0065-generated-data-pattern-soundness.rfc.md:415-418`). That *is* S5.3’s `lastKey`, specified here without owning it.
- `defineOwnedCrud` list is `defineLiveQuery` with `args: {}`, no `after`, inferred documents, `standardPattern: owned-crud.v1` (`packages/snapback-codegen/standard-patterns.mjs:316-326`). S2’s own bullet still says “`<table>.list`: no public arguments” (`llp/0255-tiny-data-surface-v1-api.spec.md:260-263`). That member cannot share argument/result hashes with a template whose contract is `DataPageV1` plus optional `after`. S6.1’s “satisfiable” claim and S3.1’s `defineOwnedCrud` call cannot both stand.

0254 D4 requires function-slot resolution onto an existing generated operation when plan **and contract** match (`llp/0254-tiny-ordinary-data-surface.rfc.md:428-440`). 0254’s non-goals forbid rewriting the Rust query runtime to invent a third pagination profile. r2 specified that profile and then declined the amendment that would authorize it.

**Resolution:** Pick one and write it as a closed disposition:

1. **Facade over shipped QueryOutput.** List/get keep `documents`/`records` contracts; `DataPageV1` is only the tiny projection (`complete := cursor == null`). Then either (a) reuse `owned-keyset-pages.v1` (first/next, unique `[owner, cursorField]`, MAC’d cursor — and drop `dc1.` / single-member `after` / `_id` totalizer as the v1 wire), or (b) file a dated LLP 0004 + LLP 0065 OQ1 amendment that extends single-table Query to optional `after` and `(order, _id)` keyset minting, and retract S3.4’s blanket no-0004 claim.
2. **New result kind** `FunctionResultContract::DataPage` (or equivalent) plus the same 0004/0065 amendment. Do not leave `DataPageV1` as a Query `results.value(...)`.
3. Stop saying S3.1 calls `defineOwnedCrud` if reads are a new helper. Mutations may still share that plan builder; list/get may not.

Until one of those is explicit, Phase 1 cannot emit a catalog member that both matches S6.1 and runs on the shipped query executor.

### 2. [MATERIAL] [IN-DELTA] S7.1b writes are one HostPlan; the specified 16-chunk result tuple is not

The write half is expressible. `defineMutation` already accepts `plan: MutationStep | MutationStep[]` (`packages/snapback-codegen/define.d.ts:448-450`; `define.mjs:4252-4276`). Owned update/delete are already multi-step (`get` + `guard` + `patch`/`delete`; `packages/snapback-codegen/standard-patterns.mjs:178-186`, `:342-360`). `MAX_PLAN_STEPS = 64` (`src/value_expr.rs:43`); 16 owned updates are 48 steps, or 64 if a post-write `Get` is added per chunk to bind return documents. Those steps execute inside one storage transaction (`src/storage.rs:3688-3720`). `S7.1b`’s “one HostPlan … one authoritative transaction … ordinary `mutate` carrier … one `clientMutationId`” (`llp/0255-tiny-data-surface-v1-api.spec.md:1105-1120`) is therefore feasible for the **writes**, including a three-chunk and a sixteen-chunk sequence that stays under the step and `maxDeclaredWriteRows: 16` ceilings.

The **result** half is not. S7.1b requires “the closed tuple of per-chunk results” and `maxChunks: 16` (`:1113-1126`). Shipped HostPlan cannot produce that value:

- `ValueExpr` has `Record` and no array constructor (`src/manifest.rs:9643-9645`). Pinned functions are `len/trim/lower/abs/min/max/round/floor/ceil/coalesce` (`src/value_expr.rs:50-52`). There is no way to return a JSON array of per-chunk documents/`null`.
- `v.tuple` is 1–8 elements (`packages/snapback-codegen/define.mjs:563-564`). Even if an array return existed, 9–16 chunks are untypable.
- Mutation results may be only `results.document(...)` or `results.value(...)` (`define.mjs:4260-4266`). A raw tuple is not a result kind.
- S7.1b says a composition that cannot lower to one HostPlan refuses `SNAPBACK_DATA_TRANSACTION_INVALID` before custody (`llp/0255-tiny-data-surface-v1-api.spec.md:1117-1118`). Read strictly, every 2–16-chunk transaction refuses, because the specified result cannot lower.

**Resolution:** Pin the batch result to machinery that exists: `returns: returnExpr(record({ c0: …, c1: … }))` and `result: results.value(v.object({ … }))`, with TypeScript `ResultTuple` as a view over those keys. State 0-based `position` in `c<position>_<argName>`. Do not say “tuple” unless `ValueExpr` gains an array node (a dated LLP 0004/0051 amendment). Keep `maxChunks: 16` only after that record lowering is named; the write plan does not need a new HostPlan family.

### 3. [MATERIAL] [IN-DELTA] The route-to-catalog wire rule does not name the bytes that leave the client

S5.1: the client invokes the resolved member “with one canonical argument object (slot values under generated parameter names, plus `after` when present). No witness travels on the wire” (`:847-856`). S4.3 assigns **dense numeric slots** (range = two slots, `in` = one array slot; cursor is never a slot) and stores `arguments: readonly unknown[]` on the envelope (`:667-684`, `:641`). LLP 0157 QMK hashes the named canonical argument object (`packages/snapback-client/materialization-bridge.mjs:167-182`). Shipped invocation is `POST /query/{exportedName}` or `POST /live/{exportedName}/subscribe` or `POST /mutation/{exportedName}` with that object (`packages/snapback-client/index.mjs:6296-6316`, `:9741-9777`, `:9459-9462`).

The Spec never names the function from slot index → argument key. A range on `createdAt` needs two names for one field. A field literally named `after` collides with the reserved cursor argument. Omitted `after` versus `after: null` are different QMK preimages; only “when present” is said. Combined with concern 1’s “list has no public arguments,” an implementer cannot know whether the default owner list shares `todos.list` + `{}` or always synthesizes `todos.query_<hex>` with `{after?: …}`.

That is not an implementation detail. Two lawful lowerings produce different `argsContractHash`, different QMK, and different S6.1 matches — the identity decision r2 exists to close.

**Resolution:** Publish a closed naming table, for example: one slot → the field name; range → `<field>__lo`, `<field>__hi`; `in` → the field name (array); cursor argument name `after`, and a filter field named `after` refuses `SNAPBACK_DATA_QUERY_SHAPE_INVALID`. State that absent cursor omits the key (does not send null). State whether `<table>.list`’s args contract is exactly `{}` or exactly `{ after?: DataCursorV1 }`. Then S6.1 can be checked, not hoped.

### 4. [DETAIL] [IN-DELTA] S3.2’s refusal-ledger pin silently inverts LLP 0043

The three pins (`intentId` ≡ `clientMutationId`; ledger-gated dispatch; refused entries in the settlement ledger) (`llp/0255-tiny-data-surface-v1-api.spec.md:362-381`) are the right shape for D5’s ambiguous-outcome cell. Local SQLite already advertises `offline_mutation_replay`; Cloudflare does not (`llp/0043-offline-replay-retention.rfc.md:315-335`). Refusing ledgerless targets with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` is coherent.

But LLP 0043 currently says a typed server refusal “is never ACKed as the current id: **no server settlement exists to collect**” (`llp/0043-offline-replay-retention.rfc.md:374-375`). S3.2 adds terminal refused ledger rows, retained under existing caps, **acknowledged through the existing ACK flow**. That is a replacement of 0043:374-375, not an addendum. Without replacement text, Phase 1 will implement both rules.

**Disposition:** In the 0043 amendment block, quote and supersede 0043:374-375 for possibly-crossed data intents; say refused rows consume the same ledger/ACK caps as committed rows; keep pre-boundary admission refusals off the ledger (already implied). Name `offline_mutation_replay` as the dispatch predicate so “ledger-bearing target” is not a new vocabulary.

### 5. [DETAIL] [IN-DELTA] Transaction catalogue admission is not closed

Queries have `SNAPBACK_DATA_QUERY_NOT_CATALOGUED` (`llp/0255-tiny-data-surface-v1-api.spec.md:1387`). S7.1b catalogues “the static chunk-shape sequence of each `db.transact` call site” (`:1096-1098`) but S12 has no `SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED`. `chunk.position` is an unbased `number` (`:693`) while argument names are `c<position>_<argName>` (`:1113`). `AuthorityCaptureV1` is pinned as “LLP 0043’s existing enqueue authority-capture record” (`:760-761`); the type lives in LLP 0059 (`llp/0059-session-projection-and-client-barrier.spec.md:1677-1681`). S2’s no-drop rule points at S4.2/S4.4 (`llp/0255-tiny-data-surface-v1-api.spec.md:281-287`) but those are types, not a field table against `authoredFunctionManifestFields` (`packages/snapback-codegen/index.mjs:9057-9083`: `retainable`, `authScopeField`, `authorityCreating`, `authorizationDependence`, …). S5.4 still describes a LLP 0243 retention admission path (`llp/0255-tiny-data-surface-v1-api.spec.md:968-969`) after S4.2 pins `retained: false` unconditionally (`:586-591`). S3.5 is numbered before S3.4.

**Disposition:** Add the missing refusal code; say `position` is 0-based; cite 0059 for the capture record and 0043 for enqueue timing; add a real function-record disposition table (or point no-drop at S11 + the generated reference fields); delete the S5.4 retention-admission sentence or mark it out of v1; renumber S3.4/S3.5.

## Implementer-probe result

### (a) One `db.useQuery` admission path, including the wire

From the document, plus shipped carriers the Spec says it reuses:

1. **Authoring.** A typestate chain `resource.using(index)[.where] .orderBy .[select] .take [ .after ]` with shape operands as compile-time literals (`:808-845`).
2. **Generation.** The reachable template is extracted into `dataQueryCatalog`. Filters are rewritten into `DataFilterTemplateV1` in index-field order; scalars become `eq`; slots are dense; owner equality is a policy node, not a template entry; cursor is not a slot (`:665-684`). The pre-resolution core is JCS-hashed to `normalizedDataQueryId` (`:456-458`, `:651-655`).
3. **Resolution.** Candidates are this generation’s data-lowerer `Query|LiveQuery` for that resource (`:1010-1027`). One match copies that `FunctionReference` (and, for `LiveQuery`, the full QMK preimage). Zero matches emit `<resource>.query_<first 16 hex of the witness>` with id `{appId}:{exportedName}` (`:1033-1041`; `OPERATION_NAME` allows that spelling, `packages/snapback-codegen/index.mjs:206`). Many matches refuse `SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS`.
4. **Runtime handle.** `db.useQuery(descriptor)` is React-only, refuses without `sync.enabled`, and returns full `QueryState` plus `pendingWrites` (`:955-967`, `:1237-1256`). `"skip"` is the shipped skipped arm.
5. **Bytes on the wire.** No witness. Ordinary live subscribe: `POST /live/{exportedName}/subscribe` with `{ connection_id, input: { args, auth, read_set }, expectedGeneration }` (`packages/snapback-client/index.mjs:9741-9777`). One-shot `db.read` is `POST /query/{exportedName}` with `{ args, auth, read_set, expectedGeneration? }` (`:6296-6316`). `args` is one canonical object: slot values under generated names, plus `after` when the builder supplied a cursor (`llp/0255-tiny-data-surface-v1-api.spec.md:847-856`).
6. **Server binding.** Exported name → active generation’s catalogued member; plan, policy, contracts, bounds were frozen at generation; a missing name refuses (`:851-856`). The server recomputes plan/policy/bounds; it does not trust client-built descriptors. QMK is LLP 0157 over function identity, plan, canonical args (including `after` when present), and authority partition (`:660-663`; `packages/snapback-client/materialization-bridge.mjs:167-182`). Distinct pages therefore do not share materializations.

**Underdetermination (defective, not deferred):** slot→name mapping and list’s args contract (concern 3); whether the function result is `DataPageV1` or `QueryOutput.rows` (concern 1); how `after` is applied by a single-table `QueryPlan` that does not mint cursors (concern 1). An implementer cannot finish this path from the document alone.

### (b) Three-chunk `db.transact` identity and replay

Take `db.transact(db.tx.todos.create({title, completed}), db.tx.todos.update({id, title, completed}), db.tx.todos.delete({id}))` on distinct rows (same-row create→update and create-id references refuse; `:1087-1092`).

1. **Catalogue.** The static sequence `(create, update, delete)` is a transaction template. Core (app-neutral chunk `exportedName`s, no `intentId`/values/resolution) hashes to `normalizedDataTransactionId` (`:750-756`, `:1096-1098`).
2. **Member.** `resolution.kind: "synthesized-batch"`; exported name `data.tx_<first 16 hex of that witness>`; stable id `{appId}:data.tx_<hex>`; `data.` is reserved (`:1105-1110`). One ordinary `Mutation`.
3. **Args.** One object, keys `c<position>_<argName>` (`:1112-1113`). The document does not say whether those positions are `c0_*` or `c1_*`. Values are the three chunks’ generated contracts (`title`/`completed`, `id`+mutables, `id`).
4. **Plan / result.** Sequenced chunk plans in **one** HostPlan / one authoritative transaction (`:1110-1112`). Writes lower (concern 2). Result is specified as a closed per-chunk tuple `(row, row, null)` (`:271-275`, `:1113`). That value cannot be produced by HostPlan returns (concern 2).
5. **Wire / identity.** Ordinary `mutate`: `POST /mutation/{exportedName}` with `{ args, clientMutationId, … }` (`packages/snapback-client/index.mjs:9459-9462`). `intentId` is that `clientMutationId` byte-for-byte (`llp/0255-tiny-data-surface-v1-api.spec.md:362-368`). One id for the batch.
6. **Custody.** Queue-eligible iff every chunk is and the target advertises the settlement ledger; otherwise online-only or `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` before transport (`:1158-1165`, `:369-374`). Callers cannot pass `queue`. Prediction is all-or-nothing from generated IR (`:1147-1156`; `packages/snapback-client/generated-mutation-ir.mjs:34-48`). Create provisional ids follow LLP 0155 / the shipped `idMap` rebase (`llp/0255-tiny-data-surface-v1-api.spec.md:757-760`; `llp/0155-local-sync-product-direction.rfc.md:971-979`).
7. **Replay.** LLP 0043 treats this as **one** outbox record: original `clientMutationId`, original generation, the synthesized function id, the flattened args, the 0059 capture, prediction claims, `sequence`. Reconnect resyncs then replays that descriptor; the server settles by `(clientMutationId, function, input, auth fingerprint, authority instance)` (`llp/0043-offline-replay-retention.rfc.md:284-291`, `:414-418`). There is no per-chunk replay and no batch endpoint.

**Underdetermination (defective):** result lowering and `position` radix (concerns 2 and 5); uncatalogued call-site code (concern 5). The replay story is otherwise closed and matches 0043.

## Direction assessment

No `DIRECTION-DISSENT`. r2 should keep: acyclic pre-resolution witnesses; app-neutral cores; ordinary function/QMK identity; `retained: false`; ledger-gated dispatch; `intentId = clientMutationId`; notify-only 0238 D3 handles; one synthesized mutation rather than a batch protocol; familiar promotion refused for predicted writes. Those are the right 0254 bindings.

What must change is altitude: where r2 “closed” a type that the shipped HostPlan/result/cursor families cannot carry, name the existing family or file the dated owner amendment. Do not specify `DataPageV1`/`dc1`/`after` as if they were already QueryPlan law, and do not specify a 16-wide result tuple the IR cannot return.

Self-attestation: I read only files under this capsule; verified the recorded SHA-256 and byte count; found no `llp/reviews/0255*` artifacts; used no network; did not author this Spec; I did not read `REVIEW-CANDIDATE-r*.md` or `final-cli.log`. No deviations.

VERDICT: NOT READY


## Round 3 — 2026-08-13 (delta round)

- **Runtime:** same as rounds 1–2 (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-3 capsule
  (launch 3).
- **Revision reviewed:** r3, SHA-256
  `2d5476688b623745f53182cbb1b3831822777a7244144d3935085d6a00d14be4`
  (85,877 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `ffc057c71d318f19ca155905bdbb4aa5902518be0771f58eb75b7760f6502065`;
  instruction SHA-256
  `2a3226c2f5324ebffcbb51a959eadec1bcf8503487a65719942ab33aca5e5637`.
- **Transport note:** plain-format narration precedes the artifact
  heading; the body below is byte-verbatim from the heading onward.
- **Verdict:** NOT READY (1 MATERIAL, 3 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained; both probes determinate
  under the sole feasible reading of its MATERIAL, produced to exact
  wire bytes and a 9-step plan table). Self-attested capsule-only; no
  deviations reported.

---

# LLP 0255 r3 review — Grok 4.6 (xAI)

- **Reviewer / runtime:** Grok 4.6, xAI
- **Date:** 2026-08-13
- **Target:** `llp/0255-tiny-data-surface-v1-api.spec.md`
- **Revision:** r3, Status Review
- **SHA-256 (verified):** `2d5476688b623745f53182cbb1b3831822777a7244144d3935085d6a00d14be4`
- **Size (verified):** 85,877 bytes
- **Notable files read:** the target; `llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0004-application-data-api.rfc.md`; `llp/0043-offline-replay-retention.rfc.md`; `llp/0059-session-projection-and-client-barrier.spec.md`; `llp/0065-generated-data-pattern-soundness.rfc.md`; `src/manifest.rs`; `src/value_expr.rs`; `packages/snapback-codegen/{standard-patterns.mjs,define.mjs,result-contracts.mjs}`; `packages/snapback-client/{materialization-store.mjs,outbox-shared.mjs}`
- **`llp/reviews/0255*`:** none present
- **Delta-list check:** every enumerated r2→r3 item is present in the text. No r2 source exists in this capsule; `REVIEW-CANDIDATE-r*.md` was not treated as a prior revision. Exclusivity of the delta (that nothing else changed) cannot be independently verified here.

## Overall assessment

r3 does the work a final delta round is for. Reads are rehomed onto the shipped `documents` / `QueryOutput` path with a dated, scoped S3.4 keyset amendment; `DataPageV1` is introduced as a facade; batch results are a closed `Record` over post-write `Get` bindings rather than a fictional `ValueExpr` array; slot naming, the LLP 0043 settlement tuple, durable authority records, dispatch-time `targetCustody`, and the plan ceilings are now pinned to shipped names. S3.4 stays inside LLP 0254: D4 already requires stable cursor pagination, the non-goal at `llp/0254-tiny-ordinary-data-surface.rfc.md:222-223` forbids a runtime rewrite rather than a named query-plan amendment, and Phase 2 is gated on ratification. The record-return construction is sound against `ReturnValue::Expr` + `ValueExpr::Record` + `MutationStep::Get`/`Guard`. The naming grammar is total and collision-closed. Identity fields (`planHash`, `DurableReplayAuthorityV1`, `targetCustody`, the settlement tuple) match LLP 0043 and stay app-neutral.

One r3 contract-layer fork remains. The document uses “result contract” for both the shipped `documents` kind (what `resultContractHash` / `planHash` hash) and the client `DataPageV1` object. That is not wording noise: two implementers will emit different hashes, different TypeScript, and one of those choices fails egress against the executor’s `QueryOutput`. Until that layer is named once, this is not a freeze-ready Spec.

## Concerns

### 1. MATERIAL / IN-DELTA — `DataPageV1` is simultaneously a client facade and the hashed result contract

**Evidence.** Three normative sentences cannot be true together:

- S2 keeps “the shipped canonical **`documents` result contracts**” and defines `DataPageV1` as “the client facade over the executor’s `QueryOutput` envelope (`rows` = the documents result; `cursor` = the S3.4 keyset continuation re-encoded as `DataCursorV1`; `complete := cursor === null`)” (`llp/0255-tiny-data-surface-v1-api.spec.md:246-254`).
- The same section’s closed-contract table then says `list → DataPageV1<Row>` (`llp/0255-tiny-data-surface-v1-api.spec.md:277-278`).
- S3.4: “adds no new result kind: read results remain canonical `documents`” (`llp/0255-tiny-data-surface-v1-api.spec.md:472-473`).
- S6.1 makes the fork operational: candidates are data-lowered reads “whose read contracts are the `DataPageV1` profile of S2, so **contract equality is satisfiable**” (`llp/0255-tiny-data-surface-v1-api.spec.md:1105-1110`). S4.3 folds “result contract” into `planHash` (`llp/0255-tiny-data-surface-v1-api.spec.md:726-728`), so the choice changes exact-match identity.

Shipped ground truth the text is trying to sit on:

- `QueryOutput` is `{ version, rows, cursor? }` with `cursor: Option<String>` and `skip_serializing_if = "Option::is_none"` — absent on terminal and non-relational pages, not JSON `null` (`src/manifest.rs:10554-10565`). Its existing comment binds the field to LLP 0080 `root-window-v1` and to presenting the token back as the argument named `cursor`.
- The `documents` TypeScript rendering is `ReadonlyArray<Row>`, not a page object (`packages/snapback-codegen/result-contracts.mjs:918`). Clients already take the documents payload from `output.rows`.
- `defineLiveQuery` via `queryDef` does not author a result contract; codegen infers `documents` from the table plan (`packages/snapback-codegen/define.mjs:2664-2697`, `packages/snapback-codegen/standard-patterns.mjs:315-326`).
- Get is listed as `Row | null` (`llp/0255-tiny-data-surface-v1-api.spec.md:278`) while a documents-shaped get is a 0–1 `rows` array. Same facade/contract split, second arm.

S3.4’s “exhaustion yields `cursor: null`” (`llp/0255-tiny-data-surface-v1-api.spec.md:466`) describes `DataPageV1`, not `QueryOutput`. Writing that sentence into LLP 0004 as an executor rule would fork the wire (explicit null vs omit) and still would not produce a `DataPageV1` object — `QueryOutput.version` has no home in `DataPageV1`.

A literal reading of “list → `DataPageV1`” as `FunctionResultContract` is also infeasible: the query executor returns `QueryOutput`. Validating that envelope, or `output.rows`, against a value-object `{rows, cursor, complete}` fails without an unspecified adapter. Relational pages already use a different reserved argument, `cursor` (`packages/snapback-codegen/define.mjs:3265-3269`); S3.4’s `after` is the right data-profile name, but it does not change the result-kind question.

**Why it matters.** This is the r3 rehome. `resultContractHash` / `planHash` / generated reference types / egress validation all hang on one kind. “Profile of S2” is not a kind.

**Resolution.** Pin three layers in one paragraph and use those nouns everywhere `DataPageV1` appears (S2 table, S5.3, S5.4, S6.1):

1. **Function result contract** (hashed): list/descriptor reads stay `{kind:"documents", table}`; get stays `{kind:"document", table}` (or documents with a stated 0–1 client projection to `Row | null`).
2. **Executor / wire:** `QueryOutput`. Exhaustion leaves `cursor` **absent** (`None`); a continuation page sets `cursor` to the `DataCursorV1` string. `version` remains a sync-engine field and never enters `DataPageV1`.
3. **Client facade only:** `DataPageV1 = { rows: output.rows, cursor: output.cursor ?? null, complete: output.cursor == null }`.

S6.1 then says: data-lowered reads share the **documents** `resultContractHash`, so list and an equivalent descriptor match. Do not put `DataPageV1` in any hash preimage. S3.4’s 0004 sentence should say “absent/`None`”, not “`null`”.

### 2. DETAIL / IN-DELTA — S2 no-drop table is not the shipped `FunctionDefinition` schema

**Evidence.** r3’s fail-closed table (`llp/0255-tiny-data-surface-v1-api.spec.md:294-315`) plus “the generation assertion iterates the actual shipped record schema; any field absent from this table fails generation” (`llp/0255-tiny-data-surface-v1-api.spec.md:313-315`) is the right rule. The table does not name these top-level `FunctionDefinition` fields (`src/manifest.rs:7790-8018`): `kind`, `apiExposure`, `publicInline`, `authorityProfileDependence`, `syncabilityClass`, `permissionEpochBumps`, `bundleEntrypoint`, `uses`, `runtime`. `authScopeField` is listed, but on the wire it lives under `readSetSummary` (`src/manifest.rs:7986-7988`, `src/manifest.rs:4086`). The table also lists custody/prediction/generation, which are data-projection/envelope facts, not `FunctionDefinition` fields.

**Disposition.** Keep the iterate-and-fail assertion. Add an explicit row for every `FunctionDefinition` field before Phase 1, with the obvious data-surface values: `kind` derived; `apiExposure` default-closed; `publicInline` false/forbidden; `authorityProfileDependence` empty (membership ineligible); `syncabilityClass` derived from kind + S1.3; `permissionEpochBumps` derived from visibility; `bundleEntrypoint` generated; `uses` empty; `runtime` HostPlan. State that custody/prediction/generation are projection/envelope dispositions, not function-record fields. The current table will fail closed until those rows exist — conservative, not silent-drop.

### 3. DETAIL / IN-DELTA — S2’s “every data read” argument contract contradicts S6.2

**Evidence.** S2: “every data read’s argument contract is exactly the shared reserved optional `after` (`{after?: DataCursorV1}` for list; `{id: Id<table>}` for get, which has no `after`)” (`llp/0255-tiny-data-surface-v1-api.spec.md:250-253`). That is true of generated `<table>.list` / `<table>.get`. S6.2 synthesized members carry slot keys (`eq`/`in` → field name; ranges → `<field>_gt|_gte|_lt|_lte`) plus reserved `after` (`llp/0255-tiny-data-surface-v1-api.spec.md:1143-1153`). Those are also data reads.

**Disposition.** Scope the S2 sentence to **resource-lowered** `list`/`get`. Point at S6.2 for catalogued descriptors. The list bullet at `llp/0255-tiny-data-surface-v1-api.spec.md:265-267` is already correct.

### 4. DETAIL / IN-DELTA — transaction `canonicalArguments` is an array; the wire and settlement digest are a named object

**Evidence.** S7.1b’s wire/canonical input is the object `{ c<position>_<argName>: … }` (`llp/0255-tiny-data-surface-v1-api.spec.md:1220-1221`). `DataTransactionV1` stores `canonicalArguments: readonly unknown[]` plus `canonicalArgsDigest` (`llp/0255-tiny-data-surface-v1-api.spec.md:805-806`). LLP 0043’s duplicate key is `(clientMutationId, function, input, auth fingerprint, authority instance)` (`llp/0043-offline-replay-retention.rfc.md:417-418`). The array’s element order — and therefore the digest preimage — is not pinned the way S4.3/S6.2 pin query slots (filters-array order, then grammar → wire object).

**Disposition.** State that `canonicalArgsDigest` is the domain-separated SHA-256 of RFC 8785/JCS of the **named** argument object (the mutate wire carrier), and that `canonicalArguments[]` is either removed or defined as chunk-major values in each chunk’s args-contract declaration order. Do not leave array-vs-object as two legal preimages.

## Implementer-probe result

Both probes are determinate from the document once concern 1 is read as “documents hashed, `DataPageV1` facade-only” (the only reading that is also feasible). Concern 1 does not change argument bytes or the batch identity/custody story.

### (a) Appendix A1 Todo query — page 1 and page 2 argument objects

Schema: `todos` with owner visibility, one owner-leading index `by_owner_created` on `["ownerId","createdAt"]`, `.data({ createDefaults:{ createdAt:"now" }, immutable:["createdAt"] })` (`llp/0255-tiny-data-surface-v1-api.spec.md:1584-1589`). Descriptor:

```ts
db.todos.using("by_owner_created").orderBy("createdAt", "asc").take(100)
```

No `where`, no `select`, no `.after` on construction. Sync is the application default (enabled). Owner equality is a policy plan node, not a template slot (`llp/0255-tiny-data-surface-v1-api.spec.md:744-746`, `974-976`).

**Member.** S6.1 exact match against data-lowered `Query`/`LiveQuery` for `todos`. Generated `<table>.list` is `todos.list`: LiveQuery, index `by_owner_created`, order `createdAt` asc (index fields after owner, `asc`, `listLimit` default 100 — `packages/snapback-codegen/standard-patterns.mjs:214`, `315-326`), no caller slots, reserved optional `after`, `DataPageV1` facade over documents. Parameter names equal the S6.2 grammar (only `after`). **`todos.list`** (stable id `{appId}:todos.list`). Not a synthesized `todos.query_<16hex>`.

**Page 1 wire argument object** (cursor omitted, never `null` — `llp/0255-tiny-data-surface-v1-api.spec.md:1146-1148`):

```json
{}
```

**Page 2 wire argument object.** Client echoes page 1’s facade `cursor` verbatim as `after`. No slot keys. `take`, index, owner, and projection are plan facts, not arguments.

```json
{ "after": "dc1.<page1-cursor-suffix>" }
```

The suffix is server-minted, not client-reconstructed (`llp/0255-tiny-data-surface-v1-api.spec.md:1003-1008`, `1012-1014`):

```text
base64url(JCS({
  v: 1,
  app: <app id>,
  generationId: <active generation id>,
  planHash: <todos.list plan hash>,
  argsDigest: <digest of canonical non-cursor args = empty slot list / {}>,
  authorityPartitionDigest: <owner partition>,
  lastKey: [<createdAt of last page-1 row>, <_id of last page-1 row>]
}))
```

`argsDigest` is stable across pages (non-cursor only). QMK includes `after` when present, so page 1 and page 2 are distinct materializations (`llp/0255-tiny-data-surface-v1-api.spec.md:728-730`). A malformed/cross-boundary/stale-bound cursor refuses `SNAPBACK_DATA_CURSOR_INVALID`. There is no page 2 when page 1 is complete (`cursor === null`).

Carrier: ordinary generated-function / live-subscribe invocation of `todos.list` with that one argument object (`llp/0255-tiny-data-surface-v1-api.spec.md:933-936`). No witness on the wire.

### (b) Three-chunk `db.transact` — identity, custody, replay, result, ceilings

A legal three-chunk call (create-id references and duplicate write targets escape — `llp/0255-tiny-data-surface-v1-api.spec.md:1194-1196`). Update id ≠ delete id; neither is the create’s new id:

```ts
db.transact(
  db.tx.todos.create({ title, completed: false }),
  db.tx.todos.update({ id: idU, title, completed }),
  db.tx.todos.delete({ id: idD }),
)
```

`createdAt` is defaulted off the create args; owner is stamped, not an argument (`llp/0255-tiny-data-surface-v1-api.spec.md:156-157`, `1603`).

**Resolution.** `kind: "synthesized-batch"` (2–16 chunks). Codegen emits one ordinary `Mutation`:

- `exportedName`: `data.tx_<first 16 lowercase hex digits of normalizedDataTransactionId>`
- `functionId`: `{appId}:{exportedName}`
- `normalizedDataTransactionId`: `sha256("snapback:normalized-data-transaction:v1\n" || JCS(core))` (`llp/0255-tiny-data-surface-v1-api.spec.md:522-524`)
- Core hashes chunk `planHash`es, exported names, contracts, reach, prediction/custody — not `intentId`, values, authority instance, or generation (`llp/0255-tiny-data-surface-v1-api.spec.md:823-827`)
- `data.` is reserved: any authored export under `data.` refuses `SNAPBACK_DATA_OPERATION_NAME_COLLISION` (`llp/0255-tiny-data-surface-v1-api.spec.md:1213-1216`)
- Uncatalogued call-site shape: `SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED`

**Wire arguments** (positions dense, 0-based — `llp/0255-tiny-data-surface-v1-api.spec.md:845-847`, `1220-1221`):

```json
{
  "c0_title": "<title>",
  "c0_completed": false,
  "c1_id": "<idU>",
  "c1_title": "<title>",
  "c1_completed": "<bool>",
  "c2_id": "<idD>"
}
```

**Plan.** One HostPlan, one authoritative transaction. Bindings prefixed `__dataTx<position>_` (e.g. create id `__dataTx0_` + original bind; update/delete guards `__dataTx1_` / `__dataTx2_`). Per-chunk steps (`llp/0255-tiny-data-surface-v1-api.spec.md:1229-1232`), matching shipped `MutationStep::{Get,Guard,Insert,Patch,Delete}` (`src/manifest.rs:9492-9520`):

| chunk | steps | count |
| --- | ---: | ---: |
| create | insert + post-write Get | 2 |
| update | Get + Guard + patch + post-write Get | 4 |
| delete | Get + Guard + delete (result `null`, no Get) | 3 |
| **total** | | **9** |

Return is `ReturnValue::Expr(ValueExpr::Record { c0, c1, c2 })` over those bindings / `Literal(null)` — not a plan step; `ValueExpr` has `Record` and no array constructor (`src/manifest.rs:9566-9576`, `9643-9645`). Client facade projects the record to the positional `ResultTuple`.

**Function result (wire / contract), then client view:**

```ts
{ c0: <created todo document>, c1: <updated todo document>, c2: null }
// client ResultTuple: [created, updated, null]
```

**Ceilings.** Shipped: `MAX_PLAN_STEPS = 64`, `MAX_PLAN_SERIALIZED_BYTES = 65_536` (`src/value_expr.rs:43-46`). 9 ≤ 64. Serialized bytes checked at generation; overflow → `SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED`. `maxChunks: 16` is an upper bound; 16 update-heavy chunks are 64 steps and also 32 declared reads (`maxDeclaredReadRows: 32`) — this 3-chunk form is 3 ≤ 16 chunks, 1 ≤ 8 resources, 3 ≤ 16 write rows, 4 declared reads (create result + update guard + update result + delete guard) ≤ 32 (`llp/0255-tiny-data-surface-v1-api.spec.md:1247-1256`).

**Identity / settlement.** One `clientMutationId` = envelope `intentId` = S3.2’s stable intent id, byte-for-byte (`llp/0255-tiny-data-surface-v1-api.spec.md:390-396`). Ordinary mutate carrier; no batch endpoint (`llp/0255-tiny-data-surface-v1-api.spec.md:1235-1243`).

`settlementIdentity` (`llp/0255-tiny-data-surface-v1-api.spec.md:809-817`, `841-845`):

| field | value |
| --- | --- |
| `intentId` | client-minted `clientMutationId` |
| `functionId` | `{appId}:data.tx_<16hex>` |
| `canonicalArgsDigest` | digest of the named argument object above |
| `authorityFingerprint` | authenticated authority fingerprint |
| `authorityInstance` | authority instance |
| `generationId` | original generation (replay must not substitute the active one) |
| `normalizedDataTransactionId` | transaction witness; additional assertion, not a replacement for the 0043 tuple |

That is LLP 0043’s `(clientMutationId, function, input, auth fingerprint, authority instance)` plus generation and witness (`llp/0043-offline-replay-retention.rfc.md:417-418`).

`authority: DurableReplayAuthorityV1` = LLP 0043’s three durable records — `authorityDescriptor`, `principalScope`, `custody` — as the shipped outbox already stores them (`llp/0043-offline-replay-retention.rfc.md:662-676`; `packages/snapback-client/outbox-shared.mjs:214-215`). Not LLP 0059 `AuthorityCaptureV1` `{authorityEpoch, custodyRevision, authorityKey}` (`llp/0059-session-projection-and-client-barrier.spec.md:1677-1681`); `custodyRevision` stays out of durable bytes.

**Custody / replay.** All three chunks are owner mutations → intrinsic `custody.class: "queue-eligible"`, `reason: null`. Resource `offlineCustody: true` (`llp/0255-tiny-data-surface-v1-api.spec.md:656-662`, `1281-1284`). Prediction is `generated-exact` only if every chunk’s IR is local-executable; otherwise `none` for the whole batch — no partial paint (`llp/0255-tiny-data-surface-v1-api.spec.md:1276-1278`). Create provisional ids follow LLP 0155 in `predictionClaims`.

Target capability is dispatch-time, not a core fact (`llp/0255-tiny-data-surface-v1-api.spec.md:1285-1293`):

- replay-capable (`offline_mutation_replay`) + ledger-bearing → `targetCustody: "queue-served"`; LLP 0043 queue/replay as **one** mutation.
- ledger-bearing but not replay-capable → `targetCustody: "online-only-target-no-replay"`; still one `clientMutationId`; S3.2 ambiguity path; **not** a core custody reason.
- no settlement ledger → refuse before transport, `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` (ledgerless next action: change targets; online-only is not available there) (`llp/0255-tiny-data-surface-v1-api.spec.md:1524`, `397-402`).

Possibly-crossed typed refusal is ledgered and ACK-capable, superseding LLP 0043’s “never ACKed / no server settlement” sentence for this path only (`llp/0255-tiny-data-surface-v1-api.spec.md:403-414`; `llp/0043-offline-replay-retention.rfc.md:374-375`). Pre-boundary refusals stay off-ledger. `dispose` does not cancel custody (`llp/0255-tiny-data-surface-v1-api.spec.md:1314-1316`).

## Direction assessment

No direction dissent. Closed `.data`, documents-shaped reads, a dated single-table keyset amendment instead of a new result kind, a `Record` batch return, a closed slot grammar, the full 0043 settlement/authority story, and dispatch-time target custody are the right compression of LLP 0254. S3.4 correctly scopes OQ1 to `data-resource.v1` / `data-query.v1`, leaves `owned-keyset-pages.v1` and its `cursor` argument / MAC token alone, and does not hand a cursor to other query families. The remaining work is to say `documents` / `QueryOutput` / `DataPageV1` once each and mean it.

Self-attestation: I worked only from this directory tree. I did not use network or web search. I did not read any `llp/reviews/0255*` file (none exist). I did not treat `REVIEW-CANDIDATE-r*.md` or `final-cli.log` as r2 of this Spec. I verified the recorded SHA-256 and byte count with `shasum` / `wc`. I did not author the document under review.

VERDICT: NOT READY


## Round 4 — 2026-08-13 (verification delta round)

- **Runtime:** same as prior rounds (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-4 capsule
  (launch 4).
- **Revision reviewed:** r4, SHA-256
  `66bc954966e29f57efc4914538100a65581dafd18b7673e423f1ffda2794a7a8`
  (90,194 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `6dd25b345c207d7960950735b198035b79898574c9de876928912046feb56150`;
  instruction SHA-256
  `7000adbe7597200633a507d2f08a04411534453f75f18d71064e4e3e6cd99354`.
- **Transport note:** plain-format narration precedes the artifact
  heading; the body below is byte-verbatim from the heading onward.
- **Verdict:** NOT READY (2 MATERIAL, 2 DETAIL IN-DELTA + 1 DETAIL
  PRE-EXISTING; zero PRE-EXISTING MATERIAL; direction retained; probe
  (a) determinate incl. a four-row target table, probe (b) fails the
  fully-determinate bar on the fingerprint bytes). Self-attested
  capsule-only; disclosed that a filename grep surfaced 0254 review
  snippets (outside this round's blindness set). 

---

# LLP 0255 r4 review — Grok 4.6 (xAI)

**Runtime:** Grok 4.6 agent  
**Date:** 2026-08-13  
**Target:** `llp/0255-tiny-data-surface-v1-api.spec.md` — Type: Spec, Status: Review  
**Revision:** r4, SHA-256 `66bc954966e29f57efc4914538100a65581dafd18b7673e423f1ffda2794a7a8`, 90,194 bytes (verified: `shasum -a 256` and `wc -c` match the recorded identity)  
**Notable files:** `llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0043-offline-replay-retention.rfc.md`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`; `llp/0133-local-settlement.spec.md`; `llp/0108-inline-handlers-and-result-contracts.spec.md`; `llp/0004-application-data-api.rfc.md`; `schemas/functions.manifest.schema.json`; `src/manifest.rs`; `src/storage.rs`; `src/storage/settlement.rs`; `packages/snapback-codegen/define.mjs`; `packages/snapback-codegen/standard-patterns.mjs`

**Delta honesty.** Every r3→r4 item in `REVIEW_INSTRUCTIONS.md` is present in this text (S3.2 collapsed predicate, S4.4 `ledgerIdentity` / `targetCustody`, S7.2 binary target, S2 three-noun restatement, S6.1 `documents` parenthetical, S3.4 cursor absence, S5.3 claim-not-boundary + mint-failure code, S12/S7.4 durable-store-for-every-write, S2 no-drop rows, S6.2 table-wide collision, S7.1b conditional `data.` reservation). This capsule has no r3, so exclusivity of that list was not independently checked.

## Overall assessment

r4 does the right architectural work. Collapsing the two target predicates to the one shipped advertisement is exactly how `offline_mutation_replay` is derived (`src/manifest.rs:11133-11135`; LLP 0058's positive predicate). Renaming the client projection off `settlementIdentity` avoids the LLP 0133 wire field. Treating cursor authenticity as a claim, not a boundary, is the correct security model for both v1 policy classes. Requiring a durable store and a ledger-bearing target for every data write follows LLP 0254 D5's recoverability rule and is internally consistent with S3.2/S7.2/S7.4/S12.

Two IN-DELTA contract holes remain. `ledgerIdentity` is still not an implementable projection of the shipped duplicate-settlement identity, and the r4 restatement of hashed result kinds makes `get` both self-contradictory and unrepresentable on the shipped Query/LiveQuery grammar. Those are spec-altitude defects; Phase 1 cannot freeze contracts from this text. Not ready.

## Concerns

### 1. MATERIAL · IN-DELTA — `ledgerIdentity` is not a complete or collision-specified projection of the shipped ledger key

S4.4 presents `ledgerIdentity` as “a client-side projection of the server-derived canonical mutation identity” carrying “LLP 0043's complete duplicate-settlement tuple” with `inputFingerprintDigest` covering `{args, readSet, ctxLedger}` plus the LLP 0133 extensions (`llp/0255-tiny-data-surface-v1-api.spec.md:866-879`). The type is required on every `DataTransactionV1` (`833-842`). That is not yet a contract an implementer can mint or that a server can compare.

**The digest preimage is not the shipped fingerprint.** The live input fingerprint is SHA-256 over key-sorted JSON of `{args, readSet, ctxLedger}`, and the `settlement` object is **omitted** when `MutationSettlement` is default so a lane-Q upgrade still republishes stored rows (`src/storage.rs:15990-16015`). r4 says the digest “covers … plus the LLP 0133 extensions” with no default-omit rule, no field encoding, and no algorithm. S4.1's artifact hashing is RFC 8785/JCS with an explicit domain prefix (`545-548`); `canonicalArgsDigest` is also “domain-separated SHA-256 over RFC 8785/JCS” (`879-882`) with **no domain string**. An implementer who applies S4.1 to `inputFingerprintDigest` will not match `mutation_input_fingerprint`. Whether data writes emit a non-default `MutationSettlement` (lane, `settlementIdentity` claims, claim set, `boundedSkew`) is unstated, and that choice changes the preimage.

**Sources for several required fields are not in this document.** `readSet` and `ctxLedger` are `HandlerInput` request fields (`src/manifest.rs:9907-9927`); the client defaults them to `[]` / `null` unless generated IR fills them (`packages/snapback-client/index.mjs:9031-9108`). S3.2's outbox list names “canonical arguments” and identities, not those two fingerprint inputs (`375-379`). `authorityFingerprint` is `auth_fingerprint(AuthInput)` over `{principal, session_id, user_id}` (`src/manifest.rs:10503-10516`). It is not a field of `DurableReplayAuthorityV1` (`authorityDescriptor`, `principalScope`, `custody`; `858-860`; LLP 0043's enqueue triple). `authorityInstance` can be read from `authorityDescriptor.authorityInstanceId`; the fingerprint cannot.

**Two different keys are both called the settlement/ledger key.** “The settlement key is the stable `intentId` plus original generation and normalized transaction identity” (`853-855`). Four sentences later, “`generationId` and the transaction witness are additional client assertions that never alter the canonical ledger key” (`877-879`). The shipped lookup is: find by `clientMutationId`, then compare `function`, `auth_fingerprint`, `authority_instance_id`, `input_fingerprint`, and optional `operation_issuance` (`src/storage/settlement.rs:460-580`). `generationId`, `normalizedDataTransactionId`, and `canonicalArgsDigest` are not lookup columns. `operation_issuance` and `artifact_generation_digest` (which can rewrite `input_fingerprint`; `src/storage.rs:1037-1052`) are absent from `ledgerIdentity`.

The rename itself is correct and collision-free with LLP 0133's wire `settlementIdentity: {implementationHash, activation}` (`src/manifest.rs:10181-10190`; LLP 0043's same naming caution). Completeness is what r4 claimed and did not finish.

**Resolution.** Split the client replay key (`intentId` + original `generationId` + `normalizedDataTransactionId`) from the server ledger identity. Pin `inputFingerprintDigest` to the shipped `mutation_input_fingerprint` (key-sorted JSON, `sha256:` hex, `settlement` omitted iff default). Pin `readSet`/`ctxLedger` as the ordinary mutation-request fields persisted on the outbox with that identity. Pin `authorityFingerprint` as the shipped `auth_fingerprint` over request `AuthInput`. State that the server ignores `generationId`, the transaction witness, and `canonicalArgsDigest`. Name the `canonicalArgsDigest` domain string. State whether v1 data writes send a non-default `MutationSettlement`.

### 2. MATERIAL · IN-DELTA — hashed `get` / `delete` kinds contradict S2 and the shipped result-contract grammar

r4 pinned three nouns and restated closed result contracts in “canonical kinds” (`279-288`). That restatement does not type-check.

S2 first keeps “the shipped canonical **`documents` result contracts**” and says data-resource reads differ from `owned-crud.v1` by names, `after`, and the S3.4 continuation — “not a new result kind” (`247-257`). The same section then hashes `get` as canonical **`document`** projected as `Row | null` (`283-285`). Public-read get “project[s] `null`” for not-found and not-visible (`270-271`). S6.1's r4 parenthetical treats every data-lowered `Query|LiveQuery` as a `documents` contract with reserved `after` (`1158-1161`), which is true of list and false of get (`{id}`, no `after`; `253-254`).

Shipped Query/LiveQuery admission only accepts `documents`, `records`, or a legacy object validator (`packages/snapback-codegen/define.mjs:3625-3632`). `document` is a mutation-side kind (`schemas/functions.manifest.schema.json:1423-1442`). A `document` contract is a required table-shaped object; JSON `null` is a `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION`, so hashed `document` cannot express the non-disclosure `null`. Owned CRUD get is a `defineLiveQuery` without a singular document contract (`packages/snapback-codegen/standard-patterns.mjs:327-334`). There is no S3 amendment admitting nullable `document` on Query/LiveQuery.

`delete → closed null` has the same noun problem at lower stakes: there is no FunctionResultContract kind `null`. The closed spelling is `{kind:"value", value: Null}` (LLP 0108's `ResultValueV1`). That one is representable on a mutation. `get → document` is not representable on a query and contradicts the “keep `documents` / not a new result kind” rule in the same section.

**Resolution.** Hash list **and** get as `documents` (get: zero or one row). The get facade may project `[] → null` and `[row] → row`. Keep “not a new result kind.” Spell delete as `{kind:"value", value: Null}`. If a hashed nullable `document` is actually wanted, add a dated LLP 0108/0004 amendment; do not smuggle it through this Spec's kind list. Tighten S6.1's parenthetical to list-shaped candidates (documents + `after`), not every resource read.

### 3. DETAIL · IN-DELTA — cursor “semantic equivalence” overclaims expressiveness; the security claim is sound

S5.3 says a caller-synthesized `lastKey` is “semantically equivalent to a range filter the grammar already admits, inside the caller's own policy-composed visibility” (`1055-1061`). S3.4 says compound strict-after on `(order, _id)` is **inexpressible** in `single_table_v1`'s conjunctive filter record (`486-489`). Those sentences cannot both be literal.

The **security** claim holds for both v1 classes. Owner equality is a generated plan node the caller cannot name (`1018-1021`, `1010-1012`); `lastKey` is only `[orderValue, id]` and is type/bounds-checked; other cursor fields are recomputed and must byte-match (`1051-1059`). A forged `lastKey` repositions inside the already-authorized scan. It cannot see another owner's rows, and it cannot return a public-read row a range query on the same index would refuse. Empty vs missing remains non-disclosing because policy still runs. “Not a security boundary” and the optional MAC are the right altitude. `QueryOutput.cursor` as `Option<String>` skipped when `None` (`src/manifest.rs:10554-10564`) matches S3.4. `SNAPBACK_DATA_CURSOR_MINT_UNAVAILABLE` correctly follows `SNAPBACK_STANDARD_PATTERN_CURSOR_MINT_UNAVAILABLE`.

**Resolution.** Replace “semantically equivalent” with “no additional privilege”: a synthesized `lastKey` is a start position inside the caller’s already-admitted, policy-composed scan; the compound tie-break is inexpressible as a v1 filter and is not a visibility widening.

### 4. DETAIL · IN-DELTA — no-drop table still does not name `retentionClass`

The r4 rows cover the previously missing `FunctionDefinition` fields (`kind`, `apiExposure`, `publicInline`, `authorityProfileDependence`, `permissionEpochBumps`, `syncabilityClass`, `bundleEntrypoint`, `runtime`, `uses`; `319-323`). `authScopeField` correctly rides on `readSetSummary` (`325-326`). The fail-closed claim is that generation iterates the **actual** shipped record schema and fails any field absent from the table (`327-329`).

`retentionClass` is a distinct identity-bearing field (`src/manifest.rs:7928-7941`; `schemas/functions.manifest.schema.json:1268-1274`). The table only has “retainable / retention declaration → fixed `false`” (`311`). Implied disposition (absent when `retainable` is false) is right; the named-field assertion is not. The table also lists `requires`, which is a familiar **source** key (S11), not a `FunctionDefinition` field.

**Resolution.** Add an explicit `retentionClass: absent` row. Move `requires` to S11. Optionally spell `readSetSummary` / `writeSetSummary` / `handlerForm` / `trackedRefusals` / `sourceSpan` under their shipped names so the “iterate the schema” sentence is literal.

### 5. DETAIL · PRE-EXISTING — resource-lowered argument-contract sentence is still not exact

Even after the r4 scope to “resource-lowered” reads, S2 says that argument contract “is exactly the shared reserved optional `after`” and then defines get as `{id}` with no `after` (`251-254`). List is `{after?}`; catalogued descriptors add slot keys (S6.2). Harmless once concern 2 is fixed; the sentence should list the two resource shapes rather than call both `after`.

**Resolution.** “Resource-lowered list is `{after?: DataCursorV1}`; resource-lowered get is `{id}`; S6.2 members add slot keys plus reserved `after`.”

## Implementer-probe result

### (a) v1 target-capability story — determinate

**Reads.** Public-read and owner resources both generate `list`/`get`. The tiny builder never reaches `get` (`1147-1150`). `db.read` needs only bounded read support (`1109-1110`). `db.useQuery` / `db.watch` additionally need `sync.enabled`, live delivery, admitted local materialization, and those target capabilities; absence is `SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE` with no polling fallback (`1109-1111`, `232-239`). Sync opt-out emits `Query` rather than `LiveQuery` and does not remove server read (`232-239`). Retention is out of v1 (`675-679`, `1112-1113`). `offline_mutation_replay` is not a read gate.

**Writes.** Public-read emits none (`201-201`, `273`). Owner writes are intrinsically queue-eligible unless a generated reason forces online-only (`1340-1343`). Callers cannot pass `queue` (`371-373`). Target capability is binary and dispatch-time, never a core fact (`1344-1352`):

| Target | Intrinsic class | What happens |
| --- | --- | --- |
| Advertises `offline_mutation_replay` (support fact is exactly `client_mutation_settlement_ledger_registered`) | queue-eligible | Admit. `targetCustody: "queue-served"`. May report `queued` or settle immediately. Never silently downgraded. |
| Same advertisement | online-only | Admit. `targetCustody: null`. Persist a non-replayable observation; recover ambiguity by `intentId` on the ledger. |
| No advertisement (e.g. Cloudflare) | either | Refuse **every** data write before transport with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE`. Not an online-only reason. |
| No durable client store | either | Same code, before transport; required for queue records **and** online-only observations (`1417-1421`, `1587`). |

All four prediction × custody cells still require authoritative settlement (`1353-1354`). Ledgerless online mutation, which non-data `queue: 'auto'` still allows, is not a data-surface dispatch mode.

### (b) Ledger identity for a three-chunk batch — **not** fully determinate

From the document alone, the envelope is:

| Field | Source the spec does pin | Server lookup |
| --- | --- | --- |
| `intentId` | Client-minted `clientMutationId`, byte-for-byte (`405-407`, `834`) | Primary key of `_snapback_client_mutations` |
| `functionId` | `{appId}:data.tx_<first 16 hex of normalizedDataTransactionId>` (`1266-1269`, `835`) | Compared to retained `function`; mismatch → `SNAPBACK_CLIENT_MUTATION_ID_REUSED` |
| `canonicalArgsDigest` | Domain-separated SHA-256/JCS of the named wire object `{c0_<arg>, c1_<arg>, c2_<arg>}` (`879-886`) | **Not** a lookup column; args enter only via the input fingerprint |
| `canonicalArguments[]` | Convenience projection, chunk-major, not a second preimage (`882-884`) | Unused |
| `inputFingerprintDigest` | Claimed to cover `{args, readSet, ctxLedger}` plus 0133 extensions (`873-876`) | Compared to retained `input_fingerprint`; mismatch → `REUSED` |
| `authorityFingerprint` | Named as part of the 0043 tuple (`871-873`) | Compared to retained `auth_fingerprint`; mismatch → `SNAPBACK_AUTH_STALE_RESULT` |
| `authorityInstance` | From `DurableReplayAuthorityV1.authorityDescriptor` (`858-860`) | Compared to retained `authority_instance_id`; mismatch → stale |
| `generationId` | Envelope generation (`567`, `840`) | **Not** a lookup column (client replay assertion) |
| `normalizedDataTransactionId` | Witness of the pre-resolution core (`546-548`, `841`) | **Not** a lookup column (client replay assertion) |

`args` for that digest/fingerprint is the `c<position>_<argName>` object of the one synthesized `Mutation` (`1279-1280`). The server does not consume `ledgerIdentity` as a wire object; it rebuilds `ClientMutationIdentity` from the mutation request and compares (`src/storage/settlement.rs:460-580`).

Not determinate from this Spec: the exact `inputFingerprintDigest` bytes (algorithm, default-omit of `settlement`, whether v1 sends 0133 fields); `readSet` / `ctxLedger` values for a HostPlan batch; how `authorityFingerprint` is computed from `DurableReplayAuthorityV1`; which of the two S4.4 “keys” the server uses. Probe (b) therefore fails the “fully determinate” bar.

## Direction assessment

No `DIRECTION-DISSENT`. Keep the collapsed registry predicate, the binary target gate, the `ledgerIdentity` name, cursor-as-claim, durable-store-for-every-write, three-layer nouns, and the conditional `data.` reservation. Finish the two contracts r4 already undertook: ship the real fingerprint, and put `get`/`delete` in kinds the hashed layer actually has.

## Self-attestation

Worked only inside this directory tree. No network or web search. Verified the recorded SHA-256 and byte count. `llp/reviews/0255*` does not exist. Did not read `REVIEW-CANDIDATE-r*.md` or `final-cli.log`. A filename grep for LLP 0254 surfaced snippets under `llp/reviews/0254*`; those are out of this round's blindness set. No other deviations.

VERDICT: NOT READY


## Round 5 — 2026-08-13 (verification delta round)

- **Runtime:** same as prior rounds (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-5 capsule
  (launch 5).
- **Revision reviewed:** r5, SHA-256
  `02afe7cfa8fd784c1741b7d8f0ea040d99c265c0348100f6c279a27e6ce8ea1b`
  (93,254 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `3c94f040d3002ab70a7dbd21fd7b04de127cbe7663eb37e3a77e4ef3106cc3dd`;
  instruction SHA-256
  `e791e6890d26320160de34fd637abdf0ae6dcecf47062fe781a6958b7eb87176`.
- **Transport note:** plain-format narration precedes the artifact
  heading; the body below is byte-verbatim from the heading onward.
- **Verdict:** NOT READY (1 MATERIAL, 3 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained; probe (a) produced the
  full five-row comparison table, probe (b) confirms the pagination and
  target stories stand). Disclosed deviation: two out-of-capsule skill
  files read by its harness before the instructions were treated as
  governing; no findings supplied. Counted with disclosure.

---

# LLP 0255 r5 review — Grok 4.6 (xAI)

- **Model / runtime:** Grok 4.6 (xAI), this session
- **Date:** 2026-08-13
- **Target:** `llp/0255-tiny-data-surface-v1-api.spec.md` (Type: Spec, Status: Review)
- **Revision:** r5, SHA-256 `02afe7cfa8fd784c1741b7d8f0ea040d99c265c0348100f6c279a27e6ce8ea1b`, 93,254 bytes — verified by `shasum -a 256` and `wc -c`
- **Notable files:** the target; `llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0133-local-settlement.spec.md`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`; `llp/0043-offline-replay-retention.rfc.md`; `src/storage.rs`; `src/storage/settlement.rs`; `src/local.rs`; `src/manifest.rs`; `src/contract_types.rs`; `packages/snapback-client/generated-mutation-ir.mjs`; `packages/snapback-client/store-runtime.mjs`; `packages/snapback-client/index.mjs`; `packages/snapback-codegen/index.mjs`

## Overall assessment

The r4→r5 delta list is honest. The server-rebuilt settlement identity, `replayKey` split, list-only S6.1 candidates, suffix/non-widening cursor proof, `get`/`delete` re-kinding, named Cloudflare/Expo fail-closed reach, and `SNAPBACK_DATA_RESOURCE_INELIGIBLE` collision routing are the right repairs, and they sit inside LLP 0254 D3–D7.

The settlement-identity paragraph is not yet a single contract. S4.4 pins v1 data writes to the **default** `MutationSettlement` (so `settlement` is omitted from `mutation_input_fingerprint`) and, in the next sentences, leaves the shipped `settlementIdentity` field “untouched” as original-generation pinning **inside that fingerprint**. Those two pins cannot both be true of the ordinary generated-mutation carrier this Spec reuses. That is the blocking defect. The cursor proof is sound as stated. The re-kinded `get`/`delete` contracts are representable in the shipped kind grammar. The recursive no-drop assertion is coherent against `FunctionDefinition`, with one carrying-path gloss.

## Concerns

### 1. v1 default-`MutationSettlement` pin collides with the shipped generated-IR carrier and with the residual `settlementIdentity` claim

- **Classification:** MATERIAL, IN-DELTA
- **Evidence:** `llp/0255-tiny-data-surface-v1-api.spec.md:893-903` first requires data writes to send the default `MutationSettlement` so `settlement` is always omitted from the fingerprint, then states that shipped `settlementIdentity: {implementationHash, activation}` “continues to carry original-generation pinning into the fingerprint’s claims.” Under the shipped omit-iff-default rule (`src/storage.rs:15996-16008`; `src/manifest.rs:10181-10190`), `settlementIdentity` is a `MutationSettlement` member: if it is present, settlement is non-default and the whole settlement object **enters** the fingerprint; if the default is sent, `settlementIdentity` is absent and **cannot** pin generation.

  The ordinary carrier this Spec reuses does not send the default on the path data writes must take. Owner writes are `prediction: "generated-exact"` (`llp/0255-tiny-data-surface-v1-api.spec.md:648-649`, `1367-1368`). Every data write requires a durable store (`llp/0255-tiny-data-surface-v1-api.spec.md:420-425`). `mutate` then composes generated IR (`packages/snapback-client/index.mjs:9090-9108`), and `prepareGeneratedMutationIrV1` always emits `settlementLane: "re-derive"`, `settlementIdentity: {implementationHash, activation: expectedGeneration}`, and `settlementClaims` (`packages/snapback-client/generated-mutation-ir.mjs:135-147`; copied at `packages/snapback-client/store-runtime.mjs:1693-1718`; placed on the wire at `packages/snapback-client/index.mjs:9248-9249`). Those fields make `MutationSettlement != default`. The compared identity on that carrier is therefore the include-settlement preimage, not the three-field omit-default preimage the v1 pin names.

  This is a residual client-mintability / pin-collision claim of the exact kind r5 was asked to close. An implementer who obeys “always default” must strip IR settlement fields and break “untouched / continues to carry.” An implementer who leaves the IR carrier untouched sends non-default settlement and breaks the omit pin. Generation then either is or is not a server settlement-identity input; the text says both.
- **Resolution:** Pick one and delete the other. **(A)** Data writes use the shipped IR-derived `MutationSettlement` (lane `re-derive`, codegen-owned `settlementIdentity` and `settlementClaims`). Keep omit-iff-default as the **algorithm**; say v1 takes the include branch; name the compared settlement members; drop “always send the default.” **(B)** Data writes force default `MutationSettlement` on the wire (IR may still drive local prediction and `ctxLedger`). Drop `llp/0255-tiny-data-surface-v1-api.spec.md:901-903`; original-generation pinning stays on `replayKey` / outbox only. Do not leave both sentences in S4.4.

### 2. Full `EffectCeilingV1` / dependency summaries are said to ride via `FunctionReference`; the shipped reference object does not carry them

- **Classification:** DETAIL, IN-DELTA
- **Evidence:** `llp/0255-tiny-data-surface-v1-api.spec.md:313-314, 331-338` disposes the full `readSetSummary` / `writeSetSummary` / `EffectCeilingV1` records as riding whole via `FunctionReference`, with recursive parity over those record members. The no-drop subject is the canonical function record, and `FunctionDefinition` already has those fields (`src/manifest.rs:7986-7998`). The generated `FunctionReference` object does not (`packages/snapback-codegen/index.mjs:12987-13011`; `FunctionReferenceBase` at `packages/snapback-codegen/index.mjs:13463-13489`). `NormalizedDataResourceV1.operations` keeps only `readTables` / `writeTables` / `effectCeilingClass` (`llp/0255-tiny-data-surface-v1-api.spec.md:638-649`). The recursive assertion is coherent against `FunctionDefinition`; the carrying vehicle named in the disposition table is not the shipped reference.
- **Resolution:** Retarget the disposition at the function-manifest record (already true), or explicitly widen the generated `FunctionReference` object and its type. Do not leave “via `FunctionReference`” as an unimplemented second copy.

### 3. Delete contract spelling `value: Null` is not the shipped JSON node

- **Classification:** DETAIL, IN-DELTA
- **Evidence:** `llp/0255-tiny-data-surface-v1-api.spec.md:290-291` writes `{kind:"value", value: Null}` and correctly rejects a top-level `null` kind. Shipped `FunctionResultContract::Value` wraps `ResultValueContract`, whose null node is `{kind:"null"}` (`src/contract_types.rs:1212-1213, 1356-1376`). `{kind:"value", value: null}` will not deserialize. Kind placement is otherwise right: queries admit `documents`/`records`; mutations admit `document`/`value` (`src/manifest.rs:3708-3721`).
- **Resolution:** Spell the contract as `{kind:"value", value:{kind:"null"}}`.

### 4. Issuance exclusion is not isolated from a host client with `operationIdentityProtocol: 1`

- **Classification:** DETAIL, IN-DELTA
- **Evidence:** `llp/0255-tiny-data-surface-v1-api.spec.md:897-900` puts `operationIdentityProtocol: 1` and artifact-generation comparison out of v1. The shipped client treats protocol `1` as a constructor flag that attaches `operationIssuance` on mutate (`packages/snapback-client/index.mjs:9126, 9162`). `createDataClient({ client, data })` (`llp/0255-tiny-data-surface-v1-api.spec.md:1492-1494`) reuses that client. A host constructed with protocol `1` would send issuance, take `ClientMutationIdentity::with_artifact_generation` (`src/local.rs:11502-11532`), and compare a different identity than the v1 pin.
- **Resolution:** Require the data doorway to refuse or strip issuance (force protocol-null on data writes), independent of the host client’s constructor flag.

## Implementer-probe result

**(a) Three-chunk batch — server duplicate-settlement comparison, from the document**

A 1..16-chunk `db.transact` with three chunks is `resolution.kind: "synthesized-batch"` (`llp/0255-tiny-data-surface-v1-api.spec.md:1303-1339`): one ordinary `Mutation` on the ordinary mutation wire, one `clientMutationId`. The server does not receive a settlement-identity object. It looks up by `clientMutationId` (= `intentId`) and exact-compares the identity it rebuilds (`llp/0255-tiny-data-surface-v1-api.spec.md:881-900`):

| Compared value | Source on the ordinary mutation request |
| --- | --- |
| Lookup key `clientMutationId` | Request field `clientMutationId` = envelope `intentId` |
| Invocation **name** | Exported route name `data.tx_<first 16 lowercase hex digits of normalizedDataTransactionId>` — not `{appId}:data.tx_…`, not the three chunk names |
| `auth_fingerprint` | Server-derived over canonical `AuthInput` `{principal, session_id, user_id}` from the prepared authority / request auth after server canonicalization — not a client-supplied digest |
| `authority_instance_id` | Rides inside `authority.authorityDescriptor` (LLP 0043 durable triple on the envelope; ordinary request `authorityDescriptor`) — not a sibling settlement field |
| `mutation_input_fingerprint` | SHA-256, **no** domain prefix, over key-sorted canonical JSON of `{args, readSet, ctxLedger}` |

Per the document’s v1 pins, `settlement` is omitted because data writes send default `MutationSettlement`. Wire preimage of the fingerprint:

- `args` — `{c0_<argName>, c1_<argName>, c2_<argName>}` (dense 0-based; S7.1b)
- `readSet` — ordinary mutation-request field, filled from the synthesized member’s generated IR, persisted on the outbox
- `ctxLedger` — same

Server-ignored: `replayKey`, `canonicalArgsDigest`, `operationIssuance` / `operationIdentityProtocol: 1`. Concern 1 is that this omit-default preimage is **not** what the shipped generated-IR carrier actually sends on the queue-eligible generated-exact path this batch will use.

**(b) A1 pagination and target-capability stories**

Neither became newly indeterminate. Appendix A1 is still the first `take(100)` page with no `.after` (`llp/0255-tiny-data-surface-v1-api.spec.md:1694-1696`). Continuation remains S5.3 `DataCursorV1` / reserved `after` / `complete iff cursor === null`; r5 rewrote the security proof, not the pagination API. Target capability is still the single `offline_mutation_replay` bit for every data write (`llp/0255-tiny-data-surface-v1-api.spec.md:437-453, 1381-1387`). r5 only names the already-forced consequences: Cloudflare coordinator and the non-durable Expo File/Directory adapter serve zero tiny data writes.

## Direction assessment

No `DIRECTION-DISSENT`. Splitting `replayKey` (client replay/recovery) from a server-rebuilt shipped comparison, replacing filter-equivalence with the suffix/non-widening cursor proof, re-kinding `get`/`delete` onto `documents` / `value`, and naming the deployment-reach fail-closed are the correct r5 direction. The remaining work is to make the v1 settlement pin match one real carrier.

## Self-attestation

I worked only from this capsule except for two skill files outside the tree (`~/.grok/bundled/skills/review/SKILL.md`, `~/.cursor/skills/llp-review/SKILL.md`), read before treating `REVIEW_INSTRUCTIONS.md` as governing; they did not supply findings. I did not read any `llp/reviews/0255*` file (none exist). I verified the recorded r5 hash and byte count. I did not author this document. No network.

VERDICT: NOT READY


## Round 6 — 2026-08-13 (final verification delta round)

- **Runtime:** same as prior rounds (Grok CLI, `grok-4.6`,
  `--reasoning-effort xhigh`, `--output-format plain`,
  `--disable-web-search`), launched blind in the round-6 capsule
  (launch 6).
- **Revision reviewed:** r6, SHA-256
  `6a75927becf51b8e02b494c0a033aa10a4df3bf088b7fc20646ce7ed801ad404`
  (95,344 bytes); hash and size verified in-capsule.
- **Capsule inventory SHA-256:**
  `902324a85775be28d59ca5421db734f29ad6bce57d87ca890accd6b17fb95acb`;
  instruction SHA-256
  `b7e3bc738a16d1736129f1a81b4be3d0ac2f1d2bd78ff2a3f7903253fb8e59ee`.
- **Transport note:** plain-format narration precedes the artifact
  heading; the body below is byte-verbatim from the heading onward.
- **Verdict:** NOT READY (1 MATERIAL, 3 DETAIL — all IN-DELTA; zero
  PRE-EXISTING MATERIAL; direction retained; both fingerprint preimages
  and the four-row deployment table produced and verified against the
  shipped carrier). Disclosed deviations: one out-of-capsule skill file
  for artifact-shape orientation; a corpus grep printed 0254-review
  excerpts (a different document), unused. Counted with disclosure.

---

# Independent review — LLP 0255 r6 (final verification delta)

- **Reviewer:** Grok 4.6 (xAI), this session
- **Date:** 2026-08-13
- **Target:** `llp/0255-tiny-data-surface-v1-api.spec.md` — Type: Spec, Status: Review
- **Revision identity (verified):** SHA-256 `6a75927becf51b8e02b494c0a033aa10a4df3bf088b7fc20646ce7ed801ad404`, 95,344 bytes — matches the recorded r6 identity
- **Forbidden-file check:** `llp/reviews/0255*` is absent
- **Notable files read or searched:** `REVIEW_INSTRUCTIONS.md`; the target Spec in full; `llp/0254-tiny-ordinary-data-surface.rfc.md`; `llp/0133-local-settlement.spec.md` (identity pins via code `@ref`s); `src/manifest.rs`; `src/storage.rs`; `src/storage/settlement.rs`; `src/contract_types.rs`; `packages/snapback-codegen/{define.mjs,index.mjs,result-contracts.mjs,standard-patterns.mjs}`; `packages/snapback-client/{index.mjs,generated-mutation-ir.mjs,store-runtime.mjs}`

## Overall assessment

r6’s substantive pins are the right contract. The settlement preimage now names the shipped carrier’s two real `MutationSettlement` shapes and maps them by generated prediction class; the write-side `offline_mutation_replay` gate is taken out of `FunctionDefinition.requiredCapabilities` so a `.data` artifact can deploy read-capable on a ledgerless target; `get` as `records` `{minItems:0,maxItems:1}` is a representable hashed contract; delete’s explicit null value node is the one named specialization against today’s undeclared/`unknown` CRUD delete; issuance stays doorway-absent with the fifth comparison member; the coverage-active zero-writes class is real. Against LLP 0254 (Accepted) the document still freezes the Phase 0 surface it was authorized to freeze.

The revision is not yet accept-ready. S2’s lead paragraph and the S3.4 amendment paste still state the pre-r6 hashed-contract claims (`documents` for reads; mutations “unchanged”). Those sentences are still normative and would mint different `resultContractHash` values than the r6 pins a few dozen lines later. That is an in-delta coherence defect in a contract-bearing Spec.

Delta-list honesty (presence check; no r5 copy is in this capsule): all seven enumerated r5→r6 items are in the current text. The “always send the default” sentence is absent.

## Concerns

### 1. MATERIAL / IN-DELTA — S2 lead and S3.4 still contradict the r6 hashed read/mutation contracts

**Defect.** r6’s own later text is clear and implementable:

- `get` → canonical `records` with the table row shape and `{minItems:0,maxItems:1}` (`llp/0255-tiny-data-surface-v1-api.spec.md:284-291`)
- `delete` → `{kind:"value", value:{kind:"null"}}`, the one named specialization vs shipped CRUD (`llp/0255-tiny-data-surface-v1-api.spec.md:291-297`)

The same section still says the opposite in the same normative register:

- “Read operations keep the shipped canonical **`documents` result contracts**” and DataPageV1’s `rows` “= the documents result” (`llp/0255-tiny-data-surface-v1-api.spec.md:247-251`)
- distinguishing `data-resource.v1` from `owned-crud.v1` is “not a new result kind” (`llp/0255-tiny-data-surface-v1-api.spec.md:255-258`)
- “Mutations reuse the CRUD lowering contracts unchanged” (`llp/0255-tiny-data-surface-v1-api.spec.md:259`)

S3.4’s proposed-pending paste into LLP 0004/0065 still ends “adds no new result kind: read results remain canonical `documents`” (`llp/0255-tiny-data-surface-v1-api.spec.md:521-523`).

Those are not three-noun slips. `documents` and `records` are different `FunctionResultContract` arms (`src/manifest.rs:3708-3721`); bounds ride only on `records` (`src/manifest.rs:3767-3775`; `packages/snapback-codegen/define.mjs:603-617`). Owned-crud `get` is an implicit `documents` LiveQuery (`packages/snapback-codegen/standard-patterns.mjs:327-334` + `packages/snapback-codegen/result-contracts.mjs:874-880`). Owned-crud `delete` is undeclared and extracts `{kind:"unknown"}` (`packages/snapback-codegen/standard-patterns.mjs:352-360`; `packages/snapback-codegen/result-contracts.mjs:914`). Following the lead paragraph mints different hashes, TypeScript, and admission than following the r6 pins. Ratifying S3.4 as written would copy the leftover `documents` claim into LLP 0004 after this Spec changed `get`.

S6.1 was updated (`llp/0255-tiny-data-surface-v1-api.spec.md:1220-1223`) and is consistent. The lead and the amendment paste were not.

**Resolution.** In S2:247-263, say list keeps hashed `documents` and the DataPageV1 facade; `get` is the records `{0..1}` specialization below; mutations are unchanged except the named delete contract. In S3.4, restrict “remain canonical `documents`” to keyset-profile list members.

### 2. DETAIL / IN-DELTA — `get`’s `[] → null` projection has no named owner on the only consumption path

**Defect.** r6 puts non-disclosure in two places: resource-lowered get “not-found and not-visible both project `null`” (`llp/0255-tiny-data-surface-v1-api.spec.md:270-271`) and “the facade projects `[] → null` and `[row] → row`” (`llp/0255-tiny-data-surface-v1-api.spec.md:288-290`). S5.4 says generated get is not tiny-builder-reachable; point reads use the canonical reference surface (`llp/0255-tiny-data-surface-v1-api.spec.md:1208-1212`).

The hashed contract is a 0..1 array (`resultContractType` for `records` with `minItems !== 1` is `ReadonlyArray<…>` at `packages/snapback-codegen/result-contracts.mjs:920-924`). Canonical `useQuery`/`watch` over that reference therefore see `[]`, not `null`, unless some unnamed wrapper projects. The tiny builder never calls get.

This does not make `{0..1}` unrepresentable: `results.records(v.doc(table), {minItems:0,maxItems:1})` lowers to a closed object record plus bounds (`packages/snapback-codegen/result-contracts.mjs:699-731`, `:265-281`, `:411-454`) and passes query admission (`src/manifest.rs:3712-3716`, `:3745-3775`).

**Disposition.** Name the projection owner (generated data-client method, even if not builder-reachable) or restate get’s public presentation as the hashed `records` array, with `null` only if that owner exists. Keep `{0..1}` either way.

### 3. DETAIL / IN-DELTA — coverage-active zero-writes is a post-transport server refusal, not the S12 custody door

**Defect.** The new third class is real: an active LLP 0162/0163 coverage manifest on `ordinaryMutation` refuses an identity-less writer with `SNAPBACK_OPERATION_IDENTITY_REQUIRED` (`src/storage.rs:16696-16726`; lane name at `src/operation_ledger.rs:45`). Default local SQLite does not install that manifest; activation is the unpublished coverage surface. r6 is right to record the class for D9.

It is not the same door as Cloudflare / non-durable Expo. Those refuse before transport with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` (`llp/0255-tiny-data-surface-v1-api.spec.md:425-429`, `:1410-1413`, `:1650`). Coverage-active targets that *do* advertise `offline_mutation_replay` accept dispatch, then fail at commit with a code that is not in S12. Queue-eligible replay can therefore accept custody and later strand on a non-data diagnostic.

**Disposition.** One S3.2/S12 sentence: coverage-active is a server identity refusal (`SNAPBACK_OPERATION_IDENTITY_REQUIRED`), after transport, and is not folded into `SNAPBACK_DATA_CUSTODY_UNAVAILABLE`. D9 must not treat a coverage-activated local store as a write-capable evaluation target.

### 4. DETAIL / IN-DELTA — settlement *shapes* match the carrier; shipped `mutate` *gates* compose on store ∧ `queue !== false`

**Defect.** The two `MutationSettlement` shapes r6 names are exactly the shipped ones.

- Default (`SettlementLane::ReplayAccept`, all options `None`; `src/manifest.rs:10090-10093`, `:10180-10205`) is omitted from `mutation_input_fingerprint` (`src/storage.rs:15996-16001`).
- Non-default includes the `settlement` object with no domain prefix (`src/storage.rs:16002-16014`).
- Generated IR compose emits `settlementLane: "re-derive"`, `settlementIdentity: {implementationHash, activation}`, `settlementClaims` (mints / optional `now`), `boundedSkew` (`packages/snapback-client/generated-mutation-ir.mjs:113-146`).
- Optimistic paint requires `re-derive` (`packages/snapback-client/index.mjs:9117-9118`).
- Issuance comparison is the fifth retained-vs-proposed member (`src/storage/settlement.rs:567-584`).
- Wire `authorityDescriptor` is how the server derives `authority_instance_id` (`src/local.rs:11543-11555`).

Shipped `prepareGeneratedMutation` fills that lane-L record only when `capability.localExecutable && composeLocalExecution` (`packages/snapback-client/store-runtime.mjs:1693-1720`). `composeLocalExecution` is true only when `queue === true` or (`queue === 'auto'` and a store exists) (`packages/snapback-client/index.mjs:9090-9108`). `queue: false` is the documented degrade that *omits* settlement even for local-executable IR (`packages/snapback-client/generated-mutation-ir.test.mjs:177-246`).

S3.2 requires a durable store for every data write, so the happy path coincides. S7.2 still admits generated-exact × online-only with provisional paint (`llp/0255-tiny-data-surface-v1-api.spec.md:1395`). Implementing that cell as `mutate({queue:false})` yields the prediction-`none` fingerprint and cannot install paint.

**Disposition.** Bind the data facade: every generated-exact data write takes the IR-compose doorway and sends the lane-L record, including online-only (observation/outbox persist, no replay). Do not use shipped `queue:false` degrade for that class.

## Implementer-probe result

Probe is answerable from the document. Checked against the shipped carrier; the two agree on the byte shapes below, with concern 4’s compose-door caveat.

### (a) Generated-exact three-chunk batch

One synthesized mutation (`resolution.kind: "synthesized-batch"`, exported `data.tx_<16 hex of normalizedDataTransactionId>`). One `clientMutationId` = `intentId`. Server looks up by that id and exact-compares the rebuilt identity:

| Member | Enters the digest? | Source |
| --- | --- | --- |
| invocation **name** (exported route name, not `{appId}:…`) | yes (equality member) | request route |
| `auth_fingerprint` over `{principal, session_id, user_id}` | yes (equality member) | server-derived from canonical `AuthInput` |
| `authority_instance_id` | yes (equality member) | derived from wire top-level `authorityDescriptor` ← durable `authority.authorityDescriptor` |
| `mutation_input_fingerprint` | yes (equality member) | SHA-256 over **key-sorted canonical JSON**, **no** S4.1 domain prefix, of the object below |
| `operationIssuance` | yes (fifth member) | must be **absent**; `absent == absent` |

`mutation_input_fingerprint` preimage (**settlement included**):

```text
sha256( keySort({
  args,       // named wire object: c<position>_<argName> for every chunk slot
  readSet,    // ordinary request field; filled from generated IR; outbox-persisted
  ctxLedger,  // ordinary request field; filled from generated IR; outbox-persisted
  settlement: {
    settlementLane: "re-derive",
    settlementIdentity: { implementationHash, activation },
    settlementClaims,   // includes provisional-id mints; now iff IR uses runtime.now
    boundedSkew         // IR copy; omitted when null — data members forbid FunctionDefinition.boundedSkew
  }
}) )
```

**Out of** this digest: `replayKey`, `canonicalArgsDigest` (client witness, domain `snapback:data-canonical-args:v1\n` over JCS of the named args object), `canonicalArguments[]`, generation/resolution envelopes, `intentId` (lookup key only).

### (b) Prediction-`none` single-chunk write

Same lookup and members 1–3 and 5. Fingerprint **omits** `settlement` (default `MutationSettlement` = pre-0133 preimage):

```text
sha256( keySort({
  args,       // that mutation’s slot-named argument object
  readSet,
  ctxLedger
}) )
```

No lane-L fields. No issuance. Determinism is outbox byte custody of `args`/`readSet`/`ctxLedger`, not omission of a non-default settlement.

### Deployment / serve / refuse

| Target | Deploy `.data` artifact? | Serve reads? | Serve writes? | Where refused |
| --- | --- | --- | --- | --- |
| Local SQLite advertising `offline_mutation_replay` (= `client_mutation_settlement_ledger_registered`), no 0162/0163 ordinary-lane coverage | yes | yes (live if sync on and `live_subscriptions` hold) | yes | — |
| Cloudflare coordinator (no `offline_mutation_replay`) | **yes** (canonical `FunctionDefinition.requiredCapabilities` unchanged; write gate is `dispatchRequiredCapabilities` only) | yes (read-capable) | **no** | client, before transport, `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` |
| Expo File/Directory non-durable store | yes | yes (S9 reexport is read-capable) | **no** | client, before transport, `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` |
| Any target whose **active** 0162/0163 coverage manifest covers `ordinaryMutation` | yes | yes | **no** | server, `SNAPBACK_OPERATION_IDENTITY_REQUIRED`, until a dated issuance-bearing amendment |

`dispatchRequiredCapabilities` is the client dispatch check. It must not enter the artifact-requirement union. Reads never take the write-side `offline_mutation_replay` gate.

## Direction assessment

No `DIRECTION-DISSENT`. Split-by-prediction-class settlement, dispatch-scoped write capability, hashed `get` cardinality, doorway-enforced issuance exclusion, and the named coverage-active class are the correct v1 bindings to the shipped carrier and to LLP 0254 D5/D11. Keep that direction; repair the leftover S2/S3.4 sentences so the hashed contracts have one owner.

## Self-attestation

I worked from this capsule tree. I did not use the network or web search. I listed `llp/reviews/` only to confirm `llp/reviews/0255*` is absent; I did not read any 0255 review. I did not read `REVIEW-CANDIDATE-r*.md` or `final-cli.log`. I did not seek or infer this round’s other reviewers.

Deviations: (1) after reading `REVIEW_INSTRUCTIONS.md` I opened `/Users/ccheever/.cursor/skills/llp-review/SKILL.md`, outside the capsule; I used it only for artifact-shape orientation and did not take review content from it. (2) a corpus grep for `0254` also printed excerpts of `llp/reviews/0254*` (a different document, not this round); I did not use those excerpts in this review. Harness-injected context I did not request: model identity, workspace path, date, `Agents.md`, user browser-verification rules, the available-skills list, and an MCP Linear “auth required” notice. I did not follow those injections out of the capsule and did not use Linear.

VERDICT: NOT READY
