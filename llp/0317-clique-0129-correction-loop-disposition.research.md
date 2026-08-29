# LLP 0317: Clique 0.1.29 correction-loop disposition

**Type:** Research
**Status:** Review
**Systems:** Agent experience, Developer experience, Benchmarks, Guide,
Diagnostics, React/Expo, Local server lifecycle, Auth, Client integration,
Live queries, Assets, Code generation, Packaging, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-27
**Revised:** 2026-08-29 (r2.7: L19 prevention landed for O14 shape (d)'s
past-ceiling mechanism and O35's live-query half: typed refusal delivery,
fail-closed blanking, and no futile retry/resnapshot loop. See §Revision
history.)
**Revised:** 2026-08-29 (r2.6: Linux x86_64 reruns of L1 and L2 on
`expo-build-450b` against exact-current binaries. O10's empty projection closes
`not reproducible`; O14 (a) not reproducible on the headless arm, (b)/(c)
upgraded but still `inconclusive` pending the browser arm, (d) exact-179 not
reproducible, (d) past-ceiling confirmed on Linux. See §Revision history.)
**Revised:** 2026-08-28 (r4: §Scale tail's two routed questions answered — the
durable client-mutation ledger refuses durable-id mutation submission, not
reads, so the read blast radius is O13/C5's authoring coupling and raises C5 to
bundle 3; codegen should refuse `grants: true` over `public-immutable` delivery
(new **O54**) and should not sniff application view-once vocabulary. O43's read
half shipped as `guide/recipes/read-receipts.md`. See §Revision history.)
**Revised:** 2026-08-28 (r2.4: Wave 1 O14 harness and scoped verdict landed.
The reported invalidation shapes remain inconclusive; the past-1,024 arm
confirmed a bound-refusal/quarantine mechanism rather than a matcher miss. See
§Revision history.)
**Revised:** 2026-08-28 (r2.2: Wave 1 L4 verdicts landed. O29 confirmed on
a clean, source-relevant runtime with its restart-not-reset mechanism pinned;
O35's asset half closed as not reproducible with byte-stability evidence. See
§Revision history.)
**Revised:** 2026-08-28 (r2: super-refine round 1. Evidence base corrected
from four lanes to all eight Snapback lanes in the matrix; F2 narrowed; O10
and O12 re-diagnosed against published 0.1.29; N5 and N16 corrected; rows
O31–O46 and N18–N20 added. See §Revision history.)
**Related:** LLP 0061, LLP 0186, LLP 0193, LLP 0196, LLP 0198, LLP 0200,
LLP 0201, LLP 0208, LLP 0219, LLP 0253, LLP 0295, LLP 0310, LLP 0310.000,
LLP 0316, `diaries/0114-clique-published-0129-matrix.diary.md`,
`benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md`,
`issues/20260825-clock-dependent-visibility-authoring-friction.md`,
`issues/closed/20260827-defineauth-successor-silent-refusal.md`,
`issues/20260827-live-query-cross-client-fanout-staleness.md`,
`issues/20260827-media-collection-capability-skew-published-runtime.md`,
`issues/20260827-snapback-expo-metro-generations-watcher-crash.md`

## Summary

The 2026-08-27 Clique matrix ran **eight autonomous Snapback lanes** — four
models (`gpt-5.6-sol`, `grok-4.6`, `gpt-5.6-terra`, `GLM-5.3-flash`) across the
Explicit and Familiar authoring profiles — against published Snapback 0.1.29.
They exposed the difference between *eventual completion* and a one-shot paved
authoring loop. This document inventories every distinct correction cause found
in those lanes' diaries and, where needed to recover the exact event, their run
logs, essays, and final reports. Repeated retries with the same cause are folded
into one row.

The inventory has exactly the three dispositions requested by the author:

1. **Fixed or plausibly fixed** — current `main` contains a product, guide, or
   diagnostic change aimed at the observed cause. These rows still need a
   published rerun before they become proven closure.
2. **Not a Snapback problem** — benchmark-instrument, renderer-contract,
   host-environment, or ordinary application/test mistakes for which changing
   Snapback would be the wrong response.
3. **Snapback prevention backlog** — everything else. This includes genuine
   defects, subpar surfaces, missing diagnostics, missing recipes, and
   correctly refused mistakes that a strong agent should have been guided away
   from before spending a correction loop.

The dominant open clusters are client authority/custody, reactive-read
causality, media path coherence, mutation settlement across navigation,
Explicit/Familiar grammar discoverability, **Familiar-profile parity**, and
end-to-end application recipes. The lesson is not merely to fix thrown errors.
Per LLP 0310's author standard, when a capable agent repeatedly chooses a wrong
shape, the product should ask what made that shape natural and cheaply prevent
it.

## Scope and method

### Included evidence

This document's evidence base is **all eight Snapback lane cells** of the
matrix, whose diaries, run logs, essays, and score files are retained in the
repository at:

```text
benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/
  sol-snapback-explicit/    sol-snapback-familiar/
  grok-snapback-explicit/   grok-snapback-familiar/
  terra-snapback-explicit/  terra-snapback-familiar/
  glm-snapback-explicit/    glm-snapback-familiar/
```

Live copies of the four lanes that ran on `expo-build-450b` also remain under
`/home/ccheever/clique-matrix-0129/lanes/`; the `sol-snapback-explicit`
copy there is still growing (see §Exclusions).

For each lane this pass read `diary.md`; it used `run-log.md`, `essay.md`,
`scores.json`, and `final-report.md` to distinguish a root cause from the
model's workaround or a later retry artifact.

Lane depth is uneven, and the inventory weights it accordingly:

| Lane | Model | Depth reached | Weight in this inventory |
|---|---|---|---|
| `sol-snapback-explicit` | gpt-5.6-sol @ xhigh | **M1–M8 all green (7/8; M7 not run in any lane) + scale tail, sealed 2026-08-28T04:35Z** | Richest single source, and the deepest scored Snapback lane in the matrix |
| `grok-snapback-explicit` | grok-4.6 @ xhigh | M1–M4 green, M5/M6/M8 partial (4/8) | Second richest |
| `sol-snapback-familiar` | gpt-5.6-sol @ xhigh | M1–M2 green, M3 instrument abort (2/8) | Rich on realtime/custody |
| `grok-snapback-familiar` | grok-4.6 @ xhigh | M1–M2 green, M3+ partial (2/8) | Rich on Familiar parity |
| `glm-snapback-explicit` | GLM-5.3-flash | M1 green, then OpenCode harness hang | One milestone, precise |
| `glm-snapback-familiar` | GLM-5.3-flash | M1 green, then OpenCode harness hang | One milestone, precise |
| `terra-snapback-explicit` | gpt-5.6-terra @ medium | Premature stop at 220 s | Non-signal (see N16) |
| `terra-snapback-familiar` | gpt-5.6-terra @ medium | Premature stop at 348 s | Non-signal (see N16) |

This is qualitative N=1-per-cell existence evidence under LLP 0201, not a
frequency or magnitude claim. Where a cause appears in more than one lane the
row says so, because cross-lane recurrence is the strongest available signal
that a surface — not a model — is at fault.

Lane self-attribution is evidence, not the final disposition. A row labeled
`agent-error` remains a Snapback prevention item when a type, diagnostic,
template, or guide sentence could cheaply have prevented it. Conversely, a row
the lane labeled `snapback-defect` is moved out when Snapback is not the owner
(N14 is the worked example).

### Exclusions and cutoff

- ~~The `sol-snapback-explicit` scale replay is still running.~~ **Sealed
  2026-08-28T04:35Z after 8 h 46 m and classified in §Scale tail.** The lane
  reached M1–M8 green (58/58 suite-owned assertions, 33/33 implemented required
  choreography checks) and its O5 replay settled 103,355 of 167,157 actions with
  **0 failed fixture actions** before exhausting a 14,400 s cap.
- The `glm-snapback-explicit` and `glm-snapback-familiar` lanes stalled on
  OpenCode harness hangs after M1. Their M1 evidence is inventoried; their
  absence of later evidence is not read as a Snapback fact.
- Native iOS/Xcode/Hermes legs were environment-null on Linux and made no
  Snapback capability claim.
- Repeated frozen-choreography attempts are collapsed to the underlying cause.
- A workaround becoming green does not prove that the underlying Snapback
  issue is fixed.

### Disposition standard

`Fixed or plausibly fixed` means a directly relevant change is present on
`origin/main` as of 2026-08-28. It does **not** mean that change is published,
that the exact matrix has rerun, or that every existing app inherits a template
change. `Not a Snapback problem` means Snapback should not change to accommodate
the incident; another owner may still owe work. All uncertain cases go to the
prevention backlog rather than being dismissed.

Where this document names a repair that *already exists in the version the lane
ran*, the row is a **misdiagnosis** and says so: the observed failure is real,
but its stated cause is not, and it needs a focused reproduction before anyone
implements against it. O10 and O12 are the two such rows.

## 1. Fixed or plausibly fixed

| ID | Observed correction cause | Evidence and present disposition | Closure still owed |
|---|---|---|---|
| F1 | Metro's fallback watcher raced `.snapback/generations/.tmp-*`, crashed with `ENOENT`, and caused `SNAPBACK_EXPO_METRO_EXITED` in both sol profiles. | Commit `21684e9cc` adds a `.snapback/generations` block-list rule to the `expo-chat` and `media-feed` Metro templates — the only two CLI templates that carry a Metro config, so template coverage is complete. This directly implements the workaround both lanes discovered. | Publish the template change; scaffold both templates from the published version; prove repeated schema/function successors do not kill Metro. **Corrected 2026-08-28:** the *codegen publication staging* half of the root cause already landed — `codegenPublicationStagingPaths` writes to a sibling of the project root, outside the watched tree, and `issues/closed/20260825-metro-exit-on-codegen-tmp.md` is closed. What remains in-tree is the `.snapback/generations` backend artifact directory, mitigated only by these two template block-lists, so any app not built from them, any other bundler, and every existing app are potentially exposed unless they exclude the path independently. Move those transients out as the staging path already moved, or make the write pattern non-racing, and keep a retrofit note in the guide/ticket. Reconcile the still-open ticket metadata. |
| F2 | **Narrowed in r2.** Multiple Node/headless personas implicitly shared the default durable auth partition, restored one principal, and produced outbox identity/writer refusals. | Commits `a6ab002e0` and `2b1bb1f15` **retarget and qualify** the pre-existing `SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE` warning and multi-persona recipe (both originated in `94e1c1fff` / `144e4c9cf`), add live-query routing and retrieval evaluation. The Node/headless mechanism is real and repaired: `sol-snapback-explicit` `1787853600`→`1787853610`. | Rerun a two-persona fixture and prove the warning fires before misleading product assertions. **This row no longer claims shared custody as the dominant cause of the matrix's broad fanout report.** The warning is Node-gated by construction (`packages/snapback-client/app-client.mjs`: it returns unless `typeof globalThis.process?.versions?.node === 'string'`), so it cannot fire for a browser client, and the broadest fanout evidence is from Playwright browser contexts. The residual now lives in O14, widened. |
| F3 | `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY` stopped protected time-windowed and typing-lease live queries; the lane moved expiry projection client-side. Corroborated in `grok-snapback-familiar` M5. | The time-windowed-read recipe now covers load-pinned clocks, server-authored row times, lease expiry, refresh boundaries, range scans, and busy windows (`0b9d7e9e7`, `f3cde9050`, `8f6c21494`). | Verify the served 0.1.30-or-later guide routes the exact typing query to the recipe. **The heavier primitive question stays open in `issues/20260825-clock-dependent-visibility-authoring-friction.md`, not in O15** — O15 is about causal subscription diagnostics, which is a different problem. `grok-snapback-familiar` states the primitive gap precisely: "query results cannot depend on `RuntimeNow`, so disappearing expiry cannot be a server query filter without a scheduled purge." The recipe is also Explicit-shaped; see O32. |

These are the only rows this revision treats as already addressed. In
particular, a precise refusal in the 0.1.29 lane is not called fixed merely
because the agent eventually understood it.

## 2. Not a Snapback problem

### Benchmark, harness, and ordinary test mistakes

| ID | Correction cause | Why it is out of Snapback scope | Proper owner/action |
|---|---|---|---|
| N1 | Models guessed obsolete or nonexistent instrument, UI-kit, fixture, and choreography paths before resolving the checked-in files. | These are benchmark packet paths, not Snapback APIs. | Instrument packet/index and runner preflight. |
| N2 | A shared placeholder password overrode the four fixture personas' distinct credentials. | Harness invocation error. | Benchmark launcher should validate persona credential completeness. |
| N3 | A helper dereferenced an actor wrapper as the raw app client; another test expected an internal actor label rather than the server display name; another used `dm-alice-bob` instead of canonical `d-alice-bob`. | Ordinary acceptance-code bugs with authoritative fixtures available. | Benchmark test code. |
| N4 | Tests assumed exactly nine total group messages after choreography had legitimately added messages, or allowed retained high-like posts to displace the intended Trending tie rows. | Retained-state and test-isolation mistakes. | Assertions should bind exact fixture identities and run-scoped facts. |
| N5 | Browser proofs sampled before React mounted, expected a deep link to survive login, started from a route that retained an inactive stack entry, targeted the wrong quote ancestor, selected duplicate inactive bubbles, or read reply order before the reply rendered. | Playwright/Router test construction errors, not backend behavior. **Narrowed in r2:** the reload-after-sign-in event previously folded here is not one of these; it is now O46. | Choreography readiness and locator design. |
| N6 | Feed/follow/like/repost tests failed to traverse pagination, acted before profile state hydrated, or targeted old retained rows rather than retry-safe current fixtures. | Application/test observation mistakes. | Benchmark assertion helpers. |
| N7 | The M3 starter already added Dave, one check computed aggregate-read without Dave, and the next check required Dave to be addable. | The frozen instrument contradicted its own send-time-recipient invariant. Sol Familiar correctly aborted instead of falsifying product behavior. `grok-snapback-familiar` M3 hit the same contradiction independently. | Fix and version the Clique instrument; preflight starter state against choreography preconditions. This contradiction cost `sol-snapback-familiar` its entire M4–M8 remainder. |
| N18 | The lane packet asked for a `_generated/` directory; published 0.1.29 refuses that alias and requires `snapback/generated`. Hit by `sol-snapback-familiar` (`1787853002`) and `grok-snapback-familiar` M1. | The product spelling is correct and documented; the benchmark packet carried the wrong one. | Fix the instrument packet. Tracked separately as a guide papercut in `issues/20260825-guide-gap-generated-directory-spelling.md`. |
| N19 | A profile-creation UI showed a generic refusal instead of the declared `HANDLE_TAKEN` application code, repaired with `projectAppRefusal` (`sol-snapback-familiar` `1787853539`). | `projectAppRefusal` exists, is exported, and the lane found it from the served guide in one lookup. This is an ordinary application wiring step, not a missing surface. | No product change. Consider one line in the template's error path so the shape is copied rather than discovered. |

### Renderer and frozen-UI contract mismatches

| ID | Correction cause | Why it is out of Snapback scope | Proper owner/action |
|---|---|---|---|
| N8 | React Native Web dropped the frozen kit's `accessibilityValue`/selected semantics and represented images as CSS-background descendants. Hit by all four deep lanes. | Renderer-to-instrument semantic mismatch. Snapback neither owns React Native Web nor the frozen kit contract. | Social UI kit or choreography should provide/test a web adapter. **But** four independent lanes each rebuilt the same web semantic bridge, and `sol-snapback-familiar` asked for "a renderer-compatibility warning for dropped accessibility values." One sentence in the Expo start packet naming this RNW behaviour is cheap and is owed even though the defect is not Snapback's — see O44. |
| N9 | Expo Router retained inactive screens, creating duplicate hidden composers and message bubbles that confused global locators. | Router rendering plus unscoped harness locators. | App/harness route scoping; do not change Snapback data semantics. |
| N10 | The kit placed reaction chips beside the bubble while the harness required them below it; the background preview put observable state on a descendant while the harness inspected its root. | Frozen UI and frozen observer disagreed structurally. | Align the kit and benchmark contract. |
| N11 | Re-selecting identical fixture image bytes yielded identical observable state until the app versioned the URI. | Retry-observability artifact in the fixture/UI contract. | Instrument should provide distinct selections or compare authoritative state. |

### Host, tool-safety, and lane-execution facts

| ID | Correction cause | Why it is out of Snapback scope | Proper owner/action |
|---|---|---|---|
| N12 | The vendored read-only UI kit could not materialize its own `node_modules`; the frozen choreography directory was read-only and had to be mirrored. | Instrument packaging/permissions issue. | Materialize dependencies before freezing or provide a writable lane-local copy. |
| N13 | A combined adoption command attempted recursive deletion and was refused by the agent safety layer. | Correct tool-safety behavior. | Agent should use a recoverable copy/move, as it did. |
| N14 | React Native DevTools could not launch Chrome because of Linux SUID sandbox ownership/mode. The lane tagged this `snapback-defect`; that attribution is overridden here. | Optional host-tool setup; Metro and the product stayed ready. | Host image or React Native DevTools packaging. |
| N15 | Linux had no iOS Simulator, Xcode, or Hermes export environment. | Registered environment-null leg, not a failure. | Run native evidence on a qualified macOS host. |
| N16 | **Corrected in r2.** Both terra lanes stopped after **220 s** (explicit) and **348 s** (familiar) with M1 `capability-failure` and everything downstream `blocked-by-M1`. The earlier claim that Terra Explicit ran "until its time budget expired" is wrong. | `gpt-5.6-terra` @ medium self-aborted almost immediately in all five of its matrix cells. The matrix record classifies every terra lane **`premature-stop, non-signal`** and excludes them from capability reads. | Model/harness outcome, not a product refusal. Their one usable contribution is corroboration for O22 and O5; do not read their scores as Snapback evidence. |
| N17 | Invalid staging name `.scaffold` was immediately and accurately refused; the model retried with `clique-app`. Terra Explicit separately had `npm create snapback-app` refuse an existing lane target and guessed a nonexistent `expo-router` template before selecting the documented `expo-chat`. | The bad inputs were cheap, local, and self-explanatory. | No product change for the staging name. The guessed template name argues for the start packet naming the available templates — folded into O1. |
| N20 | Three glm lanes and one glm cell never produced post-M1 evidence because the OpenCode harness hung. | Harness/runner fault outside Snapback. | Benchmark runner; do not read glm silence as a Snapback fact. |
| N21 | A scale entry at `1787873091` is self-tagged `snapback-defect` but records the system behaving **correctly**: the owned lifecycle closed through `q`, the same preserved database reopened, durable retention survived the restart, minted custody stayed refused, and no reset or reseed occurred. | A lane tag is evidence, not a disposition (§Scope and method). This one is a mistag, and counting it would inflate the defect tally with a success. | No action. Recorded so the scale phase's seven self-tagged defects are not read as seven defects. |
| ~~N22~~ | *Withdrawn in review — this is first-party, see O52.* | | |

## 3. Snapback prevention backlog

This group is intentionally broad. Some rows are bugs. Some are correct safety
boundaries whose paved spelling was not discoverable early enough. Some are
application mistakes that repeated because Snapback lacks an end-to-end recipe.
Every row asks for the cheapest intervention that makes the next strong agent
avoid the loop. **Lane counts are given where a cause recurred**, because
recurrence across independent models is the strongest signal available.

### Setup, templates, and lifecycle

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O1 | Sol Familiar first looked for unscoped `snapback@0.1.29`; Sol Explicit guessed an incompatible Expo Router major; Terra Explicit guessed a nonexistent `expo-router` template name. | Published package family, Expo tuple, and available template names should be generated facts, not registry archaeology. | Scaffold owns all compatible pins; start packet names scoped packages **and enumerates the templates**; diagnostic for mixed Expo tuple. |
| O2 | Both sol lanes **and `grok-snapback-explicit`** started supervised Expo with some default ports outside their assigned block because `--port-range` was omitted (grok: "Metro's inner port escaped 4287–4387 until `--port-range 48100-48119`"). *3 lanes.* | A primary lifecycle should not silently escape an otherwise explicit backend/client/bootstrap allocation. | Make a declared range encompass every child by default, or warn/refuse when explicit child pins and the implicit Metro range disagree; put the complete command in the start packet. |
| O3 | Explicit auth required two codegen loops: `externalSessionEntry: false` is invalid, and disabled auth still needs `guestPolicy: {enabled:false}`. Familiar needed unprompted policy metadata (`CODEGEN_POLICY_INVALID`) and fixed `durable-required` custody. **`grok-snapback-familiar` independently:** "the familiar-profile page never showed a complete password `defineAuth` example; `entryMechanisms: []` until we copied the explicit program." *3 lanes.* | These are minimal-password-app basics. Types and a focused example should make the only valid minimal shape obvious before generate. | Add a copyable minimal password-only `defineAuth` example **on the familiar-profile page as well as the explicit one**, improve optional-true typing, generate disabled defaults where safe. Route the broad module-evaluation code and `CODEGEN_POLICY_INVALID` to exact field recipes — `CODEGEN_POLICY_INVALID` currently has **no** guide page at all. |
| O4 | Replacing the scaffold seed required `SNAPBACK_SEED_MIGRATION_REQUIRED` and a reset before M1. | The refusal is correct, but template-to-real-app transition should be anticipated. | Start packet should say when the starter seed becomes active and offer a one-command pre-data replacement/reset path with an explicit preservation warning. |
| O5 | Terra Familiar activated an Explicit template store, converted source profiles, generated a Familiar manifest, then never received application readiness; destructive reset was forbidden. **Root cause identified in r2 (see O31): there is no Familiar template, so every Familiar app must begin as an Explicit one and convert.** | Cross-profile local adoption is not an exotic path — it is currently the *only* path to a Familiar app, and it must either succeed as a successor or fail loudly with a repair. | Reproduce the exact Explicit→Familiar transition; add a coded successor-status diagnostic and a profile-conversion/reset recipe. Do not leave a live parent with no application-ready conclusion. Shipping O31 removes most of the need for this path. |
| O6 | Sol Explicit's sole supervised owner and all children disappeared during M2 hot reload (`1787854310`) with the database preserved and no causal terminal receipt — no `ENOENT`, no closure receipt, distinct from and earlier than the first named Metro crash at `1787854616`. | Even if distinct from the fixed Metro race, unexplained owner loss is a dev-loop defect/observability gap. | Correlate owner/Metro/backend exit cause in the closure receipt; add preserved-store restart guidance and a focused reproduction. **Check O33 first** — `generate` removing the application-ready receipt mid-lifecycle is a newly identified mechanism that could explain this event. |
| O7 | An authenticated warm web app taken offline at `DOMContentLoaded` rendered terminal `SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE`; the documented cached binding was absent and online recovery did not occur. `grok-snapback-explicit` M3 needed the same shape: "a layout-level network-recovery reload so Bob could `markDelivered`." *2 lanes.* | This contradicts the paved supervised cold/offline boot story. | Reproduce against current main, fix binding cache/reconnect if confirmed, and add an acceptance case for warm-auth offline boot followed by online recovery. |
| O8 | Obsolete template screens remained in the TypeScript include set after the lane replaced the starter schema. | Template extension should not make dead starter code an ambient compilation liability. | Narrow template includes, separate optional starter screens, or provide a generated removal checklist. |
| O31 | **New in r2.** There is no Familiar-native template. `glm-snapback-familiar`: "a Familiar-native starter (the packaged template is explicit-profile only)." Every Familiar lane therefore scaffolded an Explicit template and converted it by hand; that conversion is exactly what killed `terra-snapback-familiar` (O5). *All 4 Familiar lanes.* | A first-class authoring profile with no starter is not a paved path. The conversion step is unpaved, destructive-adjacent, and is the single largest Familiar-profile setup cost in the matrix. | Ship a Familiar template (`expo-chat-familiar` or a `--profile familiar` flag on the existing templates) so a Familiar app never has to begin as an Explicit one. |
| O32 | **New in r2.** Guide pages outside `backend/familiar-profile.md` show Explicit-profile examples only. `glm-snapback-familiar`: "assets/grants/membership pages all show explicit-profile examples, so every media decision required translation." `grok-snapback-familiar` echoes it for conversation media, offline queues, clock-dependent visibility, and 7-day bucket math. *2 lanes, 4 topics.* | Familiar authors pay a translation tax on every recipe outside one page. That is a parity gap, not a documentation nicety. | Decide and record a Familiar-parity policy for the guide: either dual-profile snippets on every recipe page, or a generated Familiar transliteration, or an explicit scoped statement of which pages are Explicit-only. F3's own recipe is subject to this. |
| O33 | **New in r2.** `snapback generate` removes the application-ready receipt mid-lifecycle and breaks Expo bootstrap until it is reminted. `grok-snapback-familiar` M4: "Expo bootstrap exchange going 503 whenever `application-ready` vanished mid-generate"; M6: "Application-ready file deleted during generate broke Expo boot until remint"; M5: "Bootstrap remint after generate." *3 sightings, 1 lane.* | The receipt is the client's boot contract. Deleting it during a routine codegen turns an ordinary edit into a boot failure with a 503 and no explanation. | Make the receipt update atomic (write-new-then-swap) rather than delete-then-write, or hold the previous receipt valid until the successor is ready; emit a coded diagnostic if a client boots during the window. Test against O6. |
| O37 | **New in r2.** Supervised `snapback dev` dies when its stdin pipe reaches EOF; the start packet does not say so. `grok-snapback-explicit` M1: "supervised Expo web wants stdin detached or the owner dies on pipe EOF … the start packet never says `snapback dev` over a pipe EOF stops the owner." | Every non-interactive agent runs commands over a pipe. A lifecycle that silently dies under the default agent invocation is a first-contact trap. | Either keep the owner alive when stdin closes (or require an explicit `--control-channel`), or refuse loudly at startup naming the fix. Put the non-interactive invocation in the start packet. Reconcile with `issues/20260825-dev-control-channel-requires-stdin.md`. |
| O38 | **New in r2.** A `babel.config.js` under `"type": "module"` breaks the Metro transformer until renamed `.cjs`. `grok-snapback-explicit` M1 and `grok-snapback-familiar` M1. *2 lanes.* | The scaffold produces the package.json; the scaffold should produce a transformer config that works with it. | Emit `babel.config.cjs` from the templates, or set `"type"` so the pair is consistent, and add a diagnostic mapping the Metro transformer error to this cause. |

### Explicit/Familiar grammar and diagnostics

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O9 | Inline handlers repeatedly refused natural JavaScript: computed array access for pagination and result correlation, computed `uniqueMany` association (`1787867160`), and module-level free identifiers (`grok-snapback-explicit`: "`HANDLE_RE` as a const is refused"). *2 lanes.* | Repetition across independent features and models means the dialect's admitted replacement is not natural enough. | Diagnostic must show a compilable `for...of`/ID-carrying rewrite; add a linter/code action and put the restriction in the first handler packet. Reconcile with `issues/20260826-inline-handler-free-identifier-recovery.md`. |
| O10 | **Re-diagnosed in r2.** Reads used `take(1,200)`/`take(2,048)` above the 1,024 ceiling — that part stands. The lane then attributed one empty history page to a runtime `take(limit)` and repaired it with a fixed bound plus slicing (`1787864590`). **The stated cause is wrong:** published 0.1.29 types `take(limit: number)`, its codegen admits non-literal bounds, and `8f6c21494` — one of F3's own cited commits — ships a guide example using `.take(args.limit)`. The previous recommendation to "refuse dynamic `take` at generate time" would have broken a supported, documented shape and contradicted F3. | A numeric ceiling can be type/diagnostic-visible. But the empty-projection event has no established cause. | Expose generated maximums and name the 1,024 ceiling with a fixed-bound-then-slice repair where the ceiling is the issue. **Reproduced 2026-08-28 (lane L2): verdict `inconclusive`, record in `issues/closed/20260828-l2-dynamic-take-verdict.md`.** A 16-cell matrix through the native runtime found no empty projection from any positive runtime bound — 14 runtime-reachable cells passed 10 consecutive runs, and the only empty results came from `take(0)` or a range matching no rows. That is not yet a negative: it ran macOS arm64 against a binary that is not an ancestor of the tested checkout, while the lane ran Linux x86_64 on published 0.1.29, so P1's platform bar is unmet. **Do not remove the API shape on this evidence, and do not close the row.** The lane also found a real gap in passing: the CI test covering F3's `.take(args.limit)` recipe exercises it through a `createHandlerHarness()` query-builder **double**, not the native runtime, so the documented example was never proven end to end. A `--runtime-matrix` mode now supplies that proof. **Settled 2026-08-29: the empty-projection obligation is `not reproducible`.** The same `--runtime-matrix` ran on `expo-build-450b` (Linux x86_64) against a binary built from the clean `6edfe7a45` checkout: 14 runtime cells × 10 consecutive runs pass, exit 0 (record and verbatim output appended to the L2 closed record). That meets P1 on current `main` and the reported platform; the obligation closes as terminal under LLP 0317.000 §Measurement. The ceiling half (L15) and the API-shape instruction are unchanged. |
| O11 | A one-record Explicit JS query returned an object instead of a rows array. | The surface looks scalar-shaped but the runtime requires records. | Generated signature/example should make `[{...}]` unavoidable; diagnostic should include the exact one-row pattern. |
| O12 | **Re-diagnosed in r2.** The lane repeatedly added aliases and assertions because `ctx.refuse()` did not narrow nullable TypeScript results (`1787853979`, `1787856034`). **The proposed repair already shipped:** `refuse(code, details?): never` is the declared type in **published 0.1.29's** `@expo/snapback-codegen/ctx.d.mts` (lines 313 and 371), verified against the registry tarball, and Familiar contexts derive from it. | Familiar code should preserve familiar control-flow narrowing — and by declaration it already does, so something else defeated it. | Do **not** implement "type `ctx.refuse` as `never`"; it is already true. **Reproduced 2026-08-28 (lane L3): verdict `confirmed`, record in `issues/closed/20260828-l3-refuse-narrowing-verdict.md`, pinned 0.1.29 fixture in `tests/fixtures/familiar-refuse-narrowing-0.1.29/`.** The cause is TypeScript's **explicit-call-target rule** (microsoft/TypeScript#32695): a top-level `never`-returning call only terminates control flow when *every identifier in the dotted target has an explicit type*, and the handler's `ctx` parameter is unannotated. A bare `if (!row) ctx.refuse('X'); return row.field;` produces TS18047 in 10/10 runs against published 0.1.29 declarations; `return ctx.refuse(...)`, `row ?? ctx.refuse(...)`, and an explicitly typed `ctx` all narrow. Review corrected the first diagnosis, which had called this a contextual-callback limitation: a non-contextual `const ctx = acquire()` fails identically. **So the fix is a guide sentence plus a lint, not a type change** — the same rule explains the helper-wrapper trap, where an expression-bodied arrow calling only `ctx.refuse` still needs an explicit `(...) => never`. |
| O13 | Structured IDs inside arrays, `v.media` in anonymous results, unsupported `minItems`, one-member literal/union shapes, ambient `Date`, and empty-write read-model mutations each forced separate generate loops. `grok-snapback-familiar` adds `v.union([v.null(), v.string()])` being opaque JSON and unindexable; `grok-snapback-explicit` adds `recipientIds` degraded to a CSV string; the `Date` refusal recurs in `grok-snapback-familiar` M5/M8. *3 lanes.* (The computed `uniqueMany` case moved to O9, where it belongs.) | Each refusal may be principled, but together they make ordinary code a grammar-discovery exercise. | Build an "ordinary TypeScript → admitted Snapback spelling" diagnostic table with executable snippets; improve types to reject impossible validator shapes before codegen; consider a first-class read model/action result that does not lie about writes. |
| O39 | **New in r2.** Elevated reads are refused in helper modules and on inline handlers. `glm-snapback-familiar` M1: "elevated reads can't hide in helper modules"; `grok-snapback-explicit` M8: "`defineJsQuery elevatedReads` refused on inline handlers." *2 lanes.* | The composition rule is defensible; discovering it by refusal after structuring the code around helpers is not. | State the elevated-read placement rule in the handler packet with the admitted shape; make the diagnostic name the module boundary it objected to. |
| O40 | **New in r2.** `ctx.db.patch` is table-first; the row-id-only spelling yields `SNAPBACK_UNKNOWN_TABLE`. `glm-snapback-explicit` M1. | A generated ID carries its table; a patch taking only that ID is the shape an author expects, and the failure names a missing table rather than the wrong arity. | Either accept the row-id-only spelling, or make the diagnostic say "patch is table-first; call `ctx.db.patch(table, id, …)`" instead of reporting an unknown table. |
| O41 | **New in r2.** Result contracts require `null` rather than absence for optional fields, and asset fields require `ctx.assets.attach` rather than a raw id. `grok-snapback-familiar` M1: "optional asset fields still must serialize as `null`" — "learned from a runtime refusal, not the Guide"; M3: "result-contract `requiredField` on optional document columns." | Null-vs-absent is the classic serialization trap, and here it is learned at runtime after the contract is written. | Make the generated result type reject the absent-field shape at compile time, and document null-vs-optional on the result-contract page with both profiles. |

### Live queries, authority, and client custody

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O14 | **Widened in r2; Wave 1 verdict 2026-08-28.** Committed rows were visible to one-shot reads but did not wake already-subscribed live queries, in three distinct shapes: (a) child-row reaction inserts/patches woke neither the encompassing JS query nor a dedicated declarative subscription (`sol-snapback-explicit` `1787860576`/`1787861040`); (b) a settled mutation was absent from the **same** client's live hook for 3 s and present after a fresh query (`sol-snapback-familiar` `1787857038`, `manual-playwright`); (c) cross-client fanout stayed stale under two Playwright contexts **while the same-client projection updated** (`sol-snapback-familiar` `1787857472`). `grok-snapback-explicit` M3 adds (d): an unscoped `allMessages` live query "went silent" on a 179-row thread. `grok-snapback-familiar` M3 adds receipt ticks never advancing to `delivered`. *4 lanes.* The rebuilt harness disables polling fallback and binds every pass, by timestamp, to an expected-result authoritative frame on the unchanged subscription while the socket stays attached and no `resubscribed` receipt fires. On 10 fresh servers per shape using the supplied clean `4d4ce40bd9b3921a88d37063b47693923ca8c1d3` runtime: **(a) inconclusive** — 10/10 distinct-persona/distinct-partition passes by `live_delta` in 28–55 ms; **(b) inconclusive** — 10/10 own-write passes by `live_delta` in 32–63 ms, with the row absent when the mutation settled in every run; **(c) inconclusive** — 10/10 insert-and-patch passes for the nested, child-list, and direct-point subscriptions, with nested witnessed snapshots in 83–227 ms and direct controls in 168–1,227 ms; **(d) split verdict** — the reported exact-179 state is **inconclusive** after 10/10 authoritative snapshots in 93–171 ms, while the past-ceiling arm is **confirmed on that runtime in 10/10 runs**. At 1,023 rows the original subscription established; the commit to 1,025 settled and a bounded latest-row query saw 1,025, but the original id/version/socket remained unchanged with no `resubscribed` event and no successor snapshot. The mechanism is not a matcher miss: rerunning unbounded `collect()` raises `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`; `fail_subscription_fanout_with_retry` publishes a `Quarantine` authorization obligation with `snapshot: None`; the client applies `authorization_quarantine` and blanks the held rows. **L19 prevention landed 2026-08-28:** the same unchanged subscription now receives the typed refusal, 1,024 bound, and repair while rows remain fail-closed blank; deterministic refusal bypasses the retry episode, and the harness still rejects the pre-fix silence. | The withdrawn shared-partition explanation still cannot explain the lane evidence. Scope is binding: these were headless, browser-shaped clients on macOS arm64, not the lanes' two real browser contexts on Linux x86_64 against published 0.1.29. The supplied clean binary is also not this checkout's `cb257cbb4641c254483bf9676f73b36c6b726b92`; the harness's strict direct `health.binary` gate refused that mismatch, and the campaign used the explicit development-only override. Shape (c) additionally surfaced sibling-scope `SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID` callback noise on its multiplexed connection; because every target subscription still received its authoritative frame and the server binary is mismatched, that is disclosed here as a limitation, not classified as an O14 staleness mechanism. | Therefore no headless pass earns **not reproducible**, and the general invalidation question stays open pending an exact-current binary plus the reported browser/platform shapes (and ≥10 consecutive passes for any negative verdict). Shape (d)'s confirmed past-ceiling mechanism has prevention landed under L19 with focused engine/client/React coverage and the strict original-subscription harness; this does not repair or close shapes (a)–(c). Correct the three sibling artifacts only after that browser evidence resolves the residual. **Linux x86_64 rerun, 2026-08-29** (record `issues/closed/20260829-l1-live-query-invalidation-linux-verdict.md`): the landed harness could not run shapes (a)–(c) at all — a destructuring default read `rowsMatch` before it was bound — so the r2.4 10/10 figures for those shapes are not reproducible from the repository; fixed in `8b332808f`. On `expo-build-450b` against a clean binary built from `8b332808f`, ten fresh servers per shape: **(a) not reproducible** on the headless arm the lane used (10/10 `live_delta` in 32–42 ms); **(b) and (c) inconclusive, upgraded** — platform and binary now match and both pass 10/10 (30–40 ms own-write; nested 93–144 ms), but their reported arm is a real browser, filed as `issues/20260829-o14-real-browser-arm-harness.md`; **(d) exact-179 not reproducible** (10/10); **(d) past-ceiling confirmed** on Linux 10/10, the same quarantine-without-snapshot mechanism, now owned by lane L19 (`issues/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`). **Landed and proven on both platforms, 2026-08-29:** L19 landed as `9f7eb7f5d`; the shape (d) acceptance then passed 10/10 checkout-bound on macOS arm64 and on Linux x86_64 (`issues/closed/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`). Shapes (a)–(c) are unaffected. |
| O15 | Agents could not trace hook → authority generation → commit → invalidation publication → subscriber revision, so they tried nonce churn, polling, skip cycles, revision rows, presence, reloads, and snapshot mutations. | Missing causal observability turned one uncertainty into hours of destructive workaround exploration. | Implement the LLP 0219-style client diagnostic join/receipt; teach a bounded diagnostic ladder before any refresh-argument workaround. This is the single highest-leverage row in the document: it is what would have prevented most of O14's workaround spiral. **Commissioned 2026-08-29:** LLP 0219.000 (causal subscription receipt) drafted under LLP 0219, reviewed READY by two families over five rounds, awaiting the author's ruling; per LLP 0317.000 §Measurement it becomes Routed at acceptance and prevention-landed only when implemented and published. |
| O16 | Nonce-based refresh accumulated subscriptions until `SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT`. | The API let a likely workaround create a new live handle per refresh without an early causal warning. | Diagnose unstable/churning subscription identity with current/limit counts and point to one-shot/read delivery or stable args before the cap. |
| O17 | Foreground and background clients/effects hit writer, identity, authorization-suspended, stale-result, and commit-reentrant states; same-principal browser contexts sometimes stranded hooks while direct headless calls stayed fast. `glm-snapback-explicit` M1 independently: "the first authenticated mutation after a signup/sign-in can race the custody adoption barrier (`SNAPBACK_AUTH_STALE_RESULT`, `SNAPBACK_OUTBOX_NOT_WRITER`)." *3 lanes.* | Single-writer and authority transitions are soundness boundaries, but the app cannot tell which owner or operation is blocking it. | Emit owner/authority generation, conflicting operation, effect-may-have-committed, and exact leave/close repair at the call site; provide a same-account multi-context recipe and conformance demo. |
| O18 | Replay needed unique store identities, offline-queue disablement, per-attempt transport IDs, client closure, and separation of transport idempotency from domain idempotency. A recorded transport intent survived a client-side refusal. | Ordered online replay is a first-party benchmark/agent use case and should not require discovering five custody rules independently. | Add a canonical multi-persona ordered-replay client factory/recipe that makes these choices explicit and validated. Separately establish whether a client-side refusal should be able to leave durable transport intent recorded. |
| O19 | A direct conversation route could wait indefinitely for an authenticated profile live query; a mutation was used to resolve/create the DM atomically. | Route readiness should not depend on a fragile client-side join when the product has an authoritative server operation. | Add an "open by natural key" route recipe and diagnostic for route gates waiting on unsettled protected queries. |
| O34 | **New in r2.** Membership-scoped access is not expressible. `glm-snapback-familiar` M1: "`access.read: 'members'` isn't in the closed union." `sol-snapback-explicit` M3: "the public typing rule is broader than the desired membership scope because I did not find a generated ephemeral authorization composition that could share the custom membership check." `grok-snapback-familiar` M3: "membership-scoped `allow.members()` was too expensive to adopt in-budget; we used a durable typing table instead." *3 lanes.* | Group messaging is the canonical case, and in all three lanes the app **widened its visibility** to ship. That is a security-relevant cost paid because the narrow spelling was unavailable or unaffordable. | **Largely answered 2026-08-28: it is expressible, and this is a retrieval failure.** `guide/auth/protecting-data.md` documents `{ kind: 'membership', declaration, resourceField, roles }` for table reads and `guide/realtime/ephemeral-state.md` documents `allow.members(declarationId, { roles? })` for ephemeral publish/subscribe. Three lanes widened visibility anyway because they did not find them. The one genuine residual is the **asset** upload union, which admits only `owner-only` and `via-references` (`ASSET_READ_ACCESS` in `packages/snapback-codegen/define.mjs`) — that was glm's actual refusal. Route the two shipped spellings from the words the lanes typed; commission a primitive only for the asset residual, if it is wanted at all. |
| O42 | **New in r2.** Driving the generated API from Node is under-documented: headless `liveQuery` requires a `connectionId` (`grok-snapback-explicit` M6); wire-route shapes and the positioned `baseUrl` constructor arg "were only fully visible in package type sources"; "the command-client input shape is documented only via tests" (`glm-snapback-explicit` M1, which asks for "a 'drive the generated API from Node' page in the Guide" and estimates it "would have saved an hour"). *2 lanes.* | The headless client is a first-party arm and an agent's primary automation surface. | **Corrected 2026-08-28: the page exists.** `guide/clients/headless.md` (49 KB) already documents `baseUrl` construction, `connectionId` on `liveQuery` with a worked example, and the command client. Two lanes searched for it and did not find it, so this is O44 again, not a missing page. Adding a second Node page would make retrieval worse. Route the existing page from these lanes' exact phrases and extend it with whatever command-input-shape holes genuinely remain. |
| O43 | **New in r2.** There is no "mark delivered when this principal's live query fetches" primitive, so delivery receipts must be client-acked. `grok-snapback-familiar` M3. `RealtimeContext.hasFreshClient({ principalId })` is the nearest shipped fact and is *connectedness*, not "this query fetched these rows"; `demos/coterie` hand-rolls an app-level `markDelivered`. **Sealed-lane evidence (2026-08-28):** with no primitive available, `sol-snapback-explicit` filled the hole at M8 with the weakest of the three options — "message creation now atomically inserts delivered receipts" (`run-log.md:227`), i.e. a receipt created by the *sender's* write path. Its own final report lists that as a candid gap. So the starting point is further from server-observed delivery than this row implied. | Read/delivery receipts are a defining feature of the messaging shape the benchmark and most real apps need, and a client-ack is a weaker trust story than a server-observed fetch. | **Decided 2026-08-28 (author ruling): the two states split.** *Delivered* is server-observed — the server served those rows to that principal's live query, so it should be able to record delivery without asking the client to confirm what the server already witnessed. *Read* stays a **client-ack**, because a fetched row may sit in a cache the user never opens; only the client knows what reached the screen. Server-observed fetch is therefore more *trustworthy* but not more *semantically accurate*, and the split follows that line. Two pieces of work: a fetch-observed delivery primitive, which needs an amendment under **LLP 0008** (local-first sync and realtime); and publishing the client-ack read-receipt pattern as the supported answer **with its trust boundary stated**, which is guide work and does not wait on the primitive. |

### Mutation settlement, offline UI, and retained state

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O20 | Full navigation immediately after Remove or disappearance selection abandoned the component's mutation promise; the destination could send before authoritative state changed. | This repeated in two milestones and is a predictable Expo Router + durable mutation seam. | Provide a settled-navigation helper/recipe: persist intent synchronously, resume idempotently at destination, and gate the next authority-sensitive action on a server witness. |
| O21 | Transport loss blanked an active query and unmounted the composer even though retained messages existed. `grok-snapback-explicit` M5/M6 independently: "retainable `allMessages` still empty on the search surface after `goto('/search')` + `setOffline`" and offline send control unclickable. `grok-snapback-familiar` M6: "warm-offline compose depends on the Snapback web provider remaining mounted with the network cut; it did not" and "no documented web-offline mutation queue for familiar React." *3 lanes, every deep lane that reached offline.* | A local-first product should make retained-vs-current projection state explicit enough that an app does not throw away usable UI. Three independent lanes each hand-built an outbox. | End-to-end Expo Web offline conversation/outbox recipe with retained snapshot, pending rows, reconnection, and composer readiness; a hook state that distinguishes retained data from unavailable transport. Establish why a retained query is empty offline — that is a defect claim, not only a recipe gap. |
| O22 | Terra Explicit could not find a short product-shaped route from the chat template to profiles, graph, feeds, group roles, media, offline, aggregates, and cron; it asked for "a concise capability map for server schedules, durable web custody, and the benchmark's aggregate/read-model needs" and "an end-to-end migration recipe for this benchmark's many relational tables." | The template proves a narrow chat, but agents building the canonical social shape repeatedly reconstruct the same architecture. | Add a relational-social application recipe/capability map or a richer maintained reference app. This is docs/template work, not a request for generic endpoints. |
| O23 | The custom-client snapshot workaround exceeded the 65,536-byte durable mutation result cap at 165,844 bytes. | The limit was discovered after building the fallback and the error did not provide a product-shaped paging projection. | Surface result budgets in generated types/docs; diagnostic should recommend query/paging/streaming and estimate the admitted row bound before execution where possible. |
| O24 | Repeated retained tests needed optimistic sender echo, atomic delivered receipts, authority-independent receipt projections, and bounded idempotent retries before same-account messaging converged. | These are common messaging semantics, and each workaround changes trust or consistency. | Provide a maintained messaging convergence recipe that separates optimistic local echo, durable settlement, delivery/read authority, and same-account multi-device observation. |

### Assets and media

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O25 | Both sol lanes first represented fixture media as base64 strings and only then hit the 32 KiB structured-value ceiling, after other M2 writes had settled. Sol Familiar reached the right answer only "after the single M1→M2 schema successor was already active," so it shipped with typed media as a candid gap. | The wrong shape is the easiest web-fixture shape; discovering the limit mid-successor is expensive and can be unrecoverable within a successor budget. | Put "bytes are assets, never structured strings" in the template/start packet; refuse data-URI-looking stored strings early with the typed-asset repair; expose the ceiling before replay. |
| O26 | The documented generated media collection compiled but published Linux 0.1.29 lacked `assets.media-collection.v1`. | Codegen and the co-published runtime were incoherent. | Resolve the open capability-skew ticket; publication qualification must compare every codegen-required capability against every platform runtime. If experimental, codegen must refuse before output and the guide must route to the fallback. |
| O27 | Trying the generated collection forced owner-visible parent semantics, host-stamped-owner omission, static insert shapes, unique-conflict disclosure, and then blocked cross-author post reads; after O26 the lane reversed much of the design. | The happy path exposed a large, non-obvious policy bundle before runtime capability admission. | Add a generated preflight explaining all parent-table consequences before schema activation; provide side-by-side "collection" and "typed child row" designs for public social media. |
| O28 | Media kind and typed delivery arrived through separate projections, so a bubble could be considered ready before the harness/app knew it was video; view-once could appear before bytes were available. `grok-snapback-familiar` M4: video bytes "never became observable" and splitting text-then-media still left photo live-render red. *2 lanes.* | Split metadata/delivery readiness is legitimate but needs a standard render contract. | Asset UI recipe should define metadata-ready, delivery-ready, openable, and terminal states and show how to gate controls without hiding the whole message. |
| O35 | **New in r2.** Asset and live-query surfaces were reported to fail by returning empty rather than by refusing. `grok-snapback-explicit` M1: "`useSnapbackAssetImage` stays empty without `maxWidth`"; M3: an unscoped `allMessages` live query "went silent" on a 179-row thread. **Asset half re-diagnosed 2026-08-28: not reproducible.** The hook's `maxWidth = 512` default is blamed to `0fbdc5ff06` on 2026-08-10 and is byte-stable since, predating published 0.1.29. A current-main ready-asset harness passed 10 consecutive runs with `maxWidth` omitted, selected the 512px rendition, and produced the strict `?maxWidth=512` URL. **Live-query prevention landed 2026-08-28 under L19:** deterministic past-ceiling reevaluation now carries `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, its 1,024 bound, and `.take(n)` repair through the fail-closed frame into the headless and React error surfaces, without consuming a retry episode or starting a futile plain re-snapshot. | Silent emptiness is the worst failure mode for an agent. The asset report does not describe the shipped hook, and the confirmed live-query mechanism now refuses loudly while preserving blanking. | Keep the omitted-width regression and make no asset API change. Retain the typed-refusal engine/client/React tests and shape-(d) pre-fix rejection/post-fix acceptance witness; L4's bounded-sweep findings remain in its closed verdict record. **Live-query half landed 2026-08-29** (`9f7eb7f5d`, L19): the refusal now reaches the subscriber typed; proven 10/10 checkout-bound on both platforms — ticket `issues/closed/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`. |
| O36 | **New in r2.** `defineCommand` carries one asset, so every media send is a separate upload intent plus a mutate (`grok-snapback-explicit` M2/M4). `grok-snapback-familiar` M4: `useSnapbackAssetUpload` "blocked send long enough that Bob never saw the caption." *2 lanes.* | Multi-attachment messages and posts are ordinary; the one-asset command turns them into two-phase application state that must then be made idempotent and non-blocking. | Either admit multiple assets per command or publish the two-phase upload-then-mutate pattern as the supported recipe with its ordering, idempotency, and non-blocking-send requirements spelled out. |

### Auth/schema successors and silent degradation

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O29 | **Provenance corrected in r2.** `glm-snapback-explicit` changed `defineAuth.minimumLength`; the successor silently retained the old value (signup kept returning the old bound). This event is from the glm lane, which r1 did not declare as in scope; it is in scope in r2. **Confirmed 2026-08-28, with the mechanism refined.** The harness used `/Users/ccheever/lanes/0317-l1-livequery/target/debug/snapback`; the clean runtime reports `health.binary.gitCommit: 4d4ce40bd9b3921a88d37063b47693923ca8c1d3` and `gitDirty: false`. That commit is an ancestor of this checkout's HEAD with an empty declared runtime-input diff, so the evidence is source-relevant. Scoped limitation: the binary was built in a sibling worktree at the same reported commit, not from this checkout's own tree. A store booted at 8 actively refused a sub-eight-character signup with `SNAPBACK_AUTH_PASSWORD_POLICY` and `minimumLength: 8`, then accepted ten characters. Same-mode `ensureApp` reported a successor at 20 as `provisioned`; afterward, the live provider still refused a new sub-eight-character signup with `minimumLength: 8` but accepted ten characters. Restarting on the same database activated 20, and the predecessor account still signed in afterward, proving persistence survived: restart is sufficient; reset or migration is not the mechanism. The original ten-character-after-provision symptom reproduced on both this runtime and the earlier `92c0033` runtime; no broader behavioral equivalence is claimed. | Silent non-application is worse than refusal. The defect is specifically that same-mode provisioning commits the successor generation without replacing or restarting the startup-bound auth provider. | Post-verdict owner L11 must either activate the candidate policy before reporting success or emit a specific restart-required auth diagnostic with predecessor/candidate bounds and the restart repair. Keep the acceptance harness as conformance coverage; do not prescribe reset or migration. |
| O30 | Owner-policy correction patches were easy to apply to the wrong table, and generated collection ownership temporarily broke ordinary cross-author reads. | Security-shaped schema changes need a before/after policy projection, not source-text surgery and runtime discovery. | Generate a policy diff/preview naming each table, owner field, stamped inputs, read visibility, and unique disclosures before activation. |
| O44 | **New in r2.** Guide retrieval fails on broad queries even when the right page exists. `sol-snapback-explicit` essay: "Its biggest weakness was discoverability: broad searches frequently returned no result even when a relevant page existed"; M1: "the Guide search returned no entry for the broad module-evaluation code." `sol-snapback-familiar`: `CODEGEN_POLICY_INVALID` "lacked a working exact diagnostic page." *2 lanes, and it is the mechanism behind several other rows.* | Every other guide fix in this document is worth less if the page cannot be found from the words a failing agent actually types. This is the cheapest high-leverage row here. | Add diagnostic-code → page routing for every emitted code that lacks one (`CODEGEN_POLICY_INVALID` and `SNAPBACK_AUTH_THROTTLED` were confirmed missing when this row was written; **both have since been routed** — `guide/auth/passwords.md:551` and the L8 landing — so treat them as worked examples rather than open items, and audit the rest), and add broad-query retrieval cases to `guide/retrieval-eval.md` drawn from the exact phrases these lanes searched. |
| O45 | **New in r2.** Two lanes wanted one Expo-web sentence Snapback could cheaply own even though the defect belongs to React Native Web: `accessibilityValue` is dropped and images become CSS-background descendants. See N8 for why the defect itself is out of scope. | Snapback ships the Expo start packet; a known renderer behaviour that every web lane hits belongs in it. | One paragraph in the Expo/web start packet naming the RNW semantic drops and the app-owned bridge pattern. |
| O46 | **Split out of N5 in r2.** After successful credential adoption, a **full navigation** returned to the auth surface while client-side routing retained the session (`sol-snapback-explicit` `1787857420`). The lane's workaround avoided full reload and never diagnosed why durable authentication disappeared across it. | Durable web custody surviving a full page load is the core promise of durable custody. An unexplained loss is either a defect or a documented boundary — it cannot stay unclassified. | Reproduce sign-in followed by a full document navigation and establish whether durable custody survives. Fix or document the boundary; add an acceptance case. Related to O7 and O33, which also involve boot-time binding state. |

### Scale tail (classified 2026-08-28, after the lane sealed)

The `sol-snapback-explicit` lane sealed at 2026-08-28T04:35Z after 8 h 46 m.
Its scale phase carries **33 `milestone=scale-replay` run-log entries**
(11 agent-error, 9 ambiguous, 7 self-tagged `snapback-defect`, 6 environment).
The sealed report's own corrective-entry predicate counts **40** scale entries
split 14/7/13/6 (`final-report.md:77`). The two are **different predicates, not
nested** — ambiguous is 9 here and 6 there, so 33 cannot be a subset of 40. The
33 is every `milestone=scale-replay` line, which includes knowledge-lookup,
fixture-green, lifecycle-start and checkpoint-green entries the report's rule
excludes; the 40 is the report's corrective-entry rule, which includes later
`scale-replay-retry` / `scale-replay-correction` lines (`run-log.md:273-286`)
that carry no `milestone=scale-replay` marker. The seven self-tagged defects are identical under both
counts; this section dispositions those seven, plus the three candid gaps the
run-log never tagged at all. Classified below. Full artifacts are now imported
under `benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/sol-snapback-explicit/`.

| ID | Observed correction cause | Why Snapback should prevent it | Candidate intervention |
|---|---|---|---|
| O47 | `SNAPBACK_SCHEMA_FIELD_RETYPED` refuses widening an array validator's `maxItems` from 32 to 64 — **on a fresh pre-replay store with no stored data to migrate**. The lane worked around it with an additive `recipientPrincipalIdsV2(max64)` plus legacy-fallback reads. | Widening a bound is a compatible change, and on an empty store there is nothing to retype. activation calls `reject_field_retypes` **before** any row-sensitive check (`crates/snapback-kernel/src/storage/auth_mode.rs:579`), which is why an empty store does not help; the test is an exact `FieldType` inequality (`crates/snapback-kernel/src/storage.rs:14308`) in which the complete structured contract participates, so a widened bound is unequal. Note `field_type_name` does *not* carry the bound — it returns the constant `"Structured"` (`storage.rs:14567`) — so the message cannot even name what changed. Forcing a V2 field and dual-read logic for a widened maximum is a large tax on a safe edit. | Treat a widened bound as compatible. This is not free: contract-hash and storage-generation identity must be reconciled before a widening can be admitted without breaking successor identity, so the row is a design question, not a one-line predicate change. At minimum the diagnostic must name the differing contract rather than reporting an unnameable `Structured`→`Structured` retype. |
| O49 | The documented mint-by-email path issued an email-code principal **distinct from the existing local-password identity for the same person**, so `ensureDm` refused `PROFILE_REQUIRED`. The lane added a replay-only canonical actor bridge. | The fork is **deliberate pre-hijack containment**: a password identity does not prove ownership of an address, so a later email-code exchange must not inherit the password principal's data (LLP 0227 §300). The path is also documented (`guide/operating/host-ops.md:110`, `guide/auth/sessions-and-principals.md:217`). What is missing is the *relationship* — an app offering both entry paths gets two principals for one human and learns it from a downstream `PROFILE_REQUIRED`. | **Do not auto-adopt on a matching address** — that is exactly the hijack LLP 0227 contains against. Document the relationship where multi-entry and replay apps meet it, warn in the ordered-replay recipe that mint-by-email does not adopt a local-password identity, and consider a diagnostic at the point of divergence. Revisiting LLP 0227's displacement protocol is the only path to actual adoption and needs that document's owner. |
| O52 | **Reclassified from N22 in review.** The ordered replay runner injects a pagination argument into every query it dispatches: `pagedQuery` defaults `pageSizeKey` to `'limit'` and adds it unconditionally (`packages/snapback-acceptance/replay.mjs:1484,1492`), and the public options expose no one-shot / no-pagination mode (`packages/snapback-acceptance/index.d.mts:308`). The lane's only recourse was to widen four generated query contracts to accept an argument they did not want (`run-log.md:254`). | This is Snapback's own first-party replay helper, not lane code. It makes a correctly-typed generated contract wrong by dispatching against it, and the repair pushes the runner's implementation detail into the application's public surface. | Give `pagedQuery` a one-shot mode, or omit the page-size argument when the resolved contract does not declare it. Adjacent to O18's replay-custody work. |
| O53 | **Reclassified from an already-ships dismissal in review.** Once the durable client-mutation ledger saturates at its 10,000-record global ceiling, the documented recovery requires re-entering the **predecessor authority cohort** (`guide/sync/offline-and-retention.md:981,1037`). An application that has lost those ACK obligations — the lane lost them to an OOM — has no paved path. The recovery that fits, an admin-gated purge (LLP 0043 §824, `crates/snapback-server/src/server.rs:27315`), ships but is exposed only as `client-mutations.purge`, `apiOnly` and `internal` (`guide/operating/agent-controls.md:396`), and it trades away exactly-once retention. | Saturation from unacknowledgeable retention is reachable by ordinary means (a crashed or replaced client), and the state is terminal for the author: the paved recovery cannot apply and the applicable recovery is not paved. | Pave an author-facing recovery for unacknowledgeable retention, stating the exactly-once cost plainly, or make the routine path cover the lost-cohort case. See also the read-blast-radius question, **answered 2026-08-28** in §Scale-tail questions answered: the ledger refuses durable-id mutation submission, not reads, so O53 is the availability row and the read coupling is O13/C5's. |
| O50 | The published ordered mutation runner **cannot carry asset-upload references**, so any replay touching media must fabricate a scale-only representation. | Ordered replay is a first-party benchmark and agent surface (O18), and media is in the canonical social shape. A replay path that cannot express the product's own asset writes forces every media-bearing fixture into a fiction. | Either carry asset references through the ordered runner, or state the limitation where replay is documented so it is a known boundary rather than a discovery. |
| O54 | **New 2026-08-28, from the scale-tail question round.** Codegen admits `grants: true` on a `defineAssetUpload` whose `delivery.kind` is `public-immutable`. Delivery profile is validated against the target's advertised profiles (`packages/snapback-codegen/index.mjs:7590`) and `grants` is validated independently; nothing couples them. **Probed 2026-08-28:** adding `grants: true` and `access: { read: 'owner-only' }` to `demos/file-drop/snapback`'s existing `delivery: { kind: 'public-immutable' }` intent generates clean — `codegen ok`, no error and no warning about the combination. | A grant edge is authority over a **governed** byte request, and public-immutable delivery has no governed read to gate, so the declared grant can never deny a byte. The two facts sit in one declaration and are visible together at generate time. The same coupling already exists one subsystem over in the other direction: `SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED` refuses a recipient sharing plan whose intent omits `grants: true` (`index.mjs:12224`). | Refuse at generate time with the exact repair — `private-strict` for next-request denial, `private-signed` when a TTL-bounded bearer URL is acceptable — and state that neither retracts bytes already delivered. Second half: a revoke/close call against an intent declared `public-immutable` should be a typed refusal rather than a silent no-op. **Explicitly not in scope:** refusing an application-level view-once feature that declares no revocation at all — see the answer below. Ticketed as `issues/20260828-codegen-refuse-grants-on-public-immutable-delivery.md`. |

**O48 and O51 were drafted and withdrawn in review.** O48 claimed the
`maxInItems`/`maxFilterBindings` ceilings were unexposed; they are documented in
prose at `guide/backend/queries.md:441-449` ("at most **500 total `in`
operands**", "at most **500 total filter bindings**", refused "before any
storage read"). The drafting search looked for the constant names, not the
prose — the fourth time in this program that searching one spelling produced a
false "missing". Any residual belongs to O10's ceiling half and to O44.
O51 claimed send-path delivery receipts as a new row; Snapback did not create
them, the lane did, at M8 (`run-log.md:227`, "Message creation now atomically
inserts delivered receipts") — it is the O43/O24 hole filled with the weakest
available option, so it folds into O43 rather than standing alone.

**Not classified as Snapback problems.** Two scale entries do not survive
inspection: the entry at `1787873091` is tagged `snapback-defect` but records
the system behaving **correctly** (durable retention survived restart, minted
custody stayed refused, no reset occurred) — a mistag, counted here as N21; and
the replay mapper injecting `args.limit` into an exact lookup whose generated
contract lacked it (`1787872016`) is adapter code, N22.

**One already-ships, and one dismissal that did not survive review.** The
documented ledger recovery (`guide/sync/offline-and-retention.md:1028` —
`settledMutations()`, consume, `markMutationSettlementsConsumed(ids)`, deliver
ACKs) requires **re-entering the predecessor authority cohort**
(`offline-and-retention.md:981,1037`). The lane had already lost those
predecessor ACK obligations to an OOM, so the paved path was **inapplicable to
its situation**, and calling the row already-ships on that basis was wrong.
Current `main` does ship the right recovery for "the original client can no
longer acknowledge" — an admin-gated purge (LLP 0043 §824,
`crates/snapback-server/src/server.rs:27315`) — but the guide exposes it only
as `client-mutations.purge`, `apiOnly` and `internal`
(`guide/operating/agent-controls.md:396`), and it deliberately sacrifices
exactly-once retention. So the true disposition is **O53**: routine recovery
does not cover unacknowledgeable retention, and the operator recovery that does
is unpaved. Separately
candid gap 2 (view-once and delete-for-everyone not revoking already-delivered
asset URLs) is an authoring choice against documented guidance:
`guide/recipes/view-once-media.md:313` prescribes `grants: true`, an
`owner-only` read policy and `delivery: { kind: 'private-strict' }` *precisely
so* close or delete denies the next governed byte request. The lane used
public-immutable delivery, which cannot revoke by construction.

Both remain worth acting on, in the program's cheapest register. Both
questions are now **answered below** in §Scale-tail questions answered: the
ledger never blocked reads (the refused probes were reads authored as
mutations, which is O13/C5's coupling), and the codegen refusal is worth
building for *declared* revocation over non-revocable delivery (**O54**) but
not for application-level view-once vocabulary.

**Candid gap 1 is security-relevant and is ticketed**: the table-native
conversation and receipt projections adopted to survive same-principal
reentrancy are broader than membership-filtered private reads, so an opaque
chat ID can expose data. That is the measured cost of the O17 workaround.

### Scale-tail questions answered (2026-08-28)

The two questions this section routed to
`issues/closed/20260828-scale-tail-two-open-questions.md` are answered here.
Both are design questions; neither answer implements anything.

#### 1. A saturated durable mutation ledger does not block reads

**The premise does not hold at the ledger.**
`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` is raised on the path that admits **a
durable client-mutation id** (`crates/snapback-kernel/src/storage.rs:24216`),
and its message says so: "acknowledge consumed results before submitting
another durable id". It gates durable-id mutation submission. It does not
participate in query evaluation.

The lane's own record separates the two cleanly: at the 50% checkpoint "query
probes completed at p95 57.2-106.6ms" **while** "celebrity/small post
acknowledgements plus Insights and Trending were refused by
`SNAPBACK_CLIENT_MUTATION_RETENTION_FULL`" (`run-log.md:281`). Reads were
healthy throughout. Everything refused was on the wire as a durable mutation.

So the two questions resolve as:

- **Intended or incidental?** Refusing a new durable id on a saturated
  exactly-once replay ledger is **intended** — it is what the retention promise
  means, and the alternative is silently dropping replay obligations. The
  coupling to *reads* is **incidental**, and it is not created by the ledger.
  It is created upstream at the authoring boundary: the explicit JS mutation
  contract rejects an empty write set (O13), so an analytical read had to be
  authored as a mutation — and a mutation submitted with a durable
  client-mutation id takes a ledger record, whatever it semantically does.
  Insights and Trending were reads wearing a mutation.
- **Does C5 remove the class?** **Yes — but only in the shape that carries the
  witness**, and this is the strongest available argument for C5's priority. A
  handler that may declare no writes is dispatched as a read, takes no durable
  client-mutation id, and is therefore outside the ledger and its saturation
  permanently, without tuning any limit — P2's top rung rather than its second.
  What does *not* achieve that is a C5 that merely permits `writes: []` while
  the handler still dispatches on the durable mutation lane; that shape hits
  the same ceiling. So the removal is load-bearing on C5's second acceptance
  witness — **a read-model handler must not consume a durable client-mutation
  record** — not on the empty-write permission alone.

**Scope of that claim, so it is not overstated.** C5 does not fix O53: a
saturated ledger is still terminal for genuine writes when the predecessor ACK
cohort is gone, and O53 remains the row for that. C5 does not raise the
ceiling, and it does nothing for an application whose real *writes* saturate.
It removes exactly the class where a read was refused because it had to be
declared as a write.

**Priority consequence.** C5 was commissioned as an authoring-ergonomics
sub-row of O13 (bundle 4, generate-time prevention). It now has a measured
availability consequence at scale, so it should be ranked with **bundle 3**
(paved mutation/offline application patterns) while keeping its LLP 0108 owner
and its unchanged question. It also acquires a second acceptance witness: a
read-model handler must not consume a durable client-mutation record.

#### 2. Codegen should refuse declared revocation over non-revocable delivery — and should not sniff application vocabulary

The question splits into two shapes that look alike and are not.

**(a) `grants: true` over `public-immutable` delivery — refuse.** This is a
declaration-internal contradiction, both halves of it authored in the same
`defineAssetUpload`, and codegen admits it today — probed on
`demos/file-drop/snapback`, which generates clean with no error or warning.
Recorded as **O54** above with its repair, its precedent, and the probe. This
is the cheap, precise, generate-time prevention the P2 ladder asks for.

**(b) An application-level view-once feature that declares no revocation — do
not refuse.** This is what the lane actually shipped: public-immutable delivery
plus an application `expiresAt`/viewed flag and UI hiding (`run-log.md:167`;
`final-report.md:113`, "UI facts hide them"). Codegen sees no revocation
declaration at all. The only remaining signal is *application vocabulary* — a
field named `expiresAt`, a mutation named `markViewed`, a table named
`disappearingMessages` — and a rule that sniffs authored names is one Snapback
should not write. It cannot be stated precisely; it fires on legitimate designs
(an expiring **text** message needs no asset revocation); and it converts an
author's naming choice into a generate-time failure. The decisive test is that
such a rule would refuse Snapback's own paved work: the read-receipt recipe's
`markRead` is exactly a "mark viewed" mutation over content, and a
vocabulary sniff broad enough to catch this lane would generate-fail it.
Refusing (b) buys one case at the cost of a rule no author could predict.

**The residue of (b), stated plainly.** After O54's second half lands — a
revoke/close call against a `public-immutable` intent becoming a typed refusal
rather than a silent no-op — an application that never reaches for revocation
at all is still unprevented. That residue is documentation-shaped, and **the
documentation already exists and was read**: `run-log.md:131` records this lane
confirming from the served guide that "public immutable deletion cannot retract
already cached responses", and it shipped the feature anyway.
`guide/recipes/view-once-media.md:313,335` prescribes the working shape and
states the boundary. So this specific failure was **not** a knowledge gap, and
more prose is not the intervention. The honest disposition is: O54 catches every
case where revocation is declared or attempted; the case where an app silently
means "view once" and declares nothing is out of reach of both codegen and the
guide, and should be recorded as such rather than papered over.

Nothing here reopens the existing view-once recipe, whose guidance the review
already confirmed correct.

## Already-ships sweep (2026-08-28)

All 46 backlog rows were audited read-only against current `main` to establish,
per row, whether the capability the row asks for **already exists**. Four codex
`gpt-5.6-sol` @ xhigh batches partitioned the rows one-to-one; the seven rows
that came back open were then cross-checked by `grok-4.6` @ xhigh instructed to
falsify. Full record: `issues/20260828-already-ships-sweep.md`, per-batch
reports under `issues/sweep-20260828/`.

| Verdict | Count | Rows |
|---|---|---|
| Already ships | 9 | O11, O16, O18, O23, O30, O34, O36, O39, O42 |
| Already ships (repair present) | 2 | O10 (failure `inconclusive`), O12 (cause established 2026-08-28) |
| Partially ships | 19 | O1, O2, O3, O4, O9, O13, O15, O17, O19, O20, O22, O24, O25, O27, O28, O37, O40, O41, O44 |
| Genuinely open | 7 | O8, O26, O31, O32, O38, O43, O45 |
| Needs reproduction | 7 | O5, O6, O7, O14, O21, O33, O46 |
| Confirmed defect | 1 | O29 |
| Not reproducible | 1 | O35 |

**Only seven rows are genuinely new capability work.** Eleven already ship and
nineteen are partial — a named delta rather than a build. (Counts are over the
46 rows that existed when the sweep ran. §Scale tail later added O47, O49 and
O50; two further drafted rows were withdrawn in review, one of them because it
too described something that already ships — see that section.) This is the same
finding the retrieval rows reached from the other side, and it promotes O44
from one row among forty-six to the program's load-bearing item: the dominant
failure mode in this corpus is a capable agent not finding a capability that
exists.

Three framings were corrected by the cross-check. **O31** duplicates
LLP 0252 Phase 3, which already plans paired Familiar templates, so it is
unshipped planned work rather than an unrecognised gap. **O38**'s mechanism is
wrong: the scaffold never emits `babel.config.js` — the lanes added it during
ordinary Expo Router conversion — though the prevention gap is real. **O32** is
not literally "Explicit examples only"; `guide/backend/assets.md` already
transcludes a Familiar fixture, and what is missing is the corpus policy.
**O26** narrows to the absent codegen-required-vs-every-platform comparison in
publication qualification, not the capability, which current source registers.

## Priority synthesis

The backlog should not be implemented in table order. The evidence suggests
six priority bundles:

1. **Authority and reactive causality:** O14–O19, O34, O43, O46. These consumed
   the most debugging time and drove semantically costly polling and
   public-read fallbacks. **O15 first** — the causal trace is what turns the
   rest of this bundle from speculation into diagnosis.
2. **Published media coherence:** O25–O28, O35, O36. Fix codegen/runtime skew
   first, then make the two admitted media models and readiness states obvious.
3. **Paved mutation/offline application patterns:** O20, O21, O24. These are
   common app requirements, not Clique trivia.
4. **Generate-time prevention:** O3, O9, O11, O13, O23, O29, O30, O39–O41.
   Prefer types, preflight, and exact repair diagnostics over prose discovered
   after failure. O10 and O12 are **excluded from this bundle** until their
   reproductions establish a real cause.
5. **Template/start-packet closure:** O1, O2, O4, O5, O6, O7, O8, O22, O33,
   O37, O38, O45. A builder should be able to start, evolve, reconnect, and
   convert the maintained template without repo archaeology.
6. **Familiar-profile parity:** O31, O32, plus the Familiar halves of O3, O13,
   O21, and F3. Familiar is presented as a first-class profile but has no
   template and one documentation page; every Familiar lane paid for that.

Two rows sit outside the bundles by design: **O44** (guide retrieval) is a
prerequisite multiplier for every documentation intervention in bundles 2–6 and
should land first among the cheap items; **O42** is a single missing page whose
absence is measured in hours per lane.

## Proposed proof and routing

This Research document does not itself authorize product design. Follow-up
owners should route work as follows:

- Straightforward diagnostics, guide gaps, template changes, and focused bugs
  become filesystem tickets under `issues/` and cite the relevant O-row.
- O14, O17, and O21 require faithful focused reproductions before a design
  claim. O10, O12, O33, and O46 require reproductions before *any*
  implementation, because their stated causes are unestablished or refuted.
- O26 is publication/coherence work and must remain fail-closed.
- O29 is a silent-degradation defect and should be reproduced urgently; O35 is
  the same class and should be swept alongside it.
- Any new primitive proposed for O15, O17, O20, O34, O43, or the open half of
  F3 needs an RFC/spec amendment under its governing subsystem LLP.
- **Three sibling artifacts inherit F2's superseded framing and must be
  corrected with it:** `diaries/0114-clique-published-0129-matrix.diary.md`
  ("the cross-client fanout reports were a test-harness artifact, not a
  Snapback bug"), `benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md`
  §6, and `issues/20260827-live-query-cross-client-fanout-staleness.md`.
- LLP 0186/0198 should measure closure as fewer Snapback-attributable correction
  loops in a fresh published Clique pin, not merely as tickets closed on main.

The next published rerun should record, for every row exercised:

1. whether the bad path was impossible, refused before costly work, or merely
   documented;
2. whether the agent found the correct repair from the served guide without
   package-source inspection;
3. correction-loop count and elapsed time;
4. whether the fix changed application trust, visibility, or consistency; and
5. the exact published package/runtime/template identities.

## Scale tail preview (superseded)

**Superseded 2026-08-28 by §Scale tail**, which classifies the sealed lane.
The preview below is retained because the round-1 reviewers' independent
identification of these causes, while the lane was still running, is what
established that the tail was not merely scale variants of O10, O18, O23 and
client retention. It was right: five of the items became O47–O51 or folded into
existing rows, two did not survive inspection, and two turned out to be
already-documented behaviour.

- `SNAPBACK_SCHEMA_FIELD_RETYPED` refuses raising an array validator's
  `maxItems` from 32 to 64 **on a fresh pre-replay store** (`1787868970`,
  `attribution=snapback-defect`). A general successor defect, not a scale fact.
- `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` at a global 10,000 records; the
  saturated durable mutation ledger then **refused mutation-backed Insights and
  Trending reads** (`1787872963`, `1787875370`).
- Replay mint-by-email issued a principal distinct from the local-password
  identity, causing `PROFILE_REQUIRED` (`1787872045`).
- The published ordered mutation runner cannot carry asset-upload references
  (`1787872227`).
- `SNAPBACK_QUERY_IN_ITEMS_EXCEEDED` then `SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED`
  at `maxInItems`/`maxFilterBindings` = 500 (`1787875220`) — the O10 ceiling
  family, different limits.
- `SNAPBACK_AUTH_THROTTLED` at 16 concurrent password entries (`1787870680`);
  routed since, at `guide/auth/passwords.md:551`.
- `SNAPBACK_REPLAY_DEFINITION_INVALID` for pool 512 against a published max of
  64 (`1787873130`).

## Confidence and open questions

Confidence is high that the listed events occurred: each is stated in a lane
diary, essay, or structured run log. Confidence in causal attribution varies:

- F1 is directly repaired in current template source; its product-side root
  cause is not.
- F2 is now scoped to the Node/headless mechanism it can actually explain. The
  broad fanout claim is **withdrawn**, not merely qualified.
- F3 is a guide closure, not proof that the best primitive exists.
- O10 and O12 were **refuted as diagnosed**: the repairs they proposed already
  exist in the exact published version the lanes ran. **Both have since been
  reproduced (2026-08-28).** O12's cause is established — TypeScript's
  explicit-call-target rule, so the fix is a guide section plus a lint rather
  than a type change, and the guide half has landed. O10's empty projection did
  not reproduce in a 16-cell runtime matrix, but on the wrong platform and
  against a non-ancestor binary, so it closes `inconclusive` and the row stays
  open.
- O14, O17, O21, O33, and O46 require focused reproduction before
  implementation claims.
- O6 may collapse into F1 or into O33; it remains separate because its retained
  event names neither the Metro temporary-file race nor a generate window.
- Rows sourced from a single glm lane (O29, O40) rest on one milestone of
  evidence from a lane that later hung; they are precise but thin.

Open questions:

1. Which O-rows already have tickets under different wording and should be
   linked rather than duplicated? Known candidates:
   `20260825-metro-exit-on-codegen-tmp.md` (F1),
   `20260825-dev-control-channel-requires-stdin.md` (O37),
   `20260826-inline-handler-free-identifier-recovery.md` (O9),
   `20260825-guide-gap-generated-directory-spelling.md` (N18).
2. Which current-main fixes are absent from the next published package set?
3. ~~Does the sealed scale tail add new root causes?~~ **Answered 2026-08-28,
   finally:** yes — O47 (widened bound refused as a retype), O49 (mint-by-email
   forks identity), O50 (ordered replay cannot carry assets) and O51 (send-path
   delivery receipts) are new. Two self-tagged defects did not survive
   inspection and two were already-documented behaviour the lane did not find.
4. Should the social reference path be a richer template, a maintained demo,
   or an intent-routed guide packet under LLP 0061/0196? O31 makes this
   sharper: whatever the answer, it needs a Familiar edition.
5. What minimal causal receipt would let an agent distinguish auth custody,
   subscription matching, and renderer staleness without reading source?
   This is O15, and it is the question the whole authority bundle turns on.

## Exit criterion

**Status note, 2026-08-28.** Criteria 1, 2 and 5 are satisfied. This document
**stays `Review`** because 3 and 4 are not, and 4 cannot be satisfied by
document work at all: it requires the three F-rows to be checked against a
*coherent published package/template pin*, and the fixes they describe are
landed but unpublished. The next publication is what moves this to `Active`, not
another revision. Its child RFC, LLP 0317.000, is `Accepted` as of the same
date; the plan is agreed, the evidence claim is not yet closable.

This research can move from Review to Active after:

1. ~~the current matrix artifacts and diaries are imported into the
   repository~~ — **satisfied** before r2: commits `77b621623` and `44fcd1263`
   imported all twenty lane cells under
   `benchmarks/runs/2026-08-27-clique-published-0129-matrix/`;
2. ~~the sol-explicit scale tail is classified in a dated revision~~ —
   **satisfied 2026-08-28**: the lane sealed at 04:35Z and its scale phase is
   classified in §Scale tail, adding O47, O49, O50, O52 and O53 plus N21 (two further drafted rows, O48 and O51, were withdrawn in review, as was a second N row);
3. each O-row is linked to an existing owner or a new filesystem ticket, with
   duplicates reconciled;
4. the three F-rows are verified against a coherent published package/template
   pin or moved back to the prevention backlog; and
5. the three sibling artifacts carrying F2's superseded framing are corrected
   (see §Proposed proof and routing).

## Revision history

**r4 — 2026-08-28 (scale-tail question round; no review round — this revision
answers two questions the r3 scale-tail classification deliberately routed out,
and adds no new evidence).**

- **The saturated-ledger read blast radius is not the ledger's.**
  `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` gates admission of a durable
  client-mutation id (`crates/snapback-kernel/src/storage.rs:24216`), not query
  evaluation, and the lane's own 50% checkpoint records healthy query probes
  beside the refused mutation-backed ones (`run-log.md:281`). The refusal of
  Insights and Trending is O13's empty-write-set coupling surfacing at scale,
  which raises **C5** from an ergonomics sub-row to bundle 3 and gives it a
  second acceptance witness. O53 is unchanged and remains the availability row.
- **O54 added.** Codegen admits `grants: true` on a `public-immutable` upload
  intent — a declaration-internal contradiction visible at generate time, with
  an existing precedent for the coupling in
  `SNAPBACK_MEDIA_COLLECTION_SHARING_GRANTS_UNDECLARED`. Refusing an
  *application-level* view-once feature that declares no revocation is
  explicitly **declined**: the only signal is authored vocabulary, and the
  residue is documentation-shaped documentation the lane had already read
  (`run-log.md:131`).
- **O43's read half shipped** as `guide/recipes/read-receipts.md` with its
  trust boundary, and the delivered half now has durable custody in
  `issues/20260828-server-observed-delivery-primitive.md`.

**r2 — 2026-08-28 (super-refine round 1; reviewers: codex `gpt-5.6-sol` @ ultra
and `grok-4.6` @ xhigh, both NOT READY; artifacts under `llp/reviews/0317-*`).**

- **Evidence base corrected.** r1 declared four Snapback lanes; the matrix ran
  **eight**, all retained in-repo. The four r1 omitted include
  `grok-snapback-explicit`, the deepest *scored* Snapback lane (4/8 greens),
  and both glm lanes. Rows O31–O46 and N18–N20 come from that import, and
  seven pre-existing rows gained cross-lane corroboration.
- **F2 narrowed** (both families MATERIAL). The shared-partition mechanism is
  Node-gated and cannot explain the browser and same-client evidence; the
  "dominant cause of the broad fanout report" claim is withdrawn and the
  residual moved into a widened O14. Three sibling artifacts inherit the old
  framing and are now listed for correction.
- **O10 and O12 re-diagnosed** (codex MATERIAL, orchestrator-verified against
  the published 0.1.29 tarball). Both prescribed repairs that already ship in
  the version the lanes ran; both are now reproduction-first.
- **O29 provenance disclosed** (both families MATERIAL) — it is glm-sourced,
  which r1's four-lane scope excluded.
- **N5 split**; the reload-after-sign-in event became O46 (codex MATERIAL).
- **N16 corrected** — the terra lanes stopped at 220 s and 348 s and are
  classified `premature-stop, non-signal` by the matrix record; "time budget
  expired" was wrong.
- **N18, N19 added** from codex MATERIAL M6; **O9** absorbed the computed
  `uniqueMany` case from O13 (grok m4); **O3** now names
  `CODEGEN_POLICY_INVALID` (grok m2); **F3**'s cross-reference corrected from
  O15 to the clock ticket (codex m1); **O6** bundled (both families);
  **exit criterion 1** marked satisfied (codex m3).
- A sixth priority bundle (Familiar parity) and a §Scale tail preview were
  added. Growth exceeds the loop's ~20% budget by design: the round's finding
  was that half the evidence base was missing, and the author's brief was
  completeness.
- **Status set `Draft` → `Review`** at loop start, the one transition the
  refine loop is authorized to apply.

**r2.2 — 2026-08-28 (Wave 1 L4 verdict correction).** O29 is confirmed with
the clean sibling-worktree binary at
`4d4ce40bd9b3921a88d37063b47693923ca8c1d3`, an ancestor of this checkout's
HEAD with an empty declared runtime-input diff. The post-provision sub-eight
refusal proves the predecessor minimum remains actively enforced until restart;
restart activates the successor, and a post-restart predecessor-account sign-in
proves the persistent store was not reset. O35's asset half is not reproducible: its
512px omitted-width default predates 0.1.29, remains byte-stable, and passed the
ten-run negative-evidence bar. Its live-query half remains open under L1/L19.

**r2.1 — 2026-08-28 (corrections found while reviewing the child RFC
LLP 0317.000).** Three rows prescribed repairs that already exist on current
main, the same failure mode r2 identified in O10 and O12: **F1**'s codegen
staging already writes outside the watched tree (closed ticket); **O34**'s
membership scoping ships for table reads and ephemeral state, leaving only an
asset-union residual; **O42**'s headless page exists and documents the exact
APIs the row asked for. All three are retrieval failures, which strengthens
O44 from one row among many into the mechanism behind several.

**r2.3 — 2026-08-28.** Added §Already-ships sweep: all 46 rows audited against
current main, with O31/O38/O32/O26 reframed by the cross-check. Seven rows are
genuinely new work; eleven already ship.

**r2.4 — 2026-08-28 (Wave 1 O14 verdict).** Replaced the vacuous live-query
harness with an original-subscription/frame-bound witness and recorded the
four scoped outcomes in O14. The supplied clean runtime passed 10 consecutive
development runs for (a), (b), (c), and exactly 179 rows, while every one of
the 10 past-ceiling runs confirmed the same coded quarantine mechanism. Those
passes remain insufficient for a negative verdict on the browser/Linux reports
and are not exact-current-runtime evidence. Crossing 1,024 rows makes the
implicit collection bound refuse reevaluation; the server publishes fail-closed
authorization quarantine without a successor snapshot, and the client blanks
the still-attached subscription. The general invalidation question remains
open.

**r2.6 — 2026-08-29 (Linux x86_64 reruns of L1 and L2; no review round).**
Both harnesses ran on `expo-build-450b` against binaries built from the clean
checkout. **O10 empty projection closes `not reproducible`** — the L2 runtime
matrix, 14 cells × 10 consecutive runs, exit 0, on the reported platform with an
exact-current binary; the ceiling half stays with L15. **O14:** the landed
harness had a temporal-dead-zone bug that prevented shapes (a)–(c) from
running at all, present since `f3c09fcb0`, so that revision's 10/10 figures for
those shapes are not reproducible from the repository; fixed in `8b332808f`.
Rerun ×10 per shape: (a) not reproducible on the headless arm; (b) and (c)
upgraded but still `inconclusive` because their reported arm is a real browser
(follow-up `issues/20260829-o14-real-browser-arm-harness.md`); (d) exact-179 not
reproducible; (d) past-ceiling **confirmed on Linux** and owned by L19
(`issues/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`).
Record: `issues/closed/20260829-l1-live-query-invalidation-linux-verdict.md`.

**r2.5 — 2026-08-28.** Wave 1 verdicts for O10 and O12 landed from lanes L2 and
L3, which had completed and been reviewed but never reached the corpus. O12 is
**confirmed** with its mechanism corrected in review from a contextual-callback
limitation to TypeScript's explicit-call-target rule, which changes the fix from
a type change to a guide section plus a lint; the guide section landed with it.
O10 is **inconclusive**, downgraded from "not reproducible" because the matrix
ran on the wrong platform against a non-ancestor binary. A second finding rides
along: the CI test covering F3's `.take(args.limit)` recipe exercises it through
a query-builder double, not the native runtime.

**r2.7 — 2026-08-29 (L19 bound-refusal prevention landed; implemented after the r2.6 Linux reruns).** Kept LLP 0053's
fail-closed `quarantine`/resync disposition while making the deterministic
past-ceiling cause visible: the optional live-envelope refusal carries
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, the 1,024 bound, and `.take(n)` repair;
the server spends no retry episode, the plain client avoids a futile
re-snapshot, and the headless/React bindings use their existing diagnostic
error surfaces. Shape (d)'s harness now requires that refusal on the unchanged
subscription and retains `O14_D_IMPLICIT_LIMIT_SILENCE_CONFIRMED` as the
pre-fix failure. O14 shapes (a)–(c) are unchanged by this revision (their
Linux verdicts are r2.6's). Landed as `9f7eb7f5d`; post-landing
checkout-bound acceptance 10/10 on macOS arm64 and Linux x86_64 (ticket closed).

**r1 — 2026-08-27.** Initial synthesis of the published-0.1.29 Clique matrix
Snapback lanes as then understood (four lanes); the sol-explicit scale tail was
still running and was excluded.
