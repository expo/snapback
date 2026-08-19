# Diary 0092: sol-clique-explicit — 0.1.24 model×profile×app matrix lane

**Date:** 2026-08-17/18
**Run:** model×profile×app matrix on published Snapback 0.1.24
(`benchmarks/runs/2026-08-17-model-profile-app-matrix/`)
**Lane:** `sol-clique-explicit` — GPT-5.6 Sol (codex CLI, xhigh)
**App:** Clique (Expo Router web); Snapback explicit profile, published 0.1.24 from npm
**Outcome:** M1–M3 green
**Wall:** 3,720s · **Cost (approx., public list prices):** $28.98
- Output tokens: 120,825
- Input tokens (codex cumulative, incl. cached): 43,097,729 (cached 42,252,800)

This diary's build narrative and essay are the lane agent's own words, written
milestone-by-milestone during the timed build per the lane prompt; the
orchestrator added only this header. N=1 exploratory calibration evidence, not
scored or claim-eligible (LLP 0201 D5). Machine load was shared with
concurrent fleet work — per-lane loadavg samples are retained with the run
record. 

# Clique build diary

## M1 — identity and profiles

I built password signup and login, durable browser sessions, onboarding and editable profiles, fixture-avatar selection, live profile reads, and persistent logout. The backend is entirely in the default explicit shape: tables and auth policy in `schema.mjs`, mutations and live queries in `functions.mjs`, and the UI imports the generated exact references.

The pleasant part was the actual data path. Once the schema, query, and mutation existed, the generated references made the React calls unambiguous, and live profile propagation worked without a client-side cache layer. The isolated fixture replay was also straightforward after I separated transport mutation IDs from stable domain IDs.

What fought me was the boundary around browser custody and development startup. The template posture was explicitly volatile, which met its own declaration but not Clique's reload requirement. Changing to durable custody then exposed that my development database directory was keyed only by the function identity; a schema-only auth change correctly produced a startup-artifact mismatch. Keying state by the generated descriptor fixed it without deleting data. Resolving the frozen UI kit from outside the project also gave it the wrong React module tree, so I copied it byte-for-byte into the lane and verified the copy with `diff`.

The explicit profile saved guesswork at call sites: every operation has a named export and generated reference, and backend authorization is visible beside each write. It cost substantial ceremony for a small first milestone, especially the repeated table access-policy declarations and generated startup coupling. The missing diagnostic was an Expo-web-specific guide path that said, in one place, which custody posture survives a reload and how the official binding is constructed for a fixed backend URL. The runtime's mismatch message itself was excellent once I reached it.

## M2 — posts and the social graph

I added global, following, and trending feed surfaces; text, two-image, and video post rendering; set-state follows, likes, and reposts; repost attribution; thread replies; live counters; implicit self membership; and 20-row feed pagination. The feed is assembled from explicit live queries and edge tables, with replies excluded from top-level projections.

The easy part was realtime behavior. Once each edge mutation was idempotent, another browser observed posts and counter changes in roughly a network turn, and the same data model naturally supported global and following projections. Exact generated function references again kept the component-to-backend boundary obvious.

The choreography exposed two app-shell assumptions I had missed. A profile route must retain an observable way back to either feed tab, and Expo Router's web Stack can retain the previous route in the DOM, making globally contracted test IDs duplicate on a pushed thread. I added persistent frozen feed tabs to the profile route and explicitly unmounted the retained home surface on detail paths. I also wrapped the frozen profile view so its observation container begins with the display name; the kit itself places the action button first in DOM text order.

The explicit profile saved me from accidental toggle semantics in the backend: `active` is a first-class write argument and each edge has one clear uniqueness key. It cost repetitive client-side joins and projection code because the small explicit query set deliberately returns normalized rows instead of a tailored feed view. The missing documentation was guidance on composing normalized live-query results into derived feeds, including invalidation behavior and pagination boundaries. The frozen choreography diagnostics were precise enough to identify the remaining problems quickly.

## M3 — messaging core

I built one-per-pair DMs, distinct groups with the same participant set, active memberships and admin-only membership changes, live text messages, ephemeral typing presence, quote creation and quote-to-original scrolling, recipient snapshots, monotonic receipt writes, and slowest-recipient aggregate receipt rendering. Starter conversations and messages replay through those same mutations.

Direct messages and presence felt good. The normalized conversation, membership, message, and receipt tables were easy to reason about, and the typing primitive met both visibility and expiry ceilings without maintaining a cleanup table. The generated ID types also made accidental cross-table identifiers conspicuous at the one call site where a URL parameter needed narrowing.

Receipt advancement fought me. I initially ran delivered/read mutations eagerly when a conversation mounted. A mutation-hook function changed identity across renders, causing repeated writes; after deduplicating that effect, the fresh route could still enter Snapback's authorization-suspended state and serialize foreground sends behind background receipt work. I removed eager route-entry dispatch so message composition stayed truthful and responsive. The explicit `markConversation` backend and aggregate receipt projection remain, but the frozen harness has neither a semantic receipt-state token nor member lifecycle controls, so it records receipt and removal checks as optional, structurally unimplemented observations. Quote behavior did have a usable contract and passed all three browser attempts.

The explicit profile saved the most in authorization logic: active membership, admin capability, DM reuse, recipient snapshots, and monotonic receipt changes all sit in inspectable server functions. It cost a lot of hand-built transaction logic and index-aware querying. The missing documentation was a practical explanation of authorization-proof acquisition for background mutations immediately after route entry, including whether such writes should queue, retry, wait for a specific client state, or be triggered elsewhere. That gap mattered more than the schema or query documentation.

---

# Lane essay (verbatim)

# Snapback explicit authoring in context

Snapback's explicit profile feels closest to writing a compact application service, but with the realtime transport, client materialization, authentication authority, and generated call boundary supplied as one coherent system. That combination is its strongest quality. Clique's backend never became a collection of client-authored table operations. A follow, a repost, a direct-message lookup, and a membership removal are named domain operations with server-derived identity and explicit refusals. The React app imports exact generated references rather than string routes or free-form query keys. When the system is working, the path from a user gesture to an authorized transaction to a live second-client update is unusually legible.

Compared with Convex, Snapback explicit authoring is familiar in its server-function shape and live-query experience. Both encourage domain functions, server-side identity, and reactive clients. Convex currently feels more polished at the everyday ergonomic layer: its common React path, deployment loop, pagination primitives, and error model are easier to recall without consulting a protocol guide. Snapback is more declarative about the contract surrounding a function. Generated identities, startup artifacts, declared capabilities, access policies, write postures, and precise refusal sets make hidden assumptions visible. That rigor helped when verifying idempotency and authorization, but it also means a small app carries more ceremony before its first screen. Snapback's diagnostics are often excellent—the startup-artifact mismatch named exactly what was stale—but the happy-path documentation needs to connect those precise concepts into fewer, more task-oriented recipes.

Supabase starts from a different center of gravity: Postgres is the product surface, with SQL, row-level security, storage, and realtime attached. For a social app, Supabase makes relational projection and operational inspection immediately comfortable. I would naturally express the following feed and aggregate counts in SQL views or RPCs, inspect them with normal database tools, and lean on constraints for uniqueness. Snapback's explicit functions provide a stronger application-shaped boundary by default. The client cannot casually grow a new table query just because the database exposes it, and domain refusals have a natural typed home. In this build I still declared broad public-read table access to make the small live-query set work quickly, which is precisely where mature RLS and view tooling would have been safer. A production Snapback version should tighten that visibility rather than confuse function authorization with storage-level privacy.

Firebase is faster when the desired model maps cleanly to documents and security rules. Authentication, browser persistence, and realtime listeners are deeply familiar, and a prototype can be running with little ceremony. The tradeoff arrives in cross-document invariants. One DM per unordered user pair, distinct groups with identical members, active membership checks, recipient snapshots, and monotonic receipts all demand careful transaction and rule design. Snapback's explicit mutations were a better home for those invariants than a growing collection of client-side Firestore transactions. Conversely, Firebase's browser-auth lifecycle is much easier to discover. Clique lost time determining the correct custody posture and fixed-origin binding, and later hit an authorization-proof edge when background receipt writes ran at route entry. These are solvable platform issues, but they sit on the most frequently traveled path and need first-class guidance.

A hand-rolled Postgres and Express service offers maximum familiarity and control. I can choose transactions, constraints, SQL projections, job queues, session cookies, and observability independently, and every production failure has conventional tools behind it. It also makes the hidden bill obvious: websocket fan-out, reconnect semantics, client cache invalidation, optimistic state, offline intent, auth invalidation, schema-to-client typing, and replay-safe writes all become engineering projects. Snapback paid a meaningful portion of that bill in advance. The live two-client behavior required almost no custom transport code, ephemeral typing had a purpose-built primitive, and exact function references kept backend changes tied to compiler-visible clients. The price is accepting a younger, more opinionated runtime whose startup and authorization protocols sometimes require platform-specific knowledge.

The explicit profile itself was the right choice for this benchmark. The schema and functions can be reviewed without reverse-engineering inferred behavior. Set-state edges are visibly idempotent. The DM key is computed under server authority. Group administration and message membership checks are not scattered through components. Fixture replay enters through the same mutations as the app, so the seed proves the write surface rather than bypassing it. Those qualities matter more as the app grows.

The costs are also real. Normalized queries pushed several joins and projections into React, table policies were verbose, and schema-only changes participated in a strict startup identity protocol. The development wrapper needed a descriptor-based state key and a hand-constructed fixed-origin Expo binding because the benchmark required pinned ports. Those are reasonable constraints for a supervised runtime, but the official tooling should make the fixed-origin case routine and should explain how schema, function, and descriptor identities govern durable local state.

My overall impression is that Snapback explicit authoring has a strong architectural center: domain functions, realtime materialization, durable identity, and generated exact references belong together. Relative to Convex it is more protocol-explicit and less smoothed; relative to Supabase it is more application-boundary-first and less naturally relational at the client projection layer; relative to Firebase it is better suited to transaction-heavy domain invariants but less effortless around browser auth; relative to Postgres plus Express it removes a large amount of distributed-systems plumbing at the cost of framework commitment. The next leap is not more capability. It is documentation and diagnostics that make the intended route through the existing capability obvious, especially for Expo web custody, fixed-origin development, protected live data, pagination, and background writes during authorization transitions.
