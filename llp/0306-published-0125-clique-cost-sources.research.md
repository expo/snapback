# LLP 0306: Published 0.1.25 Clique cost sources

**Type:** Research
**Status:** Draft
**Systems:** Competitive evaluation, Benchmarks, Agent experience, Developer
experience, CLI, Local server lifecycle, Auth, Live queries, Ephemeral state,
Offline sync, Code generation, React/Expo, Diagnostics, Guide, Testing
**Author:** Grok / Charlie Cheever
**Date:** 2026-08-24
**Revised:** 2026-08-25 (Answered — capstone comparison landed; see the
dated closing section)
**Related:** LLP 0043, LLP 0061, LLP 0144, LLP 0160, LLP 0186, LLP 0200,
LLP 0201, LLP 0219, LLP 0223, LLP 0236, LLP 0253, LLP 0275, LLP 0277,
LLP 0281, LLP 0295, LLP 0297, LLP 0299, LLP 0300, LLP 0301, LLP 0302,
LLP 0307,
`benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`,
`benchmarks/runs/2026-08-22-clique-full-familiar-vs-explicit/record.md`,
`issues/20260824-familiar-offline-replay-capability-unathorable.md`,
`issues/20260822-declared-refusal-client-code-preservation.md`,
`issues/20260822-m7-handoff-not-self-contained.md`,
`issues/20260820-familiar-live-subscription-contention.md`,
`issues/20260816-default-retained-query-facts-js-clients.md`,
`issues/20260821-clique-instrument-observability-version-bump.md`

## Summary

The published Snapback **0.1.25** Clique pair on fleet machine
`expo-build-450b` (`gpt-5.6-sol`, Codex 0.149.0, `high`, instrument
`social-messenger@0.3.2-m8`) is existence evidence that both authoring
profiles can reach web authoring-green for M1–M6, M8, and fresh-session M7.
Explicit completed the 167,157-action scale replay. Familiar stopped honestly
at 2,620 contiguous settlements. No grader ran. This is N=1 per profile,
calibration only (LLP 0201 D5). It is not a magnitude claim, a 0.1.25
regression claim against 0.1.24, or a ranking of Explicit versus Familiar.

The expensive work was not schema authoring. It was **loops that left the
paved path and then reconstructed lifecycle, identity, replay, and
observability by hand**, inside one giant Codex turn whose input is mostly
cached conversation.

Headline costs:

| Cost | Dominant source |
| --- | --- |
| Wall | Explicit scale babysitting (11,314s of 18,766s). Next: Familiar M3 typing (3,015s), then both M1 bootstraps (~35 min). Comparable authoring (M1–M6/M8, no scale): Explicit 6,270s vs Familiar 7,961s. |
| Tokens | One Codex `turn.completed` per session. ~99% of input is cached history. Uncached input is ~4.0M across four sessions; output ~618k; reasoning ~150k. Explicit's 201M input is not "twice as hard to author" — it is three extra hours of scale polling in the same context window. |
| Errors | Explicit 42 continuous correction loops (40 agent / 1 ambiguous / 1 environment) + 7 M7. Familiar 37 continuous (25 agent / **7 Snapback-defect** / 4 ambiguous / 1 environment) + 5 M7. Failed commands: 61 Explicit, 92 Familiar. |
| Feel-bad | Supervised `--expo` could not pin Metro/web/bootstrap ports, so both lanes left the paved loop. Metro then retained hashed generated modules. Typing's 2s instrument clock mixed transport with React render. Familiar could not author `offline_mutation_replay` or cron. |

This document is a findings report with routing. It does **not** authorize
new subsystems. Overlap with origin/main at authoring time:

- [LLP 0297](./0297-client-canonicalization-budgets.research.md) already owns
  the node-ceiling / `CanonicalClientValueV1` finding from **this same 450b
  run**. Do not re-open that design here.
- [LLP 0299](./0299-supervised-listener-port-plan.spec.md) is **Implemented**
  on `origin/main` after 0.1.25: supervised listeners are stable-by-default
  and pinnable. The published pin this run consumed did not have that Spec.
- [LLP 0300](./0300-snapback-is-a-url.rfc.md) / [LLP 0301](./0301-url-first-dev-lifecycle.spec.md)
  / [LLP 0302](./0302-declared-dev-client-binding.spec.md) are the
  post-0.1.25 URL-first / declared-dev successor to the lifecycle the lanes
  reconstructed by hand.
- [LLP 0277](./0277-coterie-clique-run-observations.research.md) remains the
  multi-run Clique/Coterie register (0.1.21 sweep, Coterie Exact/Contract,
  0.1.24 matrix). This LLP is the 0.1.25 **full-scope** Sol-high pair.
- [LLP 0295](./0295-published-matrix-improvement-program.plan.md) remains the
  improvement-program owner. Findings below route into it; they do not
  replace its Phase 0 rulings.

The highest-leverage remaining chip-aways, after those landings, are:
generated-module freshness without Metro restart, a first-party headless
replay helper, live latency/size diagnostics, Familiar capability-vocabulary
parity, and declared-refusal preservation at the client.

## Evidence boundary and method

Primary evidence:

- Compact raw run (prompts, event streams, authored source, reports,
  receipts; no `node_modules` / SQLite / Expo caches):
  `/Users/ccheever/clique-published-0125-sol-high-20260823/`.
- Unfiltered original on `expo-build-450b`:
  `/home/ccheever/clique-published-0125-sol-high-20260823/`.
- In-repo pin:
  `benchmarks/runs/2026-08-23-clique-published-0125-sol-high/record.md`.
- Builder diary (authored as working-copy 0111, renumbered to Diary 0113 at
  landing because origin/main had already assigned 0111 to Knockoff social
  auth and 0112 to the *local-main* 0.1.25 M1–M3 pair):
  `diaries/0113-clique-published-0125-sol-high.diary.md`.
- Lane `diary.md` / `essay.md` / `run-log.md` / `final-report.md` /
  `lane-report.json` under `lanes/{explicit,familiar}` and
  `lanes-m7/{explicit,familiar}`.
- Codex JSONL: `logs/{explicit,familiar,explicit-m7,familiar-m7}.events.jsonl`
  and the four `*.tokens.json` extracts.

Method: read the consolidated record, both profiles' diaries/essays, both
run-logs, M7 logs, and classify `item.completed` `command_execution` events.
Token totals are Codex 0.149.0 `turn.completed.usage` with **one event per
session**. Cached input is a subset of input. Attribution of tokens to a
milestone is therefore evidence-bound inference, not a causal allocation.
LLP 0277 already warned that without per-milestone metering, statements of
the form "P14 cost 12% of tokens" would be invented. This run still lacks
that split.

Comparison, not baseline: the 0.1.24 full pair at
`benchmarks/runs/2026-08-22-clique-full-familiar-vs-explicit/record.md` used
the same instrument and `xhigh` rather than `high`. Familiar completed scale
there after six adapter attempts. Treat 0.1.25 Familiar's scale stop as
adapter/effort variance until a second full pin repeats it.

Repository state at authoring: this working copy was behind `origin/main`.
Disposition of "already addressed" uses `origin/main` as of 2026-08-24
(through LLP 0305), not the 0.1.25 npm closure.

This document can license "this happened in this pair" and "this is the
largest observed cost in this pair." It cannot license frequency, product-wide
superiority, or that fixing any named item accounts for every difference
versus Convex, 0.1.24, or Explicit versus Familiar.

## Findings

### F1. Token totals are session-length, not authoring difficulty

Codex reported one `turn.completed` per session. Input includes the growing
conversation on every model call; cached input is ~99% of that input.

| Session | Wall | Input (cached) | Uncached input | Output | Reasoning | Commands (failed) |
|---|---:|---:|---:|---:|---:|---:|
| Explicit continuous | 18,766s | 175,559,887 (173,759,488) | 1,800,399 | 287,079 | 59,929 | 548 (61) |
| Familiar continuous | 9,737s | 89,340,348 (87,856,384) | 1,483,964 | 213,895 | 55,379 | 381 (92) |
| Explicit M7 | 1,948s | 25,397,088 (24,996,864) | 400,224 | 61,649 | 19,128 | 94 (8) |
| Familiar M7 | 2,499s | 18,174,003 (17,862,656) | 311,347 | 55,210 | 16,007 | 81 (6) |

The billable-feeling work is uncached tool output, model output, and
reasoning. The 175M Explicit input is the cost of keeping scale monitoring,
choreography JSONL, Metro logs, and reseeds in one context for five hours.
M7 being a fresh session is the control: similar product work, roughly 8×
fewer input tokens.

Command mix (completed `command_execution` items):

- Explicit continuous: 238 replay/seed, 70 choreography (23 failed), 53
  Snapback CLI, 20 typecheck, 14 Expo/Metro, 11 codegen.
- Familiar continuous: 94 choreography (31 failed), 52 Expo/Metro (32
  failed), 31 typecheck, 31 Snapback CLI, 28 replay/seed.

This matches LLP 0277's 0.1.24 observation that correction-loop count tracks
output tokens better than profile name, and that restart/reseed cycles
multiply every schema correction. The new fact is quantitative: Familiar's
failed-command pile is Expo/Metro + choreography; Explicit's is scale
babysitting + choreography.

LLP 0295 records that per-milestone token metering landed on `main`
(`59894588b`). This published-0.1.25 pair did not emit it. The next pin
should refuse to treat a single session-total as a profile comparison.

### F2. Wall clock is scale, then typing, then bootstrap

Milestone walls to first green (receipt-backed):

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 | M7 first green |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Explicit | 2,183s | 380s | 1,468s | 268s | 1,420s | 143s | 408s | 1,076s |
| Familiar | 2,069s | 882s | 3,015s | 1,005s | 409s | 145s | 436s | 2,049s |

Ranked sinks:

1. **Explicit scale — 11,314.113s.** Settle-before-next 167,157 actions ≈ 68ms
   each. First attempt died at 8,873 with
   `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`. The successful retry used
   `clientMutationId: null` for one-shot transport custody while keeping
   application intent IDs. The agent then sat in the same turn polling the
   process, including orchestration-wrapper parse glitches that did not
   disturb replay.
2. **Familiar M3 typing — 3,015s.** About twelve Metro restarts. Ephemeral
   transport eventually proved prompt. The tail was 45 controlled keystrokes
   reconciling a large message tree. Visibility landed around 1.5s with ~3.3s
   withdrawal. Vs 0.1.24 Familiar M3 at 350s (`xhigh`): this is the largest
   authoring-wall movement in the pair. Do not read it as a 0.1.25 ephemeral
   regression without a second sample; the diary says render cost, not the
   channel.
3. **M1 both lanes — ~35 min.** Scaffold, port-range vs supervised Expo,
   auth-client protocol header, multi-persona `clientStoreId` /
   `rqsStore: null`, first live profile check.
4. **Explicit M5 — 1,420s.** RN Web vs frozen harness observability
   (accessibility values omitted, `src` on a child of the testID,
   fire-and-forget settings writes aborted by hard navigation).
5. **Explicit M3 — 1,468s.** Same 2s typing ceiling, plus snapshot-node
   ceiling after accumulated probes (the incident LLP 0297 owns), plus Metro
   restart after descriptor rotation.
6. **Familiar M7 — 2,049s.** Schema evolution itself was routine. Time went
   into proving it, then into an un-authorable `offline_mutation_replay`
   capability.
7. **Familiar M4 — 1,005s.** Pending-bubble identity,
   `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED`, Expo error overlay eating
   clicks, six live subscriptions under a retained Stack.
8. **Familiar scale — 404.627 active seconds**, then capability-failure at
   2,620/167,157 (1.5674%). Cheap in wall, expensive as a product result: a
   growing synchronized public replica per actor, ~759MB at ~116 retained
   post-resume clients.

### F3. Errors cluster at lifecycle, identity, and measurement

Familiar's seven logged Snapback-defect attributions (plus the M7 capability
contradiction) are the platform-shaped set:

1. Supervised `--expo` selected undeclared Metro/web/bootstrap ports.
2. Familiar generated server does not export `defineAuth`.
3. Clock-dependent visibility and ordinary N+1 point reads refused in
   Familiar queries.
4. Transport `clientMutationId` bound to session vs fixture IDs
   (`SNAPBACK_AUTH_STALE_RESULT`).
5. `ctx.refuse` folded into `SNAPBACK_HANDLER_FAILED`.
6. `v.doc("posts")` treated optional `parentId` as a required return field;
   `v.json()` then typed the result `unknown`.
7. Metro retained a hashed generated descriptor →
   `SNAPBACK_REACT_BINDING_MISMATCH`.
8. M7: target lists `offline_mutation_replay` experimental; Familiar
   `requiredCapabilities` rejects it as unknown; binding omits the settlement
   ledger; native queue dispatch refuses
   `SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED`.

Explicit's loops were more often agent/harness: wrong fixture IDs, Stack
duplicate testIDs, composer re-renders, RN Web observability, then the 1,024
mutation-result ceiling.

Self-scores (builder, not grader): Explicit continuous holistic 68, M7 91;
Familiar 58 and 76. Lowest dimensions were B4 offline, B5 media, B6 search,
B10 diagnostics, and Familiar B7 (28) because cron is outside the Familiar
grammar.

### F4. What did not feel good is leaving the paved loop

Both diaries praise the same core: served Guide, generated references, live
queries, day-2 additive/backfill/tighten, Explicit cron as a visible
declaration. The sharp edges are operational:

- **Topology.** Supervised Expo is the paved loop. The 0.1.25 CLI allocated
  Metro/front/bootstrap with `freeLoopbackPort` and exposed no flags. Both
  lanes inspected shipped `expo-dev.mjs` and switched to external-client
  topology. That forfeited supervised AppBinding refresh (closed 2026-08-21
  on `main`) and the 10s `developmentSync` wait (closed 2026-08-03, supervised
  local-dev only). Then: false `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` with
  no OS listener; Linux RN DevTools chrome-sandbox; one-hour **external**
  AppBinding expiry during Familiar's final audit.
- **Generated identity as an operational event.** Every schema/function edit
  rotated a hashed module. Hot reload often kept the old descriptor. Agents
  learned to kill Metro. Familiar did this about twelve times in M3 alone.
- **Typing as an end-to-end property.** Guide recipes were found and used.
  `useSnapbackActivityPresence` publishes on every `touch()`, so per-keystroke
  use hit burst/rate limits. The frozen 2s clock includes RN Web controlled
  input. Until bubbles were memoized and history bounded, transport and render
  looked like one delay. Agents asked for a timeline: input → admit →
  dispatch → subscribe → React commit.
- **Diagnostics that name the wrong layer.** Declared refusals as
  `SNAPBACK_HANDLER_FAILED`. Node-limit refusal with no pre-flight count
  (LLP 0297). Duplicate testIDs with no overlay. Hook pending vs legitimate
  empty vs valid zero. Optimistic/queued/authoritative copies sharing
  locators. Unhandled `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` opening Expo's
  overlay.
- **Contracts that fight the Guide.** Prompt says `_generated/`; 0.1.25
  refuses it. Familiar Guide says leave the profile for cron; the lane forbids
  leaving. Target lists `offline_mutation_replay`; Familiar cannot declare it.
  Migration Guide calls tightening reviewed-migration territory; Explicit's
  watched runtime auto-tightened after rows validated.
- **Scale as an app-owned protocol.** No first-party headless fixture replay
  that disposes clients, skips live queries, and opts out of result custody.
- **Handoff.** Explicit M7 lacked `personas.json`, reproducing
  `issues/20260822-m7-handoff-not-self-contained.md`.
- **Harness vs RN Web.** Frozen `observableState` watches the testID node's
  own attributes; RN Image puts `src` on a child. Those are measurement
  artifacts. They still burned tokens because the agent could not tell
  instrument from product (LLP 0281).

### F5. `origin/main` already moved several of the highest-leverage items

These were **not** in the published 0.1.25 closure the lanes consumed. They
change what the next pin should still treat as open:

| Item observed on 0.1.25 | `origin/main` as of 2026-08-24 |
| --- | --- |
| Supervised `--expo` cannot pin Metro/web/bootstrap | **LLP 0299 Implemented.** Stable-by-default, pinnable everywhere. Next published pin should keep agents on `--expo`. |
| External-client topology reconstructed by hand | **LLP 0300/0301/0302** URL-first lifecycle and declared-dev binding. Verify the Clique port-range journey against these, do not re-design W1. |
| `SNAPBACK_REACT_ARGS_INVALID` node ceiling on `viewerState` | **LLP 0297 Review** owns the split: argument profile vs generated-artifact profile vs result identity. This LLP only records that the incident happened here. |
| Supervised AppBinding 1h expiry | Closed 2026-08-21. Helps `--expo`. External bindings this run minted still expired. |
| Binding-mismatch wait loop | Closed 2026-08-03 for supervised local-dev. Independently-owned Metro still hard-failed. |
| W1 fixed-origin external-client `snapback dev` | Closed 2026-08-21 (LLP 0295 move 2). 0.1.25 already had the flags; Familiar still hit a false stale-listener. |
| Per-milestone token metering | LLP 0295 records it landed. This pair's Codex stream did not emit it. |
| Declared-refusal *guide teaching* | Ask 1 of the discoverability ticket landed. Client envelope still loses the app code. |

## Disposition: already / planned / no plan

### Already addressed on `origin/main` (verify on the next published pin)

Do not open parallel tickets. Qualify the Clique port-range + `--expo` journey
against LLP 0299/0301/0302. Keep LLP 0297 as the node-ceiling owner.

### Planned or ticketed, not done enough to have saved this run

| Item | Owner |
| --- | --- |
| Familiar cannot author `offline_mutation_replay` while the target advertises it | `issues/20260824-familiar-offline-replay-capability-unathorable.md` (filed from this run) |
| Preserve `ctx.refuse` / declared `appCode` at every client | `issues/20260822-declared-refusal-client-code-preservation.md`; remaining asks 2–3 on `issues/20260808-guide-gap-declared-refusals-discoverability.md` |
| M7 handoff not relocatable / missing `personas.json` | `issues/20260822-m7-handoff-not-self-contained.md` |
| Application-visible diagnostic before six-subscription overload / auth-suspended overlay | `issues/20260820-familiar-live-subscription-contention.md` |
| Default query retention on JS clients | `issues/20260816-default-retained-query-facts-js-clients.md` |
| Clique instrument bump: typing clock vs render, structural selectors, media compose, isolate poisoned retries | `issues/20260821-clique-instrument-observability-version-bump.md` (LLP 0281). Child tickets it names are missing on disk in this working copy. |
| Migration rollback / rehearsal / tighten ceremony matching the Guide | `issues/20260803-0160-migration-experience-program.md` |
| First-use ceremony budget | `issues/20260817-0275-first-use-ceremony-budget-harness.md` |
| Domain-neutral Expo starter | `issues/20260819-minimal-expo-starter.md` |
| Live-query re-eval cost under fan-out | `issues/20260808-live-query-reevaluation-cost-at-scale.md` (rung-1 coalescing landed; incremental D2 is not) |
| React live-query debug/receipt projection | `issues/20260808-react-live-query-debug-projection.md` (demand-gated) |
| Familiar imported helpers (full negative matrix) | remainder of `issues/20260821-familiar-imported-helper-support.md` |
| Cost/evidence visibility (runtime cost recorder, delivery inspection) | LLP 0295 move 5 |

### No real plan to "fix," or correctly out of scope

Improving the *experience around* these is in scope. Removing them is not.

- Familiar has no cron. Guide: leave the profile (LLP 0253). B7=28 is that
  boundary. Either grade M8 schedule N/A for Familiar-only lanes or stop
  forbidding the documented leave.
- Protected queries cannot use `RuntimeNow`
  (`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`).
- 1,024 mutation-result retention, 1,024 `.take()`, canonical value
  node/depth limits, inline-handler syntax. Intentional ceilings. Missing
  piece is a pre-flight inspector and a first-party one-shot replay helper.
- Linux has no iOS Simulator. Honest null.
- Settle-before-next 167k actions is instrument law (LLP 0201).
- Expo Router retained Stack duplicate testIDs, RN Web `src`/a11y, Insights
  false-zero: mix of app, kit, and harness. LLP 0281 owns the measurement
  half.
- Grader-owned Familiar digest obligation. No grader ran.

## Chip-away catalog

Every observed problem or large token sink that could be reduced. Grouped by
leverage, not milestone. Starred items are the ones this pair suggests would
change the *shape* of the next full run.

### A. Session and context shape

1. \* One 5-hour Codex turn. Split M1–M3 / M4–M6 / scale / M7, or compact
   receipts at milestone boundaries. M7 already shows the win.
2. \* Scale babysitting in-process (238 Explicit replay/seed commands). Run
   scale as a detached process with a tiny watcher.
3. \* Failed choreography JSONL in context (23+31 failed browser runs). Emit
   a 20-line structured miss; keep the JSONL on disk.
4. Metro restart logs (Familiar 52 Expo/Metro commands, 32 failed).
5. Repeated starter reseeds after every backend/descriptor rotation.
6. Prompt vs executable `_generated/` vs `generated/`.
7. Missing per-milestone token split in this pair's harness stream, despite
   LLP 0295 recording the metering landing.

### B. Dev loop

8. \* `--expo` port pinning — **LLP 0299 Implemented on `main`.** Qualify on
   the next pin; do not re-specify.
9. \* Hashed generated modules stick in independently-owned Metro after
   codegen. Stamp-file invalidation, not a ritual restart. Still open after
   0299, because 0299 does not make Metro drop `app.descriptor.*` /
   `app.binding.*`.
10. External AppBinding 1h TTL with no refresh (supervised path was fixed;
    this path was not).
11. False `SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER` when no listener exists.
12. Linux RN DevTools SUID sandbox. Default `CI=1` / `EXPO_NO_DEVTOOLS=1` on
    headless hosts.
13. `snapback dev --expo` mutually exclusive with `--external-client-origin`
    in 0.1.25. Recheck against 0301.
14. Rotating deployment bindings as a required app concern instead of a
    supervisor rewrite (0301/0302).

### C. Authoring and codegen traps

15. `defineAuth` not on Familiar generated server export.
16. `v.doc` optional fields required on return; `v.json()` → `unknown`.
17. N+1 point reads and clock-dependent query visibility refused without a
    "do this instead" snippet on the diagnostic.
18. Inline handler: no `const` helpers, no computed assignment, no
    `RuntimeNow` in protected results.
19. Generic Explicit `dispatch` mutation concentrating authority and
    degrading types. Named mutations are the paved shape.
20. Argument normalization refuses `undefined` optional fields.
21. Transport `clientMutationId` vs application intent ID vs fixture ID.
    Recurring from 0.1.24.
22. `.take()` 1024 ceiling on 13 Familiar queries in M1.

### D. Live UI and realtime

23. \* No end-to-end latency timeline (Familiar M3's 50 minutes). LLP 0219 is
    the diagnostics channel.
24. Activity-presence publishes on every `touch()`. Leading-edge + idle-delete
    should be the composer recipe, or the helper should coalesce.
25. Unbounded live projections (500 messages × per-row lookups) until the 2s
    clock forced a bound.
26. Controlled composer re-rendering the thread.
27. Retained Stack screens → duplicate frozen testIDs + hidden subscriptions.
    Template `_layout` should be `Slot` on web, or a dev overlay should name
    duplicate IDs.
28. Six independent `useQuery`s under the documented contention shape;
    diagnostic still not application-visible.
29. Pending vs ready vs valid zero. Insights published `0` while loading.
30. Optimistic/queued/authoritative DOM identity (M4 edit locator).
31. Snapshot node ceiling — **route to LLP 0297**, including a pre-flight
    "this query is N nodes / limit M" inspector.
32. Mark-read on every message-length change → auth-suspended storm.
33. Fire-and-forget mutation + immediate navigation (M5 disappearing
    messages).

### E. Offline, scale, day-2

34. \* Familiar `offline_mutation_replay` vocabulary split.
35. Familiar `useMutation` is settled-only; queue-aware needs
    `useSnapbackMutation`.
36. \* No first-party headless scale adapter: dispose/re-auth, no live replica
    per actor, `clientMutationId: null`, paged keyset, acknowledge-or-drop
    results.
37. 1,024 retained mutation results on one-shot sequential replay. Same class
    as 0.1.24 at ~8k.
38. Growing per-actor synced public replica (Familiar scale).
39. Live-query before every scale mutation (first Familiar attempt, 2,251
    actions).
40. M7 handoff missing `personas.json` / instrument-relative paths.
41. Tighten auto-activated vs Guide "reviewed migration." Safe but surprising;
    no rollback path.
42. Expiry-driven derived counts need a scheduled job; Familiar cannot author
    it.
43. Warm-offline search as a second implementation beside the live query.
44. Protected query retention still opt-in (`retainable: true` / leases).

### F. Errors, diagnostics, docs mismatches

45. `SNAPBACK_HANDLER_FAILED` wrapping declared `ctx.refuse`.
46. `SNAPBACK_APP_REFUSAL` without `appCode` on Explicit headless (prior Clique;
    same family).
47. No client hint "if this is an application refusal, declare it."
48. Binding mismatch as a boot failure rather than wait-then-remediate.
49. Auth-client protocol header `x-snapback-auth-client-protocol: 1` required
    and easy to miss in a custom replay client.
50. Multi-persona `clientStoreId` + `rqsStore: null` required for headless;
    `SNAPBACK_OUTBOX_NOT_WRITER` otherwise.
51. Guide vs prompt generated-dir name.
52. `snapback guide --slice 0` refused (M7).
53. Handoff with no `node_modules`; `snapback guide` cannot run until `npm ci`.
54. Diagnostics B10 scores 44/39 — agents bisected by reading published
    `implementation.mjs`.

### G. Instrument and harness

55. 2s typing ceiling includes RN Web controlled-input time (LLP 0281).
56. Harness `fill()` of empty composer does not emit a text-change.
57. testID wrapper ≠ observable `src`.
58. Profile first-line is Edit, harness wants display name.
59. Copied choreography harness resolved fixtures outside the lane (Explicit
    M4).
60. No M7 choreography segment, so both lanes invented supplements.
61. Optional media-compose checks structurally undriveable.
62. Broad selector / poisoned page in Explicit M7 supplement.
63. Linux native evidence null while the prompt still says "attempt."

## Ideas that would change the next full pin

Not a new program. These are the ones this pair suggests would change cost
*shape* after LLP 0299/0301/0302/0297.

1. **Keep Clique on `--expo` now that 0299 exists.** Highest leverage remaining
   is qualification, not another port Spec. If the next published pin still
   forces external-client topology, 0299/0301 failed their Clique journey.
2. **Treat generated identity like CSS: invalidate, don't restart.** After
   codegen, Metro should drop hashed `app.descriptor.*` / `app.binding.*`. A
   stamp file in `snapback/generated/` that Metro watches is enough. Familiar
   M3 was a restart festival even after the right ephemeral API was in place.
3. **Ship `snapback replay` as a product.** Supported headless adapter: one
   client or a small pool, no live queries, `clientMutationId: null` (or
   acknowledge), dispose on actor switch, paged lookups, settle-before-next,
   JSONL receipts. That is 3 hours of Explicit wall, Familiar's scale failure,
   and a pile of M1 replay identity bugs. Clique should be a customer of this,
   not its inventor.
4. **A live "why is this late?" timeline on the LLP 0219 channel.** Spans:
   DOM input, mutation admit, outbox, server apply, invalidation, subscription
   delivery, React commit, node count vs ceiling. M3 would have been a
   10-minute memoization fix instead of a 50-minute presence rewrite.
5. **Capability vocabulary as a compiler error with a table.** One packed
   test: Familiar/Explicit `requiredCapabilities` ∩ generated target facts ∩
   binding offers ∩ client admission. `offline_mutation_replay` would have
   been a red generate, not an M7 localStorage queue.
6. **Don't fold declared refusals.** Already ticketed. Cheap relative to its
   cost: every negative auth assertion becomes string-matching nested
   envelopes.
7. **Compact benchmark I/O.** Structured choreography misses; generate
   advisory summaries. The agent should not ingest 500-message DOM.
8. **Split the Clique session, or compact at milestone boundaries.** Even with
   perfect Snapback, a 5-hour single turn will look like 100M+ input.
9. **Frozen kit: Slot layout, unique locators for pending vs settled, `img`
   testID on the node that owns `src`.** LLP 0281. Until it ships, every Clique
   run rediscovers them.
10. **A composer-shaped presence helper.** Current activity-presence is "touch
    renews forever." Chat wants "leading edge + idle delete + send withdraws."
11. **Result-size and subscription-count HUD.** Before
    `SNAPBACK_REACT_ARGS_INVALID` / overload degrade. Coordinate the node
    count with LLP 0297's profile split so the HUD names the *right* ceiling.
12. **Honest Familiar completion profile for Clique.** If cron and native
    offline replay stay Explicit-only, the Familiar prompt should not carry
    M8 schedule or native-queue obligations as if they were in-profile.
13. **Default the replay identities in generated clients.** Mint transport
    IDs; take application IDs as an arg. Stop making every custom client
    rediscover `SNAPBACK_AUTH_STALE_RESULT`.

The through-line is the same as LLP 0277's 0.1.24 matrix, stronger: Snapback's
product core felt good once it was on the path. The expensive work was leaving
the paved loop, then reconstructing lifecycle, identity, replay, and
observability by hand. After 0299, the remaining four that still change the
next 0.1.26 full run are generated-module freshness, first-party replay, live
latency/size diagnostics, and capability/refusal vocabulary parity.

## Routing

| Cluster | Owner |
| --- | --- |
| Supervised listener pinning, keep Clique on `--expo` | LLP 0299 (Implemented) + LLP 0301 qualification; no new Spec |
| URL-first / declared-dev binding / two-process templates | LLP 0300, 0301, 0302 |
| Node ceiling / catalog vs result identity | LLP 0297 |
| Familiar `offline_mutation_replay` authoring | `issues/20260824-familiar-offline-replay-capability-unathorable.md` |
| Declared refusal client codes | `issues/20260822-declared-refusal-client-code-preservation.md` (LLP 0144) |
| M7 handoff relocatability | `issues/20260822-m7-handoff-not-self-contained.md` |
| Six-subscription / auth-suspended overlay diagnostic | `issues/20260820-familiar-live-subscription-contention.md` |
| Instrument typing/selectors/media/poisoned retries | LLP 0281 + `issues/20260821-clique-instrument-observability-version-bump.md` |
| Generated-module Metro freshness | `issues/20260824-metro-generated-module-freshness.md` (filed 2026-08-24 after verifying the supervised path also performs no invalidation) |
| First-party headless replay helper | `issues/20260824-first-party-headless-replay-helper.md` (filed 2026-08-24; Spec owned under LLP 0043 / 0201; not folded into 0295 Phase 0) |
| Live latency/size timeline | LLP 0219 + 0295 move 5 |
| Cross-cutting authoring/lifecycle/efficiency program | LLP 0295 |
| Multi-run Clique/Coterie register | LLP 0277; this LLP is the 0.1.25 full-scope pair |
| Historical cross-model friction register | LLP 0236 |
| Familiar cron boundary | LLP 0253 (do not add Familiar cron in this document) |
| Migration tighten/rollback ceremony | LLP 0160 |

## Confidence

| Claim | Confidence | Why |
| --- | --- | --- |
| Both profiles reached receipt-backed web authoring-green for M1–M6/M8 and suite-backed M7 | High | Consolidated record plus retained suite/choreography receipts |
| Explicit completed 167,157 scale; Familiar stopped at 2,620 | High | Scale summaries and ledgers |
| Token totals and ~99% cache hit | High | Four `turn.completed` usage objects |
| Token *attribution* to a milestone | Low | One event per session; no per-milestone metering in this stream |
| Supervised Expo undeclared ports caused both lanes to leave `--expo` | High | Both run-logs plus source inspection of shipped `expo-dev.mjs` |
| Familiar M3 cost was render, not ephemeral transport | Medium | Diary/essay plus the memoization fix that greened the clock; N=1 |
| Familiar scale stop is a backend impossibility | Rejected | Record states capability-failure of the adapter topology |
| 0.1.25 is slower than 0.1.24 at M3 | Low | Different effort (`high` vs `xhigh`), N=1, different adapter quality |
| LLP 0299 removes the port tax on the next published pin | Medium | Spec is Implemented on `main`; this pair did not consume it |
| Chip-away ranking (ports, Metro freshness, replay helper, timeline) | Medium | Convergent with LLP 0277/0295; still one pair |

## Open questions

1. After LLP 0299, does `snapback dev --expo` with a Clique port range stay on
   the supervised path through M8, or do hashed generated modules / binding
   expiry still force an external-client topology?
2. Should `snapback replay` be a CLI verb, a published `@expo/snapback-acceptance`
   helper, or only a benchmark fixture? The 0.1.24 and 0.1.25 full pairs both
   invented it.
3. Does Familiar grow an authorable `offline_mutation_replay` requirement, or
   does Clique stop asking Familiar-only lanes for native durable queue
   replay?
4. Is the 2s typing observation boundary an instrument defect (LLP 0281), a
   product latency ceiling, or both? This pair spent ~50 minutes because it
   could not tell.
5. Should the next full pin require per-milestone token events as a run
   admission check, so session-totals cannot be compared as profile
   efficiency?

## Answered — 2026-08-25

The question this research posed — where the published-pair cost goes, and
whether the chip-away round would move it — was answered by the LLP 0307
capstone run against published 0.1.27 with per-milestone metering:
[`benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/record.md`](../benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/record.md).
Outcome in brief: Explicit M1 first-green halved; the scale-babysitting mode
(11,314 s here) was replaced by two bounded fail-closed recoveries plus a
fully-unattended 2:47:20 replay on the LLP 0307.000 surface; fresh M7 got
cheaper on every axis but first-green; and the `0.3.4-m8` instrument
(open question 4's resolution) caught a real removed-member live-delivery
leak in the Familiar arm that this run's weaker instrument had passed.
Open question 5's answer is implemented: per-milestone attribution existed
for every capstone figure. Remaining measurement work is tracked in
`issues/closed/20260825-metering-driver-full-journey-portability.md`.
