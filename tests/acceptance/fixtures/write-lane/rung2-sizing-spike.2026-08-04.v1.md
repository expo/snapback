# LLP 0129 write-rung-2 IR-evaluator sizing spike

Date: 2026-08-04

Status: evidence spike; not a capability claim

Scope: Move-4 lane W1, evidence-gate half (a) only

Decision owner: Charlie Cheever, current-session codex lane

Gate presentation due: 2026-08-11

## Recommendation

**Sizing half: GO to present. Recommended Calendar effect ceiling: retain the
rung-1 `Insert`/`Get`/`Guard`/`Patch` ceiling; admit none of the three candidate
verbs on Calendar's authority.**

The candidate-set check narrowed `AllocateSequence`, `Delete`, and `Let` to the
empty set for Contention Calendar's common path. The retained executable
Calendar witness has one `Insert` and zero occurrences of each candidate verb.
It passes the shipping browser evaluator and produces the provisional
reservation row, including the composite resource-slot key, from generated IR.

That finding is consistent across the available frozen evidence:

- the seven-check zero-bakeoff manifest and its application code;
- LLP 0129's decision-lab Calendar facts — provisional create, canonical-id
  mapping, two-client contention, loser correction, retry idempotence, and the
  same typed filtering/ordering/count lifecycle; and
- LLP 0155 Move 4's shipping exit, which assigns correction and canonical
  mapping to settlement/query composition rather than to a second mutation.

The bundle measurement still sizes every ruling candidate alone and
cumulatively. Against the current rung-1 evaluator used-entry closure of
**20,868 minified / 7,414 gzip / 6,575 Brotli bytes**:

| Prospective admission | Minified delta | Gzip delta | Brotli delta |
| --- | ---: | ---: | ---: |
| `AllocateSequence` skeleton alone | +1,092 | +314 | +260 |
| `Delete` alone | +16 | +8 | -10 |
| `Let` alone | +10 | +8 | +1 |
| cumulative `AllocateSequence` + `Delete` + `Let` | **+1,118** | **+328** | **+273** |

Beside the same-run materialization-store closure, the full cumulative
candidate adds **+1,084 / +283 / +271 bytes** over rung 1. The complete
store-plus-candidate bundle is **91,743 / 27,131 / 23,611 bytes**. Compression
can improve by a few bytes for a tiny source change; minified and gzip are the
primary requested comparisons.

Size is therefore not the reason to narrow. The measured workload verb count
is. Publicly admitting unused effects would be a capability widening not
authorized by an exact-workload sizing lane. `AllocateSequence` has the
additional controlling problem that LLP 0133 makes sequence allocation a
settlement-only host answer and excludes it from local execution absent an
explicit successor. The measured sequence profile is a concrete throwaway
skeleton, not that successor.

This is **Candidate-A substrate analysis under rung 1's authority**. It is not
detection of LLP 0129 OQ4's Option-C trigger, does not run the Option-C decision
lab, and makes no Option-C recommendation or admission claim. LLP 0130 ER-1
continues to reserve any Option-C admission to the author.

## Evidence method and limits

The witness lives under
`tests/acceptance/fixtures/write-lane/spike/rung2-ir-evaluator.2026-08-04/`.
It is not exported, registered, or referenced by a package. Its README states
that boundary.

The bundle profiles reproduce the Phase-1 method:

- `volta run node`, pinned to Node 24.18.0;
- esbuild 0.28.1;
- browser / ESM / ES2022;
- minification and tree shaking;
- `browser`, `import`, `default` conditions;
- gzip level 9 and Brotli quality 11; and
- esbuild metafile `bytesInOutput` attribution.

The measurement reads the shipping evaluator and makes exact-anchor
transformations in memory. It never writes a variant into a package. Every
profile exports only the three used local-evaluator symbols:
`BROWSER_IR_LOCAL_EFFECT_CLASS`, `classifyLocalMutationIrV1`, and
`evaluateLocalMutationIrV1`. Each variant is also executed after bundling so a
reported candidate is not merely a classifier string.

`Delete` and `Let` already have complete D5 execution branches inside the
shipping evaluator; today only the narrower local-effect classifier refuses
them. Their deltas are therefore chiefly the widened effect-class identity and
classifier set. `AllocateSequence` has no browser execution branch. To avoid a
misleading classifier-only size, the throwaway profile adds a bounded typed
claim list, exact counter/scope matching, exact consumption, binding, and a
never-authority label. That mechanism is deliberately **not** proposed for
shipping: LLP 0133's accepted sequence-answer boundary says the allocation is
outside the ctx ledger and local/re-derived environments.

The receipt SHA-256-binds the shipping evaluator, the store module, Calendar's
manifest, functions, React app and acceptance, plus LLPs 0129 and 0133. It is a
closure measurement, not an application-bundle delta or a new LLP 0145
ratchet.

## 1. Calendar manifest and verb inventory

### Evidence actually available

The frozen zero-bakeoff manifest is
`demos/zero-bakeoff/protocol/acceptance/contention-calendar.v1.json`:

`cc.provisional-render`, `cc.exactly-one-winner`, `cc.loser-correction`,
`cc.ambiguous-retry-idempotence`, `cc.nonoverlap-success`,
`cc.observer-convergence`, and `cc.cleanup`, with 20 resources and two
contenders.

LLP 0129's decision lab has no separate on-disk manifest yet. Its normative
manifest section says the lab will have fresh check IDs and evidence after its
own prerequisites, owner, and timebox. This W1 artifact therefore does not
invent or freeze that future file. It verifies the existing application and
zero-bakeoff manifest against LLP 0129's already-frozen Calendar facts at LLP
0129#frozen-workloads.

The existing Snapback arm is not itself the Move-4 exit implementation:

- `functions.mjs` uses a JS mutation, an application idempotency lookup, and an
  insert;
- `App.tsx` keeps a manual `pending` array, while LLP 0129/0155 require the
  provisional row to live in the same typed query lifecycle; and
- the existing acceptance helper pushes a handwritten projection before the
  server call.

Those are the baseline facts W4 must replace. They are not evidence that a new
IR step is required. The sizing fixture expresses the Candidate-A replacement
as a real serialized plan: one `Insert`, inline `Concat` for
`resourceSlotKey`, return `Binding(reservationId)`, and the existing ctx id
ledger for the speculative mint. The shipping evaluator returns a private
insert layer; LLP 0133 settlement later maps that logical mint to the
server-authoritative id.

### Fact-to-mechanism map

| Frozen fact/check | Candidate-A mechanism | Newly needed mutation step |
| --- | --- | --- |
| provisional render in the ordinary typed query | rung-1 `Insert` layer plus shipped result transform/rebase | none |
| composite resource/slot uniqueness | inline `Concat` value expression; server unique index remains authoritative | none (`Let` would only name an already-expressible value) |
| exactly one winner | both clients may predict `Insert`; server constraint settles one success and one typed rejection | none |
| loser correction | rejection retires that mutation's private optimistic layer | none (`Delete` would wrongly model correction as a second authored write) |
| exactly one intent → canonical id | `Insert` logical mint plus LLP 0133 settlement id-map | none |
| ambiguous retry idempotence | stable protocol `clientMutationId` / settlement identity republishes the stored result | none |
| non-overlap and observer convergence | repeated authoritative `Insert` plus live delivery | none |
| cleanup | harness-owned server/socket teardown; current acceptance never invokes `api.clearReservations` | none |

The app declares a `clearReservations` JS utility that loops over point deletes,
but its frozen acceptance never calls it. It is test support, not Calendar's
common browser-write path, and the manifest's `cc.cleanup` check tears down
owned runtime resources. That is not sufficient evidence to admit `Delete`.

### Candidate disposition

| Candidate | Common-path occurrences | Disposition |
| --- | ---: | --- |
| `AllocateSequence` | 0 | **narrow out** — row identity comes from the existing `Insert` mint/id-map path; sequence answers are settlement-only under LLP 0133 |
| `Delete` | 0 | **narrow out** — loser correction is layer retirement; the unused clear helper is outside the common path |
| `Let` | 0 | **narrow out** — the only candidate computation, `resourceSlotKey`, is an inline closed `Concat` expression |

No broader step was discovered. In particular, Calendar does not need
`DeleteWhere`, `InsertEach`, `AssertCurrentRelation`, or
`AssertSourceChanged`. The current JS handler's indexed idempotency lookup is
not translated literally: the frozen requirement is ambiguous *protocol
redelivery*, already owned by settlement identity. If later product evidence
requires application-key idempotency across distinct operation identities,
that is a new workload fact; none of the three candidate verbs implements an
indexed lookup or conditional branch anyway.

## 2. Browser evaluator cost

### LLP 0166 baseline decomposition

The Phase-1 fixture retained the direct-module LLP 0166 store baseline at
65,413 / 18,574 / 16,518 bytes. LLP 0166's official public-subpath receipt is
65,581 / 18,798 / 16,611. Because Move 3 has since changed the store family,
this run remeasures the same direct all-exports entry rather than pretending
the historical bytes still describe the checkout.

| Layer in the exact same-run comparison | Minified | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| retained Phase-1 direct LLP 0166 store baseline | 65,413 | 18,574 | 16,518 |
| post-0166 store growth present on this checkout | +4,380 | +1,298 | +997 |
| current direct store closure | 69,793 | 19,872 | 17,515 |
| current rung-1 evaluator beside the store | +20,866 | +6,976 | +5,825 |
| all three candidate verbs beyond rung 1 | +1,084 | +283 | +271 |
| **current store + prospective all-candidate evaluator** | **91,743** | **27,131** | **23,611** |

This decomposition preserves the LLP 0166 comparison while keeping candidate
deltas same-run and therefore meaningful. The direct historical-to-current
total is not labeled a verb delta.

### Isolated used-entry closures

| Profile | Minified | Gzip | Brotli | Delta from rung 1 |
| --- | ---: | ---: | ---: | ---: |
| rung 1: `Insert/Get/Guard/Patch` | 20,868 | 7,414 | 6,575 | 0 / 0 / 0 |
| + `AllocateSequence` only | 21,960 | 7,728 | 6,835 | +1,092 / +314 / +260 |
| + `Delete` only | 20,884 | 7,422 | 6,565 | +16 / +8 / -10 |
| + `Let` only | 20,878 | 7,422 | 6,576 | +10 / +8 / +1 |
| cumulative `AllocateSequence` + `Delete` | 21,976 | 7,733 | 6,842 | +1,108 / +319 / +267 |
| cumulative `AllocateSequence` + `Delete` + `Let` | 21,986 | 7,742 | 6,848 | **+1,118 / +328 / +273** |

### Additive beside the current store

| Cumulative profile | Combined minified | Combined gzip | Combined Brotli | Delta beyond rung 1 |
| --- | ---: | ---: | ---: | ---: |
| store + rung 1 | 90,659 | 26,848 | 23,340 | 0 / 0 / 0 |
| + `AllocateSequence` | 91,717 | 27,119 | 23,561 | +1,058 / +271 / +221 |
| + `Delete` | 91,733 | 27,127 | 23,612 | +1,074 / +279 / +272 |
| + `Let` | 91,743 | 27,131 | 23,611 | **+1,084 / +283 / +271** |

In cumulative order, `Delete` adds 16 minified / 8 gzip bytes after the
sequence skeleton; `Let` adds 10 / 4. Shared canonical/value code accounts for
the small difference between isolated and store-adjacent deltas.

## 3. Recommended ceiling and program consequence

For Calendar's exact frozen common path, keep:

```text
snapback.browser-ir.insert-get-guard-patch.v1
```

Do not export `AllocateSequence`, `Delete`, or `Let` from the local effect
ceiling on this evidence. Consequently this W1 artifact does not authorize a
shipping evaluator or codegen edit in W3. If the author wants rung 2 to widen
for a broader product class despite Calendar's zero occurrence count, that is
a fresh scope/rationale decision: the size evidence says `Delete` and `Let`
are cheap, but cheap is not the same as required. `AllocateSequence` also needs
an owning amendment to LLP 0133 before any local semantics can be designed,
let alone exported.

This narrowing does not weaken the Calendar gate. The provisional row still
must pass filtering, ordering, complete-result cardinality, relationships,
React publication, canonical mapping, rejection correction, duplicate-free
delivery, and observer convergence. Those are W4 integration/acceptance facts
over the existing `Insert` evaluator plus the landed store, result-transform,
rebase, and settlement substrates.

## Candidate-A / Option-C framing

This artifact is rung-1-authority substrate work:

- it measures the shared IR evaluator and its exact workload closure;
- it relies on the sole authored server mutation and private IR-derived layer;
- it preserves server authority over unique constraints, canonical ids,
  settlement, and delivery; and
- it adds no application-authored reducer or public extension surface.

It therefore does **not** detect the Option-C trigger. A candidate-set
narrowing is not an IR-inexpressibility result; the Insert-only witness is the
opposite. The LLP 0129 decision lab and Field Notebook remain untouched, and
LLP 0130 ER-1 continues to reserve Option-C admission to the author.

## Honest limits

- The fixture proves mutation-plan expressibility and bundle closure, not the
  W4 served Calendar exit. It does not run React, a unique-index race, live
  delivery, or settlement mapping.
- The current app's manual pending collection is cited as baseline evidence,
  not accepted as satisfying LLP 0129's composability fact.
- The sequence skeleton deliberately invents no shipping contract. Its measured
  1,092 / 314 / 260-byte isolated delta is neither an upper bound nor a budget
  for whatever explicit successor LLP 0133 might someday admit.
- The `Delete`/`Let` deltas assume their existing D5 executor semantics; lane
  W2 still owns exact newly-exported-verb corpus evidence if a later owner
  widens the recommendation.
- Bundle results are closure measurements. A future registered public entry or
  complete application may tree-shake differently.

## Verification record

Commands retained for this report:

```text
volta run node --version
volta run node tests/acceptance/fixtures/write-lane/spike/rung2-ir-evaluator.2026-08-04/calendar-fixture.spike.mjs
volta run node tests/acceptance/fixtures/write-lane/spike/rung2-ir-evaluator.2026-08-04/measure.mjs
./ref-check --verbose
git diff --check
```

Expected measurement output is byte-for-byte identical to
`measurement.v1.json`. No files under `llp/`, package exports, capability
manifests, generated registries, shipping evaluator/codegen, or demo
application paths are modified. No commit is made.
