# LLP 0124: Product breadth — file storage and vector search

**Type:** Research
**Status:** Review
**Systems:** Competitive evaluation, Assets, Storage, Search, Application data API
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:**
**Related:** LLP 0073, LLP 0074, LLP 0115, LLP 0116, Diary 0029, Diary 0030, Diary 0031, Diary 0039

## Summary

Two Convex capabilities the first bakeoff round recorded as outright
Snapback product GAPs — authenticated file storage and vector/semantic
retrieval — are covered by no current course-corrections plan. LLP 0115
sequences the work that closes the Diary 0039 rerun's remaining gap, but
the rerun's seven-app matrix deliberately contained no file or vector
contract, so these gaps were structurally invisible to it and are correctly
absent from its status board. This Research document carries the bakeoff
record for both so it is not lost between planning cycles.

The honest current state, verified against code and guide on 2026-07-30: no
Snapback target ships either capability, and both are declared as explicit
nonclaims — `assetUpload: false` plus `assets` in the generated capability
manifest's gap list, and owned GAP rows in `guide/capabilities.md` for
`backend.assets` and `backend.vector-search`. The ownership situation is
asymmetric and load-bearing: file storage has a designed owner, LLP 0044
(Draft RFC, 2026-07-07, zero implementation), while vector search has **no
owning design document at all** — its capability-index witness is LLP 0019,
a research document recording the vector decision as "a genuine, unmade
product decision."

The document lays out the diary evidence, the option space for each
capability (four storage paths, five vector paths), and what the diaries
suggest the minimum viable surface is. It deliberately makes no final call.

## What Convex does

### Storage: one cohesive lifecycle (diary evidence)

Diary 0030's Convex arm (Partiful workload, 2026-07-29) exercised the full
Convex Storage lifecycle and scored it as the arm's second standout after
transactions/realtime:

> Storage was cohesive: upload URL, opaque Storage identity, authorized
> delivery, exact 262,144-byte hash, outsider denial, deletion, and
> post-delete negative probes all fit the native surface.

The initial push "compiled indexes, scheduler, Storage identities, and
system-table inspection cleanly," and anonymous local startup "kept durable
SQLite data and Storage inside the project" — bytes and rows under one
local authority, no separate blob account; asset round trip 40.168 ms
median. The verdict names native Storage as one reason Convex "is a strong
default for this workload," and the lessons ask Snapback to "match the
outcome of ... authenticated object Storage." Diary 0031's Convex arm
confirmed the ingestion side: "Native upload URLs, file identity, delivery,
and deletion covered the source lifecycle with little glue."

General Convex background (not diary-verified beyond the behaviors above):
a mutation mints a short-lived upload URL, the client POSTs bytes, the
function stores the returned opaque storage ID in an ordinary document
field, and delivery/deletion go through `ctx.storage` under the same
function-level authorization as data. LLP 0074's verified capability
inventory lists "file storage" among Convex's shipped surfaces.

### Vector search: an index clause in the ordinary schema (diary evidence)

Diary 0031's Convex arm is the sharpest single sentence in the corpus on
why this matters:

> One schema declared ordinary, full-text, and vector indexes.

One declaration surface covered all three retrieval regimes. The workload
stored deterministic 32-dimensional fixture embeddings and retrieved them
through the native vector path, beside full-text search, scheduled
mutations, and file lifecycle — the whole Research Room envelope in one
provider. The verdict (a "no" only because of a local credential-hygiene
Stop defect) is explicit that "realtime, storage, scheduling, full-text
search, and vector search are unusually complete and concise," and the
lessons ask Snapback to "match the outcome of declarative transactional
full-text and vector retrieval beside ordinary schema."

The diary also recorded the cost honestly:

> Vector search also requires action → internal query → vector search →
> internal query composition so authorization and document hydration remain
> correct. It works, but adds conceptual overhead.

Even in the most complete competitor, vector retrieval is not an ordinary
reactive query — it runs in an action tier with manual
authorization/hydration composition. A Snapback design does not have to
beat "one schema clause"; it has to beat "one schema clause plus a
documented composition pattern." As background: Convex vector search is
schema-declared (`vectorIndex` with dimensions and filter fields), queried
from actions, and Convex does not compute embeddings — the application
supplies vectors, typically via an action calling an embedding API.

### The rest of the field raises the same bar

Both gaps recur across the five-competitor bakeoff. Diary 0031: Firebase's
"ordinary `findNearest` path accepted the frozen 32-dimensional vectors"
locally, and "Firebase's ordinary local vector path raises the capability
bar"; Supabase's "Postgres full-text search and pgvector made keyword and
semantic retrieval feel like ordinary schema work rather than separate
infrastructure." Diary 0030 recorded credible authenticated storage
lifecycles for Supabase, Firebase, Appwrite, and InstantDB as well.
Snapback is not chasing one vendor's feature; it is below a field-wide
floor on these two rows.

## What Snapback does today

### File storage: a designed owner, zero shipped surface

Nothing ships. The generated capability manifest
(`schemas/capability.manifest.local-dev-sqlite-ibex.json`, hard-coded in
`src/manifest.rs`) reports `"assetUpload": false` and lists `"assets"` in
`capabilityGaps` — a machine-readable nonclaim on every target. There is no
asset route in the LLP 0031 route registry, no asset host-op, and no asset
code in `src/` or `packages/`.

The guide's capability index carries the owned GAP row (`backend.assets`):

> Authenticated asset-byte upload, storage, delivery, deletion, and
> processing; no target ships this product surface yet | files, images,
> upload, object storage, media | none | design-only | ... | llp/0044 | GAP
> (owner: Charlie, review: 2026-08-31)

The row exists because Diary 0030's Snapback arm forced it; the resolved
ticket
(`issues/closed/20260728-guide-gap-assets-and-notifications-capability-rows.md`)
records that before 2026-07-28 the index was silent on assets entirely.

Ownership does exist on paper. **LLP 0044** (Asset storage pipeline, RFC,
Draft, 2026-07-07) designs exactly the missing surface: system-owned asset
metadata (id, owner principal, byte-store key, checksum, upload/processing
state), upload sessions with authorization checks and bounded expiry, a
local filesystem byte store plus an S3/R2-shaped object-store seam, signed
URLs as transport artifacts ("not the source of permission truth"),
processing as an LLP 0028 cron sweep, and per-target size/quota capability
facts. It was cross-family reviewed and ratified the day it was written —
then never implemented or revised, while auth (0055–0059), durable
background work (0070, which supersedes its cron-sweep fallback), and the
hosted control plane (0072/0111) all moved substantially. Reviving it means
a real reconciliation pass, not a dusting-off.

The root storage spec already points at it: LLP 0007 rules that "Binary
values and asset bytes are not inline document fields on the paved path.
They should be stored through the asset subsystem, with metadata and
references stored in ordinary tables." The paved path names a subsystem
that does not exist — which is why Diary 0030's Snapback arm could not
substitute table bytes (the guide row forbids relabeling application-table
bytes as this capability), and why Diary 0028's Snapback chat arm, which
did ship an inline 256 KiB asset as table bytes, conceded that "production
event media would still want object storage."

### Vector search: no owner at all

Nothing ships, and — unlike storage — nothing owns the design. The guide's
GAP row (`backend.vector-search`):

> Portable vector storage, ANN indexing, and semantic retrieval; no
> ordinary vector path ships today | vector, embeddings, similarity,
> semantic search, RAG, ANN | none | design-only |
> llp/0019-agentic-readiness.research.md (unmade product decision; no
> shipped witness) | llp/0019, llp/0007 | GAP (owner: Charlie, review:
> 2026-08-31)

The witness column is itself the finding: the best available citation is a
research document recording that the decision has not been made. LLP 0019
(F7) recommends the shape — "a `v.vector(dims)` type with a portable ANN
index contract (e.g. sqlite-vec locally → pgvector on graduation)" in
LLP 0007's one-physical-mapping-per-engine frame, explicitly independent of
the actions subsystem because "storing and querying vectors is a local
storage / index concern that needs no outbound network" — but a
recommendation in a research doc is not an RFC, and its open question 5
(extend 0007, or a separate document?) was never answered.

LLP 0073 deliberately fenced this off: "Offline client-side search and
semantic/vector search are separate future profiles," and extensions "such
as stemming, typo tolerance, **vectors**, or provider ranking are separate
named capabilities and cannot change the base profile silently." The
shipped search RFC reserves the slot and the admission rule but contains no
vector design. A grep of `src/` finds no embedding, ANN, or similarity
code; `src/search/` is the FTS implementation only. The closest fragment is
negative evidence done right — Diary 0031's Snapback arm: "Stored
deterministic 32-dimensional fixtures were not mislabeled as
semantic/vector retrieval."

## How they differ and why it matters

### Two app classes are blocked outright

**Partiful-class media apps.** Diary 0030's Snapback arm passed all twelve
frozen scenarios it could attempt — capacity contention, live revocation
blanking, cron-driven effects — and still concluded:

> The absence of authenticated asset upload, delivery, and deletion blocks
> a Partiful-shaped product.

The verdict was "conditional, not as my present default for this app ...
assets and hosted operation are table stakes." Event photos, avatars,
social feeds: the consumer-app genre where the blob is the content. The
2026-07-29 installed-package confirmation reproduced the same
12 PASS / 3 GAP score; packaging progress did not move the gap.

**Research/RAG-class apps.** Diary 0031's Snapback arc is the more
instructive because everything else improved and the gaps stayed fixed. The
first arm was product-blocked by a capability-composition defect. The
remediation rerun was decisive — 13 passes, zero failures — and "the two
honest gaps remain authenticated asset storage and provider-native
semantic/vector retrieval." The final package confirmation from immutable
tarballs kept "the same files/vector GAPs." Three checkpoints, every
fixable thing fixed, both gaps untouched, ending:

> Convex, Supabase, Firebase, Appwrite, and SpacetimeDB still cover more of
> the product envelope because they provide some combination of files,
> indexed search, semantic retrieval, mature hosted deployment, and broader
> operations.

and the instruction to "prioritize real asset lifecycle and authorized
indexed semantic retrieval rather than substituting metadata rows or
application scans."

### One neighboring gap already retired; do not re-litigate it

Diary 0029 (Linear bakeoff) listed search among Snapback's four product
gaps and made it choice-blocking ("For a local-first issue tracker today,
no: search, hosted operations, and protected offline editing are too
central"). That complaint is **retired**: indexed full-text search shipped,
Diary 0039's Pantry arm used it end-to-end, and LLP 0115's "Retired gaps —
do not re-litigate" section pins it. The full-text half of retrieval is
0115's business (CV-5/10/11/12). What Diaries 0029/0031 leave open is
specifically the *semantic/vector* half, which 0073 explicitly reserved and
no one has picked up.

### Why LLP 0115 does not cover this, and why that is correct but risky

Diary 0039's method section bounds the rerun: "It tests local development,
authoring, generated contracts, transactions, realtime, ephemeral state,
search, and scheduled work." No arm uploads a byte; no arm embeds a
document. The 55/45 score is a score over workloads where both products
have surface — fair, and by construction blind to the two rows where
Snapback has *no* surface. 0115 inherits that frame deliberately. The risk
this document exists to name: 0115's exit criterion can be fully satisfied
— every arm a near-tie or win — while "would you choose it for Partiful or
Research Room?" stays *no* for the same two reasons recorded in July.
Product breadth does not appear on a matrix that excludes it.

### This is also the agent-era default workload

The bakeoff apps are not exotic. An agent asked to "build me an app" in
2026 reaches for file upload (avatars, attachments, camera output) and
semantic retrieval (RAG over the user's documents) about as often as it
reaches for auth. LLP 0019 called the vector primitive the "highest-value
runtime-AI addition," and LLP 0074's strategy explicitly targets
agent-built applications. A backend positioning itself as the agent-first
choice while its capability index answers `none` on both rows sends agents
to the competitors' arms of exactly these diaries.

## Option space — file storage

The paths compose (S3 can stage S1/S2; S4 is the interim posture of all of
them). What is not an option is the status quo *silently*: the nonclaim is
honest, but LLP 0007's paved path cites a subsystem that must eventually
exist or be re-specified.

**S1. First-class Snapback asset lane in Snapback's idiom.** Implement
LLP 0044 (revised): capability-declared upload sessions, authority-checked
upload/delivery/deletion, receipts for every lifecycle transition,
content-addressed identity (0044's checksum promoted to the identity), and
TTL/budget options on upload sessions — the ephemeral-state and evidence
DNA applied to blobs. Claims look like every other capability: an
`asset-lifecycle-v1` id with target-scoped size/quota facts, fail-closed
`SNAPBACK_ASSET_*` diagnostics, and acceptance replaying Diary 0030's
Convex lifecycle verbatim — upload session, opaque identity, authorized
delivery, exact hash, outsider denial, deletion, post-delete negative
probes. That seven-step sequence *is* the minimum viable surface; the
diaries ask for nothing fancier (no transforms, no CDN — 0044's non-goals
already exclude them). Sequencing: local filesystem store first, hosted
later. Cost: the largest option, and it forces the 0044 reconciliation.

**S2. External-store integration contract.** Snapback owns authorization,
metadata rows, receipts, and lifecycle state; bytes live in an
S3-compatible store (Tigris/R2/S3) reached through presigned URLs Snapback
mints — 0044's object-store seam promoted to load-bearing. The hosted half
already exists in LLP 0111's orbit: the Fly profile operates a Tigris
bucket with per-role prefixes, scoped credential custody, and
read-back-verified writes — but 0111 names "application access to
Fly/Tigris primitives" an explicit **non-goal**, so S2 requires a
deliberate amendment there, not just code. Claims: the same lifecycle
capability id plus an honest split — Snapback proves
authorization/metadata/receipts; byte durability is the external store's
claim, named as such. Evidence: denial and post-delete probes against the
real store; hash verification via read-back. Sequencing quirk: the rare
path where **hosted is easier than local** (local needs a MinIO-class
dependency or a filesystem emulation of the seam). Risk: the first
Snapback capability whose acceptance depends on a third party.

**S3. Local-first blob storage, hosted deferred.** Bytes in the instance
directory (or SQLite blobs for small assets), served by the Snapback server
under session authority; hosted keeps the GAP. This matches how every other
capability entered the product — local SQLite profile first with
target-scoped claims — and is the smallest path to turning Diary 0030's
Snapback arm green, since the bakeoff arms are local. No presigned URLs
needed at all: delivery is an authorized route, locally *simpler* than
Convex's model. Cost: defers exactly the half Diary 0030 also flagged
("assets **and hosted operation** are table stakes") and risks designing a
delivery surface the store seam later contradicts. Best understood as
stage one of S1 with the seam designed but unimplemented.

**S4. Explicit nonclaim plus guide recipe.** Keep `assetUpload: false`;
document the app-authored pattern (metadata rows plus an app-managed
external bucket from actions, or dev-only inline bytes with Diary 0028's
256 KiB lesson stated). Honest, cheap, and consistent with how
notifications are held today. But the diaries set its ceiling: an
app-authored pattern is precisely what Diary 0030 scored as a GAP and
Diary 0031 told Snapback to stop substituting. S4 is a defensible *posture
between now and a decision*; as a destination it concedes the Partiful
class permanently.

## Option space — vector search

**V1. Extend portable search with a separate vector capability.** Follow
LLP 0073's own admission rule: vectors are "separate named capabilities,"
so mint `vector-search-v1` beside `full_text_search_v1` with its own
declaration (`.vectorIndex(field, dims, metric)`), its own evidence, and
0073's staged-adapter pattern — exact portable semantics first (a
brute-force or sqlite-vec-class local implementation over SQLite),
accelerators later as separately-reported capabilities, hosted targets
qualifying independently. 0073's frame answers the hard questions by
precedent: authorization ("search never authorizes data" — candidates pass
generated visibility before release, structurally removing the manual
composition Convex pushes into actions), determinism (exact distance
arithmetic and pinned tie-breaks the way FTS pinned integer scoring),
cursors, freshness, rebuild. The tension V1 must resolve rather than
inherit: ANN is *approximate*, and 0073's determinism DNA fits exact k-NN
over bounded corpora better than HNSW-class recall claims — v1 could pin
exact search with declared corpus bounds and leave approximate indexes to a
later accelerator capability. Minimum viable surface per Diary 0031: a
declared index beside ordinary schema, fixed dimensions, authorized
nearest-neighbor query returning hydrated documents — the frozen 32-dim
fixture workload is the acceptance test already written.

**V2. Embedding-agnostic index contract (store and query only).** Whatever
the indexing path, Snapback never computes embeddings: vectors arrive as
ordinary written values (typically from an action that called an embedding
API under the existing outbound-fetch gate), and the platform's claim is
storage, indexing, and retrieval only. This is LLP 0019's explicit
recommendation ("independent of the actions subsystem"), it matches what
Convex actually does, and it is what kept Diary 0031's workload
deterministic — acceptance needs no network and no model pin. V2 is less an
alternative to V1 than V1's boundary condition; it is listed separately
because *choosing it explicitly* forecloses V3 creep.

**V3. Integrated embedding pipeline.** The platform computes embeddings —
`ctx.ai.embed(...)` or schema-declared auto-embedding on write. Maximum
convenience, and the point where the platform swallows model choice,
API-key custody (LLP 0036), outbound-action policy (LLP 0009/0076), cost
metering, embedding versioning (re-embedding on model change is a
migration), and nondeterministic acceptance. LLP 0019 already sequenced
this *after* the storage/index half, as "a thin capability over actions,"
and no diary evidence demands it: every bakeoff competitor also made the
application bring its own vectors. Research posture: a later ergonomic
layer over V1+V2, never the admission path.

**V4. External vector-store contract.** Snapback brokers a
Pinecone/Qdrant/pgvector-service integration: authorization and document
identity stay in Snapback, ANN queries go out. The mirror of S2 with a
worse evidence story — results depend on an external service's recall
behavior, row-lifecycle/remote-index sync becomes a consistency surface
(deletion must provably remove remote vectors; the 0030-style negative
probe crosses a network boundary), and local-first acceptance needs a
running third-party service. Plausible someday for corpora beyond a local
profile's bounds; nothing in the diaries asks for that scale, and 0073's
precedent (PostgreSQL is a GAP until the store seam earns it) suggests
external targets earn admission late, not first.

**V5. Defer with nonclaim.** Keep the GAP row and do nothing. Cheapest and
honest — but note the asymmetry with storage: S4 at least has LLP 0044 to
point at, while V5 leaves the capability with no owner and a research doc
as its witness. If deferral is chosen, the minimum dignified version still
answers LLP 0019's open question 5 — write the owning document (a 0007
amendment or a new RFC in 0073's frame) whose status is honestly "designed,
unscheduled," so the GAP row names a design rather than an unmade decision.

## Findings

1. **Neither capability has moved since the July bakeoffs.** As of
   2026-07-30, `assetUpload: false` and the `assets` gap are hard-coded in
   `src/manifest.rs`; no asset or vector code exists in `src/` or
   `packages/`; both guide rows read `targets: none`,
   `maturity: design-only`.
2. **Ownership is asymmetric.** File storage has a real Draft owner
   (LLP 0044) that is 23 days stale against the auth, background-work, and
   hosted subsystems it touches. Vector search has no owning design
   document; its capability-index witness is LLP 0019's statement that the
   decision is unmade, and 0019's open question 5 (where the design should
   live) is still unanswered.
3. **The gaps are choice-blocking in the diaries, not cosmetic.**
   Diary 0030: "The absence of authenticated asset upload, delivery, and
   deletion blocks a Partiful-shaped product." Diary 0031 held both GAPs
   through a decisive remediation (13 PASS / 0 FAIL) and a package
   confirmation — fixing everything else did not move them.
4. **LLP 0115 correctly excludes them, which makes them orphans.** The
   Diary 0039 matrix had no file/vector contract; 0115 inherits that scope.
   Its exit criterion can be met in full while both bakeoff verdicts
   ("would not choose it for this app") remain true for unchanged reasons.
5. **The full-text precedent shows the admission path works.** Diary 0029's
   search GAP went from choice-blocking to retired in one cycle via
   LLP 0073's staged, evidence-first pattern — and 0073 already reserves
   the vector slot as a separate named capability, so V1 has a paved
   on-ramp.
6. **The paved path has a dangling pointer.** LLP 0007 directs asset bytes
   "through the asset subsystem" — a subsystem that does not exist. Either
   an implementation (S1/S2/S3) or a re-specification (S4 made permanent)
   is required for the storage spec to be internally honest.
7. **Part of S2's hosted machinery exists but is fenced off.** LLP 0111's
   Fly profile operates Tigris with scoped credentials and read-back
   verification, and simultaneously lists "application access to
   Fly/Tigris primitives" as a non-goal; an external-store asset lane needs
   that fence consciously moved, not worked around.
8. **The nonclaim discipline held and is worth keeping.** Both diaries'
   Snapback arms refused to mislabel table bytes or fixture embeddings as
   product capabilities, and the guide rows forbid it. Whatever path is
   chosen, admission should run through capability ids and evidence, as
   full-text's did — the diaries reward that posture explicitly.

## Confidence

High on the current-state facts (capability manifest, guide rows, absence
of code, LLP 0044/0019/0073 contents — all read directly this session, on
the same main revision that carries LLP 0115 v0.3). High on the diary
quotes (read verbatim from Diaries 0029/0030/0031/0039). Medium on the
general Convex background not diary-verified (upload-URL mechanics,
`vectorIndex` declaration shape) — consistent with LLP 0074's verified
inventory but not re-verified against Convex docs today, and labeled as
background where used. Low-to-medium on the option-space cost judgments
("hosted easier than local" for S2, the ANN-vs-exact tension in V1):
directional analysis, not design.

## Open questions

1. Who owns the storage decision — an LLP 0044 revision (reconciling
   0055–0059 auth, LLP 0070 processing, 0072/0111 custody) or a fresh Spec
   that supersedes it? And is the first store local-filesystem (S3-path) or
   the object-store seam (S2-path)?
2. Where does the vector design live — an LLP 0007 amendment (LLP 0019's
   framing) or a new RFC beside LLP 0073 in its staged-adapter idiom (V1's
   framing)? This is 0019's open question 5, unanswered since June.
3. Does vector v1 claim exact k-NN with declared corpus bounds
   (deterministic, 0073-style) and defer approximate ANN to a
   separately-claimed accelerator capability, or admit approximate recall
   into the base profile with a different evidence vocabulary?
4. Do these capabilities enter the next matrix rerun? LLP 0115 open
   question 4 already contemplates an eighth contract for new surfaces; a
   Partiful- or Research-Room-shaped contract is the only way product
   breadth ever appears in the score.
5. Is storage/vector work gated behind the LLP 0115 tranches (which claim
   the same execution attention), or does the Partiful/Research-Room class
   of external user justify starting the owning-document work now, in
   parallel with Tranche A?
6. Should the interim S4/V5 posture get a guide recipe page (app-authored
   external bucket; action-computed embeddings in ordinary rows) so the
   nonclaim comes with a workaround, or would a paved recipe blunt the
   pressure to ship the real capability?

## Relationship to LLP 0115 and owning documents

This document is part of the Convex-parity research series that expands on
the bakeoff record around LLP 0115:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search (this document) |
| 0125 | concurrency-and-conflict-ergonomics |

Division of labor: LLP 0115 plans and sequences the gaps the Diary 0039
rerun *measured*; this document records the two product GAPs the rerun's
matrix could not see, sourced from the earlier bakeoff round
(Diaries 0029–0031). It follows 0115's CV-12b precedent in treating new
targets and capabilities as separately-evidenced admissions, and its
"owning documents stay owners" constraint: nothing here respecifies storage
(LLP 0044 or its successor per open question 1), search (LLP 0073), the
data API (LLP 0004/0007), or hosted custody (LLP 0072/0111). If an option
above is chosen, the substantive design lands in the owning document, the
guide rows flip from GAP to witnessed, and this Research document's job is
done — at that point it should be revised to point at the owner and, once
both capabilities have shipped or been permanently re-specified as
nonclaims, tombstoned as bakeoff history.
