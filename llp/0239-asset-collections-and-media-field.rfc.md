# LLP 0239: Asset collections and the media field

**Type:** RFC
**Status:** Accepted
**Systems:** Assets, Schema, Application data API, Client integration, React,
Expo, Auth, Code generation, Diagnostics, Guide, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (entered Review for the author-directed single-family
`llp-super-refine` loop: Codex GPT-5.6-sol xhigh only; Claude intentionally
skipped). 2026-08-12 (mechanically renumbered from LLP 0237 to LLP 0239 after
origin assigned LLPs 0234–0235). 2026-08-12 (author-directed acceptance after
Round-3 same-revision Codex GPT-5.6-sol xhigh convergence). 2026-08-12 (round-1 revision: assigned atomic commit custody to the
ordinary mutation host through a closed binding IR; inherited LLP 0180 task,
ambiguity, retry, and cancellation semantics; froze collection item identity).
2026-08-12 (initial Draft synthesized from LLP 0236 P3, P7, P11, and P12).
2026-08-15 (author rulings during the R3 rollout, recorded in D2/D4: the
closed sharing-plan grammar ships with the collection rollout, and
`order: "created"` collections omit `reorder` at generation).
2026-08-16 (author rulings during the R4 rollout, recorded in D3/D4: the
media-command binding carries an explicit required collection operation, and
the closed direct-recipient principal-input mapping ships with R4)
**Related:** LLP 0004, LLP 0007, LLP 0044, LLP 0053, LLP 0061, LLP 0110,
LLP 0131, LLP 0180, LLP 0193, LLP 0208, LLP 0210, LLP 0211, LLP 0220,
LLP 0235, LLP 0236, LLP 0237, LLP 0238, LLP 0240, LLP 0241, LLP 0242, LLP 0243,
Diary 0058 (messaging-snapback), Diary 0058
(relay-room-expo-backend-bakeoff), Diary 0059, Diary 0073

## Summary

Snapback should make common media flows one declared, typed application
surface without weakening asset authority. This RFC adds:

1. a first-class `v.media()` stored field for zero-or-one typed asset
   reference;
2. a declared `assetCollection` for ordered, bounded zero-to-many media;
3. one command helper that uploads one or several sources and atomically
   commits the owning mutation plus asset attachments;
4. one renderer/hook contract across image, video, optional/empty, variant,
   signed-delivery, refresh, denial, and revocation states; and
5. source-attributed definition diagnostics for every command/asset mapping.

The design does not store asset references inside opaque structured JSON.
Authority-bearing references remain addressable system-checked facts: a media
field is a distinguished scalar asset-ref column, and a collection compiles to
bounded child records with generated ordering and mutation operations. The app
gets the ergonomics of `image?` and `media[]`; Snapback keeps typed reference
custody, attachment atomicity, grants, revocation, GC, and authorization
invalidation.

## Motivation

LLP 0236 finds a stable split: agents value Snapback’s asset policy more than
competitors’ capability-URL paths, yet repeatedly struggle to perform ordinary
app work. One image, several images, optional media, video, signed delivery,
and recipient access each use sound primitives but require different pieces of
transport or policy knowledge.

LLP 0210 closes issuance, refresh, upload convenience, command optionality, and
recipient grant operations. LLP 0220 lands recipient-bound grants. The
remaining problem is composition at the application boundary:

- multi-image messages/posts fall to raw uploads plus handwritten mutations;
- models become `image1`…`image4` or app-owned child tables;
- an empty optional id can crash a renderer before the author reaches policy;
- authors probe video URL and variant behavior; and
- codegen can report only that a definition is unserializable rather than
  which exported command field is wrong.

LLP 0211 deliberately excludes asset references from opaque structured stored
values because authority and lifecycle machinery need addressable references.
That safety decision is correct. The product answer is a first-class media
field and generated collection, not `v.array(v.assetRef())` hidden in one JSON
column.

## Constraints

- Every asset reference remains typed, addressable, authorization-checked, and
  visible to reference GC (LLP 0044#typed-references-and-atomic-attachment).
- Media fields and generated collection-record fields receive exact LLP 0235
  class-M field treatment like every other schema field; neither introduces an
  unclassified exception to the all-fields fence.
- Grant, activation, revocation, signed URL, and user-switch semantics remain
  those of LLP 0210/0220; convenience may not mint ambient authority.
- Collection bounds and ordering are declared and portable; no unbounded nested
  array or hidden join enters the v1 schema.
- Upload tasks remain available for progress, pause, retry, and cancellation.
  A convenience workflow composes them; it does not erase their states
  (LLP 0210#d3-assetsupload-and-the-taskdone-contract).
- Asset delivery follows the framework-neutral client and shared issued-URL
  store; React/Expo are projections (LLP 0210#d1-client-arm-signed-issuance-and-ttl-refresh-projection).
- Authorization checks precede metadata enumeration and diagnostics carry no
  rejected bytes or private variant sets to unauthorized callers.

## Decision

### D1. `v.media()` is the zero-or-one application field

Schema authors declare:

```js
avatar: v.optional(v.media({
  intent: "profileImage",
  policy: "owner-only",
  kinds: ["image"],
}))
```

`v.media()` is a distinguished `assetRef`-family stored field, not a structured
value. Its descriptor binds:

- upload intent;
- admitted media kinds (`image`, `video`, `audio`, `file`);
- attachment/read policy generation;
- optionality;
- allowed delivery/variant profile; and
- target capability requirement.

The physical value remains the opaque asset id in its existing typed reference
column. Writes pass through the same attach/detach authorization and reference
lifecycle as `v.assetRef`; codegen derives them mechanically from the field
descriptor rather than requiring a separate hand-authored mapping. A plain
`v.assetRef()` remains available for advanced use.

The generated client type is:

```ts
type MediaRef<K extends MediaKind = MediaKind> = {
  assetId: string;
  kind: K;
};
```

`kind` is server-admitted metadata, not a client assertion. The app-row storage
column remains the compact asset id. Generated online and retained result
projections carry `kind` from authorized asset metadata read at the same
authoritative snapshot; the projected value is part of the exact result
contract and may be retained with that result. A client never performs an
undeclared metadata lookup to manufacture the generic parameter, and public
write APIs ignore or reject a forged `kind` rather than treating it as
authority.

### D2. `assetCollection` is the zero-to-many application relation

Schema authors declare a generated bounded relation:

```js
attachments: assetCollection({
  ownerTable: "messages",
  intent: "messageMedia",
  maxItems: 8,
  order: "manual",
  kinds: ["image", "video"],
  grants: "inherit-command",
})
```

This compiles to Snapback-owned collection records addressable by parent id,
asset id, stable item id, ordinal, kind, and policy generation. It uses the
LLP 0110 bounded-children/query machinery and asset reference lifecycle; app
authors do not create or synchronize a parallel join table.

V1 rules:

- `maxItems` is required, 1–32;
- ordering is `manual` or `created`;
- each item references one finalized asset admitted under the declared intent;
- duplicate asset ids are refused by default, opt-in only through a future
  policy if demand appears;
- the collection cannot be written by raw table insert/patch;
- generated `replace`, `append`, `remove`, and `reorder` operations enforce the
  bound, parent authority, grant policy, and attachment changes atomically; and
- collection reads return exact `MediaRef` plus stable item/ordering metadata,
  with ordinary bounded-children paging when needed.

Collection rows are framework-owned system records exported/imported with the
asset/reference component of a consistent cut. They are not an opaque stored
array and never bypass GC or authorization invalidation.

Item identity is part of the v1 contract. Every item id is opaque, scoped to
the collection generation, and never reused after removal. `append` allocates
one id per new asset from the mutation-attempt identity and item ordinal;
`reorder` preserves every id; `remove` retires it. Because duplicates are
forbidden, `replace` matches retained items by asset id, preserves their ids,
retires removed ids, and deterministically allocates ids for new assets from the
replacement attempt. Retry with the same mutation attempt produces the same
plan and ids. Migration derives ids from the migration identity, parent, source
field/ordinal, and asset id, collision-checks them, and records the derivation.
Neither regenerated output nor content equality can revive a retired id.

> **Dated ruling — `order: "created"` and the four operations (author,
> 2026-08-15).** The v1 list above names four generated operations without
> conditioning them on the order mode. Ruling: `created` means immutable
> creation sequence. A created-order collection does not emit `reorder`;
> declaring or invoking it refuses at generation with a source-attributed
> diagnostic whose remediation names `order: "manual"`. `replace` under
> created order keeps retained items in their original creation order and
> places newly allocated items after all retained items, ordered by input
> position within the replacement attempt. No second (presentation) ordinal
> exists in v1.

### D3. One `mediaCommand` owns multi-upload plus atomic commit

`mediaCommand` is a closed specialization of LLP 0180’s existing client
command, not a new workflow endpoint or a second mutation owner. Codegen
admits:

```js
export const sendMessage = defineMediaCommand({
  media: {
    input: "media",
    intent: "messageMedia",
    minItems: 0,
    maxItems: 8,
    kinds: ["image", "video"],
  },
  mutation: sendMessageMutation,
  mapping: {
    passthrough: ["text"],
    assetsToMutationArg: "assetIds",
    parentResultPath: "_id",
    collection: "attachments",
  },
  sharing: assetSharing.none(),
});
```

There is no authored `map` callback. The descriptor compiles to a closed
`MediaCommandBindingV1` containing command identity, target mutation identity,
passthrough argument names, asset-input-to-mutation-argument mapping, parent
result path, collection identity/generation, item-identity plan, sharing plan,
and task profile. Unknown paths, transforms, branches, callbacks, or target
fields refuse at generation.

The binding is also installed in the target mutation manifest. The ordinary
mutation host remains the sole application commit owner: it validates the
binding and mapped asset refs before handler execution, invokes the authored
mutation handler once, validates its exact result, resolves the declared parent
path, reauthorizes parent/intent/collection/sharing policy at commit time, and
stages the generated collection rows, attachment lifecycle changes, and grants
in the same storage transaction before the commit becomes visible. Finalized
uploads alone never create or attach application data.

A mutation carrying a required media binding is command-only in v1. Plain
dispatch without the exact binding refuses before handler execution with
`SNAPBACK_MEDIA_COMMAND_BINDING_REQUIRED`; generated clients do not expose it
as a direct mutation verb. Text-only execution is the same command with an
empty media list. Apps that need an independently callable mutation declare a
separate operation; Snapback does not permit a direct path that could commit a
parent while skipping framework attachments. The binding, mutation
implementation, mapping, collection/sharing generations, and final executable
bytes all enter semantic/executable identity.

The generated client accepts a scalar source or array according to the
descriptor and normalizes `File`, `Blob`, and native picker-shaped sources
through LLP 0180’s platform adapters. Its task phases are:

```text
validating → uploading (0..N with per-item progress) → committing
  → committed | failed | cancelled | ambiguous
```

The returned object is LLP 0180’s `CommandTask` projected through LLP 0238’s
`TaskHandle`. Before commit it durably records one mutation-attempt identity and
deterministic item plan. No mutation runs until required uploads finalize. A
lost response is `ambiguous`; retry reuses that attempt/plan, returns a successor
task, and never migrates predecessor listeners or `.done`. Pre-invocation cancel
may settle `cancelled`; post-invocation cancel is `ambiguous` until authoritative
settlement. Multi-asset residue retains each asset’s attachment certainty and
cleanup provenance under LLP 0180/0044; the wrapper never deletes silently.

Options:

- concurrency is bounded by the target profile (default 3);
- input order defines manual collection order;
- optional media is an empty list, not `""`, `undefined` passed through an
  asset hook, or a fake id;
- retry creates successor upload tasks for eligible failed/cancelled items and
  reuses already-ready asset ids only after current commit-time intent,
  collection, sharing, parent, and principal authority revalidation; and
- cancellation stops not-yet-finalized uploads and never claims to undo a
  mutation whose invocation began.

The single-asset `assets.upload()` and general task primitives remain. This
command is the paved composition for “upload media and create/update the owning
record.”

> **Dated ruling — the binding names its collection operation (author,
> 2026-08-16).** The mapping above binds a collection but did not say which
> D2 operation commits the items, and `append` versus `replace` diverge
> observably on update mutations. Ruling: the mapping declares
> `operation: "append" | "replace"`, required, with no default; `remove` and
> `reorder` refuse at generation. The command inherits exactly the declared
> operation's stable-item-id and retention semantics from D2. A missing or
> invalid operation refuses with a source-attributed
> `<binding>.mapping.operation` diagnostic.

### D4. Grants and authority are declarative at the command edge

The command descriptor may select only already-admitted policy operations:

- owner-only attachment;
- active or pending recipient grants under LLP 0210/0220;
- app-authorized recipients derived by an explicitly named generated function;
  or
- no grant change.

The caller cannot pass arbitrary principals unless the descriptor declares a
principal input and the server-side mutation is authorized to derive/validate
it. Grant creation/activation/revocation and app-row/collection writes share the
same atomic mutation staging.

The collection descriptor owns the maximum admitted sharing classes and its
default. Each command or generated collection mutation selects one exact plan
within that ceiling; it cannot broaden the collection policy. `inherit-command`
means that exact versioned command binding’s plan, not “all readers of the
parent row.” If several commands mutate one collection, every binding carries
its own sharing identity and commit-time reauthorization; no last-writer
ambient default exists. Parent-row-derived sharing remains a separate explicit
policy/profile tied to LLP 0240’s authority mapping and is never inferred from
a client payload. That composition stays generation-refused until both the
media binding and authority-profile capability are qualified, avoiding an
activation cycle between the RFCs.

> **Dated ruling — the sharing grammar ships with the collection rollout
> (author, 2026-08-15).** This section names the admitted classes but left
> the concrete `grants` declaration and per-operation selection shape open.
> Ruling: the R3 rollout defines the full closed grammar rather than
> deferring it to the command rollout. The collection descriptor declares a
> ceiling (set of admitted classes) and a default plan; the admitted classes
> are exactly: no grant change, owner-only attachment, active or pending
> recipient grants (LLP 0210/0220), app-authorized recipients derived by an
> explicitly named generated function, and `inherit-command`. Each generated
> collection operation accepts one exact plan selection within the ceiling,
> defaulting to the descriptor default, and can never broaden it. Declaring
> `inherit-command` in the ceiling is legal before the media command ships;
> selecting it outside an exact versioned command binding refuses. Recipient
> principals are never authority by assertion; they are admitted only through
> the declared LLP 0210/0220 grant operations or the named generated
> derivation function, revalidated at commit time. The as-built descriptor
> and operation surface are the normative spelling of this ruling.

> **Dated ruling — the command's direct-recipient principal input ships with
> R4 (author, 2026-08-16).** This section admits direct recipient grants only
> when the descriptor declares a principal input; the D3 grammar had no such
> field. Ruling: `defineMediaCommand` gains a closed declared principal-input
> mapping — a named command input, bounded 1–32 principals, carried as data
> into the binding with no callback. The host maps the input through the same
> LLP 0210/0220 owner-authorized grant machinery as the generated collection
> operations, under full commit-time reauthorization; caller-supplied
> principals are never authority by assertion. Selecting a direct-recipient
> plan without the declared input refuses at generation, as does declaring
> the input without a direct-recipient plan in the ceiling. The as-built
> spelling is normative.

### D5. One media projection handles empty, image, video, denial, and refresh

The framework-neutral media store extends LLP 0210’s issued-URL controller and
projects:

```ts
type MediaState =
  | { status: "empty"; media: null }
  | { status: "issuing"; media: MediaRef }
  | { status: "ready"; media: MediaRef; url: string; expiresAt: number;
      rendition: string }
  | { status: "refreshing"; media: MediaRef; url: string; expiresAt: number;
      rendition: string; diagnostic?: Diagnostic }
  | { status: "unavailable"; media: MediaRef; diagnostic: Diagnostic }
  | { status: "denied"; media: MediaRef; diagnostic: Diagnostic };
```

React/Expo expose `useSnapbackMedia(mediaRefOrNull, options)`. Passing `null`
or `undefined` yields `empty` synchronously, performs no issuance, and never
throws. Passing an empty string is an argument-contract error naming the nullable
spelling, not an asset lookup.

Rendition selection is intent-driven:

- image defaults to `primary` and can request width/declared variant;
- video defaults to its declared playable rendition, with poster and original
  exposed only if the intent declares them;
- audio/file use their declared primary delivery; and
- unknown or processing renditions yield typed states and enumerate only
  metadata the caller is authorized to see.

“Playable video” is target-qualified. A target may advertise
`media.video.playable.v1` only when its intent names at least one finalized
rendition with a concrete MIME/container/codec contract that the web and native
acceptance clients both play. Without that capability, video upload or original
delivery may still be separately advertised, but the generated media command
and happy path cannot claim portable playback.

Revocation and authority replacement synchronously blank the URL per LLP 0210.
The hook never probes signed routes to discover capabilities.

Collections project through `useSnapbackMediaCollection`, which reuses one
issued-URL controller entry per `(asset, authority, rendition options)` and
returns stable item identities and per-item states. One bad/denied item does not
crash the list or erase authorized siblings.

### D6. Definition diagnostics attribute the exact field and mapping

Codegen builds the asset/command descriptor through an instrumented definition
graph that retains exported binding and property spans. Errors include a
structured path such as:

```text
sendMessage.media.optional
```

or:

```text
sendMessage.attach.collection
```

An explicit `optional: false` is either accepted as the canonical required
value or refused with a code that says the option is unnecessary; it can never
reduce to an unattributed definition-serialization error. Unexported top-level
builder values are diagnosed as `SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED`
with binding name and export remediation.

All descriptors are validated before isolated definition evaluation produces
the strict artifact. LLP 0237’s preflight and runtime-profile artifact carry
the same diagnostic/source map.

### D7. The guide begins with the four happy paths

One generated guide page starts with executable npm-closure examples, in this
order:

1. optional profile image field;
2. multi-image/video message command;
3. rendering image/video with refresh and empty state; and
4. recipient grant/revocation.

Only then does it explain raw upload routes, task recovery, policy generations,
or system records. Every generated field/collection/command reference links to
the exact section, and every restriction appears before the first example that
would hit it.

## Compatibility and migration

`v.assetRef`, raw upload tasks, asset routes, command tasks, and application
child tables remain supported. The new surfaces compile to the existing asset,
bounded-children, mutation, grant, and delivery primitives with versioned
descriptors. A command-bound mutation is a new generated operation shape and is
never retrofitted onto an existing directly callable mutation; adoption creates
the binding explicitly, so compatibility cannot turn a formerly direct call
into an attachment-skipping path.

Existing `image1`…`image4` or app-owned attachment rows can migrate through a
generated preview:

```sh
snapback migrate media-collection --from messages.image1,image2,image3,image4
```

The preview identifies invalid ids, duplicates, missing assets, policy
incompatibility, ordering, and rollback. It emits a normal LLP 0081 migration
plan; no auto-apply is authorized by this RFC.

Apps with custom attachment metadata continue using explicit child tables.
They may compose a media field on each child rather than adopting the generated
collection.

## Alternatives considered

### Permit `v.array(v.assetRef())` in structured values

Declined. It would hide authority-bearing references from attachment checks,
GC, grants, invalidation, and relational access. LLP 0211’s exclusion remains
correct.

### Keep app-owned child tables and publish a recipe

Insufficient. The relation is structurally correct but repeatedly taxes authors
with schema, ordering, mutation, attach/detach, and hook composition that the
framework can generate from one bounded declaration.

### One raw multipart endpoint that accepts record fields and files

Declined as the application contract. It couples transport parsing to mutation
semantics, weakens offline/task custody, and makes atomic policy evidence harder
to inspect. The task can use efficient transport internally while preserving a
typed generated command.

### Make every asset publicly addressable by stable URL

Declined. It erases the policy advantage the research says must not be optimized
away.

## Rollout

1. Land `v.media()` as sugar over the existing typed asset-ref contract plus
   exact generated types and empty-safe projection.
2. Land source-attributed definition diagnostics and the four-path guide page.
3. Implement the generated `assetCollection` over bounded children, including
   stable item identity, export/import, GC, invalidation, and quota fixtures.
4. Implement the closed mutation binding and its atomic host staging, then
   project it through the existing `CommandTask` ambiguity/retry contract.
5. Enable authority-profile sharing only after LLP 0240’s membership lowering
   and this binding independently qualify; until then the composition refuses
   at generation.
6. Add the migration preview and rerun Relay Room, Tandem, and Clique media
   slices from a published npm package.

Each phase keeps existing primitives usable and advertises only the capability
rows it has actually qualified.

> **As-built rollout record (2026-08-16,
> issues/shelved/20260815-finish-media-happy-path.md).** Steps 3 and 4 are
> implemented and landed: the generated `assetCollection` (`26e0ee26c`,
> `assets.media-collection.v1` experimental via its LLP 0134 same-commit
> act) and the closed `defineMediaCommand` binding with atomic host staging
> (`d4b14d33b`, `assets.media-command.v1` experimental likewise), plus the
> collection controller/hook projections and the executable guide Paths 2/4
> (`71372c5cc`). Four dated author rulings taken during the rollout are
> recorded beside D2/D3/D4. Post-landing hardware evidence: a physical-iOS
> pass (Diary 0087, 2026-08-16 entry) proved picker → bounded multi-upload
> with per-item progress → one atomic parent/collection commit → signed
> delivery → authorized render, and forced two defects fixed in place (the
> preview identity omission, `4b79cc02e`; the JS query-path double
> projection landed with `bd0f7b0c5`/`9971c640c`) and one client fix
> (per-kind rendition-option routing). The acceptance suite was adapted to
> the later ownership-composition enforcement without weakening any proven
> property (`d4fbc1604`). Step 5 remains generation-refused as designed;
> step 6's migration preview and published-package reruns remain open on
> the rollout ticket, alongside the iPhone-MOV strip-walker refusal and the
> device retained-row staleness filed from the hardware pass. This RFC
> stays Accepted until step 6 completes.

## Acceptance

- A fresh agent implements optional avatar, eight-item image/video message,
  rendering, and recipient revocation through the four happy paths without raw
  route calls or package-source inspection.
- Zero media performs zero network work and never crashes a React render.
- N media uploads report per-item progress, preserve input order, and commit one
  parent/collection/grant transaction only after all required assets are ready.
- A commit-response loss yields `ambiguous`; retry reuses the exact mutation
  attempt and deterministic item plan, and cancellation after invocation never
  claims the server commit was undone.
- Commit failure never publishes a partially attached collection; orphan cleanup
  is bounded and visible.
- Append/replace/reorder/remove and migration obey the frozen non-reused item-id
  rules, preserving retained ids across content-equivalent replacement.
- Collection limits, duplicate ids, wrong media kinds, unsafe grants, and
  unknown variants refuse with source-attributed remediation.
- Revoked/changed authority blanks issued URLs and collection item projections
  without exposing variant metadata.
- Collection records survive backup/restore and migration as a consistent asset
  component; GC sees every reference.
- Image and video behavior is exercised on web and a physical Expo client.
- The generated schema/client types retain exact media kind and optionality; no
  `unknown`, `v.json()`, or `image1`…`imageN` splay is required.

## Risks

- A generated collection can become a hidden mini-ORM. Its v1 contract is
  deliberately narrow: bounded items, two order modes, closed mutations, no
  arbitrary metadata.
- Multi-upload can consume bandwidth/memory unexpectedly. Concurrency and count
  are target-declared and visible in task state.
- Automatic grant composition can broaden access if app inputs are trusted.
  Grant plans remain server-declared and atomically revalidated; client
  principals are never authority by assertion.
- A post-handler host staging seam can become hidden application logic. Its IR
  is closed to field/path mapping and framework-owned collection/grant effects;
  arbitrary callbacks remain handler code under LLP 0237, not command metadata.
- Convenience may conceal orphaned upload cost after commit failure. The task
  must expose cleanup disposition and the target retains bounded orphan GC.

## Open questions

1. Is 32 the right universal collection maximum, or should profiles declare a
   lower default with per-collection opt-up?
2. Which concrete video renditions are mandatory for an intent to claim
   `media.video.playable.v1`
   across web and native?

## Status

Accepted. This RFC asks the author to decide the media-field and generated
asset-collection shapes. It selects a closed LLP 0180 command specialization,
ordinary-mutation-host atomic commit, and deterministic collection item
identity; it preserves LLP 0211’s ban on opaque embedded asset refs and builds
on the implemented LLP 0210/0220 policy substrate.
