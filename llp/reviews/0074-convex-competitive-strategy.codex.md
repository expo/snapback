**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.6 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-22
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0074 reviews — GPT family

## Round 1 — 2026-07-22

**Revision under review:** `llp/0074-convex-competitive-strategy.rfc.md`, sha256 `21276b45ce957319ee29d1f0d57ae2d656a5637c24ccff26f8e76c5863fc2e40` (untracked file at repo HEAD `4a1024a7`)
**Runtime detail:** codex session id 019f893d-5e65-7e91-877b-bcded2f4da6f, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Unlike earlier super-refine runs, this session had working web search: Convex-side claims were checked against official documentation fetched 2026-07-22, stated as such in the body.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

MATCH. Reviewed SHA-256 `21276b45ce957319ee29d1f0d57ae2d656a5637c24ccff26f8e76c5863fc2e40` at repository HEAD `4a1024a7`; the file was untracked. A final checksum after the audit still matched. I did not inspect `llp/reviews/` or secret files.

## 2. Overall assessment

LLP 0074 has a strong strategic core: match immediate usability, differentiate on explicit semantics and ownership, and refuse convenience that erases authority or evidence. Most corpus characterizations are accurate, and the central streaming and deployment-coupling observations are genuinely present in the cited evidence.

It is not ready to advance to Review. Three issues are load-bearing: its competitive baseline is incomplete enough to misclassify at least one differentiator; it conflicts with LLP 0063 over ownership of sequencing and evidence; and its checkpoint and final acceptance criteria lack preregistered decision rules. The strategy also promotes qualitative findings from two repository-local experiments into broader market priorities without enough separation between observation and hypothesis.

Claims about Convex’s current product are based on official documentation fetched on 2026-07-22, not prior knowledge.

## 3. Strengths

- The RFC states its evidence limits and authority boundary unusually clearly: two application shapes, omitted production identity, and a Snapback familiarity advantage are all acknowledged (`llp/0074-convex-competitive-strategy.rfc.md:37-49`).

- The load-bearing corpus claims are mostly accurate. The exact `trusted-single-tenant-app-complete.v1` string and narrow nonclaims appear in both LLP 0063 and LLP 0072 (`llp/0074-convex-competitive-strategy.rfc.md:148-152`; `llp/0063-partitime-platform-roadmap.plan.md:1009-1015`; `llp/0072-trusted-single-tenant-control-plane.rfc.md:13-24`). LLP 0065’s schema-derived/security-declared/runtime-evidence split is reproduced faithfully (`llp/0074-convex-competitive-strategy.rfc.md:198-203`; `llp/0065-generated-data-pattern-soundness.rfc.md:51-72`). LLP 0004 and LLP 0007 do leave joins and full migration semantics open as claimed (`llp/0074-convex-competitive-strategy.rfc.md:262-265`; `llp/0004-application-data-api.rfc.md:393-395`; `llp/0007-storage-portability.spec.md:525-527`).

- The empirical core is supported. Convex’s unattended deployment experience is recorded in Diary 0016 (`diaries/0016-partiful-matrix.diary.md:124-157`, `:254-262`); its fastest-chat judgment and streamed action path appear in Diary 0017 (`diaries/0017-chat-matrix.diary.md:14-40`, `:158-168`). Snapback’s generated contract and declaration/setup tax are likewise directly documented (`diaries/0016-partiful-matrix.diary.md:45-91`, `:1145-1188`).

- The streaming section is appropriately semantic. It covers cancellation, backpressure, resource bounds, retries, ambiguity, durable-work interaction, and requires multiple authoritative commits rather than animation (`llp/0074-convex-competitive-strategy.rfc.md:172-196`).

- The Refuse category coheres with the generated-authoring proposal: brevity cannot erase authorization, visibility, transport, settlement, or portability facts (`llp/0074-convex-competitive-strategy.rfc.md:120-133`, `:225-226`).

- Competitive acceptance avoids a misleading composite score and separates completeness, first-hour cost, and evidence confidence (`llp/0074-convex-competitive-strategy.rfc.md:340-365`).

- Header metadata is convention-complete (`llp/0074-convex-competitive-strategy.rfc.md:3-9`; `CLAUDE.md:13-20`). `./ref-check --verbose` passed: 75 LLP documents, 1,668 references, zero errors, and one unrelated unchecked shorthand.

## 4. Concerns

1. **Major — The competitive baseline is incomplete and already misclassifies a differentiator.**

   Evidence: the comparison basis is limited to two repository-local matrices (`llp/0074-convex-competitive-strategy.rfc.md:39-44`), yet “the same application runs locally without a hosted account” is classified as a Snapback differentiator (`llp/0074-convex-competitive-strategy.rfc.md:103-118`). Current Convex documentation supports account-free local deployments and production self-hosting. Convex’s FSL Apache 2.0 license remains materially different from Snapback’s MIT posture, but local/no-account operation itself is not unique. See [Convex local deployments](https://docs.convex.dev/cli/local-deployments) and [self-hosting and licensing](https://docs.convex.dev/self-hosting).

   The RFC also lacks a dated inventory of Convex’s current previews, backups, authentication, search, components, and durable workflows, all of which overlap Match or Priority 4. See [multiple deployments](https://docs.convex.dev/production/multiple-deployments), [backup and restore](https://docs.convex.dev/database/backup-restore), [authentication](https://docs.convex.dev/auth/overview), [full-text search](https://docs.convex.dev/search/text-search), and [components](https://docs.convex.dev/components).

   Resolution criteria: add a dated, sourced, versioned Convex capability inventory, including hosted versus self-hosted and stable versus beta/component status. Label every competitive claim as matrix-observed, official-doc-confirmed, or strategic hypothesis. Reclassify anonymous local development as Match, or define the narrower measurable property Snapback uniquely supplies. Assign an owner and refresh cadence.

2. **Major — Priority 5 turns a deliberately shared deployment into an inadequately controlled competitive inference.**

   Evidence: the incident is real: deploying the older Partitime-only schema removed chat indexes (`diaries/0016-partiful-matrix.diary.md:834-843`), and both demos intentionally shared one Convex deployment whose code and schema were deployment-global (`diaries/0017-chat-matrix.diary.md:129-135`; `demos/chat-matrix/README.md:81-85`). However, current Convex supports separate development, preview, staging, and production deployments. The incident proves whole-codebase atomicity within one deployment and weak fixture isolation; it does not prove that Convex cannot isolate applications.

   Resolution criteria: rerun or explicitly analyze the comparison with separate projects or preview deployments. Distinguish “one code/schema set per deployment” from “no application isolation,” and compare target selection, fencing, preview creation, and destructive-deploy failure modes directly. Narrow `llp/0074-convex-competitive-strategy.rfc.md:249-260` accordingly.

3. **Major — Qualitative findings are presented as established facts and then generalized beyond the evidence.**

   Evidence: “shortest credible hosted path,” “increase first-hour cost,” “streaming is a product requirement,” and “fastest adoption surface” are grouped as five facts (`llp/0074-convex-competitive-strategy.rfc.md:51-75`). The underlying diaries support the observations, but not all the generalizations: Diary 0017 labels its rankings subjective after one build day (`diaries/0017-chat-matrix.diary.md:158-168`), and setup tax was observed rather than timed. The RFC then calls a nine-area platform program the “remaining gap,” despite acknowledging that the experiments cover only two app shapes (`llp/0074-convex-competitive-strategy.rfc.md:39-44`, `:228-247`).

   Resolution criteria: separate measured observations, qualitative builder findings, and strategic hypotheses. Scope each finding to the tested application/profile. Identify the target customer and job-to-be-done, and add current-product or customer evidence for platform services not exercised by the matrices.

4. **Major — LLP 0074 conflicts with LLP 0063 over sequencing and evidence authority, while treating Draft authorities as settled.**

   Evidence: LLP 0074 says it owns investment order and gap-closing evidence while LLP 0063 remains the platform roadmap (`llp/0074-convex-competitive-strategy.rfc.md:29-35`). LLP 0063 already says it owns priorities, cross-stack gates, pressure-test order, “clearly better,” sequencing, and evidence (`llp/0063-partitime-platform-roadmap.plan.md:284-300`, `:1078-1191`). The two orders are not mapped.

   Every substantive authority delegated in LLP 0074’s body except LLP 0036 is still Draft. LLP 0063 explicitly says Draft LLPs 0068–0073 confer no capability until accepted and witnessed (`llp/0063-partitime-platform-roadmap.plan.md:3-10`, `:984-995`, `:1026-1028`). LLP 0074 nevertheless uses unqualified “owns,” “govern,” and “under” language (`llp/0074-convex-competitive-strategy.rfc.md:31-35`, `:201-203`, `:235-242`).

   Resolution criteria: add an authority and gate crosswalk mapping every LLP 0074 stage to LLP 0063 workstreams, Step 0 obligations, and cumulative gates. State which document controls sequencing and amend LLP 0063 in the same landing if 0074 changes it. Label Draft documents as proposed authorities and state explicitly that accepting 0074 does not ratify their semantics or create capability evidence.

5. **Major — The numbered priorities and canonical sequence do not agree.**

   Evidence: setup tax appears before Snapback’s advantages (`llp/0074-convex-competitive-strategy.rfc.md:63-66`), and clean installation plus diagnostics are Match requirements (`:100-101`), but setup is Priority 6 (`:267-286`). React/Expo is called the fastest adoption surface (`:71-75`) but is Priority 7 (`:288-308`) and absent from the six-stage sequence (`:310-320`). Public packages are instead pulled into Deploy, while diagnostics partly appear under Shorten.

   Resolution criteria: define one canonical ordering. Make packaging and doctor a prerequisite or cross-cutting Deploy gate, and identify React/Expo as the checkpoint surface if that is the intended adoption path. Map every numbered priority to an entry condition, exit condition, and sequence stage, or remove priority numbering from cross-cutting workstreams.

6. **Major — The three-deliverable checkpoint is finite but not preregisterable as written.**

   Evidence: “fresh external application,” “multiple bounded” commits, and “ordinary CRUD” are not defined (`llp/0074-convex-competitive-strategy.rfc.md:327-338`). The deploy deliverable omits backup/restore despite the selected profile requiring both. The streaming deliverable does not state a minimum patch count, duration, byte/patch bounds, cancellation case, or retry/ambiguity case. The generated-pattern deliverable can be satisfied by choosing a trivial application, while the actual patterns remain an open question (`:405-406`).

   Resolution criteria: freeze the application fixture, frontend, package source, initial machine/checkout state, exact CRUD/query patterns, hosted-profile subset, minimum intermediate commits, quantitative stream bounds, and negative/cancellation/retry cases. Define the rerun’s continue, stop, and reprioritize outcomes before implementation.

7. **Major — Competitive acceptance lists measurements but lacks a claim decision rule.**

   Evidence: “almost as fast” and “close enough” have no tolerance (`llp/0074-convex-competitive-strategy.rfc.md:23-27`, `:360-365`), and the tolerance is explicitly unresolved (`:407-409`). There is no pinned Convex version/tier/backend revision, hardware/network setup, assistance policy, repetition count, statistic, criterion-specific bound, or conjunctive pass rule. Diary 0016 already demonstrates stronger metrology with warmups, alternating samples, median/p95, attributed transport, and fail-closed skips (`diaries/0016-partiful-matrix.diary.md:571-590`).

   Resolution criteria: define or delegate to a named versioned protocol covering application profile, implementation and service versions, plan/region, environment, allowed human/agent assistance, repetitions/statistics, skip treatment, non-inferiority margins, mandatory criteria, and adjudication. Register it before metric-affecting work starts.

8. **Major — Ownership, resourcing, and opportunity cost are absent.**

   Evidence: the RFC claims program ordering and permits parallel work (`llp/0074-convex-competitive-strategy.rfc.md:29-35`, `:322-325`) but names no strategy owner, workstream DRI, resource envelope, horizon, operating budget, or displaced work. Ownership of the hosted offering remains an open question (`:412-413`). Refuse supplies architectural constraints, not a complete scope boundary.

   Resolution criteria: name accountable owners; state staffing/capacity and delivery assumptions; identify dependencies and work being deprioritized; assign hosted operations responsibility; and consolidate explicit non-goals covering API compatibility, managed-service scope, enterprise/SLA goals, regulated workloads, scale, and price parity.

9. **Minor — The streaming observation is source-corroborated but not retained as a multi-patch receipt.**

   Evidence: Diary 0017 and the README explicitly record the missing Ibex response-body stream (`diaries/0017-chat-matrix.diary.md:31-40`; `demos/chat-matrix/README.md:15-24`). Source also shows Snapback making one terminal commit and Convex reading `response.body` into throttled patches (`demos/chat-matrix/snapback/handlers.mjs:59-89`; `demos/chat-matrix/convex/convex/chat.ts:91-147`). However, the current acceptance test waits only for terminal completion and records no intermediate-state count (`demos/chat-matrix/tests/acceptance/loop.mjs:56-70`; `demos/chat-matrix/tests/acceptance/results-loop.json:25-45`).

   Resolution criteria: either describe the existing result as diary-observed and source-corroborated, or retain a receipt proving multiple intermediate authoritative Convex commits. Use “no response-body stream” rather than the broader “no `ReadableStream`”; official Convex runtime documentation confirms its Web Streams support ([Convex runtimes](https://docs.convex.dev/functions/runtimes)).

10. **Minor — The corpus has status drift and an over-compressed generated-pattern authority map.**

    Evidence: LLP 0074’s web/iOS/Android Online claim is supported by newer LLP 0063 closure notes (`llp/0074-convex-competitive-strategy.rfc.md:71-75`; `llp/0063-partitime-platform-roadmap.plan.md:45-55`, `:85-104`), but LLP 0012 still says iOS and Exact Native are pending (`llp/0012-headless-integration-contract.spec.md:8-13`, `:848-861`, `:1016-1026`). LLP 0065 owns the security/fact-class floor and a narrow owner-scoped profile, not every broad pattern listed at `llp/0074-convex-competitive-strategy.rfc.md:205-217`; LLP 0051 and future query/migration authorities also participate. Likewise, LLP 0072 owns deployment migration orchestration, not the general migration semantics left open by LLP 0004/0007.

    Resolution criteria: reconcile LLP 0012’s native status; split generated-pattern ownership among LLP 0065, LLP 0051, and future query/migration authorities; qualify `llp/0074-convex-competitive-strategy.rfc.md:242` as deployment migration orchestration; and add LLP 0004 and LLP 0007 to `Related`.

## 5. Suggestions

- Add a compact table for each Match/Differentiate claim: current state, evidence source, proposed owner, dependency status, comparator state, and refresh date.

- Reword fact 2 to say one authored schema/function set generated manifests, bindings, schemas, references, and capability facts; “generated functions, schemas” can be read as claiming the authored backend itself was generated.

- Preserve the three-outcome acceptance model, but report confidence intervals and raw command/time/failure data beside the narrative verdict.

- Add unit economics, operational labor, reliability/SLA, and ecosystem maturity as explicitly deferred competitive axes even if they are not first-checkpoint gates.

## 6. Open questions

1. Is LLP 0074 intended to supersede LLP 0063’s sequence, amend it, or rank only its remaining work?

2. Which named customer and application profile is the first competitive claim for: solo developers, small teams, agent-authored apps, AI chat, or general consumer applications?

3. What remains uniquely differentiating after accounting for Convex local deployments and self-hosting: permissive licensing, identical local/hosted semantics, retained local-first execution, target portability, or a conjunction?

4. Is “almost as fast” a non-inferiority bound on elapsed time, commands, failures, agent tokens, or a conjunctive rule?

5. Will the coupling claim be tested using separate Convex preview/project identities?

6. Who owns and operates the first hosted adapter, and what existing work is displaced to staff it?

## 7. Readiness verdict

The factual core is valuable, but the comparator baseline, authority relationship, canonical sequence, and acceptance protocol need revision before formal Review.

NOT READY

### Orchestrator verification (round 1)

Spot-checked the decisive claims without altering the verbatim body: (1) `demos/chat-matrix/tests/acceptance/loop.mjs:56-70` confirmed — the loop polls `listMessages` until `assistant.status === 'complete'` and retains no intermediate-state count, so concern 9's "no multi-patch receipt" is accurate. (2) `llp/0063-partitime-platform-roadmap.plan.md:284-300` confirmed — 0063 states "This Plan owns sequencing and evidence" and owns priorities/gates, so concern 4's authority overlap is real and unmapped in 0074; the same file's header (lines 3-10) carries the Draft-authorities admission rule concern 4 cites. (3) The Convex-side claims (account-free local deployments, self-hosting, preview deployments, backup/restore, search, components) came from live doc fetches on 2026-07-22 and independently converge with the Claude-family round's prior-knowledge flag on the same differentiator, so concern 1's reclassification demand stands. Disposition: address concerns 1-7 and 9-10 in the round-2 revision; concern 8's DRI/resourcing names are author decisions — the revision records them as explicit open author decisions and adds a non-goals consolidation rather than inventing owners.

## Round 2 — 2026-07-22

**Revision under review:** `llp/0074-convex-competitive-strategy.rfc.md`, sha256 `f91905a7a55be28ec1924dceb7e871c4150b701d7fc9c39fc9cd88d3ad8dede4` (untracked file at repo HEAD `4a1024a7`; round-2 revision after the round-1 dual-model feedback)
**Runtime detail:** codex session id 019f894c-b324-7141-bd7f-07468cb9daa1, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, to its own round-1 session, or to the concurrent Claude-family round. Network reachable: comparator claims checked against official Convex documentation on 2026-07-22.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

MATCH — reviewed sha256 `f91905a7a55be28ec1924dceb7e871c4150b701d7fc9c39fc9cd88d3ad8dede4` at repository HEAD `4a1024a7`. A final recheck after review also matched.

## 2. Overall assessment

This is a strong strategy RFC with unusually good evidence discipline, a useful Match/Differentiate/Refuse posture, and substantially falsifiable checkpoint and acceptance requirements. The five findings are mostly well supported, and most delegated-LLP characterizations are accurate.

It is not ready to advance to Review, however. Three structural issues remain: LLP 0074 and LLP 0063 overlap on evidence authority; the RFC does not apply its own Draft-authority admission rule to stages 1–3; and the dated Convex inventory omits capabilities that materially change Priority 5 and first-hour comparisons.

The network was reachable. Comparator claims were checked against current official Convex documentation.

## 3. Strengths

- The evidence limitations are candid and decision-relevant: two application shapes, omitted production identity, subjective rankings, Snapback familiarity advantage, and untimed setup tax are all explicit (`llp/0074-convex-competitive-strategy.rfc.md:53-71`).

- The RFC correctly abandons “local development” and “self-hosting” as standalone differentiators and narrows openness to licensing and end-to-end portability (`llp/0074-convex-competitive-strategy.rfc.md:15-27`, `:201-226`). Official Convex documentation confirms anonymous local development and production self-hosting under FSL ([local deployments](https://docs.convex.dev/cli/local-deployments), [self-hosting](https://docs.convex.dev/self-hosting)).

- The streaming finding is especially rigorous. It separates diary observation, source corroboration, and the missing retained witness (`llp/0074-convex-competitive-strategy.rfc.md:130-140`). The Convex implementation really reads `response.body` and commits throttled patches (`demos/chat-matrix/convex/convex/chat.ts:91-147`), while the retained acceptance checks only terminal completion (`demos/chat-matrix/tests/acceptance/loop.mjs:56-70`).

- Priority 5 avoids laundering a self-inflicted shared-deployment incident into “Convex cannot isolate applications” and requires a better rerun before competitive use (`llp/0074-convex-competitive-strategy.rfc.md:364-378`; `diaries/0016-partiful-matrix.diary.md:834-843`).

- The acceptance design avoids a single composite score, requires raw observations, and preregisters margins, mandatory criteria, a conjunctive rule, statistical treatment, and adjudication (`llp/0074-convex-competitive-strategy.rfc.md:502-543`). That is a sound foundation once its authority and baseline are reconciled with LLP 0063.

- The owner, target customer, hosted posture, and implementation choices are appropriately left to the author while the RFC is Draft; the document clearly prevents acceptance before program ownership and resourcing are resolved (`llp/0074-convex-competitive-strategy.rfc.md:545-565`, `:599-623`).

- The metadata header contains every required field. `./ref-check --verbose` passed with 75 LLP documents, 1,668 references, zero errors, and one unrelated unchecked shorthand.

## 4. Concerns

### Major — The authority crosswalk does not actually resolve LLP 0063’s evidence ownership

Evidence: LLP 0074 claims the competitive evidence and preregistration standard while saying LLP 0063 retains “sequencing and evidence” authority (`llp/0074-convex-competitive-strategy.rfc.md:42-50`, `:78-93`). LLP 0063 already owns priorities, cross-stack gates, “clearly better,” and unqualified sequencing and evidence (`llp/0063-partitime-platform-roadmap.plan.md:284-300`). It also already defines a preregistered protocol, baseline and threshold versioning, holdout amendments, and rerun rules (`llp/0063-partitime-platform-roadmap.plan.md:468-530`), and owns the idiomatic Convex follow-up instrument required before final comparative ranking (`llp/0063-partitime-platform-roadmap.plan.md:1243-1257`). LLP 0074 requires a 0063 amendment only when priority order changes, not when evidence authority changes.

Resolution criterion: either subordinate LLP 0074’s comparison protocol and claims to LLP 0063’s existing admission machinery, or require a coordinated LLP 0063 amendment that explicitly delegates the Convex-specific protocol. The amendment must define artifact/version precedence, manifest admission, workload and baseline rollover, and treatment of already-landed metric-affecting work.

### Major — The Draft-authority rule is not propagated through the gates

Evidence: LLP 0074 says Draft authorities confer no capability claim until accepted and witnessed (`llp/0074-convex-competitive-strategy.rfc.md:95-103`), but only stages 4–5 explicitly require authority acceptance (`:466-467`).

- Gate 1 depends on Draft LLP 0041 and Draft LLP 0072; LLP 0072 explicitly says the hosted profile remains unsupported while Draft (`llp/0072-trusted-single-tenant-control-plane.rfc.md:321-323`).
- Gate 2 requires a dedicated streaming semantic amendment, but no acceptance prerequisite is mapped (`llp/0074-convex-competitive-strategy.rfc.md:73-76`, `:280-304`).
- Gate 3 and the checkpoint depend on Draft LLPs 0051, 0065, and 0064; LLP 0065 says its implementation candidate cannot promote the declaration-reduction claim while Draft (`llp/0065-generated-data-pattern-soundness.rfc.md:174-177`).
- Stage 4 includes payments under Draft LLP 0069 (`llp/0074-convex-competitive-strategy.rfc.md:347-357`), but line 466 names only LLPs 0070–0073.
- Finding 5 presently claims Online capability across web, iOS, and Android even though the governing profile and cited closure plan are Draft (`llp/0074-convex-competitive-strategy.rfc.md:141-147`; `llp/0064-native-client-surfaces.rfc.md:3-28`).
- Search appears under Priority 4 at line 352 but under stage 5 at line 459, so the priority-to-stage mapping is not yet unique.
- LLP 0051 is omitted from the supposedly exhaustive delegated-authority list, while LLP 0068 is listed but has no operative role (`llp/0074-convex-competitive-strategy.rfc.md:95-103`, `:306-316`).

Resolution criterion: add a complete gate-to-authority table. Every gate must name its governing semantic authority, required status, executable witness, and claim admitted at closure. Include at least 0041/0072 for Gate 1, a streaming authority for Gate 2, 0051/0065 and any relied-on 0064 profile for Gate 3, 0069–0072 for Gate 4, and 0073 plus future query/projection/migration authorities for Gate 5. Resolve search to one stage and narrow present capability language to “evidence satisfies the proposed criteria” until its authority is accepted.

### Major — The dated Convex baseline is materially incomplete

Evidence: the inventory is declared to govern classification (`llp/0074-convex-competitive-strategy.rfc.md:156-180`), but it omits several decision-relevant surfaces:

- Convex documents online, resumable migrations with dry runs, schema compatibility enforcement, and staged index backfills ([migrations](https://docs.convex.dev/database/writing-data), [production schema changes](https://docs.convex.dev/production/overview), [staged indexes](https://docs.convex.dev/database/reading-data/indexes/)). These directly affect Priority 5’s proposed data-evolution advantage (`llp/0074-convex-competitive-strategy.rfc.md:364-392`).
- Convex Agent Mode supports anonymous local backends, per-agent deployments, scoped keys, expiration, and worktree setup recipes ([Agent Mode](https://docs.convex.dev/cli/agent-mode)). Those materially affect the first-hour, setup, and isolation baselines.
- The statement that a deployment owns “one global codebase and schema” is too broad (`llp/0074-convex-competitive-strategy.rfc.md:366-372`). Convex Components have isolated functions, schemas, data, and multiple instances within one deployment ([Components](https://docs.convex.dev/components/understanding)). The diary incident remains valid for the two root applications actually deployed, but not as a generic platform statement.
- Convex also documents React Native, Swift, and Kotlin realtime clients, relevant to Priority 7 ([React Native](https://docs.convex.dev/client/react-native), [Swift](https://docs.convex.dev/client/swift/overview), [Kotlin](https://docs.convex.dev/client/android/overview)).

Resolution criterion: refresh the inventory with these surfaces and record for each whether it is core or component-provided, maturity, tier requirements, and important semantic limits. Reclassify migrations and isolation against that baseline; phrase any Snapback superiority as a hypothesis about reviewed plans, target fencing, portability, or executable evidence. Rewrite the coupling claim as root-application replacement scope and include Components as an explicitly tested or excluded alternative.

### Minor — The evidence taxonomy is not applied as promised

Evidence: the RFC says every competitive claim carries one of three bases (`llp/0074-convex-competitive-strategy.rfc.md:63-71`) and collectively calls all five findings matrix-observed (`:105-109`). Several findings mix observation and inference:

- Finding 1 says Convex had the shortest hosted path in both matrices and causally attributes that result to a feature bundle (`:111-119`). Partitime supports the narrower “best unattended hosted function deploy” verdict (`diaries/0016-partiful-matrix.diary.md:254-277`), while chat’s fastest-cell verdict is explicitly subjective after one build day (`diaries/0017-chat-matrix.diary.md:158-168`).
- “Made streaming a product requirement” and “should not gate React/Expo adoption” are strategic conclusions, not matrix observations (`llp/0074-convex-competitive-strategy.rfc.md:130-147`).
- “Whole-codebase atomicity” exceeds the evidence, which proves deployment-global replacement scope under the tested topology, not transactional deploy atomicity (`:366-373`; `diaries/0016-partiful-matrix.diary.md:834-843`).

Resolution criterion: split observations from proposed strategic conclusions and tag the latter as hypotheses or RFC decisions. Narrow Finding 1 to the two recorded verdicts unless a timed scaffold-to-hosted-URL experiment supports the broader claim. Replace “atomicity” with “replacement scope” unless separately witnessed.

### Minor — The preregistration minimum is asymmetric and needs a prospective cutoff

Evidence: the acceptance protocol explicitly pins the Convex version, plan, and self-hosted revision, but does not equally require the Snapback revision, package artifacts, hosted adapter, or application-fixture digest (`llp/0074-convex-competitive-strategy.rfc.md:530-543`). It also requires freezing before metric-affecting work despite substantial related implementation already being recorded in LLP 0063.

Resolution criterion: pin immutable identities for both comparison arms, the application fixture, packages, target adapters, credentials/preconditions, and protocol implementation. State the prospective baseline cutoff and whether the claim covers only the exact fixture or a broader customer profile requiring one or more holdout fixtures.

## 5. Suggestions

- Replace the inventory bullets with a table containing capability, delivery class, maturity, tier, semantic limits, source, and verification date.
- Define whether “Match” means exact Convex parity or broader market table stakes. Hosted rollback currently appears in Match without a defined Convex comparator operation.
- Replace “truly open” and “completeness of what is open” with an artifact-by-artifact license and availability comparison; the MIT-versus-FSL distinction is established, but control-plane completeness is not.
- Add explicit Open Questions for staffing, horizon, and displaced work, which are required by the ownership section but absent from the numbered list.
- Change the chat README’s opening “streams” summary to “updates the row server-side, streaming where supported”; its detailed section correctly says Snapback produces one commit (`demos/chat-matrix/README.md:3-24`).

## 6. Open questions

1. Is LLP 0074 intended to amend LLP 0063’s competitive-evidence authority, or to define a subordinate Convex-specific protocol?
2. Is the competitive claim about one exact frozen fixture, or a broader customer/application profile requiring holdout applications?
3. Does “Match” mean matching documented Convex behavior, or meeting independently chosen market table stakes?
4. Should Convex Components be an admissible isolation strategy in the Priority 5 rerun, or is the comparison deliberately restricted to root applications?
5. Which owner and target customer must be chosen before the protocol freeze, and what existing work marks the prospective baseline?

## 7. Readiness verdict

The strategy is promising, and the remaining product choices may properly stay with the author during Review. The authority conflicts, incomplete gate mapping, and materially incomplete comparator baseline should be corrected before the document advances from Draft.

NOT READY

### Orchestrator verification (round 2)

Spot-checked the decisive claims without altering the verbatim body: `llp/0063-partitime-platform-roadmap.plan.md:476-482` confirmed 0063's own step-0 preregistered comparison protocol (workload, environment pinning, cost attribution, sampling), and `:1243-1250` the native-realtime follow-up matrix instrument — so the major-1 claim that 0074's protocol needs an explicit 0063 delegation is accurate; `llp/0072-trusted-single-tenant-control-plane.rfc.md:321-323` confirmed the hosted profile "remains unsupported" while 0072 is Draft, and `llp/0065-generated-data-pattern-soundness.rfc.md:174-177` confirmed the implementation candidate "does not … promote `STEP5.DECLARATION_REDUCTION`" while Draft — both backing major 2's gate-propagation demand. The inventory additions in major 3 (migrations, Agent Mode, Components isolation, native clients) came from live doc fetches and were incorporated with an explicit verified-page vs. adjacent-page/prior-knowledge marking. Disposition: majors 1–3 and both minors were applied in the post-round-2 revision (sha256 `c41982c6fe0eaa77a726299521fa13181675cfaba3bf2a28b6447e5ee6a5ea48`): evidence authority routed through a coordinated 0063 amendment with baseline-cutoff rules, a complete gate-to-authority table covering gates 1–5, the extended comparator inventory, the observation/conclusion split in all five findings ("replacement scope" replacing "atomicity"), and symmetric two-arm preregistration pinning with the fixture-as-protocol-v0 relationship. The chat-matrix README wording suggestion is a follow-up outside this document. The user-requested two rounds are complete; the loop stopped here with the round-2 concerns applied but not re-reviewed, and the open author decisions (owner, customer profile, tolerance, Match semantics, Components admissibility) remain with the author per the skill's product-decision boundary.
