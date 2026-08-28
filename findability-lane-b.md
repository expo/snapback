# Findability lane B — live queries, authority, and application patterns

Date: 2026-08-27

The six rows now route from one exact failed-agent phrase apiece. Each
retrieval-eval case has no generic fallback term: its only Route term is the
quoted lane language below. Answer-side names, APIs, repairs, and honest gaps
remain in Required guidance and on the destination page.

| Row | What is routed | Failed vocabulary used | Case |
| --- | --- | --- | --- |
| O15 | `guide/backend/query-costs.md` now routes causal-join searches to the shipped client/subscription/server-wave join, covers Explicit and Familiar clients, and states that originating-mutation → committed-version correlation and one backend-spanning receipt do not ship. | “single trace that connects the hook, current authority generation, mutation admission, server commit, invalidation publication, and subscriber revision” | 114 |
| O17 | `guide/recipes/provider-lifecycle.md` routes blocker-attribution searches to the shipped ownership/barrier state and repair, while stating that conflicting owner/operation/authority-generation attribution is missing. `guide/recipes/multi-persona-clients.md` now says plainly that it is Node actor isolation, not a same-principal browser multi-context recipe or proof. Both authoring profiles are covered. | “which provider operation stranded which hook” | 115 |
| O19 | `guide/backend/mutations.md` routes the stalled direct-route/profile-query symptom to the shipped `startDirectMessage` open-by-natural-key operation, `queue: false` settlement, and repeated-open idempotence. The shipped worked example is Explicit; the same one-mutation shape is identified for Familiar, with no maintained Familiar equivalent claimed. | “Alice1 direct-route bootstrap still intermittently waited on a same-principal profile live query” | 116 |
| O20 | `guide/realtime/live-queries.md` now routes remove/disappear-then-navigate searches to the profile-neutral composition: persist intent synchronously, resume the idempotent operation at the destination, and gate the next authority-sensitive action on a server witness. It states that no `settledNavigation` helper ships. | “Router-navigation recipe for settled mutations that must survive page replacement” | 117 |
| O22 | `guide/start/expo-chat.md` now supplies the missing journey from profiles through graph, feeds, roles, media, offline, aggregates, and schedules. It says that no maintained end-to-end relational-social recipe exists and scopes the template to Explicit; Familiar is routed to its own handler dialect and the same normalized boundaries. | “short, product-shaped path from that chat to the canonical social schema” | 118 |
| O24 | `guide/recipes/optimistic-create.md` is the composite entry route for sender echo/canonical reconciliation, durable offline settlement, and cross-surface convergence. It states plainly that no single maintained messaging-convergence recipe/proof exists and that current receipts are client-authored acknowledgements, not server-observed fetch. The client reconciliation route covers Explicit and Familiar generated references. | “same-account live messaging, cross-device unread clearing, and dual-client offline convergence” | 119 |

## Verification

- `node scripts/check-retrieval-eval.mjs` — passed: 118 parsed cases, 5 Rosetta records, 0 errors.
- Guide link/anchor scan using the same `guide-lib.mjs` link and renderer-anchor functions — 0 link errors; both newly referenced fragments resolve and are unique.
- `./ref-check` — passed: 326 LLP documents, 6,908 refs in 13,136 files, 0 errors, 0 unchecked.
- `git diff --check` — passed.

## Regeneration handoff

Regeneration is needed because authored Guide pages and
`guide/retrieval-eval.md` changed. Per lane constraints, this work did not edit
`guide/*.generated.md`, `guide/guide-manifest.generated.json`,
`guide/reference/diagnostics-registry.json`, or any `guide/reference/*` file.
The supervisor should regenerate the Guide manifest and whole/section flat
projections once over the integrated tree.
