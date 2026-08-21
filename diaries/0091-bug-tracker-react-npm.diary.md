# Diary 0091 — Bugboard React npm starter

**Date:** 2026-08-17
**Demo:** `demos/bug-tracker/`
**Surface:** React 19 + Vite 8, Snapback npm `latest` (`0.1.24`)

## 2026-08-17 — From the public starter to a live bug tracker

The packet-first workflow was effective. Reading the React start packet, then
the scaffold's named edit targets, was enough to get from a blank directory to
the first data model without opening the broader guide corpus. The only deeper
lookup was for a patch mutation; `snapback guide patch` pointed directly to the
declarative-plan page, whose `patch(...)` and `returnChangedCount()` example
mapped cleanly onto `updateBugStatus`. This was a good agent-facing shape: one
question produced one relevant page.

The public npm path was also pleasantly concrete. The registry's `latest` tag
resolved to `0.1.24`; `snapback new ... --template react` produced a complete
Vite app, sessions-capable boot, seed, generated backend, carrier kit, and a
registered live acceptance profile. The app pins all five Snapback packages to
that exact version. Turning the todo into Bugboard required one table, one live
query, two declarative mutations, and one generated API import in the client.
No REST endpoints, websocket ownership, cache invalidation, or client-side
schema duplication appeared in app code. Create and status changes arrived in
the existing `useSnapbackQueries` result through the live subscription.

The strongest part of the experience was the done-oracle. After the one-time
`snapback runtime-qualify --persist` remediation named by
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, `bun run prove` passed in under two
seconds. It exercised a fresh SQLite server, anonymous readiness, password
signup and restoration, sign-out, generated artifact identity, the live bug
query, bug creation, and an observed status change. Adding the third product
path to the starter acceptance was straightforward, although the aggregate
receipt correctly reports read/write provenance as unsupported rather than
overclaiming complete conformance.

Two scaffold papercuts interrupted an otherwise smooth loop. First, a fresh
React template did not pass its own `bun run typecheck` after install: Vite 8's
types require Node declarations and ESNext disposal types, while the scaffold
had neither `@types/node` nor an appropriate `lib` entry. The demo adds both;
the reusable template bug is tracked in
`issues/20260817-react-template-typecheck-node-types.md`. Second, codegen emits
`SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING` for both ordinary public plan
writes. The warning is explicit and non-blocking, but it creates uncertainty
for a first-time author because the app has no alternative posture to choose
yet.

The generated branded row ID caught a real client mistake at typecheck time:
the first status helper accepted a plain `string`, while
`updateBugStatus` requires `Id<'bugs'>`. Deriving the helper parameter from the
live query row preserved the generated boundary without a cast. Likewise, an
exact symbol lookup clarified that connection state is `live`, not the more
generic `connected`. These are examples of Snapback's explicit types adding a
little ceremony while preventing drift at the client/backend seam.

Compared with React plus Convex, the client experience is familiar—generated
references, a reactive query, and mutation hooks—but Snapback asks for more
explicit result contracts, visibility, runtime qualification, and proof
registration. The benefit is a more reviewable write plan and a single receipt
that binds runtime readiness, generated identity, capability resolution, and
the live journey. Compared with Supabase, the Snapback version avoids hand-made
table types, realtime channel setup, and cache reconciliation; Supabase would
likely feel faster for the first insert, while leaving more of the end-to-end
proof and subscription lifecycle to the app.

TypeScript, lint, static coherence, production build, inventory, and the
registered Snapback proof all passed. In-app visual browser QA was attempted
but the browser-control runtime could not initialize in this session
(`Cannot redefine property: process`), so this diary does not claim a visual
or narrow-viewport browser pass. That tooling failure was outside the
Snapback/Vite application and did not affect the live headless acceptance.
