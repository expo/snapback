# LLP 0044: Asset storage pipeline

**Type:** RFC
**Status:** Accepted
**Systems:** Assets, Storage, API, Security, Auth, Runtime, Deployment, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-21 (AssetRef schema-evolution diagnostics now render the
bounded old/new intent and media-policy identity, name the changed facts, and
separate the attachment-hook-safe successor-field repair from whole-store
dev-fresh repair.)
**Revised:** 2026-08-10 (local finalize choreography amendment: Phase B's
idempotent canonical object put now runs outside the global Local writer,
between a lock-held `planned` commit and a separately lock-held
`staged`/publication commit; crash cuts and maintenance convergence remain
unchanged). Prior: 2026-08-09, third same-day entry (LLP 0210 D5(b) recipient
grants implemented on the local target, including the four recorded
pipeline obligations: invalidation, consistent-cut system-record
custody, active-only reference-GC protection, and the 1,024-edge
per-app quota; §Clique-pilot delivery and grant DX closure). Prior,
same day (withdrawal-scope clarification,
author ruling, Charlie: the 2026-07-31 bounded-array withdrawal's clause
"the portable field vocabulary ships no array table fields" binds the
**asset-reference vocabulary** — its subject — not plain-data structured
values, which are governed by LLP 0211; `v.array(v.assetRef(...))`
remains withdrawn and multi-asset relationships remain on the LLP 0110
bounded-children path, unchanged). Prior: 2026-08-09 (Clique-pilot delivery and grant DX closure —
§Clique-pilot delivery and grant DX closure: client-arm signed issuance +
React TTL refresh commissioned as owed implementation, issuance `variant`
defaulted to `primary` with typed unknown-variant refusals, a one-call
`assets.upload()` convenience with a settle-or-reject contract, and the
recipient-grant authority ladder (recipe / `ctx.assets.grant` /
app-bound sharing) opened for author ruling; evidence in LLP 0208 and
`issues/20260809-asset-upload-dx-papercuts-g11.md` +
`issues/20260809-asset-recipient-grant-authority-g4.md`). Prior, same
day: (local HTTP asset finalization now splits lock-held preflight and commit around repeatable lock-free byte/media preparation; commit rechecks generation revocation before Phase A and fails closed on a mid-window revocation). Prior: 2026-08-04 (the ruled asset-intent implementation carrier is implemented end to end, with legacy policy-only generations bumped and legacy in-flight attempts refused stale); 2026-08-04 (sessions lifecycle callbacks implemented under the ruled per-app `asset-callbacks` service principal). 2026-08-03 (two author decisions from decision sitting #2,
`issues/20260803-author-decision-sitting-2.md` — §Video location policy
and §Asset-intent implementation identity: a `video: { location }`
sibling block is admitted with `image:` untouched and its frozen
`intentPolicyHash` spellings preserved; and `implementationHash` is
extended to the spliced helper closure and carried through
client/admission/generation/finalization, pinned by metamorphic
fixtures). Prior: 2026-08-01, later same day (ceremony floor + bounded
on-demand widths, ruled by the author on the LLP 0139 bakeoff evidence —
§Ceremony floor and bounded on-demand widths: bare `v.assetRef()` derives
a generated default intent (strict/strip/owner-only, manifest-visible,
`{upload: null}` preserving the prior unrestricted semantics), and the
dynamic-transform non-goal is superseded by ladder-bounded on-demand
rendition materialization under the existing ceilings). Prior:
2026-08-01 (post-bakeoff fix-wave implementation note under §Status; release-refresh handoff closed as satisfied by the 0.1.8 publish). Prior: 2026-07-31, bounded-array withdrawal (author decision,
Charlie): `v.array(v.assetRef(...))` is withdrawn from the typed-reference
schema nodes — the portable vocabulary ships no array table fields, and
multi-asset relationships take the child-row (LLP 0110 bounded-children)
paved path, validated by the Party Wall demo; LLP 0007's companion
amendment carries the matching dated note, and the array follow-up ticket
closes as decided. Prior, same day: consistent-cut design addition (W2h): the asset
component of a logical export is designed — cut manifest, refuse-partial
import, restore-epoch fencing — with the local export slice and import
validation implemented, restore application gated experimental, and the
backup/export nonclaim regraded honestly (asset-byte snapshot backup stays
Missing). Prior, same day, image-pipeline kickoff (author decisions: the
pure-Rust `image` crate + `kamadak-exif` for v1 with a recorded
more-robust-library revisit trigger — HEIC coverage, rendition
throughput, or video finalization reopens it; ThumbHash as the single
versioned placeholder). Prior, same day (companion pass landed: dated
amendments in LLP 0007, LLP 0037, LLP 0012, and LLP 0053 freeze the
`v.assetRef` and `.assetSharing` spellings, the `assetUploadReference` DTO
custody, the `SNAPBACK_ASSET_*` and capability registrations, and the
read-authorization classification; the gating open question is resolved,
with only the Exact-owned descriptor mapping remaining by 0037's scope
fence). Prior same day: (v6.1 acceptance-time folds of the four non-gating
round-4 DETAILs — the frozen-generation re-validation substrate pinned with
its bounded artifact-retention obligation, "materially identical" defined
as validated-output-DTO equality, the sweep summary covering `planned`,
the untyped-write wording disambiguated from admitted host-plan operands,
the revocation-trigger acceptance row, and the warning-enumeration
completeness note. The dual-family loop converged READY×2 on v6; see the
super-refine journal for the SD-4 acceptance record. Prior: 2026-07-31 v6
round-3 dual-family review fix pass — see
`reviews/0044-asset-storage-pipeline.{fable,codex}.md`. Tightens
`via-references` beyond v5's rule: a table's analyzable row-visibility
policy confers asset read authority only when the schema explicitly
declares it sufficient for asset sharing, so a broad row predicate can
never bypass a narrower function-level gate. Redefines the authorization
witness as LLP 0007's complete read-set witness (missing rows, ranges,
index cursors, predicates, and the 0053 authorization pair included) with
re-validate-then-refuse-on-denial semantics, so benign churn during a long
upload finalizes and only genuine revocation refuses. Gives host plans and
other non-handler write paths a commit-boundary admission derived from the
field's schema-declared intent restriction. Closes the publication-record
machine (`planned → staged | condemned`, recovery inspecting `planned`,
receipted retirement) and the lease-expiry ledger transition. Counts the
primary rendition's blob reference and quota charge exactly once. Defines
the policy-generation revocation trigger, adds reference-GC's own
`ready → deleted` cause, makes the integrity grades lane-neutral, and
completes the Related-trim (0000 cited, 0107 cited). Prior: 2026-07-31 v5
round-2 dual-family review fix pass. Pins the
`via-references` decision procedure to declared analyzable row-visibility
policies with an owner-only fallback for function-authorized tables;
replaces per-asset policy-generation fanout with per-intent generations
plus admission-time authorization witnesses validated at finalization;
adds the one-transaction deletion cascade with the `retired` rendition
state; names the two integrity grades honestly; extends count ceilings to
every durable record class with a minimum accounting unit; closes the
publication-record and asset-work-ledger state machines with the
uniqueness-loser convergence rule; parameterizes `asset-lifecycle-v1` by
qualified byte store and moves client rendering out of the image
composite; makes the companion 0007/0037/0012 amendment (with the 0053
classification) a gating implementation prerequisite; and trims the
Related list to body-cited documents. Prior: 2026-07-31 v4 round-1
dual-family review fix pass. Adds the asset
read-authorization model with LLP 0053 invalidation projection, commit-time
typed-reference enforcement on every write path, the consolidated lifecycle
transition table with the single-current-attempt invariant, the publication
and crash-recovery protocol with the blob reuse/GC fence, the complete quota
accounting vector, the delivery URL identity model, adversarial image
resource bounds, the durable asset-work ledger for the compatibility runner,
and the location-policy rule extended to video. Names the image-finalization
capability and pins the slice boundary; stages SDK claims per LLP 0064;
refuses TUS deferred-length in v1; drops binary seed fixtures to a later
0109-amended capability; declares backup/export Missing; reattributes the
revive adjudication to the author. Prior: 2026-07-31 v3 author-directed
product and simplification revision. Replaces the asset-row-equals-byte-object model with separate upload
attempt, asset, blob, and rendition records; makes upload intents generated
authoring references; adds the headless and React/Expo upload controller,
language-neutral generated SDK parity across JavaScript, Swift, Kotlin, Python,
and future clients (v4 restages SDK claims per LLP 0064 — parity is the
protocol's property, not a four-language commissioning), typed references
with atomic attachment, app-selected
delivery profiles, restricted staging and trusted content detection, immutable
rendition publication, TUS for local resumability, per-app verified dedup and
logical quota semantics, and explicit capability staging. Resolves the
collision among direct upload, content-addressed physical keys, and privacy
rewriting by making physical keys opaque and verified content digests blob
metadata. Narrows the first processing surface to declarative built-ins and
lifecycle callbacks; arbitrary byte-processing handlers become a separate
future capability. Reconciles the cron fallback with LLP 0070's durable-work
successor. Prior:
2026-07-31 v2 revival revision, direction set by Charlie — revived this RFC in
place and added live lifecycle, optimistic display, resumability, derivatives,
content addressing, GC, ranges, receipts, one S3-compatible seam, and the
hosted executor direction; 2026-07-07 cross-family review revisions, ratified
by Charlie — see `reviews/0044-asset-storage-pipeline.claude.md`)
**Related:** LLP 0000, LLP 0007, LLP 0011, LLP 0012, LLP 0013, LLP 0028, LLP 0036, LLP 0037, LLP 0039, LLP 0047, LLP 0053, LLP 0064, LLP 0070, LLP 0074, LLP 0093, LLP 0095, LLP 0096, LLP 0099, LLP 0107, LLP 0108, LLP 0109, LLP 0114, LLP 0124, LLP 0127, LLP 0129, https://tus.io/protocols/resumable-upload

## Summary

This RFC defines Snapback's asset subsystem: uploading files (photos and video
especially), storing bytes outside document rows, keeping ownership and
references with app data, delivering bytes under explicit authorization, and
producing media renditions. The design goal is not a generic object-store
wrapper. It is an asset experience that behaves like the rest of Snapback:
typed, live, receipted, capability-honest, and easy for an agent to use
correctly.

The product contract is:

> An app declares an upload intent. A generated client in any supported
> programming language uploads resumably, returns a stable typed asset
> reference with an immediate local preview, attaches that reference in an
> ordinary mutation, and observes the trusted asset and its optimized
> renditions become ready over the live channel.

The subsystem supports:

- generated, declarative upload intents carrying authorization, file
  constraints, delivery posture, and image recipe;
- one stable app-visible asset identity across transfer retries;
- separate upload-attempt, asset, immutable-blob, and rendition records;
- restricted staging followed by trusted detection, validation, privacy
  rewriting, digesting, deduplication, and immutable publication;
- a local filesystem byte store and one S3-compatible object-store seam;
- one language-neutral headless protocol consumable equivalently by any
  generated SDK, with client claims staged per LLP 0064 (JavaScript and Swift
  committed, Kotlin reference evidence, Python and others future);
- a declared asset read-access policy per intent, with LLP 0053-projected
  invalidation;
- resumable upload through TUS on the local/proxied lane and native multipart
  on the S3-compatible lane, hidden behind one client task;
- typed asset references and atomic attachment to ordinary rows, with a
  system-maintained reverse-reference index;
- app-selected `public-immutable`, `private-signed`, and `private-strict`
  delivery profiles instead of target-selected security semantics;
- live asset and rendition availability plus ephemeral transfer progress;
- a declarative built-in image pipeline and separately claimed future custom
  processing;
- capability facts and semantic receipts for each target and lifecycle.

## Motivation

Assets are table stakes for product media, blogs, social feeds, avatars,
attachments, party photos, and rich collaborative apps. Snapback's root
design (LLP 0000)
already says asset bytes do not belong inline in documents; metadata,
ownership, permissions, references, and processing state belong with app data.

Without a first asset subsystem, every demo either avoids real media or
invents a one-off bucket path that does not port to hosted targets. LLP 0124
found the manifest hard-codes `assetUpload: false` with `assets` in the
capability-gap list on every target, and identified the blocked app classes:
the consumer-app genre where the blob is the content.

The competitive floor is a cohesive lifecycle: authorize, upload, receive an
opaque identity, attach it to application data, deliver it to an authorized
reader, delete it, and prove the old path no longer has more authority than its
declared delivery profile allows. Snapback should meet that floor and exceed
it in its own idiom: generated references, optimistic presentation, live
trusted state, typed attachment, explicit revocation semantics, and receipts.

LLP 0127 routes the work as startable now, in parallel with the parity
tranches, under LLP 0074's umbrella. The local store lands first; the object
store seam is designed alongside it and admitted only with real target
evidence.

## Design principles

- **Stable logical identity, immutable physical bytes.** App rows reference an
  asset, not a path, upload attempt, blob key, or rendition.
- **Security semantics are application semantics.** A deployment target may
  limit available delivery profiles, but it does not silently choose an app's
  revocation posture.
- **Untrusted bytes are not ready assets.** Direct upload ends in restricted
  staging. Only trusted finalization can publish a deliverable blob.
- **Generated facts over client choices.** The client supplies a file and
  declared intent arguments; it cannot override owner, limits, delivery,
  retention, processing, or authority.
- **Portable API, target-honest mechanism.** TUS, multipart upload, proxying,
  signed URLs, and range serving are adapter facts behind one generated task.
- **A small excellent path before a transform catalog.** Upload, attach,
  preview, deliver, replace, and delete must be excellent before arbitrary
  media code or a CDN product enters scope.

## Design

### Generated upload intents

Upload authorization and policy are declared in source and compiled into a
generated reference. Conceptually:

```ts
export const avatarUpload = defineAssetUpload({
  args: {},
  auth: "authenticated",
  reads: ["profiles"],
  accept: {
    mediaTypes: ["image/jpeg", "image/png"],
    maxBytes: 10_000_000,
  },
  delivery: { kind: "private-strict" },
  access: { read: "via-references" },
  image: {
    location: "strip",
    variants: [
      { key: "thumb", width: 128 },
      { key: "display", width: 1024 },
    ],
  },
  authorize: async (ctx) => ({
    owner: ctx.auth.userId,
  }),
})
```

The exact builder spelling is an implementation-spec detail, but these
properties are normative:

- the exported binding is the stable intent id;
- its generated reference is a Rust-owned, schema-generated DTO under LLP
  0037 carrying app, intent, contract, implementation, and capability
  identity, versioned and registered through LLP 0012's existing
  compatibility rules like every other protocol artifact — this follows the
  shipped whole-artifact reference idiom that LLP 0064 and LLPs 0090–0095
  govern; it deliberately does **not** revive the `ExpectedOperationV1`
  carrier that LLP 0108's reconciliation removed, and the companion 0037
  amendment freezes the exact DTO;
- an attempt is admitted under the intent's policy generation at creation
  and finalizes under that frozen policy; deploying a changed intent bumps
  the policy generation, and a revoked generation makes finalization refuse
  rather than silently applying newer policy (§Internal model);
- arguments and authorizer output are schema-validated;
- the authorizer executes under server-derived LLP 0039 authority;
- the declaration fixes accepted types, byte bounds, delivery profile,
  retention, read-access policy, attachment policy, and processing recipe;
- the client cannot supply or widen any of those facts;
- stale or target-incompatible references refuse before reserving an asset id
  or writing staging bytes.

One upload task carries exactly one file. Multi-file batch upload, with its
own identity and atomicity semantics, is future work, not an intent knob.

Two declared policies need definitions because attachment and GC depend on
them. The **read-access policy** is the closed v1 set `owner-only` (default:
only the owner principal may read metadata or bytes) and `via-references` (a
principal may read the asset if a row holding a typed reference to it
admits that principal under a row-visibility policy the schema has
explicitly declared sufficient for asset sharing — see §Asset read
authorization for the exact decision procedure). The
**attachment policy** fixes whether `pending` assets may be attached
optimistically and whether the asset may be referenced from more than one
row. A generated custom read authorizer is a later capability, not a v1
spelling.

**Location-bearing media require a declared location policy.** This rule
covers every accepted media type known to carry location metadata: image
formats with EXIF/XMP GPS and video containers with location atoms
(QuickTime/MP4 as recorded by phones). The declaration is mandatory — there
is no implicit fallback, and omission refuses at generation. The
conventional spelling is
`location: "strip"`, which is admissible only where the target advertises the
matching metadata-rewriting capability fact: `asset-image-finalization` for
images (carried by the `asset-image-pipeline-v1` slice) and a future
`asset-video-finalization` fact for video, which no v1 target claims. An
explicit `location: "retain"` is admissible without the rewriting fact and
appears in lifecycle evidence. Consequently a target with only
`asset-lifecycle-v1` refuses a default-policy image or video intent rather
than silently accepting location-bearing bytes, and admits such media only
under an explicit retain declaration. Generic file lifecycle support cannot
silently accept location-bearing media while omitting the declared privacy
step.

The authorizer uses the same closed inline-handler graph, declared reads, and
source-custody rules as LLP 0108. This RFC does not authorize runtime closure
serialization, inferred permissions, caller-authored authority, or public
manifest execution. The generated intent reference is available to
Contract/Exact, the framework-neutral client, React/Expo, CLI fixtures, and
acceptance tools.

An intent may declare bounded arguments such as a post id or workspace id.
Those arguments help authorize the upload; they are not permission-bearing
client claims. The server resolves all referenced rows and authority itself.

### Client upload surface

The framework-neutral client owns the task. Conceptually:

```ts
import { createAssetClient } from '@expo/snapback-client'

const task = createAssetClient(client).start({
  upload: api.avatarUpload,
  args: {},
  file,
})
```

The first-party React/Expo projection follows LLP 0114's generated-reference
and provider rules:

```ts
const upload = useSnapbackAssetUpload({
  upload: api.avatarUpload,
})

await upload.start(file)
```

The task exposes a closed snapshot containing:

- stable `assetId` / typed `assetRef`;
- optimistic local `previewUrl`;
- status and structured diagnostic;
- bytes transferred and total bytes when knowable;
- `pause`, `resume`, `cancel`, and `retry`;
- the current upload-attempt id and expiry;
- trusted asset availability and ready rendition metadata.

The client persists only the minimum resumable task facts, partitioned by the
same app and authority identity as the prepared binding. It never persists a
bearer URL as permission truth or lets one user's successor session resume
another user's attempt. Web refresh and Expo app restart may rediscover and
resume a still-authorized attempt. Provider replacement, logout, or authority
change synchronously hides the preview/task from the old authority and
generation-fences late work.

`retry()` creates a successor upload attempt for the **same asset id** while
the pending asset remains eligible. An expired transport session therefore
does not force the UI or an already-attached optimistic row to change asset
identity — the [LLP 0107](./0107-react-presence-and-optimistic-lifecycle.spec.md)
optimistic lifecycle applied to media. If the intent or authority no longer admits the asset, retry refuses
and the asset remains durably rejected or pending until explicit replacement
or policy GC. Attempts exist only for `pending` assets: a `ready`,
`rejected`, or `deleted` asset admits no further upload attempts, so a stable
attached id can never change content after publication. Replacement is a new
asset attached through an ordinary mutation.

The React package also provides asset renderers or equivalent prepared
helpers:

- an image surface that moves from local preview to placeholder to best
  responsive rendition without app-authored polling;
- an image `srcset`/pixel-density projection from declared renditions;
- automatic refresh of bounded signed delivery URLs before expiry;
- a video surface with poster selection and range-aware playback;
- typed fallbacks for pending, rejected, deleted, unsupported, and rendition
  failure.

These are projections over the framework-neutral asset client and live store,
not a React-specific transport, cache, or auth model.

### Language-neutral protocol and SDKs

The asset subsystem is not a JavaScript API with other languages as wrappers.
LLP 0012's headless contract is normative. Upload-intent references, task and
asset state, request/response DTOs, live lifecycle messages, capability facts,
and `SNAPBACK_ASSET_*` diagnostics are Rust-owned, schema-generated protocol
artifacts under LLP 0037.

JavaScript examples in this RFC illustrate authoring and one client projection;
they do not define the wire. A conforming generated SDK for Swift, Kotlin,
Python, or another language can:

- invoke a generated upload intent with typed arguments;
- create, discover, pause, resume, cancel, retry, and finalize an upload
  attempt;
- stream bytes or follow target-specific TUS/multipart instructions without
  exposing storage credentials;
- observe trusted asset and rendition lifecycle updates;
- request delivery under the asset's declared profile;
- pass the typed asset id to an ordinary generated mutation for attachment;
- receive the same structured receipts, capability refusals, and diagnostics.

All SDKs consume the same canonical generated reference identity and protocol
schemas. They never parse JavaScript source, infer intent policy from naming,
or substitute handwritten route strings. Unknown protocol versions,
capabilities, intent members, state variants, or delivery profiles fail closed
according to LLP 0012's compatibility rules.

Language bindings may differ idiomatically—async sequences in Swift,
coroutines/flows in Kotlin, async iterators in Python, promises/external stores
in JavaScript—but must preserve one state machine and observable semantics.
UI integrations such as React components, SwiftUI views, or Jetpack Compose
wrappers are optional projections over that headless SDK. The absence of a UI
wrapper never prevents a language client from using the full asset lifecycle.

The conformance corpus is transport-level and language-neutral. Each published
SDK must run the same golden lifecycle vectors and at least one real upload,
resume, attachment, live-ready, authorized-range, delete, and negative-auth
scenario against the canonical local target before the SDK claims the
asset-lifecycle client conformance.

SDK staging follows LLP 0064, and this RFC commissions no new SDK program:
JavaScript and Swift are the committed maintained artifacts, Kotlin is
reference evidence until its packaging/ownership/CI surfaces land, and Python
and other languages are future clients. Passing the protocol vectors against
the local target establishes protocol conformance only; a supported
client-distribution claim additionally requires LLP 0064's packaging,
ownership, and per-OS evidence. The conformance corpus defines what any SDK
must pass to claim; it does not by itself commit any language to exist.

### Internal model

Four records have distinct jobs.

#### Asset

The app-visible stable logical resource:

- asset id;
- app id and upload-intent id/hash;
- owner principal and authorization dependencies;
- declared delivery profile and read-access policy;
- availability: `pending | ready | rejected | deleted`;
- current primary-rendition id;
- created/updated/deleted timestamps;
- policy and lifecycle generations.

The two generations are fencing facts with defined bump events, and neither
requires fan-out writes across assets. The **lifecycle generation** is
per-asset and increments on that asset's own events only: every
availability transition, replacement admission, deletion, GC decision, and
operator retry; late work carrying a stale lifecycle generation is refused.
The **policy generation** is per-intent, not per-asset: it increments when
a changed intent deploys (an O(1) deployment-time event), and each asset
records the intent policy generation it was admitted under. An open attempt
finalizes under that frozen policy; deploying a changed intent bumps the
generation, and a revoked generation makes finalization refuse with a
structured diagnostic rather than silently applying newer policy to bytes
admitted under older policy. Revocation has exactly three triggers, all
explicit: the intent is removed from the deployed artifact; a deployment
is flagged as revoking (the security-fix posture — the author is saying
prior policy must not finalize anything further); or an operator runs the
authenticated revocation action. An ordinary redeploy bumps without
revoking, so open attempts finalize under their frozen policy.

Authorization changes are not generation events at all — a membership
change may affect arbitrarily many assets, and nothing enumerates them.
Instead, admission captures an **authorization witness**: LLP 0007's
complete read-set witness, not merely versions of returned rows — the row
ids read, the rows observed missing, the query ranges, index cursors, and
table predicates consulted, and the caller's LLP 0053 authorization pair —
plus the admitted policy identity. Absence is a first-class dependency: an
authorizer that admits because no blocking row exists captures that
absence, and a later phantom insertion moves the witness.

Witness validation is **re-validate, then refuse only on denial** — not
refuse-on-any-movement. LLP 0007 applies raw version comparison across a
transaction window of milliseconds where the recovery is a cheap retry;
this witness spans an entire transfer, minutes to days for a large
resumable upload, and its "retry" would be re-uploading the bytes. So
finalization checks the witness inside its own transaction, and when
nothing moved, publishes; when something moved, it re-runs the authorizer
under the admission-frozen policy generation and current authority,
capturing a fresh witness in the same transaction. The re-validation
substrate is the **frozen generation's authorizer code**, not the current
deployment's — coherent with attempts finalizing under frozen policy —
which carries a bounded artifact-retention obligation: the deployment
layer retains a superseded intent generation's artifact until the last
open attempt admitted under it terminates or its TTL expires. A fresh
decision that
admits with materially identical output publishes — "materially
identical" is pinned as equality of the schema-validated authorizer
output DTO, so the rule has no fuzz — and benign churn in the declared
reads never strands an upload. A
fresh decision that denies, or that admits differently (a different
owner), refuses with a structured diagnostic. Between boundaries,
revocation reaches live metadata and strict delivery through 0053's
versioned obligations checked at each governed boundary, never through
per-asset counter updates.

Application rows may contain only typed asset ids. They never contain blob
keys, staging keys, signed URLs, upload-attempt ids, or rendition ids.

#### Upload attempt

One bounded transfer/finalization attempt:

- attempt id and predecessor attempt id;
- asset id, app id, intent identity, authority, and lifecycle generation;
- opaque target-specific staging key or upload resource;
- declared filename, size, and content type;
- observed transfer offset/parts and target transport checksum facts;
- expiry, cancellation, trusted timing, and structured failure;
- state:
  `open | transferring | finalizing | complete | expired | cancelled | failed`.

Attempts are append-only lifecycle evidence. Retry creates a successor; it
does not reopen a terminal attempt.

**At most one current attempt exists per asset.** Creating a successor
attempt atomically supersedes the predecessor: the predecessor transitions to
`cancelled` (recorded as superseded) in the same transaction that opens the
successor, and its staging resource is fenced at the store before the
successor returns upload instructions. Only the current attempt can
finalize; a superseded or otherwise terminal attempt's late completion is
refused by the lifecycle-generation fence. Two tabs racing resume-vs-retry
therefore converge on one winner with a structured diagnostic for the loser,
never two publishable byte streams for one asset. Operator retry of
finalization follows the same rule: it never reopens a terminal attempt, it
either re-drives the current attempt's pending finalization work or creates a
successor attempt under fresh authorization.

#### Blob

One immutable set of trusted canonical bytes:

- blob id;
- app-scoped store and opaque physical key;
- exact size and trusted detected content type;
- canonical content-digest algorithm and value;
- transport-integrity facts, when distinct;
- creation/finalization policy and generation;
- reference count and deletion state.

The physical key is deliberately opaque, not the content digest. The digest is
a verified property of canonical bytes and may be used for integrity,
deduplication, and migration without making upload addressing depend on bytes
the server has not seen yet.

#### Rendition

One immutable deliverable representation of an asset:

- rendition id and parent asset id;
- variant key (`primary`, `thumb`, `display`, `poster`, and so on);
- blob id;
- width, height, format, duration, orientation, and other typed media facts
  where applicable;
- producing recipe/step and version;
- state: `pending | ready | failed | superseded | retired`;
- created/updated timestamps and structured failure.

Renditions are durable, queryable system records but are not app-referenceable
asset ids. This preserves declarative selection without allowing an app row to
hold a child that parent deletion is supposed to cascade. Renditions inherit
the parent asset's authorization and delivery profile.

### Asset read authorization

The LLP 0039 gate resolves caller authority; it does not by itself decide
which authenticated caller may read which asset, and LLP 0011 records that no
general permission language exists. Asset read authority is therefore its own
declared, generated fact — the intent's read-access policy — evaluated on
every governed read boundary:

- **`owner-only`** (default): metadata visibility and byte delivery require
  the caller's server-resolved principal to be the asset's owner.
- **`via-references`**: the caller may read the asset if at least one app
  row holding a typed reference to it admits the caller under that table's
  **asset-sharing-declared row-visibility policy**. The system-maintained
  reverse-reference index supplies the candidate rows; the decision
  procedure is pinned, not query-relative: LLP 0011 separates
  pushdown-compilable declared row-visibility filters — a pure function of
  the document and the caller's resolved authorization facts — from
  function-level authorization, which is arbitrary handler code with no
  evaluable per-row predicate, and 0011's composition model makes
  effective query permission the composition of both. A row-visibility
  filter alone can therefore be *broader* than any query path actually
  exposes. So `via-references` never infers sharing authority from a
  filter's mere existence: a table confers read authority only when the
  schema **explicitly declares** its analyzable row-visibility policy
  sufficient for asset sharing — an app-authored statement that "anyone
  this filter admits may also read assets referenced from these rows,"
  independent of any function-level gate a query adds on top. A typed
  reference on any other table — no analyzable policy, or an analyzable
  policy without the sharing declaration (including mixed tables whose
  function-level checks narrow access) — confers no read authority, and
  the asset falls back to owner-only through that edge. Deploying a
  `via-references` intent whose `v.assetRef` fields can inhabit
  non-sharing-declared tables emits a deployment warning listing them, in
  the same idiom as the reference-GC warning; the enumeration covers
  restriction-less `v.assetRef` fields too, since handler-side `attach`
  can place any intent's asset in them. An unreferenced asset is
  readable only by its owner.
- **Active recipient grant**: independently of the ordinary intent policy,
  the caller may read when a system grant edge names that principal and is
  `active`. The asset's admission-frozen policy must have captured
  `grants: true`; `pending` edges confer no authority. Owner-only plus a grant
  edge is the paved view-once composition because no recipient-visible
  reference path bypasses activation or revoke.

Read decisions capture their dependencies — owner identity, the referencing
row's fields and the caller's resolved authorization facts (the declared
filter's exact inputs, enumerable because the filter is analyzable), and
the admitted policy identity — plus matching active grant identity/state when
that edge supplies authority — and project into
[LLP 0053](./0053-authorization-invalidation.rfc.md)'s invalidation
machinery the same way query authorization does: a revocation, membership
removal, reference removal, logout, or deletion invalidates dependent live
metadata subscriptions and strict delivery on the next governed boundary.
Live asset state observed by a principal that loses access blanks; a
`private-strict` byte request after the invalidating event denies. Signed
and public profiles retain exactly their declared weaker windows
(§Delivery profiles); the read-access policy governs issuance, not
already-issued bearer authority.

Attachment interacts with read authority but does not replace it: attaching
an asset to a row a principal can read grants that principal read access
under `via-references`, and detaching removes it, both taking effect with
the reverse-edge change. A generated custom read authorizer beyond the two
closed spellings is a later capability with its own invalidation
obligations.

### Lifecycle transitions

The complete legal transition set. Anything not listed is refused with a
structured diagnostic.

Upload attempt (`open | transferring | finalizing | complete | expired |
cancelled | failed`):

| From | To | Cause |
| --- | --- | --- |
| open | transferring | first accepted bytes |
| open, transferring | finalizing | transfer complete, finalizer claimed |
| finalizing | complete | trusted finalization published |
| open, transferring, finalizing | expired | TTL passed (mandatory GC) |
| open, transferring, finalizing | cancelled | client cancel, or superseded by a successor attempt |
| open, transferring, finalizing | failed | structured refusal (integrity, policy, quota, resource) |

Terminal attempt states (`complete | expired | cancelled | failed`) are
final; retry is always a successor attempt, admissible only while the parent
asset is `pending`.

Asset availability:

| From | To | Cause |
| --- | --- | --- |
| pending | ready | current attempt finalized; primary and all required renditions published |
| pending | rejected | current attempt terminally failed a policy/integrity refusal the intent can never satisfy |
| pending | deleted | explicit delete/cancel-and-discard by an authorized caller, or pending-asset GC after grace |
| ready | deleted | explicit authorized delete (refused while typed edges remain, absent a future force profile), or opt-in reference-tracked asset GC after its grace period once no typed edges remain |
| rejected | deleted | explicit delete, or pending-asset GC after grace |

An unreferenced `pending`/`rejected` asset that GC reclaims transits
`deleted` and is then purged with its receipts' retention window; a
referenced one tombstones as `deleted` so the app can observe and repair the
broken state. Attempt outcomes map to asset outcomes as follows: attempt
`expired`/`cancelled`/`failed` leaves the asset `pending` (retry-eligible)
unless the failure is a policy refusal the intent can never satisfy, in
which case the asset becomes `rejected`; only finalization moves an asset to
`ready`.

Rendition: `pending → ready | failed`, with `ready → superseded` when a
newer same-lineage recipe run switches the variant pointer, and
`pending | ready | failed | superseded → retired` when the parent asset is
deleted. A required rendition's `failed` fails finalization (asset stays
`pending` for retry or becomes `rejected` on a permanent refusal); an
optional rendition's `failed` never gates the asset.

**The deletion cascade is one transaction.** Deleting an asset tombstones
the asset row and bumps its lifecycle generation, retires every rendition
row, decrements the blob reference held by each rendition row — the
primary rendition included **exactly once**, because primary bytes are
represented exclusively by the `primary` rendition record and there is no
second asset-to-blob edge — settles the logical-quota release, and leaves
newly zero-referenced blobs GC-eligible (condemnation remains blob GC's own transactional step). The
lifecycle-generation bump fences in-flight recipe and ledger work: a
running recipe for a deleted asset fails its generation check at publication
and cleans up its output. Nothing about deletion leaks a rendition
reference or releases quota while a charged rendition still holds a blob.

### Restricted staging and trusted finalization

All transfers, including direct-to-object-store transfers, terminate in an
opaque restricted staging object. A staging object:

- is scoped to one app, asset, attempt, and expiry;
- is never addressable through ordinary asset delivery;
- is denied to other principals and app code;
- may contain raw metadata temporarily;
- is deleted after successful finalization or mandatory session GC.

Completion is idempotent on attempt id plus lifecycle generation. The trusted
finalizer:

1. proves the attempt is current, complete, unexpired, and authorized;
2. verifies exact length and transport integrity;
3. detects content type from bytes and records declared-versus-detected facts;
4. enforces the generated intent's media-type and size policy;
5. applies required privacy/canonicalization policy;
6. computes the canonical cryptographic content digest;
7. reuses or creates an immutable app-scoped blob (§Publication and crash
   recovery);
8. publishes the primary rendition, produces any renditions the intent marks
   required, and switches asset availability to `ready` atomically with the
   last required publication — required renditions are part of the
   asset-ready contract, optional ones never gate it; and
9. schedules optional renditions, then removes staging bytes.

No target may advertise `asset-lifecycle-v1` if it can mark an asset `ready`
without an integrity mechanism sufficient for that target's claim. A target
may use native checksums, bounded server read-back, or a trusted streaming
finalizer, but “verify where available” is not a correctness contract.

#### Local finalize lock choreography (implemented 2026-08-09)

The local HTTP finalize route is a five-stage choreography over three global
writer windows and the same lifecycle and publication kernels. A first
`with_snapback` call performs the existing idempotency/current-attempt checks,
loads the frozen intent artifact, checks generation revocation, and returns
either the already-complete response or an immutable prepare ticket. The
ticket carries the attempt and lifecycle generation fence, frozen intent and
callback policy, schema/quota/capability facts, and a config-derived
clone-shared byte-store handle; it carries no `LocalSnapback` or database
borrow.

The route then releases the global Local writer and runs the repeatable prepare
on the blocking pool. Staging hash/read, trusted detection, canonical rewrite,
image/video inspection and CPU, ThumbHash/fact derivation, and required-variant
renders occur in this interval. Prepare creates no durable database state: its
only write is the repeatable canonical rewrite under restricted staging
custody, and required-variant outputs remain uncommitted bytes in the
preparation result.

A second `with_snapback` call executes Phase A. It rechecks the admitted intent
generation's revocation bit and reloads the attempt through the same
authority/lifecycle/current-state gates before committing `planned`. A
revocation that lands while prepare runs therefore refuses fail-closed with
`SNAPBACK_ASSET_INTENT_REVOKED`, before any publication record is planned; this
is the deliberate behavioral delta from the former single-lock hold, which
made that interleaving impossible.

**Dated amendment (2026-08-10).** After Phase A commits, the route releases the
writer again and performs Phase B's idempotent canonical object put plus
digest/length verification on the blocking pool. A third `with_snapback` call
then reloads the attempt before Phase C, commits `staged` only after the put was
acknowledged, and runs Phase D publication. Two prepared finalizers can both
serialize through Phase A while the first put is in flight: the first creates
`planned`, the other receives its exact key, and both puts are idempotent to
that key. Whichever reaches Phase C first publishes; the other reloads the
complete attempt and returns the ordinary idempotent completion outcome, with
no second completion receipt.

Crash cuts remain unchanged. Phase A still commits `planned` before Phase B's
object put; Phase C still commits `staged` before Phase D publishes the blob,
renditions, and asset readiness. A crash after Phase A and before the put leaves
a re-drivable `planned` record without an object; a crash after the acknowledged
put and before Phase C leaves `planned` plus a verified object for recovery to
stage. The retained in-process `asset_attempt_finalize` composes the same phases
inline for callers already inside an outer Local guard, including seed-fixture
ingestion.

No maintenance grace changes accompany the longer unlocked window.
`publication_maintain` does not condemn an objectless or not-yet-verifying
`planned` record while its attempt remains current; once the object verifies it
may safely advance the record to `staged`, which Phase C accepts. The separate
pending-asset grace also excludes assets with a live `finalizing` attempt. The
six-hour attempt expiry remains the intentional overall transfer/finalize
bound: if a put outlives it and the GC sweep expires the attempt, Phase C keeps
the existing terminal refusal and publication maintenance condemns the orphan.

Deterministic prepare refusals (byte/policy refusals and required-variant
render refusals over trusted canonical bytes) do not error out of the route:
they return through the lock-held commit half so the attempt failure and its
receipts are recorded exactly once. Because required variants now render
during prepare, such a refusal surfaces before any publication record is
planned — under the former choreography the primary publication reached
`staged` first and the failure trail included those records. Transient store
errors remain ordinary errors that leave the attempt current and retryable.

Transport integrity and canonical content identity are separate facts. A
multipart composite checksum may prove parts arrived correctly without being a
digest of the byte sequence independent of part boundaries. Neither an ETag
nor an unverified client-supplied digest silently becomes the blob's canonical
digest.

For location-bearing media whose intent says `location: "strip"`, raw
staging may briefly contain location metadata under restricted custody, but
no ready/deliverable canonical blob may retain it. Finalization rewrites the
primary bytes before digesting and publication, and mandatory GC deletes the
raw staging object. An explicit intent may opt into retaining location; the
choice is generated policy and appears in lifecycle evidence. In v1 the
rewriting capability exists for images only (`asset-image-finalization`);
video intents admit only under explicit retain until an
`asset-video-finalization` fact exists (§Generated upload intents).

### Publication and crash recovery

Database rows commit atomically with each other; filesystem and
object-store writes cannot join that transaction. Publication therefore
never relies on cross-substrate atomicity. The finalizer and every recipe
run follow a write-ahead publication protocol:

1. **Record intent first.** A durable publication record naming the planned
   opaque object key, digest, canonicalization policy, and generation
   commits before any canonical object write. Orphaned objects are therefore
   always discoverable from publication records, never only from store
   listings. The publication record's states are closed:
   `planned → staged | condemned` and `staged → committed | condemned` —
   `planned` before the object write, `staged` after the object write is
   acknowledged, `committed` when the blob row references the object,
   `condemned` when recovery, cancellation, or a lost uniqueness race
   abandons it; a condemned record's object, if one exists, is deleted by
   the reconciliation sweep. Committed records retire after a declared
   retention window (the blob row is the durable evidence from then on)
   and condemned records retire once their object deletion is receipted —
   retirement is itself a receipted GC step, so the publication-record
   ceiling can never silt up into a permanent upload limit.
2. **Idempotent store writes.** Object puts are idempotent on the recorded
   opaque key; re-running a crashed step re-puts or verifies the same
   object. The crash cuts are covered exhaustively: a crash after the
   object put but before the `staged` commit leaves a `planned` record and
   a real object — recovery inspects every `planned` record, probes its
   recorded key, and transitions it to `staged` when the object exists and
   verifies, or to `condemned` when it does not and the work is no longer
   re-drivable (attempt superseded, cancelled, or retry-exhausted); a
   crash after `staged` leaves a record recovery either completes to
   `committed` or condemns. The reconciliation sweep resolves stale
   `planned` and `staged` records alike.
3. **Uniqueness and reuse under one transaction.** Blob identity is unique
   on `(app, digest algorithm, digest, canonicalization policy)` under a
   database constraint. Dedup reuse acquires its reference in the same
   transaction that checks GC eligibility: a blob condemned for deletion is
   never reusable, and a blob acquiring a new reference is no longer
   condemnable — blob GC marks a blob `condemned` transactionally before
   deleting bytes, closing the reuse-versus-GC race in the record layer,
   where fencing is provable. When two finalizers race the same
   `(app, digest algorithm, digest, canonicalization policy)` identity, the
   uniqueness constraint picks one winner; the loser's publication record is
   condemned, its object is cleaned by reconciliation, and in the same
   transaction the loser acquires a reference to the winner's blob — the
   race converges on one stored object with both assets published.
4. **Reconciliation sweep.** A mandatory sweep (same runner substrate as
   processing) resolves stale `planned` and `staged` publication records,
   deletes condemned and orphaned objects, and repairs reference counts;
   every repair emits a receipt. Reference-count transitions occur only inside the transactions
   above — there is no unfenced increment/decrement path.

Store migration uses the same protocol: copy under a recorded migration
record, verify the recorded canonical digest, and switch blob placement
under a fenced generation; a crash at any cut resumes or rolls forward from
the records. Every crash cut named here — before/after object write,
before/after row commit, mid-migration, mid-condemnation — is an acceptance
fault-injection case.

### Deduplication, keys, and quotas

V1 deduplication is scoped to one app. After trusted digest computation, the
finalizer may reuse an existing immutable blob with the same digest and
canonicalization policy. Asset and rendition rows still remain distinct.

Cross-app physical deduplication is a non-goal for the initial capability. It
would introduce existence/timing side channels, cross-tenant retention
coupling, and ambiguous quota economics. A later storage optimization may
share encrypted physical bytes only if application-visible timing,
authorization, deletion, and quota semantics remain unchanged. Within one
app, finalization-time dedup leaves a residual cross-principal timing
channel (a second upload of known bytes finalizes marginally faster); it is
weak — finalization still verifies, rewrites, and digests the full staging
bytes — and this RFC accepts it explicitly rather than silently.

Per-app quota is based on **logical owned bytes**, not physical dedup savings:
uploading the same ten-megabyte file twice consumes twenty megabytes of the
app's logical quota. This makes limits predictable and prevents dedup from
becoming an oracle or quota bypass. Targets may additionally report physical
storage for operations, but it is not the app contract.

The accounting vector is exact, not a single number:

- **reserved bytes** — held by open attempts (below);
- **canonical logical bytes** — the sizes of the blobs referenced by an
  asset's rendition records, the `primary` rendition included exactly once
  (primary bytes have no separate asset-to-blob edge); renditions count
  against the app's logical quota because the intent declares them, so the
  multiplier is the app's own declared recipe, not a surprise; one blob
  reference and one quota charge exist per rendition record, never more;
- **staging bytes** — restricted partial bytes, bounded per attempt and per
  app as capability facts;
- **bounded counts** — every durable record class has per-app (and, where a
  principal can mint records, per-principal) ceilings reported as
  capability facts: open attempts, asset records of any availability,
  renditions, reverse-reference edges, publication records, asset-work ledger
  rows, and recipient grants. Recipient grants have a per-app ceiling of
  1,024, charged to the minting asset owner and counting `pending` plus
  `active`; revoke releases one slot in the same transaction. Receipts are
  bounded by declared retention windows. No
  workload — zero-byte spam, repeated rejection, retry storms, crash loops
  — grows durable state without hitting a declared ceiling, and each asset
  consumes a declared **minimum accounting unit** of logical quota so
  zero-byte assets are not free;
- **physical headroom** — staging bytes, canonical bytes, orphaned objects
  awaiting reconciliation, and migration copies are reported as operational
  physical facts, with the staging ceilings `Enforced`; physical facts
  never replace the logical contract.

Attempt creation reserves the declared file length (every v1 lane requires a
known length — §Byte stores) against remaining quota before returning an
upload resource. Finalization settles the reservation to exact canonical
logical usage in the publication transaction; rendition publication settles
its own increment the same way — a rendition whose settlement would exceed
remaining quota refuses as a structured rendition failure, gating `ready`
only if the rendition is required — and canonicalization that would expand
beyond the intent's byte bound refuses rather than overrunning. Terminal
attempt cleanup releases any unused reservation — for a direct object-store
attempt, only after the staging resource is fenced at the store (multipart
aborted or completion refusably fenced), so released quota can never race
still-landing bytes. Deletion releases logical usage when the tombstone
commits; physical bytes follow blob GC and retention separately. Concurrent
attempts therefore cannot pass a preflight against the same remaining quota
and overrun it at completion.

Store-to-store migration copies opaque immutable blobs, verifies their
recorded canonical digests, and switches blob placement under a fenced
generation. Content verification and reconciliation survive even though the
physical key is not the digest.

The digest algorithm remains a manifest fact and may evolve behind a versioned
blob identity. The API exposes integrity facts only where useful; it never
requires every browser, native client, and S3-compatible target to implement
the same hashing primitive merely to start an upload.

### Typed references and atomic attachment

The schema vocabulary gains a typed asset reference, conceptually
`v.assetRef()` with an optional upload-intent restriction. Scalar and
optional placements are explicit schema nodes; the bounded-array placement
was withdrawn by the author's 2026-07-31 decision (the portable field
vocabulary ships no array table fields — multi-asset relationships use one
row per asset in a child table, the LLP 0110 bounded-children idiom; see
LLP 0007's amended companion note). Arbitrary strings that
happen to equal an asset id are not references.

In a mutation, application code admits a client-provided id through the asset
authority:

```ts
await ctx.db.update("profiles", args.profileId, {
  avatar: await ctx.assets.attach(args.assetId, {
    upload: api.avatarUpload,
  }),
})
```

Attachment verifies, under the mutation's server-derived authority:

- app and upload-intent identity — when both the `v.assetRef()` intent
  restriction and the `attach` call's `upload` argument are present they
  must agree; disagreement refuses;
- owner and attachment policy;
- asset lifecycle generation;
- allowed availability (`pending` may be allowed for optimistic attachment,
  per the attachment policy);
- target capability and schema-field compatibility.

**Enforcement lives at the storage commit boundary, not in the helper.**
Every `v.assetRef` field — scalar or optional (the array placement was
withdrawn by the 2026-07-31 ruling; this clause predated it), on every
write path: Ibex handler, host plan, seed, import, migration, and admin
edit — is validated when the changeset commits. `ctx.assets.attach` is the
ergonomic authorized admission; the commit hook is the authority. A raw
string written directly into an asset field (`{avatar: args.assetId}`)
fails the commit with `SNAPBACK_ASSET_REF_UNVERIFIED` because it carries no
admission. Admission is re-validated at commit time in the LLP 0007
commit-time-validation idiom — the asset's lifecycle generation and the
admission's authorization basis are compared inside the final write lock —
so deletion, ownership change, or revocation racing between the attach
check and the commit refuses instead of committing a stale admission.

The admission itself is a transaction-scoped host record, never app data:
`ctx.assets.attach` records an admission entry inside the mutation's own
transaction, keyed to the asset id, field placement, and lifecycle
generation, and returns the typed value to write. The commit hook accepts
an asset-field write only when a matching in-transaction admission exists.
Nothing about the admission serializes, persists, or crosses a transaction
boundary, so app code cannot construct, store, or replay one. Write paths
without server-side handler execution — host plans foremost, plus seed,
migration, and admin edits — cannot call `attach`, so for them **the
commit boundary itself performs the admission**: it derives the full
admission check (intent identity, owner and attachment policy, lifecycle
generation, availability) from the field's schema-declared `v.assetRef`
intent restriction and runs it under the path's own authority inside the
committing transaction. Per the 2026-08-01 ceremony amendment, a bare
`v.assetRef()` field derives a default intent and therefore carries a
restriction like any explicitly restricted field; only the explicit
`v.assetRef({upload: null})` spelling is restriction-less, and *that*
shape is attachable only through handler-side `attach` — host plans and
system paths refuse it, since the commit boundary has no declared intent
to check against. The flagship ordinary-mutation
attachment works on both shapes: a handler mutation via `attach`, a
host-plan mutation via the schema-derived commit-boundary admission. Logical import of rows carrying `v.assetRef` fields refuses
while the export/import capability is a declared Missing nonclaim — an
import cannot re-admit references to assets whose consistent cut the
system cannot yet prove, and this is the intended consequence of the
nonclaim, not an oversight.

The ordinary row write and a system reverse-reference edge commit in the same
storage transaction. Updating or deleting the field updates the edge in the
same changeset; row deletion removes its edges the same way. This provides:

- cross-principal and cross-app asset-id hijack prevention;
- an exact reference set for GC and operator inspection;
- ordinary replacement semantics with no bespoke avatar API;
- a typed path from app row to live asset metadata;
- a safe distinction between referenced pending assets and abandoned ones.

Recipient-grant transitions use the same pattern. `ctx.assets.grant`,
`activate`, and `revoke` stage transaction-scoped host operations; the final
write lock re-reads the asset/grant state, authorization, frozen opt-in, and
quota before committing the system edge with app writes and receipts. A
handler refusal leaves neither kind of write behind, and a replayed mutation
returns its original ledgered `agr_` identity instead of minting another edge.

The upload restriction and finalized-media descriptor participate in the
field's semantic type identity: upload/media intent, policy generation,
accepted media kinds, delivery policy, variants, classification profile,
retention class, and target capability. An installed field may therefore
refuse a changed declaration as `SNAPBACK_SCHEMA_FIELD_RETYPED` even when both
display names are `AssetRef`. That refusal carries a bounded `semanticDelta`
whose entries name the changed fact and bounded old/new values. It offers two
distinct repairs: preserve data by adding a nullable successor field and
repopulating it through ordinary authorized application mutations (the path
that re-runs successor policy admission and reverse-edge maintenance), or
discard the canonical managed development store with the ownership-validated
whole-store `snapback reset --dev-fresh`. Generic migration copy/backfill is
explicitly not AssetRef-safe and is not recommended; the predecessor remains
until an AssetRef-aware retirement migration exists. Stale generated artifacts
are not diagnosed as a policy-compatible in-place retype.

The generated field type, attach helper, reverse-edge record, and codegen
projection must be single-sourced under LLP 0007/0037. The client cannot
manufacture an admitted asset reference by casting a string. Contract/Exact
gets either an exact supported descriptor or a structured missing witness; the
mapping is never lossy.

System-owned metadata remains the authority. Apps may query authorized
projections through generated asset references/helpers; they need not copy
storage keys, detected media facts, or processing state into app tables.

### Byte stores and resumable transfer

There are exactly two store implementations:

- local filesystem under the instance directory;
- one S3-compatible object-store seam.

R2, Tigris, S3, Backblaze B2, MinIO, and GCS interop are configurations of
the same S3-compatible adapter, not product-specific storage APIs. Each target
still earns an independent capability claim because supported checksum,
multipart, conditional-write, range, copy, delete, CORS, and signed-URL
details differ.

The store interface covers:

- create restricted staging;
- append/upload part and inspect acknowledged progress;
- complete, cancel, expire, and delete staging;
- stream/read back for trusted finalization;
- put immutable canonical blob;
- head/read range/delete/copy immutable blob;
- produce delivery instructions only for an admitted delivery profile.

The local/proxied resumable lane implements the TUS 1.0.0 core plus the
creation, expiration, checksum, and termination extensions needed by this
RFC. It does not invent a Snapback-specific append protocol. Snapback
authentication, generated-intent admission, quota, and asset identity wrap
the TUS resource; TUS itself is not the authority model.

Every v1 lane requires a known total length at attempt creation. The TUS
lane does not implement `creation-defer-length`, and the S3 lane does not
claim unknown-length multipart; deferred-length streaming sources are future
work with their own reservation rule. Chunk checksums are client-optional in
TUS, so integrity is a graded fact, and the grades are named honestly. A
transfer whose every chunk carried a client checksum (generated Snapback
clients send one on every `PATCH` — a conformance requirement), or that
supplied an authenticated whole-upload digest, finalizes as
**end-to-end verified**: the canonical bytes provably match what the client
intended to send. A checksum-less foreign TUS client's transfer finalizes
as **received-bytes canonical**: the finalizer's full read-back proves
length-complete receipt and establishes the canonical identity of the bytes
that arrived, but a freshly computed digest names those bytes — it cannot
detect that transport altered them in flight, because there is no
independent expected value to compare against. The grades are
lane-neutral: an S3-lane multipart transfer whose every part carried a
client checksum earns end-to-end verified the same way. Receipts and the
manifest carry the grade; no claim promotes the weaker grade to the
stronger one.

The first implementation slice is the local lane end to end. The
S3-compatible seam is designed here so the abstractions hold, but each
provider qualification is separate later evidence; nothing in the local
slice's acceptance depends on any S3 commitment.

The S3-compatible lane maps the same headless task to native multipart upload
and target-specific signed instructions. Bytes do not transit the initiating
Snapback request handler, although a trusted finalizer may stream restricted
staging bytes later to detect, sanitize, digest, or generate renditions.

Per-file size, pending bytes, attempt count, session TTL, app logical quota,
multipart bounds, and finalizer-read bounds are capability facts reported as
`Enforced`, `Advisory`, or `Missing`. Core admission requires the bounds that
protect the claimed target; a client does not guess from provider branding.

### Delivery profiles

The upload intent chooses one of three application-level profiles. The default
is `private-strict`.

**URL identity.** Every delivery URL, on every profile, addresses an
`(asset, rendition)` alias. Blob object keys never appear in any URL, and
the object store's namespace is never directly exposed. Because two assets
sharing one deduplicated blob have distinct aliases, deleting or revoking
asset A denies A's aliases at the origin without affecting asset B; blob
bytes outlive an alias only through the reference-counted blob GC. Cache
keys are per-alias: `public-immutable` aliases version by rendition id and
are safe to cache exactly because a rendition is immutable; `private-signed`
issuance binds the signature to the alias, the grantee's authorization
basis, the lifecycle generation, and the TTL — never to a blob path; and
`private-strict` responses carry `Cache-Control: private, no-store` so
authorized bytes are never cached past the authorization that produced
them.

#### `public-immutable`

Ready renditions receive immutable/versioned public URLs suitable for caching.
The profile promises no immediate revocation of already cached bytes. Delete
stops discovery and future canonical access, but cache expiry/purge is a
separate target fact. This is appropriate for public product images and blog
media, not private attachments.

#### `private-signed`

Every URL issuance is authorized, then the URL is a bearer capability until a
declared maximum TTL. The generated client refreshes it before expiry. Revoking
one principal or deleting the asset stops new issuance but cannot invalidate an
already-issued URL before its TTL without a target-specific stronger mechanism.
Signing-key or credential rotation may invalidate a wider set and is an
operator action, not per-principal revocation.

The signing key is instance-owned system material, not an app-declared LLP
0036 grant. It lives in the system store with a documented rotation path and
never appears in client references, receipts, or diagnostics.

> **Dated note — pasteable delivery lanes (2026-07-31, author-approved).**
> The public alias and the signed serve lane are exempt from the
> sessions-mode auth-client protocol-offer requirement. On these two
> routes the URL is the entire authority — the public alias carries no
> credential by design, and the signed lane's query token is the
> credential — while the protocol offer exists to version
> invalidation-capable protocol clients. Plain `<img src>` consumers,
> CDN pulls, and pasted share links can send no custom headers and
> negotiate nothing, so requiring the offer there defeated both
> profiles' declared purpose without protecting anything (found by the
> Party Wall diary, finding 7). The exemption is a closed route set
> asserted together with its structural properties
> (`pasteable_delivery_route` in the server's route policy); signed-URL
> **issuance**, strict delivery, and every other asset route keep the
> protocol-offer discipline unchanged.

#### `private-strict`

Every byte/range request passes through a Snapback-authorized delivery route.
Permission revocation and deletion take effect on the next request. The target
owns proxy throughput and egress and must report their limits. This is the
evidence-rich local default and the required profile when an application needs
immediate per-principal revocation.

Delivery policy follows the asset, not the deployment target. A target
advertises supported profiles and refuses an intent it cannot honor. A
deployment may support public and signed delivery while reporting strict
delivery missing, or the reverse; it may not silently weaken one into
another. One composition rule is fixed: `private-strict` is a required
member of the `asset-lifecycle-v1` composite — a target that cannot prove
strict delivery reports its other profile facts but does not claim the
lifecycle capability (§Capability facts).

All claimed video-capable profiles support HTTP range requests. Delivery sets
trusted `Content-Type`, `Content-Length`, `ETag`/version facts, cache policy,
and a safe `Content-Disposition`. Content types with active-content risk —
SVG, HTML, XML — are never served inline under any profile in v1: they carry
`Content-Disposition: attachment`, so a stored SVG cannot become a same-origin
script lane. The original filename is retained as metadata only after
sanitization and is never used as a physical key.

### Declarative processing and rendition publication

The initial image pipeline is declarative and implemented by trusted built-in
steps:

- content detection, image dimensions, and orientation;
- required privacy rewriting, including GPS stripping by default;
- one versioned placeholder representation;
- dominant color;
- bounded pre-materialized image renditions from the upload intent;
- durable per-rendition status and structured diagnostics.

An implementation chooses one placeholder algorithm for the first capability
and versions the metadata field. It does not expose blurhash-versus-thumbhash
as an everyday application decision unless evidence shows both are needed.

**Every processing input is adversarial**, including to trusted built-ins:
a small compressed file can decode to ruinous memory or CPU. In the LLP 0047
spirit, `asset-image-pipeline-v1` admission requires enforced ceilings, all
reported as capability facts: maximum decoded pixel count and dimensions,
frame/page count, decompression ratio, embedded-metadata size, decoder
memory and CPU time per step, output bytes per rendition, and a cumulative
per-asset processing budget. Decoding runs under an isolation posture the
target declares (bounded subprocess or equivalent containment on targets
that require it), with timeout and cancellation defined. Exceeding any
ceiling is a structured refusal, and a hostile-input corpus — truncated
files, decompression bombs, malformed metadata, dimension lies — is part of
the pipeline slice's acceptance, not an afterthought.

At-least-once processing never overwrites a rendition object in place. A
recipe run creates an immutable blob and rendition row, then atomically
generation-checks and switches the variant pointer. A stale run may clean up
its unreferenced blob but cannot replace a newer rendition. Regeneration
supersedes only outputs of the same recipe/version lineage.

The primary rendition becomes ready after required finalization. Optional
rendition failure does not make a usable primary asset unavailable. An intent
may mark a bounded rendition as required; then that requirement is part of the
asset-ready contract and capability admission.

Arbitrary app-authored byte-processing handlers are **not** part of
`asset-image-pipeline-v1`. Passing large byte streams through ordinary ibex
handlers would silently introduce a streaming API, new resource/custody rules,
retry semantics, and target-specific native dependencies. Apps may declare
lifecycle callbacks that receive typed metadata and asset/rendition ids, not
raw byte authority.

A future `asset-custom-processing-v1` may admit versioned trusted processors
with a separately specified streaming/effect contract. Heavy video
transcoding, HLS packaging, and ffmpeg-class work require a separately admitted
container-executor profile. LLP 0099 establishes useful executor fencing
precedent but owns migration execution; it is not by itself authority to run
asset jobs.

### Processing runner and idempotency

There are two runner generations:

- until LLP 0070's durable-work profile ships, the compatibility runner: a
  **durable asset-work ledger** driven by a bounded LLP 0028 cron sweep;
- when `durable-work-single-process-sqlite-v1` or a target-equivalent profile
  is available, completion enqueues version-pinned work transactionally and
  the asset pipeline becomes a consumer of LLP 0070.

The compatibility runner is specified, not hand-waved. Each unit of pending
finalization, rendition, or reconciliation work is a durable ledger row with
a claim, a lease and expiry, an attempt count against a declared retry
ceiling, a deadline, and structured failure state. The cron sweep is only
the scheduler: it claims leased-out ledger rows whose leases expired
(crash recovery), drives claimed rows through the shared generation-fenced
transition functions, and never records its own success as the work's
success — **every ledger row emits its own per-item receipts**, satisfying
LLP 0127's bar against cron-ledger job evidence, where sweeper receipts
would hide per-job failures. Capacity, lease duration, retry ceilings, and
deadlines are capability facts, and the ledger is drivable deterministically
for tests.

The ledger's states are closed:
`enqueued → claimed → done | retrying | exhausted | ambiguous | cancelled`,
plus `claimed → enqueued` when a lease expires — reclamation is an explicit
transition, not a mutation of claim metadata, so every crash-recovery step
appears in the receipts.
A row enqueues **in the same transaction** as the state transition that
requires the work (attempt completion, publication commit, deletion
cascade), so work is never lost between a transition and its enqueue.
`retrying` re-enters `enqueued` with an incremented attempt count and a
next-eligible time from the declared backoff facts; the retry ceiling
produces `exhausted`, a durable structured failure. `ambiguous` is reserved
for an external effect without a stable idempotency mechanism, per the
paragraph below. `cancelled` is the generation-fence outcome: rows whose
asset was deleted or superseded fail their generation check at claim or
publication and cancel with a receipt. Terminal rows are bounded by the
retention windows in the accounting vector; the reconciliation sweep GCs
them like any other durable record class.

Two corpus boundaries hold. While LLP 0070 is Draft, no capability report
claims durable background work from this runner (0070's own bar); the
asset-work ledger is asset-domain machinery, not a generic queue. And LLP
0070's first profile admits generated host-plan actions only — a trusted
raw-byte asset processor is not admissible to it as specified — so the
second runner generation requires the amendment LLP 0070 itself anticipates
("they may amend their target profiles to enqueue asset … work"), admitting
a trusted built-in processor job class before the pipeline becomes its
consumer. The cron fallback must run independently of live subscribers;
closing the app cannot strand an uploaded image. It is a compatibility
implementation, not a claim that cron is an on-demand durable queue. Both
runners use the same generation-fenced, retry-safe transition functions so
changing runners does not change application semantics.

Every finalizer/recipe execution is at least once. Claims, attempt identity,
recipe version, blob publication, rendition pointer updates, callbacks, and
receipts are idempotent or fenced. An external effect without a stable
idempotency mechanism may become `ambiguous`; it is never silently retried as
though exactly once.

### Live asset lifecycle

Transfer progress is ephemeral presentation state. For a proxied upload the
server may publish acknowledged offsets; for a direct object-store upload the
local client task may know more recent progress. Client-reported progress is
never promoted to a trusted durable fact or used for authorization, quota
settlement, or readiness.

Trusted attempt transitions, asset availability, and rendition publication are
durable system-row changes observed over the existing live-query channel.
Conceptually:

- upload attempt:
  `open → transferring → finalizing → complete`, with terminal alternatives;
- asset availability:
  `pending → ready | rejected`, and `pending | ready | rejected → deleted`
  (§Lifecycle transitions is the normative table);
- rendition:
  `pending → ready | failed`, with later `superseded`.

`useSnapbackAsset`-shaped consumers re-render when the primary or a better
rendition becomes ready, with no polling and no app-built status channel. The
reserved asset id and optimistic local preview remain stable across successor
attempts.

This preserves LLP 0013's boundary: progress may disappear on disconnect;
asset availability, attachment, and rendition identity may not.

### Authorization

Upload-intent invocation, attempt creation/resume/cancel/finalize, metadata
visibility, attachment, delivery issuance/request, replacement, deletion, and
operator retry all pass the shared LLP 0039 authority gate.

In particular:

- the client cannot choose owner or app;
- metadata visibility and delivery issuance follow the asset's declared
  read-access policy (§Asset read authorization), and possession of an asset
  id, attempt URL, staging key, rendition id, or expired signed URL is not
  metadata authority;
- attempt resume binds server-resolved authority and the auth-session
  lineage the client protocol defines (LLP 0093/0095/0096) — not a live
  transport connection; a web refresh or app restart resumes under the same
  authority lineage over a new connection;
- typed attachment rechecks authority instead of trusting upload-time success;
- renditions inherit the parent's policy and cannot be more visible;
- restricted staging is not app-readable, including by ordinary actions;
- diagnostics and receipts omit filenames where sensitive, byte samples,
  bearer URLs, staging keys, signing material, and raw handler arguments.

Authorization invalidation affects strict delivery and metadata live state on
the next governed boundary. Signed and public profiles report their weaker
already-issued/cache semantics honestly rather than pretending to match strict
revocation.

### Deletion, retention, and garbage collection

Four cleanup classes are distinct:

- **Attempt GC (mandatory):** expires/cancels resumable resources and removes
  partial staging bytes.
- **Pending-asset GC (mandatory):** removes an unreferenced pending/rejected
  asset after its declared grace period, through the `deleted` transition the
  lifecycle table defines. Referenced failures remain visible so the app can
  repair them. An authorized caller may also delete a pending asset
  explicitly (cancel-and-discard) without waiting out the grace period.
- **Blob GC (mandatory):** deletes an immutable blob only after all asset and
  rendition references are gone and the retention fence permits it, marking
  the blob `condemned` transactionally first so dedup reuse can never race
  deletion (§Publication and crash recovery).
- **Reference-tracked asset GC (opt-in):** reclaims a ready asset that has no
  typed reverse-reference edges after an app-declared grace period.

Only schema-declared typed references protect an asset from reference GC.
String occurrences in arbitrary JSON, logs, or source code do not. Enabling
reference GC therefore requires the typed-reference/reverse-edge capability
and emits a deployment warning listing any asset-bearing fields that are not
covered.

Explicit delete immediately tombstones metadata and stops new discovery or URL
issuance. `private-strict` delivery denies the next request. Previously issued
signed URLs and public caches retain exactly the bounded authority their
profiles declare. Physical bytes may remain through backup, retention, cache,
or blob-GC windows without remaining logically deliverable through Snapback.

By default explicit delete refuses while typed reverse-reference edges remain.
An eventual force-delete profile, if added, must be separately authorized and
must define the broken-reference projection; v1 does not acquire it
accidentally through a boolean flag.

Ordinary mutation replacement updates reverse edges atomically. The old asset
then follows the app's GC policy; no special avatar-replacement endpoint is
required.

### Receipts, diagnostics, and inspection

Receipts cover semantic events, not transfer chunks or every progress tick:

- asset reserved and upload attempt created;
- attempt completed, cancelled, expired, or failed;
- bytes verified/rejected and staging cleaned;
- canonical blob reused/created;
- asset became ready/rejected/deleted;
- rendition produced/failed/superseded;
- strict/signed/public delivery-profile admission;
- attachment denied/committed and final reverse edge removed;
- publication-reconciliation repair (orphan resolved, condemned object
  deleted, reference count repaired);
- migration verified and GC reclamation completed.

Events for one upload/finalization carry a shared operation/attempt lineage so
inspection can render one lifecycle without requiring every transition to be
an unrelated top-level artifact. Receipts retain exact safe identity,
generation, policy, capability, and diagnostic facts but no secrets or raw
bytes.

Stable diagnostics use the `SNAPBACK_ASSET_*` family. The initial closed set
must distinguish at least:

- stale/unsupported upload intent;
- location-policy refusal (missing declared policy, or `strip` without the
  rewriting capability);
- auth, read-access, or attachment denial;
- unverified asset-reference commit refusal (`SNAPBACK_ASSET_REF_UNVERIFIED`);
- installed AssetRef semantic-identity retype
  (`SNAPBACK_SCHEMA_FIELD_RETYPED`, with old/new policy facts and separate
  preserve-data/dev-fresh repairs);
- media type, size, count, and quota refusal;
- offset/part conflict, cancellation, expiry, and superseded-attempt
  refusal;
- transport-integrity or canonical-digest failure;
- restricted-staging/finalization failure;
- processing/rendition failure and processing resource-bound refusal;
- unsupported delivery profile or range behavior;
- referenced-delete/GC refusal.

Admin and agent inspection expose stuck attempts, pending assets, rendition
lineage, safe detected metadata, reference edges, quota consumption, runner
claims, receipts, and remediation. Retrying finalization or processing is an
authenticated, generation-fenced operation; it never edits a terminal receipt
or reopens a completed attempt.

### Capability facts and implementation slices

The developer API stays cohesive while claims remain separately testable.
Three claim classes are distinct and never substitute for each other:
**target capability facts** (what a deployment target proves), **client
protocol conformance** (an SDK passing the language-neutral vectors), and
**client distribution claims** (a supported packaged SDK per LLP 0064's
packaging/ownership/per-OS evidence). The composite product claim — "this
app's asset experience works here" — is a declared dependency graph over all
three: each intent shape mechanically requires the target facts it uses
(an image + strict + required-thumbnail intent requires the lifecycle
composite, the image-finalization fact, and the strict profile; a
files-only intent requires less), and a missing prerequisite refuses that
intent with a structured diagnostic rather than degrading.

#### `asset-lifecycle-v1` (target composite, store-parameterized)

The store-neutral semantic core, claimed **per qualified byte store**:
generated upload intent, stable asset identity, restricted staging and an
immutable blob store, a qualified resumable transfer lane for that store
(TUS on the local/proxied lane; native multipart on the S3-compatible
lane), trusted verification and detection, commit-time typed-reference
enforcement and attachment, `private-strict` delivery with ranges (a
required member — a target that cannot prove strict delivery does not claim
this composite), deletion, mandatory cleanup and reconciliation, receipts,
and the headless task protocol. The canonical local target proves the
composite with the filesystem store and the TUS lane; an object-store-only
target claims the same semantics with the S3 store parameter and its
multipart lane. The store parameter is part of the claim — lifecycle
semantics do not float free of a store that proved them.

This is the capability that retires the **generic authenticated-file**
storage GAP. It is honest about media: it carries no metadata-rewriting
fact, so a default-policy image or video intent refuses on a
lifecycle-only target (§Generated upload intents) — the media app classes
LLP 0124 identified additionally need the pipeline slice below.

#### `asset-image-pipeline-v1` (target composite)

Carries the `asset-image-finalization` fact: privacy rewriting
(location stripping), trusted detection, typed metadata, placeholder,
dominant color, pre-materialized renditions, immutable pointer switching,
and the adversarial resource ceilings and hostile-input corpus of
§Declarative processing. Responsive client rendering over these renditions
is a client-distribution claim, not part of this target composite — a
server proves renditions; an SDK proves rendering. This should follow the
lifecycle slice closely; it is the media experience that makes the arm
excellent rather than merely adequate, and it is what admits default-policy
image intents. Per the 2026-08-01 dated amendment it also carries the
on-demand width facts: the ladder, the per-intent ceiling, and
inline-materialization support. Derived default intents are a
codegen-side fact (`assetDefaultIntents`), not a target fact — every
target sees them as ordinary intents.

#### Store and delivery profile facts

The S3-compatible adapter, direct upload, native multipart, each provider
qualification, `public-immutable`, and `private-signed` are independent
target facts layered above the composites. Local support does not imply
hosted support. R2 evidence does not automatically qualify Tigris or S3.

#### Explicit v1 nonclaims

Reported as Missing on every v1 target, so the manifest never implies
them: asset-byte snapshot backup (`asset-byte-backup` — the byte-level
contract in LLP 0007's two-contract vocabulary; the *logical* cut
export/import is now designed and graded in §Consistent-cut
export/import: cut export and import validation implemented on local,
restore application experimental); custom read authorizers;
deferred-length transfer. (`asset-video-finalization` left this list
with W2d.)

#### Later capabilities

- `asset-reference-gc-v1`, after typed reverse-reference evidence;
- `asset-custom-processing-v1`, after a streaming/effect/executor contract;
- `asset-video-finalization` and video poster/transcode/HLS profiles, each
  with explicit tooling and limits;
- seed binary fixtures, after the LLP 0109 artifact amendment (§Seeds);
- local-first asset-byte sync/migration under the local-first program.

Every capability reports enforced/advisory/missing size, quota, TTL, attempt,
count-ceiling, range, processing, concurrency, retention, and delivery
bounds. A target missing one fact refuses only the intents that require it
and does not broaden its claim from a sibling target.

### Threat model summary

The design's adversaries, and where each is answered: an **unauthenticated
caller** (0039 gate; no unauthenticated route exists); an **authenticated
malicious user** (read-access policy, attachment authority, quota and count
ceilings, single-current-attempt fencing); **malicious app code** (commit-time
reference validation, restricted staging denied to app reads, no byte
authority in callbacks); a **compromised signed URL** (declared TTL window,
alias-bound signature, rotation); **hostile media bytes** (staging custody,
detection from bytes, processing ceilings, hostile corpus, no-inline
active-content delivery); a **stale or crashed worker** (leases,
generation fences, write-ahead publication, reconciliation); and a
**storage administrator** at the object store (opaque keys, no
app-data-derived names, digest verification on read-back — confidentiality
against the store operator is explicitly not claimed; encryption remains the
store's own configuration surface).

### Seeds, CLI, and agent DX

Demos and acceptance suites should use real images rather than gray boxes,
but LLP 0109's `SeedArtifactV1` is a closed artifact with no binary member,
and this RFC does not smuggle one in. Seed-carried binary fixtures are a
later capability requiring a separately versioned fixture artifact and an
LLP 0109 amendment (digest identity, custody, install ordering, reset, and
quota semantics). Whatever the artifact shape, seeded assets take the same
trusted finalization path as uploads — a seed can never inject bytes
directly as a `ready` blob, so the privacy and integrity invariants hold on
seeded data too. Until then, fixtures upload through generated intents via
the CLI below.

The CLI grows generated-intent-aware operations:

```text
snapback assets put <file> --upload <generated-intent> [--args <json>]
snapback assets inspect <asset-id>
snapback assets list --state pending
snapback assets retry <asset-id>
snapback assets delete <asset-id>
```

Authority follows the ordinary host-ops/impersonation rules. The CLI never
turns a file path into admin bypass implicitly. Inspection prints stable
diagnostics, receipts, rendition lineage, reference count, and quota facts so
an agent can close its own loop without opening a browser.

### Consistent-cut export/import (dated design addition, 2026-07-31)

The "future consistent-cut design" the v1 nonclaim deferred to, authored
as part of the completion program (W2h). This is the **asset component of
a logical export** in LLP 0007's two-contract vocabulary — the logical
portable bundle side, not the byte-level snapshot (which remains a
nonclaim below).

**The cut.** A cut is one consistent picture, captured inside a single
read transaction at a pinned storage head version (the cut's consistency
witness): the `ready` asset records with their `ready` renditions; the
tombstone set (deleted assets as id + lifecycle generation, so import can
never resurrect them); each referenced immutable blob exactly once,
digest-addressed; and the settled-quota snapshot. The cut **names its
exclusions**, per 0007's rule for logical bundles: in-flight upload
attempts, pending/rejected assets, and staging bytes are transient
transfer state and are not content; reverse-reference edges derive from
app rows, belong to the app-data component, and rebuild when app rows
import through the complete-cut admission; superseded/retired rendition
lineage is bookkeeping, not content. The manifest
(`AssetCutManifestV1`, `snapback.asset-cut.v1`, committed schema) carries
a tagged canonical digest over its own body, and every blob object is
written digest-addressed beside it and verified after copy — blobs are
immutable, so copying after the row capture closes is sound, and a
GC-condemned object failing the copy fails the export whole rather than
shipping a partial component.

**Import.** Refuse-partial is the contract: the manifest digest and
every blob object verify before any row lands — a missing object,
digest mismatch, or tampered manifest refuses with nothing applied.
Application is the restore posture: it applies only onto an **empty
asset state**, mints fresh opaque physical keys (keys never travel),
imports tombstones as deleted rows, and bumps every lifecycle
generation past the manifest's — the **restore-epoch fence**. Signed
URLs validate by recomputing against the current lifecycle generation
(§Delivery profiles), so a bearer URL minted against the exporting
instance can never validate against the restored one; this falls out of
the W2b design rather than needing new machinery. The `v.assetRef`
import refusal (§Typed references) stays for partial/legacy paths;
the complete-cut path is the one admission route, and the app-data
component's row import remains its own (0007-owned) design.

**Honest grading.** Cut export and import validation are implemented for
the local target (capability facts `export.cutExport` /
`export.importValidation`); restore application ships gated behind an
explicit experimental acknowledgment (`export.importApply:
"experimental"`) until the restore-epoch machinery carries acceptance
evidence under a real app-data import; and byte-level snapshot backup
remains a Missing nonclaim — this design deliberately does not claim it.
A proposed companion line for LLP 0007's export section — that the asset
component participates in logical export under its component-boundary
rule (both components or neither) — is recorded here for 0007's owner to
absorb rather than edited into 0007 by this program.

### Ceremony floor and bounded on-demand widths (dated amendment, 2026-08-01)

Ruled by the author (Charlie, 2026-08-01, on the LLP 0139 bakeoff's
evidence ticket: "Yes, fine to amend 0044 and whatever to change our
design plans to handle this better. Go ahead and make both of those
changes."). The evidence: PocketBase served an avatar with zero authored
backend files and sized thumbnails by URL parameter
(`diaries/0048-upload-bakeoff-faceplate.diary.md`, App A wrap;
`demos/upload-bakeoff/reports/summary.md`, ceremony and media-pipeline
axes) — the two measured DX losses in a field Snapback otherwise led.
Both changes preserve the generated-facts model; neither weakens a privacy
or capability-honesty rule.

**1. The derived default intent.** A bare `v.assetRef()` field — no
`upload` restriction — now *derives* a generated default upload intent
from its placement: stable derived id (`_assets.default.<table>.<field>`,
outside the exported-binding namespace), `auth: "authenticated"`,
`accept` = the trusted-detectable strippable image set (`image/jpeg`,
`image/png`) with a 10 MB bound, `delivery: private-strict`,
`location: "strip"`, `access: owner-only`, default attachment policy, and
a canonical codegen-emitted authorizer whose output is
`{owner: ctx.auth.userId}`. The derived intent is an ordinary generated
intent in every respect — manifest-visible with a stable policy hash and
policy generations, target-refusable, escalatable — so the field is
semantically `v.assetRef({upload: "<derived id>"})`: the commit-boundary
admission works on every write path (host plans included, which
previously refused restriction-less fields), and the location-policy rule
applies unchanged (a lifecycle-only target refuses the default intent's
strip media exactly like an explicit one). `defineAssetUpload` remains
the escalation path and overrides nothing implicitly: a field naming an
explicit intent uses it, full stop. The rare
any-intent-handler-attach-only field keeps an explicit spelling,
`v.assetRef({upload: null})`, preserving the prior bare-field semantics
for apps that genuinely want cross-intent fields; **this amendment
changes the meaning of bare `v.assetRef()`** at the next generation, and
records that consequence rather than smuggling it.

**2. Bounded on-demand widths.** §Non-goals' dynamic-transform deferral
said reopen with evidence; the bakeoff supplied it. Admitted, bounded,
inside the declared vocabulary: image delivery accepts `?width=N` where
N ≤ the intent's declared on-demand ceiling (default 2048); N normalizes
UP to a fixed 13-step ladder (16, 32, 64, 96, 128, 192, 256, 384, 512,
768, 1024, 1536, 2048), so the variant space per asset is bounded and
cache-keyed by real renditions, never a free transform proxy. A missing
ladder rendition materializes once, inline, from the nearest larger
pre-materialized variant or the primary — through the existing
render/publication machinery under the existing decode/output/step
ceilings, never upscaled, quota-settled like any rendition — then serves
immutably forever (rendition-id ETags; `public-immutable` URLs stay
honestly immutable per materialized rendition; `private-strict` stays
no-store). Ceiling, ladder, and inline-materialization support are
capability facts on the `asset-image-pipeline-v1` composite; a target
without image finalization refuses `?width=` exactly as it refuses strip
intents. Declared variants remain available and are preferred as
materialization sources; with on-demand widths, the *default* intent
declares no variants at all — sizing is the ladder's job.

Consequence for the ceremony count: the minimal avatar path is now one
schema field plus one `ctx.assets.attach` line in an ordinary mutation —
the upload intent, variants, and policy ceremony all collapse into
derived defaults, with every fact still generated, manifest-visible, and
target-honest.

### Video location policy: the `video: { location }` sibling block (dated decision, 2026-08-03)

Ruled by the author at decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`), resolving
`issues/20260801-0044-video-location-policy-under-image-block.md`
(option b): an intent whose accepted media types include video declares
its mandatory location policy under a **`video: { location }` sibling
block**. The `image:` block is untouched — its spellings are part of the
frozen L1-03 authoring surface and existing `intentPolicyHash` values
must not silently move — and the split is documented rather than papered
over: `image.location` governs location-bearing image types,
`video.location` governs video types. Any intentPolicyHash implications
of admitting the new spelling get the same care as any policy-identity
change.

### Asset-intent implementation identity: the helper closure joins the carrier (dated decision, 2026-08-03)

Ruled by the author at decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`), resolving
`issues/closed/20260801-asset-intent-implementation-hash-omits-helper-closure.md`
(disposition 1): `implementationHash` is extended to cover the spliced
reachable helper closure (mirroring the ordinary-function
implementation record) **and** is carried through the whole lifecycle
chain — client, admission, generation keying/bumping, and finalization's
current-versus-retained authorizer selection. Metamorphic lifecycle
fixtures then pin it: direct-body change, helper-only change, and
`reads` change, each asserting generation bump, stale-reference refusal,
frozen-code finalization, rollback, and stability of unrelated intents.
This is the prerequisite disposition LLP 0140 Stage 0 requires before
freezing its baseline.

**Implemented 2026-08-04.** Inline authorizers now extend the existing
`snapback.asset-intent-implementation.v1` preimage with the deterministically
ordered reachable `helpers: [{ name, contentHash }]` set when it is non-empty;
helper-free preimages remain byte-identical. Generated references send both
hashes, admission compares and stores both, and the per-intent generation row
keys activation on the pair. Finalization uses current code only when both
admitted hashes match; otherwise it loads the generation-retained artifact and
validates both hashes before re-running its authorizer and applying its frozen
finalization policy.

The storage upgrade is deliberately fail-closed. The new generation column is
nullable only for additive migration: a pre-carrier row remains `NULL`, so the
first carrier-aware admission bumps the generation even when the policy hash is
unchanged. A pre-carrier in-flight attempt has no executable identity to select
safely and refuses `SNAPBACK_ASSET_ADMISSION_STALE`; it never adopts current or
retained code by policy hash alone. Codegen and in-process lifecycle fixtures
pin direct-body, helper-only, and `reads` changes, rollback, frozen finalization,
stale-reference refusal, and unrelated-intent stability.

### Clique-pilot delivery and grant DX closure (dated design addition, 2026-08-09)

The LLP 0201 P2 pilot (Clique, snapback lane) exercised this pipeline
end to end — post media, chat attachments, view-once, delete-for-everyone
— and scored the surface B5 = 62/100: the upload happy path drew praise
("three lines; trusted finalization + variants just happened") while the
delivery and authority edges were learned by probing. This addition
converts that record (LLP 0208 G11 and the G4 asset slice;
`issues/20260809-asset-upload-dx-papercuts-g11.md`,
`issues/20260809-asset-recipient-grant-authority-g4.md`) into design.
Items 1–3 are gap-closures inside the accepted design; item 4 is an open
authority ruling. The normative elaboration lives in
[LLP 0210](./0210-asset-upload-dx-closure.rfc.md) (the super-refine
vehicle — this document is Accepted and not re-entered).

**Outcome (dated note, 2026-08-09 — LLP 0210 Accepted by the author).**
Items 1–3 landed on main (client `402dfacd2`, server `e8e67c0e9`, React
projection `9b30655cf` with the LLP 0114 ledger entry, guide
`f08283eb8`). The item-4 ladder is ruled: **(a)** the grant-rows +
transfer-at-open recipe is landed in the guide as the supported path;
**(b)** first-class grant edges are adopted per LLP 0210 §D5(b) —
`grantId`-identified system records with a `pending | active`
lifecycle, closed authorization (owner mints; the principal
self-activates a pending edge; owner or principal revokes by
`grantId`; revoke removes the edge), commit-atomic transitions
revalidated under the final write lock, and admission-frozen
`grants: true` intent opt-in. Implementation carries four obligations
this pipeline must honor: the LLP 0053 invalidation projection for
grant edges (revoke blanks live asset metadata); storage locus (system
records, exported/imported with the asset component of a consistent
cut); reference-GC interaction (an `active` edge protects the asset
like a typed reverse reference; `pending` edges do not); and per-app
grant-count ceilings charged to the minting owner under §Deduplication,
keys, and quotas. **(c)** app-bound `assetSharing` stays deferred to
the LLP 0208 G4 membership program.

**Implementation outcome (later 2026-08-09).** Rung (b) is implemented on the
local target. Grant rows live in `_snapback_asset_grants_v1`, use `agr_`
identities, carry owner/mutation/time provenance, and travel with the asset
component of a consistent cut. Mint, activation, revoke, app writes, receipts,
quota settlement, and reference-GC clock changes share the mutation's final
write transaction. Active edges participate in the declared read witness and
live invalidation projection; revoke therefore blanks a former viewer's live
asset-record projection. The declared per-app ceiling is 1,024 pending plus
active edges, and only active edges protect against reference GC. The guide now
makes these operations primary while retaining app-owned grant rows as the
portable/filterable fallback.

**1. Client-arm signed issuance is owed, not new.** §Delivery profiles
(`private-signed`) already states "the generated client refreshes it
before expiry," and §Client upload surface promises renderer-level
"automatic refresh of bounded signed delivery URLs before expiry" —
but no SDK method performs issuance: the shipped client has only
`deliveryUrl()` URL construction, and the pilot hand-rolled the
`POST /assets/records/{id}/signed-url` fetch (bearer +
`x-snapback-auth-client-protocol: 1`, discovered by probing) plus its own
30-second URL cache. The framework-neutral client gains
`assets.signedUrl(assetId, { variant?, widthPx?, ttlMs? })` returning the
issued URL and its expiry, working under both AuthCoordinator and
external-bearer custody; the React arm's projection (hook or renderer
prop) owns TTL refresh per the existing §Client upload surface promise.
Issuance keeps the protocol-offer discipline (the *issued* URL stays the
pasteable lane; the issuance route does not).

**2. Issuance-body defaults and typed refusals.** The issuance request's
`variant` becomes optional, defaulting to `primary` (superseded by
`widthPx` exactly as today). An unknown variant refuses with a typed
`SNAPBACK_ASSET_*` diagnostic that names the intent's declared variants;
a malformed body is never surfaced as a bare framework 422. Rationale:
the pilot guessed `{"variant":"primary"}` from an undiagnosed 422 — the
refusals-as-docs posture (LLP 0193) must hold on this route like every
other.

**3. One-call upload convenience and the `task.done` contract.**
`assets.start()` remains the task-level surface. A convenience
`assets.upload(uploadRef, source) → Promise<assetId>` is added over it,
accepting the structural inputs the platform adapters already normalize
(File/Blob and picker-shaped `{ uri, mimeType?, fileName? }` per LLP
0180 §Input and platform adapters), resolving when the asset reaches
`ready`, and **rejecting** on every other terminal state with the task's
structured diagnostic. Motivation: the pilot re-implemented exactly this
(URI→blob→`File`→`start`→await→status maze), and its defensive
double-check of `task.done`'s settle semantics shows the contract is not
legible at the call site; the helper is the documented happy path and
the task API's docs state the settle rule plainly.

**4. Recipient-scoped authority — open ruling (ascending ambition).**
Clique modeled per-recipient media authority (chat attachments,
view-once) as owner-principal **grant rows** minted at send and
destroyed on delete — because membership-flavored `assetSharing` binds
only to the declared roles machine (private roster; a product-visible
promotable roster cannot use it), and because `ctx.assets.attach`
refuses non-owner callers (`SNAPBACK_ASSET_FORBIDDEN`), view-once
transfers authority by *patching the grant row's viewer principal* at
open. The composition survived hostile probes (403 before open, 200
during, 403 after close, ~80 lines) and the pilot essay praised the end
state — but authority-transfer-by-field-write is not a paved spelling.
Options for the author, ascending:

- **(a)** bless the grant-rows + transfer-at-open recipe in the guide
  (docs-only);
- **(b)** first-class `ctx.assets.grant(assetId, principal, opts?)` /
  `ctx.assets.revoke(...)` handler ops, making authority transfer
  explicit and auditable — view-once becomes grant-at-open /
  revoke-at-close;
- **(c)** an `assetSharing` flavor binding to an app-declared
  table/predicate, dissolving the dual-roster tax for assets (LLP
  0056/0100 consulted).

Recommendation carried into review: land (a) immediately (the recipe is
owed regardless), rule on (b) as the design-correct spelling, and defer
(c) to the LLP 0208 G4 membership program so asset sharing and roster
projection move together.

**Multi-image steering (no re-ruling).** The 2026-07-31 bounded-array
withdrawal stands. The pilot's `img1..img4` column splay shows the ruled
paved path (LLP 0110 bounded children) was not discoverable at the point
of need — the closure is guide/capability-index steering
(`issues/20260809-multi-image-authoring-revisit-g8.md`), and any
bounded-array revisit is a new author ruling request on that ticket's
evidence, not part of this addition.

## Non-goals

- CDN product design or a promise of globally optimal media delivery.
- ~~Dynamic `?w=400&fmt=webp` on-demand transforms~~ — superseded
  2026-08-01 by §Ceremony floor and bounded on-demand widths: the
  bounded ladder admission (evidence-based, per the deferral's own
  reopen condition). A free-form transform proxy (arbitrary dimensions,
  format negotiation, effects) remains a non-goal; on-demand
  *materialization of ladder renditions* is admitted design.
- A transcoding preset/codec/ladder product.
- Arbitrary app-authored byte-processing handlers in the initial image
  capability.
- A new general durable background-work subsystem; LLP 0070 owns it (the
  asset-work ledger is asset-domain machinery, not a generic queue).
- Video metadata rewriting in v1 — a declared nonclaim with a named future
  capability (`asset-video-finalization`), not a silent retention.
- Asset-byte backup/restore and logical export/import in v1 — reported
  Missing until a consistent-cut design exists (§Explicit v1 nonclaims).
- Multi-file batch upload tasks; one task, one file, in v1.
- Cross-app physical deduplication.
- Per-asset encryption-at-rest product semantics; stores own their encryption
  configuration.
- Built-in virus scanning, content moderation, or compliance guarantees. The
  restricted-finalization gate leaves room for separately claimed providers.
- Public gallery or social-sharing policy.
- Offline asset-byte sync; LLP 0129 owns the local-first program.
- Payments, billing, or dedup-sensitive pricing.

## Acceptance

Every normative commitment in §Design must map to a row below or to an
explicit nonclaim; an implementation lands with a traceability check, not
untested prose.

Intents and admission:

- A declaration produces one generated upload reference whose auth, file
  bounds, delivery profile, read-access policy, and processing recipe cannot
  be widened by a client; a stale or incompatible reference refuses before
  staging.
- A location-bearing intent without a declared location policy refuses at
  generation. A strip-declared image intent refuses on a target without
  `asset-image-finalization`; a strip-declared video intent refuses on
  every v1 target; an explicit retain-location intent admits and produces
  distinct policy evidence.
- A bare `v.assetRef()` field derives its default intent: the manifest
  carries the derived intent with a stable id and policy hash; the
  end-to-end avatar flow (schema field → upload under the derived intent
  → handler attach → strict delivery) works with no `defineAssetUpload`
  authored; host-plan writes to the bare field admit via the
  schema-derived commit-boundary check; `v.assetRef({upload: null})`
  preserves the prior handler-attach-only unrestricted semantics; a
  field naming an explicit intent is unaffected.
- `?width=N` delivery normalizes N up the declared ladder, serves an
  existing ladder rendition immutably, materializes a missing one
  exactly once (concurrent first requests converge; ceilings and quota
  enforced with structured refusals; never upscales), refuses N above
  the declared ceiling, and refuses entirely on targets without
  `asset-image-finalization`; `public-immutable` width URLs carry
  immutable cache headers per materialized rendition and
  `private-strict` width responses stay no-store.

Client task and SDKs:

- The framework-neutral and React/Expo clients return one stable asset
  reference and local preview before bytes move, expose progress plus
  pause/resume/cancel/retry, and preserve the asset id across an expired
  attempt's authorized successor.
- Provider replacement, logout, or authority change synchronously hides the
  task/preview from the old authority, and generation-fenced late work from
  the stale authority is refused.
- Every SDK that claims asset-lifecycle client conformance consumes the same
  intent/state/diagnostic schemas and passes the same upload, resume,
  attachment, live-ready, authorized-range, deletion, and negative-auth
  vectors; no SDK requires JavaScript execution or handwritten asset routes.
  (Which SDKs exist and ship is LLP 0064's staging, not this RFC's exit
  criteria.)

Transfer:

- A local large upload resumes after process/client restart through TUS 1.0.0
  from the last acknowledged offset; cancellation, expiry, and attempt GC
  have structured outcomes.
- Creating a successor attempt supersedes the predecessor: two racing
  writers converge on one winner, the loser receives a structured
  diagnostic, and a superseded attempt's late completion is refused by the
  generation fence.
- A deferred-length creation is refused on every v1 lane. Generated clients
  checksum every `PATCH` and their transfers finalize end-to-end verified;
  a checksum-less foreign TUS client's transfer finalizes
  received-bytes-canonical, and the receipts distinguish the two grades —
  corrupting a checksummed chunk is detected at transfer time, while the
  weaker grade is never reported as the stronger.
- The client's persisted resumable-task state contains no bearer URLs,
  staging keys, or signing material; a persisted task resumes only under
  the same app and authority identity.

Staging, finalization, and publication:

- Raw direct/proxied bytes are unreachable in restricted staging, including
  by ordinary app code. Finalization verifies length and transport
  integrity, detects type from bytes, rejects a declared/detected mismatch
  outside the intent, computes a canonical digest, and idempotently
  publishes one primary rendition.
- A GPS-tagged image under the default image policy has no location metadata
  in any ready/deliverable canonical blob; raw staging is then deleted.
- An intent marking a rendition required gates `ready` on it; an optional
  rendition's failure never makes a usable primary unavailable.
- Fault injection at every named crash cut — after the object put before
  the `staged` commit (recovery probes the `planned` record's key and
  either stages or condemns it), after `staged` before `committed`, after
  row commit before staging cleanup, mid-migration, mid-condemnation —
  recovers to a consistent state via publication records and the
  reconciliation sweep, each repair emitting a receipt; a `planned` record
  whose attempt is superseded or cancelled condemns rather than lingering,
  and retired publication records leave the ceiling headroom they
  occupied. Blob
  identity uniqueness holds under concurrent finalizers — the losing racer
  converges onto the winner's blob and its condemned object is reclaimed —
  and the dedup-reuse-versus-blob-GC race always resolves to either a
  reused live blob or a fresh blob, never a dangling reference.
- Deleting a ready asset runs the full cascade in one transaction: rendition
  rows retire, blob references decrement, logical quota releases, and a
  concurrently running recipe for the deleted asset fails its generation
  check and cleans up. A crash mid-cascade recovers to a consistent state
  with no leaked rendition reference and no double quota release. An asset
  with a primary and two derived renditions — blob-sharing and
  non-sharing variants both — charges and decrements each rendition's blob
  reference exactly once, the primary included, with exact
  reference-count and quota assertions after deletion.

Dedup and quota:

- Uploading identical canonical bytes twice in one app produces two assets
  and one eligible immutable blob while consuming logical quota twice.
  Another app observes no dedup-dependent behavior.
- Concurrent attempt reservations cannot overrun remaining logical quota;
  terminal cleanup releases unused reservations only after the staging
  resource is fenced at the store; rendition publication settles its own
  quota increment; deletion releases logical usage at tombstone commit.
- Per-app/per-principal ceilings on every durable record class — attempts,
  asset records of any availability, renditions, edges, publication
  records, ledger rows — refuse structured rather than degrade; each asset
  consumes at least the minimum accounting unit, so adversarial zero-byte,
  repeated-rejection, retry, and crash-loop workloads all terminate at a
  declared ceiling with bounded durable state.

References and attachment:

- A typed asset field plus `ctx.assets.attach` atomically commits its app
  row and reverse edge. Cross-app, cross-owner, wrong-intent,
  stale-generation, and forged-string attachment all fail closed, and a
  disagreement between the field's intent restriction and the attach
  argument refuses.
- An untyped or admission-bypassing write into a `v.assetRef` field —
  app code assigning an id-shaped string with no admission — fails the
  commit with
  `SNAPBACK_ASSET_REF_UNVERIFIED` on every write path: handler, host plan,
  seed, import, migration, and admin edit. (Asset ids are string-shaped on
  the wire; what fails is the missing admission, not the value's shape —
  a generated host-plan operand on a restricted field is admitted by the
  commit-boundary check below, not refused as "raw.") An asset deleted or revoked
  between attach-check and commit refuses at commit time. A host-plan
  write to an intent-restricted `v.assetRef` field passes the
  schema-derived commit-boundary admission under the caller's authority
  (wrong-owner and wrong-intent cases fail closed); a host-plan write to
  an unrestricted `v.assetRef` field refuses, since only handler-side
  `attach` can admit it.
- Replacing or clearing a typed field updates the reverse edges in the same
  changeset. Reference GC never scans arbitrary JSON and never reclaims a
  still-referenced asset; ordinary explicit delete refuses while a typed
  edge remains. Enabling reference GC emits the deployment warning listing
  any asset-bearing fields not covered by typed references.

Read authorization and delivery:

- `owner-only` denies every non-owner metadata and byte read.
  `via-references` grants read with the reverse-edge commit and revokes it
  with edge removal; membership removal, logout, revocation, and deletion
  blank dependent live metadata subscriptions and deny the next
  `private-strict` request, exercising the LLP 0053 projection including a
  dropped-invalidation-delivery case.
- `via-references` decides only through asset-sharing-declared analyzable
  row-visibility policies: a typed reference on a row in a table without
  the sharing declaration confers no read authority (owner-only fallback),
  and deploying such an intent emits the warning listing the uncovered
  tables. On a mixed table — broad analyzable row policy, narrower
  function-level query gate, no sharing declaration — the broad row
  predicate provably cannot bypass the function gate to expose the asset.
- A revoking-flagged deployment, intent removal, or the operator
  revocation action makes an open attempt's finalization refuse with a
  structured diagnostic; the counter-case holds too — an ordinary redeploy
  bumps the policy generation without revoking, and the open attempt still
  finalizes under its frozen policy.
- Finalization validates the complete admission-time read-set witness:
  revoking the authorizing state after attempt creation makes finalization
  refuse with a structured diagnostic rather than publish under stale
  authority, and a phantom insertion against an absence-conditioned
  admission, a deleted authorizing row, a reparented relationship, and an
  initially-empty authorization query all invalidate the witness. Benign
  churn is the counter-case: a write to the declared reads that leaves the
  re-run authorizer's decision materially identical finalizes
  successfully — a long upload under steady non-revoking churn never
  livelocks.
- Rotating the instance signing key invalidates outstanding signed URLs, as
  §Delivery profiles declares; logical import of rows carrying `v.assetRef`
  fields refuses while export/import is Missing.
- `private-strict` proves authorization on every ordinary and range request
  and sets `Cache-Control: private, no-store`. `private-signed` proves
  issuance authorization plus TTL, demonstrates that a previously issued URL
  retains only the declared bearer window, and the generated client
  refreshes a bounded URL before expiry without app polling.
  `public-immutable` reports its cache/revocation limits without claiming
  strict deletion.
- Delivery URLs expose only `(asset, rendition)` aliases: deleting asset A
  denies A's aliases while asset B sharing the same deduplicated blob stays
  deliverable, and no URL or receipt contains a blob key. Active-content
  types (SVG/HTML/XML) are served with attachment disposition, never
  inline. Delivery sets trusted `Content-Type`/`Content-Length`/`ETag`
  facts and a sanitized filename.
- A range request against a stored video returns the requested byte range on
  every target claiming video delivery.

Liveness and processing:

- Asset availability and rendition publication update live with no polling.
  Ephemeral/client progress cannot mark an asset ready or settle quota.
- Image processing publishes immutable versioned rendition blobs and
  atomically switches the variant pointer. Re-running or racing a stale
  recipe cannot overwrite a newer result.
- The hostile-input corpus (truncated files, decompression bombs, malformed
  metadata, dimension lies) yields structured resource-bound refusals within
  the declared ceilings; no processing step exceeds its memory/time/output
  bounds.
- Only transitions in §Lifecycle transitions occur; every unlisted
  transition attempt is refused with a structured diagnostic.

Runner and cleanup:

- The compatibility runner finishes work with no live subscriber; every
  ledger row emits per-item receipts; an expired lease is reclaimed and the
  work re-driven idempotently; the retry ceiling produces a durable
  `exhausted` failure, not silence. Only the closed ledger transitions
  occur; a row enqueues in the same transaction as the transition that
  requires it, and a row for a deleted asset cancels at its generation
  check with a receipt. Declared lifecycle callbacks are invoked
  idempotently under retry — a re-driven ledger row never doubles a
  callback's observable effect. A target with LLP 0070's amended profile
  enqueues/claims equivalent work transactionally, and both runners pass
  the same at-least-once, idempotency, fencing, and restart corpus.
- Deletion, attempt GC, pending-asset GC (including explicit
  cancel-and-discard of a pending asset), blob reference counting, and
  opt-in asset GC each emit safe semantic receipts and obey their distinct
  grace and delivery windows.
- Store migration copies opaque blobs, verifies recorded canonical digests,
  and switches placement under a fenced generation with receipts.

Tooling and manifest:

- CLI/inspection can upload through a generated intent, inspect a complete
  lifecycle, retry generation-fenced work, and explain quota/reference/
  capability refusals without exposing byte samples, staging keys, or bearer
  URLs.
- The capability manifest distinguishes the lifecycle composite per store
  parameter and the image-pipeline composite, `asset-image-finalization`,
  typed reference GC, custom processing, each store/provider, each delivery
  profile, resumability, ranges, integrity grade, count ceilings, and all
  material limits — and
  reports the §Explicit v1 nonclaims (backup/export, video finalization,
  custom read authorizers, deferred length) as Missing rather than
  omitting them.

## Open questions

- ~~Which canonical cryptographic digest should v1 use?~~ — **resolved
  2026-07-31, author decision (Charlie): SHA-256.** Native S3-compatible
  checksum interop (`x-amz-checksum-sha256`) and universal client tooling
  outweigh BLAKE3's local hashing speed; the algorithm remains a versioned
  manifest fact, so a successor can be admitted behind versioned blob
  identity if profiling ever justifies it.
- ~~Which small image library?~~ — **resolved 2026-07-31, author decision
  (Charlie): the pure-Rust `image` crate plus `kamadak-exif` for v1**
  ("native rust stuff is fine for now"). No native dependency enters the
  bootstrap; decode ceilings ride the crate's limits API plus explicit
  checks. The revisit trigger is recorded with the decision — Charlie
  expects "a more robust image library down the line": reopen when
  rendition throughput, format coverage (HEIC foremost, which phones
  shoot by default and `image` does not decode), or video finalization
  demands a native library, and admit it behind the same capability
  facts rather than a silent swap.
- ~~Which single placeholder algorithm?~~ — **resolved 2026-07-31, author
  decision (Charlie): ThumbHash**, one algorithm, in the versioned
  metadata field; a second is admitted only on measured client benefit,
  exactly as the processing section already requires.
- What are the default and maximum signed-delivery TTLs, and which hosted
  profiles can provide stronger early invalidation?
- May an intent retain the raw source as a separate restricted/admin-only blob,
  or must v1 always delete staging after canonical publication? The default
  remains deletion.
- ~~The companion amendment freeze~~ — **resolved 2026-07-31**: the
  gating companion pass landed as dated amendments in the owning
  documents. LLP 0007 froze `v.assetRef(options?: { upload?: string })`
  with explicit optional/bounded-array nodes, the `.assetSharing(spec)`
  table declaration on the shipped closed visibility union
  (`public-read` / `owner` / `membership`, citing LLP 0011's
  pushdown-compilability requirement by name), and commit-boundary
  admission under commit-time validation. LLP 0037 aligned the Rust-owned
  `assetUploadReference` DTO (with `intentPolicyHash` and policy
  generation) and the attempt/transfer/lifecycle/receipt carriers into
  `schema_export::artifact_schemas()`. LLP 0012 registered the
  `SNAPBACK_ASSET_*` family, the granular capability rows superseding
  `assetUpload` at first implementation, and the profile/grade/limit
  facts. LLP 0053 classified the asset-readable predicate node as
  admitted (0056 idiom, pinned empty-result capture) with no new
  authorization events and no `permissionBacking` need. One sliver stays
  open by 0037's scope fence: the Contract/Exact *descriptor* vocabulary
  maps onto the Exact-owned `ContractDataManifest` shape and freezes with
  that mapping, not here.
- When does the generated custom read authorizer (beyond `owner-only` /
  `via-references`) earn its capability, and what invalidation obligations
  does it carry?
- Should apps receive generated denormalized projections of selected asset
  metadata into their own rows, or is live system metadata plus the typed
  reference sufficient?
- How do explicit delete and blob retention interact with backups,
  object-store lifecycle rules, legal holds, and restore epochs?
- ~~Does the first landing use the cron compatibility runner or wait for
  LLP 0070?~~ — **resolved 2026-07-31, author decision (Charlie): the
  compatibility runner (the asset-work ledger driven by the 0028 sweep)
  ships first.** LLP 0070 is Draft; the ledger is specified to stand
  alone, and the second runner generation arrives with 0070's anticipated
  trusted-processor amendment, changing no application semantics.

## Status

Accepted, 2026-07-31, under LLP 0130 SD-4's standing acceptance rule for
program-commissioned documents: the dual-family super-refine loop
converged READY×2 on the v6 hash in four rounds (Fable R4, Codex R4), the
three SD-4 conditions are checked in the journal
(`reviews/0044-asset-storage-pipeline.super-refine.md`), and the four
remaining reviewer DETAILs — each explicitly non-gating — were folded as
v6.1 at acceptance time. The document was revised in place on 2026-07-31
at Charlie's direction (v3), then through the loop's fix passes (v4-v6). The v3/v4 line keeps the v2 product thesis — assets are live,
receipted, capability-honest Snapback resources — but separates logical
identity from transfer and physical storage, closes the
staging/digest/privacy collision, makes authorization and delivery semantics
generated and explicit, and reduces initial processing scope.

LLP 0044 remains the file-storage owner because Charlie's 2026-07-31
direction to revise this document in place resolved the
revive-versus-supersede choice that LLP 0127 routes to the author (its open
question 8, file-storage arm; §Sequencing 4). The adjudication is recorded
here and in `reviews/0044-asset-storage-pipeline.super-refine.md`; LLP
0127's own queue entry remains as originally routed. The review loop
concluded with the SD-4 acceptance above.

### Implementation status: `asset-lifecycle-v1` on the local target (2026-07-31)

The first implementation slice is built: the lifecycle composite runs on
the canonical local target (filesystem store parameter, TUS 1.0.0 lane,
`private-strict` delivery) with the commit-boundary reference enforcement,
the complete-witness finalizer, the write-ahead publication protocol, the
asset-work ledger runner, the deletion cascade and mandatory GC classes,
the `snapback assets` operator surface, and the honest per-target
capability claims (`asset_lifecycle_v1` + `assets` facts on local;
Missing elsewhere). Evidence: the ticket program
`issues/closed/20260731-0044-l1-*`, the traceability map
`tests/acceptance/asset-lifecycle-v1-evidence.md` (every acceptance row
covered, deferred-with-owner, or a declared nonclaim), and the guide page
`guide/backend/assets.md`.

The live projection and headless client landed with L1-14's first half:
the reserved `_snapback.assetRecord` system live query proves the
no-polling acceptance rows (publish wakes, first attachment wakes through
the pinned empty-range capture, revocation blanks), and
`createAssetClient(client).start` in the JS client covers the task rows
(per-chunk checksums, persisted-fact hygiene, resume, retry preserving
identity).

### Implementation status: `asset-image-pipeline-v1` on the local target (2026-07-31, later same day)

The image pipeline is built on the same target, under the author's two
recorded picks (pure-Rust `image` crate — revisit trigger: HEIC,
throughput, or video; ThumbHash as the single versioned placeholder):
bounded decode with Enforced adversarial ceilings and a hostile-input
corpus; GPS-strip canonicalization inside the trusted finalizer (decode →
orientation transform → re-encode, digested after rewriting, so strip
and retain can never alias in blob identity and dedup operates on
canonical bytes); typed media facts (dimensions,
`placeholder: {algo: "thumbhash.v1"}` cross-checked against the
reference decoder, dominant color, captured-at); declared renditions with
required-variants-gate-ready produced atomically with the primary,
optional variants riding the work ledger, generation-checked pointer
switching, and `best?maxWidth=N` selection on strict delivery. The local
manifest claims `asset_image_finalization_v1` and
`asset_image_pipeline_v1` with the ceilings in the `assets.image` facts
block; every other target withholds all three asset ids. Evidence: the
program `issues/closed/20260731-0044-p-*`, the §Image pipeline section
of the traceability map, and the guide page's Images flow.

Two of the deferred items closed 2026-07-31, later same day (the W2a
completion-program pass): frozen-generation authorizer retention is
implemented per v6.1 reading (a) — superseded intent artifacts are
retained keyed by policy generation, witness re-runs go through the
retained code so a long upload spanning an ordinary redeploy finalizes
under benign churn, reclamation is receipted GC, and the fail-closed
refusal survives only for a genuinely missing artifact — and the
blob-JSON refcount staleness is resolved by making the columns the
blob's only mutable representation (which also fixed two latent
ineffective condemned filters on the delivery paths).

Also closed 2026-07-31, later same day (the completion-program W2b/W2c
passes): **`private-signed` and `public-immutable` delivery** shipped on
the local target — every URL an `(asset, rendition)` alias, HMAC-SHA256
tokens binding grantee basis and lifecycle generation with
recomputed-generation invalidation at origin, instance signing-key
custody with a receipted operator rotation that invalidates outstanding
URLs, immutable public caching by rendition-id ETag, and the honest
bearer-window semantics in acceptance. **Reference-tracked asset GC**
(`asset_reference_gc_v1`) shipped as the schema-level opt-in
(`defineSchema(..., { assets: { referenceGc: { graceMs } } })`): only
typed reverse-reference edges protect, the grace clock is durable
(started at unreferenced publication or last-edge removal, cleared by
any attachment), reclamation rides the deletion cascade with
policy-and-grace receipts, the enabling warning lists unprotected json
fields, and the grace bounds are Enforced facts codegen checks.
**Declared lifecycle callbacks** ship in both auth modes: `on: { ready?,
rejected? }` names ordinary declared mutations pinned to the closed
args contract `{ event, assetId, facts }`, enqueued transactionally
with the transition, and driven at-least-once by the runner with
client-mutation-ledger idempotency (a re-driven row never doubles the
observable effect). Dev preserves the asset owner's dev authority; sessions
uses the per-app, exact-grant `asset-callbacks` service principal ruled in LLP
0039/0055, with `ctx.auth.actorKind` explicit and no counterfeit owner session.
Both use the ordinary staged mutation, commit-validation, authorization-event,
and receipt machinery, and callback failure remains isolated to the work row.

Also closed 2026-07-31, later same day (the completion-program W2d
pass): **video finalization** (`asset_video_finalization_v1`) shipped on
the local target. Strip for MP4/QuickTime is box-structure surgery,
never transcoding: a bounded ISO BMFF walk (Enforced ceilings — box
depth/count, metadata bytes, whole-file parse bound — with hostile
fixtures for size lies, truncation, nested size-0, depth/count/metadata
bombs) blanks location carriers **in place** (type renamed `free`,
payload zeroed) so every stco/co64 chunk offset stays valid: `udta`
`©xyz` and `loci`, `meta` `keys`/`ilst` entries whose key names refer to
location, and the XMP `uuid` payload wholesale; any other `uuid` box or
unsupported container brand refuses
(`SNAPBACK_ASSET_VIDEO_STRIP_UNSUPPORTED`) — a metadata region that
cannot be classified is never passed through. The blanked file is the
canonical byte stream under blob policy `strip-video.v1`, so strip and
retain video can never alias; safe facts (mvhd duration, tkhd
dimensions) land in media facts on both policies, and a hostile retain
container refuses deterministically like strip. Codegen now admits
video strip on the local manifest (`assets.video` facts block) and
still refuses it wherever the fact is withheld; transcoding, poster
frames, and HLS remain nonclaims.

Also closed 2026-07-31, later same day (the completion-program W2e
pass): **sessions-mode live projection**. The reserved
`_snapback.assetRecord` subscription now establishes under the sessions
bearer/ResolvedCaller path with the same sealed-auth discipline as
every protected query, and the old blanket
`SNAPBACK_ASSET_LIVE_SESSIONS_UNSUPPORTED` refusal is retired. **No new
LLP 0053 classification was needed**: 0053's §Asset read-authorization
inputs (2026-07-31) already admits every input the projection reads —
the asset-readable predicate node, the reverse-edge empty-range
capture, the sealed `ctx.auth` projection (the sessions caller reaches
the decision through the same `ResolvedAppAuthority` seam as every
resolved identity) — and the sessions gap was purely implementation:
three re-run seams (the auth-invalidation drain, the ordinary-frame
fan-out, and resume resnapshot) routed a subscription's re-execution
through manifest-function lookup, which cannot produce the native
projection. Those seams now execute the reserved projection natively
while keeping the full witnessed discipline: in sessions mode the
projection is auth-scoped (protocol negotiation, query namespace,
obligation registration), an auth-scoped subscription never receives a
plain unwitnessed replace (movement routes through the
obligation/snapshot lane with retry episodes and ACK tickets), and
establishment without the negotiated protocol still fails closed
(`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`). Proven end to end on
a settled sessions instance: session-authority upload → witnessed
ready snapshot with no polling, foreign-session blank establishment,
and deletion blanking through the witnessed lane.

Deferred with named owners, honestly: the React/Expo projection and
real-server JS conformance vectors (ticket L1-14's recorded remainder);
sessions callback execution authority
(`issues/20260731-0044-sessions-callback-authority.md` records the
concrete design question); and
S3 store qualification, store migration, and the
LLP 0070 runner generation, each already scoped as later capabilities
above. The document stays Accepted; Implemented awaits the client
remainder and a second target's evidence.

### Implementation status: seed asset fixtures (2026-07-31, W2f)

The LLP 0109 §17 dated amendment landed with its implementation: the
separately versioned `SeedAssetFixturesV1` artifact (JCS digest identity,
committed-file custody, no artifact-borne bytes), codegen emission of
`seed.asset-fixtures.artifact.json` with intent-binding and
placeholder-placement validation, the idempotent admin-gated
`asset.ensureSeedFixture` host operation riding the shared trusted
ingestion engine (fixtures obey ceilings, privacy policy, capability
gates, and ordinary logical quota — no seed bypass), and
`{"$assetFixture": id}` placeholder resolution inside the install
transaction with refuse-whole semantics on any missing, stale, or
misplaced binding. App reset now clears every asset system table and the
store's staging/blob files — asset bytes are app state; previously they
survived reset. Fixture-bearing seeds decompose reset-install into
clear + fixture ensure + install (single-transaction resetInstall carries
no placeholders). §Seeds and agent DX's "until then" clause is retired;
the `seedAssetFixtures` capability fact reports support (local true,
every other target Missing). Managed-CLI JS wiring (driving fixture
ensure before `ensureVersionedSeed` and the reset decomposition) is the
recorded remainder — it touches the client packages the concurrent Lane 1
owns.

### Implementation status: the byte-store seam and the S3 core (2026-07-31, W2g)

The store interface this RFC enumerates is now a real seam: every
production asset path — transfer, finalization custody, write-ahead
publication, delivery streaming, GC, reset — runs through the
store-agnostic `AssetStore` trait (`crates/snapback/src/assets_store.rs`), with the
filesystem store proven behavior-identical (the full asset suite ran
unmoved through the refactor). `AssetS3Store` (`crates/snapback/src/assets_s3.rs`)
implements the S3-compatible seam: hand-rolled SigV4 over the in-tree
crypto, path-style addressing, a prefix-scoped instance keyspace whose
reset is a bounded prefix wipe, `If-None-Match` idempotent publication
with the provider-variance caveat recorded in code, and the
native-multipart lane (create/presign-part/complete/abort plus the
committed `AssetS3TransferInstructionV1` instruction schema) held inherent
until the S3 attempt routes land. Protocol logic is validated 6/6 against
an in-process fake that independently re-derives SigV4 from request
materials and enforces bucket/multipart/range/wipe semantics.

The honesty boundary holds: no live endpoint has been qualified (no
MinIO/docker on the build machine), so **no target claims the S3 store**
— `assetLifecycleStores` stays `["local-fs"]`, `SNAPBACK_ASSET_STORE=s3`
refuses as unqualified without the explicit experimental acknowledgment,
and `issues/20260731-0044-s3-qualification-drill.md` carries the runnable
MinIO/R2/Tigris recipe plus the activation order (dev-lane fact → S3
attempt routes → per-provider drills, R2 first per LLP 0014).

### Implementation status: dev-lane S3 qualification (2026-08-03)

The drill ran: `s3_store_live_endpoint_qualification` passed against a
live MinIO endpoint (standalone darwin binary, RELEASE.2025-09-07T16-13-09Z,
loopback), with a wrong-secret negative control failing — the run was
live, not a skip. Per the activation order, the local target now declares
the dev-lane parameter: `assetLifecycleStores` is
`["local-fs", "s3-compatible"]` and the `SNAPBACK_ASSET_STORE=s3` refusal
lifts through the same declared-facts source the manifest embeds (the
gate and the claim cannot disagree; withdrawal of the fact restores the
refusal). Unchanged honesty: the S3 attempt routes remain designed-only
(multipart instructions are still held inherent), and no hosted provider
(R2, Tigris) is qualified — each earns its own per-provider drill fact
before any target claims it. The closed drill ticket
(`issues/closed/20260731-0044-s3-qualification-drill.md`) records the
evidence.

### Implementation status: consistent-cut export/import (2026-07-31, W2h)

The design above is implemented for the local target: `asset.exportCut`
writes the manifest plus digest-verified blob objects from one pinned
read transaction; `asset.importCut` validates refuse-partial and, under
`SNAPBACK_ASSET_IMPORT_EXPERIMENTAL=1`, restores onto an empty asset
state with fresh opaque keys, epoch-bumped generations, and imported
tombstones (`crates/snapback/src/assets_cut.rs`, host-ops + `snapback assets
export-cut/import-cut`, receipts `CutExported` /
`CutImportValidated` / `CutImported`). The e2e suite proves the round
trip (restored bytes serve through ordinary delivery), the epoch fence,
tombstone persistence, non-empty-target refusal, and refuse-partial with
zero rows landed on tampered or incomplete directories. Still designed-
only: restore under a real app-data import (the complete-cut admission
end to end) — the experimental gate stays until that evidence exists.
Byte-level snapshot backup remains Missing.

### Implementation status: post-bakeoff fix wave (2026-08-01)

The triage-driven fix wave landed across two lanes and a review pass
(β1 `e84b0570`/`26a9334c`, α `0b641288`/`5ed6d6b9`/`ef1141fe`/
`1e337b4f`, β2 `67da515f`/`ed8ee876`, docs `cdca8280`): the per-VM
strict host context (every VM now claims the Enforce-mode context —
previously only the first VM on the installing thread had it), declared
application refusals (`ctx.refuse` with a manifest-declared closed set;
undeclared claims fold with payloads dropped), the schema-module
definition refusals, the small-S sweep (anonymous-public custody,
generation-time accept refusals, canonical digest + integrity grade on
the record surfaces, chunk-narrowing limits preflight, honest
diagnostics), `_snapback.myMemberships`, the Expo poisoned-resume fix
with loss forensics, nine guide pages, and thirty-four ticket
resolutions audited at tip by the review pass (full gates green:
1570 lib tests, conformance 18/18, Party Wall 12/12). Routed rather
than fixed, deliberately: principal-addressed membership writes and
partition-visible keyset pages await LLP 0100's ratification; the RN
durable store belongs to the LLP 0129 adapter lane; sessions callback
authority awaits its 0055-style design. The packaged-surface staleness
class is retired: 0.1.8 published from `5d5c6b71` and externally
re-verified by the 0137 sweep (21/22, no regressions).
