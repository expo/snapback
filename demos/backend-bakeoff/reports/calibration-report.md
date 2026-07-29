# LLP 0102 calibration report

**Round:** Todo + realtime group chat
**Frozen Snapback commit:** `ed31c1dd428298dc7ab4734ee2e3c2354112ba1a`
**Completed arms:** 14 / 14
**Stop-class defects:** 0
**Evidence cut:** 2026-07-29 after exact cleanup and coordinator verification

## Executive result

The calibration round was worthwhile and discriminating. It did not collapse
into seven equivalent CRUD demos:

- Firebase was the only provider to pass all 29 Todo and Chat checks.
- InstantDB passed all Todo checks and was especially compact for live data and
  ephemeral rooms, but the Chat arm could not directly prove server-owned
  order fields or cold browser history.
- Supabase was the strongest inspectable relational authority and passed every
  Chat check except cold offline history.
- Convex had the cleanest online server-function/reactive-query experience,
  while native ephemeral state and cold offline history remained gaps.
- SpacetimeDB delivered the strongest live-view revocation result, but lacked
  native ephemeral typing and persistent offline history.
- Appwrite was credible and broad but delegated the central offline outcomes
  and carried the heaviest local topology.
- Snapback's coherent durable, transient, authority, and client model was
  genuinely promising, but the same protected-row revocation failure appeared
  independently in Todo and Chat. Its normal protected JavaScript-query path
  also missed the offline outcomes central to its product thesis.

The provisional weighted scores put Supabase, Convex, and Firebase within 2.1
points—one practical tie under the frozen three-point rule. For these two
specific apps, the builder's go-to within that tie is Firebase because it alone
completed every product fact, including cold offline state. Supabase is the
conditional choice for SQL-centered online products; Convex is the conditional
choice when authoring coherence matters more than native offline and ephemeral
capabilities.

This is diagnostic, not the final ranking. Only two of five apps are included,
hosted evidence was uneven, and the final independent rating audit has not yet
run.

## Outcome 1 — product completeness

| Provider | Todo | Chat | Calibration total |
| --- | ---: | ---: | ---: |
| Appwrite | 11 PASS / 3 GAP | 12 PASS / 3 GAP | 23 PASS / 6 GAP |
| Firebase | 14 PASS | 15 PASS | **29 PASS** |
| Convex | 13 PASS / 1 GAP | 12 PASS / 3 GAP | 25 PASS / 4 GAP |
| Supabase | 11 PASS / 3 GAP | 14 PASS / 1 GAP | 25 PASS / 4 GAP |
| Snapback | 10 PASS / 3 GAP / 1 FAIL | 13 PASS / 1 GAP / 1 FAIL | 23 PASS / 4 GAP / **2 FAIL** |
| InstantDB | 14 PASS | 13 PASS / 2 GAP | 27 PASS / 2 GAP |
| SpacetimeDB | 11 PASS / 3 GAP | 13 PASS / 2 GAP | 24 PASS / 5 GAP |

The two Snapback failures have the same shape: after declaration-bound
membership removal, a fresh query is denied and no future forbidden change is
delivered, but the established live handle retains its predecessor protected
rows rather than blanking. This is one recurring defect, not two unrelated
bugs, and it is linked through the existing P0 filesystem issue.

The most repeated capability gap is cold offline history. It is absent in the
tested Convex, Supabase, Appwrite, and SpacetimeDB paths; it is also absent on
Snapback's ordinary protected JavaScript query. Firebase directly restored
browser history. InstantDB proved the complete Todo offline path, but the
remote Chat arm lacked a controlled browser and correctly left that check as a
GAP rather than extrapolating.

Todo capsules: `arms/todo/*/run-capsule.v1.json`. Chat capsules:
`arms/chat/*/run-capsule.v1.json`. Narrative evidence:
`diaries/0027-todo-backend-bakeoff.diary.md` and
`diaries/0028-chat-backend-bakeoff.diary.md`.

## Outcome 2 — authoring cost

Raw timed active-work windows are reported without turning unlike machine and
target conditions into a fake precision score:

| Provider | Todo elapsed | Chat elapsed | Notable cost or intervention |
| --- | ---: | ---: | --- |
| Appwrite | 21.5 min | 122.2 min | 28-container local surface in Todo; Chat setup and evidence loop dominated the arm |
| Firebase | 36.5 min | 39.3 min | Java install, four Firebase products, two rule surfaces, controlled-browser offline proof |
| Convex | 31.2 min | 150.6 min | Very small product surface; local beta binary/dashboard and a false logout Stop adjudication dominated Chat |
| Supabase | 29.5 min | 83.1 min | Direct SQL/RLS model; 12-container local stack, ECR 429, and Colima bind workaround |
| Snapback | 35.2 min | 63.0 min | Guide-first path; Ibex/Hermes source bootstrap, large acceptance harness, ephemeral readiness discovery |
| InstantDB | 31.7 min | 30.5 min | Compact product code; permission/link debugging and temporary-app parser resets |
| SpacetimeDB | 25.6 min | 11.8 min | Fast module loop; view/page-result modeling and CLI ownership cleanup papercuts |

Elapsed time includes retained builder errors and environment setup by design.
It is not normalized for machine, cached dependencies, hosted versus local
execution, or worker familiarity. Source-line inventories also use
provider-specific classifications and are retained in each capsule rather than
presented as a directly comparable productivity score.

Preference-shaping authoring outcomes:

- Convex made reactive queries and transactional server functions feel like
  one small model.
- InstantDB made schema-to-live-React and native room state exceptionally
  compact.
- Supabase made authority independently inspectable through ordinary SQL,
  constraints, grants, and RLS.
- SpacetimeDB made transactional reducers, generated bindings, subscriptions,
  and caller-dependent live views coherent.
- Firebase made persistent offline behavior observable and dependable, at the
  cost of a broad product/configuration surface.
- Snapback uniquely kept durable live data, typed ephemeral rooms, sessions,
  scoped roles, and both client arms in one authoring model, but its bootstrap
  and lifecycle seams prevented that coherence from translating into the
  smallest successful path.

## Outcome 3 — correctness and evidence confidence

| Provider | Todo | Chat | Total / 32 | Important confidence boundary |
| --- | ---: | ---: | ---: | --- |
| Appwrite | 16 / 16 | 16 / 16 | **32** | Direct local evidence; hosted production unmeasured |
| Firebase | 16 / 16 | 16 / 16 | **32** | Direct emulator/browser evidence; hosted production unmeasured |
| Convex | 16 / 16 | 15 / 16 | 31 | Chat warm-cache read and no controlled rendered browser |
| Supabase | 16 / 16 | 14 / 16 | 30 | Chat local-only; no cold cache and machine-specific runtime mirror |
| Snapback | 15 / 16 | 15 / 16 | 30 | Direct local failure evidence; unsupported protected offline paths |
| InstantDB | 16 / 16 | 14 / 16 | 30 | Hosted target direct; Chat browser offline and artifact lifecycle limits |
| SpacetimeDB | 16 / 16 | 15 / 16 | 31 | Direct local server evidence; no hosted/auth-product proof |

All fourteen final capsules pass the frozen verifier, all referenced evidence
paths resolve, and every arm has target-bound cleanup evidence. No Stop-class
disclosure or destructive cleanup defect occurred. Failed attempts remain
retained, including the Convex false logout Stop candidate, Supabase registry
and bind failures, InstantDB permission resets, and SpacetimeDB's anonymous
ownership 403.

The most important correctness distinction is revocation:

- Firebase, Supabase, InstantDB, and SpacetimeDB stopped future protected
  delivery on their tested native paths.
- SpacetimeDB and InstantDB also directly removed protected rows from the live
  subscribed view.
- Firebase denied future/fresh access but retained previously authorized
  browser-cache bytes, an explicitly disclosed application policy burden.
- Snapback stopped future delivery but failed to blank the established handle,
  contradicting its accepted invalidation contract.

## Provisional composite

Each category is rated 0–5 under the frozen rubric. Abbreviations:
`A` authoring; `M` modeling; `C` correctness; `R` realtime/offline; `Au` auth;
`P` platform completeness; `D` deployment/operations; `T` testing/docs/agent;
`Pf` performance/cost; `E` maturity/ecosystem/control.

| Provider / app | A | M | C | R | Au | P | D | T | Pf | E | Weighted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Appwrite / Todo | 2 | 3 | 4 | 2 | 4 | 4 | 2 | 3 | 3 | 4 | 59.4 |
| Appwrite / Chat | 2 | 3 | 4 | 2 | 4 | 4 | 2 | 3 | 2 | 4 | 58.0 |
| Firebase / Todo | 3 | 4 | 5 | 5 | 5 | 5 | 3 | 4 | 3 | 5 | 82.8 |
| Firebase / Chat | 3 | 3 | 4 | 5 | 4 | 5 | 3 | 4 | 2 | 5 | 75.8 |
| Convex / Todo | 5 | 4 | 5 | 4 | 4 | 4 | 3 | 4 | 4 | 4 | 82.6 |
| Convex / Chat | 4 | 4 | 5 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 77.2 |
| Supabase / Todo | 3 | 5 | 5 | 2 | 5 | 5 | 4 | 4 | 4 | 5 | 81.4 |
| Supabase / Chat | 3 | 5 | 5 | 4 | 5 | 5 | 2 | 4 | 4 | 5 | 81.4 |
| Snapback / Todo | 2 | 4 | 2 | 2 | 2 | 3 | 2 | 3 | 2 | 2 | 47.6 |
| Snapback / Chat | 3 | 4 | 2 | 4 | 2 | 4 | 2 | 3 | 2 | 2 | 57.4 |
| InstantDB / Todo | 4 | 3 | 4 | 5 | 3 | 3 | 3 | 3 | 4 | 3 | 71.2 |
| InstantDB / Chat | 3 | 3 | 4 | 4 | 3 | 3 | 3 | 3 | 4 | 3 | 65.8 |
| SpacetimeDB / Todo | 4 | 4 | 5 | 2 | 3 | 3 | 3 | 4 | 5 | 3 | 71.0 |
| SpacetimeDB / Chat | 3 | 3 | 5 | 3 | 3 | 3 | 3 | 3 | 5 | 3 | 66.8 |

Provisional two-app means:

| Diagnostic rank | Provider | Mean | Interpretation |
| ---: | --- | ---: | --- |
| 1 | Supabase | 81.4 | Practical tie; strongest relational authority, offline gap |
| 2 | Convex | 79.9 | Practical tie; strongest online authoring coherence |
| 3 | Firebase | 79.3 | Practical tie; only complete 29/29 product result |
| 4 | SpacetimeDB | 68.9 | Practical tie with InstantDB; strong transactional live views |
| 5 | InstantDB | 68.5 | Practical tie with SpacetimeDB; compact collaborative/offline Todo path |
| 6 | Appwrite | 58.7 | Broad and credible, but offline and local-weight penalties |
| 7 | Snapback | 52.5 | Central revocation failure and protected offline gap dominate current choice |

The ordered numbers should not be over-read: every top-three pair is a frozen
practical tie. The preference narrative breaks the tie for the calibration
apps in Firebase's favor, while the SQL-first and authoring-first conditional
choices remain Supabase and Convex.

Every rating is based on the corresponding two capsule paths and provider
sections in the two numbered diaries. These are builder ratings and remain
subject to the independent final audit required by LLP 0102.

## Snapback synthesis

### Immediate defects and papercuts

1. **Protected live revocation does not blank rows.** Reproduced in both apps;
   highest-severity defect and first remediation candidate.
2. **Live disposal is not idempotent.** Logout-driven retirement followed by
   ordinary cleanup reports `SNAPBACK_UNKNOWN_SUBSCRIPTION`.
3. **Effect-free auth reservation staleness leaks into app code.** A normal
   two-client append needed a bounded retry despite `effectCommitted: false`.
4. **Bearer/reset lifecycle diagnostics confuse success and cleanup.** Todo
   found bearer replacement and principal-reset consequences that should be
   explicit and deterministic.

### Repeated experience improvements

- One generated query should cover initial read, push, reconnect, cache
  provenance, and invalidation with less harness-specific lifecycle plumbing.
- Multi-principal test clients need isolated auth stores/transports and
  explicit offline/reconnect controls.
- Target creation should emit strict redacted JSON identity plus an exact
  cleanup receipt.
- Authorization should be independently inspectable: explain the captured
  dependency, rule or role gate, and the cause of refusal or invalidation.
- Prepared Ibex/Hermes artifacts should make first build ordinary; source
  compilation should remain a deliberate fallback.

### Table-stakes capabilities

- Protected cold retained history and restart-safe queued writes must reach the
  normal React/JavaScript path. InstantDB and Firebase demonstrated the desired
  invisible outcome in Todo; Firebase directly demonstrated cold browser
  history in Chat.
- Stable cursor pagination, deterministic ordered append, and observable
  server-owned identity/time/order should be paved rather than re-invented.

### Differentiators to protect

- Snapback's typed native ephemeral rooms are architecturally better than
  durable TTL rows or a second database. Match InstantDB's tiny authoring path
  without giving up the typed room/authority model.
- Explicit settlement receipts, conflict vocabulary, scoped authority, and
  lease-bounded retained state remain unusually strong foundations.
- One small local runtime is a meaningful opportunity against Appwrite,
  Supabase, and Firebase's complete local stacks.

### Architectural assessment

The evidence does not require a fundamental approach change. The most serious
failure contradicts an already accepted contract, and the server/client
machinery for quarantine, terminal delete, acknowledgement, and protected
state custody already exists. The offline limitation is also an incomplete
surface/profile problem rather than evidence that coherent local-first
authority is impossible.

Snapback can plausibly become the number-one choice through repeated
refinement if remediation consistently converts those foundations into the
ordinary app path. The architecture should be reconsidered only if one of
these triggers fires:

- generic membership revocation cannot be made correct without
  fixture-specific invalidation;
- protected retained reads and queued writes cannot safely cover ordinary
  application queries;
- adding hosted targets fractures one authority/settlement contract into
  target-specific semantics; or
- the runtime/codegen/client system remains intrinsically too heavy to make a
  clean external first build competitive after prepared artifacts and paved
  workflows.

None of those triggers has fired yet. The first remediation tranche is defined
in `reports/calibration-remediation.v1.json`.

## Central audit

- 14 / 14 capsules verify.
- All capsule evidence and cleanup paths resolve.
- Protocol tests: 29 / 29.
- Stage 0 freeze: valid; diary prefixes unchanged and append-only.
- `ref-check --verbose`: zero errors and zero unchecked references.
- Guide check: passes with 23 pre-existing freshness warnings; the new
  ephemeral-stream readiness gap is filed for remediation.
- Exact-value secret scan checked 17 values from the two local credential
  sources against new bakeoff artifacts and found zero matches.
- The only generic secret-shaped source match is the explicit identical fake
  Firebase emulator API-key literal, not a retained provider credential.
