# Lane EX — integrated social starter and client recipes

2026-09-28. Branch `sb4-intent/ex-social-example`, worktree
`/home/ccheever/sb4-intent/lane-ex`. Nothing pushed or published.
Implementation commit: `fcaeaa90b718171c3c1fe105674c9764f4040e3c`
(`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`).

## Integration and scope

The first command was `git fetch origin && git merge origin/main`; it reported
`Already up to date.` Main was `80036b4664d0059a91ba5b19223a9e7e9fc6b70d`.
A second fetch/merge after the implementation commit reported the same.
OK, OS and EQ were not landed in that fetched main. The starter therefore
keeps the currently published like-summary and all-chat search recipes, with
explicit coverage/cost notes. Adopt their supported forms after integration;
this change does not claim their future capabilities.

The read-only `llp-orient` context pack covered the starter generator, client
contract, compiled guide and package tests. Governing documents are LLP 3000
(the Snapback 4 fence), LLP 2000.000 (shared interpreter and explicit residency),
LLP 3000.028 §4/§8 (integrated example and ownership recipes), LLP 3000.022 §2
(delivery reporting), LLP 3000.017 §2.4 (ephemeral lane) and LLP 3000.023 §3.2
(revalidation retention). The latter four are in `llp/current/`, not foundation.
The relevant current guide cards were read before authoring: app, client,
receipts, ephemeral, feeds, search, offline-interactions and assets. No core,
contract, meter, authorization, wasm or format changes were made.

## Delivered surface

- `snapback4 new <dir> --template social` uses the existing conflict-safe
  initializer and embeds every starter file in the published CLI. `init` and
  the previous starters retain their existing behavior.
- The Expo Router app has Following, chats, a conversation pinned to its URL
  ID, all-chat/per-chat search and profile screens; password and guest sign-in;
  profile/avatar, follow/unfollow, post/like, create/invite/leave/send flows.
- Its Quarry declares retained conversations and ordinary bare history,
  members, messages and receipt runs. `reports delivery` gives the SDK sole
  delivery-reporting ownership. Only foreground, navigationally visible,
  FlatList-visible settled rows supply application `seen` positions.
- `createApp` selects the browser/native replica and Expo Go's online tier.
  `useOnlineArm` borrows the current session bearer for typing without owning
  rotation. Session replacement closes that arm. `useTyping` owns observation,
  keystroke renewal and cleanup; idle/send/blur/background/disconnect/unmount
  stop it, expiry covers failed cleanup, reconnect needs a new keystroke.
- `OnceViewer` is above the transient history list. `useOnceMedia` fetches
  once on explicit open, owns the handle until close, revokes late results,
  and releases on identity reset. A second explicit open displays
  `E_ASSET_VIEWED`. It never persists once bytes or infers media authority
  from retained text.
- The conversation/composer survive loading, refused decorations, leave/rejoin
  and read replacement. Room/history explicitly select the SDK's bounded
  default retention. Membership and receipts withdraw immediately. There is
  no application cache of protected answers; IDs key rows; pending sends and
  posts come from `usePendingWrites`.
- `guide social` carries four executable TypeScript/TSX snippets directly
  from the installed starter files. The package README, guide listing, client
  card and CLIENT-AND-OPERATIONS card index point to it. The existing guide
  fact record names the expanded card list; no budget/assertion was relaxed.
  README remains **300/300 lines**.

The schema has 16 tables (14 synced) and 28 operations. Its four `check` notes
are intentional: `N_EPHEMERAL_SERVER`, `N_MAINTAIN_SYNCED`, and two
`N_SYNC_ORDER` notes for time-ordered searches beside ordinal-windowed history.
The starter explains those boundaries. `ownLikes` is PUBLIC and horizon-free,
including other viewers' keys; the census note gives calibration's 5,008 like
rows / 1,121,792 logical bytes. An unknown raw like never becomes false.
All-chat online search currently covers current memberships; offline held
search includes lawful retained holdings. Per-chat search already uses one
ordinary unguarded pinned body. Offline searches can be incomplete.

## Qualification

Commands run from `snapback4/` except root `ref-check`. Larger logs are retained
as gzip files with their complete output; no failure output is omitted.

| Check | Result / retained log |
| --- | --- |
| CLI build and generated `new`, `check`, `dev` | Pass; [build-final.log](./build-final.log), [social-check.log.gz](./social-check.log.gz); automated public-client smoke |
| Full generated Expo Router TypeScript + all four rendered guide snippets | Pass; `social-starter.test.mjs`, [affected-post-suite.log](./affected-post-suite.log) |
| Public-client smoke | Pass: profiles, Following backfill, likes, SDK delivery/read, typing expiry/offline drop/revocation, second once open, retained history/search and account isolation |
| React/browser recipe witnesses | Pass: controlled room/history/decoration interleavings plus real server typing/media; list remount, stable draft/focus, leave/rejoin, no duplicate IDs, close/late-result/second-open and account cleanup; zero page errors |
| Affected package tests including existing init recipes | **11 passed, 0 failed, 0 skipped**; [affected-post-suite.log](./affected-post-suite.log) |
| Whole guide | **92 passed, 0 failed**; [guide-post-suite.log.gz](./guide-post-suite.log.gz) |
| README budget and first-account screen | Pass, **300/300 lines**; [docs-budget-final.log](./docs-budget-final.log) |
| Installed dependencies, generated app `tsc --noEmit` | Pass; [social-install.log](./social-install.log), [export-typecheck-final.log](./export-typecheck-final.log) |
| Expo production web export | Pass, 861 modules; [expo-export-final.log.gz](./expo-export-final.log.gz) |
| Production Expo web app on installed npm client | Pass: guest, Following post, create chat, send, leave, retained text and stable draft; zero page errors; [expo-web-smoke-qualified.log](./expo-web-smoke-qualified.log) |
| References | Pass: **522 LLP docs, 9768 refs, 0 errors, 0 unchecked**; [ref-check-final.log](./ref-check-final.log) |
| Whitespace and source length | Pass; every new source file below 1,500 lines |
| `bash scripts/test.sh` | **`== 1 failure(s) in 1423 s`**, exit 1, category `cargo test`; run exactly once; [test-sh.log.gz](./test-sh.log.gz) |
| Post-suite discovery regressions | **7/7 server-opt-in**, **76/76 CLI check**, plus whole guide **92/92**; [guide-post-suite.log.gz](./guide-post-suite.log.gz), [check-post-suite.log.gz](./check-post-suite.log.gz) |

The browser package witness uses DOM counterparts for React Native host views
and controlled `Read` publications to force the interleavings. Its typing and
media calls reach the actual generated backend. The additional production
Expo web smoke runs real Expo Router and React Native Web using the installed
npm client; it does not use those DOM counterparts. Neither is a native
Expo/Hermes/iOS/Android lifecycle proof.

## Failures and attribution

All exploratory failures below are **ours**, corrected before qualification.
They are retained as failed attempts, not relabeled passing runs.

1. Initial Quarry draft: an unsupported one-source Following view shape,
   a non-total explicit history index and then ambiguity from a redundant
   history index. Fixed by using the documented activity/repost Following
   form and the existing total conversation/ordinal key. Final `check` passes.
2. Initial TypeScript: inbox projection has no `id` (use conversation key),
   a union of search signatures cannot receive the per-chat argument (split
   typed child components), and local Expo source requires
   `allowImportingTsExtensions`. All three corrected; final full app and
   guide snippets typecheck. [social-tests-initial.log.gz](./social-tests-initial.log.gz).
3. Initial public smoke expected an equal typing renewal inside its coalescing
   interval to fail immediately after transport disconnection. The SDK may
   reuse its last successful result then. The test now ends the prior lease
   and discovers disconnection before testing the new hint, without changing
   the SDK's rule. [social-tests-initial.log.gz](./social-tests-initial.log.gz); corrected round 2 passes.
4. Guide first attempt omitted the new card from the language list. The next
   attempt displaced `from-sql` beyond the list probe, changed the recorded
   list without its fact record, and exceeded the existing total word target
   by one word. Updated the actual card/fact list and shortened prose; all
   existing assertions and budgets stand. [guide-initial.log.gz](./guide-initial.log.gz), [guide-final.log.gz](./guide-final.log.gz)
   (the latter is a failed intermediate filename), then [guide-corrected.log.gz](./guide-corrected.log.gz).
5. README initially reached 301/300 lines. Combined its two introductory
   sentences on the existing line; final 300/300. [docs-budget.log](./docs-budget.log).
6. Adding a FlatList browser host counterpart initially omitted its closing
   brace. Corrected that harness syntax; [affected-final.log.gz](./affected-final.log.gz) is the failed
   intermediate run, [affected-qualified.log](./affected-qualified.log) is the passing run.
7. The extra Expo export smoke initially used the witness helper's nonexistent
   `url` instead of `api`. The corrected attempt passed every UI assertion
   but an uncaught in-flight route during teardown failed the process. The
   final harness handles disposal and exits successfully. See
   [expo-web-smoke.log](./expo-web-smoke.log), [expo-web-smoke-corrected.log](./expo-web-smoke-corrected.log) (test bearer redacted),
   and [expo-web-smoke-final.log](./expo-web-smoke-final.log).

Early setup reads also used a guessed LLP filename and an uninitialized
`llp-orient` symlink, and several initial check commands used an incorrect
relative directory/binary path. Corrected the paths and initialized only the
small local `vendor/llp` submodule. These were setup mistakes, not product
failures. No shared tool installation or SDK repair was needed.

The single full-suite result is exactly:

```text
== 1 failure(s) in 1423 s
   cargo test
```

Every full-suite failure is **ours** (guide presentation), and now fixed:

| Failing test | Cause | Final affected proof |
| --- | --- | --- |
| `snapback4-lang::server_opt_in::why_and_discovery_keep_the_opt_in_one_step_away` | Prepending the starter pointer displaced the first core-card line and the required second opt-in line. | Preserve those two lines and put the pointer third; server-opt-in target 7/7. |
| `snapback4::check::guide_lists_aliases_and_resolves_them_on_stdout` | Inserting social inside the established `language, from-sql, app, types` prefix changed it. | List social beside client; CLI check target 76/76. |
| `snapback4::check::guide_unknown_word_suggests_cards_on_stdout` | Same discovery-prefix change in the unknown-keyword output. | Same correction; CLI check target 76/76. |

No baseline or environmental test failure occurred. Full-run aggregate:
Rust **4,173 passed / 3 failed / 31 ignored**; all client shards **3,933 passed /
0 failed / 10 skipped**; client models **79/79**; fixture wrappers **9/9**.
All build, wasm-budget, release-guard, package and app checks passed.
The expected refused/auth scenarios printed by the model tests are passing
negative cases, not additional failures.

The full run began on implementation commit `fcaeaa90b` and is not claimed
as an all-green qualification of the final tree. Afterwards, the discovery
correction and explicit transient-list unmount were qualified with the whole
guide, affected Rust targets, all 11 affected package tests and a fresh
production Expo web smoke. The media witness now waits for actual list
detachment and a new mount, asserting no extra asset fetch/revocation;
connectivity notifications also preserve composer identity and focus.
The full suite was not repeated or reclassified as passing.

## Wasm

Same toolchain before and after: Rust **1.97.0** (`2d8144b78`),
wasm-bindgen **0.2.127**, production `scripts/build-wasm.sh`.
Before: **2,019,815 B raw / 585,384 B GNU file-input gzip-9**, cap **586,193 B**.
SHA-256: `083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
After the suite: **2,019,815 B raw / 585,384 B gzip**, identical SHA-256.
Delta **0 B raw / 0 B gzip**, **809 B** below the unchanged **586,193 B** cap.
[wasm-before.log.gz](./wasm-before.log.gz) records the production build; `wasm-after.json` records the
post-suite measurement. The implementation changes no device source.

## Remaining qualification and limits

- **Native Expo witness remains for all three recipes.** This Linux worktree
  has Chromium and the Expo web toolchain, but no iOS simulator/dev-client
  harness. Run the generated app on a dedicated native build and exercise
  native focus/backgrounding, account switch, offline typing expiry and
  Blob/once-handle cleanup. Typechecking or web export does not close §8's
  native witness requirement.
- Adopt OK owner-key coverage and OS ordinary all-chat search when landed;
  use EQ's supported equality form when available. No future syntax is shipped.
- This is a small starter, not Clique qualification. No new calibration score,
  scale envelope, publication or full §8 qualification is claimed. No message
  deletion/expiry is implemented; the receipt-run recipe assumes immutable,
  non-reused positions without deletion. Draft survival is within the mounted
  screen, not a promise to persist draft text across process death.

All new dependencies and install caches are inside this worktree (`node_modules`,
`target/bun-cache`, `target/npm-cache`, and generated target apps). Existing
Node/Bun/Rust/wasm-bindgen/Chromium tools were used without shared installation.
