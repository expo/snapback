# EX round 1 — recover every send and enforce the client lifetimes

2026-09-28. Branch `sb4-intent/ex-social-example`, worktree
`/home/ccheever/sb4-intent/lane-ex`. Local work only; nothing pushed or published.
Both round-0 reviews were read in full (Astra and Grok, READY WITH CHANGES),
as were the original prompt, report and EX journal entry.

## Integration and context

`git fetch origin && git merge origin/main` merged `5763da073` in local merge
commit `3845a6ba5`. The only conflicts were LLP 3000.028's Revised metadata
and the journal append. Both sets of notes remain. A subsequence check confirms
that every journal line from both parents remains in its original order.
Owner-key coverage is present; OS and EQ are deliberately left for round 2.

The read-only `llp-orient` context covered the installed starter, prediction
explanations, compiled cards and their witnesses. The governing constraints
are [LLP 3000 §4](../../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing),
[LLP 3000.028 §3.4/§8](../../../../llp/3000.028-one-query-online-or-offline.rfc.md#8-recipes-that-must-ship-with-the-example),
[LLP 3000.008.002.000 §3](../../../../llp/3000.008.002.000-common-client-patterns.rfc.md#3-submit-once-then-let-the-user-continue),
[LLP 3000.017 §2.4](../../../../llp/3000.017-ephemeral-tables.rfc.md#24-the-client),
[LLP 3000.023 §3.2](../../../../llp/3000.023-answers-stay-on-screen.rfc.md#32-keep-has-three-states)
and [LLP 3000.022 §2](../../../../llp/3000.022-delivery-the-sdk-reports.rfc.md#2-the-contract).
Current client, receipts, ephemeral and owner-key guide text was read alongside
these decision records. The scoped audit found no need for a new LLP; §8 is
updated with a Revised entry. No core, client contract, wasm, authorization,
meter, dependency, publication version or budget change is introduced by EX.

## Changes and evidence

1. **Every submitted message has its own recovery.** The social starter embeds
   its typed intent journal, using the existing Expo/web storage adapters.
   Before dispatch it saves `{id, args}` under backend and account, including
   the attachment ID. Each saved ID mounts `usePendingWrite`. Saving, Checking,
   unknown, pending and failed outcomes remain distinct. Unknown never resends;
   successful receipts remove only the UI reference. Edit restores text and
   attachment without replacing an existing attachment; Dismiss is explicit.
   Pending settlement does not disable the next send; membership and current
   admission do. The screen also keys ownership by backend,
   viewer and conversation.

   The browser witness now uses real `createApp`, wasm and IndexedDB for write
   custody. It submits two messages offline, one with a fresh uploaded image,
   verifies neither reached the server, leaves through a separate password
   session, reconnects, and requires two `NOT_MEMBER` outcomes. Both recovery
   rows survive remount, both texts can be edited, the photo argument survives,
   and another viewer sees neither intent. Controlled query publications still
   supply the deliberate read races; they do not manufacture write outcomes.

2. **Typing renewal and termination are observed.** A controlled client clock
   and the dev server clock advance together. The test requires a renewal at
   one second, then an idle `stopTyping` at about two seconds without blur,
   before the four-second server life. Send uses a DOM click without blur so
   its own cleanup is required. Backgrounding, route blur, navigation, unmount
   and account reset require a stop and peer disappearance without expiry;
   subsequent clock ticks must issue no renewal. Disconnect still drops signals,
   server expiry removes the lost cleanup, and reconnect needs a new keystroke.

   The test exposed an additional implementation defect: the arm's effect
   cleanup closed its client before the typing hook could stop. `useOnlineArm`
   now lets consumer cleanup start, awaits only the already-started bounded
   calls, then closes. It still borrows the bearer and owns no session rotation.

3. **Media's own read is tested.** While its handle is open, `messagePhoto`
   goes through loading and recovery without a fetch or revocation. Null then
   closes the viewer and revokes exactly once. A separate case holds the asset
   result, publishes denial, requires viewer closure, then releases the result
   and requires its revocation without display. Existing list-remount, explicit
   close, late close, second-open `E_ASSET_VIEWED` and account cleanup remain.

4. **Prediction notes now distinguish signals.** `operation_lines` and changed
   prediction notes use the compiler's existing `Execution.ephemeral` fact.
   `setTyping`, `stopTyping` and every ephemeral mutation say **“fails offline
   and is not queued”**; insert-arm notes no longer teach pending writes for
   those operations. The regression covers upsert, delete and conditional insert,
   plus a durable online-only control.

   There is an important terminology boundary in the request: a durable table
   declared `online only` still accepts queued durable writes. It is not an
   ephemeral table. The compiler can distinguish them, so the durable control
   correctly retains its queue sentence. Applying “not queued” to all unsynced
   tables would teach a false contract. No fallback comment or runtime change
   is needed. The generated `check` output is in `starter-check.log.gz`.

5. **The harness now enforces the missing contracts.** It passes and records
   `observe` options, verifies default retention for room/history and
   `keep: false` for membership, receipts, media and typing, and injects a
   present-but-revalidating membership row. It mounts the actual
   `conversation-route.tsx` with controlled Expo Router/AppState inputs.
   Changing the route must clear route-owned invite state as well as the
   composer. `outboxes()` reads the online-arm clients. Cleanup must call a real
   stop; `stop(false)` and closing the arm too early both fail the witness.

6. **Receipts belong to the bubbles.** Each history page independently observes
   its receipt page with the same history cursor and index, and matches by ID.
   An unavailable receipt cannot hide text. A changed boundary replaces the
   following pages rather than retaining old protected answers. The browser
   checks older-bubble delivery text and withdrawal; the public-client smoke
   crosses 20 messages and passes the exact real history cursor to the receipt
   query, requiring identical IDs.

7. **Schema and CLI corrections.** Removed the unused `quote` column and
   documented why the unused-action `reposts` source is required by Following.
   `new <dir>` without a template lists `social`, names schema-only `init`, exits
   2 and writes no files. A regression checks all three behaviors.

8. **The retained-search warning is explicit.** `searchHeld` and the installed
   README warn against applying check's membership predicate: it would discard
   retained hits after leave. The currently supported split remains until OS;
   ordinary per-chat search stays unchanged until EQ's later integration.

9. **Owner-key coverage is adopted.** `likes` uses
   `sync public last 2000 by .at with own keys .principal`; `postState` uses
   ordinary `exists likes[post, viewer]`. The public `ownLikes` summary is gone
   from the starter. Its README and social card teach the owner partition and
   unknown-before-acquisition rule. The offline-interactions card leads with
   owner keys, preserving the public aggregate census only as an alternative
   with its explicit cost. The smoke checks false, then true, through the real
   local client.

10. **Published prose stands alone.** The compiled cards, package README and
    CLIENT-AND-OPERATIONS were swept. Removed report/lane pointers from sync,
    unpublished test-file pointers from client/reads, bare LLP explanations
    from maintains/native/reference prose, and the search report pointer.
    Measurement facts and limits remain where useful. The guide test checks
    rendered cards and package prose for these references; source annotations
    with an explanatory gloss remain allowed. The existing moved-fact record
    changes only to remove the inaccessible test-file pointer.

## Qualification

Commands run from `snapback4/`, except the root reference audit. Existing Node
24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127 were used. Nothing was
installed in a shared path. Logs preserve failed attempts as failures despite
some exploratory filenames containing “final” or “qualified”. `attempts.json`
indexes their summaries. Logs are gzip-compressed without changing their
contents; `logs.json` records each uncompressed size and SHA-256.

| Check | Result and evidence |
| --- | --- |
| CLI builds | Pass; `build-final-surface.log.gz`, then full-suite build |
| `new --template social`, `check` | Pass; `starter-check.log.gz`: 16 tables, 14 synced, 28 operations, no problems, 3 expected notes |
| Generated app + four verbatim guide snippets typecheck | Pass in `affected-green.log.gz` |
| Public-client starter smoke, including real shared receipt cursor | Pass in `affected-green.log.gz` |
| React/browser lifetimes and actual offline outbox settlement | Pass in `affected-green.log.gz`, zero page errors |
| All affected package tests, including prior init recipes | **17 passed, 0 failed, 0 skipped**, `affected-green.log.gz` |
| Whole guide | **94 passed, 0 failed**, `guide-post-hygiene.log.gz` (also `guide-final-surface.log.gz`) |
| Compiler prediction/residency notes | **41 passed, 0 failed**, `guide-final-surface.log.gz` |
| Owner-key guide regression after full-run discovery | **4 passed, 0 failed**, `own-keys-post-suite.log.gz` |
| Final published-text guard | Pass, `guide-hygiene-final.log.gz` |
| README budget and account screen | Pass, **300/300 lines**, `docs-budget.log.gz` and full suite |
| References | Pass: **522 LLP docs, 9783 refs, 0 errors, 0 unchecked**, `ref-check-final.log.gz` |
| Changed source lengths and whitespace | Pass; `source-cap.json`, `git diff --check` |
| Mutation witnesses | **8/8 killed at their intended assertions**, `mutations.json` and `mutant-*.log.gz` |

The eight mutants remove the interval body, remove viewer withdrawal, allow
revalidating membership, change sensitive reads to keep, remove the route key,
remove visibility, replace cleanup with `stop(false)`, and close the arm before
consumer cleanup. `run-mutations.py` changes only generated temporary copies;
it never mutates the implementation or weakens a production gate.

## Sole full-suite run

Ran `bash scripts/test.sh` **once**, exit **1**. Its exact final summary is:

```text
== 2 failure(s) in 1436 s
   cargo test
   client tests
```

This counts failing categories. There were **three failing tests**:

| Class | Failure | Disposition |
| --- | --- | --- |
| **Ours, corrected** | `snapback4-lang::own_keys::diagnostic_recipe_preserves_the_public_summary_and_offers_owner_key_existence`, `own_keys.rs:96`: missing `N_MAINTAIN_SYNCED` in the first example | Reordering the guide to lead with owner keys left this existing test reading the examples in the old order. Updated the two example indices, preserving every semantic assertion. Focused `cargo test -p snapback4-lang --test own_keys`: **4/4 pass**. |
| **Baseline, known fixture race** | `W6d native: two client POSTs with the caller id apply once after a lost reply`, `client-seams.test.mjs:293`: **1 POST, expected 2** | The unchanged test can recover the committed receipt through sync before it retries. This is the already-confirmed race in [the open ticket](../../../../issues/20260927-snapback4-lost-reply-post-count-race.md); appended this recurrence. Focused rerun passed with two POSTs and one application. |
| **Baseline, cause unconfirmed** | `online: kept typing survives member commits and expires during a held re-read`, `ephemeral-keep.test.mjs:91`: **no publication hides typing during the burst** | Test, SDK, device and core inputs are unchanged by EX. Focused rerun passed with 45 kept publications, all visible, and expiry at 4433 ms. The full-run failure remains open in [a new ticket](../../../../issues/20260928-snapback4-online-typing-burst-retention-failure.md). Timing/expiry overlap is a hypothesis, not an established environmental cause. |

No failure is classified environmental. The two isolated client controls ran
serially in one command and passed **2/2** (`full-failure-controls.log.gz`). A
passing rerun does not erase either full-run failure. No baseline runtime or
fixture was changed to make EX pass.

The full snapshot has **Rust 4,188 passed / 1 failed / 33 ignored**;
**client shards 3,939 passed / 2 failed / 10 skipped**;
**client models 79 passed / 0 failed**; **fixtures 9 passed / 0 failed**.
Rust totals exclude the separate docs-budget probe; client totals sum all eight
shard summaries, not only the largest process. No skip/ignore was added by EX.
All builds, wasm budget, release guard, package check/build, chat schema check,
chat/Expo typechecks and docs budget passed. The log is `test-sh.log.gz` and the
machine-readable counts are `suite-summary.json`.

After the single full run discovered the guide-order regression, its focused
suite passed. Final prose cleanup also removed the reference's obsolete
internal “card word” sentence and made the search measurement self-contained;
the **whole guide passed 94/94** again (`guide-post-hygiene.log.gz`). The full
suite was not rerun; this is not a green full-suite claim.


## Failure ledger

Every exploratory failure below is **ours**, corrected. No failure is omitted
or relabeled as a passing attempt; parent test failures reflect their named
failing subtests, not additional defects.

| Attempt(s) | Failure and correction |
| --- | --- |
| `guide-and-notes.log.gz` | The new hygiene guard found an additional `prediction-routing.test.mjs` pointer in the reads card. Removed it. |
| `guide-and-notes-qualified.log.gz`, `guide-and-notes-final.log.gz` | The corresponding `reads-06` fact still contained that pointer; the new note fixture also used ambiguous positional `hints[viewer]`. Updated the fact and used named `owner = viewer`. The second log repeats those failures because a preparatory command used the wrong working directory. |
| `social-initial.log.gz` | Disconnect and two-send cases called nonexistent `sync()` on a raw online client. Corrected while replacing that stub with the actual browser app/device. |
| `social-qualified.log.gz` | Disconnect discovery had not reached the online arm before reconnect, allowing a renewal; the two-send assertion also saw an earlier unknown recovery row. Explicitly probe the arm offline and use real durable browser custody. |
| `social-final.log.gz`, `social-app-custody.log.gz` | Raw browser `createClient` refuses durable admission; `createApp` without a durable web device also refuses it. Those fixtures produced E_ADMISSION rather than the intended membership failures. Switched to `createApp` with `webDevice`/IndexedDB and the session store used by the starter. |
| `affected.log.gz` | The fetch recorder rejected the relative wasm URL; app opening failed and `raw.sync` was absent, ending in fixture-ready timeout. Resolve URLs against the page and check app readiness. |
| `affected-final.log.gz`, `browser-diagnostic.log.gz` | The owner app transport was not deterministically offline and the attachment reused an already-placed asset (E_ASSET_PLACED); waiting for two failures timed out. Inject transport loss on the actual app, use a fresh unplaced upload, and assert neither message reached the server. |
| `browser-real-offline.log.gz` | The other-session leave used a raw browser durable mutation and was refused by admission. Its failed subtest left the next account-media case offline, causing a timeout. Move leave/rejoin to separately authenticated public Node clients; assert their successful writes. |
| `ref-check.log.gz` | The parser interpreted a literal annotation marker in the new guard as a reference. Split the literal in the test; the final audit is clean. |

Two edit commands used a repository-root path while running from `snapback4/`;
they made no edit and were rerun from the correct directory. Some initial reads
also guessed `.rs` instead of the actual `.md` card path. A trailing blank line
in the reordered card was caught by whitespace checking and removed. These
are setup/edit errors, not product failures. Expected mutant failures are
separate sensitivity evidence, not baseline or environmental failures.

## Wasm

Fresh production build (`bash scripts/build-wasm.sh`) and comparison after the
full suite rebuilt the artifact:
**2,017,908 B raw / 585,100 B GNU file-input gzip-9**; unchanged cap **586,193 B**,
headroom **1,093 B**. SHA-256:
`1050652571e0f696a94b737f281273ebf73583769a34142e584e52d1f6edfd2a`.

This is byte-for-byte the merged main/Lane OK round-2 artifact. EX delta is
**0 B raw / 0 B gzip**. Round 0's 2,019,815 / 585,384 bytes predates that merge;
the inherited reduction is not an EX optimization. `wasm-build.log.gz`,
`wasm-before.json` and `wasm-after.json` retain the measurements.

## Remaining qualification

Native Expo/Hermes/iOS/Android lifecycle evidence remains outstanding for the
three recipes. This Linux browser test mounts the real route but substitutes
DOM host views and controls focus/AppState/read publications. It is not a
native host qualification or a new production Expo web-export witness.
The generated Expo app and all recipe snippets typecheck; the public-client
smoke runs against `dev`. Round 1 makes no new scale, calibration, publication
or complete §8 qualification claim. OS and EQ adoption belongs to round 2.
