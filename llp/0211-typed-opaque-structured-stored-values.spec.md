# LLP 0211: Typed opaque structured stored values

**Type:** Spec
**Status:** Implemented
**Systems:** Schema, Application data API, Storage, Code generation, Client SDK
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-09
**Revised:** 2026-08-15 (migration completion: case 2's same-name staged
route is now the LLP 0081 `ConvertJsonToStructured` intent, with successor
validation/canonical rewrite and row-count/content-digest proof).
**Revised:** 2026-08-15 (principal-snapshot amendment: `v.principal()` is
admitted as a validated nominal leaf inside opaque structured values. Its
interior occurrence is storage and egress data only; it confers no visibility,
membership, grant, lookup, or referential semantics.)
**Revised:** 2026-08-10 (ACCEPTED by the author, Charlie — the
super-refine close-out's unreviewed-tail caveat acknowledged in the
acceptance; and the **support flip performed** under the same ruling:
`structured_stored_value_v1_registered` is true, the separate reviewed
act §Capability required, with the Phase A acceptance corpus green at
`979f3aab5`). Prior: 2026-08-09, Phase A implementation records the closed structured
dispatch, persisted carrier, canonical storage path, observation refusals,
experimental capability registration, and acceptance corpus. The OQ3 proposed
ceilings are now frozen at 32 KiB per value, 48 KiB per row, depth 16, and
1,024 elements; local support remains false pending its separate reviewed flip.
Landing record (same day): Phase A LANDED at `979f3aab5`, after the
unique-where-present landing (`0fdd8adde`) it composes with; the four
signed-activation demos stay at their committed generation, and the
carrier/receipt re-mint for today's three schema rotations is owned by the
open S0-rotation ticket's single ceremony
(`issues/20260809-signed-composition-activations-need-remint-after-s0-toolchain-rotation.md`).
Prior: 2026-08-09, round-3 close-out revision (**this revision's
delta is UNREVIEWED** — the 3-round budget is exhausted; round 3 at
`a8e1d75df` returned one MATERIAL per family, both IN-DELTA, both fixed
here: the search-storedFields disclosure split by layer per the Rust
validator's existing `Json` refusal, and the StoredStructuredContractV1
wire members + hash formula pinned exactly (0131's formula shape under
`snapback:stored-structured-contract:v1`); plus the migration-case count,
the literal-union-with-null sibling hint, and domain-string precision.
Pre-existing text was MATERIAL-clean across both families in both delta
rounds — the loop closes by delta-convergence with this unreviewed
tail). Prior: 2026-08-09, round-2 revision (delta round at `bf5cfa214`:
fable one MATERIAL / codex four MATERIAL, all IN-DELTA, zero
PRE-EXISTING across both families — delta-convergence conditions hold on
pre-existing text; fixes: frame-fit claim restated as bounded structured
contribution with delivery-posture parity; dispatch closed over every
builder form incl. the four numeric spellings (codex's "v.number is not
a builder" claim refuted against define.mjs:407) and a nullable-scalar
teaching hint; `StoredStructuredContractV1` carrier fully specified
(persisted descriptor, domain-separated hash, load-time recompute,
encoding-id in storage-generation identity, goldens + planner fixture);
local support = plain registered boolean per LLP 0134 §1, hosted
claim-family home corrected to LLP 0113 §4, client support-false =
cannot-settle; migration case 4 (degraded installed manifests);
search/vector storedFields exclusion disclosed as new refusal; LLP 0044
enforcement-paragraph drift reconciled). Prior: 2026-08-09, round-1
revision (dual NOT READY at `0d951fa69`; all eight MATERIAL fixed).
Prior: 2026-08-09 (pre-loop codex adjudication absorbed; defect ticket
`issues/20260809-stored-vobject-silent-json-degrade.md`).
**Related:** LLP 0115 (CV-4b commission this slice is carved from), LLP 0004
(application data API; portability rules), LLP 0007 (storage portability),
LLP 0081 (migrations), LLP 0131 (unified argument grammar — the validator
vocabulary reused here), LLP 0044 (the 2026-07-31 bounded-array withdrawal
this Spec must not silently re-litigate), LLP 0110 (bounded children — the
ruled paved path for multi-asset), LLP 0191 (§5 schema-fidelity quick-win
sequencing — the carve-out precedent), LLP 0208 (G8 pilot evidence),
LLP 0117 (CV-4 analysis layer), LLP 0134 (capability maturity), Diary 0073

## Summary

A narrow stored-field slice of LLP 0115 CV-4b: schema-declared **plain-data
structured values** — objects, arrays, and unions built from the LLP 0131
recursive validator vocabulary — admitted at stored-field positions,
validated fail-closed at write through the same machinery CV-4a landed at
the arguments boundary, stored as one **RFC 8785 canonical-JSON `TEXT`
column**, and projected as exact generated types. The interior of a
structured value is **opaque to the query surface by design**: element
indexing, `arrayContains`/containment, structured matchers, ordering,
filtering, and search over interiors all continue to refuse fail-closed
exactly as today, now with teaching diagnostics. Asset references are
excluded from structured values entirely.

This is the second application of the carve-out pattern the
union-of-string-literals slice established on 2026-08-08 (LLP 0004/0007
dated amendments, per LLP 0191 §5): identify the slice that pays the least
of CV-4b's four named costs — no new index semantics, no matcher
vocabulary, no representation decision for *indexable* structure, and
migration confined to the additive case (adding a structured field is
cheap; conversions are O(N) staged work, priced in §Migrations) — and ship
it without waiting for the owner Spec. The commissioned CV-4b Spec
(representation choice for indexable structure, element indexing,
containment, live-matcher semantics) **remains commissioned and unchanged**,
demand-gated on element-query evidence that no benchmark run has yet
produced.

## Motivation

The Clique P2 pilot (LLP 0201/0208, Diary 0073) is the richest builder
evidence to date, and its schema score (B1 72 vs Convex 85 / Supabase 88)
names the gap directly. Two of its instances are this Spec's demand:

- the quoted-reply **stored preview** object went through the `v.json()`
  escape hatch — untyped, unvalidated at write, loud degraded-contract
  diagnostics;
- the M7 evolution session stored **poll options** the same way.

Equally load-bearing is what the pilot did *not* need: across a full
messenger — feeds, group messaging, media, search, offline, a 166k-action
replay — **no surface queried the interior of a stored structure**. The
arrays in play were small bounded lists atomically replaced and never
filtered by element; the preview is opaque at read. The expensive parts of
CV-4b's commission (element indexes, containment, structured matchers) have
zero observed demand; the cheap part (typed, validated, canonical storage)
is where the boilerplate and the `v.json()` escapes were paid.

Much of the machinery is already on main. CV-4a landed the full recursive
vocabulary with server-side ingress validation and RFC 6901 pointer
diagnostics at the args boundary (LLP 0131); CV-10 pinned RFC 8785 number
spelling at the search source/recheck and hashing boundaries; codegen
already projects exact recursive types for the same vocabulary at args and
result positions. This Spec extends that landed grammar to one new
position rather than designing a new one. One precision bound, so the
reuse claim stays honest: today's `FieldType::Json` values are stored as
plain `serde_json` output and the reader checks only parseability — stored
bytes are **not** currently canonical anywhere. CV-10 is precedent for
canonical-bytes contracts, not coverage of this one; §Representation
defines a new, versioned encoding contract and implements it.

There is also a live honesty defect
(`issues/20260809-stored-vobject-silent-json-degrade.md`): stored-position
`v.object({...})` is silently accepted and degraded to untyped `Json`
(shape erased, row type `unknown`, no validation, no diagnostic) while
`v.array` refuses and the guide claims both refuse. The current state is
not even a clean refusal surface; this Spec's admit path removes the
half-state.

## Prior rulings this Spec binds itself to

1. **The 2026-07-31 bounded-array withdrawal (LLP 0044, author decision).**
   `v.array(v.assetRef(...))` is withdrawn; multi-asset relationships take
   the LLP 0110 bounded-children child-row path (validated by Party Wall),
   and `issues/20260809-multi-image-authoring-revisit-g8.md` bars treating
   a revisit as a default. This Spec **preserves that ruling**: asset
   references are refused inside structured values (see Design), so
   Clique's `img1..img4` splay is *not* solved here — its ruled answer is
   bounded-children steering (the open G8 ticket's ask 1), and any
   bounded-array-of-assets revisit remains a separate author ruling
   request against LLP 0044. There is also a genuine technical reason the
   exclusion is right independent of the ruling: the asset authority
   machinery (attach, grants, lifecycle, sharing scans) needs references
   addressable as rows, which opaque interiors would defeat.

   The withdrawal's recorded rationale was phrased wider than its subject
   ("the portable field vocabulary ships no array table fields"); its
   scope was open question 1, **ruled 2026-08-09** — it binds the
   asset-reference vocabulary only — and LLP 0044's dated clarification
   landed with this Spec's round-1 revision.

2. **The literal-union carve-out (2026-08-08, LLP 0004/0007).** Stored
   unions of string literals have a landed representation (`TEXT` with a
   central fail-closed domain check, `FieldType::Enum`). This Spec does not
   re-represent them: a union of string literals **at top level** stays on
   the Enum path; unions appearing **inside** a structured value ride the
   canonical-JSON encoding like every other interior node. The boundary is
   the field's outermost node.

## Design

### Declaration: closed dispatch, closed interior

**Top-level dispatch** (after stripping one outer `v.optional`, which maps
to column nullability as today) — a closed table, not an inference:

| Outermost node | Disposition |
| --- | --- |
| existing scalar leaves, `v.id`, `v.assetRef`, `v.vector`, relation incarnations | unchanged — existing `FieldType`s, existing rules; this Spec touches nothing at top level |
| union of string literals within the Enum domain bounds | unchanged — the landed Enum path |
| union of string literals **outside** the Enum bounds (>7 variants or >64-byte literal) | **stays refused in v1**, unchanged — it does not fall through to the structured path, preserving the Enum evolution bound |
| `v.object(...)`, `v.array(...)`, any other `v.union(...)` | **`FieldType::Structured`** — this Spec |
| `v.json(...)` | unchanged — existing opaque `Json` field (with its existing degraded-contract diagnostics) |
| bare `v.literal(...)`, bare `v.null()`, `v.tuple(...)`, and every other builder form not named above | **stays refused in v1**, exactly as today's closed map refuses it — no fall-through to the structured path |

One authoring hint rides the dispatch (teaching-diagnostics posture): a
top-level `v.union([<scalar>, v.null()])` becomes a `Structured` field —
canonical-JSON-encoded, no predicates, no index eligibility — which is
rarely what a nullable scalar column wants; the schema compiler's
diagnostic on such a union names `v.optional(<scalar>)` as the likely
intent. The sibling case `v.union([...string literals, v.null()])` gets
the same family of hint, naming `v.optional(v.union(...literals))` (the
Enum path) as the likely intent.

**Interior leaf set** (inside a `Structured` value) — closed, enumerated;
everything not listed refuses fail-closed at schema compile with a named
diagnostic pointing at this Spec:

- **Admitted** (by authored builder spelling, enumerated — all four
  numeric builders are distinct spellings and all are admitted):
  `v.string()`, `v.boolean()`, `v.integer()`, `v.real()`,
  `v.finiteReal()`, `v.number()`, `v.literal(...)`, `v.null()` (as a
  union variant), `v.principal()`, `v.object(...)`, `v.array(...)`,
  `v.union(...)`, and `v.optional(...)` at object-member position only.
- **Refused, each with its reason recorded:** `v.assetRef` (the prior
  ruling; authority machinery needs addressable rows); `v.id` / relation
  references / `v.relationIncarnationOf` (referential integrity, cascade,
  and framework-authored lifecycle state must not hide in opaque values);
  `v.vector` (would silently lose its BLOB binary64 representation,
  dimension enforcement, and index eligibility); `v.json` (an unvalidated
  escape hatch inside a value the platform calls validated — the honesty
  defect this Spec exists to remove); platform-constructed schema refs
  (framework-owned typing);
  `v.tuple` (deferred; no demand instance).

An interior principal is a **nominal snapshot**, not an authority edge. The
ordinary principal validator still rejects values outside its nominal string
contract, but the enclosing structured column remains opaque: authorization,
visibility, membership, asset grants, principal lookup, and referential
integrity never inspect or derive from that leaf. Any current-authority
decision must use a first-class principal field, membership row, or grant.

This is a deliberate **storage-position admissible-leaf profile** of the
LLP 0131 grammar — same spellings, no second grammar, but "same grammar"
does not mean every argument leaf is safe as a stored leaf. The
implementation note codex round 1 verified applies: the shared authoring
gate currently passes `v.vector` before position branching, so the
interior gate is new enforcement, not a re-labeling. LLP 0115 CV-4b's
note that 0127 move 1's one-grammar question stays unadjudicated
continues to hold: this Spec consumes the grammar; it does not extend it.

**Object closure and optionality — pinned, not open** (adopting LLP
0131's landed rulings; formerly OQ4/OQ6): declared objects are **closed
maps** (`additionalProperties: false`, the args-boundary behavior);
optionality means **omission**, admitted only at object-member position —
an absent member is an absent key in the canonical bytes, never JSON
`null`; explicit null is spelled `v.union([..., v.null()])`. `{}` and
`{"a":null}` are therefore distinct values only when `a`'s type declares
a null variant, and the durable byte contract never floats on this
distinction.

### Representation and write path

The **logical contract and the physical encoding carry separate,
versioned identities**: the field's declared shape (the LLP 0131 contract,
hashed as contracts are) is the public schema identity; the encoding is a
named target representation, `canonical-json-text.v1`, that adapters
implement. Applications and generated clients see logical structured
values only — never raw stored bytes — so a future encoding
(`jsonb`-backed, projection-augmented, child-row) is a new encoding
version behind the same logical contract, not a public schema break.

**The encoding identity has an authoritative carrier — specified, not
gestured.** The field's manifest entry carries a
**`StoredStructuredContractV1`** record with exactly three members:
`version` (the literal `1`), `descriptor` (the **complete recursive
validator descriptor** — persisted, because runtime validation executes
from it; a hash alone cannot validate — in the same frozen node grammar
LLP 0131's descriptor entries use, restricted to this Spec's admitted
leaf set), and `encoding` (the literal `"canonical-json-text.v1"`). The
contract hash is
**`sha256(UTF8("snapback:stored-structured-contract:v1" + "\n") || JCS(record))`**,
rendered `sha256:<lowercase hex>` — LLP 0131's exact formula shape under
this Spec's own domain string (deliberately not 0131's
`snapback:function-args:v2` domain; different root, different domain, no
cross-position collision). Consumers **recompute the hash from the
persisted record at load** and refuse on mismatch. Both the contract hash and
the encoding id participate in the storage-generation identity LLP
0081's planner derives plans from (predecessor/successor manifests), so
an **encoding-id-only change yields a successor generation** — a visible,
plannable, provable migration that cannot slide behind an unchanged
logical hash. This is the single-sourced physical mapping LLP 0007
requires, versioned. Acceptance pins it with cross-language goldens
(Rust/JS agree on descriptor bytes and hash) and a planner fixture
proving the encoding-id-only successor generation.

`canonical-json-text.v1` is one `TEXT` column per structured field,
holding **RFC 8785 canonical bytes**. Deliberately `TEXT` on every target
— not SQLite JSONB, not Postgres `jsonb` — because binary/normalized JSON
representations do not preserve byte identity, and canonical bytes give
the digest/evidence boundary a stable carrier (the same property CV-10
pinned for the search boundary; this is a new contract of the same
family). Top-level `v.optional` absence stores SQL `NULL`.

The write path is a central fail-closed check, sharing the CV-4a validator
core, guarding **every** write route the enum precedent guards — inserts,
patches, seeds, imports, migrations, and every buffered writer: validate
the incoming value against the declared shape (RFC 6901 pointer
diagnostics on refusal, same as `validate_function_args`), **normalize
interior numerics to their round-trip form at admission** (the CV-10/LLP
0073 analogue, applied inside the value: an integral Real admits as the
value its canonical spelling reloads to, so in-memory and reloaded
documents can never disagree), canonicalize, enforce bounds, store.
Non-canonical bytes are never stored; a value that fails validation
writes nothing (no partial write, matching the CV-4a exit's property).

Bounds, fail-closed at write (numbers provisional per open question 3;
the **mechanism** is pinned): per-value ceilings — 32 KiB canonical
bytes, depth 16, 1,024 elements per array (matching the existing contract
bounds and the portable collect cap) — **plus a per-row aggregate ceiling
on total structured bytes (proposed 48 KiB)**. What the aggregate ceiling
delivers is stated exactly: it bounds the **structured contribution** to
any row, journal entry, or delta envelope. It does not — and cannot —
guarantee whole-envelope fit under the 64 KiB live-frame profile, because
other field families (`v.string()`, `v.json()`) carry no byte ceiling
today and multi-row deltas aggregate rows regardless; the claim is
**delivery-posture parity**: a row with structured fields behaves under
delivery exactly as an equally sized row of string/Json fields does
today, with the structured share provably bounded. Oversized-envelope
behavior therefore remains the live-delivery machinery's existing
contract, untouched by this Spec. Enforcement is admission-time only: an
oversized structured write refuses with a named code; values never
truncate.

### Read path, types, and egress

Reads parse the canonical bytes and deliver the plain value; documents
crossing the API boundary carry the structure natively (LLP 0004's
"plain objects with schema fields" contract, now nested). Codegen projects
the exact declared type into generated document types, handler context
types, and client types — the same projection the args/result lanes
already do. The degraded-contract diagnostics that fire on `v.json()`
today do not fire on a declared structured field: that is the point.

### Observation surface: the complete matrix

In v1 a structured column admits **no predicates at all** — no equality,
no ordering, no `arrayContains`, no search-index membership, no
live-matcher inspection. Each refusal names the capability boundary and
points at the CV-4b GAP row rather than emitting a generic validator
error. (Byte-equality on canonical bytes would be cheap and well-defined;
it is deliberately deferred to open question 2, because
equality-on-structure invites containment-shaped expectations the v1
surface refuses.) Every surface that can observe a stored value is
enumerated here; anything unlisted is a defect:

- **Filters, ordering, live matchers, search/vector index membership** —
  refuse (today's behavior for `Json`, kept, with teaching diagnostics).
- **Index declarations** — refuse. Disclosed honestly: this is **new
  machinery**, not continuation — today an ordinary index declared on a
  `Json` column is silently accepted as dead weight by codegen and the
  Rust schema validator. v1 refuses index declarations on `Structured`
  columns; whether the same refusal (or a warning) retrofits onto plain
  `Json` columns is an implementation-phase complement, not required
  here.
- **Bounded-children / relational / maintained projections** — structured
  fields are not projectable leaves; the existing portable-scalar-leaf
  admission already excludes them there, and acceptance pins the
  exclusion so it cannot regress. **Search and vector `storedFields` are
  different, split by layer**: the Rust schema validator already refuses
  `Json` in search `stored_fields` ("bounded scalar display field"), but
  the JS authoring gate applies no stored-field type restriction and the
  vector path rejects only `Vector` on both layers — so excluding
  `Structured` is a **new refusal** on every layer where it is not
  subsumed (the JS gate everywhere; both layers for vector; the Rust
  search check extended from `Json` to `Structured`), acceptance-pinned
  like the index-declaration refusal.
- **Change journal and live deltas** — carry whole-row logical snapshots
  exactly as today; the §Representation aggregate ceiling bounds the
  structured contribution, so these surfaces keep exact parity with
  today's string/Json delivery posture and need no structure-aware
  behavior. (Whole-envelope fit was never guaranteed before this Spec
  and is not claimed by it.)
- **Read-your-writes overlays, retained/local client stores** — carry
  logical values (never raw bytes); the server remains the sole
  validation authority, and client lanes neither re-validate nor
  re-canonicalize. Acceptance pins the round trip.
- **Live queries** — whole-row invalidation and whole-value replacement,
  riding the existing delivery machinery unchanged.

### Update semantics and trap-avoidance pins

Structured values are **ordered, atomically replaced whole values**. v1
pins, so the opaque slice cannot grow accidental semantics that would
foreclose the commissioned Spec:

- writes replace the whole field after validation — no path operations,
  no deep merge;
- array elements have **no stable identity** — nothing may address, diff,
  or patch an element across writes;
- array order is significant and preserved;
- applications and clients depend on logical values only; raw stored
  bytes are an implementation detail no surface exposes.

### Migrations and forward compatibility (LLP 0081)

`FieldType::Structured` is additive. Four migration cases, priced
honestly:

1. **New structured field** — an ordinary additive migration under the
   existing required/default/backfill rules; cheap.
2. **Existing `v.json()` → declared structure** — deterministic but
   **O(N) proof-bearing work, not metadata-only**: every stored value must
   parse, validate against the declared shape, and (because today's Json
   bytes are non-canonical serde output) be rewritten to canonical bytes.
   **Every such conversion, at any table size, takes LLP 0081's reviewed
   add/copy/validate/publish/retire route** — implemented as LLP 0081's
   `ConvertJsonToStructured { table, field, generation }` intent. The round-1 reviews
   converged on this: the conservative applier rejects row-rewriting type
   changes by rule (LLP 0007), table size does not waive that authority,
   and an activation-time scan cannot rewrite bytes anyway; no fast path
   exists. The destination is a staged successor field/generation in
   0081's own shape (which treats representation conversion as
   proof-bearing and hashes logical rows independently of physical
   encoding). Preview selects shadow-generation from the staged/copy step
   graph; the copy validates and canonically rewrites every formerly-JSON
   value against the successor structured contract and carries row-count plus
   content-digest verification. Same-name conversion is successor-generation
   publish-then-retire, never in-place mutation; one invalid row refuses before
   publication.
3. **`canonical-json-text.v1` → a future encoding** (projections, jsonb,
   child rows) — logically mechanical (parse/re-emit; canonical bytes are
   already the complete document), **operationally O(N)** with the same
   shadow/backfill/publish/retire shape. Recorded so nobody later calls
   it free.
4. **Installed manifests carrying the degraded half-state** — a schema
   authored with stored `v.object({...})` before this Spec carries
   `FieldType::Json` in its installed manifest (the silent-degrade
   defect). When the dispatch flips, regenerating the same source emits
   `Structured`; the conservative applier refuses that as a type change —
   correctly fail-closed. The affected app chooses: rewrite the source to
   `v.json()` (stay degraded, explicit now) or take case 2's staged
   conversion. Priced here so the flip's deployment consequence is named
   even under the no-current-users posture.

The conservative applier admits no narrowing between structured and any
other field type in v1 (evolve by new field plus backfill, the existing
posture). The re-representation-trap objection is answered by the pins
above plus the encoding-identity split, not by pretending migration is
free: because the public contract is logical, bytes are canonical and
lossless, and no element identity or byte-dependence exists, both of the
commissioned Spec's candidate futures remain reachable by a standard 0081
move — and future scalar projections can even materialize from canonical
text without rewriting the source field at all.

### Capability and maturity (the LLP 0134 publication contract)

The capability id is **`structured_stored_value_v1`**. Its publication
contract, per LLP 0134/0113 rather than by gesture:

- it enters the closed capability registries as **experimental** with the
  **same-commit introduction record** LLP 0134 requires;
- **local support authority, named exactly** (LLP 0134 §1's non-inference
  rule bars "the standard carrier" by gesture: `LocalCapabilityPublicationV1`
  and `PackageCapabilityAttestationV1` bind only the relation/activity
  pair): `structured_stored_value_v1` takes the **plain registered
  local-support boolean** route 0134 §1 names for other local
  capabilities. The flip is a distinct, reviewed act landing only after
  the acceptance corpus is green — green tests are necessary evidence,
  never the flip itself. **No package attestation carrier is minted** in
  v1; published-package support claims wait for whatever attestation
  design covers non-relation capabilities, and until then packages carry
  no claim;
- **hosted support is not minted**: no claim-family kind exists for
  stored-field capabilities in LLP 0113 §4's closed union, and adding one
  is a **dated LLP 0113 amendment** (per 0134's rule locating the act
  there) when hosted work is actually pursued — until then hosted lanes
  are support-false by absence;
- **per-writer scope**: any target or write lane that does not carry the
  central validate-normalize-canonicalize seam (non-local targets,
  client-local write lanes) stays support-false — a hosted lane can never
  silently accept structured fields without canonical bytes. For client
  lanes, support-false means **cannot settle** — clients buffer and
  display logical values (§Observation) but hold no durable-admission
  authority; it does not mean a client must refuse an app declaring
  structured fields. Required-capability propagation binds the **serving
  runtime**, not the client;
- **required-capability propagation**: an app schema declaring a
  structured field emits `structured_stored_value_v1` as a required
  capability, so an older runtime refuses the app coherently instead of
  mis-serving it.

Maturity route: LLP 0113 qualification, per LLP 0115 decision 3 (0113 is
the default for new profiles); maturity and runtime support remain
distinct facts per 0113. The capability index GAP row for CV-4b narrows
rather than closes — indexable structure remains an honest GAP.

### Proposed amendment to the LLP 0115 CV-4b commission

This Spec proposes (for the 0115 owners to record on that board, not
decided here) restructuring the CV-4b commission into two phases:

- **Phase A** — this Spec: typed atomic persistence, codegen, central
  write validation, whole-row live payload semantics, the refusal
  surface, and the migration rules above.
- **Phase B** — demand-gated on element-query evidence: interior
  predicates, containment, and indexes, **reframed around portable
  declared projections rather than `arrayContains` specifically** —
  `arrayContains` is one candidate API, not an architectural requirement,
  and LLP 0007 already records the cautionary case for engine-JSON
  predicate translation (an untranslatable containment predicate causing
  silent whole-table scans is exactly what the portability rules refuse).

The proposal's claim — for the 0115 owners to adopt or reject when they
amend the row, not asserted from here — is that CV-4b's exit phrase
"defined index and sync behavior" is satisfied by Phase A for the atomic
tier, because a stable, named refusal covering the complete
§Observation-surface matrix is defined behavior.

## Acceptance evidence (exit)

1. Clique's two plain-data instances expressed natively: the quoted-reply
   preview and the poll-options shapes declared without `v.json()`, typed
   end to end, with a seeded handler/type mismatch failing at typecheck
   (the CV-17 pattern applied to stored positions).
2. Fail-closed vectors: every refused interior leaf (§Declaration's
   table: assetRef, id/relation incarnation, vector, json, platform refs,
   tuple) refuses at schema compile with its named code; principal arrays
   round-trip as nominal snapshots and reject invalid principal leaves;
   over-ceiling refusal for all four bounds (value bytes, depth, element
   count, per-row aggregate) with pointer diagnostics; a non-validating
   write provably writes nothing.
3. Canonical-bytes stability: the CV-10 insert/seed fixture class extended
   to structured fields — interior integral-Real spelling agrees between
   in-memory and reloaded values on **every** write route (insert, patch,
   seed, buffered, import, migration copy); digests stable across
   write/reload/patch. Carrier goldens: Rust and JS agree on
   `StoredStructuredContractV1` descriptor bytes and hash; a planner
   fixture proves an encoding-id-only change yields a successor
   generation.
4. Observation-surface refusals and exclusions: index declaration,
   filter, order, matcher use, search-index membership, and
   search/vector `storedFields` inclusion of a structured column each
   refuse with the named teaching code on both the SQLite target and the
   schema compiler; bounded/relational/maintained projections provably
   exclude structured leaves (a declaration attempting one refuses,
   pinned so the exclusion cannot regress).
5. Round-trip parity: a read-your-writes overlay and a retained/local
   client store each round-trip a structured value logically intact
   through offline/reconnect; when a Postgres adapter exists, a
   cross-adapter canonical-text/logical-value parity fixture joins this
   corpus (named now, deferred with the adapter per LLP 0007's
   cross-engine evidence rule).
6. Guide: the schema page and capability index updated in the same landing
   (LLP 0061) — the GAP row rewritten to steer "typed structured value,
   interior not queryable" here and "queryable interior" to the
   commissioned Spec.

## Non-goals

- Element indexing, containment (`arrayContains`), structured matchers,
  ordering, or search over interiors — the commissioned CV-4b Spec owns
  these, demand-gated (LLP 0115's row is unchanged by this Spec).
- The representation decision for *indexable* structure (column-per-scalar
  vs document-plus-projections vs child tables) — explicitly not decided
  here; §Migrations shows this slice forecloses none of the candidates.
- Asset references in structured values, and any revisit of the
  2026-07-31 bounded-array withdrawal (LLP 0044's ruling stands; the G8
  ticket's steering ask proceeds independently).
- Unique-index-on-optional-field semantics — Clique's other B1 complaint;
  belongs to the LLP 0007/0004 owners, filed as
  `issues/20260809-unique-where-present-optional-fields.md` (the codex
  adjudication ranked it plausibly better immediate ROI than this Spec;
  it is separable and must not be smuggled in here).
- Relational/join expressiveness (the `feedEntries` read-model complaint)
  — CV-8 / LLP 0080/0110/0120 territory.

## Open questions

1. **Withdrawal scope (author gate) — RULED 2026-08-09.** Does the
   2026-07-31 LLP 0044 ruling's "the portable field vocabulary ships no
   array table fields" bind plain-data structured values, or only the
   asset-reference vocabulary that was the decision's subject? The author
   (Charlie, 2026-08-09, at implementation kickoff) ruled the latter:
   the withdrawal binds the asset-reference vocabulary; plain-data
   structured stored values proceed under this Spec. LLP 0044's dated
   clarification note LANDED with the round-1 revision (2026-08-09),
   closing the corpus-visible tension the round-1 review named.
2. **Byte-equality predicate.** Admit `eq` on canonical bytes in v1, or
   ship with no predicates at all (the current text)? Lean: no predicates;
   add equality only with a demand instance.
3. **Ceiling numbers.** The mechanism is pinned (§Representation:
   admission-time enforcement, per-value plus per-row aggregate bounding
   the structured contribution with delivery-posture parity); the
   numbers (32 KiB value / 48 KiB row aggregate / depth 16 / 1,024
   elements) are provisional until the implementation fixture verifies
   the bounds are enforced on every write route and measures the
   structured contribution against realistic delta envelopes. Freezing
   the numbers is an implementation-time act with a bench receipt, not a
   design change.
4. **Nested optionality semantics — RULED (round 1).** Pinned in
   §Declaration by adopting LLP 0131's landed ruling: omission-not-null,
   object-member position only, explicit null via `v.null()` union
   variant. No longer open.
5. **Capability id and naming.** `structured_stored_value_v1` vs folding
   under a future `stored_fields_v2` family — naming should follow LLP
   0134's registry conventions at implementation time. (The publication
   contract itself is now pinned in §Capability; only the name floats.)
6. **Closed vs open object keys — RULED (round 1).** Pinned in
   §Declaration by adopting the args-boundary behavior: closed maps,
   `additionalProperties: false`; open maps deferred until a demand
   instance names them (a `v.record(...)`-class node would be new
   vocabulary, which this Spec refuses to mint). No longer open.
7. **JCS write-path cost.** The adjudication flags canonicalization cost
   on realistic write volumes as unmeasured; the implementation should
   carry a bench receipt against the existing write path before the
   capability qualifies (the 166k-action Clique replay corpus is a ready
   workload).
