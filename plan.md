# Snapback 2 elegance program — plan and rulings (2026-09-08)

## Commission (the author, 2026-09-08, verbatim)

> - Give the client a plain tier: data | undefined plus status, a run that never throws, one refusal shape, one status vocabulary, ResultOf, and a page hook. Keep the truthful axes as opt-in. Measure it by the thread screen fitting in 60 lines with no LLP citations.
> - Pick one spelling each for absence, maintained reads, and index naming. Document or delete walk. Freeze the word count.
> - Rewrite the chat template as a product: one thread, one send, a real effect body, tests without inline binaries. Then run Clique cold again.
> - Fix the missing-bound diagnostic, purge the stale families, add did-you-mean, and make why speak in prose.
> - Dedupe the range store across entries and stop raising the byte ceiling.

Everything below the commission is the orchestrator's delegated ruling (the same standing as the
2026-09-06 delegated decisions in `rules/NOT-DOING.md`), recorded in the LLP each lane names at
landing. Base commit for every lane: `3062777ab` (origin/main, 2026-09-08 ~16:00 local).

## Evidence the rulings rest on (verified on the base commit)

- `snapback2 init --template chat --client react`, then `check` 0.54 s, `doctor` 0.05 s, `test` 30 checks / 14 s (29 pass, effects blocked without the engine). The loop is fine; the surfaces are not.
- `templates/chat/react/src/Thread.tsx` is 94 lines, imports five hooks, carries seven `@ref` comments citing five LLPs, narrows on `itemsFrom === "query"`, copies an `authGeneration` guard, and needs both a result branch and a `catch` per mutation because `run()` returns `rejected` AND throws `SnapbackRefusal`.
- The template reads a maintain two ways with two meanings: `messageCount: messageCounts[conversationId]` (row or null; `api.d.ts` says `MessageCountsRow | null`) and `count: #messageCounts[conversationId]` (typed zero).
- Absence has five spellings (`!`, `! else CODE`, `??`, `match some/none`, `if x != null:`); `match` is used only in two compiler fixtures; `#` appears in 12 `.q` sites; the `by column` shorthand in 3; `walk` parses, is exercised by `packages/compiler/fixtures/quarry-surface/snapback/surface.q:26` and `api-shape-checks.ts:118`, and is in no grammar bullet.
- Two `thread` queries (`messages.thread`, `deliveries.thread`), `send` vs `post`, `photo: null, clip: null` spelled in `send` and omitted in `post`; `delivery.ts` is a checker fixture (identity function, `[x].map(function keep…)[0]`, rethrowing `catch`, unused import); `chat.test.ts` carries ~60 lines of inline MP4/JPEG byte-poking.
- `posts[]` without a bound reports "no unique index on posts matches []" listing only `byId`; `memberships[p]` reports "matches [?]"; `authorid` gets no did-you-mean; ~40 of 94 `families.source.json` examples show the deleted TypeScript surface as the right answer; `E_OWNER_PROJECT_ROOT` still mentions `schema.ts`; `E_INPUT` repeats its code in its message; `why` prints the raw authoritative trace (digests, `hoist`, `prefix_template`) with no sentence.
- `dist/` gzip -9: `client.mjs` 109,753; `react.mjs` 37,394 (was 10–11 KB on Sept 4–5); `expo.mjs` 40,517 — `applySwap`/PersistentRangeStore is bundled into all three because `build.mjs` externalizes only `client`/`react-core`. Complete local runtime (five roots) 83,999 vs an 84,000 ceiling raised six times in three days (34k→50k→66k→82k→82.5k→84k); target 80,000 never met.

## Lanes

| lane | worktree | branch | owns |
|---|---|---|---|
| C template | `~/projects/snapback-s2-c` | `s2/el-template` | `snapback2/packages/snapback2/templates/chat/**` (backend `.q`, effect, seed, tests; screens only for mechanical op renames), `snapback2 dev` URL file, LLP 1002 template record |
| E bytes | `~/projects/snapback-s2y` | `s2/el-bytes` | `snapback2/packages/snapback2/build.mjs`, `snapback2/scripts/measure.mjs`, `metrics/twin.jsonl`, `rules/NOT-DOING.md` ceiling paragraph, LLP 1012 allocation note |
| D diagnostics | `~/projects/snapback-s2v` | `s2/el-diag` | compiler diagnostics (`packages/compiler/src/quarry/*` messages), `guide/families.source.json`, `check` printing, `why` (crates/snapback2), LLP 1002 |
| B quarry | `~/projects/snapback-s2-quarry` | `s2/el-quarry` | Quarry grammar (`packages/compiler/src/quarry/**`), evaluator/engine parity for maintain reads, corpus, fixtures, guide grammar/quarry pages + `guide.rs` pins, every `.q` in the repo, LLP 1011 |
| A1 client SDK | `~/projects/snapback-s2-a` | `s2/el-client` | `snapback2/packages/snapback2/src/**`, `types/`, package tests, `templates/todos`, `templates/react`; chat screens only mechanically to keep them compiling; LLP 1018.003 |
| A2 chat screens | (after C and A1 land) `~/projects/snapback-s2-pay` | `s2/el-screens` | `templates/chat/react/src/**`, `templates/chat/expo/src/**`, `templates/chat/shared/**` |

Landing order: C → E → D → B → A1 → A2 → publish `0.0.20` → Clique cold rerun (snapback2 × astra/grok/muse, scored by the same three).

## Rulings

### A. The plain tier (LLP 1018.003 revision, "the plain tier")

A1. `useMutation(op).run(args)` never throws. `MutationResult` stays `committed | queued | rejected`. `rejected` is `{ state: "rejected" } & Refusal` whether the cause was a program `require … else CODE` (family `rule`, `code` = the CODE), a platform refusal (its family), or a transport failure (family `transport`, code `E_TRANSPORT`, `retryable: true`). The thrown `SnapbackRefusal` class and `isSnapbackRefusal` leave the public surface; no ordinary path on `snapback2/react` or `snapback2/client` throws. The headless client's `mutation()` returns the same union; `query()` returns the wire union (never throws either: transport failures are `{ state: "refused" }` with the same `Refusal` fields).
A2. One refusal shape: `Refusal = { code; family; message; rewrite?; guide?; site?; rule?; retryable?; reason? }`. `RefusalEnvelope` is renamed `Refusal` (delete the old name). `Snapshot.refusal?: Refusal`. No second envelope type anywhere in `src/`.
A3. One vocabulary: `state` is a verdict (the server's, or the twin's) on an answer or a write: `complete | capped | partial | denied | refused` for reads, `committed | rejected | queued` for writes. `status` is a hook's lifecycle: `loading | ready | unavailable`. Therefore `receipt.outcome` becomes `receipt.state`; the word `outcome` disappears from `src/`. One action set for "what can the user do": `Action = "sign-in" | "connect" | "other-tab" | "wait" | "none"`; `OutboxStatus.action` uses it (`login`→`sign-in`, `resume`→`connect`, `load-program`→`connect`), `Readiness.action` uses it. `createClient({ persona })` and `<SnapbackProvider persona=…>` replace `as` (the test runner's `as("alice")` verb stays; the CLI `--as` stays).
A4. Plain reading of a snapshot: `data`, `status`, `reason`, `items` (when bound), `next` (the continuation cursor, hoisted from the receipt; `null` when there is none), `partial: boolean` (true when `items` come from declared history rather than the observed query). `data` is `undefined` whenever the observed composite is not usable, so no screen reads `itemsFrom`. The truthful axes (`receipt`, `freshness`, `local`, `refusal`, `history`, `itemsFrom`) remain on the snapshot, documented as the opt-in tier on `guide/live-query.md`. Query args omit the cursor: `useQuery(api.messages.inbox, {})` is the paved form; `{ c: null }` still works; items bindings treat a missing and a null cursor the same.
A5. `usePage(op, args, options?)` for ops whose result is an array: `{ items, pages, loadMore(), hasMore, status, reason }`; each page is its own live query keyed by the previous page's `next`; the cursor argument is `c` unless `options.cursor` names another; pages reset when args change. Exported from `snapback2/react` (and the native entry).
A6. `ResultOf<Op>` and `ArgsOf<Op>` exported from `snapback2/client`; templates use them; the `__result` phantom-inference hack in templates is deleted.
A7. `useMutation` returns `{ run, inFlight, last, can }`; the SDK clears `last` when the client's auth generation changes or the hook's op changes, so a screen renders `last` inline and app code never holds a generation guard. `useSnapbackSnapshot().authGeneration` stays available (truthful tier) but no template imports `useSnapbackClient` or `useSnapbackSnapshot`.
A8. Public surface: `snapback2/client` no longer exports `Coverage, HeldAnswer, HeldProgram, OverlayRow, StoreSwap, LocalAnswer, Prediction, PartialSite` or `SnapbackClient.sharedConsumers()`; `useSubscription` is deleted (it was an alias); `client.subscribe` becomes internal and `client.observe` is the one read API. Internal modules import from source paths. Anything a witness or `snapback2/test` still needs is re-exported from a `snapback2/internal` entry that the guide never mentions — the lane lists what and why.
A9. Expo parity: the Expo template uses `<SnapbackProvider url persona offline>` from `snapback2/react-native` with the same props as web; no `useEffect`/`useState<SnapbackClient>` client construction in app code.
A10. Bytes: the five-root complete local runtime (`build.mjs --measure-twin`) must not exceed its base-commit value (83,999) after this lane; the deletions in A1/A2/A8 pay for `usePage`. Report before/after.
A11. Done means: `templates/chat/react/src/Thread.tsx` ≤ 60 lines and `templates/chat/expo/src/screens/Thread.tsx` ≤ 60 lines (lane A2), each with zero `@ref` comments, no `useSnapbackClient`/`useSnapbackSnapshot` import, no `catch`, no generation guard; witness `data-*` attributes may move into a tiny `witness.ts` helper. Every template file has zero `@ref` comments.

### B. Quarry spellings (LLP 1011 revision, "one spelling")

B1. Absence. `x ! else CODE` is the one must-exist spelling; a bare `!` is refused with the rewrite. `match … some/none` is deleted (parser, binder, lowering, printer, guide, `guide.rs` pin, the two fixtures rewritten to `if`). `if x != null:` / `if x = null:` is the one branching spelling, and it narrows: the else branch of `if x = null:` (x non-null), the right operand of `and` (`x != null and x.body = body`), and the rest of the block after `require x != null else CODE`. `??` stays (defaulting is not absence branching). Ordered comparison on an optional still refuses until narrowed.
B2. Maintained reads. A point read of a maintain, `messageCounts[conversationId]`, yields the typed value with typed zero when absent; that is the only form in a program. `#` is deleted for maintains and for `connected` (`connected[p]` yields the int count; `exists connected[p]` stays). `api.d.ts` types the read as the value (`number`), never as a row. The `data` verb and rules still see maintain rows.
B3. Index naming. Every index is declared with its name: `by name: columns`, `unique name: columns`. The `by column` shorthand and unnamed `unique a, b` are refused, the rewrite spelling the inferred name (`by byOwnerId: ownerId`). Resolution at a read is unchanged: implicit by key types/arity when exactly one index matches, `by name` otherwise.
B4. `walk table[seed] up .column depth N` stays, with its grammar bullet, its `guide.rs` pinned definition, and one sentence on `quarry.md`.
B5. Freeze. A compiler test pins the complete inventory of significant words (declaration, table-body, rule, statement, range, builtin, type, modifier words — everything the lexer or binder gives meaning to) as one sorted literal; the grammar page's construct count stays pinned (23: minus `match`, plus `walk`). Adding a word means editing the literal and writing the one-line why in `rules/NOT-DOING.md` § Moves.
B6. Every `.q` in the repository (templates, corpus, fixtures, guide snippets, benchmarks) follows B1–B3; corpus regenerated; diagnostics families that mention `#`, `match`, or the shorthand updated; byte budgets respected (deletions free bytes; raise none).

### C. The chat template as a product (LLP 1002 revision, "templates are products")

C1. One module per concern: `schema.q` (tables), `access.q` (fns + `proc deliver`), `messages.q` (`thread`, `conversationView`, `inbox`, `search`, `send`, `sendPhoto`, `sendClip`, `sendOncePhoto`, `edit`, `unsend`, `purgeMessage` + `schedule expireMessage`), `groups.q`, `profiles.q`, `feeds.q`, `posts.q`, `follows.q`, `notifications.q`. `deliveries.q` is deleted. `thread` reads the delivery log (one event per live message, `withHistory` fallback for declared partial custody); `conversationView` is the composite (page + count + preview). `send(conversationId, body, expiresAt?)` is the one text send: insert, `deliver`, then `emit notify` to every other member. The old `messages.thread` over messages, `summary`, and `send(recipientId)` are deleted.
C2. Rows are returned, not rebuilt: `insert` yields its row, so `createMyProfile`, `updateMyProfile`, `setFollow`, `createPost` return the row. Optional columns are omitted, never spelled `null`.
C3. `delivery.ts` is a plain effect: build the request, `fetch` it with the idempotency key, return `{ providerId }`; `then: recordNotified`. A two-line comment at the top says the grant names your provider. No unused imports, no rethrowing `catch`, no identity helpers.
C4. Tests read fixtures from files: `snapback/tests/fixtures/photo.jpg` and `clip.mp4` (real tiny files, committed), loaded in the journey. If the journey runtime forbids `fs`, `snapback2/test` gains `fixture(name)` (relative to the test file). No byte literals in the template test.
C5. Zero `@ref` comments in any template file. A gloss a builder needs becomes a plain one-line comment; the rest is dropped (the LLP already holds it).
C6. Screens: mechanical op renames only (`api.deliveries.conversationView/thread/inbox/edit/unsend` → `api.messages.*`; `api.deliveries.post` → `api.messages.send`); nothing else in `react/src`, `expo/src`, `shared/` (lane A2 owns the rewrite).
C7. `snapback2 dev` also writes the URL to `.snapback/dev-url` (one line, gitignored). The React template's `vite.config.ts` defines `import.meta.env.VITE_SNAPBACK_URL` from that file when the variable is unset, so `init`'s next-step line becomes `npm install && npx snapback2 dev && npm run dev`. The Expo template reads the same file through its `app.config`. The client contract is still `SNAPBACK_URL`; the server spawns and watches nothing.
C8. Seeds: if the engine requires `messageCounts: [], memberCounts: []` in `seed.ts`, keep them and note it in the report; do not change the engine.

### D. Diagnostics and `why` (LLP 1002 revision, "diagnostics say the fix")

D1. A table read used as a value with no range clause and no exactly-matching unique index is a missing bound, not an unknown index: message "`posts[]` reads a range; name its bound", rewrite listing every `by` index whose prefix matches the keys (`posts[] first 50 by byTime`) and any unique index that matches exactly. Key types print as declared (`[principal]`), never `[?]`.
D2. Did-you-mean: an unknown table, column, index, fn, proc, shape, op, enum case, or module name gets the nearest declared name in the rewrite (Damerau-Levenshtein ≤ 2 or a case-only difference): "unknown messages field `authorid` — did you mean `authorId`?".
D3. `families.source.json`: every `wrong`/`right` example is Quarry (or the CLI/TS harness surface where the family is about seeds, effects, journeys); an entry whose code can no longer be emitted is deleted along with its dead site. A compiler test asserts no example contains `db.`, `rule.`, `ctx.`, `t.text(`, `withIndex`, `.take(`. `E_OWNER_PROJECT_ROOT` drops `schema.ts`; no message repeats its own code.
D4. `check` never truncates a `message` or `rewrite` (the 120-character cut that caused four misdiagnosed loops in the Clique run); long lines wrap.
D5. `why` speaks: the default output is prose, `--json` is today's document. Shape:

```
messages.thread as charlie — denied (MEMBERSHIP_REQUIRED)
  messages.q:7   require isMember(conversationId, viewer) else MEMBERSHIP_REQUIRED
    memberships[conversation-1, dev:charlie]   absent   (byConversationPrincipal)
```
and for an admitted read, per site: the rows examined and visible, the bound (`last 50 by byRecipientConversationKindAt`, `complete` or `capped`), the rule that admitted, then the subscriptions (table and index prefix). Sites map to `file:line` through the compiler's site table; when unavailable, the site id prints. The bounds and digests stay in `--json`.
D6. The prose format gets its paragraph on the guide page that documents `why` (within budget).

### E. Bytes (LLP 1012 allocation note; `rules/NOT-DOING.md`)

E1. `build.mjs` externalizes `snapback2/client` and every module reachable from it in `react.mjs`, `expo.mjs`, `react-native.mjs`, `react-core.mjs`, `test.mjs`, so the range store, twin, and offline runtime exist once, in `client.mjs`. Targets: `react.mjs` ≤ 12,000 gzip, `expo.mjs` ≤ 16,000 gzip; report every entry before/after. The templates still build (`vite build` for React; `tsc` for Expo) and the package tests and `scripts/witness-web.mjs` still pass.
E2. `measure.mjs` records `client_gzip_bytes`, `react_gzip_bytes`, `expo_gzip_bytes`, `runtime_gzip_bytes` (the five-root number) on every loop record, and `--check` fails when any grows more than 1% over the previous record (the pattern the file already uses); `--measure-twin` appends to `metrics/twin.jsonl` so it is never stale again.
E3. `rules/NOT-DOING.md`: the six ceiling moves collapse into one paragraph — 84,000 bytes gzip for the complete local runtime, 80,000 the target, frozen 2026-09-08 by the author's word; a feature that does not fit is descoped or paid for by deletion; one line keeps the history (34,000 → 50,000 → 66,000 → 82,000 → 82,500 → 84,000). LLP 1012's allocation section gets the same one-line freeze.

## Process

Each lane: implement (codex gpt-6-astra xhigh, detached) → orchestrator verifies out of sandbox → commit → two blind reviews (grok-4.6 xhigh, codex gpt-6-astra xhigh read-only) → ≤ 3 fix rounds → land (`land.sh merge|verify|push`). Guide byte budgets and `guide.rs` pins are checked with `node build.mjs` after the FINAL merge. `metrics/loop.jsonl` merges by union. Reviews cite `path:line`; agreement across families is signal, a single-family finding is a hypothesis.

## Decisions during execution

- 2026-09-08 16:45 — **Main is over its own ceiling.** On the pinned toolchain (Node 24.18.0, esbuild 0.25.9, gzip 9) the base commit's complete local runtime measures **84,080**, not the 83,999 LLP 1018.003.001 recorded (the two channel landings after `85b1f3080` added bytes; `--measure-twin` is not in `test.sh`, so nobody saw it). Under the freeze the 80 bytes are paid by deletion, not by a seventh ceiling. Lane A1 pays (its export trim and refusal-shape merge); if its report lands above 84,000 a focused fix round shaves the five-root runtime. Lane E's `measure --check` now runs `--measure-twin`, which throws over the ceiling, so **E lands after A1** (order: C → D → B → A1 → E → A2), never turning main red on its own.
- 2026-09-08 16:45 — Lane E appended three identical `twin.jsonl` records for the base sha while iterating; the landing commit keeps one.
