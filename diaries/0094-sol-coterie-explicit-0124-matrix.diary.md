# Diary 0094: sol-coterie-explicit — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `sol-coterie-explicit` — GPT-5.6 Sol (codex CLI, xhigh)
**App:** Coterie (Exact/Contract web); Snapback explicit profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 5,212s · **Cost (approx., public list prices):** $43.04
- Output tokens: 159,445
- Input tokens (codex cumulative, incl. cached): 63,862,425 (cached 62,455,808)

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Coterie build diary

## M1 — accounts and profiles

Built: the source-linked Exact shell, file-router registry, one generated ProviderNativeDeclaration boundary, the explicit Snapback schema/functions backend, password signup/signin/logout, durable browser custody, profiles, profile editing, avatar persistence/rendering, live profile updates, starter-log replay, the suite runner, and the frozen choreography runner. M1 reached green with 7/7 suite-required assertions and 3/3 choreography assertions.

Exact/Contract observations: Contract made the presentation vocabulary pleasantly compact, and preserving the frozen `sm-*` identifiers was straightforward. The generated provider surface and manifest digest are useful architectural guardrails. The difficult parts were two runtime/metadata inconsistencies: declaration-level single queries were type-checked as objects but delivered as arrays, and generated mutation result metadata described the inner payload while actions received the raw `DataMutationResult` envelope. Both required provider/declaration compatibility workarounds. The renderer also reports authored `start`/`end` alignment values only at runtime and silently substitutes different values.

Snapback observations: explicit schema and handler authoring was predictable once every bounded read used an explicit `take`. Live queries propagated profile edits quickly and consistently. Password auth was harder: browser auth endpoints cannot use the Vite relay, and password issuance left the public principal projection on the anonymous pre-issuance session until the documented session handshake was forced. The managed server also lacks a direct port option, requiring a narrowly scoped wrapper to stay inside the assigned port range.

What felt easy: semantic Contract layout, provider binding generation, authenticated CRUD after the seam was established, and live profile propagation. What fought me: auth custody transitions, the single-query shape mismatch, raw-vs-inner mutation results, and Exact's very large cold dev-module graph.

Missing documentation/diagnostics: an end-to-end non-template example combining Exact generated provider bindings with password-authenticated Snapback; a prominent statement that the Snapback Vite relay excludes password endpoints; a runtime diagnostic for Contract single-query value shape; and a compiler/runtime diagnostic when authored mutation result access targets the generated inner type but runtime returns the outer envelope.

## M2 — feed, follow graph, and replies

Built: text, image, and video post persistence; global and following feeds; follow/unfollow; live post, profile, follow, like, repost, and reply projections; thread routing and reply composition; author attribution; and idempotent M2 starter replay. M2 reached green with 22/22 suite-required assertions and 7/7 required choreography checks. The two media choreography checks remained the harness's declared optional skips because its frozen compose contract has no media-picker test ID.

Exact/Contract observations: the feed and thread structures mapped cleanly into small Contract components, and live provider invalidation reached two open browser clients without view-side transport code. The main friction was lifecycle vocabulary: the choreography retains a page on a profile after toggling follow and after inspecting an author, so the profile presentation needed an explicit feed escape and successful follow needed to return to the feed. Large inline video fixture data also exceeds Exact's 16-bit protocol string field and is truncated; the frozen M2 browser choreography does not require video rendering, while backend persistence remains covered by the suite.

Snapback observations: the same explicit mutation path drove starter replay, browser writes, and the suite. Cross-client invalidation for posts, follows, likes, reposts, and replies was consistently sub-second once the page state matched the harness. Feed projection logic—especially distinguishing a followed author's original from a viewer repost—was the most subtle backend rule, but explicit handlers made that decision inspectable and unit-like suite checks caught it directly.

What felt easy: adding composable feed cards, preserving `sm-*` semantics, wiring mutations through generated bindings, and observing live counts across clients. What fought me: a hidden route-state assumption in the frozen choreography, Exact's oversized inline-media protocol limit, and the cost of repeatedly rendering fixture video values that the browser contract cannot drive.

Missing documentation/diagnostics: a Contract navigation/lifecycle example for mutation-then-navigate flows; a documented media primitive that does not encode blobs into the view protocol; a warning that repeated semantic test IDs across route transitions can leave Playwright resolving a retiring node; and Snapback examples for projection-level follow/repost feed semantics.

## M3 — messaging core

Built: idempotent DM creation, distinct same-membership groups, group member addition and authorized removal, live text messages with sender avatars, quoted replies and source jumps, live typing with bounded expiry, sent/seen receipt projection, conversation and chat-list presentation, and cumulative M1–M3 starter replay. M3 reached green with 7/7 suite-required assertions, 2/2 required choreography checks, and the optional quoted-reply choreography check passing. The harness retained four explicit optional skips where the frozen presentation contract provides no semantic driver or observable state.

Exact/Contract observations: message bubbles, quote selection, and the native-fragment jump were concise to express, while async live lists kept transport concerns outside the view. Re-rendering a controlled composer on every typing mutation can briefly detach its Send button; the harness's best-of-three rule tolerated this, but the third optional quote attempt repeatedly exposed it. The final Contract has semantic sender-avatar nodes, yet the harness correctly refuses to infer an image because the frozen choreography predates a sender-avatar-specific ID.

Snapback observations: DM uniqueness, group distinctness, authorization, message ordering, quoting, and typing expiry were straightforward explicit handlers. Sessions-mode artifact identity is admirably strict but operationally sharp: changing a handler requires regenerated artifacts and an official startup-successor activation before the pinned persistent database will accept the new generation. Thrown handler messages are redacted at the client boundary, so the non-admin refusal uses a no-write domain-result sentinel that the provider translates into stable application state.

What felt easy: two-client live messaging, data-driven avatar attribution, quote projection, and deterministic seed replay. What fought me: handler-error redaction, the separate generated-artifact/startup-carrier lifecycle, and controlled-input churn while typing updates stream through the same Contract tree.

Missing documentation/diagnostics: a copy-paste explicit-profile recipe for sessions-mode successor activation; a first-class typed domain-error example for JavaScript mutations; an accessible receipt-state token in the frozen contract; and semantic group membership controls so removed-member cutoff and retained history can be driven rather than skipped.

---

# Lane essay (verbatim)

# Exact/Contract and Snapback: a qualitative field report

Building Coterie felt less like assembling a conventional component application and more like defining two small languages that meet at a deliberately narrow border. On the client side, Contract is a presentation language: state, derivations, actions, async projections, and semantic nodes are visible in one compact file. On the backend side, Snapback's explicit profile is a capability declaration around ordinary-looking JavaScript handlers. The productive center of the work was the generated provider seam between them. Once that seam settled, the application behaved like a coherent system rather than a collection of hooks and endpoints.

Compared with React-family stacks, Contract removes a remarkable amount of incidental choice. A React implementation of the same screens would ordinarily make me decide how to compose hooks, memoization, effect lifecycles, data-library cache keys, mutation invalidation, error boundaries, router transitions, and accessibility props. Here, the view says that it queries a named projection and mutates through a named generated binding. The implementation is terse without becoming mysterious at the authoring level. Repeated feed cards and message bubbles were particularly pleasant: the structural hierarchy and observable `sm-*` vocabulary stayed close together, and there was no temptation to smuggle persistence or transport behavior into a component hook.

That constraint is also the largest adjustment. React lets an experienced engineer escape downward almost anywhere: inspect an event, hold a ref, call an arbitrary client, add an effect, or patch DOM behavior. Contract makes those escapes intentionally unavailable. When the choreography's route lifecycle exposed an assumption about returning from a profile, the fix had to remain a legitimate navigation statement in the presentation language. When a quoted excerpt needed to jump, the solution had to be expressed through the supported link and native identifier vocabulary. This produces a cleaner architecture, but it also means framework gaps are harder walls than they are in React.

The strongest Exact idea in this exercise was the ProviderNativeDeclaration. It forced every view to consume generated bindings from one declared backend boundary. In a typical React app, even a disciplined codebase can accumulate a direct fetch in a utility, an auth call in a provider, and a second cache client in a feature folder. The declaration made such drift obvious. Its manifest and generated bindings also made the acceptance harness's headless path and the browser path share the same write authority. Starter logs were not database fixtures in disguise; they replayed through the same provider mutations as the UI.

The weakest Exact moments were mismatches between declared semantics and runtime delivery. A declaration-level single query was typed as a single shape but arrived through the Contract runtime as an array. Typed mutation metadata described the inner result while authored actions received the outer provider envelope. Both failures occurred at exactly the abstraction boundary that is supposed to eliminate ambiguity, so diagnosing them required reading runtime source rather than relying on types. React's flexibility would have made either workaround trivial, but also would not have promised the stronger guarantee. Exact's promise is better; the implementation and diagnostics need to make that promise dependable.

Contract rendering also exposed the cost of a serialized view protocol. Small semantic props are a good fit. A video embedded as a data URL is not: the fixture crossed a 16-bit string limit, was truncated, and could not be used as a safe link scheme. React DOM would accept the large string and leave memory and performance consequences to the browser. Exact's refusal is defensible, but a production application needs a first-class asset path so authors do not discover protocol limits at render time. Similarly, controlled input updates combined with live typing mutations caused transient node replacement that occasionally made a browser click chase a retiring Send button. React has analogous controlled-input churn, but its DOM identity is more familiar and easier to instrument.

Snapback's explicit profile was refreshingly reviewable. The schema, indexes, auth program, read sets, write sets, validators, and handler bodies lived in two authored files. There was no hidden ORM model or generated resolver layer to mentally reconstruct. Compared with Firebase, Supabase, or a conventional REST service, it gave the backend a strong capability inventory while retaining direct control over domain logic. Feed projections, DM uniqueness, group identity, and authorization were easy to audit because the reads and writes were declared beside the handlers.

Live delivery was the standout. Once a live query was bound through the provider, cross-client posts, counts, messages, and typing state propagated without view-specific subscription code. In React Query or SWR, I would still need a websocket source, cache reconciliation rules, and carefully chosen invalidations. In Firebase, live data would be easy, but richer relational projections and authorization often migrate into scattered rules or client joins. Snapback kept projection logic server-side and made its dependency set explicit.

The operational model was stricter than most local backends I use. Sessions mode binds a persistent database to generated schema and function identities. A changed handler cannot quietly run against the old deployment; the runtime refuses until an official successor activation advances the pin. That safety is valuable and production-shaped. During timed development, though, code generation, startup-carrier refresh, and database activation felt like three related concepts with insufficiently direct documentation. A stale generated function initially looked like an application bug, and a fresh generation then correctly triggered an artifact-identity refusal. The runtime's diagnostic was good once reached, but the normal edit-generate-restart loop should make this path automatic or unmistakable.

Authentication had a similar character. The primitives were strong—durable custody, explicit session coordination, and direct password endpoints—but integration required knowing that the Vite relay does not carry those password endpoints and that a post-issuance session handshake may need to be forced. A mature React backend SDK usually makes the happy path more discoverable, even if its underlying guarantees are weaker. Snapback would benefit greatly from one explicit-profile, non-React, password-authenticated reference application that demonstrates the complete lifecycle.

The final architecture is one I prefer to an ordinary React plus API stack: declarative views, generated boundary functions, server-owned authority, deterministic replay through real writes, and live projections with no client cache policy. It is smaller in conceptual surface after the setup phase and harder to accidentally violate. Today, the cost is paid in boundary debugging and operational ceremony. Better diagnostics for query shape and mutation envelopes, a typed domain-error mechanism, a documented asset pipeline, and a smoother sessions successor loop would convert much of that cost from bespoke investigation into routine work. The core model is compelling precisely because it removes freedom in the places where production applications most often become inconsistent.
