**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.6 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-19
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0063 reviews — GPT family

## Round 1 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `ddb261038b5aab1af0cf764fbbb79f2d843a080b8a1360decf3a0c9220f1addf` (untracked file at repo HEAD `157a3cc`)
**Runtime detail:** codex session id 019f7d69-122a-7ad1-a81c-946356052646, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

Hash verification: **MATCH** — `shasum -a 256` computed `ddb261038b5aab1af0cf764fbbb79f2d843a080b8a1360decf3a0c9220f1addf`. The untracked target is the requested revision; repository HEAD is `157a3cc3f919736ef557dcc7024835b7b5de08e6`.

## 1. Overall assessment

LLP 0063 is a promising strategic reset with a credible product thesis: make Contract × Snapback the default data-authoring path while retaining React as a first-class escape hatch. The Partiful matrix supplies unusually concrete evidence, and the proposed workstreams generally attack the friction it exposed.

It is not yet a complete Plan of the kind the document claims to be. Several still-open LLP 0016 obligations disappear or receive only nominal workstream assignments; the new demo order conflicts with existing governing plans; and the sequence lacks measurable phase gates, target profiles, and cross-repository dependencies. Some evidence is also promoted into a precise ranking more strongly than the diary and report support.

## 2. Strengths (with section citations)

- The “North star” is disciplined and appropriately constrained. It aims for a coherent platform without claiming that every product should use one UI path or that one backend should dominate every workload ([LLP 0063, “North star”](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:27)).

- Most of “Evidence and limits” is faithful to the experiment. The eight cells and 24 shared checks are supported by the harness ([browser-matrix.mjs](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:20)); the raw minified bundle figures are exactly 401,783 bytes for React × Snapback and 718,695 bytes for Contract × Snapback ([REPORT.md](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:255)); and the diary accurately discloses that the Supabase and Convex cells polled instead of exercising their native realtime transports ([Diary 0016](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:28)). React × Snapback genuinely uses the streaming live-query path ([React provider](/Users/ccheever/projects/snapback/demos/partiful-matrix/surfaces/react/src/provider.ts:23)).

- “Scope and ownership” correctly treats this as a sequencing and evidence document rather than attempting to redefine subsystem semantics inside the roadmap ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:71)).

- Workstream 1 turns an observed ergonomic problem into specific behavioral gates: dynamic keyed scopes, no stale result flashes, one active subscription, reconnect correctness, and cleanup on unmount ([LLP 0063, Workstream 1](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:175)).

- Workstream 2 wisely frames vanilla DOM as a focused boundary experiment rather than manufacturing a ninth full matrix arm ([LLP 0063, Workstream 2](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:193)).

- Workstream 4 defines a useful provider-convergence boundary: generated real types, no hand-edited view code, explicit drift failure, and no polling implementation claiming push semantics ([LLP 0063, Workstream 4](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:247)).

- The risk register is unusually candid about distorted comparisons, cross-repository drift, overfitting to one polished demo, and premature ecosystem claims ([LLP 0063, “Risks”](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:399)).

## 3. Concerns — numbered C1, C2, …; each with severity (major or minor), concrete evidence (file paths / quotes), and explicit resolution criteria

**C1 — Severity: major. The roadmap lacks the program controls and acceptance gates it claims to own.**

Evidence: The scope says the Plan owns sequencing, cross-stack acceptance gates, and the definition of “clearly better” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:71)). Yet its decision threshold is “without accepting a meaningful loss” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:170)), with no metric or tolerance. Workstreams 7 and 8 have no acceptance subsections; Workstream 8 lists budget categories without numbers or target profiles ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:320), [LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:339)). The sequence names activities but supplies no prerequisites, owners or repositories, executable witnesses, or entry/exit conditions ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:358)).

This is particularly material for production and scale. The root LLP requires workload envelopes covering concurrency, read/write rates, fan-out, auxiliary services, latency, and degradation ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:736)). LLP 0063 says security is not later hardening, but sequences “Production services” last while putting identity, rate limits, abuse controls, moderation, and audit history into an ungated workstream. The auth guide still says the local target is not hosted-auth ready ([auth targets](/Users/ccheever/projects/snapback/guide/auth/targets.md:32)).

Resolution criteria: add a phase-gate matrix naming, for every phase, its owning repository/LLP, prerequisites, deliverables, executable commands or artifacts, target profile, quantitative or binary thresholds, and exit criteria. Give Workstreams 7 and 8 explicit gates. Make identity, authorization, abuse, and resource-safety gates prerequisites for any relevant production vertical.

**C2 — Severity: major. The LLP 0016 carry-forward is incomplete.**

Evidence: LLP 0016 still marks “Freeze v0 contracts” as open ([LLP 0016](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:94)). LLP 0020 makes that obligation concrete through stable diagnostics, deterministic reset/seed, atomic initial-result-plus-subscription behavior, deterministic delivery controls, machine-readable capability gaps, and artifact freshness ([LLP 0020](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:145)). LLP 0063’s carried invariants retain only part of that set.

LLP 0016 also says handler resource-limit hardening remains. Current security documentation still marks ordinary query and top-level mutation preemption as missing and leaves hosted/multi-tenant execution unratified ([LLP 0009](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:26)). LLP 0063 retires the absence of `ctx.db`, but does not carry the remaining resource-safety obligation.

Finally, LLP 0016 records open selector/transform ergonomics and data-aware Agent API verification. Exact LLP 0265 still leaves slot-local derives and forced data-state verification as follow-up work ([Exact LLP 0265](/Users/ccheever/projects/exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md:280)). These are absent from both the carry-forward and “not carried” lists.

Resolution criteria: produce an exhaustive LLP 0016 reconciliation. Every open item must either have a sequenced home and executable gate in LLP 0063 or appear under “not carried” with specific normative or implementation evidence explaining its closure or retirement. Hosted or untrusted execution must remain gated on enforceable per-invocation resource limits.

**C3 — Severity: major. Several obligations are “carried” only by naming a workstream.**

Evidence: The table carries the version handshake, exact subscription races, server-only import exclusion, `basePath`, managed lifecycle, an admin client/view-model decision, Exact theme/textarea/static-native recipes, and Expo/native proof ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:87)). Their assigned workstreams do not contain matching deliverables or acceptance tests. Most clearly, Expo/native is assigned to Workstream 2, but that workstream covers React and vanilla DOM and its acceptance criteria are entirely vanilla.

These are concrete open requirements in LLP 0021, including handshake behavior, packaging, lifecycle, admin boundaries, and Exact integration work ([LLP 0021](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:464)).

Resolution criteria: every carry-forward row must point to an explicit deliverable and measurable acceptance gate in its destination workstream, or normatively incorporate the still-applicable LLP 0021 gate and place it in the sequence.

**C4 — Severity: major. The proposed pressure-test order conflicts with documents that still own the demo ladder.**

Evidence: LLP 0063 claims the next application order and says the old ladder need not be mechanically preserved ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:375)). LLP 0016, however, explicitly delegates demo corpus/order ownership to LLP 0015 and acceptance-ladder ownership to LLP 0010 ([LLP 0016](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:382)). Both still contain their own ordered ladders ([LLP 0015](/Users/ccheever/projects/snapback/llp/0015-demo-application-suite.plan.md:425), [LLP 0010](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:562)). Superseding LLP 0016’s forward program does not by itself supersede LLP 0010 or LLP 0015.

Resolution criteria: amend the governing ladder documents to adopt the new ordering, or define LLP 0063’s pressure tests as a separate product-validation track that does not replace the existing capability-proof ladder.

**C5 — Severity: major. The exact ranking is more certain than the evidence supports.**

Evidence: The report’s conclusion is conditional: React × Snapback is strongest when bespoke web UI matters most, while Contract × Snapback is the cleanest data-authoring path ([REPORT.md](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:743), [REPORT.md](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1003)). LLP 0063 turns that into a precise 1–8 ranking without stating weights, uncertainty, or tolerable regressions ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:151)).

One claimed observation is unsupported: the evidence section says React supplied “animation, accessibility libraries, and escape hatches,” but the React cell’s only runtime dependencies are React and ReactDOM ([React package.json](/Users/ccheever/projects/snapback/demos/partiful-matrix/surfaces/react/package.json:14)), and the shared browser contract does not test accessibility. The bundle claim is numerically correct, but “Contract packages are large” is broader than a single Exact 0.1.2 build with no size-tuning pass.

The limits section also omits material qualifications from the report: no production auth, no runtime-performance or clean-machine timing study, a repo-local Snapback setup advantage, one application shape, and one builder ([REPORT.md](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:943)). Native Supabase/Convex realtime is acknowledged as missing, but the follow-up experiment is not placed in the sequence.

Resolution criteria: separate observations from Plan synthesis; correct the React-library claim; qualify the bundle conclusion; include the material experiment limits; state the weighting and tolerances behind the ranking; and schedule a native-realtime comparator before treating middle-rank backend conclusions as final.

**C6 — Severity: major. The proposed default path lacks required mobile and production-web gates.**

Evidence: Expo/native is explicitly carried as unproved but has no actual workstream acceptance gate. This conflicts with the root architecture, where Exact is especially important on mobile and React/Expo is a serious secondary consumer ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:391)); LLP 0012 already defines React/Expo integration obligations ([LLP 0012](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:809)).

Production-web delivery is similarly absent. Workstream 3 does not cover browser history, deep links, SSR/SSG, hydration, metadata, or social previews, although commerce later requires anonymous/SEO rendering. Exact’s own corpus says Contract production web and hydration are still partial ([Exact LLP 0216](/Users/ccheever/projects/exact/llp/0216-contract-explained.explainer.md:348)).

Resolution criteria: before declaring Contract × Snapback the default platform path, add explicit Expo/native and production-web gates. At minimum cover device build/launch, lifecycle and offline/auth behavior, server-code exclusion, deep links and history, SSR/SSG authority, hydration without duplicate subscriptions or stale flashes, metadata, and `basePath`. Otherwise narrow the default claim to the environment actually proved.

**C7 — Severity: major. Cross-repository Exact ownership is declared but not operationalized.**

Evidence: LLP 0063 says Contract semantics belong in Exact LLPs, but its Related header names no Exact authorities, while Workstreams 1, 3, and 5 prescribe query-lifecycle, UI-language, and mutation-state changes. The root LLP specifically says Snapback should cite Exact authorities rather than redefine them ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:395)).

Workstream 5 requires pending, success, retryable failure, terminal failure, and ambiguous settlement. Exact LLP 0263 deliberately deferred Contract-native completion branching ([Exact LLP 0263](/Users/ccheever/projects/exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md:995)), while accepted LLP 0284 currently describes confirmed/rejected receipts ([Exact LLP 0284](/Users/ccheever/projects/exact/llp/0284-contract-source-seam.rfc.md:368)). This is a new semantic and compatibility decision, not merely Snapback implementation work.

Resolution criteria: add a per-workstream authority/dependency table naming required Exact LLP amendments, version or manifest transitions, compatibility behavior, conformance suites, and cross-repository completion gates. Workstream 5 must resolve ambiguous settlement, idempotency, retry classification, and receipt evolution before implementation.

**C8 — Severity: major. Read/write-set inference is safety-sensitive and underspecified.**

Evidence: Workstream 6 proposes inferring handler read/write sets “from host operations” while retaining declarations as ceilings or overrides ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:290)). Current declarations are conservative and feed generated mutation facts, invalidation, and authority classification ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:649), [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:1204)). Runtime-observed operations are branch-specific lower bounds, not proof of every possible path.

Resolution criteria: specify that inference is permitted only when sound static analysis proves a complete conservative ceiling. Otherwise retain explicit declarations. Enforce actual operations as a subset of that ceiling and fail closed on mismatch; authorization, invalidation, and receipt facts must derive from the conservative set, not observed executions.

**C9 — Severity: minor. Two factual or scope statements need correction.**

Evidence: Workstream 6 frames trusted server time and generated identifiers as future primitives, but `ctx.runtime.now()` and `ctx.runtime.id()` already exist ([ctx-bootstrap.js](/Users/ccheever/projects/snapback/packages/snapback-harness/ctx-bootstrap.js:751)). Partitime chose a client-authored `createdAt`; the remaining work is adoption, defaults, or migration rather than primitive creation.

The analytics pressure test requests “large scans” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:386)), while the root LLP says heavy OLAP over huge datasets belongs in a warehouse rather than Snapback’s transactional store ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:692)).

Resolution criteria: reframe trusted time/IDs as migration and ergonomic work, and scope analytics to bounded operational workloads or to an explicit export/warehouse integration test.

## 4. Suggestions (non-blocking improvements)

- Add a capability-closure matrix with capabilities as rows and Contract, React, Expo, and vanilla across local and hosted targets as columns. Each cell could name its governing LLP, executable witness, status, and any explicit waiver.

- Preserve a machine-readable receipt for full matrix runs. The current browser harness prints a `PASS ... skipped` result when Chrome or the Snapback binary is unavailable ([browser-matrix.mjs](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:26)); skipped integration proof should be visibly distinct from a passing run.

- Put an unfamiliar-agent, cold-checkout build near the beginning of the sequence. That would test the roadmap’s documentation and setup thesis before additional in-repository familiarity hides friction.

- Give each pressure-test application a short, common scorecard: new capability exercised, relevant workload envelope, default-path friction, escape hatches used, and which roadmap assumption it confirmed or falsified.

## 5. Open questions

- What is the exact scope of the proposed default: local SPA authoring, hosted production web, mobile, or all three?

- What criteria and weights make one cell “clearly better,” and what regression counts as a “meaningful loss”?

- Are the new pressure tests replacing the LLP 0010/0015 ladder, or are they a separate product-validation track?

- Which Exact LLP amendments must land before Workstreams 1, 3, and 5 can begin, and how will compatible Snapback/Exact versions be enforced?

- What resource-limit, identity, authorization, and abuse-control evidence is required before any hosted or production claim?

- Does read/write inference mean sound static analysis, runtime observation, or both?

- Should the native Supabase/Convex realtime follow-up precede the final platform ranking?

## 6. Readiness verdict

NOT READY

The roadmap has a strong thesis, useful evidence, and several well-chosen workstreams, but unresolved material concerns remain in inherited-obligation coverage, governing-document coherence, measurable sequencing and acceptance gates, Exact-side ownership, client-surface completeness, and evidence-to-ranking logic. Addressing those issues would turn it from a persuasive strategic direction into the controlling executable Plan it claims to be.

### Orchestrator verification note (round 1, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C9 confirmed (`ctx.runtime.now()`/`ctx.runtime.id()` exist at
`packages/snapback-harness/ctx-bootstrap.js:761-762`); C5's dependency claim
confirmed (React cell runtime deps are react/react-dom only); C4 confirmed
(LLP 0016:382 delegates demo order to LLP 0015 with LLP 0010 as ladder
authority); C2 confirmed (LLP 0016:96 "not yet frozen as contracts", LLP
0009:34 preemption "remains honestly Missing", LLP 0016:359-361 selector
ergonomics and Agent API verification open, Exact 0265 §5.2 follow-ups
present). No claim checked false.

## Round 2 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `7b82dd0ab0444392055940c84dba1c8f9ad497f6e44aebf77672d004f705b54a` (untracked file at repo HEAD `157a3cc`; round-1 revision reconciled)
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7d7c-8cac-7dd0-8acd-8d87649eca29; fresh session — no access to the orchestrating Claude session, to the round-1 artifacts, or to the concurrent Claude-family round. The review discloses that a delegated path search briefly surfaced a few lines under the sibling Exact repo llp/reviews/ despite the exclusion instruction and states those lines were discarded and all findings independently established.
**Verdict:** NOT READY

### Review body (verbatim)

Revision hash: **MATCH** — computed `7b82dd0ab0444392055940c84dba1c8f9ad497f6e44aebf77672d004f705b54a`, identical to the supplied hash. The file is untracked; repository HEAD is `157a3cc`.

## 1. Overall assessment

This is a strategically strong Plan with a credible north star, unusually good evidence discipline, and a sensible division between roadmap sequencing and subsystem semantics. The workstreams address real friction found by Partitime and Shindig rather than inventing a generic platform wishlist.

It is not ready for acceptance. Several obligations explicitly carried from LLP 0016 have no executable acceptance gate; the v0 freeze is sequenced after work it should precede; an authorization item is described using semantics superseded by Accepted LLP 0053; the platform-completion phase lacks authorities for much of its scope; and the mobile and “clearly better” claims outrun their defined evidence. These are repairable defects, but they affect correctness, feasibility, and decision quality rather than polish.

This review was read-only. No prior-review conclusions were used. A delegated path search briefly surfaced a few lines under the sibling Exact repository’s `llp/reviews/` directory despite the exclusion; they were discarded, and every finding below was independently established from the cited primary documents, guides, code, and demo evidence.

## 2. Strengths

- The decisive quantitative evidence is sound. The reported React × Snapback and Contract × Snapback assets are exactly 401,783 and 718,695 bytes, respectively—correctly rounded to 402 KB and 719 KB in the Plan ([REPORT §4.4](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:255); [LLP 0063 §Evidence and limits](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:63)).

- The eight-cell experiment is well controlled. The report holds product facts and acceptance claims constant, and the browser suite enumerates two authoring arms × four backends × three checks ([REPORT §2](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:25); [browser-matrix.mjs](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:18)). The polling caveat is faithfully carried forward: only Snapback exercised push; the Supabase, Convex, and SQLite cells used one-second gateway polling ([REPORT §2.4](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:128); [LLP 0063:72](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:72)).

- The Plan correctly limits its authority to priorities, sequencing, and cross-stack evidence while leaving API, runtime, auth, packaging, and Contract semantics to their governing LLPs ([§Scope and ownership](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:83); [§Cross-repository authority](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:516)). That is the right shape for an umbrella Plan.

- The carry-forward table is broad and, aside from the concerns below, accurately recovers important open work from LLP 0016 and LLP 0021: manifest mapping, handshake semantics, live-wire races, packaging, managed lifecycle, Exact ergonomics, React/Expo, authorization breadth, and execution-envelope limits ([§Carry-forward](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:99)). Most of the “not carried as unfinished” claims are also supported: `ctx.db`, read-your-writes, local matcher/push, React/Contract comparison, and closed-IR Parity have real implementation evidence.

- Several acceptance designs are excellent: keyed-scope tests cover replacement, stale-result suppression, reconnect, permission loss, argument changes, and unmount ([WS1](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:221)); provider generation requires byte-for-byte regeneration and honest liveness ([WS4](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:321)); and production service claims require named target profiles and executed operational drills ([WS7](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:423)).

- The pressure-test ladder introduces distinct failure modes instead of repeating CRUD demos, and the native Supabase/Convex follow-up is properly required before a final comparative ranking ([§Next application pressure tests](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:534)). The risk register is candid about roadmap breadth, competitor fairness, Contract favoritism, hidden authority, and shallow demos ([§Risks](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:568)).

## 3. Concerns

**C1 — The authorization carry-forward preserves a superseded security story (major)**

**Evidence.** The Plan classifies “permission epochs, and stale-epoch reconnect/resnapshot” as existing regression obligations rather than unfinished work ([LLP 0063:150–165](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:150)). That accurately describes an older implementation, but Accepted LLP 0053 is now the controlling refinement. It explicitly supersedes the claims that every permission-affecting write advances an epoch and that reconnect may trust epoch equality ([LLP 0053:103](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:103)). It requires unconditional resnapshot of every auth-scoped subscription on reconnect ([LLP 0053:203](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:203), [LLP 0053:288](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:288)) and says an equal authorization pair is never proof that retained results remain authorized ([LLP 0053:751](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:751)). LLP 0053 is absent from LLP 0063’s Related list and authority map.

**Resolution criteria.** Rewrite the closed item to distinguish the shipped local matcher from the current controlling security obligations. Add LLP 0053 to Related and the authority map, and explicitly retain gates for unconditional auth-scoped resnapshot, obligation-backed negative delivery, authorization leases, and ephemeral-room reauthorization. Do not describe the old stale-epoch behavior as the completed regression contract.

**C2 — Multiple carried obligations have names but no executable completion gates (major)**

**Evidence.** The Plan says carry-forward is “not satisfied by moving prose” ([LLP 0063:132](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:132)), yet several rows disappear from their assigned workstream acceptance:

- Data-aware Agent API verification is assigned to WS3/WS5, but neither acceptance list tests it. Exact 0265 requires Agent inspection to explain why a list failed to update and requires data-state clauses not to skip silently ([Exact 0265 §5.6](/Users/ccheever/projects/exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md:567)).

- Public adapter publication is assigned to WS6, but WS6 only requires an external checkout. LLP 0021 specifically requires publishing/installing a public package and eliminating custom aliases and rewrites ([LLP 0021:567](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:567)).

- The React/Expo obligation promises the same artifacts, diagnostics, and cross-surface behavior as Contract, but WS2 has no React-web cross-surface mutation/live-query or deliberate-failure parity witness. LLP 0016’s acceptance requires both ([LLP 0016:320](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:320)).

- Component-local query scopes, query-cell props, mutation-action ergonomics, quiet headless/native operation, and the full manifest mapping are assigned homes but lack corresponding exit gates. The query-prop status is also too coarse: generated alias props have landed, while component-local runtime scopes remain open ([Exact 0265:789](/Users/ccheever/projects/exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md:789)).

- WS5 proposes pending, success, retryable, terminal, and ambiguous mutation outcomes plus idempotency and retry classification, but its acceptance checks only diagnostic loci and whether failure UI is expressible ([LLP 0063:351](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:351)). It has no transition, retry, duplicate-delivery, idempotency, or ambiguous-settlement witness.

**Resolution criteria.** Give every carried obligation a named executable witness and a specific sequence exit gate, or explicitly narrow/remove the carry-forward claim. In particular, add transition/fault-injection acceptance for WS5, cross-surface React acceptance for WS2, Agent API verification for WS3/5, full mapping-closure criteria for WS4, and registry-install evidence for WS6.

**C3 — The v0 contract freeze is sequenced too late (major)**

**Evidence.** LLP 0020 requires Phase 0 to freeze stable diagnostics, reset/seed, atomic initial snapshot plus subscription, deterministic delivery controls, capability facts, and artifact freshness “Before replacing scaffolding” ([LLP 0020:145](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:145)). LLP 0063 places that freeze inside WS4 acceptance ([LLP 0063:346](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:346)), scheduled as Step 3 after dynamic lifecycle/mutation work and new React/Expo projections ([§Sequence](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:483)).

**Resolution criteria.** Add a Step 0 or program-entry prerequisite that ratifies the v0 contract and preserves its executable witnesses before WS1, WS2, or WS5 changes lifecycle and client behavior. Subsequent workstreams should consume that frozen baseline rather than define it retrospectively.

**C4 — “Clearly better” is not yet operational (major)**

**Evidence.** The Plan calls the criterion “operational, not impressionistic,” but relies on undefined “agent-authoring effort” and “diagnostic quality,” while WS8 thresholds remain open question 4 and need not be fixed until Step 4 completes ([LLP 0063:205](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:205), [LLP 0063:474](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:474)). The evidence report captured neither trustworthy clean-machine timing nor latency, throughput, fan-out, cold-start, or cost benchmarks ([REPORT:276](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:276), [REPORT:952](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:952)). Consequently, passing all currently written bullets would not determine whether Contract × Snapback matches or beats React × Snapback.

**Resolution criteria.** Before execution begins, freeze the comparison workload, environment, cost attribution, sample method, tolerances, and first thresholds. Define machine-checkable proxies or a preregistered scoring rubric for authoring effort and diagnostic quality. Baselines must be captured before optimizations change either stack.

**C5 — WS7 makes capabilities release-blocking without assigning authoritative owners (major)**

**Evidence.** WS7 requires OAuth/recovery, durable jobs and webhooks, CDN delivery, search, abuse/moderation/audit, deploy/rollback/backups/inspection, and scaling beyond SQLite, while its Step 6 authority row names only LLPs 0044–0047 and 0057–0060 ([WS7](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:423), [Step 6](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:507)). Those documents deliberately do not cover much of that scope:

- LLP 0045 says there is no durable background-work subsystem and a future queue needs its own LLP ([LLP 0045:64](/Users/ccheever/projects/snapback/llp/0045-notifications-outbox.rfc.md:64)).
- LLP 0057 excludes production delivery, cookies, OAuth, and hosted/distributed behavior ([LLP 0057:87](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:87)).
- LLP 0060 states that no hosted auth deployment currently exists ([LLP 0060:1090](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:1090)).
- LLP 0046 is only single-process Postgres realtime; multi-process realtime and horizontal scaling are out of scope ([LLP 0046:55](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:55)).
- The commerce pressure test requires payments, which the root explainer says the corpus does not cover ([LLP 0000:633](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:633)).
- Existing non-local deployment/realtime direction in LLP 0014 is omitted even though it already describes the Cloudflare hosted phase ladder ([LLP 0014:374](/Users/ccheever/projects/snapback/llp/0014-cloudflare-strategy.rfc.md:374)).

This conflicts with R1’s promise that every phase has governing subsystem ownership.

**Resolution criteria.** Add a capability-to-authority/dependency matrix for every WS7 and pressure-test requirement. Name existing owners, required amendments, and explicit new-RFC prerequisites for OAuth/recovery, durable work/webhooks, payments, search, moderation/audit, CDN semantics, and hosted control-plane operations. Narrow the scale claim to SQLite→single-process Postgres unless multi-process ownership and gates are added.

**C6 — A React/Expo gate cannot establish a Contract/native default (major)**

**Evidence.** The Plan says mobile is excluded only until its Expo/native gate passes, then defines that gate as one Expo build meeting LLP 0012’s React/Expo requirements ([LLP 0063:217](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:217), [LLP 0063:250](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:250)). That proves an adapter surface, not the north-star Contract × Snapback native path. It also treats “mobile” as one target. Exact reports materially different current states for iOS and Android and explicitly warns that evidence on one platform proves only that platform ([Exact cross-platform guide:74](/Users/ccheever/projects/exact/guide/platforms/cross-platform.md:74), [guide:126](/Users/ccheever/projects/exact/guide/platforms/cross-platform.md:126)).

**Resolution criteria.** Split native gates by authoring surface and OS: React/Expo iOS, React/Expo Android, Contract iOS, and Contract Android—or explicitly choose a narrower initial target. Each passing tuple must independently prove launch, lifecycle, offline/auth resume, reconnect, server-code exclusion, and capability honesty. Default claims must remain scoped to the tuples actually proven.

**C7 — WS3 uses a stale and non-normative Exact baseline (major)**

**Evidence.** LLP 0063 cites Exact 0216 as recording production web and hydration as partial and broadly proposes adding or stabilizing tokens, overlays, forms, virtualization, routing, SSG, and hydration ([WS3](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:284)). Exact 0216 states that it is narrative rather than normative and that feature authorities win on conflict ([Exact 0216:17](/Users/ccheever/projects/exact/llp/0216-contract-explained.explainer.md:17)). Active Exact 0288 is the controlling decision: Contract now scaffolds by default for web and has retained evidence for its DOM host, routes, no-JS SSG, hydration, accessibility/bundle gates, external packaging, and production build; its residual release gate is a much narrower browser/device/IME/forms matrix ([Exact 0288:29](/Users/ccheever/projects/exact/llp/0288-contract-is-the-web-production-target.decision.md:29), [Exact 0288:63](/Users/ccheever/projects/exact/llp/0288-contract-is-the-web-production-target.decision.md:63)). Exact 0288 is missing from Related and the authority map.

**Resolution criteria.** Cite Exact 0288 and current per-capability authorities. Inventory every WS3 item as shipped, partial, gated, or missing by platform, then formulate acceptance around the residual deltas and Snapback-specific integration. Do not schedule already-shipped generic Exact capability as new platform work.

**C8 — The evidence section is mostly faithful but contains material imprecision (minor)**

**Evidence.**

- LLP 0063 says the diary/report confirm React × Snapback was the “best current choice” and that the report concludes it was strongest for this consumer build ([LLP 0063:52](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:52), [LLP 0063:196](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:196)). The report says there was “not one universal winner,” makes React × Snapback strongest only under a bespoke-web-UI condition, and calls Contract × Snapback the most successful cell for coherent data authoring ([REPORT:38](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:38), [REPORT:743](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:743), [REPORT:1003](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1003)).

- The statement that “the report’s remaining limits” are imported omits several load-bearing limits: no performance benchmark, package-version dependence, shared-source rather than eight-product maintenance, and Partitime’s smaller authorization scope ([REPORT §16](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:940)).

- “Partiful covered … moderate resource authorization” is inaccurate for Partitime alone: its diary says it deliberately omitted invite/membership authorization ([Diary 0016:20](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:20)). The statement is defensible only for Shindig and Partitime together.

- The 24/24 report and suite topology are internally consistent, but no retained result artifact independently records the historical run. The current browser runner also exits successfully with `PASS … skipped` when Chrome or the server binary is absent ([browser-matrix.mjs:26](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:26)).

**Resolution criteria.** Present the ranking explicitly as Plan-author synthesis, import all relevant REPORT §16 limits, attribute authorization coverage to Shindig plus Partitime, and retain a machine-readable acceptance result. Evidence-producing mode must not convert a skipped browser suite into a passing witness.

**C9 — Supersession is stated in prose but not made corpus-operative (minor)**

**Evidence.** LLP 0063 says it supersedes LLP 0016 as the forward product program ([LLP 0063:101](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:101)), while LLP 0016 remains a Draft Plan ([LLP 0016:1](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:1)). LLP 0063 correctly requires same-landing amendments for LLP 0010 and LLP 0015, but does not impose an equivalent metadata/pointer update on LLP 0016.

**Resolution criteria.** Acceptance of LLP 0063 must update LLP 0016 to `Superseded`—or otherwise narrow its status—with a direct pointer to LLP 0063 and an explicit statement of the historical material it continues to own.

## 4. Suggestions

- Report bundle measurements as “emitted minified JavaScript, before gzip/Brotli” rather than the less precise “before compression.”

- Restore LLP 0016’s quantitative glue discipline: record both file count and line total, then require the trend to fall as workstreams land ([LLP 0016:413](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:413)).

- Replace the single total ranking with a small Pareto frontier: data correctness, product-surface freedom, production operations, package/runtime cost, and agent feedback. This preserves the useful choice guidance without suggesting unsupported precision in positions three through eight.

- Maintain a machine-generated “claim envelope” per stack and target—local web, production web, iOS, Android, hosted single-tenant, hosted multi-tenant. Passing gates should expand that envelope automatically; prose should not silently broaden it.

- Keep LLP 0063 as the umbrella sequencing authority, but split implementation-scale work into focused detail Plans once a phase starts. WS3 and WS7 are broad enough that their executable gates will otherwise become difficult to review and maintain.

- Explicitly reconcile LLP 0016’s old HostPlan wording with the later LLP 0020/0051 position: typed IR/HostPlan common mutations are first-class, while raw plan objects remain outside the public authoring model.

## 5. Open questions

1. After WS2 and WS3, exactly which default claim is intended: production web only, Contract on iOS, both mobile OSes, or merely framework-neutral adapter support?
2. What exact artifact and acceptance corpus constitutes the v0 freeze before Step 1 begins?
3. What is the normative mutation-state transition model, including timeout, retry, idempotency, duplicate delivery, late confirmation, and ambiguous settlement?
4. Which WS7 capabilities are mandatory for the first three pressure tests, and which governing LLP owns each one?
5. What fixed thresholds and experimental method define bundle, startup, runtime, authoring-effort, and diagnostic-quality parity?
6. Which WS3 capabilities are genuinely missing after Exact 0288, versus shipped but needing Snapback integration evidence?
7. Must dynamic query scopes default to component, router, or explicit resource lifetime, and what evidence would decide among them?
8. What is the smallest provider-introspection artifact that remains honest across push, polling, transactional, and request/response providers without becoming a lowest-common-denominator schema?

## 6. Readiness verdict

NOT READY

The direction is good and the evidence base is substantially real, but unresolved major concerns remain in security semantics, carry-forward acceptance coverage, prerequisite ordering, measurable success criteria, platform-service ownership, native claim scope, and the Exact current-state baseline. Once those are repaired, the Plan should be a strong forward-program authority rather than requiring a strategic rewrite.

### Orchestrator verification note (round 2, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19
(cited line numbers drift slightly; substance verified): C1 confirmed (LLP
0053 is Accepted; mandatory unconditional resnapshot at its lines 98/208,
superseded-epoch clauses at 111); C2 confirmed (LLP 0021 public-package
publication still an Open checkbox near line 569); C3 confirmed (LLP 0020
Phase 0 "Before replacing scaffolding, pin the behavior that already
worked", line 145); C5 confirmed (LLP 0045:66 no durable background-work
subsystem, LLP 0046:69 single-process realtime scope, LLP 0000:634 payments
not covered, LLP 0060:1097 no hosted auth deployment, LLP 0014 exists); C7
confirmed (Exact 0288 is Active and adopts Contract as the web production
target). The review's independence disclosure (stray llp/reviews/ lines
surfaced by a delegated search, discarded) is recorded in the provenance
header above. No claim checked false.

## Round 3 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `ede7861c31d4a21e0188ec7d98ef5adce83293bc094c36689081f436f015dd95` (untracked file at repo HEAD `157a3cc`; round-2 revision reconciled)
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7d90-b20f-74a1-8bdf-d7b9f3b0e807; fresh session — no access to the orchestrating Claude session, prior artifacts, or the concurrent Claude-family round. Independence disclosure: one broad source search emitted two review-file snippets despite the exclusion glob; the review states they were discarded and all findings independently derived.
**Verdict:** NOT READY

### Review body (verbatim)

Revision verification: **MATCH** — `shasum -a 256` computed `ede7861c31d4a21e0188ec7d98ef5adce83293bc094c36689081f436f015dd95` for [LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md), exactly matching the supplied identity. Repository HEAD is `157a3cc3f919736ef557dcc7024835b7b5de08e6`. No files were modified.

Independence note: I did not open a prior review, but one overly broad source search unexpectedly emitted two review-file match snippets despite an exclusion glob. I discarded them and did not rely on them; every finding below was independently derived from the cited primary files.

## 1. Overall assessment

The proposal’s direction is good. It turns concrete Partitime and Shindig experience into a coherent program, avoids pretending one stack wins every isolated metric, preserves React as an honest comparison surface, and usually separates roadmap sequencing from subsystem semantics.

It is not yet a reliable execution Plan. Its evidence snapshot is stale, several LLP 0016 obligations are missing or misclassified, some workstream exits can pass without delivering their stated scope, and two load-bearing ownership stories—mutation settlement and hosted-platform sequencing—conflict with governing documents. The central “clearly better” verdict is also not operationally decidable yet.

## 2. Strengths (with section citations)

- The evidence discipline is strong where current. The Contract × Snapback and React × Snapback bundle figures—718,997 and 402,091 emitted bytes—match both the [report](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:292) and present build artifacts. LLP 0063 appropriately qualifies this as one Exact 0.1.2 build without size optimization ([§Evidence and limits](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:65)).

- The polling caveat is faithful. Supabase and Convex used one-second gateway polling, without native Supabase Auth/RLS/Realtime or Convex subscriptions ([REPORT §2.4](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:145)). LLP 0063 correctly avoids calling those products polling systems ([§Evidence and limits](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:75)).

- The push claim is supported. The report states that only Snapback push was exercised ([REPORT §17](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1145)); React and Vanilla use the Snapback live-query path, while Contract boots through the generated Snapback surface.

- The scope boundary is sound: the Plan owns sequencing and evidence, while subsystem and Exact LLPs own semantics ([§Scope and ownership](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:90)). Requiring same-landing amendments for the old demo authorities is good corpus governance ([§Demo-ladder authority](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:185)).

- Several safety choices are notably good: conservative-ceiling-only read/write inference ([WS6](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:454)), explicit machine-readable native GAPs ([WS2](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:288)), per-OS native evidence, single-process-only Postgres claims, and idiomatic native Supabase/Convex comparison legs.

- The principal “not carried as unfinished” technical closures are supported: JavaScript `ctx.db` and captured reads, point/query read-your-writes, local WebSocket plus range/limited matching, and the narrowly qualified closed-IR Parity slice. For example, read-your-writes is implemented in [LLP 0003](/Users/ccheever/projects/snapback/llp/0003-local-code-hosting-and-storage-core.rfc.md:290), and LLP 0043 limits Parity to complete locally executable closed-IR mutation sets ([§Summary](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:31)).

## 3. Concerns

**C1 (major) — The evidence baseline and resulting roadmap are stale.**

The statement that React and Contract formed eight successful cells was historically true for the initial 2×4 build ([Diary 0016](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:9)); it is not fabricated. But the cited diary and report now describe an explicit 3×4 matrix with all twelve cells built and browser-tested ([Diary Vanilla extension](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:293), [REPORT §1](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:18)).

Consequently, LLP 0063 still:

- schedules Vanilla × Snapback as future work ([WS2](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:303));
- ranks only eight cells;
- refers to unmeasured “eight-product” maintenance rather than twelve;
- leaves the ordering of the already-completed Vanilla baseline open;
- omits extension-specific limits: shared React/Vanilla CSS, bundled rather than raw browser ESM, no startup instrumentation, and browser-controller substitution ([REPORT §17](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1155)).

“React supplied CSS” also needs nuance: Vanilla reused the same stylesheet, proving that the polish was a web-platform asset; React retained the authoring-economy advantage.

Resolution criterion: rebaseline the entire Plan and comparison protocol to the twelve-cell evidence; mark the completed Vanilla builds, lifecycle checks, bundles, and framework-neutrality result as retained regression evidence; narrow remaining Vanilla work to direct ESM-or-minimal-wrapper, startup instrumentation, and generated lifecycle ownership; update the ranking or explicitly scope it to React/Contract; and import all current report limits.

**C2 (major) — The claimed evidence does not satisfy the Plan’s own witness-integrity invariant.**

LLP 0063 says skipped environments are “never” passing witnesses and that full matrix runs retain a machine-readable result artifact ([§Carried acceptance invariants](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:154)). The browser runner instead prints both `SKIP` and `PASS … skipped`, then exits zero when Chrome or the Snapback binary is absent ([browser-matrix.mjs](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:29)). The shared harness prints JSON only to stdout ([harness.mjs](/Users/ccheever/projects/snapback/demos/_kit/harness.mjs:109)); I found no retained Partitime result artifact under the demo.

This does not prove the reported 40/40 run was itself skipped, but it means the current harness can produce a false passing signal and the report is not backed by the durable receipt the Plan requires.

Resolution criterion: represent skip structurally as non-pass and make required-gate aggregation reject it; retain a 40/40 receipt containing revision, environment, artifact identities, checks, skips, and cleanup outcome; make that retained receipt a Step 0 prerequisite before using the matrix as the comparison baseline.

**C3 (major) — The LLP 0016 carry-forward reconciliation is inaccurate and incomplete.**

The clearest factual error is [line 129](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:129), which says Exact 0265 mutation-action ergonomics remain open. Exact 0265 records header-order tolerance, guarded statements, missing-`mutates` diagnostics, unknown-write-set reporting, and alias props as implemented; it names the real residuals as component-local runtime scopes, real Snapback row-shape consumption, slot-local derives, forced data-state verification, and the Partiful/Kanban proof ([Exact 0265 status](/Users/ccheever/projects/exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md:789)).

Other carried obligations lack homes:

- Reliable Exact-owned DataProvider conformance remains open in [LLP 0021](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:511), but WS4 gates only the version handshake.
- “Snapback core works without Exact installed” is an explicit LLP 0021 acceptance gate ([Phase 3](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:289)) and is absent.
- The React/Expo package obligation has behavioral gates, but WS6’s external registry-install gate names only the Contract adapter.
- The broader authorization carry-forward lacks explicit protected/custom-key-room and complete-product witnesses.
- The task-tracker row drops LLP 0016’s index-first query and pinned larger-dataset requirement ([LLP 0016 demo map](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:394)).
- LLP 0016’s eventual metadata transition is left as an ambiguous “status annotation,” rather than an exact `Superseded` transition.

Resolution criterion: replace the prose reconciliation with a complete obligation ledger whose dispositions are exactly `closed + retained evidence`, `carried + authority + executable gate`, or `retired + rationale`. At minimum, correct Exact 0265’s residual list; add DataProvider conformance, no-Exact core, React/Expo distribution, authorization, and indexed-large-dataset gates; and specify LLP 0016’s exact status transition.

**C4 (major) — Workstream exits do not cover their declared scope.**

Several examples are decisive:

- WS1 tests selection replacement for one active keyed binding, but the current adapter permits only one scope per query name and explicitly leaves multiple scopes future ([LLP 0034 §10.4](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:768)). Exact 0265 requires repeated component instances to subscribe independently ([§5.1](/Users/ccheever/projects/exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md:213)).
- WS3 lists tokens, container layout, animation, overlays, forms, virtualization, selectors, and typed escape hatches, but its acceptance bullets do not individually gate several of them.
- WS5 promises LSP completion, navigation, rename, formatting, and incremental checks ([WS5](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:428)); none appears in its acceptance.
- WS6 promises CRUD generation, lookup, pagination, projections, joins, and migration diagnostics, while its acceptance gates only a subset.
- Native acceptance applies to whichever tuples are “claimed,” without defining a mandatory minimum or an Online/Parity class.
- The collaborative-document pressure test requires structured editing and offline conflict resolution, but no RFC owns its CRDT/OT/operation-log semantics. LLP 0008 explicitly defers collaborative text to a later explicit approach ([§Conflict model](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:341)).

Resolution criterion: add a requirement → owning authority → target profile → executable witness matrix for every normative bullet. In particular, WS1 must prove simultaneous same-query/different-args instances, same-args deduplication without shared-disposal errors, independent unmount/HMR, sibling error/reconnect isolation, and stale suppression. Either gate every WS3/5/6 item or label it non-gating trajectory. Define mandatory native tuples and capability classes, and add a collaborative-editing RFC prerequisite.

**C5 (major) — WS5 assigns mutation settlement exclusively to the wrong repository.**

LLP 0063 calls ambiguous settlement, idempotency, retry classification, and receipt evolution “not Snapback implementation work” ([WS5](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:417)). Exact does own Contract’s public state-machine and view semantics, and Exact 0284 currently exposes only `confirmed | rejected`.

But Snapback already owns the provider facts that make those states truthful. LLP 0034 assigns outcome, rollback reason, version, degradation, and transport to the provider ([§3.2](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:215)). LLP 0043 says receipt-less proxy/HTTP failures are ambiguous and must retain queued work ([§Milestone 2](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:189)). A Contract-only amendment cannot determine whether a request settled.

Resolution criterion: split ownership explicitly. Exact owns the structural Contract states and authoring behavior; Snapback LLP 0034/0043 amendments own provider classification, idempotent settlement signals, replay safety, and receipts. The fault-injection gate must run against Snapback plus at least one non-Snapback provider and verify that every UI state is justified by provider evidence.

**C6 (major) — The hosted-platform authority and sequence conflict with governing documents.**

LLP 0063 gates any hosted vertical on LLP 0047 limits and places production services in Step 6 ([WS7 acceptance](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:518)). LLP 0014’s governing Cloudflare ladder instead places an app-complete hosted single-tenant phase before the LLP 0047 gate, which first appears for untrusted multi-tenant execution ([LLP 0014 phase ladder](/Users/ccheever/projects/snapback/llp/0014-cloudflare-strategy.rfc.md:394)). LLP 0063 neither maps nor amends that conflict.

The authority table also cites LLP 0062 for preview/deploy/rollback/backups/logs/inspection. LLP 0062 excludes hosted targets from Phase 1 ([§Summary](/Users/ccheever/projects/snapback/llp/0062-generated-app-cli-and-code-mode.rfc.md:48)) and explicitly describes an application plane, not an operator plane ([§Position](/Users/ccheever/projects/snapback/llp/0062-generated-app-cli-and-code-mode.rfc.md:102)). Step 6 is partly circular as well: WS7 includes identity and abuse work, but its entry requires identity and abuse gates already closed.

Resolution criterion: decide which phase ladder controls and amend LLP 0014/0009/0047 in the same landing; state whether trusted single-tenant hosting is exempt from the untrusted-code gate; remove LLP 0062 as hosted-operations authority; name a real hosted control-plane RFC; split Step 6 into security/platform foundations and per-vertical delivery; require accepted semantics plus executable implementation, not merely that new RFCs “exist”; and require backup→destroy/replace→restore integrity drills.

**C7 (major) — “Clearly better” is not presently operational and its thresholds can move after optimization begins.**

The success language promises no meaningful loss in visual quality, interaction design, runtime weight, diagnostics, or deployment ergonomics ([§Product choice](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:226)). The explicit match/beat test covers shared product claims, agent effort, and diagnostics, while the existing shared browser claims are only boot, feed, navigation, and RSVP ([REPORT §4.1](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:223)). Those do not prove visual, interaction, or deployment non-inferiority. Nor does the Plan define how mixed results across turns, interventions, and tool calls are adjudicated.

There is also a timing contradiction: Step 0 requires “first thresholds” before Step 1 ([comparison protocol](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:238), while WS8 permits the “first enforced thresholds” to be chosen by amendment before Step 4 completes ([WS8](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:549)). That allows success criteria to be selected after seeing optimization results.

Resolution criterion: name and commit the Step 0 protocol artifact; preregister a pass/fail or non-inferiority rule for every promised dimension; define metric aggregation, repetitions, tolerances, and the diagnostic rubric; freeze all success-determining thresholds before baseline-changing work; and treat later thresholds as exploratory unless validated prospectively on a holdout rerun.

**C8 (major) — Gates are not cumulative and there is no final one-revision proof.**

The Plan says each exit reruns a delta of source volume, glue, bundle, and check counts ([comparison protocol](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:247)), while the phase table exits locally by workstream. Later packaging, diagnostics, hosting, or service work can therefore regress earlier lifecycle, bundle, or security gates.

Step 2 may also run beside Step 1 even though its cross-surface parity checks cover mutation/live-query semantics changed in Step 1 and diagnostics completed only in Step 3.

Resolution criterion: maintain a machine-readable cumulative gate manifest; rerun every affected prior gate at each step; split Step 2’s independent client/native floor from final cross-surface parity; make final parity depend on Steps 1 and 3; and require one final full comparison, budget, native, security, and pressure-test run on a single pinned revision and environment.

## 4. Suggestions (non-blocking improvements)

- Turn the obligation and gate matrices into a checked machine-readable claim ledger, then generate the Plan’s status tables from it. This would make stale “open,” “done,” and evidence claims mechanically visible.

- Split the roadmap into two named lanes: “Contract × Snapback web default” and “complete application platform/native expansion.” Their current gates and time horizons are different enough that one linear sequence obscures priority.

- Keep Vanilla as a standing lower-bound instrument rather than a product competitor. Its best future use is detecting client/runtime weight and lifecycle regressions.

- Add an evidence identity header for the diary, report, result receipt, package locks, and generated assets. The current stale snapshot demonstrates why a date alone is insufficient.

- Use one later pressure-test app as a preregistered holdout. Optimizing and judging repeatedly on Partitime risks teaching the stack the fixture instead of improving the general platform.

- Keep “live-query push” and “mobile notification push” terminologically distinct. Likewise distinguish collision rescue/backup from end-user account recovery.

## 5. Open questions

1. Is the first success claim a polished local web default, a production-web default, or a Contract-native/mobile default? Which exact tuples and Online/Parity classes are mandatory?

2. Does the current comparison rank all twelve cells, only React/Contract cells, or only the two Snapback cells? What principled role does Vanilla have?

3. What are the preregistered non-inferiority thresholds for visual quality, interaction behavior, runtime weight, deployment, and stochastic agent-authoring measurements?

4. Which side owns each mutation-settlement fact: provider/server, shared adapter contract, or Exact UI state machine?

5. Does LLP 0014’s trusted hosted single-tenant phase proceed before LLP 0047, or is this Plan intentionally tightening that rule?

6. Which exact LLP 0016 obligations are retired rather than carried, and what final metadata status should LLP 0016 receive?

7. What collaboration model will the document pressure test exercise—block operations, operation log, CRDT, OT bridge, or something else—and which RFC owns convergence?

8. Must all seven pressure-test applications complete before the program can claim success, or are they an ordered evidence queue with per-vertical graduation?

## 6. Readiness verdict

NOT READY

The product direction is compelling and many individual technical judgments are sound, but unresolved evidence staleness, witness integrity, carry-forward omissions, incomplete exit gates, cross-repository ownership errors, hosted-sequence conflict, and movable success criteria prevent this Draft from reliably governing priorities or declaring completion.

### Orchestrator verification note (round 3, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C1 confirmed and decisive — a concurrent session extended Partitime to a 3×4
twelve-cell matrix in the working tree during this review loop (Diary 0016
"Vanilla JavaScript makes it 3×4" entry; REPORT.md §1 twelve-cell table,
40/40, updated bundle figures 402,091/718,997 at REPORT line ~300); C2
confirmed (browser-matrix.mjs prints "PASS … skipped" and exits 0 when
Chrome or the server binary is absent); C5 confirmed (LLP 0034 line 223
assigns mutationId/outcome/rollbackReason/… to the provider); C6 confirmed
(LLP 0014 Phase 3 "untrusted multi-tenant" is where LLP 0047's gates first
bind; LLP 0062 lines 87–95 exclude hosted targets in phase 1); C3 confirmed
(LLP 0021 lines 30/259/297: core-without-Exact and the Exact-owned
DataProvider conformance suite). No claim checked false.

## Round 4 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `7719ef00eccfce939c9e8c381e33293970521bdb93e8c777b7898bbbdc91b5aa` (untracked file at repo HEAD `157a3cc`; round-4 revision). Evidence-file hashes pinned in the brief and verified unmoved by the reviewer.
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7dbc-8ea6-7722-a706-b73d6f8b67f3; fresh session — no access to the orchestrating Claude session, prior artifacts, or the concurrent Claude-family round. A first round-4 attempt (no session id, no output) was stopped before producing anything and is not counted, per the never-fabricate rule.
**Verdict:** NOT READY

### Review body (verbatim)

Revision check: **MATCH** — computed SHA-256 `7719ef00eccfce939c9e8c381e33293970521bdb93e8c777b7898bbbdc91b5aa`. HEAD is `157a3cc`. The diary and report also remained at their launch hashes: `20774bde…9084` and `5a4b3df3…d1d9`.

## 1. Overall assessment

This is a strong strategic proposal and a good next program for Snapback. It correctly treats Contract × Snapback as the long-term default without erasing React, and it turns unusually candid comparative evidence into sequenced work rather than a feature wishlist.

It is not ready to accept yet. The remaining problems are primarily Plan-level: a load-bearing push claim lacks an executable witness, the mutation workstream conflicts with its named Exact counterpart, supersession and carry-forward are incomplete, several phase exits contradict their own acceptance rules, and the final proof/completion boundary is not yet feasible or determinate. These require reconciliation, not a change of overall direction.

## 2. Strengths (with section citations)

- The evidence discussion is substantially faithful and well qualified. It correctly records the completed 3×4 matrix, historicizes the initial eight-cell phase, reproduces the bundle and source counts, and prominently limits the Supabase/Convex result to the gateway implementations actually tested ([LLP 0063, “Evidence and limits”](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:44); [Diary 0016, vanilla extension](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:293); [REPORT, quantitative results](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:187)).

- “Scope and ownership” draws the right boundary: this Plan owns sequencing and evidence, while subsystem semantics remain in their governing LLPs ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:115)).

- Workstream 1 has excellent lifecycle acceptance: keyed identity, same-key deduplication, multi-instance independence, stale-result fencing, HMR, reconnect, and permission behavior are all named rather than hidden behind “dynamic queries work” ([LLP 0063, WS1](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:295)).

- Workstream 4 wisely requires an independently generated non-Snapback producer. Snapback alone cannot prove that a supposedly neutral provider boundary is neutral ([LLP 0063, WS4](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:442)).

- Workstream 7’s capability-to-authority map and its rule that an RFC alone does not satisfy a gate are strong defenses against “RFC theater” ([LLP 0063, WS7](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:580)).

- Step 0 is directionally excellent: freeze the baseline before lifecycle changes, repair skip/pass integrity, retain receipts, and preregister comparison rules ([LLP 0063, Sequence](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:659)). R6 similarly fails safe when Exact-side authority stalls instead of implementing ahead of design ([LLP 0063, Risks](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:791)).

## 3. Concerns

**C1 — major — The matrix configures push but does not executable-witness successful push.**

The Plan says Snapback “supplied the only push implementation exercised by the matrix” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:46)). React and vanilla do request `transport: 'stream'` ([React provider](/Users/ccheever/projects/snapback/demos/partiful-matrix/surfaces/react/src/provider.ts:23); [vanilla provider](/Users/ccheever/projects/snapback/demos/partiful-matrix/surfaces/vanilla/src/provider.js:16)), and Contract does likewise ([adapter](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:4032)). But `SnapbackClient` defaults `fallbackToPoll = true` on stream loss ([client](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:3308)). The browser contract asserts only boot, feed, and same-page RSVP convergence, plus vanilla disposal; it never asserts live connection state, receipt transport, or an unsolicited cross-window update ([browser runner](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:100)). The provider suite’s Snapback check mutates and then performs an ordinary query, not a live-query delivery assertion ([provider suite](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/providers.mjs:55)).

Thus the evidence proves “stream configured,” not “push carried the observed update.” This matters because realtime is a ranking input.

Resolution criteria: add a retained Snapback-column witness that disables polling fallback, or proves receipt transport is push; mutate out of band; observe bounded unsolicited delivery on React, Contract, and vanilla; and include this claim in Step 0’s retained receipt. Until then, soften “push exercised/proved/removed polling” to “stream transport configured.”

**C2 — major — Workstream 5 conflicts with the mutation model and owners in its named Exact counterpart.**

LLP 0063 describes a mutation “state-machine surface” and assigns provider outcome classification to Snapback, citing principally Exact 0263/0284 ([LLP 0063, WS5](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:478)). Exact 0373 explicitly says this is **not one new state machine**. It specifies a projection over three independent fact families: effect attempt, optimistic presentation, and evidence-join status; Exact 0330/0342/0329 own those facts, while Exact 0284 and Snapback LLP 0034 own raw receipts ([Exact 0373](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:327)). It expressly says LLP 0063 WS5 must be reconciled and requires the fuller owner/amendment set at phase entry ([Exact 0373, Sequence](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:783)).

This is a Plan defect because its authority map and entry prerequisites are incomplete, even though subsystem semantics belong elsewhere.

Resolution criteria: restate WS5 as the three-fact projection; restrict Snapback ownership to raw provider receipt/settlement facts; add Exact 0330, 0342, 0329, and 0278 to Related, cross-repository authority, and Step 1 prerequisites; and align the fault-injection claims with Exact 0373’s projection vocabulary.

**C3 — major — The prescribed supersession landing would leave active documents naming LLP 0016 as the current umbrella.**

LLP 0063 requires same-landing amendments only to LLPs 0010, 0015, and 0016 ([LLP 0063, “Demo-ladder authority”](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:212)). LLP 0020 still says “LLP 0016 remains the umbrella diary-driven change program” and calls it the umbrella tracker ([LLP 0020](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:33)). LLP 0021 says the same ([LLP 0021](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:32)). The root LLP’s follow-on index also points only to LLP 0016 for this program lineage and requires reconciliation when top-level structure changes ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:938)).

Resolution criteria: make LLPs 0000, 0020, and 0021 required same-landing amendments. They should identify LLP 0063 as the forward sequencing umbrella, preserve 0020/0021 as detail Plans, and call 0016 historical. Verify that no active document still names 0016 as the current umbrella.

**C4 — major — Residual live-matcher breadth is dropped from the carry-forward ledger.**

LLP 0016 says “broader matcher shapes” remain program work and its Phase 4 row retains range/non-equality breadth ([LLP 0016](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:20)). LLP 0020’s intended initial vocabulary includes explicit `Between` and portable `Prefix` ([LLP 0020](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:377)). Current `FilterOp` contains only `Eq`, `In`, `Lt`, `Lte`, `Gt`, and `Gte` ([source](/Users/ccheever/projects/snapback/src/manifest.rs:2250)). LLP 0063 correctly retires the shipped range/limited-boundary slice, but neither carries nor deliberately defers the remaining breadth.

The conservative fallback protects correctness, but a forward Plan scheduling filter-heavy chat and tracker work still needs a disposition for the unfinished obligation.

Resolution criteria: add a carry-forward row with owner, sequence home, and executable matcher/fan-out gates, or explicitly defer it with a conservative-fallback rationale and named revisit trigger; reconcile LLPs 0016 and 0020 accordingly.

**C5 — major — Step 2 has contradictory exit rules and no mandatory Contract-native graduation tuple.**

The global rule says a step exits when its workstreams’ acceptance bullets are executable and passing ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:697)). WS2 acceptance includes cross-surface live-query/mutation and deliberate-failure parity ([LLP 0063, WS2](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:372)), yet the Step 2 row permits exit while deferring that parity until Steps 1 and 3. It also requires only React/Expo iOS, while acknowledging that React/Expo cannot establish the Contract-native north star. That is weakly aligned with the root’s Contract/Exact-first, especially-mobile direction ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:386)).

Resolution criteria: split Step 2 into a provisional client-floor gate and a later closure gate, or make exit depend on Steps 1 and 3. Name the mandatory native tuple set for full-program success. If the program may graduate web-only, make that an explicit target-profile outcome rather than an accidental loophole.

**C6 — major — Overall completion can be vacuous because the required pressure-test set is undecided.**

Step 6 exits when “each pressure-test app’s admitted claims” passes, but admission is not bounded below ([LLP 0063, phase table](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:707)). The prose says the first three “should” be chat, documents, and commerce, while Open Question 8 leaves unresolved whether all seven are required or merely an evidence queue ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:780); [Open questions](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:818)). A zero- or one-app admission set could therefore satisfy the written exit.

Resolution criteria: define the minimum graduation applications and their required claim profiles; make remaining applications an explicitly non-blocking portfolio; and state the scope of the platform claim earned by each graduation set.

**C7 — major — The final proof’s identity is infeasible as one “revision and environment.”**

The Plan requires a single pinned revision and environment for the final proof ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:697)). The program actually spans Snapback and Exact revisions, package identities, iOS and Android, browser profiles, and hosted drills. Those cannot literally be one environment. Exact 0373 already specifies the appropriate shape: both repository revisions, package/environment identity per run, per-repository receipts, and aggregate validators ([Exact 0373](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:740)).

Resolution criteria: replace “one revision and environment” with one immutable revision set—both commits plus package/artifact digests—and a versioned target-profile matrix. Require per-profile receipts, aggregate validation, manifest change control, and adoption by both repositories as an explicit Step 0 exit gate.

**C8 — major — WS8 overstates the vanilla control and lacks workload-version governance.**

WS8 says vanilla “isolates the Snapback client path from framework and compilation cost” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:645)). It does not isolate compilation cost: the row is Vite-bundled, raw ESM was not tested, and the report warns that between-row deltas include different compiled application structure and are not pure framework measurements ([REPORT](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:292)). Similarly, WS2 says “Vite was required,” while the evidence establishes only that Vite was used.

The Plan also freezes thresholds once while the governed workload later grows through UI-parity claims. Exact 0373 handles this more coherently with immutable claim-set/workload versions, declared baseline rollover, and final behavior-equivalent React parity ([Exact 0373](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:617)).

Resolution criteria: describe vanilla as a lower-bound/subtraction instrument, not a pure compilation control; require capability-toggle attribution; change “Vite was required” to “Vite was used”; and freeze thresholds per immutable workload version with declared, prospective rollover when scope changes.

**C9 — minor — The DataProvider/no-Exact carry-forward status is factually misstated.**

LLP 0063 says both are “still open as explicit LLP 0021 checkboxes” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:163)). LLP 0021 marks the live Todo v2 Exact conformance pass complete ([LLP 0021](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:474)); the remaining item is reliability across local Ibex/Hermes setups. The no-Exact condition is an acceptance bullet, not an explicit status checkbox.

Resolution criteria: treat the existing Snapback conformance pass as retained regression evidence; carry environment reliability and the new non-Snapback producer separately; cite the no-Exact acceptance gate accurately.

**C10 — minor — Two WS6 acceptance bullets are not executable as written.**

“Materially shorter” and “time … measured” do not define pass/fail behavior ([LLP 0063, WS6](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:554)).

Resolution criteria: bind “materially” to a frozen Step 0 reduction/non-inferiority rule, and identify timing either as a scored gate with tolerance or as informational evidence that does not gate completion.

## 4. Suggestions (non-blocking improvements)

- Replace exact ranks 3–8 with dominance tiers until idiomatic Supabase and Convex arms exist. A useful split would be an immutable “science cohort” for causal comparison and a versioned “market cohort” for current product choice.

- Separate WS6’s package/dev-loop lane from declaration inference. External installation and package provenance can progress earlier without waiting for read/write-set inference.

- Add deliberately dishonest providers to conformance: one claims push while polling, one emits a stale result shape, and one lies about write effects. A neutral contract is stronger when it demonstrably rejects false capability claims.

- Embed the full target/diary/report hashes and a cell inventory in the Step 0 manifest. The current date-only evidence pin cannot distinguish same-day edits, and the tree already contains undocumented native arms not included in the 3×4 evidence.

- Require backup/destroy/restore drills to use disposable, attested target identifiers with a fail-closed production guard.

## 5. Open questions

1. Who ratifies the comparison protocol and gate-manifest schema, and who may change frozen claims?
2. Which Contract-native OS tuples are mandatory for full-program graduation?
3. Which pressure-test applications and claim profiles are the minimum platform proof?
4. What workload-version rollover rule applies when UI parity or product scope grows?
5. Does “final comparative ranking” mean live-data authoring only, or the whole platform? If the latter, how will Supabase Auth/RLS/generated types and full clean-install/deploy paths be represented?
6. What exact condition triggers R6 escalation, and who owns the rescope/reorder decision?
7. Is portable prefix matching still a planned v0 capability, or should it be explicitly deferred?

## 6. Readiness verdict

NOT READY

The proposal’s core strategy is good, but unresolved major concerns remain in evidence validity, cross-repository ownership, supersession completeness, carried scope, phase exits, program completion, and proof governance. Resolving C1–C8 would make this a coherent, acceptance-ready Plan without changing its north star.

### Orchestrator verification note (round 4, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C1 confirmed (`demos/_kit/client.mjs:3319` defaults `fallbackToPoll = true`;
the browser matrix runner contains zero transport/connection assertions);
C3 confirmed (LLP 0020 lines 33/138 and LLP 0021 line 34 still name LLP 0016
as the umbrella program; LLP 0000's Related index carries the lineage); C4
confirmed (`src/manifest.rs:2250` FilterOp is Eq/In/Lt/Lte/Gt/Gte only — no
Between or Prefix); C2 confirmed via Exact 0373 rev 3 (three-fact model at
its lines 327/617/644, reciprocation at 696) — the same finding as the
concurrent Claude-family round's C2; C9 confirmed (LLP 0021: the Todo v2
conformance pass is recorded Done at Phase 2; no-Exact-core is a Phase 3
acceptance bullet, not a checkbox). No claim checked false.

## Round 5 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `47700646f9d655b0e7d1592be52c2efe9939b9b48e5895e29f7551c72318ffcb` (untracked file at repo HEAD `157a3cc`; round-5 revision). Evidence-file hashes verified unmoved by the reviewer.
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7dcd-09a4-7280-8d5b-7982ba6b05ac; fresh session — no access to the orchestrating Claude session, prior artifacts, or the concurrent Claude-family round. Independence disclosure: faulty absolute-path exclusions in delegated searches surfaced three isolated unrelated lines and one review-file line count; the review states they were discarded and all findings independently verified.
**Verdict:** NOT READY

### Review body (verbatim)

Revision verification: **MATCH** — computed SHA-256 `47700646f9d655b0e7d1592be52c2efe9939b9b48e5895e29f7551c72318ffcb`. The diary and report hashes also matched their launch values at completion; no evidence movement was observed. Repository HEAD is `157a3cc`, and all three files are untracked.

Prior-review access disclosure: no review artifact was intentionally opened or relied upon. Faulty absolute-path exclusions in delegated searches surfaced three isolated, unrelated matching lines and one review-file line count. They were discarded; every finding below was independently verified against source LLPs, evidence files, or code.

## 1. Overall assessment

This is a strong and worthwhile proposal. It turns unusually candid comparative evidence into a sequenced product program, preserves subsystem ownership, and avoids pretending that Contract × Snapback already wins the whole application lifecycle. The conditional ranking, explicit fallback outcome, capability honesty, and cross-repository gate concept are all sound.

It is not ready for acceptance yet. The retained 40/40 evidence does not prove the RSVP convergence attributed to it; the shared Exact/Snapback coordination contract has already drifted; threshold timing is contradictory; keyed-query deduplication is unsafe as worded; and Workstream 2 can close without several obligations carried from LLP 0016. These are Plan-level defects in evidence, sequencing, and gates—not requests for subsystem semantics.

`./ref-check --verbose` passes: 64 LLP documents, 1,419 references, zero errors.

## 2. Strengths (with section citations)

- The evidence qualifications are unusually disciplined. The Plan correctly distinguishes stream configuration from observed push delivery, records the polling caveat for Supabase and Convex, reproduces the bundle figures exactly, and imports most of the report’s validity limits ([Evidence and limits](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:45>)).

- The carry-forward ledger is substantially accurate and useful. It preserves the open manifest mapping, live-wire races, package publication, managed lifecycle, admin boundary, Exact ergonomics, React/Expo, authorization breadth, execution limits, and v0 freeze while explicitly retiring stale status rows ([Carry-forward from LLP 0016](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:138>)). Its matcher-breadth disposition also matches the current `Eq/In/Lt/Lte/Gt/Gte` implementation and LLP 0020’s unshipped `Between`/`Prefix` intent.

- Scope and ownership are well drawn. The Plan owns sequencing and evidence while leaving API, runtime, auth, packaging, and Contract semantics to their governing documents ([Scope and ownership](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:122>)).

- “Clearly better” is treated as an executable comparison rather than advocacy, and the explicit partial-success outcome protects against reframing Contract’s data-authoring win as a universal product win ([Product choice](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:281>)).

- Workstream 7’s capability-to-authority table is an effective way to prevent local stubs or mere RFC existence from becoming production claims ([Complete the application platform](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:634>)).

- Cumulative gates, immutable two-repository identity, per-profile receipts, and aggregate validation are the right eventual proof shape ([Sequence](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:758>)).

## 3. Concerns

**C1 — major — The browser evidence does not prove the claimed RSVP convergence.**

The Plan says the browser contract “asserted same-page convergence” ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:51>)). The test clicks `rsvp-going`, polls the entire guest panel for “Going,” and then separately checks that the panel contains both “Eve” and “Going” ([browser-matrix.mjs](</Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:116>)). Before the click, the seed already contains Grace with status `going` and Eve with status `maybe` ([seed.json](</Users/ccheever/projects/snapback/demos/partiful-matrix/shared/seed.json:38>)). The predicate is therefore already true. Providers also persist across the cell loop, so later rows may inherit earlier mutations.

This does not erase the build, boot, feed, navigation, or vanilla-disposal evidence, but it weakens twelve of the forty checks and directly falsifies their stated RSVP-convergence interpretation. Step 0 currently repairs skip-as-pass and adds a push witness, but not this defect.

Resolution criteria: establish a deterministic per-cell precondition or unique actor; assert Eve’s specific status or selected button state; await an actual state transition; rerun all twelve cells; retain the machine-readable receipt; and revise the diary, report, and Plan evidence claims and hashes.

**C2 — major — Threshold freeze timing is contradictory and unscheduled.**

The governing prose says Step 0 freezes metric definitions and non-inferiority rules, while numeric thresholds freeze at the first attribution run, before optimization ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:293>)). The Step 0 table instead exits with “frozen thresholds” ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:773>)), and Open Question 4 again calls them thresholds “the step 0 protocol freezes” ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:893>)). Exact 0373 likewise records threshold identity and thresholds as frozen in phase 0 ([Exact 0373](</Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:812>)).

No sequence row explicitly schedules the first attribution run before Steps 1–3 can change lifecycle, provider, or emitted-code costs.

Resolution criteria: choose one rule and state it identically in both Plans. If retaining the two-stage rule, give the Step 0 receipt separate immutable method/rubric and numeric-threshold identities, schedule the attribution receipt before any optimizing change, and remove every ambiguous “thresholds frozen at Step 0” statement.

**C3 — major — The cross-repository gate has already drifted and is incomplete in this Plan’s phase table.**

LLP 0063 adopts Exact 0373 §5.1 by reference ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:724>)), but its Step 0 exit omits Exact’s blocking content-addressed distribution, change-control, independent-checkout digest validation, and two-sided aggregate-validator requirements. LLP 0063 still asks where the authoritative manifest lives ([Open Question 7](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:901>)); Exact 0373 makes resolving that a phase-0 exit condition ([Exact 0373 §5.1](</Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:836>)).

Drift is already observable: Exact 0373 identifies the sibling LLP 0063 bytes as SHA-256 `430a259a…` ([Exact 0373](</Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:181>)), while the reviewed target is `47700646…`.

The later entry rows also understate Exact prerequisites. For example, LLP 0063 Step 1 says “both Exact amendments,” while Exact 0373 phase 1 names amendments across 0265/0263/0259/0330/0342/0329/0278, a 0207 acknowledgment, and conditional 0284 work ([Exact sequence](</Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:865>)).

Resolution criteria: reconcile the sibling revision; make manifest authority, distribution, change control, and both clean-checkout validators explicit Step 0 gates; and have later steps consume exact counterpart gate IDs or a digest rather than maintaining incomplete prose copies.

**C4 — major — “Same arguments deduplicate” omits the security-critical authority partition.**

Workstream 1 requires instances “with the same arguments” to deduplicate ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:347>)). Exact 0373 correctly defines the logical key as an opaque provider/authority partition plus descriptor version and canonical arguments, specifically to prevent identical arguments from deduplicating across providers, stores, tenants, roots, or users ([Exact 0373](</Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:281>)). Its acceptance gate explicitly requires same descriptor/arguments across providers or users not to deduplicate ([Exact 0373](</Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:320>)).

As written, the Snapback-side gate can be implemented as cross-context sharing, which is a data-isolation failure.

Resolution criteria: define the logical key as authority partition + stable descriptor/version + canonical arguments; require ref-counted dedup only within that key; prohibit cross-context dedup; treat physical transport sharing as a capability; and import Exact 0373’s adversarial provider/root/user cases.

**C5 — major — The React/Expo carry-forward is missing executable API and mutation-state gates.**

LLP 0016 requires React/Expo to share generated artifacts and the version handshake, keep direct table writes out of the default API, report capability class honestly, and expose pending mutation/optimistic behavior ([LLP 0016 Phase 6](</Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:303>); [ownership](</Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:344>)). LLP 0012 makes mutation invocation, pending state, generated-function bindings, and the prohibition on a parallel default cache explicit ([LLP 0012](</Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:809>)).

LLP 0063 carries the phase in its ledger but Workstream 2’s acceptance covers lifecycle, cross-surface convergence, deliberate failure, and native execution—not pending/optimistic settlement, generated-only API shape, parallel-cache/direct-write exclusion, or a React/Expo version-handshake witness ([Workstream 2](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:365>)). The step can therefore close while carried requirements remain unproved.

Resolution criteria: add executable React/Expo gates for pending and authoritative settlement, optimistic reconciliation, generated-function-only default APIs, absence of a parallel cache/direct-table-write path, and adapter/artifact handshake incompatibility.

**C6 — major — Workstream 2’s graduation and regression rules do not compose.**

Full-program success requires React/Expo iOS and Android ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:387>)), but Step 2 provisionally requires only React/Expo iOS and says Step 3’s parity witness “closes WS2” ([Sequence table](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:777>)). No later row closes Android.

The same workstream replaces the shared 73-line vanilla lifecycle owner and requires its 3/3 suite to pass against the replacement ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:414>)), while cumulative gates require rerunning anything changed work could regress. Yet Open Question 5 allows Step 2 to accept the old vanilla witnesses without rerunning ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:895>)). Replacing a shared lifecycle primitive can affect all four vanilla cells, so old witnesses cannot establish the new implementation.

Resolution criteria: name the exact tuple/class required at provisional exit and final closure; place Android in a specific exit gate; and require rerunning every vanilla cell affected by the shared lifecycle replacement. Retained 2026-07-19 results may be the baseline, not post-change proof.

**C7 — minor — One carry-forward attribution to Exact 0265 is inaccurate.**

LLP 0063 says Exact 0265 records missing-`mutates` diagnostics and unknown-write-set reporting as implemented ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:161>)). Exact 0265’s Implementation Status records header-order tolerance, guarded statements, typed empty lists, alias props, and provider-diagnostic handoff, but not those two mutation diagnostics ([Exact 0265](</Users/ccheever/projects/exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md:789>)). The implementation and tests exist, so the disposition is substantively right; the documentary claim is not.

Resolution criteria: cite the implementation/tests or update Exact 0265’s status before saying that document records the work.

**C8 — minor — The stylesheet and realtime conclusions exceed the retained witnesses.**

The unchanged React stylesheet reuse is established. Visual equivalence is not: the report explicitly says no separate in-app visual inspection was obtained ([REPORT](</Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1166>)), and the browser suite has no screenshot or visual-regression assertion. Thus “the visual polish is a web-platform asset” and “React’s real advantage is authoring economy” are stronger than the executable evidence ([LLP 0063](</Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:67>)). Likewise, “Snapback supplied correctness and realtime” is categorical before the required push witness.

Resolution criteria: narrow the claims to unchanged stylesheet reuse and stream-capable live configuration, or add retained visual and unsolicited-push witnesses.

## 4. Suggestions (non-blocking improvements)

- Generate the phase table from the shared claim-manifest DAG. Hand-maintained entry rows have already diverged from Exact 0373; generated tables would make prerequisites, evidence digests, and invalidation rules one-source facts.

- Replace the uncertain ordinal ranking for positions three through eight with tiers or conditional scorecards. The report supports strong conditional winners but not fine-grained ordering among the gateway cells.

- Exercise production artifacts through `vite preview` or an equivalent static server. The current browser suite uses Vite development servers, while production builds and bundle measurements are separate evidence.

- Add the report’s broader common-seam caveat: fixed provider portability can favor the backend closest to the shared abstraction, not merely hide native realtime clients.

- Freeze each Step 6 vertical’s required-pressure profile before implementation. “Admitted claim profiles” should not be narrowable at graduation time without a prospective Plan amendment.

## 5. Open questions

1. Who owns and versions the provider-independent `retryable` versus `terminal` failure taxonomy, and how does it enter the three-fact mutation projection and adapter handshake?

2. Which exact Workstream 2 tuples and capability classes are required for provisional exit, web-only graduation, and a Contract-native default?

3. Does every pressure named for chat, documents, and commerce have to pass for the “minimum platform proof,” or may an admitted profile omit some? Who approves that profile?

4. What event triggers R6 escalation, and who owns reordering or rescoping? The Plan promises a “named review trigger” but leaves its condition and owner open.

5. Who ratifies numeric comparison thresholds after the first attribution run, and what prevents selecting thresholds merely because they fit the observed baseline?

6. Should provider/runtime physical subscription sharing ever be required, or should only authority-partitioned logical deduplication be normative?

## 6. Readiness verdict

NOT READY

The strategic direction is good, and most carry-forward and quantitative evidence is accurate, but unresolved material defects remain in the RSVP evidence, threshold governance, cross-repository phase contract, keyed-query isolation, and Workstream 2 completion gates. Correcting those would leave a credible, unusually evidence-driven roadmap rather than requiring a change in its core direction.

### Orchestrator verification note (round 5, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C1 confirmed and material — `shared/seed.json` lines 39-40 seed Grace
status "going" and Eve status "maybe" on the sunset event, and the browser
check's predicate (guest panel contains both "Eve" and "Going") is
satisfiable by the pre-click seed state, so the twelve "observes RSVP"
checks prove rendering, not convergence; C2 confirmed (the step-0 matrix
row still says "frozen thresholds" and open question 4 still says "the
step 0 protocol freezes" — stragglers from the round-4 edit that moved
numeric freezing to the first attribution run); C7 consistent with the
round-4 Claude-family verification (the two mutation diagnostics exist in
the Exact compiler's diagnostic-codes.ts but are absent from Exact 0265's
status list). No claim checked false.

## Round 6 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `9372860c3ab69b8b410369444a635abd907e6e88a44f3134e1cc223cdd4ea3e7` (untracked file at repo HEAD `157a3cc`; round-6 revision). The reviewer reports the evidence files matched their launch hashes initially and then MOVED during the review (third same-day extension: native RSVP-oracle correction and sixteen-cell rerun); the review uses the moved state, per the brief.
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7ddf-d2d0-7b51-bfdf-eb90a1e62c78; fresh session — no access to the orchestrating Claude session, prior artifacts, or the concurrent Claude-family round. Independence disclosure: one broad search emitted fragments of an unrelated vendored Ibex llp/reviews/ file; the review states they were excluded.
**Verdict:** NOT READY

### Review body (verbatim)

Revision verification: **MATCH** — computed SHA-256 `9372860c3ab69b8b410369444a635abd907e6e88a44f3134e1cc223cdd4ea3e7`, matching the requested revision. Repository HEAD is `157a3cc3f919736ef557dcc7024835b7b5de08e6`; the target is untracked.

Evidence verification: **MOVED DURING REVIEW** — both files initially matched the launch hashes. Their current hashes are Diary `d2de56b9141e4739d6aeaf468c05960e7a2398f20e78af0a50bb5f5b101159a1` and Report `c1252709471e2bf8981886c4751b0d536ca7e93f51341fb02044b2494df79c7c`. This review uses that current state.

Compliance note: one broad read-only search in the sibling Exact checkout inadvertently emitted fragments from an unrelated vendored Ibex `llp/reviews/` file. I excluded them completely; no prior LLP 0063 review was opened or used. No files were modified.

## 1. Overall assessment

This is a good proposal with unusually strong evidence discipline, honest fallback outcomes, and a substantially accurate reconciliation of LLP 0016. The bundle numbers reproduce exactly; the original eight-cell claim, later vanilla expansion, polling caveat, and narrowed push claim all match the evidence and implementation.

It is not yet a sound executable Plan, however. The evidence identity is already stale after a material correction; success thresholds can be fixed after metric-affecting work begins; the keyed-query authority partition is security-relevant but underspecified; the graduation definition can bypass Snapback’s stated primary Contract/mobile target; and Workstream 6 schedules joins and migration behavior without an owning semantics document. These are Plan-level sequencing and acceptance defects, not requests for subsystem detail.

## 2. Strengths (with section citations)

- The “Evidence and limits” section is exceptionally candid. It correctly distinguishes “stream configured” from observed push, identifies the seeded RSVP false-positive, limits native comparisons, and avoids portraying Supabase or Convex as polling systems ([LLP 0063, Evidence and limits](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:48)). The bundle figures reproduce the Report’s measurements exactly ([REPORT](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:306)).

- The matrix history is represented faithfully: Diary 0016 records the original two-arm-by-four-backend experiment ([Diary 0016](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:9)), while the current browser runner defines three arms, four backends, and 40 checks ([browser-matrix.mjs](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:20)).

- The Plan’s authority boundary is well conceived: it owns sequencing, priorities, evidence, and cross-stack gates while delegating subsystem semantics ([Scope and ownership](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:156)).

- The LLP 0016 carry-forward audit is substantially accurate and complete. I found no major dropped obligation across LLPs 0016, 0020, and 0021. The three-way distinction among unfinished, closed-but-regression-bearing, and deliberately deferred work is particularly useful ([Carry-forward](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:172)).

- Cumulative, machine-readable gates tied to immutable Snapback/Exact revisions and artifact digests are a strong answer to cross-repository drift ([Sequence](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:827)).

- The Plan does not disguise partial success: React × Snapback remains the polished-web default if Contract’s product-surface and budget gates do not close ([Product choice](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:356)).

- Workstream 7’s capability/authority table is honest about missing RFCs and requires executable implementation witnesses rather than accepting documents alone ([Workstream 7](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:701)).

## 3. Concerns — numbered C1, C2, …; each with severity (major or minor), concrete evidence (file paths / quotes), and explicit resolution criteria

**C1 — major — The Plan’s evidence binding is stale after a material oracle correction.**

Evidence: LLP 0063 pins the old Diary and Report hashes and says any later extension requires “a dated Revised entry here (with refreshed hashes)” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:146)). Both files have since changed. The new Diary text says both native RSVP checks originally selected an already-seeded value and that all sixteen native cells were rerun after correction ([Diary 0016](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:553)); the Report now describes the corrected toggle oracle ([REPORT](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1456)). The current Swift application count is also 829 lines, not the still-reported 822, and the XCUITest is 38 rather than 35.

Resolution criteria: refresh both evidence hashes and the Revised field; incorporate the native false-positive and corrected rerun explicitly; rerun the stated source-count method; and retain a machine-readable receipt identifying all 12 web and 16 native cells, their revisions, checks, skips, and artifacts.

**C2 — major — Threshold sequencing does not enforce the Plan’s anti-gaming rule.**

Evidence: the Plan says numeric thresholds freeze at the first attribution run, “strictly before any optimization work,” and that baselines precede changes to either stack ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:342)). But Step 0 freezes only methods and leaves the attribution run outside its formal exit; Steps 1–3 then change lifecycle, client, provider, and diagnostic behavior before Workstream 8 begins ([phase-gate table](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:844)). Open question 4 itself asks what prevents fitting thresholds to the observed baseline. Exact 0373 is inconsistent too: its two-stage rule defers numeric freezing ([Exact 0373](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:677)), while its phase-zero text says thresholds are frozen there ([Exact 0373](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:799)).

Resolution criteria: make the initial complete attribution run and deterministic numeric-threshold derivation a Step 0 exit gate, before any metric-affecting implementation; preregister the derivation and adjudicator; define a non-relaxing correction process for faulty instruments; and reconcile LLP 0063, Exact 0373, and the shared manifest.

**C3 — major — Workstream 1’s authority partition is ambiguous in a security-relevant way.**

Evidence: the logical key is described as authority partition “provider, store, tenant, root, and user” plus version and arguments ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:383)). LLP 0012 distinguishes `userId` from `authorityInstanceId` and says same-user re-login may retain rows while suspending the predecessor queue ([LLP 0012](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:696)). LLP 0053 notes that authorization may also depend on `sessionId` and provider ([LLP 0053](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1531)). Exact 0373 more safely requires an opaque partition that rolls on authorization or provider reconfiguration ([Exact 0373](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:287)).

Resolution criteria: define the key in terms of a provider-issued opaque authority-partition identity plus stable descriptor identity/version and canonical arguments—not a user tuple. Require rolling it on every relevant authority transition, with adversarial tests for same-user re-login, anonymous/authenticated transitions, provider or session changes, tenant/root changes, and late results from predecessor authorities.

**C4 — major — “Full-program success” can bypass the corpus’s primary Contract/mobile and local-first target.**

Evidence: the root LLP says the first-class context is Contract/Exact, “especially mobile apps,” with React/Expo secondary ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:386)), and defines offline operation as foundational ([LLP 0000](/Users/ccheever/projects/snapback/llp/0000-snapback.explainer.md:527)). LLP 0063 instead makes React/Expo iOS and Android mandatory, makes Contract-native tuples conditional, and permits graduation with a web-only default ([Workstream 2](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:415)). Step 2 initially requires only an “at least Online” tuple ([phase-gate table](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:848)); LLP 0012 explicitly says Online is not Parity/local-first ([LLP 0012](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:568)).

Resolution criteria: define separately named web-only, Online-native, and full north-star outcomes. Full north-star success should require the intended Contract-native tuple and executable Parity evidence for retained offline reads, queued mutations, replay, and rebase. Otherwise explicitly narrow this Plan’s ambition and reconcile that decision with LLP 0000.

**C5 — major — Workstream 6 schedules semantics for which no governing authority is named.**

Evidence: LLP 0063 promises generated joins, maintained projections, migration previews, and deterministic migration proof ([Workstream 6](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:642)), while its Step 5 authority row names no storage-evolution document ([phase-gate table](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:851)). LLP 0004 says joins require a follow-on storage/query spec and explicitly defers migrations ([LLP 0004](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:393)). LLP 0007 owns only a conservative evolution boundary and says full migration workflows need a dedicated LLP ([LLP 0007](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:525)). This contradicts R1’s rule that every phase has a governing subsystem LLP.

Resolution criteria: either narrow WS6 to LLP 0007’s existing conservative behavior, or make accepted query/projection and migration semantics explicit Step 5 entry prerequisites. Each promised generated pattern must name its owning document and executable gate.

**C6 — minor — Carry-forward bookkeeping has small but concrete reconciliation errors.**

Evidence: the v0 freeze row assigns its home to Workstreams 4 and 5 ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:202)), although the sequence and gate table correctly make it Step 0. The same-landing supersession sweep names several documents but misses LLP 0008’s live prospective reference to “LLP 0016 Phase 6” ([LLP 0008](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:415)).

Resolution criteria: relabel the freeze’s home as Step 0 and include LLP 0008 in the acceptance-time prospective-reference sweep. Also distinguish already-landed ACL/protected-room evidence from the genuinely open hosted/custom-key/product-UI authorization work.

**C7 — minor — Step 3’s prose and formal exit gate disagree about the fairness experiment.**

Evidence: the pressure-test section requires both idiomatic Supabase Realtime and native Convex legs and says they “report into the step 3 exit” ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:898)). The formal Step 3 exit requires only “one non-Snapback producer” ([phase-gate table](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:849)). Workstream 8 prevents final ranking without the full experiment, but Step 3 can formally close without what its prose promises.

Resolution criteria: either add both idiomatic competitor legs and retained receipts to Step 3’s exit, or move the stated ownership to Step 4 and amend every reference consistently.

## 4. Suggestions (non-blocking improvements)

- Run thin chat, document, and commerce spikes before closing the abstractions they are intended to pressure-test. Keep Step 6 for production completion, but use early slices to challenge keyed scopes, offline assumptions, joins, diagnostics, and packaging.

- Split the 983-line umbrella into a concise governing Plan plus workstream/gate appendices or subordinate Plans once the shared manifest exists.

- Replace Workstream 5’s “mutation-state machine” gate with “three-fact projection/reducer transition coverage,” matching the model explicitly described immediately above it ([LLP 0063](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:593)).

- Add native carrier budgets—Hermes evaluation, startup asset weight, cold launch, and time to first authoritative data—beside the web bundle budgets.

- Treat current middle-stack rankings as uncertainty bands until the idiomatic competitor matrix lands, rather than retaining precise ordinal positions that the Plan already admits may move.

## 5. Open questions

1. Who derives and ratifies numeric thresholds, and how is independence from the implementation team demonstrated?
2. Is the intended terminal outcome Contract-native Parity, React/Expo mobile support plus Contract web, or a deliberately web-only Contract default?
3. What exact opaque authority identity governs keyed-query deduplication and invalidation?
4. Which joins, projections, and migration behaviors are within existing v1 semantics, and which require new RFCs?
5. Does the Step 0 baseline receipt cover all 12 web and 16 native cells, including corrected convergence oracles and retained machine-readable rerun evidence?
6. Which thin pressure-test slices must run before their corresponding abstractions are considered closed?

## 6. Readiness verdict

NOT READY

The strategic direction and evidence discipline are strong, and the LLP 0016 carry-forward is materially complete, but five unresolved major concerns affect correctness, security, sequencing, scope authority, and the definition of success. The evidence-hash defect is immediately concrete; the threshold, authority-partition, mobile-graduation, and Workstream 6 ownership issues must also be resolved before this Draft provides a trustworthy executable program.

### Orchestrator verification note (round 6, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C1 confirmed — the evidence corpus moved a third time during the review
(diary now sha256 d2de56b9…, report c1252709…); the diary's new material
records that both native RSVP checks originally asserted an already-seeded
value and that all sixteen native cells were rerun after the oracle was
corrected to select a different status, mutate, and wait for the new value.
C2/C3/C4/C5 are Plan-text and authority-citation concerns consistent with
documents verified in earlier rounds (LLP 0012 authorityInstanceId, LLP
0000 Contract/mobile primacy, LLP 0004/0007 deferrals); C6's LLP 0008 line
415 "LLP 0016 Phase 6" reference and C7's step-3 exit/prose mismatch are
confirmed against the current Plan text. No claim checked false.

## Round 7 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `68f2a403c6e7e63a96b1ed2729adee694c99c052bb2de7bc881a74dd2e90b4de` (untracked file at repo HEAD `157a3cc`; round-7 revision, third evidence rebaseline). Evidence hashes verified unmoved by the reviewer.
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7df1-f79e-7dc1-915a-6ddad4b1f22d; fresh session — no access to the orchestrating Claude session, prior artifacts, or the concurrent Claude-family round.
**Verdict:** NOT READY

### Review body (verbatim)

Hash verification: **MATCH** — computed `68f2a403c6e7e63a96b1ed2729adee694c99c052bb2de7bc881a74dd2e90b4de`, identical to the requested revision. The diary and report hashes also matched their launch values, so the evidence did not move during review. I reviewed the untracked target against repo HEAD `157a3cc`.

## 1. Overall assessment

This is a strong program direction and an unusually evidence-conscious draft. It identifies the right strategic problem: Snapback and Contract have compelling correctness and data-authoring advantages, but those advantages do not yet add up to a dominant application-development path.

As a Plan, however, it is not ready. Several sequencing rules allow work to bypass the baseline they are supposed to preserve; some acceptance gates can close by labeling required capabilities as gaps; native and agent-operability graduation lack complete scheduled gates; and two cross-repository contracts are misstated. These are Plan-level defects in sequencing, ownership, and acceptance—not requests for the Plan to absorb subsystem semantics.

## 2. Strengths (with section citations)

- **The evidence treatment is candid and mostly faithful.** [§Evidence and limits](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:48) accurately records the bundle figures, twelve-cell web extension, sixteen-cell native extension, Supabase/Convex polling caveat, absence of a transport-attributing push witness, weak web RSVP oracle, handwritten native provider, and blocked macOS XCUITest. These match the [report’s native verification record](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1442) and the implementation.

- **The carry-forward ledger is otherwise thorough.** [§Carry-forward from LLP 0016](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:180) correctly retains the manifest mapping, version handshake, adapter races, server-code exclusion, package publication, managed lifecycle, admin boundary, Exact diagnostics, React/Expo adapter, execution envelope, v0 contract freeze, and conformance residue from LLPs 0016, 0020, and 0021.

- **The authority-partitioned query key is a good security and lifecycle design.** [WS1](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:389) correctly rejects user identity as a sufficient deduplication partition, handles same-user re-login and provider transitions, and separates logical deduplication from physical transport sharing.

- **Mutation-outcome ownership is well divided.** [WS5](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:617) preserves Exact’s effect/presentation/evidence-join split while assigning Snapback only the raw provider receipt and settlement facts it can truthfully supply.

- **Inference is constrained by correctness.** [WS6](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:667) permits read/write inference only as a complete conservative ceiling and explicitly rejects runtime observations as an authority-expanding mechanism.

- **The cumulative evidence model is excellent.** [§Sequence](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:823) calls for retained receipts, content-addressed cross-repository claim manifests, immutable two-repository identity, target-profile receipts, and cumulative reruns. The same-landing supersession discipline in [§Supersession mechanics](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:271) is similarly strong.

## 3. Concerns

**C1 — Step 0 can be bypassed (major).**

**Evidence.** The Plan says the baseline must exist “before any metric-affecting work” ([LLP 0063:845–847](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:845)). It later allows Steps 5 and 6 to proceed using only their own prerequisites ([LLP 0063:898–902](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:898)), and Step 5’s entry cell does not require Step 0 ([LLP 0063:911](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:911)). WS6 directly changes source volume, generated code, packages, runtime setup, and build costs—the measurements Step 0 freezes.

**Resolution criteria.** Make Step 0 a conjunctive prerequisite for every implementation workstream. Before Step 0, allow only design, documentation, or explicitly non-metric exploratory work.

**C2 — WS1 contradicts the Exact-side same-key sibling contract (major).**

**Evidence.** WS1 requires same-key ref-counted deduplication, then states without qualification that “one sibling’s error or reconnect does not disturb another’s delivery” ([LLP 0063:400–419](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:400)). Exact 0373 says same-key siblings share one logical attempt, including its data, error, and reconnect state; independent error/reconnect delivery applies only to different keys or authority partitions ([Exact 0373:347–358](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:347)).

**Resolution criteria.** State that same-key siblings share attempt data/error/reconnect state while retaining independent binding lifecycle, presentation, refcount, and disposal. Require full delivery/error/reconnect isolation only for different keys or partitions.

**C3 — Native graduation is ambiguous, incomplete, and not fully scheduled (major).**

**Evidence.** WS2 identifies a first-class Swift client or generated gateway/Swift pair as real scope ([LLP 0063:447–450](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:447)), but its tuples cover React/Expo and Contract—not SwiftUI ([LLP 0063:450–462](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:450)). Full graduation requires a singular “Contract-native mobile tuple” without choosing iOS, Android, or both ([LLP 0063:463–474](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:463)). The sequence schedules React/Expo iOS and Android exits but no Contract-native exit ([LLP 0063:908–910](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:908)).

The stated Parity evidence omits local handler execution, even though LLP 0012 says “no local handler execution means no local-first/parity claim” ([LLP 0012:568–576](/Users/ccheever/projects/snapback/llp/0012-client-integration-contract.spec.md:568)). Accepted Exact LLPs 0331 and 0332 already own generated Rust Snapback bindings, retained native data, and mobile delivery ([Exact 0331 §7](/Users/ccheever/projects/exact/llp/0331-exact-native-product.spec.md:728), [Exact 0332 M4](/Users/ccheever/projects/exact/llp/0332-exact-native-delivery.plan.md:574), [Exact 0332 M6](/Users/ccheever/projects/exact/llp/0332-exact-native-delivery.plan.md:681)), but they are absent from the authority map.

**Resolution criteria.** Define immutable profile IDs distinguishing SwiftUI-direct, React/Expo, Contract-on-Hermes, and formal Exact/Contract Native. Choose the OS tuple required for full graduation; import all LLP 0012 Parity conditions, including deterministic local execution; reconcile ownership with Exact 0331/0332 and Exact 0373’s native-routing decision; and add the chosen Contract-native profile to a sequence exit. Either give SwiftUI its own gate or remove the Swift-client deliverable.

**C4 — Evidence qualifications and the initial ranking contradict each other (major).**

**Evidence.** Evidence item 1 says realtime and convergence cannot be treated as proven ranking inputs before Step 0 ([LLP 0063:52–66](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:52)). The ranking nevertheless says it weighs “realtime” ([LLP 0063:312–319](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:312)).

Item 8 also says the vanilla row proved that “mutations … ran” ([LLP 0063:97–105](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:97)). The browser witness merely clicks Going and looks for Eve plus any Going text ([browser-matrix.mjs:116–126](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:116)); the seed already contains Eve and an unrelated Going guest ([seed.json:38–40](/Users/ccheever/projects/snapback/demos/partiful-matrix/shared/seed.json:38)). It proves invocation and rendering, not successful mutation settlement or convergence.

**Resolution criteria.** Until Step 0 reruns, describe the ranking factor as unproven stream configuration or recompute the ranking without it. Narrow item 8 to wiring/invocation/initial-query evidence, or add a deterministic vanilla mutation transition before claiming successful mutation execution.

**C5 — The LLP 0016 carry-forward omits the central authoring-tier reversal (major).**

**Evidence.** LLP 0016 declared JavaScript `ctx.db` the public model and demoted `HostPlan` ([LLP 0016:256–262](/Users/ccheever/projects/snapback/llp/0016-diary-driven-change-program.plan.md:256)). LLP 0020 explicitly records that LLP 0051 reversed this for common mutations ([LLP 0020:97–109](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:97)), and LLP 0051 makes the typed declarative builder the first-class default tier ([LLP 0051:311–336](/Users/ccheever/projects/snapback/llp/0051-offline-hosted-parity.rfc.md:311)). LLP 0063’s “not carried as unfinished” list mentions JavaScript handlers but does not disposition this reversal ([LLP 0063:237–259](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:237)); WS6 and Step 5 also do not name LLP 0051 as the authority for generated CRUD.

**Resolution criteria.** Explicitly retire LLP 0016’s JS-only premise, name LLP 0051 as a WS6 authority, and separate generated-pattern gates for the declarative IR tier from inference or code generation for JS-handler implementations.

**C6 — WS6 can publish packages before their prerequisites and does not prove its claimed external loop (major).**

**Evidence.** WS6 requires public Contract and React packages ([LLP 0063:709–717](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:709)), while Step 5 may run before WS2 or WS4. LLP 0021 requires the generated manifest boundary before a stable adapter ([LLP 0021:158–163](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:158)) and places lifecycle/conformance/server-code-exclusion work before packaging ([LLP 0021 Phase 2](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:216)).

WS6 promises one coherent CLI that starts, inspects, generates, tests, and deploys ([LLP 0063:702–705](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:702)), but its acceptance never executes those commands. LLP 0041 already specifies clean-machine runtime installation, `doctor`, external `new`/`dev`/test, watch regeneration, offline codegen, and packed-package checks ([LLP 0041 §Acceptance](/Users/ccheever/projects/snapback/llp/0041-packaged-app-loop.plan.md:182)). Finally, the no-Exact-core condition appears only at Step 5, although LLP 0021 makes it a standing architectural constraint ([LLP 0021:123–127](/Users/ccheever/projects/snapback/llp/0021-contract-exact-integration-hardening.plan.md:123)).

**Resolution criteria.** Split declaration reduction from stable distribution. Require WS4 before stable Contract publication and WS2 before stable React publication; prereleases may precede those gates if clearly labeled. Import LLP 0041’s complete external-loop checks or narrow WS6’s claim. Move the no-Exact-core check into Step 0 and rerun it cumulatively after Exact-coupled steps.

**C7 — Graduation can succeed by relabeling missing work, and agent operability lacks a full gate (major).**

**Evidence.** “Clearly better” requires every gate with none waived ([LLP 0063:335–340](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:335)). Yet WS3 lets every listed capability receive a “non-gating trajectory” label ([LLP 0063:555–562](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:555)); WS5 permits missing LSP features as labeled gaps ([LLP 0063:662–665](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:662)); and Step 6 passes whatever “admitted claim profiles” were selected ([LLP 0063:912](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:912)).

The north star also names agent operability ([LLP 0063:34–38](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:34)), but its only agent exit explains why a bound list did not update. Exact 0373 defines a broader phase-5 gate spanning action → mutation → receipt → affected query → render, structural repair, and stable interfaces ([Exact 0373 P1](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:786)); that phase has no LLP 0063 graduation gate.

**Resolution criteria.** At Step 0, freeze mandatory claim IDs for each named graduation profile. Only claims genuinely outside a profile may be non-gating; downgrading a mandatory claim must select and ratify a narrower outcome. Import Exact 0373’s phase-5 agent-operability claim IDs into the shared manifest and final run, or narrow the north-star wording.

**C8 — Security ownership and generated-operation gates are incomplete (major).**

**Evidence.** WS7 says cookies, client-page XSS posture, and hosted auth “each” need a named amendment ([LLP 0063:742–745](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:742)). Accepted LLP 0060 already owns hosted deployment security and browser credential/XSS posture ([LLP 0060:85–124](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:85)); it deliberately makes cookie replacement a non-goal absent a complete Origin/CSRF contract ([LLP 0060:1069–1077](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:1069)). The remaining hosted gap is implementation and proof, plus a future v2 wire/storage specification—not wholesale semantic reassignment.

Separately, WS6 proposes generated CRUD and projections but has no authorization/visibility acceptance ([LLP 0063:672–727](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:672)), despite the carried invariant that security is part of authoring ([LLP 0063:227–229](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:227)). Read/write ceilings describe effects, not row visibility; Open Question 6 leaves that declaration floor unresolved.

**Resolution criteria.** Split WS7’s genuine new semantic gaps—OAuth, end-user recovery, provider delivery, future v2 wire/storage—from implementation of LLP 0060. Do not make cookies mandatory unless intentionally reopening LLP 0060. Make the authorization/visibility declaration floor a Step 5 entry gate, require generated operations to fail closed, and add cross-user and cross-tenant negative tests for every generated pattern.

**C9 — The threshold ratchet prevents truthful correction of an invalid measurement (major).**

**Evidence.** The Plan permits correcting a faulty instrument only when the recomputed threshold “may only tighten” and says frozen thresholds are never loosened or replaced ([LLP 0063:342–370](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:342)). If an instrument bug understated baseline cost or double-subtracted an attribution, a correct threshold must become less strict. The current rule would preserve a known false gate or encourage a workload-version workaround.

**Resolution criteria.** Preserve the no-relaxation rule for valid baselines, but add an independently ratified invalidation/rebaseline procedure. It must preserve the original artifacts, version-bump method and threshold IDs, document impact, rerun both arms and controls prospectively, and allow a correction in either direction.

**C10 — The destructive recovery drill lacks target-safety constraints (minor).**

**Evidence.** WS7 requires a “backup → destroy/replace → restore” drill ([LLP 0063:778–780](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:778)) without specifying target isolation or identity validation.

**Resolution criteria.** Require an isolated non-production target, exact target/profile identity preflight, a fixture sentinel or content hash as the restoration oracle, and fail-closed refusal of production or broadly resolved targets.

## 4. Suggestions (non-blocking improvements)

- Clarify the native density comparison. The 204-line Contract route is compared with an 822/829-line Swift application, while Contract also needs the 190-line provider, bindings, metadata, and carrier machinery. Add like-for-like totals beside the useful route-only comparison.

- Harden the auxiliary iOS XCUITest. It samples `my-rsvp-going.exists` immediately after the always-visible RSVP button appears ([PartitimeSwiftUIUITests.swift:24–32](/Users/ccheever/projects/snapback/demos/partiful-matrix/native/swiftui/Tests/UITests/PartitimeSwiftUIUITests.swift:24)), while the store publishes the event before awaiting guest refresh ([PartitimeStore.swift:42–45](/Users/ccheever/projects/snapback/demos/partiful-matrix/native/swiftui/Sources/PartitimeStore.swift:42)). Wait for an explicit current `my-rsvp-*` value before choosing the opposite state. The corrected 8+8 in-app/Acto oracles remain the load-bearing sixteen-cell evidence.

- Import the report’s remaining native qualifications explicitly: remote-Mac/simulator context, no signed-device or release archive, and no energy, memory, offline, or adverse-network study.

- Rename “native-realtime follow-up matrix” to “provider-native web realtime matrix”; elsewhere “native” consistently means iOS/Android.

- Add quantitative workload profiles—dataset size, subscription count, fanout, mutation rate, contention, and expected degradation—to the pressure-test claim manifests.

- Add LLP 0007 and Exact 0331/0332 to `Related` once their authority roles are reconciled.

## 5. Open questions

1. Does “Contract-native” mean the present Contract-on-Hermes carrier, formal Exact/Contract Native, or both? Which OS tuple is mandatory for full graduation?

2. Which WS3, WS5, WS7, native, and agent claims are mandatory in each named outcome, and who ratifies that profile before implementation?

3. Is LLP 0063 intentionally reopening LLP 0060’s bearer/cookie decision, or should WS7 consume the accepted hosted-security contract?

4. What authorization and visibility declarations may generated CRUD never infer?

5. Which exact WS2/WS4 gates permit prerelease versus stable publication of the React and Contract adapters?

6. What interfaces constitute completed agent operability: registry, HTTP, MCP, typed client, or a defined subset?

7. Who may invalidate a bad baseline, and what independent evidence is required before a corrected threshold replaces it?

## 6. Readiness verdict

NOT READY

The proposal has a sound strategic direction, strong evidence discipline, and several excellent acceptance mechanisms, but unresolved major issues remain in dependency ordering, same-key lifecycle semantics, native and agent graduation, evidence use, carry-forward completeness, package publication, security ownership, and measurement correction. Those defects can permit an invalid baseline, a weaker relabeled outcome, or implementation against the wrong owning contract; they should be resolved before the Plan advances beyond Draft.

### Orchestrator verification note (round 7, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C2 confirmed in substance (Exact 0373's same-key section — which now
records that it is adopting LLP 0063 WS1's rule — makes same-key
same-partition siblings share one logical attempt, so the Plan's
unqualified sibling error/reconnect-isolation bullet is ambiguous for
same-key siblings); C5 confirmed (LLP 0020 lines 97–109 record LLP 0051's
2026-07-09 reversal returning HostPlan/typed-builder mutations to the
first-class default tier); C8 confirmed (LLP 0060 line 1075 lists cookie
replacement without a complete Origin/CSRF contract as a non-goal, so the
WS7 row's "cookies need a named amendment" phrasing misreads the accepted
posture); C3 confirmed (Exact 0331 native-product spec and Exact 0332
native-delivery plan exist and are absent from the authority map); C1
confirmed (the round-6 steps-5/6 parallelizability sentence does not
require step 0 before WS6's metric-affecting work). No claim checked
false.

## Round 8 — 2026-07-19

**Revision under review:** `llp/0063-partitime-platform-roadmap.plan.md`, sha256 `274ecf3951475d4ab84ae7f7f1028a323571300ce5e5d2ac674bf032969834dc` (untracked file at repo HEAD `157a3cc`; round-8 revision). Evidence hashes verified unmoved by the reviewer.
**Runtime detail:** OpenAI Codex CLI v0.144.6, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, session id 019f7e06-166f-76c2-b912-422705152ce8; fresh session — no access to the orchestrating Claude session, prior artifacts, or the concurrent Claude-family round.
**Verdict:** NOT READY

### Review body (verbatim)

Hash verification: **MATCH** — computed SHA-256 `274ecf3951475d4ab84ae7f7f1028a323571300ce5e5d2ac674bf032969834dc`. The diary and report hashes also match their launch values; evidence did not move. Repository HEAD is `157a3cc`.

## 1. Overall assessment

This is a strong, unusually honest roadmap with credible priorities, careful ownership boundaries, and excellent acceptance-test instincts. Its evidence synthesis is materially accurate, including the false web convergence oracle, polling qualifications, bundle figures, native oracle correction, and incomplete push proof.

It is not ready for acceptance, however. The remaining problems are Plan-level: the cross-repository baseline order conflicts with Exact’s sequence; several mandatory subsystem prerequisites are absent from the phase table; the primary Contract-native outcome has no closure phase; and “production services” lacks a mandatory production deployment profile. These defects allow the documented sequence to finish without earning the outcomes the Plan names.

## 2. Strengths (with section citations)

- **Excellent evidence discipline.** “Evidence and limits” correctly distinguishes stream configuration from proven push, rendering from mutation convergence, and controlled polling adapters from Supabase or Convex as products ([LLP 0063 lines 48–164](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:48)). The exact bundle figures agree with the report and generated assets ([REPORT lines 306–334](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:306)). The native-oracle correction and sixteen-cell rerun agree with the diary and source ([Diary lines 539–557](/Users/ccheever/projects/snapback/diaries/0016-partiful-matrix.diary.md:539)).

- **The LLP 0016 carry-forward is broadly accurate.** Manifest mapping, version handshake, live-wire races, packaging, admin-boundary, Exact ergonomics, React/Expo, execution-envelope, v0-freeze, and conformance residues are all grounded in LLP 0016/0020/0021 ([LLP 0063 lines 184–216](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:184)). The “not carried” claims about read-your-writes, the local matcher/push slice, declarative-tier reversal, and the narrow closed-IR Parity path are supported by later code and LLP evidence.

- **Native capability honesty is particularly good.** The Plan separates React/Expo, Contract-on-Hermes, and Exact Native profiles; makes evidence OS-specific; imports LLP 0012’s actual Parity conditions; and names web-only and Online-native as narrower outcomes rather than quietly calling them full success ([LLP 0063 lines 472–522](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:472)).

- **The cumulative-gate architecture is the right idea.** Skip-is-not-pass, content-addressed receipts, immutable two-repository identity, cumulative regression runs, and a shared claim manifest are much stronger than prose completion claims ([LLP 0063 lines 896–993](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:896)).

- **Security and safety are integrated into acceptance.** Authority-partition isolation, generated-operation cross-user negative tests, fail-closed visibility, and constrained backup/restore drills are concrete and appropriately non-negotiable ([LLP 0063 lines 785–790](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:785), [lines 836–853](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:836)).

- **The Plan generally respects semantic ownership.** It distinguishes sequencing and evidence from subsystem semantics and explicitly routes Exact work to Exact authorities ([LLP 0063 lines 166–182](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:166), [lines 994–1019](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:994)).

## 3. Concerns

**C1 — Major: the joint Phase/Step 0 baseline can be invalidated by Exact UI work.**

Concrete evidence: LLP 0063 requires the first attribution baseline before lifecycle, client, provider, or emitted-code changes and makes Step 0 conjunctive for every implementation workstream ([lines 369–376](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:369), [lines 971–974](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:971)). Exact 0373’s Phase 4 UI row does not depend on Phase 0, however, and its next paragraph says “Product UI work may proceed in parallel” ([Exact 0373 lines 982–994](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:982)). Product-UI implementation necessarily changes source volume, emitted JavaScript, visual claims, and possibly the governed workload.

Resolution criteria: make joint Phase/Step 0 exit an explicit prerequisite of every Exact implementation phase, especially Phase 4; permit only design, inventory, and explicitly non-metric spikes beforehand; and make the aggregate validator reject a baseline taken after unratified metric-affecting changes.

**C2 — Major: the phase-gate matrix omits prerequisites that the Plan itself declares mandatory.**

Concrete evidence: the Plan says new subsystem semantics need an RFC or amendment ([lines 178–182](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:178)); the native client explicitly needs an RFC before implementation ([lines 479–483](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:479)); and WS3/WS4/WS5 require Exact amendments before implementation ([lines 994–1009](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:994)). Yet the table gives Step 2 only “step 0 done,” Step 3 only “WS1 semantics landed,” and Step 4 only “step 3 type loop closed” ([lines 984–991](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:984)). Workstream 6 similarly refers to “the soundness ratification” without naming its owner.

Resolution criteria: put the applicable shared-manifest gate IDs directly into Steps 2–4, including the native-client RFC, provider-boundary/handshake amendments, diagnostic amendments, WS3 per-capability owners, and the inference-soundness authority. Allow nonsemantic inventory work separately.

**C3 — Major: the primary Contract-native graduation outcome has no owned closure milestone.**

Concrete evidence: full north-star graduation requires a Contract profile on both iOS and Android with full LLP 0012 Parity evidence ([lines 504–519](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:504)). The sequence instead gates React/Expo iOS in Step 2, React/Expo Android in Step 4, and merely records Contract-profile status at Steps 4 and 5 ([lines 988–992](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:988)). Exact 0373 explicitly leaves the Apple-native evidence outside its program ([Exact 0373 lines 221–229](/Users/ccheever/projects/exact/llp/0373-contract-and-exact-after-partitime.plan.md:221)). Accepted Exact 0332 says Android breadth is insufficient, stages it outside its mandatory v1 matrix, and does not promote it in M6 ([Exact 0332 lines 174–196](/Users/ccheever/projects/exact/llp/0332-exact-native-delivery.plan.md:174), [lines 362–366](/Users/ccheever/projects/exact/llp/0332-exact-native-delivery.plan.md:362), [lines 702–719](/Users/ccheever/projects/exact/llp/0332-exact-native-delivery.plan.md:702)).

Resolution criteria: select the qualifying carrier at Step 0; map every iOS/Android Parity claim to a named authority, implementation milestone, owner, and receipt; include Android renderer/IME/TalkBack promotion; and add a blocking graduation gate. If this lies outside the program, narrow the terminal ambition and reconcile LLP 0000 before acceptance.

**C4 — Major: “Production services” can complete on an unspecified reduced or local profile.**

Concrete evidence: WS7 requires an honest target profile but does not define a minimum production profile ([lines 824–844](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:824)); Step 6 exits when chat, documents, and commerce pass their “admitted claim profiles” ([line 992](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:992)). LLP 0012’s target profile is only an ID plus capability facts, not a production floor ([LLP 0012 lines 349–373](/Users/ccheever/projects/snapback/llp/0012-headless-integration-contract.spec.md:349)). LLP 0014’s app-complete single-tenant phase adds hosted deployment, auth, retention, assets, notifications, and app secrets ([LLP 0014 lines 409–421](/Users/ccheever/projects/snapback/llp/0014-cloudflare-strategy.rfc.md:409)); LLP 0060 separately makes hosted-auth admission conjunctive ([LLP 0060 lines 435–517](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:435)). LLP 0036 is absent from WS7 despite email, OAuth, payment, webhook, and delivery-provider credentials requiring its accepted secrets/config contract.

The same gap affects realtime: LLP 0020 leaves the non-local transport abstraction open ([LLP 0020 lines 290–315](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:290), [lines 491–504](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:491)), while LLP 0063 retires only the local WebSocket residue.

Resolution criteria: define named deployment outcomes—at least local app-complete, hosted single-tenant, and hosted multi-tenant—and bind “complete application platform” to an explicit minimum. Include LLP 0036 and a deployed realtime/reconnect/no-silent-polling witness. Otherwise rename Step 6 as a local platform proof.

**C5 — Major: baseline invalidation contradicts the universal threshold rule.**

Concrete evidence: a provably invalid baseline may be corrected and its threshold “may move in either direction” with version-bumped IDs ([lines 383–390](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:383)). The immediately following “one rule” says frozen thresholds are “never loosened or replaced” ([lines 391–395](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:391)); WS8 repeats only the absolute ratchet ([lines 888–892](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:888)). These commands disagree precisely when a gate is known to be false.

Resolution criteria: state that the ratchet applies to valid baselines, with the formal invalidation procedure as its sole exception; preserve and retire the invalid ID, mint a replacement ID, and import that identical rule into WS8, Exact 0373, and the shared manifest schema.

**C6 — Minor: the carry-forward ledger needs three precision corrections.**

Concrete evidence:

- The authorization row attributes implementation closure to Accepted LLP 0053 ([LLP 0063 line 210](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:210)), but LLP 0053 says acceptance settles the contract and does not itself claim implementation ([LLP 0053 lines 1966–1971](/Users/ccheever/projects/snapback/llp/0053-authorization-invalidation.rfc.md:1966)). LLP 0059 and current subsystem tests provide the implementation evidence, while the card-game demo still disclaims the complete ACL/protected-room trace.
- Messaging/kanban/tracker/assets are described as “normatively carried” ([LLP 0063 lines 195–212](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:195)), but tracker/kanban/assets become non-blocking portfolio work at Step 6. That is a legitimate reprioritization, but not literal carry-forward of LLP 0016’s completion obligation.
- LLP 0020’s still-open stale-read retry-policy decision is neither carried nor explicitly deferred ([LLP 0020 lines 266–274](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:266), [lines 503–504](/Users/ccheever/projects/snapback/llp/0020-core-authoring-surface.plan.md:503)).

Resolution criteria: distinguish accepted semantics, implemented subsystem fixtures, and open app-level authorization proof; say explicitly that only the old ladder’s pressures—not every rung’s blocking status—survive; and add a disposition for retry policy.

**C7 — Minor: current evidence should be described as recorded but not yet retained.**

Concrete evidence: the Summary says all twelve cells passed 40/40 ([LLP 0063 lines 13–21](/Users/ccheever/projects/snapback/llp/0063-partitime-platform-roadmap.plan.md:13)), but no retained per-cell result artifact exists, and the current runner can print `PASS … skipped` and exit zero when Chrome or the server is missing ([browser runner lines 24–33](/Users/ccheever/projects/snapback/demos/partiful-matrix/tests/acceptance/browser-matrix.mjs:24)). Step 0 correctly repairs this. The native report additionally excludes release archives, signed devices, App Store, energy, memory, cold-start, offline, and adverse-network evidence ([REPORT lines 1461–1465](/Users/ccheever/projects/snapback/demos/partiful-matrix/REPORT.md:1461)), which the Plan imports generally but does not enumerate. Finally, “React supplied animation” is too broad: Vanilla imports the same transition-bearing stylesheet unchanged.

Resolution criteria: call the present web/native results “recorded, pending retained receipts”; enumerate the remaining native limits; and attribute CSS effects to the shared web stylesheet while preserving React’s demonstrated authoring-economy advantage.

## 4. Suggestions (non-blocking improvements)

- Make the shared claim manifest an executable dependency DAG and generate the human phase tables from it. That would prevent prose/table prerequisite drift.

- Keep LLP 0063 as the sequencing umbrella but split detailed workstream material into independently reviewable documents. At 1,125 lines with independent timelines, it meets LLP 0005’s stated reason to divide a large proposal ([upstream LLP 0005 lines 101–103](/Users/ccheever/projects/snapback/vendor/llp/llp/0005-rfc-process.guide.md:101)).

- Add an explicit staffing/DRI and stop-loss ledger. The four-week cross-repository escalation is good, but the broader eight-workstream program also needs a way to stop low-value portfolio expansion.

- Run both normalized and idiomatic provider arms in the follow-up experiment. Their difference would directly measure the “portability tax” rather than merely ranking two implementations.

- Add package signing/provenance, SBOM, and production observability gates beside registry publication and deployment drills.

- Move most of the enormous `Revised` narrative into a compact dated change log so the metadata remains usable as metadata.

## 5. Open questions

1. Which carrier—`contract-hermes` or `exact-native`—is intended to earn full north-star native graduation, and who owns its Android Parity closure?
2. What exact deployment profile must chat, documents, and commerce pass before Step 6 may be called “Production services”?
3. Are kanban/tracker/assets still terminal obligations, or only future pressure-test inventory?
4. Which accepted subsystem document owns read/write-set inference soundness and the authorization/visibility declaration floor?
5. Who ratifies comparison formulas, invalidates a baseline, and adjudicates manifest disputes across repositories?
6. Where will the authoritative shared manifest live, and how will two clean checkouts obtain the identical immutable digest?
7. Is all metric-affecting Exact product-UI work formally frozen until the joint baseline lands?
8. Must the production profile prove deployed unsolicited push, or is a declared Online/polling outcome acceptable?

## 6. Readiness verdict

NOT READY

The proposal’s direction is good and its evidence basis is unusually trustworthy, but the unresolved baseline-order conflict, incomplete prerequisite matrix, unowned Contract-native graduation, underspecified production profile, and contradictory threshold rule are material Plan defects. Acceptance should wait until the gate graph proves that implementation cannot begin before its authorities and baseline exist, and that completing the sequence necessarily earns one precisely named product outcome.

### Orchestrator verification note (round 8, outside verbatim body)

Spot-checked by the orchestrating /llp-super-refine session on 2026-07-19:
C5 confirmed (the invalidation procedure and the "never loosened or
replaced" one-rule sentence disagree at the known-false-gate boundary);
C6 confirmed in substance (LLP 0020 lines ~273-274 leave "define the first
retry policy explicitly" open with no LLP 0063 disposition; LLP 0053's
acceptance settles a contract rather than claiming app-level product
proof); C4's LLP 0036 omission confirmed (the accepted app-secrets/config
RFC is absent from the WS7 map though provider credentials ride on it);
C1's resolution requires binding Exact 0373's Phase 4 to the joint
baseline — an Exact-side amendment outside this Plan's authority; C3's
resolution requires choosing the qualifying native carrier and an Android
Parity owner. C1, C3, and C4's deployment-profile floor are program/product
decisions for the Plan's author, not document defects the orchestrator can
resolve — this is the /llp-super-refine stopping condition. The mechanical
residue (C5, C6, C7, the LLP 0036 row) is applied in the post-round-8
revision noted in the Plan's Revised header. No claim checked false.
