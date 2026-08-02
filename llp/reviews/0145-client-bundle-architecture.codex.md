# LLP 0145 client bundle architecture review — Codex family


## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (CLI banner)
**Sandbox:** read-only
**Session id:** `019fbf9b-7eed-7fd2-b26b-088f77f6c0d0`
**Date:** 2026-08-01
**Method:** fresh CLI runner, read-only sandbox, blind to this document's fable
artifact and to all of `llp/reviews/`; SHA-pinned target and instruction capsule
**Instruction capsule SHA-256:** `f8183404ac97a0e72f629258bd05946bd9b2539f679fe9727b56c130f5b165b0`
**Target:** `llp/0145-client-bundle-architecture.research.md` (842 lines, Draft,
uncommitted working tree)
**Target SHA-256:** `46ca3bb01d12ac7b31929549fd99bb23316097185c162fe2d98c503931bce912`
**Repo revision at review start:** `0c0040ff` on `main`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

I verified the working-tree file before review: SHA-256 is exactly `46ca3bb01d12ac7b31929549fd99bb23316097185c162fe2d98c503931bce912`, length is 842 lines, and repository revision is `0c0040ff` on `main`. I did not consult another reviewer’s output.

This is a strong diagnosis and a good architectural direction. The current closure really is broad; `/online` really closes over the same class; the attribution and application arithmetic substantially reproduce; the expected future sizes are honestly labeled hypotheses; and static capability modules plus generated entry points are promising.

It is not yet a good graduation plan. The proposed Online contract omits mandatory authorization behavior, its minimal runtime lacks the final-await authority fence, and Phase D tests the Full client rather than requiring the new client to pass the normative protocol corpus. Worse, the Diary fixture can satisfy the “authenticated” gates using dev identity assertions without exercising sessions, `auth/live`, or hosted sender constraints. The benchmark evidence is also not retained well enough for another reader to reproduce the comparative table.

The wrongheaded part is not the microclient idea. It is treating invalidation, authority fencing, and sender constraint as optional Full-client weight instead of behavior determined by the profile’s actual auth/deployment claims. The direction should be kept; the semantic contract and gates need substantial repair.

NOT READY

## 2. Strengths

- The as-built closure diagnosis is accurate. `index.mjs` is 10,832 lines, `SnapbackClient` begins at [packages/snapback-client/index.mjs:1578](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1578), and the root statically reaches query authorization, auth invalidation, sender proof, React-preparation machinery, RQS, stores, and result validation at [packages/snapback-client/index.mjs:16](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:16). The default store resolver statically imports browser, file, and memory implementations at [packages/snapback-client/rqs-store-default.mjs:19](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-store-default.mjs:19).

- The `/online` claim is correct: it exports the same `SnapbackClient` at [packages/snapback-client/online.mjs:8](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8). I independently rebuilt plausible root and `/online` fixtures and reproduced 250.9 kB raw / 70.1 kB gzip to displayed precision, the F2 attribution rows, all F3 counterfactual values, and the root-versus-subpath search result.

- The generated-artifact tax is real. Signal Desk imports the generated API, schema, complete function manifest, capability manifest, and routes at [demos/signal-desk/src/backends/snapback.ts:14](/Users/ccheever/projects/snapback/demos/signal-desk/src/backends/snapback.ts:14). A direct adapter build reproduced its reported raw and Brotli sizes and attribution to displayed precision.

- The incident-room sizes and arithmetic hold. The retained README reports raw bundles of 231.6 and 456.2 kB at [demos/pocketbase-snapback-bakeoff/README.md:49](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:49); recompressing the available outputs at gzip-9/Brotli-11 reproduces 70.3/61.0 and 131.2/111.8 kB. `60.9`, `59.5`, and roughly `98%` are arithmetically correct.

- Evidential limits and hypothetical sizes are generally stated honestly at [llp/0145-client-bundle-architecture.research.md:82](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:82), [llp/0145-client-bundle-architecture.research.md:135](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:135), and [llp/0145-client-bundle-architecture.research.md:623](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:623). I found no measured-versus-hypothetical conflation.

- The competitor descriptions are materially fair. PocketBase is a general direct Web API SDK, as its [official documentation](https://pocketbase.io/docs/how-to-use/) says. Convex distinguishes reactive WebSocket and HTTP clients in its [client documentation](https://docs.convex.dev/client/javascript/overview). Supabase’s decomposition into PostgREST, Auth, Realtime, Storage, and Functions is confirmed by its [official monorepo](https://github.com/supabase/supabase-js). I found no conclusion-changing competitor mischaracterization, and all named versions are real.

- The conservative rules that are present are good: mandatory fresh resnapshot on reconnect agrees with [llp/0053-authorization-invalidation.rfc.md:322](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:322), and refusing automatic retry of ambiguous non-idempotent mutations is sound.

- The warning against property mangling is exact. LLP 0063 records that the smaller candidate passed only one of three production checks at [llp/0063-partitime-platform-roadmap.plan.md:1841](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:1841).

## 3. Findings

### 1. BLOCKING — Online’s authorized-live contract omits mandatory invalidation semantics

**Section:** Summary, F7, Online profile, minimal runtime, Phase C/D.

**Evidence:** LLP 0145 offers an authorized live collection while assigning “advanced invalidation” to Full and describing Online primarily as blank-and-resnapshot at [llp/0145-client-bundle-architecture.research.md:47](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:47), [llp/0145-client-bundle-architecture.research.md:262](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:262), and [llp/0145-client-bundle-architecture.research.md:653](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:653).

That is insufficient for sessions-mode auth-scoped live data. LLP 0053 makes shrinking results durable, level-triggered obligations because losing a removal is a security failure; discharge occurs only after applying and acknowledging a sufficiently current snapshot at [llp/0053-authorization-invalidation.rfc.md:246](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:246). LLP 0095 requires exact scope/revision/witness matching, immediate quarantine, apply-before-ACK, terminal-delete fencing, duplicate re-ACK, and refusal to ACK foreign obligations at [llp/0095-client-lifecycle-and-conformance.spec.md:250](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:250). LLP 0096 requires `auth/live` whenever Online subscribes to auth-scoped live functions at [llp/0096-auth-profiles-for-protocol-clients.spec.md:543](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:543).

**Why it matters:** “Policy changed, therefore resnapshot” describes what to do after detecting a change. It does not reliably deliver or discharge the security event. A lost removal can leave forbidden rows visible indefinitely.

**Resolve:** Either constrain the first live spike to explicitly `authorityIndependent` functions, or require the complete `auth/live` offer, namespace, obligation, quarantine, resolution, terminal-delete, and apply-before-ACK protocol. Open question 3 should ask how to minimize that fixed behavior, not whether blanking can replace it.

### 2. BLOCKING — The minimal runtime lacks the mandatory final-await authority fence

**Section:** F7 and “Minimal runtime contract.”

**Evidence:** The proposed contract requires cancellation and abort-and-blank, but not a never-reused authority generation captured by every operation and checked immediately before publication at [llp/0145-client-bundle-architecture.research.md:671](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:671).

LLP 0059 requires every request, socket, subscription, callback, completion, and store write to capture authority and fence success, failure, timeout, and terminal-auth publication after its final await at [llp/0059-session-projection-and-client-barrier.spec.md:1679](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1679). The transition order is quiesce, blank, clear, durable transition, then fresh resume at [llp/0059-session-projection-and-client-barrier.spec.md:2101](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2101), and transport response parsing/publication repeats the fence at [llp/0059-session-projection-and-client-barrier.spec.md:2457](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2457). LLP 0053 identifies the exact delayed-callback repopulation defect at [llp/0053-authorization-invalidation.rfc.md:1512](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1512).

**Why it matters:** `AbortController` does not prove that underlying work or already-scheduled callbacks cannot complete. User-A work can publish after the transition to user B, repopulating state that was correctly blanked.

**Resolve:** Add a monotone per-client authority generation to the minimal contract. Every request, grant open, subscribe, socket callback, reconnect, error, and diagnostic side effect must capture it and compare before publishing. Add deterministic delayed A→B tests for every completion class. Cross-tab custody may remain a nonclaim; same-context fencing may not.

### 3. BLOCKING — Phase D never runs the new client against the normative conformance corpus

**Section:** “Recommended evidence program,” Phase D.

**Evidence:** The gates require positive application behavior and leave the existing Full client suite green; they never require the new Online implementation to pass protocol conformance at [llp/0145-client-bundle-architecture.research.md:731](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:731). This contradicts the document’s later statement that shared fixtures should own cross-profile behavior at [llp/0145-client-bundle-architecture.research.md:780](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:780).

LLP 0095 says its abstract model—not JS internals—is normative at [llp/0095-client-lifecycle-and-conformance.spec.md:28](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:28). The committed format-v3 corpus is normative for clients and routed by arm×lane tuple at [llp/0095-client-lifecycle-and-conformance.spec.md:345](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:345). It covers version guards, demand teardown, reconnect/supersession, malformed durable bytes, authorization invalidation, terminal no-resurrection, grant loss, heartbeat, freshness, and backoff.

**Why it matters:** The spike can pass all ten gates while leaking server demand, silently remaining stale, accepting a predecessor frame, mishandling grant loss, or violating auth resolution ordering. This repeats F5’s “byte counter green while behavior broken” failure.

**Resolve:** Declare the exact arm×lane×auth tuple claimed by the spike and require every routed format-v3 fixture to pass against the thin client. Add real-browser and per-OS Expo carrier receipts where claimed, including teardown/resource assertions.

### 4. BLOCKING — A dev-identity fixture can graduate a generic authenticated profile

**Section:** Phase C/D, Online profile, open question 8.

**Evidence:** Phase C reimplements the Diary 0050 application at [llp/0145-client-bundle-architecture.research.md:714](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:714). That app dropped to raw `SnapbackClient` calls with a `userId` on each operation; real sessions were explicitly excluded at [diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:135](/Users/ccheever/projects/snapback/diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:135), and it makes no hosted claim at [diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:226](/Users/ccheever/projects/snapback/diaries/0050-pocketbase-snapback-npm-bakeoff.diary.md:226). Thus “authenticated,” cross-user, and logout checks can pass without sessions, `auth/rr`, `auth/live`, or sender proof.

Online also explicitly excludes sender proof and asks what is mandatory for hosted deployments at [llp/0145-client-bundle-architecture.research.md:653](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:653) and [llp/0145-client-bundle-architecture.research.md:816](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:816). The high-level answer is already decided: hosted production requires `auth/rr`, conditional `auth/live`, and `auth/sender` for browser-class clients at [llp/0096-auth-profiles-for-protocol-clients.spec.md:685](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:685). LLP 0060 allows no hosted bearer-v1 waiver at [llp/0060-hosted-auth-security.rfc.md:465](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:465).

**Why it matters:** A dev-only size floor could be promoted as a browser Online profile even though it is ineligible for hosted use and has not exercised first-party session safety.

**Resolve:** Split evidence into three explicit profiles: local dev identity; sessions with `auth/rr + auth/live`; and hosted browser with those plus `auth/sender`. If the first microclient is local-only, state that hard nonclaim. Sender proof belongs to deployment composition, not exclusively to Full.

### 5. MATERIAL — The comparative benchmark is not reproducible from the repository

**Section:** “Method and limits,” F1–F4, Confidence.

**Evidence:** The method gives esbuild and compression settings but only says “ordinary browser client” and “exercised enough API” at [llp/0145-client-bundle-architecture.research.md:86](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:86). No committed artifact supplies exact package specifiers, entry source/API retention, externals, lock/integrities, alias stubs, esbuild options, compression code, metafiles, raw byte counts, output hashes, or a receipt. I found no committed fixture for the twelve comparison rows, five Supabase slices, F3 stubs, or attribution results.

The existing closure test does not minify or measure; it checks only that browser bundling succeeds and no `node:` import survives at [packages/snapback-client/browser-closure.test.mjs:16](/Users/ccheever/projects/snapback/packages/snapback-client/browser-closure.test.mjs:16). Nevertheless, Confidence calls the measurements “Repeatable package and application bundles” at [llp/0145-client-bundle-architecture.research.md:825](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:825).

**Why it matters:** Import shape is load-bearing for modular clients. Even plausible Snapback entry texts changed the displayed last Brotli decimal. A reader cannot determine whether the competitor rows retained equivalent features or reproduce the exact values.

**Resolve:** Commit locked source fixtures for every row/slice/stub, one runner/config, compression implementation and unit convention, metafiles, output hashes, package integrities, tool/runtime versions, and a machine-readable receipt. Until then, lower “High/Repeatable” confidence to “independently reconstructed by the author; fixture not retained.”

### 6. MATERIAL — Architecture profiles are conflated with capability classes and are not mechanically defined

**Section:** Proposed architecture, Phase A, migration.

**Evidence:** The document promises not to change Online/Parity claims, yet uses “Full/Parity” and associates RQS, retention, outbox, and replay with Parity at [llp/0145-client-bundle-architecture.research.md:645](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:645), [llp/0145-client-bundle-architecture.research.md:691](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:691), and [llp/0145-client-bundle-architecture.research.md:767](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:767).

Existing authorities keep these axes separate. Retention or queue support without local execution remains Online at [llp/0043-offline-replay-retention.rfc.md:55](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:55); the current JS/React phase explicitly remains Online at [llp/0129-local-first-program.plan.md:405](/Users/ccheever/projects/snapback/llp/0129-local-first-program.plan.md:405); Parity requires local handler execution at [llp/0012-headless-integration-contract.spec.md:579](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:579). Expo Online also has existing OS-specific receipt obligations at [llp/0064-native-client-surfaces.rfc.md:128](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:128).

The document says unsupported capabilities should fail at generation/typecheck, but defines no profile artifact, operation-to-capability derivation, arm/lane/auth tuple, or explicit claim/nonclaim matrix.

**Why it matters:** An authoring agent cannot mechanically know that an auth-scoped live operation requires `auth/live`, that hosted browser selection requires sender proof, or that an Expo closure lacks evidence required for the existing Expo Online claim.

**Resolve:** Use a distinct packaging name such as `micro` versus `full`. Generate a profile artifact joining selected operations, modules, arm×lane tuple, auth axes, carrier/OS, capability class, and explicit nonclaims. Codegen must reject an unfulfillable selection; runtime negotiation must reject target drift.

### 7. MATERIAL — Graduation does not measure the complete product closure or declared operational costs

**Section:** Evaluation criteria, Phase A/D, risks.

**Evidence:** The evaluation criterion requires raw/gzip/Brotli and parse/startup measurement at [llp/0145-client-bundle-architecture.research.md:302](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:302), and the risk section says reconnect bytes/time must be measured at [llp/0145-client-bundle-architecture.research.md:773](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:773). Phase D gates only gzip and no operational threshold at [llp/0145-client-bundle-architecture.research.md:731](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:731).

It also excludes React from the measured runtime even though the proposed paved road requires a React adapter. Today `@expo/snapback-react` imports the client root at [packages/snapback-react/index.mjs:11](/Users/ccheever/projects/snapback/packages/snapback-react/index.mjs:11). Phase C excludes assets despite assets being part of the motivating shared workout at [demos/pocketbase-snapback-bakeoff/README.md:10](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:10).

**Why it matters:** A 20 kB headless runtime can pass while the required React/auth adapter restores most of the original gap, lazy chunks make total download large, or conservative resnapshot creates unacceptable bandwidth and latency.

**Resolve:** Gate headless runtime, generated entry, runtime-plus-first-party React/auth composition, complete initial-route bytes, and total downloaded bytes separately. Pre-register parse/compile/startup and reconnect bandwidth/latency/request-count thresholds. Call Phase D a reduced headless-spike gate until the paved React and asset modules have their own evidence.

### 8. MATERIAL — The fate of runtime result validation is unstated

**Section:** F6, Option 4, minimal runtime, Phase D.

**Evidence:** Option 4 says validation moves to the build and Phase D checks only TypeScript/no casts at [llp/0145-client-bundle-architecture.research.md:436](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:436) and [llp/0145-client-bundle-architecture.research.md:739](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:739). The minimal runtime does not name runtime result validation.

Current React code validates authoritative and retained rows before publication at [packages/snapback-react/index.mjs:527](/Users/ccheever/projects/snapback/packages/snapback-react/index.mjs:527); registered group responses are validated at [packages/snapback-client/react-binding.mjs:1026](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:1026). LLP 0114 requires runtime egress validation before typed publication at [llp/0114-first-class-react-and-query-groups.spec.md:251](/Users/ccheever/projects/snapback/llp/0114-first-class-react-and-query-groups.spec.md:251).

**Why it matters:** TypeScript cannot validate runtime wire bytes. Removing the 8.6 kB generic validator may be legitimate if server validation is accepted as the trust boundary, but that is a semantic decision, not build-time optimization.

**Resolve:** Decide explicitly. Either generate operation-specific validators and gate malformed query/live/mutation/action payloads, or document and reconcile removal of client validation with the React contract and diagnostics.

### 9. MATERIAL — “Move React binding” misdescribes the current public boundary

**Section:** F2/F3, Option 1, Phase B.

**Evidence:** The real package already exists as `@expo/snapback-react` at [packages/snapback-react/package.json:2](/Users/ccheever/projects/snapback/packages/snapback-react/package.json:2), and actual React imports live there at [packages/snapback-react/index.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-react/index.mjs:1). The measured `packages/snapback-client/react-binding.mjs` imports no React; it owns deployment admission, result-contract validation, auth-scope checks, RQS, and prepared query-group machinery at [packages/snapback-client/react-binding.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:1). `SnapbackClient.prepareReactBinding()` is public at [packages/snapback-client/index.mjs:4280](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:4280).

**Why it matters:** The 8.7 kB stub proves an upper bound from deleting preparation behavior. It does not prove the same saving while preserving the current class contract, as Phase B promises. The recommendation also names nonexistent `@snapback/react`.

**Resolve:** Use the real package name, distinguish React runtime from client-side preparation/admission, and replace the deletion stub with a production-shaped extraction that preserves or explicitly migrates `prepareReactBinding`.

### 10. MATERIAL — Firestore Lite, the closest direct precedent, is omitted

**Section:** Competitor analysis and option space.

**Evidence:** LLP 0145 measures full Firestore but never measures or discusses Firestore Lite. Firebase describes [Firestore Lite](https://firebase.google.com/docs/firestore/solutions/firestore-lite) as a standalone REST-only, modular SDK specifically trading away offline caching, latency compensation, query resumption, and snapshot listeners for size and startup improvements.

**Why it matters:** This is almost exactly the Full/Online semantic-split precedent the document is proposing. It supplies direct evidence about naming omissions, maintaining two profiles, and distinguishing request-only from live behavior. Convex’s separately documented HTTP and reactive clients are a second relevant precedent.

**Resolve:** Add a Firestore Lite benchmark row and architectural analysis. Treat it as an operations-only floor, not evidence for the size of Snapback’s live/auth runtime.

### 11. MATERIAL — Compact operation identifiers ambiguously imply a wire change

**Section:** Option 4 and “Codegen can become opaque.”

**Evidence:** Option 4 proposes compact operation identifiers and later says human names should survive “even if the wire uses compact identifiers” at [llp/0145-client-bundle-architecture.research.md:436](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:436) and [llp/0145-client-bundle-architecture.research.md:786](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:786), while the document disclaims a wire change.

Current v1 routes identify operations by `{name}` at [llp/0094-wire-envelope-contract.spec.md:153](/Users/ccheever/projects/snapback/llp/0094-wire-envelope-contract.spec.md:153), and LLP 0094 explicitly says there is no new expected-operation carrier at [llp/0094-wire-envelope-contract.spec.md:973](/Users/ccheever/projects/snapback/llp/0094-wire-envelope-contract.spec.md:973).

**Why it matters:** A numeric on-wire ID is a protocol and rollout decision; its hypothetical byte savings cannot support the current-wire recommendation without separate evidence.

**Resolve:** State that compact indices are generated client-local constants which still emit current named routes. If numeric IDs are required on wire, exclude those savings from this program.

### 12. DETAIL — Several comparison and matrix labels need reconciliation

**Section:** F1, application corroboration, options matrix.

**Evidence and resolution:**

- Supabase’s decomposition omits Functions, although the full package directly depends on Auth, Functions, PostgREST, Realtime, and Storage; the committed lock shows that family at [demos/backend-bakeoff/arms/todo/supabase/work/package-lock.json:758](/Users/ccheever/projects/snapback/demos/backend-bakeoff/arms/todo/supabase/work/package-lock.json:758). Add Functions or call the slice table illustrative and non-additive.

- Signal Desk uses Supabase 2.57.4 and Convex 1.42.3 at [demos/signal-desk/package.json:35](/Users/ccheever/projects/snapback/demos/signal-desk/package.json:35), while the isolated table uses newer versions. The PocketBase app uses SDK 0.27.0 at [demos/pocketbase-snapback-bakeoff/README.md:3](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:3), versus 0.27.1 in the isolated row. Add versions and entry points to application rows.

- “Matched applications” should be “provider-native implementations of the same workout,” matching [demos/pocketbase-snapback-bakeoff/README.md:10](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:10).

- Option 5 says 5–15 kB while the matrix says 5–20 kB at [llp/0145-client-bundle-architecture.research.md:506](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:506) and [llp/0145-client-bundle-architecture.research.md:635](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:635). Option 2’s prose preserves current-class size for Full, while its matrix tops out at 60 kB. Reconcile the scopes.

## 4. Suggestions

- Add a conformance-specialized kernel option: implement one normative state-machine core, then partially evaluate or tree-shake it against the generated arm×lane×auth profile. This avoids maintaining two handwritten correctness implementations while pursuing microclient size.

- Add a differential trace oracle. Run Full and Micro against the same scripted server/fault schedule and compare observable actions for every behavior both claim. Permit differences only where the Micro profile explicitly declares resnapshot, unknown mutation outcome, or another simplification.

- Publish a semantic byte ledger: fixed core cost plus marginal bytes for live, `auth/live`, sessions, sender proof, React, offline, assets, and diagnostics. Have codegen emit an import-cause receipt tying each byte-bearing module to a selected capability.

- Use the existing Swift state machine and format-v3 harness as independent clean-room evidence when designing the microclient, rather than deriving a second implementation only from the current JS class.

- Remove `Full/Parity` as a combined label. Package architecture, capability class, protocol tuple, auth profile, and carrier evidence are separate axes.

## 5. Open questions

1. What exact arm×lane×auth tuple does the first spike claim?

2. Is its live query explicitly `authorityIndependent`, or does the spike implement full `auth/live`?

3. Is the first deliverable local dev only, sessions-capable, or hosted-browser capable? These need separate measurements and claims.

4. What same-context authority-generation and final-publication fence will every async path use?

5. Will Micro retain runtime result validation, use generated specialized validators, or intentionally trust server-side egress validation?

6. Are compact operation IDs client-local only, or is a new wire representation being contemplated?

7. What generated artifact mechanically maps operations to modules, protocol tuples, auth profiles, carriers, and nonclaims?

8. What complete-application byte, parse/startup, and reconnect-cost thresholds must pass before “productizing” means more than funding another experiment?

9. Where will the exact benchmark fixtures, lock/integrity data, metafiles, outputs, and receipts live?

10. Which existing Expo Online obligations are intentionally outside the reduced profile, and what distinct name prevents users and agents from confusing the two?

## 6. Verdict

NOT READY

## Round 2 — 2026-08-01 (delta-scoped)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** fresh CLI runner, delta-scoped. Permitted to read exactly one prior
artifact — its own family's round-1 section above — and no other file under
`llp/reviews/`; no `super-refine` path; blind to this document's fable
artifact, which was reviewing the same revision concurrently. SHA-pinned target
and instruction capsule.
**Instruction capsule SHA-256:** `17c8035e9d1d6758fb3035e5252aa5ddab231a5b1dc2053fd29fcb2dd57bc676`
**Target:** `llp/0145-client-bundle-architecture.research.md` (v0.2, 1,282
lines, Draft, uncommitted working tree)
**Target SHA-256:** `41b9391b608f7d2d0173cd8d7ac283302ef4daac9b613cff19053422a5cab94c`
**Repo revision at review start:** `0c0040ff` on `main`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

I verified the working-tree target before review: SHA-256 is exactly `41b9391b608f7d2d0173cd8d7ac283302ef4daac9b613cff19053422a5cab94c`, and it is 1,282 lines. I read the entire revision and only the permitted prior-review artifact under `llp/reviews/`.

Several load-bearing claims checked true:

- The root and `/online` closures still reach the same class, and I independently reproduced 250.9/70.1/60.2 kB raw/gzip/Brotli to displayed precision. The class begins at [`packages/snapback-client/index.mjs:1578`](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1578), while `/online` re-exports it at [`packages/snapback-client/online.mjs:8`](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8).
- F2 attribution, all F3 counterfactuals, and the root/direct-search comparison reproduce within 0.1 kB.
- The retained incident-room outputs recompress to 231.6/70.3/61.0 and 456.2/131.2/111.8 kB; the raw figures are recorded at [`demos/pocketbase-snapback-bakeoff/README.md:49`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:49).
- The authority fence, invalidation protocol, hosted sender floor, and per-OS evidence requirements are accurately attributed to LLPs 0053, 0059, 0064, 0077, 0095, and 0096.
- The Swift core inventory is exactly 3,649 lines, and its committed test requires every fixture routed to `poll/local` or `live/local` to be genuinely evaluated at [`clients/swift/SnapbackClient/Tests/SnapbackClientTests/FixtureConformanceTests.swift:168`](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Tests/SnapbackClientTests/FixtureConformanceTests.swift:168). I could not freshly rebuild Swift in the read-only environment, so this is source-and-committed-evidence verification, not a fresh execution receipt.
- Firestore Lite is accurately characterized as REST-only and omitting offline caching, query resumption, latency compensation, and snapshot listeners. [Firebase’s official Firestore Lite documentation](https://firebase.google.com/docs/firestore/solutions/firestore-lite) supports that claim.

The revision still fails the readiness bar. It introduces a false terminal-invalidation simplification, and its graduation program can still pass while demand release, hosted sender proof, carrier behavior, or the complete product closure is broken.

I did not open the other model family’s artifact, so I did not verify the document’s second-family provenance claim. The competitor measurements also remain unreproducible from this repository, as the revision now correctly admits.

NOT READY

## 2. Disposition table

| Round-1 finding | Disposition | Justification |
|---|---|---|
| 1. Authorized-live invalidation | RESOLVED-BUT-NEW-DEFECT | The revision adds the obligation/ACK protocol, but then falsely says every obligation can be discharged by blanking and resnapshotting, which is invalid for `terminalDelete`. |
| 2. Final-await authority fence | RESOLVED | F7, minimal item 9, and gate 12 now require capture plus a final-publication fence across delayed completion classes. |
| 3. New-client conformance | PARTIALLY RESOLVED | Gate 11 adds the normative corpus, but that corpus has no normal unsubscribe fixture, and closure tests do not satisfy browser/Expo carrier evidence. |
| 4. Auth/deployment evidence | PARTIALLY RESOLVED | The three postures are separated honestly, but `auth/sender` has no graduation gate and hosted auth is not currently deployable. |
| 5. Benchmark reproducibility | RESOLVED | Reproducibility is honestly downgraded, Phase A requires retained fixtures and receipts, and Confidence marks the table non-reproducible. |
| 6. Packaging versus capability classes | PARTIALLY RESOLVED | The distinction is now explicit, but the artifact omits capability class and immutable surface/OS identity and continues using “Online” as a package-profile name. |
| 7. Complete closure and operational costs | PARTIALLY RESOLVED | Gates 13–14 add measurement, but the composed React/auth application has no pass ceiling and gate 13 explicitly permits measure-only treatment. |
| 8. Runtime result validation | RESOLVED | The trust-boundary choice is now explicitly named and left as an honest Research open question. |
| 9. React public boundary | PARTIALLY RESOLVED | F2/F3 and Option 1 are corrected, but Summary and F2 still call the client-side preparation module “React bindings.” |
| 10. Firestore Lite precedent | PARTIALLY RESOLVED | The architectural precedent is now analyzed correctly; the benchmark row and primary Related citation remain deferred. |
| 11. Compact operation identifiers | PARTIALLY RESOLVED | Option 4 and Risks make IDs client-local, but Option 9 retains an unqualified, protocol-suggestive “compact identifiers” claim. |
| 12. Comparison and matrix labels | PARTIALLY RESOLVED | Functions and Option 5 are fixed; the Convex version, entry-point inventory, “matched” terminology, and Option 2 matrix remain unreconciled. |

## 3. New findings

### BLOCKING — `terminalDelete` cannot be reduced to blank/resnapshot/ACK

**Section:** F7 and Minimal runtime contract.

**Evidence:** The revision says a thin client may “blank everything, resnapshot, ACK” at [`llp/0145-client-bundle-architecture.research.md:419`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:419), then says it may discharge “every obligation” through blanking and resnapshotting at [`:964`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:964).

A `terminalDelete` resolution has no snapshot. It requires destructive retirement, a terminal fence, then ACK; ordinary live traffic may not resurrect it, and recreation requires a fresh never-reused query identity. See [`llp/0095-client-lifecycle-and-conformance.spec.md:275`](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:275) and [`llp/0096-auth-profiles-for-protocol-clients.spec.md:253`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:253).

The minimal contract also omits the two required `auth/live` offer carriers and the retained `authorizationNamespace` lifecycle, specified at [`llp/0096-auth-profiles-for-protocol-clients.spec.md:206`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:206).

**Why it matters:** A terminally revoked materialization could be resubscribed or republished.

**Resolve:** Split snapshot and `terminalDelete` handling explicitly. Add the open-time offer, per-subscribe/unsubscribe header, namespace allocation/retention, terminal fence, duplicate re-ACK, and fresh-identity recreation requirements.

### BLOCKING — Gate 11 does not close the server-demand leak it claims to close

**Section:** Phase D.

**Evidence:** The revision says gates 11–14 close a client that leaks server demand at [`llp/0145-client-bundle-architecture.research.md:1101`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1101). LLP 0095 nevertheless makes explicit unsubscribe a normative normal-release obligation at [`llp/0095-client-lifecycle-and-conformance.spec.md:130`](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:130).

The committed 49-fixture corpus has no successful unsubscribe, release, or demand-teardown fixture; its declared coverage is summarized at [`schemas/live.wire-fixtures.v1.json:3`](/Users/ccheever/projects/snapback/schemas/live.wire-fixtures.v1.json:3). The current client has a distinct authenticated unsubscribe implementation at [`packages/snapback-client/index.mjs:5683`](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5683).

Phase D also asks only for browser/Expo closure tests, while LLP 0095 preserves LLP 0064’s per-OS evidence rule at [`llp/0095-client-lifecycle-and-conformance.spec.md:441`](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:441).

**Why it matters:** All fourteen gates can pass while subscriptions remain armed or while the claimed carrier fails lifecycle, reconnect, and authority-rotation behavior.

**Resolve:** Add subscribe→dispose/unsubscribe→server-resource-release fixtures with exact-owner and last-demand assertions. Require real-browser and independent iOS/Android receipts for claimed carriers.

### BLOCKING — A hosted-browser profile can graduate without exercising `auth/sender`

**Section:** Auth posture and Phase D.

**Evidence:** The document correctly requires `auth/sender` for hosted browsers at [`llp/0145-client-bundle-architecture.research.md:924`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:924), but gate 11 delegates to a corpus that explicitly defers `auth/sender` at [`schemas/live.wire-fixtures.v1.json:3`](/Users/ccheever/projects/snapback/schemas/live.wire-fixtures.v1.json:3). LLP 0096 confirms that sender fixtures are unseeded at [`llp/0096-auth-profiles-for-protocol-clients.spec.md:830`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:830).

The mandatory acceptance matrix instead lives in LLP 0077 at [`llp/0077-sender-constrained-browser-auth.spec.md:1237`](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:1237).

**Why it matters:** Issuance, key custody, HTTP/WS proof, nonce recovery, refresh, logout, and key-loss behavior can all be broken while every Phase D gate passes.

**Resolve:** Either hard-limit this graduation program to local/external-auth postures or add a posture-conditional gate requiring the new client to pass LLP 0077’s served-origin matrix.

### BLOCKING — The operational and “whole application” gates have no effective pass criterion

**Section:** Gates 13–14.

**Evidence:** Gate 13 first requires thresholds, then permits measure-only treatment at [`llp/0145-client-bundle-architecture.research.md:1124`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1124). Gate 14 merely reports a bundle and allows React/auth lanes to remain outside gate 1’s envelope at [`:1131`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1131).

Phase C excludes assets at [`:1061`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1061) and admits that its strict subset is not comparable to the motivating application at [`:1077`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1077). The actual workout includes auth, files, presence, and scheduled work at [`demos/pocketbase-snapback-bakeoff/README.md:10`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:10).

**Why it matters:** A 20 kB runtime can graduate even if the required React/auth composition restores the original payload or resnapshot costs are unacceptable.

**Resolve:** Set separate pass ceilings for the headless runtime, generated entry, React plus declared-auth composition, comparable complete workout, initial-route bytes, total downloaded chunks, and reconnect/startup costs.

### MATERIAL — The revised auth/accounting text makes three unsupported as-built claims

**Section:** Summary, Online profile, Phase C.

**Evidence:**

- “Neither is expensive” at [`llp/0145-client-bundle-architecture.research.md:82`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:82) is unsupported. The 4.0 kB sender number is module-own attribution, which the document itself says is not marginal composition cost at [`:274`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:274). The hosted facade imports the entire root at [`packages/snapback-client/hosted-browser.mjs:10`](/Users/ccheever/projects/snapback/packages/snapback-client/hosted-browser.mjs:10), and OQ4 admits the mandatory auth floor is unmeasured.
- Phase C says the existing incident-room arm includes first-party sessions auth at [`llp/0145-client-bundle-architecture.research.md:1077`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1077). It actually constructs a raw client and uses dev `userId` assertions at [`demos/pocketbase-snapback-bakeoff/snapback-incident-room/src/backend.ts:1`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/snapback-incident-room/src/backend.ts:1) and [`src/App.tsx:19`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/snapback-incident-room/src/App.tsx:19).
- “Pick one of three postures” does not mark hosted as currently unavailable. Every hosted auth profile is a current GAP at [`llp/0096-auth-profiles-for-protocol-clients.spec.md:473`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:473), and LLP 0060 states that no hosted auth deployment exists at [`llp/0060-hosted-auth-security.rfc.md:1131`](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:1131).

**Why it matters:** These claims overstate both feasibility and evidential equivalence.

**Resolve:** Remove “cheap,” label sessions as an unexercised desired capability, and mark hosted posture as ratified-but-currently-unavailable.

### MATERIAL — Option 10 contradicts its central amortization claim

**Section:** Option 10.

**Evidence:** Its Shape says the runtime is cached once across every application and origin at [`llp/0145-client-bundle-architecture.research.md:825`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:825). Its Cons correctly say modern cross-origin partitioning largely eliminates that benefit at [`:843`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:843). Chrome keys shared resources by top-level-site partition, confirming the latter account. [Chrome cache-partitioning documentation](https://developer.chrome.com/blog/http-cache-partitioning/)

**Why it matters:** The universal near-zero marginal-cost claim is false.

**Resolve:** Limit the claim to reuse within the same cache partition and identical immutable URL; keep all cross-application savings empirical.

### MATERIAL — Phase B routes an admin decision to a document that cannot make it

**Section:** Phase B.

**Evidence:** Phase B says it will take whichever admin shape LLP 0122 “settles on” at [`llp/0145-client-bundle-architecture.research.md:1043`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1043). LLP 0122 explicitly says it makes no decision at [`llp/0122-installed-product-coherence-and-packaging.research.md:49`](/Users/ccheever/projects/snapback/llp/0122-installed-product-coherence-and-packaging.research.md:49), and names LLP 0115 as execution owner and LLP 0041 as packaging owner at [`:738`](/Users/ccheever/projects/snapback/llp/0122-installed-product-coherence-and-packaging.research.md:738).

**Why it matters:** The implementation program can wait on or attribute authority to the wrong document.

**Resolve:** Use LLP 0122 only as option analysis and point the decision gate to LLP 0041/0115 or a named successor.

### MATERIAL — The “additive” migration proposes introducing an already-public subpath

**Section:** Migration and compatibility; surviving unchanged text.

**Evidence:** The document says an additive rollout would “introduce `/online`” at [`llp/0145-client-bundle-architecture.research.md:1143`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1143). `/online` already exists in the export map at [`packages/snapback-client/package.json:61`](/Users/ccheever/projects/snapback/packages/snapback-client/package.json:61) and exports the current full-semantics class at [`packages/snapback-client/online.mjs:8`](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8).

**Why it matters:** Replacing that subpath with a narrower client is not additive and may silently remove behavior.

**Resolve:** Add a new `/micro`-style subpath, or specify an explicit versioned breaking migration for `/online`.

### DETAIL — Inventory and terminology propagation remain incomplete

- Signal Desk is labeled Convex 1.43.0 at [`llp/0145-client-bundle-architecture.research.md:166`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:166), while the fixture pins 1.42.3 at [`demos/signal-desk/package.json:36`](/Users/ccheever/projects/snapback/demos/signal-desk/package.json:36). The Snapback 0.1.8 row is likewise unreconciled with Signal Desk’s workspace/file dependency state.
- Summary and F2 still say “React bindings” despite the corrected admission/preparation account; the client-side module imports no React at [`packages/snapback-client/react-binding.mjs:1`](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:1).
- Option 9’s “compact identifiers” remains unqualified at [`llp/0145-client-bundle-architecture.research.md:797`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:797).
- Option 2 says Full remains current-class size but its matrix still caps the option at 60 kB at [`:868`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:868).
- Firestore Lite’s primary URL and measured row remain absent.

## 4. Surviving-text judgement

The surviving text is not clean. A further round would still find real defects in:

- Migration’s existing `/online` collision;
- Summary/F2’s stale React-binding terminology;
- the profile artifact’s missing capability-class and immutable surface/OS axes;
- Option 2’s matrix scope;
- Option 9’s remaining identifier ambiguity; and
- the application version/entry-point inventory.

The loop has not reached a stopping signal.

## 5. Open questions

1. What exact `arm × lane + profile-set`, capability class, carrier, and OS identity does the first spike claim?
2. Is the first spike restricted to local dev or local sessions until a real hosted target and sender-proof gate exist?
3. What exact pass thresholds govern React plus auth, comparable complete-application bytes, total chunks, reconnect cost, and startup?
4. Will runtime results use generated validators, or will LLP 0114 be amended to accept server egress as the trust boundary?
5. What new package/subpath name preserves the existing `/online` contract?
6. Which owner—LLP 0041, LLP 0115, or a successor—decides admin packaging and the two-profile rollout?

## 6. Verdict

NOT READY
## Orchestrator verification and disposition (outside the verbatim body)

Every decisive claim was checked against the tree before any fix was applied.
All verified; none refuted.

- **`terminalDelete`** — confirmed at `llp/0095-client-lifecycle-and-conformance.spec.md:275-280`:
  "A `terminalDelete` resolution carries no snapshot… Atomically destroy the
  exact materialization, install its terminal fence/live boundary, and enter
  `TERMINAL_DELETED`; only after that destructive commit succeeds may the
  client acknowledge its exact token." The v0.2 sentence permitting every
  obligation to be discharged by blanking and resnapshotting was false. Fixed
  in v0.4 by splitting the two resolution paths in both §F7 and the minimal
  contract.
- **Unsubscribe is normative** — confirmed at `llp/0095:130`, T-UNSUB: "explicit
  unsubscribe on normal shutdown and backgrounding. This is a conformance
  obligation, not etiquette," and release "must present the subscription's
  establishing live owner."
- **The corpus does not cover demand release or `auth/sender`** — confirmed
  from the corpus's own coverage string at `schemas/live.wire-fixtures.v1.json:3`.
  It lists terminal delete and no-resurrection, quarantine, duplicate re-ACK,
  grant-loss recovery and much else, but no successful unsubscribe/release
  fixture, and states "`auth/sender` deliberately deferred per LLP 0096 §5."
  Gate 11's delegation was therefore insufficient on exactly the two axes
  Codex named. Fixed by adding gates 11a, 11b, and 12a.
- **Hosted is ratified but unavailable** — confirmed at LLP 0096 §2.6's
  verified arm matrix: every profile is "**not negotiable**" on the hosted
  Cloudflare arm, which "currently has **no sessions surface at all**." This is
  the most consequential correction in round 2 and was applied in full.
- **LLP 0122 makes no decisions** — confirmed at
  `llp/0122-installed-product-coherence-and-packaging.research.md:738`: "LLP
  0115 CV-1 is the execution owner of the external install path, and this
  document is research input to it: evidence consolidation and option analysis,
  no decisions. LLP 0041 remains the lead owner of packaging." Phase B's
  routing was wrong and is corrected.
- **`/online` already exists** — confirmed independently by the orchestrator in
  round 1 (`packages/snapback-client/package.json:61`,
  `packages/snapback-client/online.mjs:8`, and a measured closure identical to
  the root's). This is surviving v0.1 text that the Fable family judged clean,
  so the finding also resolves round 2's split verdict against stopping.
- **`hosted-browser.mjs` imports the client root** — confirmed at
  `packages/snapback-client/hosted-browser.mjs:10`.
- **The incident-room arm uses a raw client with dev `userId`** — confirmed at
  `demos/pocketbase-snapback-bakeoff/snapback-incident-room/src/backend.ts:5`
  (`new SnapbackClient(snapbackBasePath)`) and `src/App.tsx:23,32,39`
  (`userId: currentUser.id`). The v0.2 claim that the arm's contract includes
  first-party sessions auth was wrong and is corrected.

Two dispositions recorded against the reviewer rather than the document:

- Codex's DETAIL on the Convex row and on "React bindings" had already been
  applied in v0.3 from the Fable family's independent round-2 findings, before
  this review was received. Both families found them; neither saw the other.
- Codex could not verify the document's second-family provenance claim under
  blindness, and said so. The orchestrator confirms it — see the corresponding
  note in the fable artifact.


## Round 3 — 2026-08-01 (delta-confined)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** fresh CLI runner, delta-confined. Permitted to read exactly one
prior artifact — its own family's sections above — and no other file under
`llp/reviews/`; no `super-refine` path; blind to this document's fable
artifact, which was reviewing the same revision concurrently. SHA-pinned target
and instruction capsule.
**Instruction capsule SHA-256:** `914ef464a193a202905c0710f70a210149332e9e1d2dbc13681d4a8dcd04466b`
**Target:** `llp/0145-client-bundle-architecture.research.md` (v0.4, 1,413
lines, Draft, uncommitted working tree)
**Target SHA-256:** `cb3a0bad234b1dd963614d995a36ce799e8ab4b81d0619226ebde6c07e952b42`
**Repo revision at review start:** `0c0040ff` on `main`
**Status:** completed
**Verdict:** NOT READY

**Concurrency note, recorded by the reviewer itself:** the shared working-tree
file changed during this review (the orchestrator was applying the other
family's round-3 DETAILs). The reviewer detected this, made no edits, and
pinned every citation to the requested 1,413-line snapshot. Its findings are
therefore against v0.4, and were applied on top of v0.5.

## Verbatim review

## 1. Overall assessment

I verified and read the complete requested snapshot: SHA-256 `cb3a0bad234b1dd963614d995a36ce799e8ab4b81d0619226ebde6c07e952b42`, 1,413 lines, against `0c0040ff` on `main`. I opened only the permitted Codex review artifact and no `super-refine` file. `./ref-check --verbose` passed with zero errors.

The shared working-tree file changed during review. At handoff it is 1,443 lines with SHA `3bb805f80416c4a2429749c9e041b666ac2e5e660e6ba9abc138861eb33d8a43`. I made no edits. This review and every `0143@cb3:` citation below apply strictly to the requested 1,413-line snapshot, not the newer working-tree revision.

Load-bearing claims checked true:

- I reproduced the root and `/online` closures at approximately 250.9/70.1/60.2 kB raw/gzip/Brotli; `/online` re-exports the same class at [online.mjs:8](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8), and its public export already exists at [package.json:61](/Users/ccheever/projects/snapback/packages/snapback-client/package.json:61).
- The retained application bundles recompress to approximately 231.6/70.3/61.0 kB and 456.2/131.2/111.8 kB, consistent with [the bakeoff record](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:49). The F2/F3 counterfactuals also reproduced within displayed precision.
- The React correction is accurate: [react-binding.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:1) is admission/preparation code with no React import; actual React ownership begins in [snapback-react/index.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-react/index.mjs:1).
- The `terminalDelete` split, exact-owner unsubscribe obligation, and final-await authority fence now agree with [LLP 0095](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:130) and [LLP 0059](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1625). Current unsubscribe is a distinct path at [index.mjs:5683](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5683).
- The Swift core inventory is 3,649 lines, and its conformance test genuinely evaluates routed fixtures at [FixtureConformanceTests.swift:152](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Tests/SnapbackClientTests/FixtureConformanceTests.swift:152). I did not freshly rebuild Swift in this read-only environment.
- Firestore Lite’s architectural description is accurate and appropriately labeled unmeasured; Firebase describes the same REST-only omissions in its [official Firestore Lite documentation](https://firebase.google.com/docs/firestore/solutions/firestore-lite).
- Option 10’s new cache-partition bound is accurate according to [Chrome’s cache-partitioning documentation](https://developer.chrome.com/blog/http-cache-partitioning/).
- The `/online` migration correction, RQS-default account, bounded Option 10 language, Convex version disclosure, and React terminology now propagate consistently.

Unverifiable items remain honestly labeled: competitor byte fixtures are not retained, so I could verify public architecture but not reproduce those exact byte rows. I also did not inspect the other model family’s review or provenance claim because the blindness rule forbade it.

The revision makes substantial real corrections, but it still contains false as-built hosted claims, malformed posture/carrier requirements, an invalid cross-tab nonclaim for sessions/hosted auth, and graduation paths that can pass without exact deployment identity, actions, runtime result validation, or a comparable complete application.

NOT READY

## 2. Disposition table

All target references in these tables are to `0143@cb3`.

### Carried Round-1 findings

| ID | Disposition | Justification |
|---|---|---|
| 1. Authorized-live invalidation | RESOLVED-BUT-NEW-DEFECT | Snapshot and `terminalDelete` paths are now correctly separated at `0143@cb3:434-458,1019-1029`, but minimal item 11 is posture-independent and omits the WebSocket offer restatement required for sessions live. |
| 2. Final-await authority fence | RESOLVED | F7, minimal item 9, and gate 12 consistently require authority-generation capture and final-publication checks. |
| 3. New-client conformance | RESOLVED-BUT-NEW-DEFECT | Gates 11/11a add the corpus and demand-release proof, but gate 11b now collapses independent browser/iOS/Android claims and specifies an incomplete receipt. |
| 4. Auth/deployment evidence | RESOLVED-BUT-NEW-DEFECT | Three postures and conditional sender gate 12a were added, but the revised claim that no hosted Rust target exists is false, and sessions/hosted custody omits mandatory cross-tab behavior. |
| 5. Benchmark reproducibility | RESOLVED | The limitations are honest, and Phase A requires retained fixtures, locks, metafiles, and receipts. |
| 6. Packaging versus capability classes | PARTIALLY RESOLVED | The distinction is explicit, but the generated profile artifact still omits capability class, immutable surface/OS profile, and source/artifact digests required by [LLP 0064](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:128). |
| 7. Complete closure and operational costs | PARTIALLY RESOLVED | Gate 13 now requires ceilings, but gate 14 still compares a declared strict subset against full-workout baselines. |
| 8. Runtime result validation | PARTIALLY RESOLVED | The trust-boundary decision is honestly named, but no graduation gate requires either validators or an accepted LLP 0114 amendment. |
| 9. React public boundary | RESOLVED | Admission/preparation and React runtime ownership are now described accurately. |
| 10. Firestore Lite precedent | PARTIALLY RESOLVED | The primary source, architectural analysis, and an explicitly unmeasured row were added; no reproducible measured row exists yet. |
| 11. Compact operation identifiers | RESOLVED | Options 4 and 9 now make identifiers client-local and disclaim a wire change. |
| 12. Comparison and matrix labels | PARTIALLY RESOLVED | Most propagation is fixed, but exact application entries and Snapback dependency identity remain absent, and “matched applications” remains too strong. |

### Round-2 new findings

| ID | Disposition | Justification |
|---|---|---|
| R2-1. `terminalDelete` and missing carriers | RESOLVED-BUT-NEW-DEFECT | Terminal retirement is fixed, but the added carrier item is now over-broad for dev and incomplete for sessions stream upgrade. |
| R2-2. Demand release and carrier evidence | RESOLVED-BUT-NEW-DEFECT | Explicit unsubscribe and server-release assertions are present; gate 11b misstates independent per-carrier/per-OS evidence as a browser+iOS+Android bundle. |
| R2-3. Hosted profile without sender proof | RESOLVED-BUT-NEW-DEFECT | Gate 12a correctly requires LLP 0077 conditionally, but the accompanying “target does not exist” correction contradicts LLP 0098 and the served receipt. |
| R2-4. Operational and whole-application criteria | PARTIALLY RESOLVED | Operational and composition ceilings are now required, but no comparable full workout is gated. |
| R2-5. Unsupported auth/accounting claims | RESOLVED-BUT-NEW-DEFECT | The cost claim and Diary description are fixed; the replacement hosted-availability claim is false. |
| R2-6. Option 10 amortization | RESOLVED | Reuse is consistently bounded to an identical immutable URL within one cache partition. |
| R2-7. Phase B admin owner | RESOLVED-BUT-NEW-DEFECT | The text no longer waits on LLP 0122, but incorrectly treats the choice as open after LLP 0115 recorded the CLI-fold decision. |
| R2-8. Existing `/online` migration | RESOLVED | The document now requires a new subpath or an explicit breaking migration. |
| R2-9. Inventory/terminology propagation | PARTIALLY RESOLVED | React, Convex, identifiers, and matrix ranges are fixed; Snapback application version/entry inventory and “matched” terminology remain incomplete. |

## 3. New findings

### BLOCKING — The new hosted-availability correction conflates the Cloudflare GAP with the Rust hosted target

**Section:** Online profile and OQ19, `0143@cb3:980-991,1387-1390`.

**Evidence:** The document says no hosted deployment or target exists and that the first spike cannot claim hosted “no matter how it is built.” LLP 0096 says only the Cloudflare arm lacks sessions, then explicitly defines “Hosted production” as the Rust server under hosted admission at [LLP 0096:471](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:471).

LLP 0098 defines the concrete `loopback-terminated-single-instance.v1` adapter at [LLP 0098:44](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:44), records sessions under hosted admission at [LLP 0098:680](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:680), and records a 43/43 served-origin matrix at [LLP 0098:891](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:891). The receipt itself reports `ok: true` at [hosted-sender-matrix…json:87](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/acceptance/results/hosted-sender-matrix.v0.served-20260727.json:87), and the implementation installs verified hosted admission before listener binding at [src/cli.rs:2574](/Users/ccheever/projects/snapback/src/cli.rs:2574).

LLP 0098 remains Draft and explicitly claims no `hostedAuthCapable` capability at [LLP 0098:956](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:956). The served window also expired. Those limitations do not make the target nonexistent.

**Why it matters:** The false premise can defer feasible hosted measurement, omit an applicable governing LLP, and distort the architecture’s auth-cost decision.

**Resolve:** Add LLP 0098 to Related; distinguish Cloudflare unavailability, the deployable Rust hosted-admission target, expired serving state, and the still-unratified capability claim. Let the spike target that Rust profile or give another explicit reason to defer hosted.

### BLOCKING — The minimal carrier contract is neither posture-scoped nor complete

**Section:** Minimal runtime items 11–12 and auth postures, `0143@cb3:966-970,1030-1043`.

**Evidence:** Item 11 makes `auth/live` carriers mandatory for every credible microclient, and the following paragraph says items 9–12 are all non-optional mechanisms. That contradicts the document’s local-dev posture. LLP 0096 says dev mode requires no offers and claims no auth profile at [LLP 0096:533](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:533) and [LLP 0096:570](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:570). The Swift client likewise emits auth offers only when it has a session bearer at [SnapbackClient.swift:1023](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift:1023).

Conversely, for sessions auth/live the item names open-time and subscribe/unsubscribe carriers but omits the stream-upgrade restatement. LLP 0096 requires the four axis tokens on WebSocket upgrade at [LLP 0096:128](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:128) and summarizes that gate at [LLP 0096:496](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:496). Swift sends both auth tokens at [SnapbackClient.swift:1127](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift:1127).

**Why it matters:** The proposed “minimal contract” overstates the local-dev byte floor while permitting a nonconforming sessions implementation.

**Resolve:** Make items conditional on the declared posture and operation set:

- local dev: no auth-profile claim or mandatory offers;
- sessions with auth-scoped live: complete `auth/rr` and `auth/live` HTTP, open-body, upgrade-token, namespace, invalidation, ACK, and unsubscribe contract;
- hosted browser: the sessions requirements plus sender-constrained custody and proof.

### BLOCKING — Sessions and hosted-browser auth cannot disclaim cross-tab custody

**Section:** F7 and Online profile, `0143@cb3:419-420,459-467,950-970`.

**Evidence:** The document says cross-tab custody may remain a nonclaim and gives the profile “no … cross-tab claim,” while also admitting sessions and hosted-browser postures.

For sessions-mode browser custody, LLP 0059 requires one shared durable record and cross-context owner at [LLP 0059:1625](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1625), Web Locks or fenced CAS ownership at [LLP 0059:1904](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1904) and [LLP 0059:2039](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2039), and two-context delayed-race acceptance at [LLP 0059:2557](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2557). Sender-constrained browser custody additionally requires multi-tab generation/nonce coordination at [LLP 0077:999](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:999).

The shipped proof exercises takeover and stale-publication fencing at [auth-custody-indexeddb.test.mjs:239](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-custody-indexeddb.test.mjs:239) and [auth-custody-indexeddb.test.mjs:475](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-custody-indexeddb.test.mjs:475).

**Why it matters:** Two tabs can race credentials, nonces, authority transitions, or publication under the predecessor identity. This is a security contract, not optional polish.

**Resolve:** Scope the nonclaim to local-dev or externally owned bearer custody. Sessions and hosted-browser compositions must include the governing durable coordinator, Web Locks/CAS fencing, takeover behavior, two-tab acceptance, and their byte cost.

### BLOCKING — Exact build/operation identity is promised but neither specified nor gated

**Section:** F7, Option 4, Online profile, and Phase D, `0143@cb3:396-424,673-703,959,1007-1011,1162-1246`.

**Evidence:** The document assigns schema/function identity to server admission, promises exact build/operation identity, and says the server rejects operation-identity mismatches. Option 4 simultaneously retains named routes and disclaims any expected-operation wire carrier.

Generated references contain `appId`, stable id, implementation hash, and contract hashes at [codegen/index.mjs:6510](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6510). But query and action invocation reduce them to `ref.name` at [client/index.mjs:4869](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:4869), [client/index.mjs:5063](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5063), and [client/index.mjs:10608](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:10608). The server route similarly invokes by path name at [src/server.rs:17664](/Users/ccheever/projects/snapback/src/server.rs:17664).

That matches the deliberate no-carrier decision in [LLP 0108:701](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:701) and [LLP 0094:973](/Users/ccheever/projects/snapback/llp/0094-wire-envelope-contract.spec.md:973). Existing exact compatibility instead comes from client-side whole-artifact admission at [react-binding.mjs:205](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:205) and [react-binding.mjs:249](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:249).

No Phase D gate supplies a wrong app, stale bundle, same-named changed operation, changed result contract, or wrong function-hash negative.

**Why it matters:** A stale generated client can execute a same-named but changed operation while every listed graduation gate passes.

**Resolve:** Specify a generated-client admission handshake using the current `/inspect`/deployment identity and exact generated references, with fail-closed negative gates before invocation/publication. Alternatively, propose and review a new wire carrier. Correct the “server rejects” wording to match the selected mechanism.

### BLOCKING — Actions can be broken while all graduation gates pass

**Section:** Online profile, Phase C, and gate 5, `0143@cb3:952,1124-1133,1169-1176`.

**Evidence:** The profile and spike promise authenticated actions, but gate 5 covers only query, mutation, and live. Actions use a distinct route at [client/index.mjs:5063](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5063), and the motivating incident-room acceptance invokes one at [acceptance.live.mjs:153](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/snapback-incident-room/acceptance.live.mjs:153). Their retry semantics are distinct: LLP 0133 makes actions nondeterministic and never auto-replayed at [LLP 0133:691](/Users/ccheever/projects/snapback/llp/0133-local-settlement.spec.md:691).

**Why it matters:** The productization program can certify a client whose promised action path is absent, misroutes, leaks authorization, or blindly retries an indeterminate action.

**Resolve:** Add positive and negative action acceptance, including authorization, result handling, lost-response/indeterminate outcome, and no-blind-retry assertions—or remove action support from the initial profile.

### MATERIAL — Gate 11b and OQ17 collapse independent evidence domains

**Section:** Gates 11b/12a and OQ17, `0143@cb3:1213-1228,1380-1383`.

**Evidence:** Gate 11b says any claimed carrier needs a real-browser receipt plus independent iOS and Android receipts. LLP 0064 instead says evidence is independent per OS at [LLP 0064:33](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:33), with a complete seven-fact receipt and immutable identity fields at [LLP 0064:128](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:128). A browser claim does not require Android, and an iOS claim establishes neither browser nor Android.

OQ17 then says moving demand-release and `auth/sender` fixtures into LLP 0095 would benefit every client, including Swift. Demand release is shared, but LLP 0096 deliberately keeps sender fixtures browser-routed because off-browser sender custody is undefined at [LLP 0096:457](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:457).

**Why it matters:** The program can either block valid independent tuples or encode browser custody as a native-client obligation.

**Resolve:** Make gate 11b tuple-specific and require the full receipt facts for each claimed carrier/OS. Split OQ17: demand release belongs in the shared corpus; sender remains browser/profile-routed unless an off-browser specification lands.

### MATERIAL — Phase B asks who decides an admin choice that is already decided

**Section:** Phase B and OQ18, `0143@cb3:1113-1120,1384-1386`.

**Evidence:** The revision routes the admin decision to LLP 0041/0115 or a successor. LLP 0115 already records decision 4: the admin surface folds into the CLI and the served path remains the external-tooling fallback at [LLP 0115:479](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:479); CV-1’s exit is satisfied at [LLP 0115:416](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:416).

The tree still has two distinct implementation surfaces that need migration, not another ownership decision: embedded admin methods in [client/index.mjs:4685](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:4685) and the privileged [AdminClient](/Users/ccheever/projects/snapback/packages/snapback-admin-client/index.mjs:1).

**Why it matters:** Phase B can duplicate a settled decision or conflate removal of app-graph admin methods with the separate privileged client.

**Resolve:** State the existing CLI-fold decision and route Phase B to executing it. Name separately which embedded methods and privileged package/export surfaces move or remain.

### MATERIAL — Runtime result validation is mandatory-to-decide but absent from graduation

**Section:** Minimal runtime, gate 4, and OQ8, `0143@cb3:1045-1052,1169,1365-1367`.

**Evidence:** The document correctly says runtime result validation must be decided explicitly, but gate 4 tests only typechecking and absence of casts. TypeScript does not validate wire bytes. LLP 0114 requires runtime validation before typed publication at [LLP 0114:251](/Users/ccheever/projects/snapback/llp/0114-first-class-react-and-query-groups.spec.md:251), while LLP 0004 covers query/live/action publication and mutation commit at [LLP 0004:594](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:594). Current validation is visible at [react-binding.mjs:1026](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:1026) and [snapback-react/index.mjs:146](/Users/ccheever/projects/snapback/packages/snapback-react/index.mjs:146).

**Why it matters:** A microclient can pass typechecking while publishing malformed authoritative bytes as a precise generated type.

**Resolve:** Graduation must require generated validators plus malformed-response negatives, or require an accepted LLP 0114 amendment selecting server egress as the trust boundary before productization. Narrow Option 4’s “moves … validation work to the build” claim accordingly.

### DETAIL — Gate renumbering and cross-references are stale

**Section:** Phase D, `0143@cb3:1185,1205`.

**Evidence:** “Four more gates” now introduces seven entries: 11, 11a, 11b, 12, 12a, 13, and 14. The text says gates 11a and 11b close demand release and sender proof; sender proof is gate 12a, while 11b is carrier evidence.

**Resolve:** Update the count and cross-reference.

## 4. Surviving-text judgement

The surviving unchanged text is not clean. A further round would find at least:

- The exact deployment/operation-identity promise has no compatible mechanism or negative gate.
- The sessions/hosted cross-tab nonclaim contradicts governing custody contracts.
- Actions are promised but absent from graduation.
- Runtime result validation is named as mandatory-to-decide but omitted from graduation.
- The profile artifact still lacks capability class, immutable surface/OS identity, and source/artifact digests.
- The prior whole-application blocker survives: Phase C explicitly excludes files, presence, and scheduled work at `0143@cb3:1124-1158`, while gate 14 places that strict subset beside the 70.3/131.2 kB baselines. The motivating workout includes those capabilities at [README.md:10](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:10).

I found no further material defect in the benchmark-limitations prose, package-boundary attribution, Swift precedent, `/online` migration correction, RQS ownership, Option 10 correction, or competitor architecture descriptions. That is not a stopping signal because the identity, custody, action, validation, profile-artifact, and comparable-closure defects remain.

## 5. Open questions

The author must still answer:

1. Is the first spike local-dev, local sessions, or hosted browser, and what exact arm × lane × auth-profile × carrier × OS × capability tuple does it claim?
2. How does the document distinguish the Cloudflare GAP from LLP 0098’s Rust hosted target and its not-yet-ratified capability status?
3. What complete carrier grammar and custody module is conditional on each auth posture, including cross-tab behavior?
4. What mechanism enforces exact app, deployment, bundle, operation, and result-contract identity without a new wire carrier?
5. Are actions in the initial profile? If so, what positive, authorization, indeterminate-outcome, and no-retry gates cover them?
6. Does Micro retain generated runtime validators, or which accepted LLP amendment moves the trust boundary to server egress?
7. What comparable full-workout and composed React/auth byte ceilings must pass before productization?
8. How will the profile artifact encode capability class, immutable carrier/OS identity, source/artifact digests, and explicit nonclaims?
9. How will Phase B execute the existing CLI-fold decision, and which embedded versus privileged admin surfaces does it affect?
10. Will shared demand-release fixtures enter LLP 0095 while browser-only sender evidence remains routed through LLP 0077/0096?

## 6. Verdict

NOT READY
## Orchestrator verification and disposition (outside the verbatim body)

Every new finding was checked against the tree. All verified; none refuted.
All five BLOCKING and three MATERIAL findings were applied in v0.6.

- **LLP 0098 exists and was omitted** — `llp/0098-hosted-edge-adapter.spec.md`,
  Status **Draft**, "No capability is claimed by this document." It defines the
  `loopback-terminated-single-instance.v1` adapter and carries the served-origin
  matrix record. Added to Related and cited.
- **Posture scoping** — confirmed at LLP 0096 §3.2: in dev mode "all four axes
  report available with **null** minima," and a dev-mode-only target "claims no
  profile; the axes are open there without negotiation." Making the `auth/live`
  carriers universal was wrong and overstated the local-dev floor. Items 10 and
  11 are now posture-conditional, with a table.
- **Cross-tab custody** — confirmed at LLP 0059 §Cross-context ownership: "The
  preferred browser mutex is the Web Locks API… After acquiring it, a caller
  always reloads durable custody; an in-memory capture alone cannot justify a
  write." The blanket nonclaim is withdrawn for the credential-owning postures.
- **LLP 0064 per-OS evidence** — confirmed at `llp/0064:33`: "Evidence is per
  operating system; an iOS receipt never establishes Android behavior or the
  reverse." Gate 11b was bundling browser+iOS+Android and is now tuple-specific.
- **LLP 0115 decision 4** — confirmed at `llp/0115:485`: "the admin surface
  **folds into the CLI**" (2026-07-30). Phase B had asked who would decide an
  already-settled question. Rerouted to execution, with the embedded-methods
  versus privileged-package distinction named.
- **Actions** — confirmed at `llp/0133:697`: "the action tier is
  nondeterministic and never auto-replayed." Gate 5 covered only
  query/mutation/live while the profile claimed actions. Fixed.
- **Operation identity** — the substance was already independently confirmed by
  the orchestrator in round 1 (LLP 0094 adds no expected-operation carrier).
  The document's claim that the server rejects operation-identity mismatches is
  withdrawn; a named admission mechanism and gate 11c replace it.

**Cross-family convergence, recorded.** Codex's BLOCKING-1 and the Fable
family's round-3 MATERIAL are the same defect, found independently and blind:
the v0.4 hosted-availability paragraph conflated the Cloudflare arm with LLP
0096 §7's actual referent. Codex additionally supplied LLP 0098; Fable
additionally supplied the `auth/sender` "not applicable" versus "not
negotiable" cell distinction and the LLP 0077 served-origin header record. The
v0.6 paragraph is built from both. That defect was introduced by the
orchestrator in v0.4 while applying Codex's own round-2 finding — an
over-correction that a single-family loop would very likely have shipped,
because the family that prompted it had no reason to doubt it.

**Codex's round-3 DETAIL and one MATERIAL sub-item had already been applied in
v0.5** from the Fable family's independent round-3 findings, before this review
was received: the "four more gates"/seven-entries count and the stale
`gates 11a and 11b` cross-reference. Both families found them; neither saw the
other.


## Round 4 — 2026-08-01 (delta-confined)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** fresh CLI runner, delta-confined. Permitted to read exactly one
prior artifact — its own family's sections above — and no other file under
`llp/reviews/`; no `super-refine` path; blind to this document's fable
artifact, which was reviewing the same revision concurrently. SHA-pinned target
and instruction capsule.
**Instruction capsule SHA-256:** `f4e9bf98e6743ba41b25f16f0e4e5c3c84f4c1176a069125d4092b5dc67f1778`
**Target:** `llp/0145-client-bundle-architecture.research.md` (v0.6, 1,567
lines at review start; the reviewer detected the concurrent v0.7 edits and
re-read the full 1,592-line file, reporting against the current state)
**Target SHA-256 at issue:** `19bb6e74f99746346dd97b5caac6fcb6c1ec405dc2df7d815f86fd52fcb17ab5`
**Target SHA-256 as re-read:** `2985337956dcd5de617a2938f26920a382894651484acb32e44ba132cd177493`
**Repo revision at review start:** `0c0040ff` on `main`
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

The requested file initially matched SHA-256 `19bb6e74f99746346dd97b5caac6fcb6c1ec405dc2df7d815f86fd52fcb17ab5` at 1,567 lines. It changed concurrently during review. I therefore re-read the complete current file, now 1,592 lines at SHA-256 `2985337956dcd5de617a2938f26920a382894651484acb32e44ba132cd177493`. The concurrent additions are accurate; none resolves the defects below. `./ref-check --verbose` passes with zero errors.

I read only the permitted Codex prior-review artifact, no other file under `llp/reviews/`, and no `super-refine` path.

Load-bearing claims checked true:

- Root and `/online` still construct the same `SnapbackClient`: [`online.mjs:8`](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8), [`package.json:61`](/Users/ccheever/projects/snapback/packages/snapback-client/package.json:61). I reproduced approximately 250.9/70.1/60.2 kB raw/gzip/Brotli.
- The retained PocketBase and Snapback applications recompress to approximately 231.6/70.3/61.0 and 456.2/131.2/111.8 kB, consistent with the retained record at [`README.md:49`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:49).
- The revised `terminalDelete`, explicit-unsubscribe, and final-await-fence descriptions agree with the governing contracts and current unsubscribe path at [`index.mjs:5683`](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5683).
- The hosted Rust adapter, served 43/43 receipt, expired serving state, and Draft/no-capability qualification are real: [`LLP 0098:44`](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:44), [`LLP 0098:891`](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:891), [`LLP 0098:956`](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:956).
- Generated references carry exact implementation, argument, and result-contract identity, and the existing React admission path compares them: [`codegen/index.mjs:6510`](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6510), [`react-binding.mjs:249`](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:249).
- Firestore Lite’s REST-only omissions and Convex’s reactive-versus-HTTP client distinction agree with their [official Firestore Lite documentation](https://firebase.google.com/docs/firestore/solutions/firestore-lite) and [official Convex client documentation](https://docs.convex.dev/client/javascript/overview).
- The concurrently added external-bearer clarification and Phase A authority routing are accurate.

The document nevertheless retains five blocking defects: identity rejection can happen after an effect, credential-owning postures lack a two-context custody gate, hosted graduation neither qualifies the target nor exercises the proposed client, the whole-application gate compares unlike workloads, and the minimal auth contract remains nonconforming.

NOT READY

## 2. Disposition table

### Carried Round-1 findings

| ID | Disposition | Justification |
|---|---|---|
| 1. Authorized-live invalidation | PARTIALLY RESOLVED | The obligation/terminal split is correct, but item 11 still omits mandatory `auth/rr` and misstates upgrade offers: [`0143:1108`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1108), [`0096:169`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:169). |
| 2. Final-await authority fence | RESOLVED | F7, item 9, and gate 12 consistently require final-publication fencing: [`0143:1093`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1093), [`0143:1376`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1376). |
| 3. New-client conformance | RESOLVED-BUT-NEW-DEFECT | Corpus, release, and tuple-specific gates landed, but gate 11b imports Expo `Online` receipt requirements incompatible with Micro: [`0143:1359`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1359), [`0064:128`](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:128). |
| 4. Auth/deployment evidence | PARTIALLY RESOLVED | Postures and hosted referents are separated, but gate 12a does not exercise Micro or cross-context custody: [`0143:1381`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1381), [`hosted-sender-matrix.mjs:194`](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:194). |
| 5. Benchmark reproducibility | RESOLVED | Limitations are honest and Phase A requires retained fixtures, locks, metafiles, and receipts: [`0143:159`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:159), [`0143:1210`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1210). |
| 6. Packaging versus capability classes | PARTIALLY RESOLVED | The distinction is explicit, but the profile artifact still omits class, immutable identity, and digests: [`0143:1074`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1074), [`0143:1566`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1566). |
| 7. Complete closure and operational costs | PARTIALLY RESOLVED | Operational ceilings exist; the strict-subset/full-workout comparison remains: [`0143:1280`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1280), [`0143:1396`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1396). |
| 8. Runtime result validation | PARTIALLY RESOLVED | Gate 4 improved, but Option 4 still says validation moves to build time: [`0143:732`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:732), [`0143:1298`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1298). |
| 9. React public boundary | RESOLVED | Admission/preparation and actual React ownership are now distinguished accurately: [`0143:331`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:331). |
| 10. Firestore Lite precedent | PARTIALLY RESOLVED | The primary source, analysis, and honest placeholder exist; no measured reproducible row exists: [`0143:181`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:181). |
| 11. Compact operation identifiers | RESOLVED | They are consistently client-local and explicitly not a wire change: [`0143:716`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:716). |
| 12. Comparison and matrix labels | PARTIALLY RESOLVED | Exact Signal Desk entry/dependency identity remains absent and “matched” remains too strong: [`0143:205`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:205), [`signal-desk/package.json:27`](/Users/ccheever/projects/snapback/demos/signal-desk/package.json:27). |

### Round-2 new findings

| ID | Disposition | Justification |
|---|---|---|
| R2-1. `terminalDelete` and carriers | PARTIALLY RESOLVED | Terminal retirement is correct; the carrier grammar remains incomplete and overstates upgrade tokens: [`0143:1103`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1103), [`0143:1108`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1108). |
| R2-2. Demand release and carrier evidence | RESOLVED | Exact-owner release and independently scoped carrier evidence are present: [`0143:1350`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1350), [`0143:1359`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1359). Gate 11b’s new receipt defect is tracked separately below. |
| R2-3. Hosted profile without sender proof | PARTIALLY RESOLVED | A conditional gate exists, but the existing matrix is its own Node client and can pass while Micro is broken: [`0143:1381`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1381), [`hosted-sender-matrix.mjs:85`](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:85). |
| R2-4. Operational and whole-application criteria | PARTIALLY RESOLVED | The strict-subset/full-workout defect survives: [`0143:1280`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1280), [`0143:1396`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1396). |
| R2-5. Unsupported auth/accounting claims | RESOLVED-BUT-NEW-DEFECT | Earlier claims were corrected, but “no auth surface at all” contradicts the arm’s supported dev mode: [`0143:1034`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1034), [`capability manifest:8`](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8). |
| R2-6. Option 10 amortization | RESOLVED | Reuse is consistently bounded to one cache partition and immutable URL: [`0143:909`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:909). |
| R2-7. Phase B admin owner | RESOLVED-BUT-NEW-DEFECT | Phase B executes the CLI-fold decision, but Options 2 and 6 still put admin in application client graphs: [`0143:1242`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1242), [`0143:640`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:640). |
| R2-8. Existing `/online` migration | RESOLVED | The document now requires a new name or explicit major migration: [`0143:1416`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1416). |
| R2-9. Inventory/terminology propagation | PARTIALLY RESOLVED | Signal Desk’s exact Snapback artifact and “matched” terminology remain unresolved: [`0143:205`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:205). |

### Round-3 new findings

| ID | Disposition | Justification |
|---|---|---|
| R3-B1. Hosted availability | RESOLVED-BUT-NEW-DEFECT | The two referents and no-capability status are correct; “no auth surface at all” is newly overbroad: [`0143:1030`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1030), [`0096:162`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:162). |
| R3-B2. Minimal carrier contract | PARTIALLY RESOLVED | Posture scoping and external-bearer clarification improved, but `auth/rr`, selected-token semantics, and request/response-only scope remain wrong: [`0143:1108`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1108), [`0143:1131`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1131). |
| R3-B3. Cross-tab custody | PARTIALLY RESOLVED | The prose is now correct, but no conditional two-context graduation gate exists: [`0143:489`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:489), [`0143:1376`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1376). |
| R3-B4. Exact identity | RESOLVED-BUT-NEW-DEFECT | Whole-artifact admission and gate 11c landed, but the gate permits post-effect refusal and omits an argument-contract negative: [`0143:1370`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1370). |
| R3-B5. Actions | RESOLVED | Gate 5 covers action routing, authorization behavior, results, indeterminate outcome, and no retry: [`0143:1304`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1304). |
| R3-M1. Gate 11b/OQ17 evidence domains | RESOLVED-BUT-NEW-DEFECT | Evidence is now tuple-specific and sender remains browser-routed, but the transplanted Expo `Online` receipt is incoherent for Micro/browser: [`0143:1359`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1359). |
| R3-M2. Phase B admin decision | RESOLVED-BUT-NEW-DEFECT | Phase B is corrected, but the option analysis did not propagate the settled boundary: [`0143:627`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:627), [`0143:799`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:799). |
| R3-M3. Runtime result validation | PARTIALLY RESOLVED | Gate 4 improved; Option 4 remains stale and the server-egress alternative lacks an executable proof requirement: [`0143:732`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:732), [`0143:1298`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1298). |
| R3-D1. Gate numbering/cross-references | RESOLVED | The eight entries, count, and 11a/12a references are correct: [`0143:1325`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1325). |

## 3. New findings

### N1 — BLOCKING — Gate 11c permits identity refusal after an effect

**Section/evidence:** The mechanism requires refusal before first invocation at [`0143:1155`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1155), but gate 11c permits refusal “before invocation or publication” at [`0143:1370`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1370). Publication-only refusal is too late for mutations and actions. The client sends actions and mutations by name at [`index.mjs:5063`](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5063) and [`index.mjs:5479`](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5479); the server then stages/commits mutations and executes actions at [`server.rs:18676`](/Users/ccheever/projects/snapback/src/server.rs:18676) and [`server.rs:18756`](/Users/ccheever/projects/snapback/src/server.rs:18756). Gate 11c also omits a changed `argsContractHash` negative even though generated references carry it at [`codegen/index.mjs:6518`](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6518).

**Why it matters:** A stale client can perform an irreversible mutation or action and only then suppress the response.

**Resolve:** Require every app, bundle, id, kind, implementation, argument-contract, and result-contract mismatch to refuse before invocation or any effect. Require no publication additionally for read/live paths.

### N2 — BLOCKING — Credential-owning browser postures have no cross-context custody gate

**Section/evidence:** F7 now correctly requires shared custody and two-context acceptance at [`0143:489`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:489), but Phase D has only the same-context delayed-completion gate 12 and sender-lane gate 12a at [`0143:1376`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1376). LLP 0059 requires one durable record/cross-context owner, Web Locks or fenced CAS, and delayed-race acceptance in at least two contexts: [`0059:1625`](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1625), [`0059:1904`](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1904), [`0059:2039`](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2039), [`0059:2557`](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2557).

**Why it matters:** A first-party sessions/browser client can pass every listed gate while two tabs race credentials, ownership, or stale publication.

**Resolve:** Add a custody-ownership axis and a posture-conditional, two-context gate for every credential-owning sessions or hosted-browser tuple. External credential ownership may retain the nonclaim.

### N3 — BLOCKING — Hosted gate 12a proves neither Micro nor a qualified hosted target

**Section/evidence:** The document says gate 12a is exactly what a hosted claim requires at [`0143:1053`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1053). The current served matrix is instead a standalone Node instrument importing Node facilities, generating its own key, signing proofs, and maintaining one nonce cell: [`hosted-sender-matrix.mjs:85`](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:85), [`hosted-sender-matrix.mjs:194`](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:194), [`hosted-sender-matrix.mjs:320`](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:320). It does not exercise the proposed microclient. LLP 0060’s hosted readiness is a larger conjunctive target qualification at [`0060:465`](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:465), while LLP 0098 still claims no capability at [`0098:956`](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:956).

**Why it matters:** The unchanged 43-check instrument can remain green while Micro’s sender custody is absent or broken, or while the target itself is not qualified.

**Resolve:** Require the proposed browser client to drive an expanded lifecycle/custody matrix, and separately require the served target to satisfy the LLP 0060/0098 qualification conjunction.

### N4 — BLOCKING — Gate 14 compares a reduced workload with full-workout baselines

**Section/evidence:** Phase C explicitly admits that the spike omits files, presence, and scheduled work and is not comparable with the 70.3/131.2 kB application figures at [`0143:1280`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1280). Gate 14 nevertheless places its “complete production bundle” beside those baselines at [`0143:1396`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1396). The retained workout includes those capabilities at [`README.md:10`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:10), and the Snapback arm records an asset GAP at [`README.md:43`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:43).

**Why it matters:** The graduation program can pass by measuring a smaller and behaviorally incomplete application against the motivating full-product baseline.

**Resolve:** Restore and gate the full common workout before comparing those baselines, or use capability-matched reduced baselines and add a later full-workout graduation gate.

### N5 — BLOCKING — The minimal auth carrier contract remains nonconforming

**Section/evidence:** Item 11 claims the `auth/live` carrier grammar “in full” but omits `auth/rr`’s mandatory header on every sessions AppData request and says “the four axis tokens” are restated on upgrade: [`0143:1108`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1108). LLP 0096 makes profiles independent, makes `auth/rr` mandatory per AppData request, and leaves replay/lease optional: [`0096:95`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:95), [`0096:169`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:169), [`0096:685`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:685). The conforming Swift client sends `auth/rr` on every request and only selected `auth/rr`/`auth/live` upgrade tokens: [`SnapbackClient.swift:1023`](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift:1023), [`SnapbackClient.swift:1127`](/Users/ccheever/projects/snapback/clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift:1127).

The posture table also lacks the legitimate sessions request/response-only tuple and makes items 10/11 unconditional for hosted browser at [`0143:1131`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1131).

**Why it matters:** The claimed minimal contract can certify a sessions client the server correctly refuses, while also demanding optional protocols from clients that do not claim them.

**Resolve:** Specify `auth/rr` on every sessions AppData request, restate every selected axis offer on applicable boundaries, condition `auth/live` on auth-scoped subscriptions, and add request/response-only rows.

### N6 — MATERIAL — Dev invalidation semantics are asserted across an unresolved LLP/code conflict

**Section/evidence:** The revised summary and table state that local dev receives no obligation frames and item 10 is inapplicable: [`0143:106`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:106), [`0143:1133`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1133). LLP 0096 removes profile negotiation in dev, but Accepted LLP 0053 defines every subscription except an explicitly `authorityIndependent` one as auth-scoped and obligation-backed: [`0053:276`](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:276), [`0053:311`](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:311). Current code hard-gates obligation admission to Sessions mode at [`local.rs:12502`](/Users/ccheever/projects/snapback/src/local.rs:12502).

**Why it matters:** Absence of negotiation does not itself settle the semantic obligation. The target silently chooses the current code over the Accepted authority without acknowledging the drift.

**Resolve:** Reconcile LLP 0053 with current dev behavior, or explicitly record the code/spec gap and make dev authorized-live behavior a nonclaim until its authority is settled.

### N7 — MATERIAL — Result-validation correction did not propagate or become executable

**Section/evidence:** Option 4 still says validation moves to build time at [`0143:732`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:732), contradicting the runtime trust-boundary discussion at [`0143:1170`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1170). Gate 4 allows an accepted LLP amendment as an alternative to client validators but requires no malformed-egress behavioral receipt at [`0143:1298`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1298). Current server egress validation is executable behavior at [`local.rs:10380`](/Users/ccheever/projects/snapback/src/local.rs:10380) and [`local.rs:10829`](/Users/ccheever/projects/snapback/src/local.rs:10829), not something an accepted prose amendment alone proves.

**Why it matters:** The gate can pass without demonstrating that malformed authoritative results are rejected on every claimed operation path.

**Resolve:** Narrow Option 4 to build-time selection/type work and require executable malformed-result negatives under either trust-boundary branch.

### N8 — MATERIAL — The settled admin boundary did not propagate to Options 2 and 6

**Section/evidence:** Phase B correctly records the CLI-fold decision at [`0143:1242`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1242), matching [`LLP 0115:479`](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:479). Option 2 still lists an application client `admin` module at [`0143:627`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:627), and Option 6 still dynamically loads admin into the application graph at [`0143:799`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:799).

**Why it matters:** The preferred architecture still recommends a boundary the governing decision excludes.

**Resolve:** Remove admin from app/client capability modules and lazy chunks; model the CLI and served external-tooling surfaces explicitly.

### N9 — MATERIAL — Gate 11b and the profile artifact conflate browser Micro with Expo `Online`

**Section/evidence:** The profile artifact sketch omits capability class, immutable profile identity, and digests at [`0143:1074`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1074). Gate 11b requires every claimed carrier to carry the “complete LLP 0064 receipt facts” at [`0143:1359`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1359). Those seven facts are specifically an Expo `Online` receipt and include optimistic settlement plus offline retention/reconnect at [`0064:128`](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:128), which Micro explicitly disclaims at [`0143:996`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:996). The concurrently added OQ22 also incorrectly generalizes LLP 0064’s OS fields to every “claimed carrier” at [`0143:1566`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1566).

**Why it matters:** The gate is infeasible for Expo Micro and undefined for browser Micro; the artifact intended to enforce capability honesty is not itself a graduation deliverable.

**Resolve:** Mint or amend a narrower capability class before an Expo claim, define separate browser receipt facts, and require a versioned profile artifact bound by digest into each receipt.

### N10 — MATERIAL — Benchmark evidence supports dominance, not exact causal attribution

**Section/evidence:** The summary says 59.5 kB was “attributable” to the SDK and the application section says it explains about 98%: [`0143:64`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:64), [`0143:227`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:227), with High confidence at [`0143:1576`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1576). The applications use provider-native models rather than matched code at [`README.md:10`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/README.md:10), one arm has an asset GAP, and their dependency sets differ at [`pocketbase/package.json:15`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/pocketbase-incident-room/package.json:15) and [`snapback/package.json:16`](/Users/ccheever/projects/snapback/demos/pocketbase-snapback-bakeoff/snapback-incident-room/package.json:16).

The Signal Desk row independently claims `@expo/snapback-client 0.1.8` at [`0143:205`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:205), while the committed fixture uses a workspace `file:` dependency at [`signal-desk/package.json:27`](/Users/ccheever/projects/snapback/demos/signal-desk/package.json:27), whose manifest currently says `0.1.0` at [`snapback-client/package.json:1`](/Users/ccheever/projects/snapback/packages/snapback-client/package.json:1).

**Why it matters:** Agreement between isolated and application deltas strongly corroborates SDK dominance, but does not causally apportion 98% or tie the Signal Desk bytes to a verifiable artifact.

**Resolve:** Change “attributable/explaining 98%” to “corroborates/within 1.4 kB,” or control scaffold/dependencies and retain metafile attribution. Retain the exact Signal Desk entry, runner, lock/integrity, and source/package digest—or label the row as an author-run against unrecorded 0.1.8 state.

### N11 — DETAIL — “No auth surface at all” is false

**Section/evidence:** [`0143:1034`](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1034) says the Cloudflare arm has no auth surface at all, immediately before acknowledging `supportedAuthModes: ["dev"]`. The manifest confirms dev support at [`capability manifest:8`](/Users/ccheever/projects/snapback/cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8); LLP 0096’s precise claim is “no sessions surface” at [`0096:162`](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:162).

**Why it matters:** The surrounding paragraph is recoverable, but its lead sentence is still false.

**Resolve:** Replace it with “no sessions or negotiated auth-profile surface.”

## 4. Surviving-text judgement

No: the surviving text is not clean.

A further round would still find the unchanged causal-attribution claim, unverifiable Signal Desk dependency identity, stale admin options, incomplete profile artifact, and Option 4’s build-time-validation statement. The Phase C/gate 14 inconsistency and missing two-context custody gate are failed propagation: the document correctly explains the problem in one section and then fails to enforce it later.

I found no additional material defect in:

- the current closure inventory and package-boundary analysis;
- the Swift clean-room precedent;
- Firestore Lite, Convex, Supabase, and PocketBase architectural descriptions;
- the `/online` migration correction;
- `terminalDelete`, explicit release, and the final-await fence;
- Option 10’s cache-partition qualification;
- gate numbering and cross-references; or
- the concurrently added summary scoping, external-bearer clarification, LLP 0112 precedent, and Phase A authority routing.

That is not a stopping signal because the blocking and material defects above remain.

## 5. Open questions

The author must still answer:

1. What exact arm × lane × auth-profile × carrier × OS × capability tuple does the first spike claim, and who owns credential custody?
2. Will every identity mismatch refuse before any effect, and which exact app/bundle/id/kind/implementation/argument/result negatives prove it?
3. What test actually drives the proposed browser microclient through two-context sessions/sender custody?
4. What complete LLP 0060/0098 qualification must a hosted target pass in addition to the sender matrix?
5. Will gate 14 restore the full incident-room workout, or use a genuinely capability-matched reduced baseline?
6. What is the exact `auth/rr`/`auth/live` carrier matrix, including request/response-only sessions, and how will the LLP 0053 dev-mode conflict be resolved?
7. Which executable malformed-result evidence is required under each result-validation trust-boundary choice?
8. What narrower browser/Expo capability class and profile-artifact schema replaces the incompatible LLP 0064 `Online` receipt?
9. Will the benchmark prose be weakened to corroboration, or will controlled artifacts be retained to support exact attribution?
10. How will Options 2 and 6 be reconciled with the settled CLI-fold admin boundary?

## 6. Verdict

NOT READY
## Orchestrator verification and disposition (outside the verbatim body)

Spot-checked the decisive claims; all held, and all eleven findings were
applied in v0.8.

- **N5** — confirmed at LLP 0096 §2.1: `auth/rr`'s carrier is
  `x-snapback-auth-client-protocol: 1` **on every request**, not per
  subscription. Item 11 covered only `auth/live` and bundled the axes. Rebuilt
  per axis, with the `auth/rr`-only request/response row the table lacked.
- **N9** — confirmed at `llp/0064:128`: "An Expo tuple may claim `Online` only
  when one receipt for that OS proves: … 3. optimistic pending followed by
  confirmed or rejected settlement." Those are `Online`-class facts, and this
  profile disclaims optimism and retention — so gate 11b as written was
  unsatisfiable rather than strict, and LLP 0064 defines no browser receipt at
  all. Recorded as a class-minting problem (OQ22) rather than papered over.
- **N6** — confirmed that `src/local.rs` gates auth-scoped live admission to
  sessions mode under an `@ref LLP 0053` comment, while LLP 0053 (Accepted)
  carves out no dev exemption. A real spec/code drift this research surfaced
  and cannot settle; recorded as OQ23 with the local-dev row marked dependent
  on the answer.
- **N10** — confirmed at `demos/signal-desk/package.json:27`: the fixture
  depends on `@expo/snapback-client` through a workspace `file:` path, so the
  row's "0.1.8" label was not verifiable from the fixture. Relabelled as an
  unrecorded workspace state, and the "explaining about 98%" causal claim
  weakened to corroboration in the Summary, the corroboration section, and the
  Confidence table.
- **N1, N2, N4, N7, N8, N11** — all propagation failures from the
  orchestrator's own round-3 fixes: gate 11c permitting post-effect refusal,
  the cross-context custody gate that §F7 required and the gate list omitted,
  gate 14 comparing the reduced spike against baselines the same document calls
  incomparable, Option 4 still saying validation moves to the build, Options 2
  and 6 still placing admin in the app graph after Phase B recorded the
  CLI-fold, and "no auth surface at all" where the arm supports dev mode.

**Trajectory, recorded honestly.** Codex's finding counts have not decreased
across four rounds (4B/7M, 4B/4M, 5B/3M, 5B/5M) while the Fable family's have
(7M/4D, 0, 1M/4D, 1M/2D). The divergence is not disagreement about facts —
every Codex finding verified — but about scope: round 4's findings are
predominantly places where a v0.6 correction did not propagate into text it
invalidated. The document grew from 842 to 1,729 lines across four rounds, and
each fix pass created new seams. v0.8 is therefore deliberately a
consolidation: it removes overclaims and reconciles sections rather than adding
machinery.


## Round 5 — 2026-08-01 (delta-confined)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (CLI banner)
**Sandbox:** read-only
**Date:** 2026-08-01
**Method:** fresh CLI runner, delta-confined; own-family artifact only; no
`super-refine` path; blind to the fable artifact.
**Instruction capsule SHA-256:** `0536f2c89bb72c672714078f999ef66b855250bc7f052e1ddee37b6493e45e81`
**Target at issue:** v0.8, 1,729 lines, SHA-256 `6a913c7cce376e0229f07e49c2584947f6ce3b675f8ad551d013427eaeb479ca`
**Target as reviewed:** v0.9, 1,772 lines, SHA-256 `cc2c9b88b184ad9a230732dff6f45c16f57d462daeddac1e011c3f9294191780`
**Repo revision at review start:** `0c0040ff` on `main`
**Status:** completed
**Verdict:** NOT READY

**Independence caveat, raised by the reviewer and accepted by the
orchestrator.** The target mutated during this review because the orchestrator
was concurrently applying the other family's round-5 findings. The reviewer
waited for stability, re-read the full v0.9 revision, and noted that v0.9 "itself
incorporates another family's round-5 correction, so the original
frozen-revision independence premise no longer holds." That is a fair charge.
Round 6 is run against a frozen target for exactly this reason.

## Verbatim review

## 1. Overall assessment

The target initially matched the supplied SHA-256 `6a913c7c…` at 1,729 lines. It changed repeatedly during review. I waited for stability and re-read the complete working-tree revision now present: v0.9, 1,772 lines, SHA-256 `cc2c9b88b184ad9a230732dff6f45c16f57d462daeddac1e011c3f9294191780`. This review applies to that revision, not the capsule’s v0.8 snapshot. I opened no prohibited review artifact or `super-refine` path, although v0.9 itself incorporates another family’s round-5 correction, so the original frozen-revision independence premise no longer holds.

`./ref-check --verbose` passes with 0 errors and 0 unchecked references.

Two blocking defects remain:

- The proposed admission mechanism cannot guarantee exact-identity refusal before an effect across a deployment change.
- Gate 12a misstates the existing 43-check hosted matrix as covering refresh, logout, and key loss, allowing the named executable gate to remain green without those lifecycle behaviors.

Load-bearing claims I checked and found true:

- Root and `/online` still expose the same full client: [online.mjs:8](/Users/ccheever/projects/snapback/packages/snapback-client/online.mjs:8), [package.json:61](/Users/ccheever/projects/snapback/packages/snapback-client/package.json:61). I reproduced approximately 250.9/70.1/60.2 kB raw/gzip/Brotli.
- Generated references carry exact identity and current React admission compares it: [codegen/index.mjs:6510](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6510), [react-binding.mjs:205](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:205).
- `auth/rr` is per-request, while current protocol clients must always offer `auth/live` when subscribing because authority independence is not projected: [LLP 0096:206](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:206).
- Externally supplied bearers are sessions-mode but caller-custodied: [index.mjs:1494](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1494), [LLP 0096:637](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:637).
- LLP 0064’s Expo `Online` receipt really requires optimism and offline retention and is per-OS: [LLP 0064:128](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:128).
- The admin CLI-fold and the removals from Options 2 and 6 are correct: [LLP 0115:479](/Users/ccheever/projects/snapback/llp/0115-agent-first-deployment-and-operations.plan.md:479).
- The Firestore Lite, Convex, Supabase, and PocketBase descriptions agree with the vendors’ [Firestore Lite](https://firebase.google.com/docs/firestore/solutions/firestore-lite), [Convex JavaScript client](https://docs.convex.dev/client/javascript/overview), [Supabase initialization](https://supabase.com/docs/reference/javascript/initializing), and [PocketBase usage](https://pocketbase.io/docs/how-to-use/) documentation.

NOT READY

## 2. Disposition table

### Carried round-1 findings

| Identifier | Disposition | Justification |
|---|---|---|
| 1. Authorized-live invalidation | RESOLVED-BUT-NEW-DEFECT | The carrier rule is corrected, but v0.9 now marks obligations required for every sessions live subscription; see M1. |
| 2. Final-await authority fence | RESOLVED-BUT-NEW-DEFECT | Item 9 is correct, but gate 12 does not exercise every publication class item 9 names; see M5. |
| 3. New-client conformance | PARTIALLY RESOLVED | Shared corpus and release gates exist, but carrier evidence remains undefined and gate 12a misstates its executable matrix. |
| 4. Auth/deployment evidence | PARTIALLY RESOLVED | Microclient driving and separate target qualification landed; lifecycle coverage and custody scoping remain defective. |
| 5. Benchmark reproducibility | RESOLVED | Limitations are honest and Phase A requires retained fixtures, locks, metafiles, and receipts. |
| 6. Packaging versus capability classes | PARTIALLY RESOLVED | Capability class, carrier/OS identity, and digests landed; exact auth profile-set and custody owner did not. |
| 7. Complete closure and operational costs | RESOLVED | Gates 13–14 now use ceilings and capability-matched baselines. |
| 8. Runtime result validation | RESOLVED | Option 4 and gate 4 require an explicit trust boundary and executable malformed-result negatives. |
| 9. React public boundary | RESOLVED | Admission/preparation is accurately distinguished from the React package. |
| 10. Firestore Lite precedent | PARTIALLY RESOLVED | The precedent is accurate and the missing measurement is honestly deferred to Phase A. |
| 11. Compact operation identifiers | RESOLVED | Identifiers remain client-local; no wire change is claimed. |
| 12. Comparison and matrix labels | RESOLVED | Provider-native labeling, version disclosure, and Signal Desk provenance are now honest. |

### Round-2 findings

| Identifier | Disposition | Justification |
|---|---|---|
| R2-1. `terminalDelete` and carriers | RESOLVED-BUT-NEW-DEFECT | Terminal retirement and carrier stages are correct; the rebuilt obligation/release table is not. |
| R2-2. Demand release and carrier evidence | RESOLVED-BUT-NEW-DEFECT | Exact-owner release exists, but local release is over-scoped and carrier qualification still has an undefined exception. |
| R2-3. Hosted profile without sender proof | RESOLVED-BUT-NEW-DEFECT | The microclient must drive the proof, but the named matrix lacks required lifecycle checks. |
| R2-4. Operational and application criteria | RESOLVED | Gate 14 now forbids unlike-workload comparison. |
| R2-5. Unsupported auth/accounting claims | RESOLVED | Cost is unmeasured, dev-only evidence is labeled, and Cloudflare is described as sessionless rather than authless. |
| R2-6. Option 10 amortization | RESOLVED | Reuse is bounded to an identical URL within one cache partition. |
| R2-7. Phase B admin owner | RESOLVED | Phase B executes the CLI-fold decision and separates embedded methods from the privileged package. |
| R2-8. Existing `/online` migration | RESOLVED | A new name or explicit major-version migration is required. |
| R2-9. Inventory/terminology propagation | RESOLVED | Unrecoverable provenance is labeled rather than asserted. |

### Round-3 findings

| Identifier | Disposition | Justification |
|---|---|---|
| R3-B1. Hosted availability | RESOLVED | Cloudflare, Rust hosted posture, LLP 0098’s status, and the expired drill window are separated accurately. |
| R3-B2. Minimal carrier contract | RESOLVED-BUT-NEW-DEFECT | The carrier grammar is corrected, but obligations and release are conflated with carrier selection; see M1. |
| R3-B3. Cross-tab custody | PARTIALLY RESOLVED | Gate 11d landed, but custody ownership is absent from the artifact and “sessions” remains conflated; see M3. |
| R3-B4. Exact identity | RESOLVED-BUT-NEW-DEFECT | Gate 11c now says pre-effect, but its proposed one-time admission mechanism cannot guarantee that property; see B1. |
| R3-B5. Actions | RESOLVED | Action routing, authorization, result handling, indeterminate outcome, and no-retry evidence are required. |
| R3-M1. Gate 11b/OQ17 evidence domains | PARTIALLY RESOLVED | The incompatible Expo receipt is acknowledged, but the spike-own-carrier exception has no pass criterion. |
| R3-M2. Phase B admin decision | RESOLVED | Options 2 and 6 now honor CLI-fold. |
| R3-M3. Runtime result validation | RESOLVED | The build-time claim is narrowed and executable evidence is mandatory. |
| R3-D1. Gate numbering/cross-references | RESOLVED | v0.9 correctly says nine entries and includes 11d at 0143:1444–1445. |

### Round-4 findings

| Identifier | Disposition | Justification |
|---|---|---|
| N1. Identity refusal after effect | RESOLVED-BUT-NEW-DEFECT | The wording now requires pre-effect refusal, but the admitted mechanism has a deployment-change TOCTOU; see B1. |
| N2. Cross-context custody gate | PARTIALLY RESOLVED | Gate 11d exists, but custody ownership remains unrepresented and its sessions wording contradicts external bearers. |
| N3. Hosted gate proves neither Micro nor target | RESOLVED-BUT-NEW-DEFECT | Micro driving and separate target qualification landed, but the matrix lacks required lifecycle coverage; see B2. |
| N4. Unlike application baselines | RESOLVED | Gate 14 now requires matched capabilities or restoration of the full workout. |
| N5. Minimal auth carrier contract | RESOLVED-BUT-NEW-DEFECT | `auth/rr`, any-live `auth/live`, and request-only sessions are corrected; item 10 and local release are now mis-scoped. |
| N6. Dev invalidation conflict | PARTIALLY RESOLVED | The caveat and OQ23 are accurate, but categorical contrary statements survive elsewhere; see M4. |
| N7. Result-validation propagation | RESOLVED | Option 4 and gate 4 now agree. |
| N8. Admin propagation | RESOLVED | Options 2 and 6 honor the settled boundary. |
| N9. LLP 0064/profile artifact | PARTIALLY RESOLVED | Several artifact fields and the class-minting problem landed; profile-set, custody owner, and a coherent carrier gate did not. |
| N10. Causal attribution/Signal Desk | RESOLVED | All causal claims are reduced to corroboration and the workspace state is labeled unrecorded. |
| N11. Cloudflare auth wording | RESOLVED | It now says no sessions or negotiated auth-profile surface while preserving dev support. |

## 3. New findings

### B1 — BLOCKING — Exact-identity admission is non-atomic with an effectful invocation

**Section/evidence:** The document correctly says invocation reduces exact generated references to a name, no expected-operation wire carrier exists, and current exactness comes from client-side whole-artifact admission. It then presents admission “before the first invocation” as sufficient and gate 11c requires every mismatch to refuse before any effect: [0145:1270](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1270), [0145:1500](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1500).

Current admission is a separate inspection request followed by client-side comparison: [react-binding.mjs:205](/Users/ccheever/projects/snapback/packages/snapback-client/react-binding.mjs:205). Later calls send only the name:

- query: [index.mjs:4869](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:4869)
- action: [index.mjs:5063](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5063)
- mutation: [index.mjs:5379](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5379)
- live subscribe: [index.mjs:5589](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5589)

`functionName` discards the rest of the tuple at [index.mjs:10608](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:10608), and server effectful routes dispatch by path name at [server.rs:10105](/Users/ccheever/projects/snapback/src/server.rs:10105). LLP 0094 confirms there is no expected-operation request member: [LLP 0094:973](/Users/ccheever/projects/snapback/llp/0094-wire-envelope-contract.spec.md:973).

**Why it matters:** A deployment can change after admission. A stale client can then invoke a same-named successor mutation or action and commit an effect. Re-inspection before each call is still a TOCTOU unless inspection and invocation are bound atomically.

**Resolve:** Require one of:

- an expected deployment/operation tuple checked atomically on every invocation;
- a server-minted admission token or lease checked before each effect;
- or immutable deployment pinning that makes the admitted deployment the invoked deployment.

Add rollout/restart interleaving negatives. Until that mechanism exists, admission alone cannot satisfy gate 11c.

### B2 — BLOCKING — Gate 12a names lifecycle coverage the existing matrix does not have

**Section/evidence:** Gate 12a says the LLP 0077 served-origin matrix covers issuance, custody, HTTP/WS proof, nonce recovery, refresh, logout, and key loss: [0145:1526](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1526).

The executable instrument fixes its count at 43 checks: [hosted-sender-matrix.mjs:130](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:130). Its inventory covers issuance, request proof/nonces/replay, grants, refusals, and WebSocket through [hosted-sender-matrix.mjs:766](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs:766)–1295; it contains no refresh, logout, or key-loss checks. LLP 0098 describes the same limited inventory at [LLP 0098:691](/Users/ccheever/projects/snapback/llp/0098-hosted-edge-adapter.spec.md:691). By contrast, LLP 0077’s actual Acceptance section explicitly requires refresh preservation, key-loss refusal, logout, rotation, and related lifecycle composition: [LLP 0077:1247](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:1247).

**Why it matters:** The current 43-check receipt can remain green while refresh changes the bound key, logout fails to retire custody, or key loss falls back to a bearer. Making the microclient drive the existing checks does not add the missing checks.

**Resolve:** Extend the executable matrix with named client-driven checks for at least refresh/key-family preservation, logout and lost-response retirement, key deletion/loss with no bearer fallback, and deletion-only migration. Bind those check identifiers and the microclient artifact digest into the receipt.

### M1 — MATERIAL — v0.9 conflates carrier selection, obligation delivery, and release

**Section/evidence:** v0.9 correctly changes `auth/live` to be offered for any sessions-mode subscription, because the protocol client cannot branch on server-only independence: [0145:1183](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1183). The table then marks item 10 obligations required for **every** sessions live subscription and item 12 required for all local-dev clients: [0145:1223](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1223).

Those are different predicates:

- LLP 0053 excludes explicitly `authorityIndependent` subscriptions from obligation backing: [LLP 0053:311](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:311).
- LLP 0095’s release obligation exists only after `LIVE → RELEASED`; a request-only local client has nothing to unsubscribe: [LLP 0095:120](/Users/ccheever/projects/snapback/llp/0095-client-lifecycle-and-conformance.spec.md:120).

**Why it matters:** The table is the document’s declared byte-floor authority. It now charges obligation machinery where no obligation exists and release machinery to a client with no subscription.

**Resolve:** Keep separate columns and predicates:

- item 11 `auth/live`: any sessions-mode live subscription under the standing protocol;
- item 10 obligations: auth-scoped live only;
- item 12 release: iff the selected operation set subscribes.

Make local request-only/live variants explicit.

### M2 — MATERIAL — The profile artifact lacks the exact auth profile-set

**Section/evidence:** The proposed artifact records operations, modules, arm/lane, auth posture, carrier, class, carrier/OS identity, and digests, but not the exact selected auth profile IDs and versions: [0145:1133](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1133). Gate 11 similarly asks for an “arm × lane × auth tuple” without defining the exact set: [0145:1447](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1447).

LLP 0096 defines the machine claim as `arm × lane × profile-set`, with exact must-understand versions: [LLP 0096:113](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:113), [LLP 0096:574](/Users/ccheever/projects/snapback/llp/0096-auth-profiles-for-protocol-clients.spec.md:574).

**Why it matters:** “Sessions posture” cannot distinguish `auth/rr` from `auth/rr + auth/live`, optional replay/lease, or an exact sender version. Receipts cannot prove the tuple they exercised.

**Resolve:** Add a machine-readable, versioned `authProfileSet` containing exact profile IDs/versions and bind it into the artifact and every receipt.

### M3 — MATERIAL — Custody ownership remains unrepresented and “sessions” is still conflated

**Section/evidence:** The document correctly says an external bearer uses sessions mode while custody remains caller-owned: [0145:1252](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1252). Gate 11d then equates credential ownership with “any sessions or hosted-browser posture” before exempting caller ownership: [0145:1511](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1511). The profile artifact has no custody-owner field.

The shipped external constructor is explicitly non-custodial and mutually exclusive with `AuthCoordinator`/sender custody: [index.mjs:1494](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1494).

**Why it matters:** Auth posture does not mechanically determine gate 11d. Both caller-custodied and first-party-custodied clients operate against sessions mode.

**Resolve:** Add `custodyOwner`—for example `none`, `caller`, `client-first-party`, or `sender-client`—to the profile artifact and receipts. Scope gate 11d by that field, and replace ambiguous “sessions” with either “server sessions mode” or “first-party credential-owning sessions module.”

### M4 — MATERIAL — The dev-invalidation caveat still has stale categorical counterparts

**Section/evidence:** The caveat and OQ23 accurately identify an unresolved conflict between Accepted LLP 0053 and current code: [0145:1235](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1235), [0145:1734](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1734). LLP 0053 defaults every non-independent subscription to auth-scoped at [LLP 0053:311](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:311), while code gates obligation admission to sessions mode at [local.rs:12502](/Users/ccheever/projects/snapback/src/local.rs:12502).

The Summary nevertheless says local dev receives no obligations as an already-ratified constraint at [0145:135](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:135), and “Questions the corpus already answers” again states that the obligation seam is sessions/hosted-only at [0145:1646](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1646).

**Why it matters:** The document simultaneously calls the scope unresolved and answered.

**Resolve:** Qualify both categorical passages as current-code behavior, retain dev authorized-live as a nonclaim, and remove the scope from “Questions the corpus already answers” until OQ23 is reconciled.

### M5 — MATERIAL — Gate 12 does not cover all authority-fenced publication classes

**Section/evidence:** Item 9 requires fencing requests, grant opens, subscriptions, socket callbacks, reconnects, errors, and store writes: [0145:1162](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1162). Gate 12 schedules success, failure, timeout, abort, terminal auth error, socket callback, and reconnect, omitting explicit grant-open, subscription-establishment, and store-write completions: [0145:1521](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1521).

LLP 0059’s two-context acceptance explicitly tests delayed client-store writes and grant opens: [LLP 0059:2753](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:2753).

**Why it matters:** A client can pass the listed same-context tests while a delayed user-A store write or grant open survives into user B.

**Resolve:** Make gate 12 enumerate every item-9 completion/publication class, independent of gate 11d’s cross-context tests.

### M6 — MATERIAL — Gate 11b’s spike-own-carrier exception has no pass criterion

**Section/evidence:** Gate 11b says real-browser receipt facts do not exist and the Expo receipt is unsatisfiable for this profile, then says the gate remains satisfiable for the carrier in which the spike runs: [0145:1478](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1478). OQ22 repeats the exception at [0145:1728](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1728).

**Why it matters:** Running in a carrier does not define evidence facts for that carrier. An undefined receipt cannot pass a qualification gate.

**Resolve:** State that the spike may run as unqualified experimental evidence, but no browser or Expo carrier claim can satisfy gate 11b until its capability class and receipt facts are ratified.

### D1 — DETAIL — “Persisted client cache” overstates the browser default

**Section/evidence:** Migration calls today’s browser default “a persisted client cache”: [0145:1593](/Users/ccheever/projects/snapback/llp/0145-client-bundle-architecture.research.md:1593). The resolver uses IndexedDB only when both IndexedDB and Web Locks exist and otherwise reports a non-durable memory fallback: [rqs-store-default.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-store-default.mjs:1), [rqs-store-default.mjs:49](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-store-default.mjs:49).

**Resolve:** Say “persistence-preferred default with reported memory fallback.”

## 4. Surviving-text judgement

The surviving text is not clean.

The exact-identity TOCTOU, incomplete authority-delay gate, dev-scope contradiction, and persistence overstatement survived multiple prior readings. Gate 12a’s missing lifecycle coverage is also substantive, not optional polish. v0.9 fixed the gate count, hosted release inheritance, and client-side `auth/live` rule, but its table then propagated that carrier predicate incorrectly into obligation scope.

Most remaining defects are propagation failures. B1 is not: it is a genuine mechanism flaw. B2 is a genuine executable-evidence flaw. Neither should be deferred to empirical work because they determine whether the empirical gates mean what they claim.

After fixing B1–B2 and reconciling M1–M6, one frozen, focused consistency pass is appropriate. Another broad prose review round is unlikely to be the best instrument. The remaining bundle-size, module-closure, runtime-carrier, and operational questions should then be retired by the spike and its receipts. The next review target should be frozen for the duration; this round’s concurrent v0.8→v0.9 mutation weakened the intended independence.

## 5. Open questions

The author must still answer:

1. What atomic mechanism enforces deployment/operation identity at the effect boundary?
2. Which exact executable checks extend gate 12a for refresh, logout, key loss, and custody lifecycle?
3. What is the complete generated profile schema, including exact auth profile-set and custody owner?
4. What are the distinct item-10, item-11, and item-12 predicates for local, request-only, authority-independent-live, auth-scoped-live, external-bearer, and first-party-custody tuples?
5. How will LLP 0053’s dev semantics and current code be reconciled?
6. What browser/Expo capability class and receipt facts make gate 11b satisfiable?
7. Which complete item-9 publication classes must gate 12 delay and fence?

## 6. Verdict

NOT READY
## Orchestrator verification and disposition (outside the verbatim body)

Both BLOCKING findings verified and applied in v1.0; all six MATERIAL and the
DETAIL applied.

- **B1 (TOCTOU)** — accepted on the logic, which follows from facts the
  orchestrator verified independently in round 1: the wire carries no
  expected-operation member, invocation sends only the name, and admission is a
  separate inspection request. A deployment change between admission and
  invocation is therefore unguarded, and re-inspection before each call does
  not close it. This is the loop's most valuable single finding: it invalidates
  a mechanism the orchestrator proposed in v0.6 and both families had accepted
  through two rounds. §Minimal runtime contract and gate 11c now name three
  candidate atomic mechanisms and require rollout-interleaving negatives.
- **B2 (gate 12a lifecycle)** — confirmed directly:
  `demos/competitive-checkpoint/tests/acceptance/hosted-sender-matrix.mjs`
  declares `EXPECTED_CHECKS = 43` and contains **zero** occurrences of
  "refresh", "logout", "key loss", or "deletion", while LLP 0077's Acceptance
  section requires that "refresh preserves it; key loss has no bearer fallback;
  v1 migration is deletion-only" and that logout/rotation/expiry/reset compose
  with the generation barriers. The v0.8 gate listed 0077's *specification*
  requirements as though the *instrument* witnessed them. Corrected to require
  extending the matrix.
- **M1** — accepted: v0.9 collapsed three predicates into one row-set. The
  table now separates carrier selection (any live subscription — offered
  defensively), obligation delivery (auth-scoped only — delivered selectively),
  and release (iff subscribing), and gains the row the collapsed version could
  not express: sessions + live + all targets authority-independent.
- **M2, M3** — accepted: `authProfileSet` and `custodyOwner` added to the
  profile artifact, and gate 11d rescoped by custody owner rather than by auth
  posture, since a caller-custodied and a first-party-custodied client both
  speak sessions mode and only the second owns anything to race.
- **M4** — accepted: both categorical dev-scope statements now read as
  current-code behavior with OQ23 named, rather than as ratified constraints.
- **M5** — accepted: gate 12's class list was seven of item 9's ten, omitting
  grant open, subscription establishment, and client-store write — precisely
  the three LLP 0059's two-context acceptance singles out.
- **M6** — accepted: "satisfiable for the carrier the spike runs in" was the
  absence of a pass criterion, not one. The spike now produces explicitly
  unqualified experimental evidence until a class is ratified.
- **D1** — confirmed: `rqs-store-default.mjs` selects IndexedDB only when both
  IndexedDB and Web Locks exist and otherwise reports a memory fallback.

**Convergence on the instrument, across both families.** Codex: "Most remaining
defects are propagation failures. B1 is not… After fixing B1–B2 and reconciling
M1–M6, one frozen, focused consistency pass is appropriate. Another broad prose
review round is unlikely to be the best instrument." The Fable family
independently reached the same conclusion in the same round. Round 6 is
therefore scoped as that single frozen pass.
