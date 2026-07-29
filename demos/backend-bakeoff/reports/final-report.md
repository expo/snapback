# LLP 0102 final backend bakeoff report

**Program:** seven providers × five applications, 35 attempted arms

**Frozen protocol aggregate:** `ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`

**Final Snapback source:** `4e5da63c33064082c73359f0ee02efcd11e360ff`

**Final staged package version:** `0.1.1-llp0102.1`

**Architectural potential in current score:** zero points

## Executive answer

The bakeoff was worthwhile. The five apps exercised materially different
backend boundaries—offline settlement, ephemeral state, search and migration,
assets/scheduling/effects, and streamed AI workflows—and produced different
winners. It also found and fixed three important Snapback seams: established
protected-query revocation, reservation-stale retry/readiness, and
sessions-plus-streaming capability composition.

The frozen builder composite puts **Supabase first at 81.04**, but only 0.44
points above Firebase. Under LLP 0102's three-point rule, Supabase, Firebase,
and Convex are one practical top tier. My general go-to today is **Supabase by
a hair** for its transparent SQL/RLS authority, search, storage, vector, and
escape hatches. **Firebase is equally defensible—and was the independent
reviewer's choice—when mature retained offline behavior and broad integrated
services matter most.** Convex has the best authoring coherence, but its tested
Research Room version has a provider Stop that a composite cannot average
away.

Snapback ranks seventh at 62.84, only 0.32 points behind Appwrite and therefore
in a practical tie for sixth. That is not a verdict that the architecture is
wrong. Its final installed-package arms have 60 PASS, 13 honest GAP, zero FAIL,
and zero Stop across the five apps. Its low score is concentrated in missing
offline, assets/search/vector, hosted deployment, external-package lifecycle,
and maturity—not in authority or settlement correctness.

## Product completeness

`P/G/F/U` means PASS/GAP/FAIL/unavailable. Unavailable hosted targets are not
passes.

| Provider | Todo | Chat | Linear | Partiful | Research Room |
| --- | --- | --- | --- | --- | --- |
| Snapback final | 11/3/0/0 | 14/1/0/0 | 10/4/0/0 | 12/3/0/0 | 13/2/0/0 |
| Convex | 13/1/0/0 | 12/3/0/0 | 12/1/0/1 | 14/0/0/1 | 14/0/1/0 **Stop** |
| Supabase | 11/3/0/0 | 14/1/0/0 | 12/2/0/0 | 14/0/0/1 | 15/0/0/0 |
| Firebase | 14/0/0/0 | 15/0/0/0 | 12/1/0/1 | 14/0/0/1 | 15/0/0/0 |
| InstantDB | 14/0/0/0 | 13/2/0/0 | 12/2/0/0 | 9/6/0/0 | 11/4/0/0 |
| SpacetimeDB | 11/3/0/0 | 13/2/0/0 | 11/2/0/1 | 14/0/0/1 | 13/2/0/0 |
| Appwrite | 11/3/0/0 | 12/3/0/0 | 12/1/0/1 | 14/0/0/1 | 14/1/0/0 |

The current-version additive refreshes did not reverse the frozen conclusions:
Research Room/Supabase 2.111.0 passed 15/15 on a fresh safe-wrapper run; current
Chat/Firebase passed 15/15; current Linear/Firebase finished 12 PASS, one
search GAP, and one unavailable hosted check. Their earlier invalidated or
contained attempts remain in the lineage.

## Official composite

| Rank | Provider | Composite | Interpretation |
| ---: | --- | ---: | --- |
| 1 | Supabase | 81.04 | General go-to by a narrow margin |
| 2 | Firebase | 80.60 | Practical tie; offline-first go-to |
| 3 | Convex | 78.72 | Practical tie; Research Room Stop remains controlling |
| 4 | SpacetimeDB | 70.20 | Strong connected transactional/realtime choice |
| 5 | InstantDB | 66.88 | Excellent Todo/offline ergonomics, thinner server platform |
| 6 | Appwrite | 63.16 | Broad self-hosted platform, heavy operations |
| 7 | Snapback | 62.84 | Practical tie with Appwrite; strongest on exact authority/settlement |

Practical ties are Supabase/Firebase (0.44), Supabase/Convex (2.32),
Firebase/Convex (1.88), and Appwrite/Snapback (0.32). The Convex provider Stop
still makes it ineligible for Research Room at the tested version.

The independent reviewer produced the same provider order. Its weighted
matrix scored Supabase 78.80 and Firebase 78.40, but chose Firebase narratively
inside that practical tie. The full 350-cell comparison and its partial
anchoring limitation are retained in
[`independent-rating-audit.md`](./independent-rating-audit.md).

## Per-application choices

| App | Builder ranking | Go-to judgment |
| --- | --- | --- |
| Todo | Firebase 82.8, Convex 82.6, Supabase 81.4 | Three-way practical tie. Firebase for mature offline; Convex for online authoring coherence; the reviewer picked InstantDB for its exceptionally compact complete offline path. |
| Chat | Supabase 81.4, Convex 77.2, Firebase 75.8 | Supabase by the frozen composite; Firebase if cold protected history is decisive. |
| Linear | Convex 83.6, Supabase 79.4, Firebase 78.8 | Convex for reactive authoring plus native search. Supabase is the relational/migration choice and the independent reviewer's pick; Firebase is the offline choice. |
| Partiful | Supabase 83.8, Firebase 82.8, Convex 81.6 | Three-way practical tie. Supabase narrowly leads; Firebase has the broadest mature integrated surface; Convex is the smallest coherent app model. |
| Research Room | Firebase 82.8, Supabase 79.2, SpacetimeDB 71.2 | Firebase by the builder matrix, Supabase by the independent reviewer. Both passed 15/15. Convex is ineligible because of its provider Stop. |

The per-app scores are useful preference summaries, not fake benchmark
precision. A decisive product fact can override a practical tie.

## Sensitivity

Varying one frozen category weight by ±25% and renormalizing produces only
these rank changes:

| Variation | Rank change |
| --- | --- |
| Modeling −25% | Firebase 2→1; Supabase 1→2 |
| Realtime/offline +25% | Firebase 2→1; Supabase 1→2 |
| Correctness +25% | Snapback 7→6; Appwrite 6→7 |
| Completeness −25% | Snapback 7→6; Appwrite 6→7 |
| Deployment/operations −25% | Snapback 7→6; Appwrite 6→7 |
| Maturity/control −25% | Snapback 7→6; Appwrite 6→7 |

All other one-at-a-time variations leave the order unchanged. The exact top
choice is weight-sensitive; the top three tier and the Snapback/Appwrite
bottom tie are more stable than their decimal ordering.

## What each provider taught us

- **Convex:** one schema/functions/transactions/reactive-query/type model can
  make connected application development unusually coherent. Snapback should
  match the outcome while retaining explicit authority and settlement.
- **Supabase:** ordinary SQL, constraints, RLS, full-text search, vector
  search, Storage, and inspectable escape hatches make authority independently
  understandable. Its many seams and heavy local stack are the tradeoff.
- **Firebase:** persistent cold cache and queued offline settlement can be
  dependable, observable product behavior. The cost is several products,
  policy surfaces, large dependencies, and document-model constraints.
- **InstantDB:** live React and room state can be exceptionally compact, and
  its Todo offline path was excellent. Complex server invariants, permission
  diagnostics, scheduling, effects, and secrets are less complete.
- **SpacetimeDB:** transactional reducers and caller-dependent live views make
  connected revocation and contention excellent. Full auth, offline,
  parameterized views, search, and secrets remain thinner.
- **Appwrite:** a self-hostable platform can cover Auth, transactions, files,
  functions, scheduling, and full text in one product. Its 28–29-container
  local footprint and control-plane/runtime roughness are substantial.
- **Snapback:** coherent durable data, sessions/scoped roles, typed ephemeral
  state, active revocation, bounded actions, and explicit effect settlement
  are real differentiators. Missing product breadth and external operations
  prevent those strengths from being the default choice today.

## Snapback improvement synthesis

The order below is by expected user value, not implementation similarity to a
competitor.

| Priority | Outcome to deliver | Evidence and comparison | Preserve | Acceptance proof |
| ---: | --- | --- | --- | --- |
| 1 | Ordinary protected offline reads, durable outbox, and exact reconnect settlement | GAP in all five Snapback apps; Firebase and InstantDB proved cold state and queued writes | Server authority, explicit conflicts, revocation, effect certainty | Fresh browser starts from protected retained state with transport down; authorized queued work settles once; revoked data is retired safely |
| 2 | A boring external install, lifecycle, and hosted deployment path | Staged packages worked, but no public registry or hosted score; installed lifecycle needed glue and cleanup left an owner-only carrier | Exact target identity, scoped cleanup, reproducible local mode | Clean Linux/macOS project installs public packages, scaffolds, deploys, inspects, stops, and removes every owned carrier without a source checkout |
| 3 | Authenticated asset byte lifecycle | Partiful and Research Room GAP; Firebase, Supabase, Convex, and Appwrite proved upload/delivery/delete | Declaration-bound auth and live revocation | Member upload, outsider denial, exact-byte authorized download, deletion/revocation, cleanup proof |
| 4 | Authorized indexed text and vector retrieval | Linear search and Research semantic GAP; Supabase/Firebase/Convex demonstrated integrated paths | Query authority, deterministic indexing, no hidden external trust boundary | Scoped full-text and vector queries with outsider denial, migration/index evidence, deterministic teardown |
| 5 | One process-live served-capability manifest | Sessions/streaming composition originally blocked 12 Research checks | Cold-start refusal when a capability is genuinely unavailable | Compile, generated metadata, preflight, and runtime all consume one exact manifest; drift tests fail closed |
| 6 | Finish package ergonomics and lifecycle diagnostics | Missing `@snapback/client/online` declarations, custom installed glue, opaque secure-carrier refusal, stop cleanup residue | Secret-safe diagnostics and exact ownership | Typecheck from tarballs, actionable coded failures without carriers, idempotent start/inspect/stop, zero residue |
| 7 | Make the fast path actually fast | Chat burst and some Linear writes were slow; Linux receipts cannot support cross-provider claims | Transaction/effect certainty | Normalized machine profile, fixed workload, 2+7 samples, profiled latency budget without weakening semantics |
| 8 | Keep closing guide-discovery gaps | Seed/session ordering, membership batch ceiling, mutation ceiling, outbound capability flag, ephemeral readiness all consumed discovery time | Guide as CI-verified intent index | Every recurring friction has a guide path or explicit GAP row and an acceptance snippet |

The existing remediation ledger already routes these as SB-011 through SB-015
and related entries. Repository follow-ups include:

- `issues/20260729-centralize-served-capability-manifest-composition.md`;
- `issues/20260729-sessions-client-inspect-omits-protocol-offer.md`;
- `issues/20260729-bakeoff-capsule-verifier-schema-divergence.md`;
- `issues/20260729-external-package-lifecycle-gaps.md`; and
- `issues/20260729-bakeoff-performance-machine-profile.md`.

### Differentiators to protect

- active protected-query blanking on authorization loss;
- explicit conflicts rather than silent last-write-wins for semantic updates;
- durable and ephemeral state in one authority model;
- bounded streaming with durable progress;
- cancellation fencing and distinct success, failure, cancellation, timeout,
  and ambiguity outcomes;
- exact target identity, scoped cleanup, and secret-carrier discipline.

Do not grow seven provider-shaped abstractions. Match the useful outcomes
through Snapback's authority, settlement, local-first, and target model.

## Can Snapback become number one?

**Yes, on the evidence, continued refinement can make Snapback the number-one
choice for a coherent authority/settlement/local-first backend. The bakeoff
does not show a need for a fundamental rewrite.** One focused repair changed
Research Room from 1 PASS/2 GAP/12 FAIL to 13 PASS/2 GAP/0 FAIL, and the final
package confirmation removed every Snapback FAIL across all five apps. The
core model survived adversarial auth, conflict, revocation, streaming,
cancellation, retry, ambiguity, and cleanup tests.

Becoming the holistic number one requires more than polishing current seams.
It requires a productization phase: protected offline settlement, assets,
indexed text/vector retrieval, public packages, and credible hosted/external
operations. That is a change in emphasis and breadth, not necessarily a change
in the underlying architecture.

A fundamental approach change becomes warranted only if evidence shows one of
these triggers:

1. clean hosted/external deployment cannot preserve the authority and
   settlement guarantees;
2. the storage/target model cannot support assets and authorized indexed
   retrieval without provider-specific escape hatches;
3. protected offline work cannot reconcile without weakening revocation,
   conflict, or effect certainty; or
4. capability admission continues to drift after all surfaces consume one
   process-live manifest.

Until one of those triggers fires, the rational course is repeated measured
remediation, with table-stakes breadth now receiving more investment than new
semantic machinery.

## Evidence and limits

The official inputs and generated output are
[`final-ratings.v1.json`](./final-ratings.v1.json) and
[`final-scoring.v1.json`](./final-scoring.v1.json). The original 35 capsules,
five diaries, remediation ledgers, package handoffs, refresh handoffs, and
central evidence audits remain the source record.

Performance and cost do not support a production-scale league table. Arms used
different machines and local/shared/hosted target classes; Todo and Chat final
Snapback receipts contain a corrected stale machine label; several hosted
targets were unavailable; and the frozen workload was deliberately small.
Raw samples remain useful within an arm. They are not cross-machine scale
claims. Free/shared/local targets likewise do not establish production cost.

The independent reviewer was distinct from the builders and never saw the
final builder matrix, but earlier round reports exposed some provisional
subjective signals. This lowers independence confidence and is disclosed
rather than hidden. The two matrices still converge on provider order and the
top-tier result while retaining 102 cell disagreements.
