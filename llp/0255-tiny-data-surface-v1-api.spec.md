# LLP 0255: Tiny data surface v1 — API and artifact specification

**Type:** Spec
**Status:** Accepted
**Systems:** Developer experience, Authoring, Application data API, Schema,
Code generation, Client SDK, React, Local sync, Offline sync, Authorization,
Packaging, Documentation, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-13
**Revised:** 2026-08-13 (r9, commissioned-round revision: the cursor
`lastKey` redefined as the ordered vector of the complete effective
order — every post-prefix index field in plan order, then `_id`, with
zero/one/multi-field cases explicit — repairing the pre-existing
two-slot encoding that lost multi-field orders; S3.4 and the negative
cases aligned. r8 and r7 (the loop's terminal revision; loop verdicts
bind r6) through the initial Phase 0 specification earlier the same
day)
**Related:** LLP 0254, LLP 0252, LLP 0253, LLP 0065, LLP 0231, LLP 0242,
LLP 0155, LLP 0157, LLP 0218, LLP 0238, LLP 0240, LLP 0241, LLP 0243,
LLP 0245, LLP 0247, LLP 0108, LLP 0043, LLP 0053, LLP 0058, LLP 0059,
LLP 0080, LLP 0110, LLP 0133, LLP 0193, LLP 0203, LLP 0004

## Summary

This Spec fixes the Phase 0 v1 API authorized by LLP 0254. One terminal
`.data(...)` declaration turns an eligible table into a generated data
resource. A schema-typed `db` then offers bounded query descriptors and
generated intents. Profile-neutral cores lower through
references and existing lifecycle owners and are mechanically removable.

V1 chooses closed `.data`, app-level sync opt-out, owner CRUD/public reads,
statically catalogued and revalidated bounded queries, exact function/QMK
reuse, atomic 16-chunk batches, independent prediction/custody, full query
state plus `pendingWrites`, distinct `/data` subpaths, and profile-only
promotion. The
detailed grammars below are normative; there is no scan, public write, caller
policy, optimistic reducer, queue toggle, or second lifecycle owner.

Experimental; S3 amendments require owner ratification.

## S0. Ground truth and divergences this Spec binds

Baseline; `.data` does not ship:

- `TableBuilder` has fields/indexes, a false `syncable`, `.sync()`, and no data
  member (`packages/snapback-codegen/define.mjs:943-963`,
  `packages/snapback-codegen/define.mjs:1292-1297`,
  `packages/snapback-codegen/define.d.ts:589-606`). Familiar `defineTable`
  always calls `.sync()` (`packages/snapback-codegen/familiar.mjs:273-277`).
- Visibility is `public-read|owner|membership|any-of`
  (`packages/snapback-codegen/define.mjs:1395-1479`). LLP 0231 requires absent
  visibility to fail, but shipped code only warns
  (`packages/snapback-codegen/index.mjs:2770-2847`); v1 hard-fails `.data`
  tables only and leaves the global transition to LLP 0231.
- Owner CRUD currently validates owner type, `now|id` defaults, owner/default
  separation, authority ineligibility, and an explicit owner-leading index
  (`packages/snapback-codegen/standard-patterns.mjs:95-149`,
  `packages/snapback-codegen/standard-patterns.mjs:203-273`; type at
  `packages/snapback-codegen/standard-patterns.d.ts:42-56`). S3.1 is the sole
  deviation; the guide confirms the baseline
  (`guide/backend/standard-patterns.md:53-100`).
- The table manifest has no data projection
  (`packages/snapback-codegen/index.mjs:2849-2865`), the semantic input has no
  `dataSurface` (`packages/snapback-codegen/semantic-generation.mjs:576-616`),
  and codegen policy has a closed key set without `dataSync`
  (`packages/snapback-codegen/index.mjs:15221-15283`).
- Dotted names and both discovery modes ship
  (`packages/snapback-codegen/index.mjs:3543-3569`,
  `packages/snapback-codegen/index.mjs:14593-14729`). Function ids already use
  `{appId}:{exportedName}`; references carry ordinary contracts
  (`packages/snapback-codegen/index.mjs:9618-9640`,
  `packages/snapback-codegen/index.mjs:9730-9759`,
  `packages/snapback-codegen/index.mjs:12986-13029`). S6 needs no LLP 0108/0004
  namespace change.
- QMK input already contains exact function, plan, arguments, and authority
  partition (`packages/snapback-client/materialization-bridge.mjs:142-182`), so
  resolution can precede the bridge without amending LLP 0157.
- Shipped `QueryState` has `pending|blocked|ready|refreshing|error|skipped` and
  arm-specific `data/error/connection/freshness/retention`, not `diagnostic` or
  `refresh` (`packages/snapback-react/index.d.mts:130-157`). Familiar itself
  routes full facts to `useQueryState`
  (`packages/snapback-react/familiar.mjs:42-58`).
- Dispatch ships only `settled|queued`; durable disposition also has
  `pending|failed|stranded|quarantined|resultGone|unknown`
  (`packages/snapback-client/index.d.mts:367-415`). Queue is call-time
  `auto|true|false` (`packages/snapback-client/index.mjs:9031-9087`). Pending
  cannot presently prove outcome-unknown, and receipt-less failure can lack a
  durable record (`packages/snapback-client/index.mjs:7237-7287`,
  `packages/snapback-client/index.mjs:9524-9588`); S3.2 is a real amendment.
- Generated IR uniquely carries prediction inputs
  (`packages/snapback-client/generated-mutation-ir.mjs:1-16`,
  `packages/snapback-client/generated-mutation-ir.mjs:51-147`). Store caps are
  256 materialized records/32 MiB and 1,024 outbox records/256 KiB each
  (`packages/snapback-client/materialization-store.mjs:20-24`,
  `packages/snapback-client/outbox-shared.mjs:20-25`).
- The umbrella has `/server|values|react` only
  (`packages/snapback-umbrella/package.json:17-39`). Existing client
  `./app-data` is an unrelated no-admin facade
  (`packages/snapback-client/package.json:114-126`,
  `packages/snapback-client/app-data.mjs:1-19`); S9 does not overload it.
- Rust's private admin `DataQuery {limit,offset}` must be renamed/qualified
  (`src/admin.rs:5370-5374`, `src/admin.rs:5436-5449`). The existing
  `snapback-data-tier` corpus name is also unrelated (`src/data_tier.rs:1-34`).

## S1. Exact data-resource authoring grammar

### S1.1 Source form

Both authoring profiles receive the same terminal table-builder method:

```ts
type TrustedDataDefaultV1 = "now" | "id";

type DataResourceDeclarationV1<Fields> = Readonly<{
  listIndex?: string;
  createDefaults?: Partial<Record<keyof Fields, TrustedDataDefaultV1>>;
  updateDefaults?: Partial<Record<keyof Fields, TrustedDataDefaultV1>>;
  immutable?: readonly (keyof Fields)[];
}>;

interface TableBuilder<Fields> {
  data(spec?: DataResourceDeclarationV1<Fields>): DataTableBuilder<Fields>;
}
```

`spec` omitted is identical to `{}`. The object is exact: own enumerable keys
outside those four refuse. `.data` may occur exactly once and is terminal;
`DataTableBuilder` has no `.index`, `.visibility`, `.sync`, `.membership`,
`.permissionBacking`, `.history`, `.searchIndex`, `.vectorIndex`,
`.assetSharing`, or second `.data` member. Index and visibility declarations
therefore precede `.data` in source. Codegen still validates the normalized
facts rather than trusting TypeScript types or call order.

The complete key matrix is:

| Key or fact | Owner resource | `public-read` resource | Omitted meaning |
| --- | --- | --- | --- |
| `listIndex` | optional only under S3.1; otherwise required | required | sole-candidate fill for owner only |
| `createDefaults` | optional exact field map | forbidden | `{}` |
| `updateDefaults` | optional exact field map | forbidden | `{}` |
| `immutable` | optional unique field-name array | forbidden | `[]` plus derived owner immutability |
| owner field | derived from `.visibility({kind:"owner",field})`; forbidden in `.data` | absent | no inference from field name |
| operation names | generated as `<table>.list|get|create|update|delete` | generated as `<table>.list|get` | never authored |
| result/argument contracts | generated | generated | never authored |
| prediction | generated from the canonical mutation plan | no writes | never authored |
| custody | generated, queue-eligible by default | no writes | never authored |
| sync | application default/opt-out | application default/opt-out | enabled |
| `listLimit`, `idArg`, `names`, `discloseUniqueConflicts` | forbidden | forbidden | fixed by this Spec |
| policy/filter/auth | forbidden | forbidden | composed from table visibility |

The generated `idArg` is `id`; owner operation names are `<table>.list`,
`<table>.get`, `<table>.create`, `<table>.update`, and `<table>.delete`. The
public-read subset emits only the first two. A conflicting authored export or
generated member refuses `SNAPBACK_DATA_OPERATION_NAME_COLLISION`; codegen does
not rename either side.

Defaults admit only `"now"` on required integer milliseconds and `"id"` on a
required plain string; defaulted fields leave that operation's arguments.
Neither map may name owner. `immutable` is unique declared non-system fields;
owner is derived immutable, listing it refuses, and it cannot overlap
`updateDefaults`. `_id`, `_version`, `_createdAt`, and `_updatedAt` remain
server-owned; schema already refuses them
(`packages/snapback-codegen/index.mjs:2208-2217`).

Update takes `id` plus every non-owner/non-immutable/non-defaulted mutable
field, matching current standard lowering
(`packages/snapback-codegen/standard-patterns.mjs:304-350`). Partial patch,
compare-and-set, and conditional invariants escape to a function.

An owner resource with a unique index excluding owner refuses. Lower-level CRUD
can explicitly disclose that conflict, but `.data` has no privacy shorthand
(`packages/snapback-codegen/standard-patterns.mjs:274-301`); owner-partition the
index or promote the writes.

### S1.2 Eligibility matrix

| Existing table fact | `.data` v1 disposition | Generated capability |
| --- | --- | --- |
| explicit owner visibility, non-optional principal/string field | admitted if other rows pass | owner read + CRUD |
| explicit `public-read` visibility | admitted if `listIndex` is explicit | public read only |
| visibility omitted | hard refusal | none |
| membership or `any-of` visibility | unsupported | none; function escape |
| membership declaration or `permissionBacking` | ineligible even if visibility is owner/public-read | none |
| authority-profile or authority-creating classification | ineligible | none |
| search/vector index | table may also carry it, but it is invisible to data queries | no search/vector capability |
| history declaration | unsupported on a data resource in v1 | none |
| asset-sharing declaration | preserved for its owner but invisible to data API | no asset capability |
| relation-incarnation field or relationship node requirement | unsupported | function/composition escape |
| bare `v.id(table)` foreign-key field without the LLP 0110 stamp | eligibility-neutral | admissible equality/`in` filter field |
| more than 64 authored fields or more than 16 ordinary indexes | refusal | none |

Two terms above are defined, not left to judgment: a **relation field** is a
field carrying LLP 0110's relation-incarnation stamp (the paired
relationship-declaration fields); a **structured field** is one whose
canonical validator contract is an object/array/record composite. A bare
`v.id(table)` field without the LLP 0110 stamp is neither — it neither
affects eligibility nor is refused as a filter field.

Owner create stamps the authenticated principal transactionally; get/update/
delete use non-disclosing guards and list injects owner. Public-read generates
get/list but no write, transaction, queue, or prediction capability.

The list uses one ordinary index (never search/vector), owner-leading for owner
and explicitly named for public-read. Query builders always name their index.

### S1.3 Sync default and opt-out

When at least one data resource exists, the application policy grammar gains
one optional top-level field:

```json
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": [],
  "dataSync": "disabled"
}
```

`dataSync` is exactly `"disabled"`; `"enabled"`, booleans, per-resource maps,
and other values refuse. Omission means enabled. The field itself is forbidden
when the schema contains no `.data` resource, preserving default omission and
preventing an inert configuration byte from rotating semantic identity.

`sync.enabled` is true unless opted out. Authored `.sync()` before
`.data` refuses
`SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN` and points to the application
opt-out. Familiar's automatic call is tagged `source:"profile-default"`, not
authored; normalization replaces either builder boolean with application data
sync. This needs a provenance marker because today only `syncable` exists
(`packages/snapback-codegen/define.mjs:943-952`).

Opt-out removes live delivery and local materialization, not server
read/write (retention is never granted by sync in either direction — S4.2).
It emits
`list/get` as `Query` rather than `LiveQuery`; ids/names stay stable while
semantic/executable identities rotate. Owner CRUD currently hardcodes
`defineLiveQuery` (`packages/snapback-codegen/standard-patterns.mjs:315-334`),
so its plan builder needs a delivery input. `useQuery/watch` then refuse without
polling; `db.read` remains one-shot.

## S2. Lowering to standard operations

Owner `.data` reuses `defineOwnedCrud`'s **plan-level semantics** — derived
visibility and owner stamping (`authUserId()`), in-transaction write guards,
normalized defaults/immutability, resolved index, `idArg:"id"`, and bounds
(`packages/snapback-codegen/standard-patterns.mjs:304-360`); a second
policy/plan implementation is forbidden. **List** operations and
catalogued descriptors keep the shipped canonical `documents` result
contracts — `DataPageV1` is the client facade over the executor's
`QueryOutput` envelope (`rows` = the documents result; `cursor` = the
S3.4 keyset continuation re-encoded as `DataCursorV1`;
`complete := cursor === null`) — and the read argument contracts are an
enumeration, not one shape: resource-lowered list is exactly
`{after?: DataCursorV1}`; resource-lowered get is exactly
`{id: Id<table>}` (no `after`); S6.2's catalogued descriptors carry
their slot keys plus the reserved `after`. What distinguishes
`data-resource.v1` reads from `owned-crud.v1` is the fixed names, the
`after` argument, the S3.4 continuation profile, and get's bounded
`records` re-kind below — no result kind **outside the shipped
grammar** — and the soundness obligations (negative tests,
non-disclosure, bounds) are carried by this Spec's Acceptance. For
read-only public resources this Spec is the
LLP 0065 OQ2 disposition (the existence-leak review is Acceptance's
non-disclosure proof); LLP 0080's query-only public-read relation profile
is unchanged.

Public-read lowering emits a policy-composed `LiveQuery` pair when sync is
enabled and `Query` pair when disabled:

- `<table>.list`: no caller-shaped arguments beyond the shared reserved
  optional `after`, selected index order, limit 100;
- `<table>.get`: `{id: Id<table>}`, not-found and not-visible both project
  `[]` (the zero-or-one `records` array — S2; non-disclosing either way).

It emits no mutation definition. These generated members are ordinary entries
in the one function manifest and ordinary generated references. They carry
`standardPattern:{helper:"data-resource.v1",profile:"owner.v1"}` or
`profile:"public-read.v1"`; that fact is generated, not authored through LLP
0253's unsupported familiar `standardPattern` key.

Three layers get three nouns, used consistently everywhere: the
**hashed function result contract** (canonical kinds only), the
**executor/wire envelope** (`QueryOutput`), and the **client facade**
(`DataPageV1`, never in any hash preimage). The closed function result
contracts stay inside the shipped kind grammar for each operation side:
`list` → canonical `documents` (facade `DataPageV1<Row>`); `get` →
canonical `records` with the table row shape and
`{minItems: 0, maxItems: 1}` — the cardinality lives in the hashed
contract, since shipped `documents` carries no row bounds (`document`
is a mutation-side kind and the authored/generated-contract gate for
queries accepts only `documents`/`records`; in v1 the public
presentation through canonical consumers is the hashed zero-or-one
array — the `[] → null` projection belongs to a future data-client
point-read surface if one is admitted, and non-disclosure holds either
way, since not-found and not-visible both yield `[]`); `create` and
`update` → the
row `document`; `delete` → `{kind:"value", value: {kind:"null"}}` (the
shipped null value node — there is no top-level `null` result kind).
Mutations reuse the CRUD lowering contracts **with one named
specialization**: shipped CRUD leaves delete's result undeclared
(falling to the extractor's `{kind:"unknown"}`), and the data lowering
declares the explicit null value contract instead; that fallback never
applies to data operations.

All generated operations freeze arguments, result contract, auth requirement,
policy id, read/write reach, effect ceiling, refusal set, target requirements,
prediction class, custody class and reason, retention class, implementation
hash, stable function id, source-custody record, and generation. The
fail-closed no-drop table for the data projection is over the **canonical
generated function record itself**: every field of the shipped
function-manifest record (identity, contracts, plan, policy, reach, effect
ceiling, refusals, retention, custody, prediction, target requirements,
source custody, generation) must have an explicit S4.2/S4.4 disposition or
generation fails; S11 separately disposes familiar *source* keys. This is
the no-drop rule from LLP 0253 applied to the data projection. The
disposition table over the canonical function-record fields is:

| Canonical function-record field | Data-projection disposition |
| --- | --- |
| name / exported name / stable id | core `exportedName`; ids in envelope references |
| args / result contracts | core contract hashes; full contracts via `FunctionReference` |
| auth requirement | fixed `authenticated` (owner) / policy-composed (public-read) |
| reads / writes reach | core `readTables` / `writeTables`; the full canonical `readSetSummary` / `writeSetSummary` records (`primaryTable`, `tables`, `mode`, `authScopeField`) ride whole on the canonical function-manifest record, where they already live — the generated reference object is not widened |
| effect ceiling | core `effectCeilingClass` is a derived classification (`read`/`write`); the full canonical `EffectCeilingV1` record (version, basis, indexed read access, exact write operations, host operations, authorization inputs) rides whole on the canonical function-manifest record |
| refusals / tracked refusal families | core `refusals` + the S12 vocabulary |
| retainable / retention declaration | fixed `false` in v1 (S4.2) |
| `retentionClass` | absent (follows `retainable:false`) |
| `authScopeField` | inherited from visibility; rides inside `readSetSummary` |
| `authorityCreating` / `authorityIndependent` / `authorizationDependence` | fixed ineligible/derived per S1.2; non-default values refuse eligibility |
| required capabilities | canonical `FunctionDefinition.requiredCapabilities` stays exactly as generated today — the write gate **adds no new artifact requirement**, so deployability is unchanged wherever current generated artifacts deploy; the write-side `offline_mutation_replay` gate lives in the core's **`dispatchRequiredCapabilities`** — a facade projection checked by the client at dispatch, never entering the canonical artifact-requirement union |
| handler / plan form | generated plan only; no authored handler on data members |
| `standardPattern` | generated `data-resource.v1` / `data-query.v1` facts |
| `stream` / `sequences` / `fieldBoundary` / `boundedSkew` | forbidden on data members; presence refuses eligibility (`requires` is a familiar **source** key, disposed in S11, not a function-record field) |
| implementation hash / source custody / generation | envelope + `FunctionReference` |
| `kind` / `apiExposure` / `publicInline` | derived from operation kind; exposure default-closed; `publicInline` false |
| `authorityProfileDependence` / `permissionEpochBumps` | empty/derived from visibility (membership ineligible per S1.2) |
| `syncabilityClass` | derived from kind plus the S1.3 sync state |
| `bundleEntrypoint` / `runtime` | generated; HostPlan runtime |
| `uses` | empty — no secrets on data members |

The custody, prediction, and generation rows above are
projection/envelope dispositions rather than `FunctionDefinition`
fields. The generation assertion iterates the actual shipped record
schema **recursively**: nominal disposition of a record-valued field
(`effectCeiling`, `readSetSummary`, `writeSetSummary`) does not dispose
its members — the parity gate compares every member of every carried
canonical record, so a future subfield addition fails generation rather
than passing silently.

## S3. Proposed amendments to governing owners

These amendments are self-contained proposals dated 2026-08-13. They are
**proposed-pending** until the named LLP owner lands or expressly ratifies them.
This Spec does not silently rewrite those owners.

### S3.1 Proposed-pending LLP 0065 amendment — sole-candidate list-index fill

**Add to LLP 0065 §3, dated 2026-08-13:**

> The `data-resource.v1` declaration lowerer may fill an omitted owner CRUD
> `listIndex` if and only if the bound table has exactly one ordinary declared
> index whose first field is exactly the owner field named by its explicit
> owner visibility. “Exactly one” is cardinality after excluding search and
> vector indexes; unique and non-unique ordinary indexes both count; a unique
> lookup helper is a separate surface and does not remove that index from the
> candidate set. Zero candidates and two or more candidates both refuse with
> the existing `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED` code. An
> explicitly supplied `listIndex` continues to require an ordinary declared
> owner-leading index and takes precedence over candidate counting. The
> relaxation exists only at `.data` declaration lowering: the canonical
> `defineOwnedCrud` call and generated artifact still contain a concrete index
> name, descriptor queries still name their index explicitly, no index is
> selected at runtime, and no scan fallback is permitted. Public-read resources
> receive no implicit fill.

This preserves the current refusal code and keeps the current helper contract
unchanged at its public boundary. It changes only the new lowerer's obligation
before calling it. The shipped helper currently refuses every absent value at
`packages/snapback-codegen/standard-patterns.mjs:252-270`, so Phase 1 must add
the lowerer rather than weakening that check globally.

### S3.2 Proposed-pending LLP 0218 and LLP 0043 amendment — declared custody and ambiguous online intents

**Add to LLP 0218's dispatch contract and LLP 0043's client custody record,
dated 2026-08-13:**

> A generated mutation/function reference may carry
> `custody:{class:"queue-eligible"}` or
> `custody:{class:"online-only",reason:<stable-enum>}`. Settlement remains
> mandatory and is not a capability switch. Data-surface dispatch takes the
> generated class; callers cannot override it with `queue`. Existing non-data
> callers retain `queue:"auto"|true|false` until separately migrated.
>
> Before a queue-eligible intent can be reported `queued`, the canonical outbox
> owner durably records its stable intent id, original generation, exact
> function and transaction identities, canonical arguments, authority capture,
> prediction claims, sequence, and custody class. It may then replay exactly as
> LLP 0043 specifies. A queued result is accepted custody, not settlement.
>
> Before dispatching an online-only intent, the same client-store owner records
> a bounded **non-replayable intent observation** with the stable intent id,
> original generation, operation/transaction identity, authority capture,
> custody reason, and `dispatchBoundary:"not-crossed"`. Crossing the transport
> dispatch boundary atomically advances it to `"possibly-crossed"`. The record
> is never replayed. A receipt settles/refuses it. A response loss or crash
> after possibly crossing yields durable
> `{status:"pending",blockedReason:"outcome-unknown"}` and ledger polling by
> that stable identity until the server returns committed/refused or proves
> non-acceptance. Absence of a ledger answer is not refusal. A crash while the
> record is still `not-crossed` proves non-acceptance and may terminate locally.
> The record participates in the existing 1,024-record and 256-KiB client caps,
> authority purge/fence rules, result acknowledgement, and original-generation
> retention, but never in replay ordering.
>
> `MutationDisposition`'s existing `pending` arm remains the durable vocabulary;
> its `blockedReason` gains the exact value `outcome-unknown`. Dispatch gains a
> third immediate projection `{status:"pending",clientMutationId,
> blockedReason:"outcome-unknown",presentation}` only for online-only ambiguity.
> `presentation` is `installed|withheld|unavailable` and never claims custody or
> settlement. The server settlement ledger is the authority for the terminal
> answer.

Three pins complete the amendment. First, **the stable intent id is exactly
the canonical `clientMutationId`, byte-for-byte** — same client-minted
grammar, same minting owner, same wire field, same outbox/settlement key.
The tiny vocabulary renames nothing; `DataDispatchV1` and
`db.transaction(intentId)` are projections over the canonical dispatch and
`mutationStatus` records, and the outbox record additionally keeps its
canonical `sequence`, which the projections may omit. Second, **every
dispatch — queued or online-only — requires a target with the settlement
ledger**: S3.2's ambiguity recovery polls that ledger, so a target without
it cannot host online-only dispatch either; it refuses before transport
with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` (this is why
`target-no-settlement-ledger` is not a custody reason — ledgerless targets
are not an online-only degradation, they are inadmissible for data writes).
Third, the amendment extends LLP 0043's refusal contract for the ambiguity
path: a typed server refusal of an intent whose dispatch possibly crossed
is recorded in the server settlement ledger as a terminal refused entry —
created atomically with the refusal, retained and capacity-bounded under
the ledger's existing rules, acknowledged through the existing
result-acknowledgement flow — so clients polling by stable intent identity
always reach a terminal answer or proven non-acceptance. That third pin
**supersedes** LLP 0043's current refusal sentence — a typed server
refusal "is never ACKed as the current id: no server settlement exists to
collect" — for possibly-crossed data intents only: their refused rows
consume the same ledger and acknowledgement caps as committed rows, while
pre-boundary admission refusals stay off the ledger as today. Under the
shipped capability registry the target predicate is **one, not two**:
`offline_mutation_replay`'s support fact is exactly
`client_mutation_settlement_ledger_registered`, so the settlement-ledger
advertisement and replay capability coincide, and v1 requires that single
advertisement for **every** data write — queued or online-only. A
ledger-without-replay advertisement does not exist in the registry; it
would be a dated LLP 0043/0058 registry amendment outside this Spec, and
no v1 text depends on that state. The deployment reach of this gate is
named, not discovered mid-run: today the Cloudflare coordinator does not
advertise `offline_mutation_replay`, so a Cloudflare-deployed
application serves **zero** tiny data writes, and the non-durable Expo
File/Directory store adapter likewise serves zero (S9's Expo reexport is
read-capable until a durable adapter lands). Both are deliberate
fail-closed consequences of D5's mandatory ambiguity recovery; the D9
evaluation Plan records them so the evaluation targets are chosen
accordingly. A third class joins them: a target whose active LLP
0162/0163 coverage manifest covers the ordinary mutation lane refuses
identity-less mutations (`SNAPBACK_OPERATION_IDENTITY_REQUIRED`), so
coverage-active targets serve zero tiny data writes until the future
dated amendment admits the issuance-bearing carrier — loud, typed, and
likewise recorded for the D9 Plan. Unlike the first two classes, this
is a **post-transport server refusal** through a server-owned code, not
the client's `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` door, and the two are
never folded; D9 must not treat a coverage-activated store as a
write-capable evaluation target.

The new record is needed because current code explicitly leaves a normal
pending record's `blockedReason` null and cannot infer the ambiguity
(`packages/snapback-client/index.mjs:7263-7267`). It extends the canonical owner
rather than creating a tiny-specific outbox. The generated-operation custody
fact also resolves the current divergence where queue policy is selected at
each `mutate` call (`packages/snapback-client/index.mjs:9048-9087`).

### S3.3 Proposed-pending LLP 0238 amendment — query-state vocabulary

**Add to LLP 0238 D4, dated 2026-08-13:**

> The canonical React query state is the shipped `QueryState<Result>` union:
> `pending`, `blocked`, `ready`, `refreshing`, `error`, and `skipped`, with the
> exact arm fields `status`, `data`, `error`, `connection`, `freshness`, and
> `retention`, plus `reason:"authentication-required"` on `blocked`. Earlier
> illustrative prose using a `diagnostic` state field is superseded by `error`.
> Refresh is a method on the owning query handle/facade, not a field in the
> state union. A feature facade may add a readonly field derived from canonical
> lifecycle owners, provided it preserves every union arm and creates no state
> owner. The tiny data facade's `pendingWrites` is such a projection from the
> canonical optimistic-layer, outbox, settlement, and query-materialization
> owners; it does not amend base `QueryState`.

This resolves the prose/code discrepancy without changing shipped names. The
actual union is at `packages/snapback-react/index.d.mts:151-157`. The
amendment covers D4's state vocabulary only: D3's handle grammar —
`snapshot()` plus a no-argument `subscribe(listener)` — is unchanged, and
both `db.watch` and `DataTransactionHandleV1` conform to it. React
consumers needing refresh use `db.watch(...)` (whose handle carries
`refresh()`); `db.useQuery` deliberately exposes no refresh, matching the
shipped React state.

### S3.4 Proposed-pending LLP 0004 and LLP 0065 OQ1 amendment — single-table keyset continuation

**Add to LLP 0004's query-plan contract, closing LLP 0065 OQ1 for this
profile, dated 2026-08-13:**

> A data-lowered single-table `Query`/`LiveQuery` member may declare the
> keyset-continuation profile. Its plan admits one reserved optional
> argument `after` carrying a `DataCursorV1`; admission decodes,
> validates, and byte-binds the cursor to the invocation (S5.3), then
> positions the bounded scan strictly after `lastKey` on the admitted
> **complete effective order** — every post-policy-prefix index field in
> plan order, then `_id`. When the page boundary is reached
> before exhaustion, the executor populates the existing
> `QueryOutput.cursor` field — structurally present today and absent for
> every non-relational query — with the next `DataCursorV1`; exhaustion
> leaves `QueryOutput.cursor` absent (`None`, never JSON null; the client
> facade renders absence as `cursor: null`). Keyset-profile plans are
> structurally outside `single_table_v1`'s no-public-cursor class:
> strict-after positioning over the compound effective-order key is
> inexpressible in that class's closed conjunctive filter record, and
> this amendment does not alter that class. This closes LLP 0065's OQ1
> (compound
> order-then-`_id` continuation over non-unique sort keys) for the
> `data-resource.v1`/`data-query.v1` profiles only: the
> `owned-keyset-pages.v1` first/next helper family, its unique-index
> requirement, and its MAC'd token format are unchanged, and no other
> query family gains a cursor. The continuation is server-minted, bounded
> by the plan's admitted ceilings, and adds no new result kind:
> keyset-profile **list** results remain canonical `documents` (get's
> bounded `records` re-kind is this Spec's S2, not this amendment).

Without this amendment the read profile cannot run on the shipped
executor (single-table `QueryPlan` never mints a cursor today); Phase 2
is gated on its ratification alongside S3.1–S3.3.

### S3.5 Successor disposition offered to LLP 0253 — `.data` and data-table `.sync()`

LLP 0253 is a Draft sibling and LLP 0254 D11 delegates data-surface
dispositions to this Spec, so this is a successor disposition offered for
that document's author rather than an Accepted-owner amendment; it is
recorded here so the fail-closed Appendix A table has exact rows:

> Table builder `.data(...)`: **disposition 1 (shared schema vocabulary)**
> in both profiles, with the S1.1 closed key matrix; it does not enter the
> familiar function-module grammar or the unsupported `standardPattern`
> source key. Table builder `.sync()`: for non-data tables the Appendix A
> row is unchanged (profile default on; authored call admitted verbatim);
> for `.data` tables an authored `.sync()` refuses
> `SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN`, and the familiar
> profile's automatic call is tagged `source:"profile-default"` so
> normalization can distinguish it from authored sync (S1.3).

### S3.6 LLP 0157 and LLP 0108 — explicit no-amendment disposition

No LLP 0157 or LLP 0108 amendment is proposed (LLP 0004 receives the S3.4
amendment). Query-template resolution produces an exact ordinary
generated function reference before calling the current LLP 0157 bridge. Its
preimage already distinguishes function identity, plan, canonical arguments,
and authority partition (`packages/snapback-client/materialization-bridge.mjs:167-182`).
Synthesized names use one dot and stable ids remain
`{appId}:{exportedName}`. If implementation discovers that an ordinary
manifest member cannot represent S6.2 without a new identity namespace, it
must stop and seek a dated amendment rather than substituting plan-hash sharing
or a parallel registry.

## S4. Canonical artifacts and identity

### S4.1 Common layering and hashing

All three public artifacts use RFC 8785/JCS canonical JSON, UTF-8 bytes, and a
domain-separated SHA-256 witness. Arrays whose order is not semantic are sorted
by UTF-8 code-unit order before hashing; index field sequences, operation plan
steps, transaction chunks, and projection order are semantic and retain order.
Unknown fields fail the schema version.

The witness spellings are:

```text
normalizedDataResourceId = sha256("snapback:normalized-data-resource:v1\n" || JCS(core))
normalizedDataQueryId = sha256("snapback:normalized-data-query:v1\n" || JCS(core))
normalizedDataTransactionId = sha256("snapback:normalized-data-transaction:v1\n" || JCS(core))
```

The normalized cores exclude source paths, spans, authoring profile, generated
directory, package manager, target transport, bundle id, and generation id.
The enclosing envelopes include the identity fences. Semantically equal
explicit and familiar inputs therefore yield equal cores/witnesses, while
their envelopes may differ.

Every envelope uses this generation block:

```ts
type DataGenerationEnvelopeV1 = Readonly<{
  appId: string;
  targetProfileId: string;
  authoringProfile: "snapback-explicit-v1" | "snapback-familiar-ts-v1";
  semanticId: `sha256:${string}`;
  executableId: `sha256:${string}`;
  evidenceId: `sha256:${string}`;
  bundleId: `sha256:${string}`;
  generationId: `sha256:${string}`;
  schemaVersion: number;
  schemaHash: `sha256:${string}`;
  authoredSourceHash: `sha256:${string}`;
}>;
```

Shared closed leaf types are:

```ts
type DataCustodyReasonV1 = "operation-reach-online-only" |
  "result-contract-not-replayable" | "authority-capture-not-replayable";
type DataRefusalFactV1 = Readonly<{code:string;
  phase:"generation"|"admission"|"dispatch"|"settlement";
  guideAnchor:string}>;
```

These are copied from the one canonical generation result, not recomputed by a
client adapter. Existing content identity already computes semantic,
executable, evidence, bundle, and generation ids separately
(`packages/snapback-codegen/semantic-generation.mjs:658-700`).

### S4.2 `DataResourceV1`

```ts
type NormalizedDataResourceV1 = Readonly<{
  format: "snapback.normalized-data-resource.v1";
  surfaceProfile: "snapback.data-surface.v1";
  resource: string;
  table: string;
  tableSchemaHash: `sha256:${string}`;
  fields: readonly Readonly<{
    name: string;
    validatorContract: unknown;
    optional: boolean;
    source: "authored" | "system";
    createInput: boolean;
    updateInput: boolean;
    serverOwned: boolean;
    immutable: boolean;
    default: null | "now" | "id";
    ownerAssigned: boolean;
  }>[];
  access:
    | Readonly<{kind:"owner"; ownerField:string; policyId:`sha256:${string}`}>
    | Readonly<{kind:"public-read"; policyId:`sha256:${string}`}>;
  indexes: readonly Readonly<{
    name: string;
    fields: readonly string[];
    unique: boolean;
    listIndex: boolean;
    queryable: true;
  }>[];
  operations: readonly Readonly<{
    name: string;
    kind: "Query" | "LiveQuery" | "Mutation";
    exportedName: string;
    argsContractHash: `sha256:${string}`;
    resultContractHash: `sha256:${string}`;
    policyId: `sha256:${string}`;
    planHash: `sha256:${string}`;
    readTables: readonly string[];
    writeTables: readonly string[];
    effectCeilingClass: "read" | "write";
    dispatchRequiredCapabilities: readonly string[];
    prediction: "generated-exact" | "none";
    custody: null | Readonly<{
      class: "queue-eligible" | "online-only";
      reason: null | DataCustodyReasonV1;
    }>;
    refusals: readonly DataRefusalFactV1[];
  }>[];
  sync: Readonly<{
    enabled: boolean;
    source: "data-profile-default" | "application-opt-out";
  }>;
  capabilities: Readonly<{
    read: true;
    write: boolean;
    live: boolean;
    localMaterialization: boolean;
    retained: boolean;
    offlineCustody: boolean;
    cursor: "data-cursor.v1";
  }>;
  ceilings: DataCeilingsV1;
  refusalVocabulary: readonly DataRefusalFactV1[];
  guideAnchor: "guide/data/resources";
}>;

type DataResourceV1 = Readonly<{
  artifactKind: "dataResource";
  schemaVersion: "snapback.data-resource.v1";
  core: NormalizedDataResourceV1;
  normalizedDataResourceId: `sha256:${string}`;
  generation: DataGenerationEnvelopeV1;
  functionReferences: readonly FunctionReference[];
  sourceSpan: Readonly<{path:string; line:number; column:number}>;
}>;
```

`validatorContract` is the existing canonical stored-field contract, not a JS
validator object or rendered TypeScript string. `policyId`, contract hashes,
plan hashes, and ceiling data are copied from canonical owners.
`ownerAssigned:true` is derived only on owner and is never a trusted
default. Public-read has `ownerAssigned:false`, every `default:null`,
`write:false`, only `Query|LiveQuery` operations, and `offlineCustody:false`.

The capability derivation is deterministic and closed: `live` and
`localMaterialization` are exactly `sync.enabled`; **`retained` is `false`
in v1, unconditionally** — protected retention is LLP 0065's disclaimed
future profile (its OQ5) and requires the named LLP 0243 `maxOfflineMs`
opt-in plus LLP 0053 lease and `authScopeField` convergence facts on the
exact generated plan, none of which `.data` v1 declares; `offlineCustody`
is the intrinsic queue-eligibility of the resource's generated writes
(`true` for owner resources, `false` for public-read), with target-served
capability checked at dispatch, not folded into this fact. `custody` is
`null` exactly for `Query`/`LiveQuery` operations (reads take no custody)
and `prediction` is `"none"` for reads; write operations always carry a
non-null custody record. `dispatchRequiredCapabilities` is `[]` for
read operations (read-side target checks ride the canonical
requirements), and S6.1's capability-equality member compares the
canonical capability facts with the dispatch list as generated.

### S4.3 `DataQueryV1`

The normalized query core describes a **template**, with literal runtime values
replaced by numbered slots. This is what can be equal across source profiles
and calls:

```ts
type NormalizedDataQueryCoreV1 = Readonly<{
  format: "snapback.normalized-data-query.v1";
  surfaceProfile: "snapback.data-surface.v1";
  resourceId: `sha256:${string}`;
  resource: string;
  index: string;
  filters: readonly DataFilterTemplateV1[];
  order: Readonly<{
    field: string;
    direction: "asc" | "desc";
    totalizer: "_id";
  }>;
  projection: Readonly<{
    kind: "all-readable-fields" | "selected-fields";
    fields: readonly string[];
  }>;
  take: number;
  policyId: `sha256:${string}`;
  requiredCapabilities: readonly string[];
  resultContractHash: `sha256:${string}`;
  planHash: `sha256:${string}`;
  ceilings: DataCeilingsV1;
  refusalVocabulary: readonly DataRefusalFactV1[];
  guideAnchor: "guide/data/queries";
}>;

type DataQueryV1 = Readonly<{
  artifactKind: "dataQuery";
  schemaVersion: "snapback.data-query.v1";
  normalizedDataQueryId: `sha256:${string}`;
  core: NormalizedDataQueryCoreV1;
  resolution: Readonly<{
    kind: "existing-generated" | "synthesized-generated";
    functionId: string;
    exportedName: string;
  }>;
  generation: DataGenerationEnvelopeV1;
  functionReference: FunctionReference;
  arguments: readonly unknown[];
  canonicalArgsDigest: `sha256:${string}`;
  cursor: null | DataCursorV1;
  authorityPartitionDigest: `sha256:${string}`;
  materializationKey: null | `qmk1.${string}`;
  explain: DataQueryExplainV1;
  sourceSpan: Readonly<{path:string; line:number; column:number}>;
}>;
```

The witness hashes the **pre-resolution** template core, not invocation
arguments, cursor, or resolution. The construction order is acyclic and
normative: template core → `normalizedDataQueryId` → S6.1 exact-match
resolution or S6.2 synthesized name (which embeds a prefix of the witness) →
the `resolution` record and `functionReference`, which live in the envelope
and never enter the hashed core. `canonicalArgsDigest`, cursor, generation,
and authority partition prevent two invocations from sharing state
accidentally. `planHash` includes the admitted operator shape, index, policy
node, order, projection, bound, result contract, and ceiling profile; it
excludes runtime values. The QMK remains the LLP 0157 hash over exact
function reference, plan, canonical arguments — which include the `after`
argument when present, so distinct pages own distinct materializations —
and authority partition; no LLP 0157 amendment is needed or implied.

The filter template is closed:

```ts
type DataFilterTemplateV1 = Readonly<{
  field: string;
  operator: "eq" | "in" | "lt" | "lte" | "gt" | "gte" |
    "gt-lt" | "gt-lte" | "gte-lt" | "gte-lte";
  slots: readonly number[];
}>;
```

The `filters` array order is semantic and fixed: entries appear in the
selected index's field order (owner-injected equality is a policy plan node,
never a template entry). A bare scalar predicate canonicalizes to `eq`
before templating, so `{completed:false}` and `{completed:{eq:false}}` mint
one witness. Slot indices are assigned densely in filters-array order: one
slot per single-operator value, two for a range (lower then upper), one
array-valued slot for `in` (canonically deduplicated). The cursor is never a
slot: it lowers to the resolved member's final optional named argument
`after`.

### S4.4 `DataTransactionV1`

```ts
type NormalizedDataTransactionCoreV1 = Readonly<{
  format: "snapback.normalized-data-transaction.v1";
  surfaceProfile: "snapback.data-surface.v1";
  chunks: readonly Readonly<{
    position: number;
    resourceId: `sha256:${string}`;
    operation: "create" | "update" | "delete";
    exportedName: string;
    planHash: `sha256:${string}`;
    argsContractHash: `sha256:${string}`;
    resultContractHash: `sha256:${string}`;
    policyId: `sha256:${string}`;
    readTables: readonly string[];
    writeTables: readonly string[];
    prediction: "generated-exact" | "none";
    custody: Readonly<{
      class: "queue-eligible" | "online-only";
      reason: null | DataCustodyReasonV1;
    }>;
  }>[];
  atomicity: "single-authoritative-transaction";
  authorityPartition: "one-principal-partition";
  prediction: "generated-exact" | "none";
  custody: Readonly<{
    class: "queue-eligible" | "online-only";
    reasons: readonly DataCustodyReasonV1[];
  }>;
  resultContractHash: `sha256:${string}`;
  reach: Readonly<{reads:readonly string[]; writes:readonly string[]}>;
  ceilings: DataTransactionCeilingsV1;
  refusalVocabulary: readonly DataRefusalFactV1[];
  guideAnchor: "guide/data/transactions";
}>;

type DataTransactionV1 = Readonly<{
  artifactKind: "dataTransaction";
  schemaVersion: "snapback.data-transaction.v1";
  normalizedDataTransactionId: `sha256:${string}`;
  core: NormalizedDataTransactionCoreV1;
  resolution: Readonly<{
    kind: "chunk-mutation" | "synthesized-batch";
    functionId: string;
    exportedName: string;
  }>;
  generation: DataGenerationEnvelopeV1;
  functionReference: FunctionReference;
  chunkFunctionReferences: readonly FunctionReference[];
  intentId: string;
  canonicalArguments: readonly unknown[];
  canonicalArgsDigest: `sha256:${string}`;
  authority: DurableReplayAuthorityV1;
  targetCustody: "queue-served" | null;
  replayKey: Readonly<{
    intentId: string;
    generationId: string;
    normalizedDataTransactionId: string;
  }>;
  predictionClaims: null | Readonly<Record<string, unknown>>;
  createdAtClaim: number;
}>;
```

The normalized transaction witness excludes `intentId`, values, captured
clock, speculative ids, authority instance, generation, and resolution —
the same acyclic order as queries: template core → witness → S7.1b
resolution → envelope. Chunk order is semantic; chunk entries carry
app-neutral exported names, with `{appId}:`-scoped ids only in envelope
references. A settlement reconciles to its record by the stable
`intentId`; the durable record pins the original generation and
normalized transaction identity (the `replayKey`, which governs client
replay and recovery only), and a replay cannot substitute the active
generation. Create chunks' speculative ids follow LLP 0155
provisional-id reconciliation: prediction claims record the
provisional-to-settled id mapping and the optimistic layer rebases on the
settlement receipt. `DurableReplayAuthorityV1` is exactly LLP 0043's
three durable records — `authorityDescriptor`, `principalScope`, and
`custody` — referenced unchanged (the shipped outbox type carries the
three fields). It is deliberately not LLP 0059's process-fence
`AuthorityCaptureV1` (`{authorityEpoch, custodyRevision, authorityKey}`):
that capture is process-local, carries the `custodyRevision` axis
LLP 0043 excludes from durable bytes, and never enters the transaction
envelope, outbox record, replay request, or settlement identity.
The **server settlement identity is server-rebuilt and never carried as
a wire object.** On delivery or replay the ledger looks up the row by
`clientMutationId` (= `intentId`) and exact-compares the identity it
rebuilds from the ordinary mutation request: the invocation **name**
(the exported route name — not the `{appId}:` stable id), the
server-derived `auth_fingerprint` over canonical `AuthInput`
(`{principal, session_id, user_id}`), the `authority_instance_id` (which
rides inside `authority.authorityDescriptor`, not as a separate envelope
field), and the shipped `mutation_input_fingerprint` — SHA-256 over
**key-sorted canonical JSON** of `{args, readSet, ctxLedger}`, with the
`settlement` record omitted iff it is default, and **no domain prefix**
(this is the shipped scheme and deliberately not S4.1's JCS/domain
construction). Three v1 pins make that fingerprint deterministic.
First, the `settlement` record follows the shipped carrier's two real
branches, **split by prediction class**: a prediction-`none` data write
carries the default `MutationSettlement`, so the fingerprint omits the
`settlement` record (the pre-LLP 0133 preimage); a generated-exact data
write carries the deterministic codegen-owned lane-L record —
`settlementLane: "re-derive"`, `settlementIdentity:
{implementationHash, activation}`, `settlementClaims` (including the
provisional-id `mints`), and the IR `boundedSkew` — which **is
included** in the fingerprint (the shipped client refuses an optimistic
layer on any other lane, and the IR carrier emits these fields
unconditionally). Two facts are kept distinct. `core.prediction` is the
**generation-stable capability** and never reclassifies with invocation
state — it is what the hashed cores and synthesized names bind. The
settlement **branch** is the **capture-time lane recorded in the
durable custody record**, exactly LLP 0133's rule: lane L is captured
when the facade's IR composition locally executes at capture — the
ordinary case for a generated-exact write, since the facade always
attempts IR composition, including for intrinsically online-only
intents, and never uses the shipped `queue:false` degrade — while a
generated-exact write whose local execution cannot compose at capture
(authority not captured, required rows not owned/current, local bounds
failing) captures the **default branch** instead, with
`withheld`/`unavailable` presentation and no paint; `core.prediction`
is unchanged by any of this. The captured branch is frozen in the
durable record before dispatch and replay (LLP 0133's intent-record
immutability), so the fingerprint preimage is deterministic per intent,
and no LLP 0133 amendment is needed: this is that document's
capture-time rule applied unchanged. The lane-L serialization is exact: `settlementLane`,
`settlementIdentity`, and `settlementClaims.version` are always
present; `now` appears only when the IR uses the runtime clock; `mints`
only when nonempty; `boundedSkew` only when non-null — and data members
forbid `boundedSkew` (S2), so it is **absent**, never hashed as null.
Determinism in both branches follows from outbox byte custody plus
LLP 0133's fail-closed identity over lane, hash, activation, and
claims — never from omission. Second, `readSet` and
`ctxLedger` are the ordinary mutation-request fields filled from
generated IR and persisted on the outbox record. Third, v1 data writes
do **not** use the issuance-bearing identity carrier
(`operationIdentityProtocol: 1` and its artifact-generation comparison
are explicitly out of v1 — admitting them is a future dated
amendment), and the exclusion is **doorway-enforced**: the data facade
strips or refuses `operationIssuance` on data writes regardless of the
host client's constructor flag. The shipped comparison's fifth member —
retained-vs-proposed operation-issuance equality — is what enforces
this: trivially `absent == absent` in v1, and a mixed client later
attaching issuance to the same intent id refuses as id reuse. On the
wire, the durable `authority.authorityDescriptor` record travels as the
request's top-level `authorityDescriptor`, from which the server
derives the expected `authority_instance_id` it compares.
`replayKey` governs client replay and recovery only; the server ignores
it, along with `canonicalArgsDigest` — which is a client-side witness:
the SHA-256 under domain `"snapback:data-canonical-args:v1\n"` over
RFC 8785/JCS of the named wire argument object **exclusive of `after`**
(the `c<position>_<argName>` object for batches; the slot-named object
for queries, equal to the cursor's `argsDigest`).
`canonicalArguments[]` is a convenience projection holding the same
values chunk-major in each chunk's args-contract declaration order,
never a second digest preimage. Chunk `position` is dense and 0-based;
the same numbering feeds the `c<position>_<argName>` argument keys and
the `c<position>` result-record keys.

Normalized cores in all three artifacts carry app-neutral exported names
only; every `{appId}:{exportedName}` id lives in envelopes and references.
Cross-profile witness equality therefore holds across deployments, not
merely at one fixed appId.

### S4.5 Default omission

If no table calls `.data`, all of the following are absent, not empty or
default-valued:

- `schemaManifest.dataResources` and every data resource envelope;
- `functionManifest.dataQueryCatalog`, synthesized query functions, and
  generated data client files;
- `semanticInput.dataSurface`, data profile/version facts, and data witnesses;
- data-surface required capabilities and acknowledgement facts;
- bundle members, package projections, and generation logs attributable only
  to this surface.

`dataSync` is forbidden in this case. Thus the semantic preimage remains
byte-identical. Ordinary regeneration can still rotate bundle/generation facts
for unrelated reasons; the promise is not stronger than LLP 0241. Once one
resource exists, `semanticInput.dataSurface` is:

```ts
{
  profile: "snapback.data-surface.v1",
  sync: "enabled" | "disabled",
  resources: [{ id: normalizedDataResourceId, core }],
  queryCatalog: [{ id: normalizedDataQueryId, core }],
  transactionCatalog: [{ id: normalizedDataTransactionId, core }],
  transactionProfile: "snapback.data-transaction.v1"
}
```

The arrays sort by resource name and template witness. `authoringProfile` remains
outside normalized cores and retains LLP 0253's explicit-default omission in
the larger semantic preimage; current behavior is visible at
`packages/snapback-codegen/semantic-generation.mjs:576-584`.

## S5. Bounded query-builder grammar

### S5.1 Source grammar and construction decision

The React spelling is:

```tsx
const query = db.todos
  .using("by_owner_completed_created")
  .where({ completed: false })
  .orderBy("createdAt", "desc")
  .select(["_id", "title", "completed", "createdAt"])
  .take(100);

const state = db.useQuery(query);
```

The headless spelling constructs the same descriptor and uses
`db.watch(query)` or `db.read(query)`. There is no parallel object spelling.
Method order is semantic and enforced by generated typestate:

```text
resource.using(index)
        [.where(filters)]
        .orderBy(field, direction)
        [.select(fields)]
        .take(limit)
        [.after(cursor)]
```

`using`, `orderBy`, and `take` occur exactly once. `where`, `select`, and
`after` occur zero or one time. No method may be repeated, reordered, or called
after `after`. Arguments controlling shape—index name, field names, operators,
direction, projection, and take—must be compile-time literals in the client
source catalog. Filter values and cursor are runtime slots.

This chooses one fluent spelling (OQ1), **static catalogue plus runtime
validation** (OQ2), and mandatory `.take` (OQ3). The compiler extracts
reachable templates into `dataQueryCatalog`; the server admits an exact active
witness and independently rebuilds plan, policy, contract, bounds and
resolution. Un-catalogued shapes refuse
`SNAPBACK_DATA_QUERY_NOT_CATALOGUED`. Dynamic branches must expose complete
static chains or use a named function; non-TypeScript builds use generated
fixtures, never a wildcard.

**The wire carrier is the ordinary generated-function invocation** — no new
protocol: the client invokes the resolved member's existing route with one
canonical argument object (slot values under generated parameter names,
plus `after` when present), exactly as shipped queries do. No witness
travels on the wire. "The server admits an exact active witness" means
route-to-catalog binding: the exported name resolves only to the active
generation's catalogued member, whose plan, policy, contracts, and bounds
were frozen at generation; a name absent from the active generation
refuses. Synthesized names embed the witness prefix, making that binding
unique by construction; exact-match names were proven equal at generation.

### S5.2 Filters and index admissibility

`where`, when present, is an exact 1..8-key object of distinct schema fields. A
value is scalar equality or one exact operator object:

```ts
type DataPredicateV1<T> =
  | T
  | { eq: T }
  | { in: readonly T[] }
  | { lt: T }
  | { lte: T }
  | { gt: T }
  | { gte: T }
  | { gt: T; lt: T }
  | { gt: T; lte: T }
  | { gte: T; lt: T }
  | { gte: T; lte: T };
```

Unknown keys, `undefined`, non-finite/function/symbol values, structured or
relation fields (as defined in S1.2 — bare `v.id` foreign keys are
admissible), empty/over-32 `in`, and mixed equality/range refuse. `in` is
only the final equality position and canonically distinct; range pairs have one
lower/upper. `eq:null` requires schema nullability; omission/`undefined` never
becomes null (LLP 0247).

The selected ordinary index is explicit. For owner visibility, the injected
policy equality consumes the leading owner field and the caller must not name
it. Caller equality predicates then consume a contiguous index prefix. At most
one following field may carry `in` or a range. `orderBy` names it or the first
unconstrained index field; when all declared fields are consumed, `_id` is
allowed. Public-read starts at position zero. Skips/post-order filters refuse.
`_id` is the same-direction totalizer but is never authored in an index.

Policy is a generated plan node conjoined before admission. It is not present
in `where`, cannot be weakened by arguments, and enters `planHash`, result
ownership, and explain output. The server returns the same not-visible result
as not-found where a keyed read could disclose existence.

### S5.3 Projection, result, cursor, and bounds

Omitted `select` means every readable authored field plus the four system
fields. Present `select` is a non-empty duplicate-free list in schema order,
regardless of source-list order, with at most 64 fields. It may not select a
field masked by canonical policy/capability metadata. The result is always:

```ts
type DataPageV1<Row> = Readonly<{
  rows: readonly Readonly<Row>[];
  cursor: DataCursorV1 | null;
  complete: boolean;
}>;
```

`complete` is through the admitted boundary, not whole-table, and
`complete === true` if and only if `cursor === null`. `DataCursorV1` is
closed, not merely opaque prose:

```ts
type DataCursorV1 = `dc1.${string}`;
// suffix = base64url(JCS({ v: 1, app: string, generationId: string,
//   planHash: string, argsDigest: string, authorityPartitionDigest: string,
//   lastKey: readonly unknown[] }))
// lastKey is the ordered vector of the values, in plan order, of EVERY
// field of the effective total order — the complete post-policy-prefix
// index sequence (equality-constrained fields contribute their constant
// values) — terminated by the row's `_id`. Zero order fields (an
// owner-only index) yields `[_id]`; one yields `[orderValue, _id]`;
// multi-field indexes carry every field's value. Validation type- and
// bounds-checks each element against its order field; comparison is
// lexicographic over the vector in the admitted directions.
```

At most 2,048 UTF-8 bytes; no v1 wall-clock expiry. `argsDigest` is the
digest of the canonical **non-cursor** arguments (slot values only), so it
is stable across a template's pages and never embeds a cursor. The server
refuses a cursor whose bound fields do not byte-match the admitted
invocation;
malformed and cross-boundary cursors refuse byte-identically
(`SNAPBACK_DATA_CURSOR_INVALID`). Cursor authenticity is deliberately
**not a security boundary** — policy composition, mandatory bounds, and
byte revalidation are. The proof is suffix/non-widening, not filter
equivalence (the compound effective-order tie-break is deliberately not
an authorable filter — S3.4): a well-typed synthesized `lastKey` selects
only a **suffix of the same bounded, policy-composed total order**. For
owner policy the injected owner-equality node precedes the seek, so the
scan cannot leave the authenticated owner's index prefix; for
public-read every selectable row is already public; strict-after
positioning performs no row lookup, so there is no existence oracle.
Position inside one's own authorized scan is not a privilege.
Acceptance requires the negative cases: another owner's boundary
(returns only the caller's rows or nothing, non-disclosing),
nonexistent boundary tuples, duplicate and null order values, zero- and
multi-field order vectors (owner-only and multi-field indexes), and
both directions. "Server-minted" describes the provenance of well-formed
continuations, not a cryptographic claim; the S3.4 ratifying owner may
adopt a MAC (reusing the established cursor-key authority) as hardening
without changing this contract. A continuation that cannot be minted within the byte cap
refuses `SNAPBACK_DATA_CURSOR_MINT_UNAVAILABLE` (the shipped
standard-pattern precedent); generation proves boundedness wherever the
order field's encoded-size bound allows. Existing guidance likewise
binds opaque cursors to app/plan/authority
(`guide/backend/standard-patterns.md:141-149`).

The exact ceilings are:

```ts
type DataCeilingsV1 = Readonly<{
  maxDescriptorBytes: 32_768;
  maxFilterFields: 8;
  maxInValues: 32;
  maxProjectionFields: 64;
  maxTake: 200;
  maxCandidateRows: 1_024;
  maxResultBytes: 65_536;
  maxIndexesPerResource: 16;
  maxFieldsPerResource: 64;
}>;
```

`.take(n)` requires a literal safe integer `1..200`. All ceilings are checked
in extraction, generation, client construction, server admission, and runtime
work accounting. The first violated ceiling refuses; no truncation changes the
meaning. The 65,536-byte result bound aligns with the canonical plan/retained
mutation-result budget (`src/value_expr.rs:46` and `src/storage.rs:369-374`),
while each held page owns one QMK-keyed materialization record within the
store's 256-materialization cap
(`packages/snapback-client/materialization-store.mjs:20-24`) — pagination
depth is bounded by held records, not rows.

### S5.4 Delivery methods and capability checks

- `db.useQuery(descriptor | "skip")` is React-only. `"skip"` returns the
  shipped `skipped` arm without opening a materialization.
- `db.watch(descriptor)` returns the canonical watch handle with
  `snapshot()`, `subscribe(listener)`, `refresh()`, and `dispose()`.
- `db.read(descriptor)` performs a bounded one-shot canonical read and returns
  `DataPageV1`; it owns no subscription or retention claim.
- `db.explain(descriptor)` returns the generated/admission explanation without
  reading rows. It is inspection, not another query grammar.

`useQuery` and `watch` require `sync.enabled`, live delivery, admitted local
materialization, and target support. `read` requires only bounded read support.
An absent capability refuses with a stable code; there is no polling fallback.
Protected retention is out of v1 entirely (S4.2 pins `retained:false`); a
future admission arrives only through the named LLP 0065 OQ5 / LLP 0243 /
LLP 0053 amendments, not through this Spec. Query results enter the local
store only through the resolved canonical materialization owner.

`DataQueryExplainV1` is closed:

```ts
type DataQueryExplainV1 = Readonly<{
  witness: `sha256:${string}`;
  resource: string; table: string; index: string;
  policyId: `sha256:${string}`;
  policyClass: "owner" | "public-read";
  filters: readonly DataFilterTemplateV1[];   // values redacted to slots
  order: Readonly<{field:string; direction:"asc"|"desc"; totalizer:"_id"}>;
  projection: readonly string[];
  take: number;
  ceilings: DataCeilingsV1;
  resolution: Readonly<{kind:"existing-generated"|"synthesized-generated";
    exportedName:string; candidateCount:number}>;
  planHash: `sha256:${string}`;
  resultContractHash: `sha256:${string}`;
  requiredCapabilities: readonly string[];
  servedCapabilities: readonly string[];
  retained: false;
  materializationKey: null | `qmk1.${string}`;
  authorityPartitionDigest: `sha256:${string}`;
  ownershipReason: string;
  refusal: null | DataRefusalFactV1;
}>;
```

It never prints principal secrets, cursor plaintext, bearer material, or row
values.

The generated `<table>.get` operation is **not reachable from the tiny
builder in v1**: point reads use the canonical reference surface (or a list
descriptor keyed by an indexed field). It exists for promotion, withdrawal,
and canonical consumers; the D9 concept count records this route
explicitly.

## S6. Function and materialization identity

### S6.1 Exact match

At generation each template is compiled. Candidates are the same
generation's canonical generated `Query|LiveQuery` operations **emitted by
the data lowerer for the same resource** — in practice the list-shaped
members, whose `documents` contracts and reserved `after` argument make
contract equality satisfiable (get is not builder-reachable and never a
candidate), excluding
handwritten/promoted and other synthesized members. An exact one has
the same policy-bearing plan hash, argument/result contract hashes, auth and
authority dependence, same reach, same total order/bounds, same retention and
liveness classes, and equal refusal/capability facts.

- Exactly one match: copy that operation's exact `FunctionReference`; the data
  spelling and named operation share invocation identity and, for `LiveQuery`,
  the complete QMK preimage. A one-shot `Query` has null materialization key.
- More than one match: refuse generation with
  `SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS`, naming the candidate ids and the
  function-promotion guide. No order-based tie break is allowed.
- No match: emit S6.2's ordinary synthesized member.

A handwritten named query is never a candidate even when its plan happens to
match. This preserves LLP 0157's rule that two named functions with equal plans
retain separate materializations.

### S6.2 Static synthesized member

For no match, codegen emits one ordinary member per template: `LiveQuery` when
sync is enabled, otherwise `Query`. Its exported name is:

```text
<resource>.query_<first 16 lowercase hex digits of normalizedDataQueryId>
```

Resource identifiers and the suffix keep the shipped `IDENT.IDENT` grammar.
The stable id is exactly `{appId}:{exportedName}`. A hash-prefix collision with
a different witness refuses `SNAPBACK_DATA_QUERY_NAME_COLLISION`; the prefix is
not silently lengthened. The member contains the concrete canonical plan,
policy, contracts, ceiling facts, source-custody span of the builder chain, and
`standardPattern:{helper:"data-query.v1",profile:"bounded-index.v1"}`. It is
decorated, emitted, activated, retained, inspected, and retired exactly like
other generated functions.

The slot-to-argument naming grammar is closed: an `eq` or `in` slot uses
the schema field name (the `in` value is the array); range slots use
`<field>_gt`, `<field>_gte`, `<field>_lt`, `<field>_lte`, matching the
operators used (two keys per range); the cursor is the reserved final
optional argument `after`; an absent cursor omits the key (never null);
and a schema field named `after` — or colliding with a range-suffixed
name — refuses `SNAPBACK_DATA_RESOURCE_INELIGIBLE` at generation: it is
a resource-eligibility fact whose remedy is renaming the schema field,
not a query-shape violation (the collision rule is table-scoped and
conservative: any field colliding with any other field's four potential
range suffixes refuses, whether or not a template uses them). Exact
S6.1 matching additionally requires the resolved member's parameter
names to equal this grammar. `DataQueryV1.arguments` stores the
positional slot values; the wire object is derived from them by this
grammar.

This static-catalog decision resolves the RFC's otherwise underdetermined
“synthesized ordinary export” requirement without a mutable manifest, wildcard
function family, runtime source compiler, or parallel identity authority. A
new query shape requires regeneration and activation. Runtime arguments and
cursors do not; they occupy the member's closed slots. Security does not depend
on successful extraction because the server rejects a missing witness.

### S6.3 Materialization and ownership

The resolved reference and canonical slot arguments are passed unchanged into
the shipped materialization bridge. Its preimage already includes exact
function identity, plan hash, arguments and authority partition
(`packages/snapback-client/materialization-bridge.mjs:167-178`). A query's rows
may be retained only while owned by an active admitted query, a canonical
optimistic layer, or a bounded retention lease. Inspector output names each
owner. Dropping the last owner applies the existing purge rules; the tiny
facade never pins rows on its own.

## S7. Transaction grammar, composition, and lifecycle

### S7.1 Chunk grammar

Generated resource methods construct inert chunks:

```ts
db.tx.todos.create({ title, completed: false })
db.tx.todos.update({ id, title, completed })
db.tx.todos.delete({ id })
```

Only owner resources have `db.tx` members. Argument keys and results are the
exact generated operation contracts; unknown keys and explicit `undefined`
refuse. A chunk contains no callback, table string, raw plan node, policy,
queue flag, prediction reducer, clock, principal, owner value, or system-field
value. Constructing a chunk has no effect.

`db.transact` admits 1..16 ordered chunks from one app/generation/target and
authority partition, executed as one authoritative transaction. Cross-resource
composition requires that shared principal partition, generated plans and all
ceilings. Duplicate write targets, create-id references, relationships, batch
reads/branches/CAS, authority writes, effects, and mixed generations escape to
one selected-profile function.

### S7.1b Transaction resolution — one replayable function identity

Transaction templates are statically catalogued exactly like queries: the
static chunk-shape sequence of each `db.transact` call site enters
`dataTransactionCatalog`, and the acyclic order is template core → witness →
resolution. Resolution parallels S6:

- **One chunk** (`resolution.kind:"chunk-mutation"`): the transaction *is*
  that chunk's generated mutation — its exact `FunctionReference`, ordinary
  `mutate` wire carrier, one `clientMutationId`, ordinary LLP 0043
  queue/replay. No new member is emitted.
- **Two to sixteen chunks** (`resolution.kind:"synthesized-batch"`): codegen
  emits one ordinary generated `Mutation` member per catalogued template,
  exported as `data.tx_<first 16 lowercase hex digits of
  normalizedDataTransactionId>` with stable id `{appId}:{exportedName}`
  (the `data.` namespace is reserved in both profiles: any authored
  export or familiar module under `data.` refuses
  `SNAPBACK_DATA_OPERATION_NAME_COLLISION` at generation — not merely a
  `.data` table named `data`; the reservation is active only when the
  schema declares at least one data resource, so a `.data`-free
  application keeps today's authored-name behavior). Its plan is the sequenced chunk plans
  lowered into **one HostPlan executing in one authoritative
  transaction**, with internal plan bindings deterministically renamed
  under a `__dataTx<position>_` prefix so concatenation cannot collide.
  Its argument object carries every chunk's slots under
  `c<position>_<argName>` names (positions dense, 0-based). Its result is
  the closed **record** `{c0, …, c<n-1>}` — each key the post-write row
  binding (create/update) or `null` (delete) — produced by a `Record`
  return expression over post-write `Get` bindings and typed as a closed
  value contract; the client facade projects that record to the
  positional `ResultTuple` view. "Tuple" is a client-view word only: the
  shipped `ValueExpr` has no array constructor and none is proposed. The
  lowering budget is proven at generation against the shipped plan
  ceilings (`MAX_PLAN_STEPS = 64`; `MAX_PLAN_SERIALIZED_BYTES = 65,536`):
  the per-chunk budget is at most 4 steps (guard read, guard, write,
  result read; creates use 2), so 16 update-heavy chunks exactly saturate
  the step ceiling, and a template whose lowered plan exceeds a shipped
  bound refuses `SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED` at generation,
  naming the bound — `maxChunks: 16` is an upper bound, not a promise
  that every 16-chunk composition fits. It dispatches on the ordinary
  mutation wire carrier with one `clientMutationId`, is stored and
  replayed by LLP 0043 as one ordinary mutation, and is decorated,
  activated, retained, and retired like any generated function. An
  un-catalogued call-site shape refuses
  `SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED`; a composition that cannot
  lower to one HostPlan refuses `SNAPBACK_DATA_TRANSACTION_INVALID`
  before custody. There is no batch endpoint, no second wire envelope,
  and no per-chunk sequential dispatch.

Exact transaction ceilings are:

```ts
type DataTransactionCeilingsV1 = Readonly<{
  maxChunks: 16;
  maxResources: 8;
  maxDeclaredReadRows: 32;
  maxDeclaredWriteRows: 16;
  maxDescriptorBytes: 65_536;
  maxDurableRecordBytes: 262_144;
  maxResultBytes: 65_536;
}>;
```

The descriptor cap includes canonical arguments but excludes transport
framing. Generated plans may declare tighter bounds. The outbox cap matches the
shipped 256-KiB record bound
(`packages/snapback-client/outbox-shared.mjs:20-25`). No chunk is split to make
an over-limit transaction fit.

### S7.2 Capability lattice and composition

Each generated operation records prediction and custody independently:

| Prediction | Custody | Admission and presentation |
| --- | --- | --- |
| generated exact | queue-eligible | install one atomic optimistic layer; durable queue is allowed |
| none | queue-eligible | accept/queue with `withheld` or `unavailable`; no paint |
| generated exact | online-only | install provisional layer only after dispatch preparation; recover ambiguity by intent id |
| none | online-only | no paint; recover ambiguity by intent id |

Paint installs only when every chunk's generated IR locally executes at
capture — authority captured, required rows owned/current, local bounds
passing; otherwise no paint installs (never partial batch paint) and the
capture takes the default settlement branch (S4.4). `core.prediction` —
the generation-stable capability the IR already labels
(`packages/snapback-client/generated-mutation-ir.mjs:34-48`) — is
unchanged by any invocation-time outcome.

The transaction's **intrinsic** custody is queue-eligible only when every
chunk is queue-eligible; otherwise it is online-only and carries the
sorted distinct core reasons: `operation-reach-online-only`,
`result-contract-not-replayable`, or `authority-capture-not-replayable`.
Target capability is a **dispatch-time disposition, never a core fact**
— and in v1 it is binary: a target advertising
`offline_mutation_replay` (which *is* the settlement-ledger
advertisement, S3.2) serves both queue-eligible dispatch
(`targetCustody:"queue-served"`) and intrinsically online-only dispatch
(`targetCustody:null`); a target without it refuses **every** data write
before transport with `SNAPBACK_DATA_CUSTODY_UNAVAILABLE`. There is no
target-degradation cell: an intrinsically queue-eligible transaction is
never silently downgraded by its target. Callers cannot upgrade or
downgrade any of these facts. Authoritative settlement is obligatory in
all four cells.

### S7.3 Handle and result

`db.transact` returns a handle synchronously so optimistic paint can be observed
without application bookkeeping:

```ts
interface DataTransactionHandleV1<ResultTuple> {
  readonly intentId: string;
  snapshot(): DataTransactionStateV1<ResultTuple>;
  subscribe(listener: () => void): () => void; // LLP 0238 D3 grammar:
  // notify-only; consumers read snapshot()
  readonly dispatched: Promise<DataDispatchV1>;
  readonly settled: Promise<DataSettlementV1<ResultTuple>>;
  refreshSettlement(): Promise<void>;
  dispose(): void;
}
```

`dispose` releases observation only; it cannot cancel accepted custody, delete
an outbox record, retract server execution, or suppress acknowledgement. The
canonical store continues settlement. `settled` resolves only to committed or
refused, rejects only when local observation is irrecoverably unavailable, and
does not resolve on queued/pending. Applications that cannot keep the handle
recover it by `db.transaction(intentId)`, a projection over canonical
`mutationStatus`/settlement state rather than a tiny registry.

```ts
type DataDispatchV1 =
  | {status:"settled"; intentId:string}
  | {status:"queued"; intentId:string; custody:"accepted";
     presentation:"installed"|"withheld"|"unavailable"}
  | {status:"pending"; intentId:string; custody:"not-offered";
     blockedReason:"outcome-unknown";
     presentation:"installed"|"withheld"|"unavailable"}
  | {status:"refused"; intentId:string; refusal:DataDiagnosticV1};

type DataSettlementV1<R> =
  | {status:"committed"; intentId:string; results:R; receiptDigest:string}
  | {status:"refused"; intentId:string; refusal:DataDiagnosticV1;
     receiptDigest:string};
```

`DataDiagnosticV1` is an alias of the existing
`snapback.client-diagnostic.v2` schema (S12), not a new diagnostics type.
The `settled` promise is process-local convenience only; recovered
observation via `db.transaction(intentId)` over canonical `mutationStatus`
remains the authority. `DataTransactionStateV1` has independent axes:
`presentation` is
`installed|withheld|unavailable|rebased`; `custody` is
`preparing|accepted|not-offered`; `dispatch` is
`preparing|queued|pending|settled|refused|failed|stranded|quarantined|resultGone|unknown`;
`settlement` is `pending|committed|refused|result-gone`; and `observation` is
`origin-only|converged`. Convergence means an independent canonical query
materialization has observed an authoritative version at or after the write's
receipt frontier. No watched query means convergence remains `origin-only` and
does not block settlement. Queued custody is never committed success; optimistic
paint is never evidence of either custody or settlement.

### S7.4 Refusal before custody

Unknown operation, stale/mixed generation, invalid arguments, policy mismatch,
authority-ineligible resource, duplicate target, unsupported composition,
exceeded bound, missing target capability, and inability to persist the
required custody records — the queue-eligible outbox record or the
online-only non-replayable observation alike — all refuse before the
transport boundary. Once custody
is accepted, later failures use canonical failed/stranded/quarantined/resultGone
dispositions; they are not retroactive admission refusals. Online-only response
loss uses S3.2 pending ambiguity.

## S8. Query state and `pendingWrites`

`db.useQuery` returns the full shipped union, intersected on every arm with:

```ts
type DataQueryStateV1<Result> = QueryState<Result> & Readonly<{
  pendingWrites: readonly Readonly<{
    intentId: string;
    state: "preparing" | "queued" | "pending" | "settled-awaiting-convergence";
    presentation: "installed" | "withheld" | "unavailable";
  }>[];
}>;
```

`skipped` has `pendingWrites:[]`. For every other arm, entries are the stable
intent ids whose canonical optimistic/outbox/settlement reach intersects this
materialization. Ordering is outbox sequence, then intent id. Values contain no
arguments or row data. Terminal refusal/failure removes the layer after
canonical rebase; committed writes remain `settled-awaiting-convergence` only
until this materialization observes the receipt frontier. `pendingWrites` is
therefore an LLP 0218/0238-compatible projection, not a base `QueryState`
amendment and not a second store.

## S9. Package doorway and generated typing

The public modules are:

```ts
// headless
import { createDataClient } from "@expo/snapback/data";
import { data } from "./snapback/generated/data.mjs"; // explicit profile
const db = createDataClient({ client, data });

// React
import { db } from "@expo/snapback/react/data";
```

Familiar uses `./snapback/_generated/data.mjs`. Generated `data.mjs` holds
witnesses/references; `data.d.ts` supplies schema typestate/results, never
policy execution. The existing provider supplies client, generation, auth and
store. A mismatched React binding throws `SNAPBACK_DATA_BINDING_REQUIRED` with
the setup action; module augmentation types `db` without a runtime registry.

The React subpath exports only `db`, `DataQueryStateV1`, and the data handle/
diagnostic types. It does not export or replace `useQuery`; LLP 0253's narrow
alias remains at `@expo/snapback/react`. The headless subpath delegates to the
existing app-data-capable client but is not named `app-data`, avoiding collision
with today's authority-limited facade (`packages/snapback-client/app-data.d.mts:3-19`).
Neither doorway owns transport, provider, cache, materialization, auth,
outbox, policy, settlement, or diagnostics.

React/headless implement first; Expo reexports React with identical fixtures.
Swift Phase 0 supplies byte-identical descriptor/refusal goldens only. A public
Swift API requires separate review over the same witnesses.

## S10. Promotion protocol

The only v1 command is:

```sh
snapback data promote <resource>.<create|update|delete> --format <explicit|familiar>
```

`--format` is required and must equal the selected profile: `explicit` means
`snapback-explicit-v1`; `familiar` means `snapback-familiar-ts-v1`. Mismatch,
public-read operation, query synthesis, stale generation, dirty destination,
existing export, or unsupported familiar capability refuses before writing.
The command previews a deterministic patch, requires approval, then emits
ordinary source: an explicit declarative function imported/exported by
`functions.mjs`, or a familiar top-level `<resource>.ts` function. It never
mixes profiles or edits schema/data.

`--format familiar` refuses for owner mutations in v1: generated-exact
prediction derives from plan-backed IR, which familiar's handler-only
grammar cannot preserve (LLP 0253 Appendix A marks `plan` unsupported); the
refusal names the explicit alternative. This makes familiar promotion
effectively unavailable for predicted writes until the familiar grammar
gains a prediction-preserving form; the D9 evaluation Plan records that
consequence rather than discovering it mid-run.

Emission freezes the generated public name; args/result contracts; auth and
policy dependency; read/write reach and ceilings; refusal set; target
requirements; prediction/custody facts; original witness; and provenance
comment. The generated member is replaced, not duplicated. The stable public
id `{appId}:{exportedName}` and compatible stored data are retained. Because
authored source custody and generally implementation bytes change,
`authoredSourceHash`, executable id, bundle id, and generation id rotate. The
semantic id remains only if the canonical semantic operation is byte-equal;
otherwise normal LLP 0241 activation/migration applies. Already accepted
queued intents keep the original generation and generated executable through
terminal settlement; promotion never rewrites them. Demotion is unsupported.

## S11. LLP 0252/0253 disposition against landed bytes

LLP 0252 D1's one selected profile, single canonical/runtime pipeline, and no
runtime profile branch are preserved. Explicit/familiar discovery, dotted
names/collision checks, profile-branded references/envelopes, and
`generated/` versus `_generated/` remain; only normalized data cores exclude
profile custody. Zero data resources wholly omit the addition.

LLP 0253 Appendix A is disposed field-completely:

- Function keys `args`, familiar `returns`→canonical `result`, `auth`,
  `reads/writes`, `handler`, `refusals/trackedRefusals`, `retainable`,
  `authScopeField`, and action `secrets`→`uses` remain direct. Adapter defaults
  for `source/exportName/js`, `defaultLive`, `authorityIndependent`,
  `authorityCreating`, and `authorizationDependence` remain. Plan-return
  `returns`, declarative `table/filter/order/limit/index/membership`, mutation/
  action `plan`, `stream`, `sequences`, `effects`, `runtime`, `requires`,
  `fieldBoundary`, `boundedSkew`, authored `standardPattern`, `publicInline`,
  and `outgrewIr` remain unsupported in familiar source. Generated data
  `standardPattern` enters canonical IR without authoring that key.
- Familiar `query/mutation/action` remain direct JS forms.
  `defineSchema/defineTable/v/allow` remain shared. Search/vector/live-search,
  bounded-children, snapshot-batch, relational, job/push-ledger,
  write-with-activity, cron, routes, command, surface, maintained projection,
  asset upload, config, ephemeral, push seam, and auth constructor families
  remain unsupported in familiar function modules and route to their existing
  extension/explicit owner.
- Table `.index`, `.history`, `.permissionBacking`, `.membership`,
  `.authorityProfile`, `.visibility`, `.assetSharing`, `.memberOf`, and
  `.hasRole`, plus schema `ephemeral/auth/authProgram/requiredCapabilities`,
  retain LLP 0253 dispositions. Search/vector/search-live methods stay
  unsupported in familiar v1. Familiar `.sync()` remains profile-defaulted for
  non-data tables; data tables amend it through S1.3. Shared `.data` is the one
  added table method and does not broaden function grammar.
- Narrow familiar `useQuery` (`Result|undefined`), mutation/action aliases,
  provider, static suggestions, and call-time queue behavior remain for
  non-data calls. Tiny full state is only `/react/data`; data transactions use
  S3.2 custody. Unsupported familiar effects, jobs, HTTP/runtime and authority
  creation still name the explicit/capability escape.

## S12. Stable refusals and next actions

Every diagnostic is `snapback.client-diagnostic.v2`, carries source span when
known, exact violated rule, redacted details, and one `guideAnchor`/action per
LLP 0193/0203. Required Phase 1 guide ids are `guide/data/resources`,
`guide/data/queries`, `guide/data/transactions`, and `guide/data/promotion`.
Until they land, diagnostics must point to the existing
`backend.standard-patterns`, `auth.protecting-data`, or
`sync.offline-and-retention` page and may not claim the new page exists.

| Code | Cause and exact next action |
| --- | --- |
| `SNAPBACK_DATA_RESOURCE_DECLARATION_INVALID` | unknown/repeated/nonterminal key; show closed `.data` grammar |
| `SNAPBACK_DATA_RESOURCE_VISIBILITY_REQUIRED` | absent/unsupported visibility; choose explicit owner/public-read or a function escape |
| `SNAPBACK_DATA_RESOURCE_INELIGIBLE` | authority, relationship, history, field/index or unique-disclosure rule; name fact and escape |
| `SNAPBACK_STANDARD_PATTERN_LIST_INDEX_REQUIRED` | S3.1 has zero/multiple candidates or bad explicit index; name qualifying indexes |
| `SNAPBACK_DATA_RESOURCE_SYNC_PER_TABLE_FORBIDDEN` | authored `.sync`; remove it or set application `dataSync:"disabled"` |
| `SNAPBACK_DATA_OPERATION_NAME_COLLISION` | generated/authored name collision; rename authored function or remove `.data` |
| `SNAPBACK_DATA_QUERY_SHAPE_INVALID` | grammar/index/projection/order violation; print nearest valid chain |
| `SNAPBACK_DATA_QUERY_NOT_CATALOGUED` | dynamic/unseen template; make shape static or author named query |
| `SNAPBACK_DATA_QUERY_BOUND_EXCEEDED` | named ceiling exceeded; reduce exact value or escape with reviewed bound |
| `SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE` | target/sync/retention capability absent; use `read`, enable app sync, change target, or escape as named |
| `SNAPBACK_DATA_QUERY_RESOLUTION_AMBIGUOUS` | multiple exact generated candidates; promote/rename one, never tie-break |
| `SNAPBACK_DATA_QUERY_NAME_COLLISION` | synthesized hash prefix collision; file owner issue; no automatic identity change |
| `SNAPBACK_DATA_CURSOR_INVALID` | malformed, cross-boundary, or stale-bound cursor; restart from the first page |
| `SNAPBACK_DATA_CURSOR_MINT_UNAVAILABLE` | continuation exceeds the cursor byte cap; narrow the order field or escape to a named query |
| `SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED` | dynamic/unseen transaction shape; make the chunk sequence static or author a function |
| `SNAPBACK_DATA_TRANSACTION_INVALID` | bad/mixed/duplicate/unsupported chunks; show first invalid chunk and function scaffold |
| `SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED` | named batch/byte/reach ceiling; split only when atomicity is unnecessary, else function |
| `SNAPBACK_DATA_CUSTODY_UNAVAILABLE` | missing durable client store: configure it — a durable store is required for every data write (queue custody and online-only observations alike); target without `offline_mutation_replay`: change targets — no data write is available there |
| `SNAPBACK_DATA_BINDING_REQUIRED` | missing/stale generated/provider binding; run normal generation and install provider |
| `SNAPBACK_DATA_PROMOTION_REFUSED` | format/profile/staleness/destination mismatch; print exact safe command/remediation |

## Acceptance

Semantic/security proof must show explicit owner/public policy, derived owner
stamping, no generic public or authority writes, server recomputation of every
descriptor, indexed total order and hard bounds, policy in every plan/QMK,
non-disclosing negative auth cases, and no scan/admin/post-filter fallback.

Lifecycle proof must cover every shipped query-state arm including `skipped`;
the non-retained guarantee (data queries remain non-retained through logout,
expiry, and policy change) plus offline write-custody and refreshing
transitions; logout, user switch, expiry,
membership/policy invalidation and purge; each of the four prediction/custody
cells; crash before and after dispatch boundary; queued versus settled truth;
result-gone and ambiguity recovery; original-generation replay; and independent
observer convergence. `pendingWrites` must be demonstrably derived from the
canonical owners.

Architecture proof must show equal explicit/familiar normalized witnesses,
profile-bearing envelopes, zero-resource byte omission, ordinary function and
QMK identity, one policy evaluator/materialization/cache/outbox/settlement
owner, React/headless descriptor parity plus Expo/Swift golden fixtures, and a
mechanical withdrawal with no storage migration or queued-record rewrite.

Authoring proof must complete owner Todo with the four concepts, mandatory
bounds and no package-source read; record retrieval/correction cost; prove
promotion into the selected profile; and keep Chat outside the promotion claim
until a reviewed membership-read profile lands. All refusal cases must expose
one actionable next move, and Phase 1–3 proof claims require generated schemas,
fixtures, negative tests, and target capability evidence—not green codegen
alone.

## Open questions remaining after Phase 0

1. **Membership reads (LLP 0254 OQ8).** Owner: LLP 0240/LLP 0231 authors.
   Default: unsupported; Chat is excluded from tiny evaluation and uses named
   membership queries. Admission requires reviewed negative tests and policy
   composition; membership/role writes remain escapes.
2. **Relationships (LLP 0254 OQ9).** Owner: LLP 0242/LLP 0157 authors. Default:
   no relationship node in data v1; use bounded named composition.
3. **Public Swift surface (LLP 0254 OQ10).** Owner: Swift client maintainer.
   Default: golden descriptor/refusal parity only, no public API claim.
4. **Umbrella survival (LLP 0254 OQ11).** Owner: LLP 0252 disposition author.
   Default: while Experimental, keep these subpaths in `@expo/snapback`; if the
   umbrella is withdrawn, mechanically re-export them from existing React and
   client packages without changing generated descriptors.
5. **Evaluation replication/effect size (LLP 0254 OQ12).** Owner: the Phase 0
   evaluation Plan. Default: no promotion until its thresholds are
   preregistered; this API Spec does not choose a result-sensitive threshold.

## Appendix A — complete projections

### A1. Owner Todo: tiny

```ts
// snapback/schema.mjs (explicit profile)
import { defineSchema, defineTable, v } from "@expo/snapback-codegen/define";
export const todos = defineTable({
  title: v.string(), completed: v.boolean(), ownerId: v.principal(),
  createdAt: v.integer(),
}).index("by_owner_created", ["ownerId", "createdAt"])
  .visibility({ kind: "owner", field: "ownerId" })
  .data({ createDefaults: { createdAt: "now" }, immutable: ["createdAt"] });
export default defineSchema({todos}, {auth:{mode:"sessions"}});

// TodoList.tsx
import { db } from "@expo/snapback/react/data";
const q = db.todos.using("by_owner_created")
  .orderBy("createdAt", "asc").take(100);
const todosState = db.useQuery(q);
const add = (title: string) => db.transact(
  db.tx.todos.create({ title, completed: false }),
);
```

The omitted `listIndex` is legal only because exactly one declared index is
owner-leading. Owner is not an argument; `createdAt` is server-derived.

### A2. Owner Todo: explicit functions

```ts
// snapback/schema.mjs
import { defineSchema, defineTable, v } from "@expo/snapback-codegen/define";
export const todos = defineTable({ title:v.string(), completed:v.boolean(),
  ownerId:v.principal(), createdAt:v.integer() })
  .index("by_owner_created", ["ownerId","createdAt"])
  .visibility({kind:"owner", field:"ownerId"}).sync();
export default defineSchema({todos}, {auth:{mode:"sessions"}});

// snapback/functions.mjs
import schema from "./schema.mjs";
import { defineOwnedCrud } from "@expo/snapback-codegen/standard-patterns";
export const { listTodos, getTodo, createTodo, updateTodo, deleteTodo } =
  defineOwnedCrud({ table:schema.tables.todos,
    names:{list:"listTodos",get:"getTodo",create:"createTodo",
      update:"updateTodo",delete:"deleteTodo"},
    visibility:{kind:"owner",field:"ownerId"},
    createDefaults:{createdAt:"now"}, immutable:["createdAt"],
    listIndex:"by_owner_created" });

// TodoList.tsx
import { useSnapbackMutation, useSnapbackQuery } from "@expo/snapback-react";
import { api } from "./snapback/generated/api.mjs";
const todosState = useSnapbackQuery(api.listTodos, {});
const createTodo = useSnapbackMutation(api.createTodo);
const add = (title:string) => createTodo({title, completed:false});
```

### A3. Owner Todo: familiar functions

```ts
// snapback/schema.ts
import { defineSchema, defineTable } from "@expo/snapback/server";
import { v } from "@expo/snapback/values";
export default defineSchema({ todos: defineTable({ title:v.string(),
  completed:v.boolean(), ownerId:v.principal(), createdAt:v.integer() })
  .index("by_owner_created", ["ownerId","createdAt"])
  .visibility({kind:"owner",field:"ownerId"}) }, {auth:{mode:"sessions"}});

// snapback/todos.ts
import { mutation, query } from "@expo/snapback/server";
import { v } from "@expo/snapback/values";
export const list = query({ args:{},
  returns:v.array(v.doc("todos")), auth:"authenticated", reads:["todos"],
  handler:({db,auth},a)=>db.query("todos")
    .withIndex("by_owner_created",q=>q.eq("ownerId",auth.userId))
    .order("asc").take(100) });
export const create = mutation({ args:{title:v.string(),completed:v.boolean()},
  returns:v.doc("todos"), auth:"authenticated", reads:["todos"], writes:["todos"],
  handler:async({db,auth,runtime},a)=>{ const id=await db.insert("todos",
    {...a,ownerId:auth.userId,createdAt:runtime.now()});
    return db.get("todos",id); } });

// TodoList.tsx
import { useMutation, useQuery } from "@expo/snapback/react";
import { api } from "./snapback/_generated/api.mjs";
const todos = useQuery(api.todos.list, {});
const createTodo = useMutation(api.todos.create);
const add = (title:string) => createTodo({title,completed:false});
```

The familiar example uses the admitted trusted runtime clock, not ambient
`Date.now()`; categories its grammar refuses still route to explicit.

### A4. Chat sketch and the membership gap

```ts
export const messages = defineTable({ roomId:v.id("rooms"),
  senderId:v.principal(), body:v.string(), createdAt:v.integer() })
  .index("by_room_created", ["roomId","createdAt"])
  .visibility({kind:"membership", declaration:"roomMembers",
    resourceField:"roomId", roles:["member"] });
// .data(...) is intentionally absent in v1.
```

Messages require membership-policy composition, bounded pages and negative
membership transitions. Use the existing named membership keyset/composition
surface; role and membership writes use functions. Until Open Question 1 lands,
Chat is not tiny-capable and no Todo result generalizes to collaborative data.

## Appendix B — withdrawal projection

| Tiny fact | Mechanical canonical destination |
| --- | --- |
| owner/public `.data` | remove marker; retain table/index/visibility/sync facts |
| generated `list/get/create/update/delete` | retain ordinary generated functions or promote to selected-profile source with frozen contracts |
| catalogued descriptor | exact resolved generated query reference + canonical slot args; synth member remains named until callers migrate |
| `db.useQuery` | canonical full-state hook/watch over that generated reference |
| `db.read/watch/explain` | canonical read/watch/inspection calls over the same reference |
| transaction chunk | corresponding generated mutation reference and exact args |
| multi-chunk transaction | generated selected-profile atomic function scaffold; refuse automatic split |
| transaction handle / `pendingWrites` | canonical mutation disposition, outbox, optimistic layer and query frontier projections |
| `/data` imports | generated references plus existing headless/React client entrypoints |

Withdrawal generation produces and reviews this mapping before removing a
doorway. It never changes table storage or ids. New tiny construction stops at
the withdrawal generation, but already accepted queue records and non-replayable
pending observations retain original generation/executable custody. They drain
to committed/refused/typed stale or result-gone disposition under LLP 0241;
records are never rewritten to promoted functions or the active generation.
Synthesized query members remain available as long as retained
materializations/resume state cite them, then retire by normal generation GC.

## Status

Accepted (2026-08-13, author-directed, after the six-round three-family
super-refine loop closed under the delta rule and the commissioned r8→r9
GPT-family delta review returned READY with zero concerns — run journal:
`llp/reviews/0255-tiny-data-surface-v1-api.run.md`). The S3 amendments
were ratified by the author the same day (dated notes in LLP 0065, 0218,
0043, 0238, 0004, and 0253), and the LLP 0256 evaluation Plan is
accepted with its thresholds frozen, so LLP 0254 Phase 1 implementation
is authorized. This document still makes no shipped capability claim;
each phase's claims require its own scoped proof.
