# Diary 0095: sol-coterie-familiar — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `sol-coterie-familiar` — GPT-5.6 Sol (codex CLI, xhigh)
**App:** Coterie (Exact/Contract web); Snapback familiar (snapback-familiar-ts-v1) profile, published 0.1.24 from npm
**Outcome:** M1, M3 green; M2 suite 22/22 green but M2 choreography non-green (Exact SPA link detachment; see ticket)
**Wall:** 7,631s · **Cost (approx., public list prices):** $39.04
- Output tokens: 152,614
- Input tokens (codex cumulative, incl. cached): 59,903,461 (cached 58,900,480)

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Coterie build diary

## M1 — accounts and profiles

Built: a sessions-mode familiar TypeScript backend with eight fixture accounts, unique handles, editable profiles, durable password custody, profile routes, an edit form, settings/logout, and the single generated Exact provider boundary. The cumulative starter M1 log replays through generated Snapback mutations. The suite and the frozen two-client segment are both green.

Exact / Contract observations: The provider-native declaration and deterministic binding generator made the client boundary unusually inspectable. Contract’s route, query, mutation, action, and view vocabulary was quick to assemble, and compiler witness output caught every screen. The main friction was the gap between semantic compilation and host choreography: logout needed an explicit route transition, and the runtime’s query bridge needed a notification for Snapback’s already-advanced live handle. A diagnostic that showed a binding’s last provider cell alongside its current host tree would have shortened that loop.

Snapback observations: Familiar TypeScript codegen was direct and caught the clock-dependent typing query at generation time. Password sessions, durable browser restoration, and domain mutations were strong once the app was cold-bound from startup artifacts. The published Vite allowlist omits its own password signup/signin paths, and the live handle advanced without invoking `onUpdate`; both required narrow adapter workarounds. The served Guide documented the canonical `generated/` root clearly, but there was no diagnostic page for the clock-dependent visibility code and no runtime warning for a missed `onUpdate` delivery.

What felt easy: fixture replay, password signup/signin, unique-handle refusal, profile mutation, and exact two-client observation once the transport bridge emitted revisions.

What fought me: an ambient stale CLI initially masked the familiar profile, sessions deployment needs cold-start artifacts before bind, the password relay’s allowlist omission, Vite middleware ordering, and the live-handle callback defect. Missing diagnostics: a CLI version command on the stale runtime, an application-readiness recipe for a pinned custom port, and a Contract/provider inspector showing live cells and auth transitions.

## M2 — feed, social graph, and threads

Built: text, two-image, and video post projections; Global and Following feeds; live follow/unfollow counts and filtering; direct links without unfurls; set-state likes and reposts with attribution; replies and ordered thread screens; implicit self-follow behavior; and stable 20-item pagination. I also added a dedicated Following Contract route so its query identity is static, and the cumulative M1+M2 starter logs replay through the generated mutation seam. The real-backend suite passed all 22 required atomic assertions.

Exact / Contract observations: Static query identities were materially more reliable than changing a live query argument from Contract state. Contract state initialized from router search sees the default snapshot too early, while a reactive route-search derivation caused interactive controls to remount. A dedicated `/following` screen plus generated bindings made the intended structure explicit. The frozen browser loop nevertheless exposed an Exact routing/rendering failure: its first repeated follow/unfollow attempt passed, but a later best-of attempt left the shared page without the app shell, and the harness then carried that poisoned page into every remaining one-shot check. A six-toggle standalone Playwright probe passed, while the unmodified frozen segment remained red. The missing diagnostic is a router/render receipt that names the last successful match, component generation, and reason the shell disappeared.

Snapback observations: The familiar queries and mutations handled all feed and social semantics cleanly in the isolated suite, including pagination, idempotent seed replay, follow projection, media metadata, and repost attribution. Live handle rows continued to advance reliably; provider-side deduplication was necessary to avoid publishing transport-only churn into the Contract tree. A fresh file-backed runtime made no difference to the frozen shared-page failure, which narrowed the remaining issue away from persisted data. A useful missing diagnostic would be per-live-query subscription/disposal counts and connection-state transition history.

What felt easy: domain modeling, fixture replay, set-state mutations, backend pagination, and direct authenticated verification. What fought me: translating a tabbed RN shell into Exact routes, route-state timing, list remounts during live revisions, and a best-of harness that retains failed-attempt browser state. Supplemental image/video choreography is explicitly skipped by the frozen harness because it has no media-picker test IDs; those checks are not required, while the suite verifies their projections.

## M3 — messaging core

Built: unique pairwise DMs, independently identified same-roster groups, membership and administrator enforcement, durable ordered messages, quoted-reply excerpts, quote targets, live typing with expiry, and visible receipt vocabulary. The M3 starter log replays cumulatively through the same provider mutations. The isolated suite passed every required atomic assertion, and the frozen two-client segment was green for live DM delivery and the typing deadline; the implemented quote/jump choreography also passed.

Exact / Contract observations: The conversation screen was a good fit for Contract’s async regions and semantic test IDs. Once the route was mounted, two-client messages and quoted replies were straightforward, and the frozen harness could drive them without presentation-specific selectors. Navigation remained the sharp edge inherited from M2, but the chat path used by M3 stayed stable. Contract would benefit from a semantic scroll-to-key operation: the quote preview can identify its target, but today the test passes because the short thread already keeps that target in view rather than because the UI can command a keyed list jump.

Snapback observations: The sessions-aware message and membership queries made access control explicit at the backend boundary. DM uniqueness, idempotent message insertion, same-roster group identity, and non-admin removal refusal were compact in Familiar TypeScript. Typing expiry needed a provider timer because a clock threshold does not itself cause a database revision; the first frozen timing attempt passed both visibility and expiry bounds. Later supplemental attempts show how repeated typing intents can extend presence, which is correct for real typing but makes independent best-of timing attempts sensitive to retained backend state. Missing documentation: a canonical ephemeral-presence recipe and a live-query primitive that schedules invalidation at an expiry timestamp.

What felt easy: DM reuse, group identity, ordered messages, quote projection, and backend authorization. What fought me: temporal presence semantics and the lack of a native keyed-scroll command in the Contract vocabulary. The frozen harness skips sender-avatar, receipt-state, aggregate group receipt, and member-cutoff checks because its own contract exposes no driveable semantic controls; all four are marked non-required, so the required segment still finished green.

---

# Lane essay (verbatim)

# Exact/Contract and Snapback from a React-family perspective

Building Coterie felt less like assembling a web application from components and hooks and more like defining a small executable protocol. In a React-family stack, I usually begin with component boundaries, route ownership, and a state model, then rely on conventions and review to keep server authority from leaking into the view. Exact reverses that emphasis. The Contract source is deliberately narrow: state, derived values, queries, mutations, actions, and a governed view vocabulary. The generated provider bindings make the data seam visible in the filesystem, and the compiler can reason about the relationship between mutations and observable queries. That constraint was genuinely valuable. It made it difficult to accidentally call Snapback directly from a screen, and it left a crisp answer to “where does authority live?”

The best part of this model is inspectability. A React application can have an excellent architecture, but nothing in JSX prevents a convenient fetch, storage call, or imported singleton from bypassing it. Here, all domain data traveled through one native provider declaration and generated bindings. The Contract files read almost like acceptance prose, and the preserved `sm-*` identifiers were first-class rather than an afterthought attached to arbitrary DOM. When the M1 and M3 two-client checks passed, the path from a browser action to a backend mutation to a live query revision was easy to narrate.

The cost is that familiar escape hatches are intentionally absent. In React, a tab can be local state, a URL search parameter, a router layout, or a context value, and it is easy to switch among those approaches while debugging. Contract state and router state have much stronger lifecycle semantics and a smaller vocabulary. That is good when the abstraction fits, but expensive when it does not. The feed tabs exposed this sharply: initializing state from router search happened before the useful route snapshot, while deriving the tab reactively caused the interactive tree to churn. A static Following route was more reliable and more legible, but also more verbose. In React I would have solved the same problem with a layout route and a stable component instance in minutes.

Debugging also differs. React DevTools, browser component stacks, query-cache inspectors, and mature router diagnostics provide several overlapping ways to ask why a control disappeared. Exact’s compiler diagnostics are strong at authoring time, but the runtime needs an equally strong explanation surface. During the frozen M2 loop, a successful first attempt could be followed by a later routed attempt that left the shared page without its shell. The harness then correctly reported missing semantic controls, but neither the browser output nor Exact said which route match, provider generation, or protocol flush invalidated the tree. The architecture is more principled than a typical React app; the current diagnostic experience is less forgiving.

Snapback Familiar TypeScript was pleasantly close to the productive parts of Convex-style backends: schema-defined tables, indexed queries, authenticated function contexts, generated references, and live results. It also kept mutation authority firmly server-side, unlike ad hoc REST endpoints paired with optimistic client code. The starter-log replay mapped naturally to idempotent mutations, and sessions-mode password auth was a coherent built-in capability. Compared with Firebase, the access rules lived beside understandable functions rather than in a second declarative language. Compared with Supabase, I did not need to split reasoning across SQL, row-level policies, realtime channels, and client cache invalidation.

The rough edges were concentrated at the tooling boundary. The published Vite integration refused its own password signin and signup relay paths, so the app needed a narrowly scoped pre-middleware. The streamed live-query handle advanced its rows while its update callback could remain silent, requiring observation of already-delivered handle state. Familiar codegen also insisted on `generated/`, in direct conflict with the task’s requested `_generated/` spelling. In each case the backend model was sound, but the adapter or documentation contract lagged behind it.

Ephemeral state is another useful comparison point. Typing indicators are awkward in every backend because time passing is not a database write. In a React plus WebSocket service I might keep presence entirely in an in-memory channel with server timers. Here I stored expiring intents in Snapback and filtered them at the provider, scheduling a local expiry notification so the Contract query changed without polling the network. It preserved backend authority over the expiry timestamp, but it was more ceremony than a purpose-built presence API. A server-supported “invalidate at” primitive would make this pattern both cleaner and more deterministic.

Overall, Exact/Contract rewards teams that value enforceable boundaries, semantic UI, and generated evidence more than unrestricted component expressiveness. Snapback Familiar TypeScript offers a compact and credible application backend, especially for durable collaborative state. React-family stacks remain faster when the problem falls outside the paved vocabulary, largely because their ecosystem and diagnostics offer many escape routes. The Coterie experience suggests a promising trade: accept a smaller authoring language in exchange for stronger architectural guarantees—but only if runtime introspection, router stability, and the dev-server integration become as mature as the compile-time model.
