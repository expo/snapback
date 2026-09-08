# Lane A1 — the plain tier (SDK)

Worktree: `~/projects/snapback-s2-a`, branch `s2/el-client`, base `3062777ab`.
Rulings: plan.md § A (A1–A10; A11 is lane A2's measure, but every SDK piece it needs lands here).
LLP to revise: `llp/1018.003-truthful-and-composed-client.decision.md` (new section "The plain
tier", dated 2026-09-08; the header's "elegance target remains unmet" sentence stays until A2).

You own `snapback2/packages/snapback2/src/**`, `types/`, `package.json` exports, the package
tests under `tests/`, `templates/todos/**`, `templates/react/**`, the guide pages
`live-query.md`, `offline.md`, `personas.md` where they document the renamed or removed surface,
and LLP 1018.003. In `templates/chat/react/src`, `templates/chat/expo/src`, `templates/chat/shared`
make only the mechanical edits the renames force (field/option/import names) so the template
compiles and its journeys pass — lane A2 rewrites those screens next on top of your SDK.

Order of work:

1. Read `src/types.ts`, `src/snapshot.ts`, `src/react-core.tsx`, `src/client-mutations.ts`,
   `src/client-items.ts`, `src/index.ts`, `src/react.tsx`, `src/react-native.tsx`, `src/expo.ts`,
   and the chat template screens (as consumers). Measure the base: `node build.mjs --measure-twin`
   (expect 83,999) and gzip -9 of `dist/client.mjs`.
2. A2 + A3 — the renames: `RefusalEnvelope` → `Refusal` (one shape, fields per the plan);
   `receipt.outcome` → `receipt.state` (the word `outcome` leaves `src/`); one `Action` type for
   `OutboxStatus.action` and `Readiness.action` with the plan's mapping; `as` → `persona` on
   `createClient` and `SnapbackProvider`. Grep the repository (`packages/snapback2`, `scripts/`,
   `templates/`, `tests/`, guide pages) and update every consumer; nothing keeps the old name.
3. A1 — `run()` never throws: transport failures and thrown refusals become `rejected` with
   family `transport` / their own family; delete the `SnapbackRefusal` class and `isSnapbackRefusal`
   from the public surface (if an internal path still needs a throw, keep it internal and catch it
   at the hook/client boundary). The headless `client.query()` returns `{ state: "refused" }` with
   `Refusal` fields on transport failure. Tests: a mutation against a closed port resolves
   `rejected` (family `transport`, `retryable: true`); a `require … else CODE` rejection has
   family `rule` and `code === "CODE"`; nothing rejects the promise.
4. A4 — snapshot plain fields: `next` hoisted (null when none), `partial` boolean, `data`
   undefined whenever `itemsFrom !== "query"`; a missing cursor arg equals a null one for
   `useQuery` and items bindings (`belongs` in the template's `shared/thread.ts` uses `== null`
   today in one place and `=== null` in another — make the SDK normalize so both bindings can say
   the same thing). Tests for each.
5. A5 — `usePage(op, args, options?)` per the plan, exported from `snapback2/react` and the native
   entry; a package test with a scaffolded backend that pages `messages.search` or `inbox` twice
   and sees live updates land on the first page.
6. A6 — `ResultOf<Op>`, `ArgsOf<Op>` in `snapback2/client`; replace the `__result` phantom hacks in
   `templates/chat/*/src/Inbox.tsx` (mechanical) and anywhere else.
7. A7 — `useMutation().last` cleared on auth-generation change and on op change (test: sign in as
   another persona after a rejected run; `last` is undefined).
8. A8 — the public surface trim exactly as the plan lists; `useSubscription` deleted;
   `client.subscribe` internal; `client.observe` the one read API. Add `snapback2/internal` only if
   `snapback2/test`, `scripts/witness-web.mjs`, or the Expo witness needs a symbol; list each.
9. A9 — the Expo `SnapbackProvider` accepts `url`/`persona`/`offline` and builds the client itself
   (StrictMode-safe, deferred close, like web); the Expo template's `App.tsx` drops its
   `useEffect`/`useState<SnapbackClient>` construction (mechanical).
10. Guide pages: `live-query.md` documents the plain fields first and names the truthful axes as
    the opt-in tier; `offline.md`/`personas.md` follow the renames; budgets respected.
11. A10 — `node build.mjs --measure-twin` ≤ 83,999; gzip of `client.mjs` reported before/after.
12. `scripts/test.sh` green; the chat template's `test` receipt unchanged or better; LLP 1018.003
    revised; `REPORT-client.md` with the export diff (`snapback2/client` and `snapback2/react`
    public names before/after), the byte numbers, and every consumer file you touched.

Out of scope: the chat screens' shape (A2), `build.mjs` externals (lane E — do not touch the
bundling config; if the measurement needs a change, say so in the report), Quarry (lane B).
