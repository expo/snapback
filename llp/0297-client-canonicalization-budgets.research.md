# LLP 0297: Client canonicalization budgets

**Type:** Research
**Status:** Review
**Systems:** Client integration, React/Expo, Live queries, Code generation,
Diagnostics, Performance, Developer experience, Competitive analysis, Guide
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-23
**Revised:** 2026-08-23 (initial research draft from the published-0.1.25
Clique run, corpus/code inspection, primary-source competitor comparison, and
synthetic canonicalizer measurements). 2026-08-24 (super-refine loop start:
Draft → Review)
**Related:** LLP 0000, LLP 0016, LLP 0061, LLP 0102, LLP 0114, LLP 0137,
LLP 0155, LLP 0179, LLP 0200,
`issues/20260822-guide-gap-generated-app-canonical-node-ceiling.md`,
`benchmarks/runs/2026-08-22-clique-local-main-grok/record.md`,
`diaries/0106-grok-clique-explicit-local-main.diary.md`

## Summary

Snapback's `CanonicalClientValueV1` deliberately makes synchronous client
identity work finite. Its public profile admits at most 32 levels, 4,096 total
nodes, 256 fields in one object, 1,024 entries in one array, 65,536 UTF-8 bytes
in one string, and 262,144 canonical UTF-8 bytes. That is a sound kind of
boundary for untrusted query arguments and cache keys.

Clique exposed that the same 4,096-node profile can also reach two structurally
different values:

1. the generated `AppDescriptor` / API catalog, whose size is known during
   generation; and
2. a live-query result snapshot, whose actual size is normally known only
   after execution.

Those are not merely two instances of "large arguments." Generated artifacts,
caller-supplied identity values, and server-produced results have different
trust, lifecycle, predictability, and performance properties. Applying one
budget and one `SNAPBACK_REACT_ARGS_INVALID` diagnostic across them makes an
implementation convenience visible as an unusual product constraint.

This Research finds no measured rationale in the corpus for exactly 4,096
nodes. The number entered with the finite identity grammar and was correctly
specified and boundary-tested, but it was not justified by a device benchmark
or failure cliff. A synthetic Node.js measurement on the 2026 M5 control Mac
found roughly linear traversal cost: about 1.0 ms at 4,096 nodes, 1.6 ms at the
6,251-node catalog size that failed Clique, 2.0 ms at 8,192, and 4.1 ms at
16,384. That supports further investigation, not an immediate global increase:
Hermes, lower-end devices, allocation/GC, real descriptor/result shapes, and
repeated live-update cadence remain unmeasured.

The preliminary recommendation is to preserve finite canonicalization while
splitting budgets by semantic class:

- keep a conservative, versioned profile for caller-authored query arguments
  and React store keys;
- consistently use the already-defined larger generated-artifact profile for
  complete `AppDescriptor` and API catalogs; and
- give server-produced query results a separate result/snapshot contract based
  primarily on encoded bytes and declared result bounds, with actual runtime
  counts, high-water warnings, typed refusal, and pagination/window guidance.

This document is Research. It does not amend Accepted LLP 0114, change a public
limit, or authorize an implementation. LLP 0114 remains the owner of the
canonical argument/store-key contract; LLP 0179 remains the owner of
`AppDescriptor`; the query/result owners must participate before a result
budget is specified.

## Questions and scope

This Research asks:

1. What does the 4,096-node limit currently protect?
2. Which semantically different values pass through it today?
3. Which Clique failures involved generated metadata, and which involved
   dynamic query results?
4. What analogous limits do nearby backends expose?
5. Is there evidence that a modestly larger ceiling is affordable?
6. Should Snapback raise one constant or separate the budget profiles?
7. What should an agent learn before a dynamic result crosses its budget?

It does not choose final numeric limits, establish hosted-service quotas,
replace pagination, or claim a mobile performance result. It also does not
assume that a large result should always succeed: bounded memory, serialization
work, network transfer, local retention, render cost, and authorization-safe
inspection remain real constraints.

## Terminology

The word **node** here means one value visited by
`canonicalizeClientValueV1`: the root and each scalar, array, or object value.
Object field names are not nodes. This is a JavaScript value-tree measure, not
a database row, graph node, React element, or query-plan node.

The word **projection** means the value a query or generated surface produces.
It does not mean that Snapback can predict the actual runtime result before
executing an unbounded query.

Three value classes matter:

| Class | Example | Producer | Size knowable before runtime? | Primary concern |
| --- | --- | --- | --- | --- |
| Identity input | `{ conversationId, before }` | Application caller | Yes, at invocation | Deterministic, bounded synchronous cache identity; reject exotic/adversarial values |
| Generated artifact | `app.api.queries` | Snapback codegen | Yes, at generate/verify time | Complete artifact admission and digesting without misclassifying metadata as user args |
| Result snapshot | RSVP list or Clique `viewerState` | Server query over current data | Only with a declared worst-case bound; otherwise after execution | Execution, serialization, transfer, retention, canonicalization, and render cost |

## Method and provenance

The Snapback findings came from:

- Accepted LLP 0114's finite canonical identity grammar and its 2026-08-01
  generated-artifact amendment;
- Accepted LLP 0179's complete generated `AppDescriptor` contract;
- `packages/snapback-client/canonical-client-value.mjs` and the React/client
  call sites that reuse it;
- the checked-in 2026-08-22 local-main Clique run and Diary 0106;
- the open generated-app guide-gap ticket; and
- the retained published-0.1.25 Clique run at
  `/home/ccheever/clique-published-0125-sol-high-20260823` on Hetzner
  `expo-build-450b`, especially the Explicit lane's `diary.md` and
  `run-log.md`. That retained path is run evidence outside this repository;
  this document should be updated to the checked-in run record if and when the
  run is imported.

The competitor snapshot was checked on 2026-08-23 against first-party
documentation:

- [Convex limits](https://docs.convex.dev/production/state/limits) and
  [data types](https://docs.convex.dev/database/types);
- [Supabase query documentation](https://supabase.com/docs/reference/javascript/v1/select)
  and [Realtime limits](https://supabase.com/docs/guides/realtime/limits);
- [Cloud Firestore limits](https://firebase.google.com/docs/firestore/quotas)
  and [Firebase Realtime Database limits](https://firebase.google.com/docs/database/usage/limits);
  and
- [InstantDB queries](https://www.instantdb.com/docs/instaql) and
  [infinite queries](https://www.instantdb.com/docs/infinite-queries).

Current product limits may change; the comparison records the dated shape of
the constraint, not an everlasting vendor claim.

## Finding 1: the original limit is an identity safety bound

LLP 0114#one-finite-canonical-identity-grammar makes canonical query/store
identity synchronous, portable, deterministic, and finite. The validator:

- admits a restricted JSON-shaped value grammar;
- avoids invoking accessors and rejects unstable/exotic object behavior;
- detects cycles and depth/container overflow;
- produces byte-stable canonical JSON; and
- places explicit CPU/memory/output ceilings around cache-key construction.

That rationale is strong. Query arguments originate at an application boundary
and may be malformed, unexpectedly enormous, or hostile. A synchronous React
path should not traverse or allocate without a finite upper bound.

The exact quantitative choices are specified and tested, but the reviewed
corpus and introducing commit contain no benchmark, device matrix, or derived
formula explaining why the node count is 4,096 rather than 2,048, 8,192, or
16,384. The right conclusion is not that 4,096 is arbitrary in the dismissive
sense; it is a conservative design constant whose exact value lacks a retained
empirical derivation.

## Finding 2: generated artifacts already earned a separate profile

An earlier package fixture passed a complete 263-function generated manifest
through the 4,096-node argument profile and failed at node 4,097. The
2026-08-01 correction did not raise the public argument limit. Instead it
recognized a category error: a complete generated manifest is validated
deployment metadata, not a caller-authored query argument.

LLP 0114#offline-binding-receipt-dated-amendment-2026-08-01 therefore defines
a separate generated-artifact profile: depth 64, 65,536 nodes, 1,024 fields per
object, 4,096 array entries, 4 MiB per string, and 16 MiB canonical bytes. The
implementation's `sha256GeneratedManifest` uses that profile.

The 2026-08-22 Clique local-main run found another path where a normal generated
`app` export still crossed the public argument profile. Adding M3 queries grew
`app.api.queries` to about 6,251 nodes; Expo boot refused with
`SNAPBACK_REACT_ARGS_INVALID`. Removing unused queries and folding pagination
variants into optional arguments reduced the catalog enough to boot.

This is evidence for completing the existing semantic split, not evidence that
large API catalogs are ordinary query arguments. Codegen can count and report
this class exactly before an app boots.

## Finding 3: published 0.1.25 also exposed a dynamic-result limit

The later published-0.1.25 Explicit Clique lane accumulated push and presence
rows while repeatedly running acceptance and choreography. Its broad
`viewerState` live query then exceeded the React client's canonical snapshot
node ceiling at login. The client reported
`SNAPBACK_REACT_ARGS_INVALID: value exceeds node limit`, even though the value
was a server-produced snapshot rather than query arguments.

The lane recovered by delivering only the twelve newest persona-targeted push
records plus active presence while retaining all authoritative rows in durable
storage. That is a reasonable product projection, but the failure became
visible only after enough test data accumulated.

This case is inherently different from the API catalog:

- The complete result is not generally knowable at code-generation time.
- A declared `take`, cursor window, or result contract can make a worst-case
  bound knowable; an unbounded "all invitees" query cannot.
- After execution, the server and client can know actual rows, nodes, and bytes.
- A growing live result can cross the boundary after previously succeeding.
- The useful remedy may be pagination, a live window plus total count, a narrow
  projection, or a larger result budget—not deletion of API functions.

The diagnostic also uses the wrong vocabulary. An argument-invalid code for an
authoritative result makes the caller inspect the wrong layer.

## Finding 4: nearby products bound results differently

No reviewed product publishes an exact analog of "the generated client API
catalog may contain at most 4,096 JavaScript value nodes." Their most relevant
documented limits are nevertheless useful:

| Product | Relevant dated limits | Shape compared with Snapback |
| --- | --- | --- |
| Convex | 16 MiB function arguments and return value; 16 MiB data read and 32,000 documents scanned per query/mutation; 1 MiB, 1,024 fields, depth 16, and 8,192 array elements per document | Bytes, documents, execution work, and container structure; no documented generated-API-tree node cap |
| Supabase | REST queries return at most 1,000 rows by default, configurable in project API settings; Realtime separately limits payload sizes (including 1,024 KB Postgres-change payloads in the reviewed table) | Default/configurable row window plus transport payload limits |
| Cloud Firestore | 1 MiB per document and depth 20 for maps/arrays, with additional query/index/transaction ceilings | Primarily document, index, request, and operation limits |
| Firebase Realtime Database | 256 MiB single read response and 75 million nodes on a listened/queried path | It does expose a node concept, but at database-path/result scale and orders of magnitude above 4,096 |
| InstantDB | Top-level query limits plus offset/cursor and infinite-query APIs are documented; no reviewed first-party page names an equivalent total-result-node or generated-catalog cap | Pagination is the visible shaping mechanism; absence of a documented cap is not proof of no internal cap |

The comparison does not show that Snapback should copy the largest number.
It shows that users ordinarily reason about rows/documents, encoded payload,
query work, and pagination. A client-internal canonical tree-node limit is a
poor sole product vocabulary for dynamic results.

## Finding 5: a modest increase looks inexpensive on one desktop

A synthetic traversal benchmark ran the shipped
`canonicalizeClientValueV1` under Node.js v24.18.0 on the arm64 2026 control
Mac (Apple M5 family). Each value was an ordinary object of arrays and numbers;
the benchmark raised only the canonicalizer's supplied test limits so it could
measure beyond 4,096. It warmed each shape, then measured 100 iterations at
4,096–8,192 nodes, 40 at 16,384–32,768, and 20 at 65,536.

| Nodes | Encoded synthetic bytes | Median | Observed p95 |
| ---: | ---: | ---: | ---: |
| 4,096 | 14,675 | 1.040 ms | 2.208 ms |
| 6,251 | 22,341 | 1.552 ms | 1.663 ms |
| 8,192 | 29,363 | 2.024 ms | 2.088 ms |
| 16,384 | 58,739 | 4.075 ms | 4.541 ms |
| 32,768 | 117,519 | 7.771 ms | 7.978 ms |
| 65,536 | 235,151 | 15.666 ms | 16.647 ms |

These measurements establish only that traversal is roughly linear and that
the Clique catalog size is not a desktop-Node cliff. They do not establish a
safe React/live-update budget because they omit:

- Hermes and React Native on representative low-end devices;
- realistic nested records, strings, and descriptor capture costs;
- canonical output allocation and garbage-collection tails;
- repeated canonicalization at live-query delivery cadence;
- downstream immutable cloning, storage, diffing, and React rendering; and
- network and server serialization costs.

The surprising 4,096 p95 relative to later warmed shapes is another reason to
retain raw methodology and rerun under a proper harness before deciding a
number.

## Analysis: what can be known when

An agent asking for "every person invited to this party" is correct that the
client normally cannot know the cardinality in advance. Snapback has four
different opportunities to help:

1. **Authoring/generation:** if a query declares `take: 100`, pagination, or a
   result contract with closed item/field limits, compute a conservative
   worst-case or at least prove a row ceiling. An unbounded query remains
   explicitly unbounded.
2. **Server execution:** after producing the result but before transport,
   measure actual rows, canonical nodes, and encoded bytes. Refuse with a
   result-specific diagnostic or attach development-only budget telemetry.
3. **Client admission:** before installing the snapshot into a retained/live
   store, measure the same versioned profile and surface the exact operation,
   actual count, limit, and remediation. Do not call a server-produced result
   invalid query arguments.
4. **Inspection over time:** expose current and high-water result size per
   active query, with warnings below the hard boundary. A query that grows from
   70% to 95% becomes visible before the next insert turns it into an outage.

"Before refusal" therefore does not always mean "before the query runs." For
dynamic results it can mean before transmission or store installation, plus a
warning based on earlier observed executions. Static prevention is available
only when the authored contract supplies a bound.

## Options

### Option A: raise 4,096 globally

For example, change `CanonicalClientValueV1.maxNodes` to 8,192 or 16,384.

Advantages:

- smallest implementation change;
- immediately covers the two observed Clique sizes; and
- synthetic desktop cost is low.

Risks:

- preserves the category conflation;
- changes a public versioned identity grammar for every call site;
- makes caller-authored adversarial inputs more expensive;
- may merely postpone another artifact/result failure; and
- gives no better diagnostics or pagination model.

### Option B: keep 4,096 everywhere and improve diagnostics

Advantages:

- preserves the accepted public contract and its strongest safety posture;
- makes no device-performance bet; and
- encourages bounded projections.

Risks:

- keeps generated catalogs and ordinary product results unusually constrained;
- turns legitimate moderate app growth into authoring workarounds; and
- leaves Snapback far below the result envelopes users encounter elsewhere.

### Option C: split profiles by semantic class

Retain the existing argument/store-key profile, route complete generated
artifacts through the existing artifact profile, and define a result/snapshot
profile with its own nodes/bytes/rows, diagnostics, and inspection.

Advantages:

- aligns limits with trust and lifecycle;
- completes precedent already accepted in LLP 0114;
- permits build-time failure for generated artifacts and runtime telemetry for
  dynamic results; and
- allows result limits to evolve without weakening argument identity bounds.

Risks:

- requires auditing all canonicalizer call sites and naming their semantic
  class;
- adds versioned profiles and conformance fixtures; and
- a result profile still needs mobile measurements and a clear server/client
  enforcement owner.

### Option D: stop canonicalizing whole result snapshots

Use server-carried version/digest identity, row-level structural validation,
or store-owned immutable revision identity so React does not stringify an
entire authoritative result merely to decide whether its visible snapshot
changed.

Advantages:

- removes repeated whole-result work from the hottest client path;
- can make the limit align with transport/storage contracts instead of React
  equality; and
- scales better for pagination, deltas, and retained data.

Risks:

- is a deeper protocol and cache-identity change;
- must preserve cross-carrier determinism and prevent stale/equal-revision
  publication mistakes; and
- may still need finite result admission independently of equality.

Options C and D are compatible: C is the near-term classification and
diagnostic correction; D is a possible performance architecture after exact
ownership and evidence are established.

## Preliminary recommendation

Use Option C as the next design direction, while investigating Option D rather
than treating a global constant increase as the final fix.

The likely contract shape is:

1. **Arguments/store keys:** preserve LLP 0114's 4,096-node profile unless a
   dedicated cross-device benchmark justifies a versioned successor.
2. **Generated artifacts:** ensure every complete `AppDescriptor`, API catalog,
   and binding-receipt digest uses the already-accepted 65,536-node artifact
   profile. Count it during generation and verification; refuse before boot
   with the path and cheap authoring remedies.
3. **Results/snapshots:** define a separate profile after measuring real
   Clique/Partiful-shaped values on Node, Hermes, and representative devices.
   Make encoded bytes and rows/documents first-class alongside nodes. Require a
   result-specific typed diagnostic carrying operation id, actual and allowed
   counts, whether the authored query was bounded, and links to pagination,
   narrow projection, live window plus total count, or aggregate recipes.
4. **Inspection:** publish current/high-water counts in development and the
   existing inspection/observability surface without including application
   values.
5. **Guide:** teach that unbounded "all invitees" queries are data-dependent;
   Snapback cannot statically predict their final size. Teach declared windows
   and pagination as product semantics, not only as an emergency response to a
   client implementation limit.

Raising the result profile modestly may still be correct. It should happen
inside that semantic split, backed by device measurements, rather than by
weakening every use of `CanonicalClientValueV1` at once.

## Suggested evidence program

Before an RFC amends LLP 0114 or the result owners:

1. Inventory every production `canonicalizeClientValueV1` call and classify it
   as argument/key, generated artifact, result, durable record, protocol
   identity, or other. Treat an unclassifiable call as a design smell.
2. Reproduce both Clique failures in focused fixtures:
   - a generated app at 4,096/4,097 and at the observed ~6,251 nodes; and
   - a live query that grows across the boundary after initial success.
3. Benchmark realistic values at 4K, 8K, 16K, 32K, and 64K nodes on:
   - Node/V8;
   - Hermes on at least one current iPhone-class device;
   - Hermes on a deliberately slower supported device or simulator profile;
   - web under a throttled mid/low-tier CPU profile.
4. Measure cold canonicalization, repeated live delivery, allocations/GC,
   immutable clone, store installation, and React commit separately.
5. Compare node and byte counts for representative Todo, Partiful/RSVP,
   Clique, and large desktop-local-store projections.
6. Prototype result-specific diagnostics and an inspector high-water mark.
7. Test the user-facing recovery paths: bounded window, cursor pagination,
   narrow fields, aggregate count, and retained history outside the active live
   window.

## Confidence

- **High:** the generated API catalog and dynamic `viewerState` incidents are
  different semantic classes that currently converge on the same 4,096-node
  mechanism and argument diagnostic.
- **High:** LLP 0114 already establishes precedent for a distinct generated-
  artifact profile rather than one universal budget.
- **High:** competitor product surfaces emphasize bytes, rows/documents,
  execution work, and pagination rather than a small client API/value-tree cap.
- **Medium:** 8,192–16,384 nodes would be affordable on representative clients;
  the desktop Node result is encouraging but insufficient.
- **Medium:** whole-snapshot canonicalization can be removed or reduced without
  weakening deterministic store semantics; the relevant owner/call path still
  needs a complete audit.
- **Low:** any particular final numeric result limit before the evidence program
  runs.

## Open questions

1. Which current call site applied `CanonicalClientValueV1` to the complete
   published-0.1.25 `viewerState`, and was it validating egress, cloning a
   result, or deriving consumer-visible snapshot identity?
2. Should result admission be server-owned, client-owned, or duplicated with
   one versioned profile and parity vectors?
3. Can every generated query carry a useful worst-case result bound, or must
   the manifest explicitly distinguish bounded from data-dependent results?
4. Should a live query nearing its limit warn once, expose a stable inspector
   event, or both? What hysteresis avoids warning noise?
5. When a previously valid live result grows beyond the cap, may the client
   retain the last admissible snapshot with an error, or must it blank? Auth
   shrinkage and custody transitions must retain precedence.
6. Are node count and canonical bytes both needed for results, or can row,
   encoded-byte, nesting, and per-container limits fully replace total nodes?
7. Does a result limit apply before or after client-side transforms,
   optimistic layers, and retained/offline projection?
8. Which aspects belong in an LLP 0114 amendment, which belong to LLP 0179,
   and which need amendment at the query/result-contract owners?

## Likely hand-off

If the evidence program corroborates the preliminary recommendation:

- amend LLP 0114 to keep argument/store-key identity finite while naming the
  separate result profile and removing accidental generated-artifact use;
- amend LLP 0179 only as needed to require generation/verification counting for
  complete app descriptors;
- amend the governing query/result contract with runtime admission and
  over-limit state semantics;
- update LLP 0061-owned Guide pages and diagnostics with operation-specific
  counts and remedies;
- extend or close the existing generated-app guide-gap issue, and file a
  separate implementation ticket for dynamic result/snapshot admission rather
  than tracking both failures as one bug.

