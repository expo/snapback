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
Draft → Review). 2026-08-24 (r2, super-refine round 1: both families NOT
READY; recommendation narrowed — the result-profile half of Option C was
underdetermined; new Finding 6 records the verified call-site inventory that
answers the original Open Question 1; Finding 1 recharacterized per the
admission-versus-resource-ceiling review finding; Confidence rewritten)
**Related:** LLP 0000, LLP 0016, LLP 0061, LLP 0102, LLP 0114, LLP 0137,
LLP 0155, LLP 0179, LLP 0200,
`issues/20260822-guide-gap-generated-app-canonical-node-ceiling.md`,
`issues/closed/20260801-react-package-fixture-node-limit.md`,
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
nodes: the number entered with the finite identity grammar, correctly
specified and boundary-tested, but without a retained device benchmark or
failure-cliff derivation. A 2026-08-24 call-site inventory (Finding 6) then
located both failure mechanisms in the shipped client and changed the balance
of evidence:

- the generated catalog crosses the **argument** profile because the boot
  path still digests it with the default limits, even though LLP 0114's
  2026-08-01 amendment already defines a separate generated-artifact profile
  — the accepted semantic split exists but is incompletely applied; and
- results already have their own admission budget
  (`RESULT_CONTRACT_LIMITS_V1`: 65,536 result nodes, 4 MiB result bytes), yet
  the React binding then re-canonicalizes each whole delivered snapshot under
  the 4,096-node argument profile purely to derive snapshot **identity** —
  so a result the client admits at up to 65,536 nodes can be refused, or
  silently dropped, at 4,096 by an equality mechanism.

The preliminary recommendation is accordingly narrower than this document's
first draft, which recommended a three-profile Option C including a new
result/snapshot profile. Round-1 review found — and the inventory confirmed —
that the result half was underdetermined. The revised direction:

- keep the conservative, versioned argument/store-key profile, and repair its
  characterization: its limits are admission ceilings, not strict pre-work
  resource budgets (Finding 1);
- finish the already-accepted generated-artifact split for the boot path,
  choosing deliberately between routing through the existing artifact profile
  and not re-walking the hydrated tree at all (LLP 0179 descriptor-digest /
  prepared-binding identity), with generate-time counting and a non-argument
  diagnostic either way; and
- for results, name no new profile now. The admission budget already exists;
  the located defect is whole-snapshot identity canonicalization under the
  argument profile. Investigate Option D (identity from server version
  stamps, digests, or store-owned revisions) as the default prior, with
  routing snapshot identity through result-scale limits as a candidate
  interim, decided by the purpose/phase evidence program below.

This document is Research. It does not amend Accepted LLP 0114, change a public
limit, or authorize an implementation. LLP 0114 remains the owner of the
canonical argument/store-key contract; LLP 0179 remains the owner of
`AppDescriptor`; LLP 0155 (retained result fragments) and LLP 0200
(version-stamped live frames) and the result-contract owner must participate
before any result identity or admission change is specified.

## Questions and scope

This Research asks:

1. What does the 4,096-node limit currently protect?
2. Which semantically different values pass through it today, and at which
   call sites?
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
a database row, graph node, React element, or query-plan node. (One adjacent
pitfall: LLP 0200's coalescer "max frames 4096" is an unrelated constant that
happens to share the number.)

The word **projection** means the value a query or generated surface produces.
It does not mean that Snapback can predict the actual runtime result before
executing an unbounded query.

Three value classes matter:

| Class | Example | Producer | Size knowable before runtime? | Primary concern |
| --- | --- | --- | --- | --- |
| Identity input | `{ conversationId, before }` | Application caller | Yes, at invocation | Deterministic, bounded synchronous cache identity; reject exotic/adversarial values |
| Generated artifact | `app.api.queries` | Snapback codegen | Yes, at generate/verify time | Complete artifact admission and digesting without misclassifying metadata as user args |
| Result snapshot | RSVP list or Clique `viewerState` | Server query over current data | Only with a declared worst-case bound; otherwise after execution | Execution, serialization, transfer, retention, canonicalization, and render cost |

Within the third class, at least four jobs are distinct and need not share a
budget, an owner, or a diagnostic: transport/structural admission of a decoded
result, retained-store memory, consumer-visible change identity (equality),
and digest/receipt identity. Finding 6 shows Snapback already treats the first
differently from the third.

## Method and provenance

The Snapback findings came from:

- Accepted LLP 0114's finite canonical identity grammar and its 2026-08-01
  generated-artifact amendment;
- Accepted LLP 0179's complete generated `AppDescriptor` contract;
- `packages/snapback-client/canonical-client-value.mjs` and the React/client
  call sites that reuse it, including a 2026-08-24 production call-site
  inventory and source verification pass recorded as Finding 6;
- the checked-in 2026-08-22 local-main Clique run and Diary 0106. That record
  labels itself calibration evidence — unpublished current-source, not
  claim-eligible — which is sufficient for a bug-incident citation but would
  not be for a capability claim. The ticket, run record, and diary are three
  accounts of one N=1 run, not independent corroboration;
- the open generated-app guide-gap ticket and the closed 2026-08-01 package-
  fixture ticket (`issues/closed/20260801-react-package-fixture-node-limit.md`);
  and
- the retained published-0.1.25 Clique run at
  `/home/ccheever/clique-published-0125-sol-high-20260823` on Hetzner
  `expo-build-450b`, especially the Explicit lane's `diary.md` and
  `run-log.md`. That retained path is run evidence outside this repository:
  Finding 3 is therefore hypothesis-grade here, and this document must be
  updated to the checked-in run record if and when the run is imported.

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

## Finding 1: the original limit is an identity safety bound, with admission ceilings rather than resource ceilings

LLP 0114#one-finite-canonical-identity-grammar makes canonical query/store
identity synchronous, portable, deterministic, and finite. The validator:

- admits a restricted JSON-shaped value grammar;
- avoids reading property values through accessors and refuses unstable or
  exotic object behavior it can detect;
- detects cycles and depth/container overflow; and
- produces byte-stable canonical JSON.

That rationale is strong. Query arguments originate at an application boundary
and may be malformed, unexpectedly enormous, or hostile. A synchronous React
path should not install unbounded values into identity work.

Two characterizations in this document's first draft were too strong and are
corrected here (round-1 review finding, verified in source):

- The limits are **grammar/admission ceilings, not strict CPU/memory
  budgets**. Node and depth ceilings are enforced incrementally during
  traversal, but a single container's keys and descriptors are fully
  enumerated (twice, for trap-stability confirmation) before the 256-field
  limit applies; a string is fully UTF-8 encoded before its byte limit is
  tested; and the complete canonical output is constructed before the final
  262,144-byte ceiling is checked
  (`canonical-client-value.mjs` `captureObject`, `validateString`, and the
  post-visit byte check). The limits bound what is admitted, not the work
  performed refusing a hostile value.
- **Proxy refusal is detection-based.** Traps execute during inspection; a
  stable, transparent proxy whose descriptor observations stay consistent is
  not detectably refused. LLP 0114's flat "proxy input is refused" wording is
  stronger than the shipped behavior; the future RFC should reconcile the
  spec text or the implementation.

Per-call overrides also exist: `canonicalizeClientValueV1` accepts
`options.limits` and applies it unclamped, so "changing the limit" is in
practice call-site routing, and a raised default affects the call sites that
inherit it rather than literally every call. The store key canonicalizes its
components (provider id, reference, args) independently, so node/depth budgets
apply per component while the 262,144-byte ceiling bounds the complete key.

The exact quantitative choices are specified and tested, but the reviewed
corpus and introducing commit contain no benchmark, device matrix, or derived
formula explaining why the node count is 4,096 rather than 2,048, 8,192, or
16,384 — and the closed 2026-08-01 ticket's own "revisit the limit
deliberately" was never done. The right conclusion is not that 4,096 is
arbitrary in the dismissive sense; it is a conservative design constant whose
exact value lacks a retained empirical derivation.

## Finding 2: generated artifacts earned a separate profile, but the split is incompletely applied

An earlier package fixture passed a complete 263-function generated manifest
through the 4,096-node argument profile and failed at node 4,097
(`issues/closed/20260801-react-package-fixture-node-limit.md`). The
2026-08-01 correction did not raise the public argument limit. Instead it
recognized a category error: a complete generated manifest is validated
deployment metadata, not a caller-authored query argument.

LLP 0114#offline-binding-receipt-dated-amendment-2026-08-01 therefore defines
a separate generated-artifact profile: depth 64, 65,536 nodes, 1,024 fields per
object, 4,096 array entries, 4 MiB per string, and 16 MiB canonical bytes.
Two scope caveats matter before extrapolating that precedent:

- The amendment defines those numbers **specifically for the offline binding
  receipt digest** of the normalized generated manifest. It is precedent for
  the semantic split, not an accepted ruling that every complete
  `AppDescriptor` or hydrated API catalog should be walked at 65,536 nodes.
  65,536 was a receipt-digest safety ceiling, not a measured product budget.
- LLP 0179 separately gives the portable descriptor its own identity: a
  sentinel-plus-RFC-8785 digest under descriptor byte/member ceilings
  (`APP_DESCRIPTOR_MAX_BYTES` and the S1 ceilings), with a tighter
  byte/depth budget still an open question there. A design that carries
  descriptor/prepared-binding identity may not need to re-canonicalize the
  hydrated tree at boot at all.

The 2026-08-22 Clique local-main run found the path where the split is not yet
applied. Adding M3 queries grew `app.api.queries` to about 6,251 nodes; the
Expo provider boot refused with `SNAPBACK_REACT_ARGS_INVALID`, surfacing as a
blank "Clique couldn't start" web screen. Removing unused queries and folding
pagination variants into optional arguments reduced the catalog enough to
boot. The 2026-08-24 source verification located the mechanism: the boot
path's catalog and route digests go through `sha256Canonical`, which applies
the **default argument profile**
(`packages/snapback-client/react-binding.mjs:1453` `functionCatalogDigest`
over `Object.values(references)`; `:1169` `routeManifestHash`), while the
artifact profile is applied only on the receipt digest and is duplicated as
local constants rather than exported
(`react-binding.mjs:107`, `rqs-preload.mjs:102`).

This is evidence for completing the existing semantic split, not evidence that
large API catalogs are ordinary query arguments. Codegen can count and report
this class exactly before an app boots — the open ticket's acceptance
criterion is generate/verify-time refusal with a remedy that does not require
reading `canonical-client-value.mjs`. What Finding 2 does **not** establish is
which representation should carry boot identity: routing the hydrated walk
through the artifact profile, or replacing the walk with the descriptor
digest / a prepared opaque binding. That comparison is evidence-program work.

## Finding 3: published 0.1.25 also exposed a dynamic-result limit (hypothesis-grade here)

The later published-0.1.25 Explicit Clique lane accumulated push and presence
rows while repeatedly running acceptance and choreography. Its broad
`viewerState` live query then exceeded the React client's canonical snapshot
node ceiling at login. The client reported the node-limit refusal under
`SNAPBACK_REACT_ARGS_INVALID` (full form: `SNAPBACK_REACT_ARGS_INVALID: React
query arguments are not a CanonicalClientValueV1: value exceeds the node
limit`), even though the value was a server-produced snapshot rather than
query arguments.

This incident's run record has not been imported into the repository, so this
finding is hypothesis-grade within this document: one observed occurrence,
recorded outside the tree, not yet reproduced as a fixture. Finding 6 supplies
the verified in-repo mechanism that makes the reported failure shape
plausible; the incident itself still needs importing or reproduction before
it can carry design weight of its own.

The lane recovered by delivering only the twelve newest persona-targeted push
records plus active presence while retaining all authoritative rows in durable
storage. That is a reasonable product projection — and it is worth noting the
remedy was a projection change, which supports bounded/windowed product
semantics at least as strongly as it supports any larger result budget.

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

The comparison does not show that Snapback should copy the largest number, and
because vendor units (rows, documents, payload bytes) are not convertible to
JavaScript value-tree nodes, it cannot show numerically where 4,096 sits
against those envelopes. What it shows is vocabulary: users ordinarily reason
about rows/documents, encoded payload, query work, and pagination. A
client-internal canonical tree-node limit is a poor sole product vocabulary
for dynamic results.

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
safe React/live-update budget because they omit or fail to isolate:

- Hermes and React Native on representative low-end devices;
- realistic nested records, strings, and descriptor capture costs;
- allocation and garbage-collection tails (the run executes output
  construction but does not isolate its cost);
- repeated canonicalization at live-query delivery cadence;
- downstream immutable cloning, storage, diffing, and React rendering; and
- network and server serialization costs.

The surprising 4,096 p95 relative to later warmed shapes is another reason to
retain raw methodology and rerun under a proper harness before deciding a
number.

## Finding 6: the verified call-site map (2026-08-24)

A production call-site inventory and source verification pass — the first
item of this document's evidence program, run during round 1 of review —
answered the original Open Question 1 and located both incident mechanisms.

**Argument/store-key class (working as designed).**
`canonicalReactStoreKeyV1` canonicalizes provider identity, the complete
generated reference, and normalized arguments per component under the default
profile (`canonical-client-value.mjs:211-245`). This is the class the 4,096
budget was written for.

**Generated-artifact class (split incompletely applied).** As Finding 2
records: boot-path catalog/route digests use the default profile via
`sha256Canonical` (`react-binding.mjs:1453`, `:1169`); the 65,536-node
artifact profile is applied only to the offline receipt digest and duplicated
as unexported local constants (`react-binding.mjs:107`,
`rqs-preload.mjs:102`).

**Result class (admission and identity diverge).** Two different mechanisms
touch delivered results:

- **Admission** already has a result-scale budget:
  `RESULT_CONTRACT_LIMITS_V1` — depth 16, 128 fields, 1,024 array items,
  1 MiB per value, 4 MiB per result, and **65,536 result nodes**
  (`packages/snapback-contract/result-contract-validator.mjs:9-18`) — runs on
  every delivered React result.
- **Identity** then re-canonicalizes the whole snapshot, including `data`,
  under the **default 4,096-node argument profile**:
  `consumerVisibleSnapshotKey`
  (`packages/snapback-react/implementation.mjs:980`) computes an RFC 8785
  string for the complete snapshot on every delivery purely to decide
  whether the consumer-visible snapshot changed (`:1022-1025`, `:1193`).

So a result the client admits at up to 65,536 nodes can be refused at 4,096
by the equality mechanism — and the failure mode depends on the route: the
client core's `deliverIsolated` swallows consumer exceptions
(`packages/snapback-client/index.mjs:18533`, empty catch), so on those routes
an over-limit snapshot becomes a **silently dropped frame** rather than a
surfaced refusal, while synchronous store-creation paths propagate the typed
error. A silent drop is arguably worse than the mislabeled diagnostic.

**Vocabulary is already class-correct elsewhere.** Other client result paths
re-label canonicalization refusals with result-specific codes
(`SNAPBACK_LIVE_REGISTRATION_ANSWER_INVALID`,
`SNAPBACK_COMPLETENESS_RESULT_INVALID`, per-row transform codes); the React
snapshot-identity path is the outlier that leaks the argument diagnostic.

**Adjacent owners.** LLP 0155's retained result fragments are keyed by plan
hash + canonical args + authority partition — result **content** is not part
of retained identity, and 0155 prescribes no result node budget. LLP 0200's
live frames carry version-stamped delivery with monotone per-subscription
versions. Both facts bear directly on Option D: server- or store-carried
revision identity is not a green-field idea in this codebase.

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
   invalid query arguments — and never let an over-limit frame drop silently.
4. **Inspection over time:** expose current and high-water result size per
   active query, with warnings below the hard boundary. A query that grows from
   70% to 95% becomes visible before the next insert turns it into an outage.

"Before refusal" therefore does not always mean "before the query runs." For
dynamic results it can mean before transmission or store installation, plus a
warning based on earlier observed executions. Static prevention is available
only when the authored contract supplies a bound.

Finding 6 adds a fifth lens: **which invariant each mechanism protects.**
Admission (structural safety of a decoded result), retention (store memory),
equality (did the visible snapshot change), and digest identity (is this the
same artifact) are different jobs. The observed result-class defect is not a
missing budget — admission has one — but an equality mechanism borrowing the
argument profile and its diagnostic for a job that may not need whole-value
canonicalization at all.

## Options

### Option A: raise 4,096 globally

For example, change the default `maxNodes` to 8,192 or 16,384.

Advantages:

- smallest implementation change;
- covers the observed ~6,251-node catalog (though the unmeasured
  `viewerState` snapshot may exceed any modest raise); and
- synthetic desktop cost is low.

Risks:

- preserves the category conflation;
- changes a public versioned identity grammar for every call site inheriting
  the default;
- makes caller-authored adversarial inputs more expensive;
- may merely postpone another artifact/result failure;
- gives no better diagnostics or pagination model; and
- provides no generate-time refusal, which is the open ticket's acceptance
  criterion for the catalog class.

### Option B: keep 4,096 everywhere and improve diagnostics

Advantages:

- preserves the accepted public contract and its strongest safety posture;
- makes no device-performance bet;
- encourages bounded projections; and
- its diagnostic repair is necessary under every serious option — the
  hardcoded argument code on non-argument paths is a product bug today.

Risks:

- keeps generated catalogs and ordinary product results unusually
  constrained: a three-milestone messenger's catalog at ~6,251 nodes is
  ordinary API growth, and LLP 0114 already accepts that "an admitted
  function catalog may legitimately exceed the argument-node budget";
- turns legitimate moderate app growth into authoring workarounds as
  standing product law; and
- literal "4,096 everywhere" is already incompatible with the accepted
  receipt-profile exception and with the shipped 65,536-node result
  admission.

### Option C: split profiles by semantic class

Retain the existing argument/store-key profile, route complete generated
artifacts through the existing artifact profile, and define a result/snapshot
profile with its own nodes/bytes/rows, diagnostics, and inspection.

Advantages:

- aligns limits with trust and lifecycle;
- completes precedent already accepted in LLP 0114;
- is largely call-site routing, since `options.limits` already exists; and
- permits build-time failure for generated artifacts and runtime telemetry for
  dynamic results.

Risks:

- the artifact bullet as written assumes the hydrated tree should be walked
  at 65,536 nodes, extrapolating a receipt-digest ceiling beyond its accepted
  scope and skipping the digest/prepared-binding alternative (Finding 2);
- the result bullet reintroduces total nodes as a first-class result knob
  after Finding 4's vocabulary evidence, assumes a new profile is the missing
  piece when Finding 6 shows admission already has one, and was written
  before the failing call site was known;
- requires auditing and naming every canonicalizer call site's semantic class
  (now largely done — Finding 6); and
- adds versioned profiles and conformance fixtures.

### Option D: stop canonicalizing whole result snapshots

Use server-carried version/digest identity, row-level structural validation,
or store-owned immutable revision identity so React does not stringify an
entire authoritative result merely to decide whether its visible snapshot
changed.

Advantages:

- removes repeated whole-result work from the hottest client path — Finding 6
  confirms every delivery currently pays a whole-snapshot RFC 8785 walk;
- aligns with the identity machinery that already exists: LLP 0114 store keys
  are provider/reference/args, LLP 0155 fragments are args-keyed, LLP 0200
  frames are version-stamped; and
- scales better for pagination, deltas, and retained data.

Risks:

- is a deeper protocol and cache-identity change;
- must preserve cross-carrier determinism and prevent stale/equal-revision
  publication mistakes (the delivery path already relies on key equality to
  suppress value-equal republication — LLP 0278's D05 annotation — so a
  replacement must preserve that suppression exactly); and
- still needs finite result admission independently of equality — which
  `RESULT_CONTRACT_LIMITS_V1` already provides on the React path.

### Option E: narrowed split — finish the artifact category, defer result design (round-1 synthesis)

Both round-1 review families independently converged on this shape, and it is
this document's revised direction:

- keep the 4,096 argument/store-key profile, repairing Finding 1's
  characterization gaps rather than the number;
- finish the generated-artifact split for the boot path with generate-time
  counting and a non-argument diagnostic, choosing deliberately between
  artifact-profile routing and digest/prepared-binding identity (no hydrated
  re-walk);
- fix the result-class diagnostic and the silent-drop route now — both are
  bugs under every option; and
- name no result profile yet: run the purpose/phase evidence program with
  Option D as the default prior for equality, and result-scale limits on the
  snapshot-identity call as a candidate interim.

Options C, D, and E are compatible in the sense the first draft claimed for C
and D: E is C's first two bullets plus B's diagnostic repair, with C's third
bullet demoted from recommendation to hypothesis pending the program.

## Preliminary recommendation

Use Option E as the next design direction. This narrows the first draft's
recommendation (full Option C): round-1 review found the result-profile half
underdetermined, and the verified call-site map (Finding 6) confirmed that
the result class needs a decision between D and result-scale identity limits,
not a pre-committed third profile.

The likely contract shape:

1. **Arguments/store keys:** preserve LLP 0114's 4,096-node profile unless a
   dedicated cross-device benchmark justifies a versioned successor. The
   future RFC should also reconcile LLP 0114's admission-versus-resource and
   proxy-refusal wording with the shipped behavior (Finding 1).
2. **Generated artifacts:** every complete `AppDescriptor`, API catalog, and
   binding-receipt digest leaves the argument profile. Whether the boot path
   routes the hydrated tree through the existing 65,536-node artifact profile
   or stops re-walking it in favor of LLP 0179 descriptor-digest /
   prepared-binding identity is an explicit comparison the RFC must make, not
   an assumption. Count the export during generation and verification; refuse
   before boot with the path and cheap authoring remedies (the open ticket's
   acceptance bar). Export one shared artifact-profile constant instead of
   the current duplicates.
3. **Results/snapshots:** fix vocabulary and silence first — a result-class
   refusal must carry a result-specific typed diagnostic (operation id,
   actual and allowed counts, whether the authored query was bounded, links
   to pagination/window/projection/aggregate recipes), and no route may
   silently drop an over-limit frame. Then decide equality: prototype
   Option D (server version stamps per LLP 0200, digests, or store-owned
   revisions) against routing `consumerVisibleSnapshotKey` through
   result-scale limits, under the purpose/phase program below. Any raise
   should happen inside whichever mechanism wins, backed by device
   measurements, rather than by weakening every use of
   `CanonicalClientValueV1` at once.
4. **Inspection:** publish current/high-water counts in development and the
   existing inspection/observability surface without including application
   values.
5. **Guide:** teach that unbounded "all invitees" queries are data-dependent;
   Snapback cannot statically predict their final size. Teach declared windows
   and pagination as product semantics, not only as an emergency response to a
   client implementation limit.

## Suggested evidence program

Before an RFC amends LLP 0114 or the result owners:

1. Inventory every production `canonicalizeClientValueV1` call and classify it
   as argument/key, generated artifact, result, durable record, protocol
   identity, or other. Treat an unclassifiable call as a design smell.
   *(First pass done 2026-08-24 — Finding 6. Remaining: sweep for call sites
   outside `packages/snapback-client`/`snapback-react`, and map each call to
   the invariant it protects: validation, transport admission, retention,
   equality, cloning, or digest identity.)*
2. Reproduce both Clique failures in focused fixtures:
   - a generated app at 4,096/4,097 and at the observed ~6,251 nodes; and
   - a live query that grows across the boundary after initial success —
     which also imports or reproduces Finding 3's incident, currently
     hypothesis-grade.
3. Benchmark realistic values at 4K, 8K, 16K, 32K, and 64K nodes on:
   - Node/V8;
   - Hermes on at least one current iPhone-class device;
   - Hermes on a deliberately slower supported device or simulator profile;
   - web under a throttled mid/low-tier CPU profile.
4. Measure cold canonicalization, repeated live delivery, allocations/GC,
   immutable clone, store installation, and React commit separately — and
   measure the pre-admission enumeration/encoding work of Finding 1 on
   hostile shapes, since the limits do not bound it.
5. Compare node and byte counts for representative Todo, Partiful/RSVP,
   Clique, and large desktop-local-store projections.
6. Prototype the competing equality mechanisms, not only diagnostics:
   - Option D over LLP 0200 version stamps / server digests, proving the
     value-equal-suppression, stale/reordered/coalesced, optimistic-layer,
     and authority-transition behavior the current key equality provides; and
   - descriptor-digest / prepared-binding boot identity with no hydrated
     re-walk (Finding 2's alternative).
7. Declare pass/fail thresholds before measuring: synchronous-latency,
   allocation, retained-memory, and delivery-cadence budgets that would
   select among A/C/D and any number — so the program can adjudicate, not
   merely describe.
8. Prototype result-specific diagnostics and an inspector high-water mark,
   including the no-silent-drop rule.
9. Test the user-facing recovery paths: bounded window, cursor pagination,
   narrow fields, aggregate count, and retained history outside the active
   live window.

## Confidence

- **High:** generated catalogs currently ride the argument profile and its
  argument diagnostic on the boot path (in-repo incident plus source
  verification, Findings 2 and 6).
- **High:** LLP 0114 already establishes precedent for a distinct generated-
  artifact profile rather than one universal budget — for the receipt digest;
  its extension to hydrated boot identity is precisely what remains to be
  decided.
- **High:** on the React path, delivered results are admitted under
  result-scale limits and then re-canonicalized for identity under the
  argument profile, with at least one silent-drop route (Finding 6, source-
  verified).
- **Medium:** the published-0.1.25 `viewerState` incident occurred as
  described — the mechanism is verified in source, but the incident itself is
  out-of-repo, N=1, and unreproduced.
- **Medium:** competitor product surfaces emphasize bytes, rows/documents,
  execution work, and pagination rather than a small client value-tree cap —
  a dated literature snapshot with vocabulary weight, not numeric weight.
- **Medium:** whole-snapshot equality canonicalization can be replaced
  without weakening deterministic store semantics — the call site and its
  suppression contract are now known; the replacement proof is not yet built.
- **Low:** 8,192–16,384 nodes would be affordable on representative clients;
  the desktop Node result is encouraging but Hermes/low-end/GC/cadence are
  unmeasured.
- **Low:** any particular final numeric result limit before the evidence
  program runs.

## Open questions

1. *(Answered 2026-08-24 — Finding 6.)* The call site applying
   `CanonicalClientValueV1` to complete result snapshots is
   `consumerVisibleSnapshotKey`, deriving consumer-visible snapshot identity
   on every delivery. Successor questions: should that mechanism exist at
   all, and can LLP 0200's version stamps or server digests carry the same
   suppression contract end to end?
2. Should result admission be server-owned, client-owned, or duplicated with
   one versioned profile and parity vectors — and how does the existing
   `RESULT_CONTRACT_LIMITS_V1` relate to any server-side counterpart?
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
8. For boot identity: portable descriptor digest, prepared opaque binding, or
   hydrated-tree canonicalization — and if the latter, is 65,536 a measured
   number or an inherited receipt ceiling?
9. How does any result identity/admission change reconcile with LLP 0155's
   args-keyed retained fragments (no result node budget) and LLP 0200's
   version-stamped frames — which document owns each piece?
10. Should LLP 0114's proxy-refusal and resource-ceiling wording be amended
    to match the shipped detection-based behavior, or the implementation
    strengthened to match the wording (Finding 1)?
11. Which aspects belong in an LLP 0114 amendment, which belong to LLP 0179,
    and which need amendment at the query/result-contract owners?

## Likely hand-off

If the evidence program corroborates the narrowed recommendation:

- amend LLP 0114 to keep argument/store-key identity finite, remove the
  accidental generated-artifact and result-identity uses of the argument
  profile, and reconcile its proxy/resource wording with shipped behavior —
  naming a result profile only if the program selects one over Option D;
- amend LLP 0179 as needed to require generation/verification counting for
  complete app descriptors and to record the boot-identity decision
  (digest/prepared binding versus hydrated walk);
- amend the governing query/result contract owners — including LLP 0155
  (retained fragments) and LLP 0200 (version-stamped delivery) — with runtime
  admission, equality, and over-limit state semantics, keeping the two
  unrelated 4,096 constants distinct;
- update LLP 0061-owned Guide pages and diagnostics with operation-specific
  counts and remedies;
- extend or close the existing generated-app guide-gap issue, and file a
  separate implementation ticket for dynamic result/snapshot admission and
  the silent-drop repair rather than tracking the failures as one bug.
