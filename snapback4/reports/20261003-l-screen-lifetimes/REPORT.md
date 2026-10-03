# Lane L — bounded screen ownership

Base: `ffc125ea2439695d06d066dc6b25e45c2a39a088`; branch
`sb5/l-screen-lifetimes`, eb1000. Implemented under the recipe-first commission
for LLP 3000.032 §4.5. No push or publication.

## Decision and delivered surface

Keep the current SDK observation/hook signatures. The working composition
supplies the required activation behavior, so the commission's condition for
adding `active` to observations/hooks was not met. There is no new inactive
Read arm, overload, server vocabulary, result cache, or revived .029 proposal.
The app component's ordinary `active` prop chooses whether a child is mounted;
it is not an SDK hook option. Existing `keep:true` linger is unchanged.

The installed social starter ships `BoundedConversation.tsx` and
`PageLifetime.ts`. `guide social` embeds their exact source. The package client
reference tells builders how to substitute the bounded alternative into the
existing focused/foreground route. The existing complete Conversation remains
available for its journal, receipts and richer interaction UI.

The bounded screen has:

- A draft shell keyed by backend, account, query arguments and client identity.
  It survives query withdrawal and inactivity; scope changes reset it even hidden.
- A route-owned child with membership and the root observation. Unmount releases
  that owner and every page/body owner. Durable writes remain SDK custody.
- A root marker containing only `{epoch, ready}`, with no rows/cursors. It joins
  the same default watch as `usePage`; every hard withdrawal increments its epoch
  synchronously. A generation withdrawal/replacement batched by React still
  resets page depth, identity owners and selected media. Plain retained
  revalidation does not reset them. The marker deliberately treats other hard
  root withdrawals as reset boundaries too.
- At most three requested 20-row pages and 20 displayed body readers. IDs come
  only from the current `page.items` window. The optional selected-photo viewer
  can add one point read outside that window, making the maximum 25 distinct
  observations including three pages and membership. It saves only selected IDs
  and rechecks a live point before opening media.
- A neutral unavailable placeholder for an unreadable identity. It is evidence neither that the row exists nor that it does not, and exposes
  no body or media action. The SDK owns all cursor
  continuations; no app state remembers withdrawn cursor suffixes.

LLP 3000.023 §13 records the implemented rules and the conditional no-hook
decision; .032 §4.5 records the pilot. The package README, client card, social
card, starter README, client reference and generated `react.d.ts` comments all
point builders to this composition. Generated declarations are built, not
committed. [Context](CONTEXT.md) and [scoped maintenance audit](AUDIT.md) record
the governing constraints.

## Actual builder pilot

The frozen input is the full Cal29 `src/chat.tsx` already preserved by Lane R,
with L1/L2/L3 matching the evidence ledger byte-for-byte. `pilot/before/chat.tsx`
and `pilot/after/chat.tsx` preserve the original and edited file. The original
schema/window sources are copied from the same evidence custody. Run
`node reports/20261003-l-screen-lifetimes/pilot-check.mjs` from `snapback4/`.
`measurements.json` includes SHA-256s, line positions and reproducible counts.
Physical lines are actual source lines; bytes are UTF-8 excluding each selected
block/file's final newline, as in .032 §2.3. No prettified LOC is counted.

| Specimen | Before lines / bytes | After lines / bytes | What is counted |
| --- | ---: | ---: | --- |
| L1 | 1 / 304 | 1 / 211 | Union-of-ever-seen identities replaced by a current 40-ID window |
| L2 | 1 / 180 | 1 / 238 | Live point body with unavailable placeholder and immediate withdrawal |
| L3 selected cleanup | 1 / 370 | 1 / 87 | Raw ephemeral stop on route-owner cleanup; visibility moves to its own helper |
| Whole chat file | 46 / 16,754 | 59 / 18,089 | All imports, route/draft/client keys, paging resets, controls and cleanup |
| Added PageLifetime | 0 / 0 | 39 / 1,502 | Shared root epoch marker |
| Added useForeground | 0 / 0 | 9 / 663 | Native AND web visibility, initial state, listener cleanup |
| Whole changed client, including helpers | 46 / 16,754 | 107 / 20,254 | **+61 physical lines / +3,500 B** |

L3's selected cleanup number is not a savings claim: its listener logic moved.
Generated API output and the derived typecheck specimen are not author-written
code savings. Selected blocks overlap the whole-file totals. The independent
published example is also additional code, not deleted builder code.

Behavior changes: Cal29 releases read owners on background/route inactivity,
keeps its draft in the keyed shell and guards late body callbacks from changing
that draft after their owner unmounts. Hard root resets clear page ownership,
layout metadata and selected media. It no longer remembers displaced identities;
Newer/Older loaded rows selects its bounded window. An unavailable point shows a
neutral placeholder instead of disappearing silently. Its existing typing
`keep:true` still intentionally lingers; therefore **zero hidden watches is the
bounded starter measurement, not a whole-Cal29 measurement**. Its SDK outbox is
unchanged. This pilot does not claim to qualify the original app's untouched
receipt/quote/upload flows or replace Lane R's actual-visible seen work.

The schema and selected ownership/read calls strictly typecheck against the
current generated API, and the entire edited chat parses. Original Cal29 UI
modules are not all present in the bundle: no full-app typecheck, launch,
benchmark score or native-runtime qualification is claimed. The test mounts
actual L1/L2 snippets, the actual foreground helper, and the entire installed
bounded screen (with DOM substitutes for React Native controls). Existing media
viewer implementation is independently covered by the package suite; its UI is
stubbed in the focused ownership harness.

## Mounted queries and resets

Measured under React Strict Mode, with real SDK hooks over a controlled shared
observation source; engine authorization is separately exercised on both real
devices. The moving-page stimulus uses ten disjoint 20-row current answers.

| Mounted scenario | Original L1/L2 | Rewritten L1/L2 / bounded starter |
| --- | ---: | ---: |
| End of ten moving pages | 200 point + 1 page = 201 | 20 point + 1 page = 21 |
| Wide 80-row current input | Not part of the original moving-page comparison | Cal29 caps at 40 point + 1 page = 41 |
| Complete starter, first page | N/A | 22 distinct observations, 23 owners |
| Complete starter hidden | N/A | 0 observations / 0 owners |
| Hidden route with active same-key sibling | N/A | 1 surviving sibling point |
| Generation withdrawal coalesced with replacement | No explicit owner marker in L1 | 3 requested pages → 1; draft and input identity preserved |

The marker adds one **subscriber** to the root, not another query watch.
Strict Mode's initial 46 opens / 23 closes leave exactly 23 committed owners;
final unmount balances every open and close. All account/visibility listeners
release. The owner-reset probes independently trigger one hidden account
change, one backend change, one query-argument change and one client replacement;
all four reset the draft owner. The fifth, a coalesced generation withdrawal,
resets page/identity owners and preserves the draft owner. Process and wasm each
also commit an actual device adoption with an old evaluation held across it;
no old result reinstalls the previous owner key.

This establishes capped observations and explicit reset behavior, not a measured
reduction in human debugging time or causal score improvement. No additive
savings with A/R. An active hook would still need the same window, owner keys,
cursor and visibility decisions, and gives no demonstrated reduction over this
composition. It was rejected after the working pilot, not left half implemented.

## Checks

Environment: Node 24.13.1, shared `CARGO_TARGET_DIR=/home/ccheever/sb5-lanes/target`,
`CARGO_INCREMENTAL=0`, prescribed PATH. No target directory symlink was made.
Existing build/test scripts hardcode two local target paths: a small ignored
CLI forwarding script and a copied raw wasm input bridge those paths to the
shared build target. The first cold package build lacked generated wasm; the
initial wasm script then hit its hardcoded target path. Both were repaired as
local build prerequisites, without changing shared build scripts or budgets.
The final full run also exposed the witness helper lookup outside the tree;
its supported `SNAPBACK4_ACQUIRE_HELPER` override resolves that environmental
prerequisite for the affected rerun.

The initial test-fixture schema also needed a bounded indexed text column;
its first generation probe mixed real-server and synthetic generation identity
and did not settle. The final generation fixture uses the established controlled
sync/backend protocol over real device adoption. These were lane test-development
failures, not inherited product failures. A loaded process run also showed two
hard root withdrawals during one adoption; the regression now checks monotonic
retirement rather than incorrectly equating one adoption with one notification. Initial
guide red checks caught new prose/path/word-budget errors; all were corrected without raising a budget.

Individual check logs are in `checks/`; summaries below quote the final output.

### Focused qualification (verbatim summaries)

`cargo test -p snapback4-lang --test guide`:

```text
test result: ok. 111 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.54s
```

`node --test packages/snapback4/test/screen-lifetimes.test.mjs packages/snapback4/test/screen-lifetimes-react.test.mjs`:

```text
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8725.715238
```

`node --test --test-name-pattern='published social starter and guide snippets typecheck' packages/snapback4/test/social-starter.test.mjs`:

```text
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1848.553917
```

`node reports/20261003-l-screen-lifetimes/pilot-check.mjs`:

```text
L1: 1 lines / 304 B -> 1 lines / 211 B
L2: 1 lines / 180 B -> 1 lines / 238 B
L3: 1 lines / 370 B -> 1 lines / 87 B
before/chat.tsx: 46 lines / 16754 B
after/chat.tsx: 59 lines / 18089 B
after/PageLifetime.ts: 39 lines / 1502 B
after/useForeground.ts: 9 lines / 663 B
Cal29: schema, generated API + L1/L2/L3 ownership specimen strict typecheck, full edited chat syntax: PASS
Scope: mounted specimens and complete published bounded screen; not full Cal29 application/native-runtime qualification.
```

`bash scripts/build-wasm.sh`:

```text
wasm 2048753 B raw, 617410 B gzip (budget 618040: ok)
```

`./ref-check --verbose` (repository root):

```text
ref-check: ok — 527 LLP docs, 10147 refs in 32676 files, 0 errors, 0 unchecked
```

`git diff --check`: exit 0, no output. `bun run --cwd packages/snapback4 build`
and `typecheck` also pass inside the complete suite; the built `react.d.ts`
contains the new route-owner/cursor documentation.

### Inherited Rust failures, reproduced on base

A clean sparse worktree at `/home/ccheever/sb5-lanes/l-base-check` is exactly
`ffc125ea2439695d06d066dc6b25e45c2a39a088`, with no tracked changes. Both named
commands run there with the same shared Cargo target and toolchain. Logs:
`checks/base-prefix-reads.log.gz`, `checks/base-membership-search.log.gz`.

| Group | Failing tests (same on lane and base) | Classification |
| --- | --- | --- |
| `snapback4-lang::prefix_reads` | `explicit_caps_stay_silent_and_predicting_short_pages_stay_refused`; `prefix_reads_compile_without_notes_and_caps_follow_one_schema_number` | Inherited `N_SHAPE_METER` note expectations |
| `snapback4-sim::membership_search` | `edges::calendar_repair_executes_the_same_offset_boundary_predicate`; `refusal_rewrite_compiles_on_its_schema_and_keeps_filters_in_both_searches` | Inherited `N_SHAPE_METER` note expectations |

Base `cargo test -p snapback4-lang --test prefix_reads`:

```text
test result: FAILED. 8 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

Base `cargo test -p snapback4-sim --test membership_search`:

```text
test result: FAILED. 22 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.52s
```

### Complete suite and repairs

Ran `bash snapback4/scripts/test.sh` once with the prescribed shared target.
The full raw output is `checks/test-suite.log.gz`. Its first client pass reported:

```text
ℹ tests 5994
ℹ suites 0
ℹ pass 5946
ℹ fail 38
ℹ cancelled 0
ℹ skipped 10
ℹ todo 0
ℹ duration_ms 594639.913626
```

Of those 38 failures, **two are ours and corrected**, and **36 are environmental**:

| Failure | Classification and disposition |
| --- | --- |
| `README TypeScript examples compile and call every public function` | Ours: the new substitution fragment was incorrectly fenced as a standalone module. Replaced it with explicit inline route-edit instructions; the complete installed screen remains strictly typechecked. |
| `screen owner process: committed generation adoption resets even with a late old read` | Ours: the suite had loaded the pre-repair assertion equating one adoption with one withdrawal. The fixed regression asserts monotonic retirement and rejects recovery of an old key; the focused final run passes both devices. |
| All 36 `witness-acquire.test.mjs` failures listed below | Environmental: the shared-target executable is outside the package tree, so its helper lookup returns `E_WITNESS_PROCESS: install the matching snapback4 client package to run witness acquire`. Rerun with `SNAPBACK4_ACQUIRE_HELPER=/home/ccheever/sb5-lanes/lane-l/snapback4/packages/snapback4/bin/witness-acquire.js`. No product source changed for this prerequisite. |

The exact environmental failures from the full run are:

- acquire CLI refuses invalid arguments before connecting
- acquire CLI saves actual SDK acquisition and cold retained receipts across fresh runs
- acquire refuses unknown personas, mismatched bearer identity, unreachable servers and unknown queries
- serve accepts a matching bearer, refuses a different principal, and omits server timings
- bounds guide command and receipt excerpt execute against a small fixture
- reconnect proof rejects more-then-drop and records every attempted request
- reconnect proof rejects denied and records every attempted request
- reconnect proof rejects malformed-json and records every attempted request
- reconnect proof rejects null and records every attempted request
- reconnect proof rejects missing-fields and records every attempted request
- reconnect proof rejects bad-more and records every attempted request
- reconnect proof rejects behind-server and records every attempted request
- reconnect proof rejects dropped-first and records every attempted request
- reconnect proof rejects drop-once and records every attempted request
- reconnect proof rejects truncated-body and records every attempted request
- reconnect proof rejects bad-ack and records every attempted request
- reconnect proof rejects bad-acquisitions and records every attempted request
- echoed bearer and derived refusal text never reach stderr, JSON, text or receipt files
- witness family usage advertises both commands and shares input diagnostics
- receipt identifies the JSON-line subprocess host
- restart times coverage separately from first answer
- binary native module installs and survives restart
- binary native module digest refusal fails proof
- server allowlist drops raw from every acquisition output surface
- server allowlist drops hex from every acquisition output surface
- server allowlist drops HEX from every acquisition output surface
- server allowlist drops base64 from every acquisition output surface
- server allowlist drops base64url from every acquisition output surface
- server allowlist drops percent from every acquisition output surface
- server allowlist drops percentLower from every acquisition output surface
- server allowlist drops sha256 from every acquisition output surface
- caller query and args are echoed from the request, never selected schema metadata
- failed query receipts distinguish argument rejection, query refusal and incomplete coverage
- equals token spelling authenticates without exposing the bearer
- acquire argument refusals omit values including equals bearers
- runtime refusals do not echo caller argument values in stderr


Repair checks:

- `node --test snapback4/packages/snapback4/test/readme-examples.test.mjs snapback4/packages/snapback4/test/witness-acquire.test.mjs` from the repository root, with the explicit witness helper: all 43 witness tests passed; README compilation hit the harness's working-directory-dependent Node type lookup. This additional environmental invocation error is preserved in `checks/readme-witness-final.log.gz`:

```text
ℹ tests 51
ℹ suites 0
ℹ pass 50
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 85524.754698
```

- `node --test packages/snapback4/test/readme-examples.test.mjs` from `snapback4/`, the suite's normal working directory, confirms the actual documentation repair (`checks/readme-final.log.gz`):

```text
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3053.115142
```

- The final six-test lifetime run quoted above is after the generation assertion repair. No affected product test remains failing; the four inherited Rust failures remain open outside this lane.


Final complete-suite top-level output (verbatim):

```text
-- ok: cargo build (9 s)
-- ok: wasm build (31 s)
-- ok: docs budget (22 s)
-- ok: release guard (3 s)
-- ok: package typecheck (2 s)
-- ok: package build (3 s)
-- ok: chat app check (0 s)
-- FAIL: cargo test (699 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (1 s)
-- ok: fixture wrapper tests (11 s)
-- FAIL: client tests (595 s)
-- ok: client models (331 s)
== 2 failure(s) in 1695 s
   cargo test
   client tests
```

The script counts failed **groups**, not individual tests. Cargo's two failing
targets contain the four inherited failures reproduced above. Client tests
contain the 38 fully classified failures above. Final seeded models:

```text
ℹ tests 79
ℹ suites 0
ℹ pass 79
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 330918.351516
```

The script's 1,695-second wall time exceeds its historical 60-second comment;
this is the measured full inventory on the shared host, not a new lane budget.
No seeds, suites or tests were reduced. Ten existing optional client tests were
skipped by their own environment gates. The complete run is not claimed green;
scoped repairs are qualified by their final reruns. Raw intermediate development
logs are retained alongside final logs and are not substituted for final evidence.

Unresolved: the four base Rust failures; full original Cal29 app/native runtime
qualification remains outside the available specimen harness. No active-hook
implementation is pending: the condition for it was not established. No wasm
budget increase, SDK custody/cache change, push or publication.

## Round 1 — fold both blind reviews (2026-10-03)

Reviewed input: `37c77e1dfa`; reviews read in full from
`~/sb5-lanes/reviews/l-r0.astra.md` and `l-r0.grok.md`. This section supersedes
round 0's composer-preservation claim, snippet-only mounting evidence and final
source counts. The earlier check record remains historical. No SDK code or hook
signature changed.

### Repairs and reproductions

- **Astra 1:** `ClientOwner` owns the mutation, submitted text and recovery.
  Refusal restores an empty draft or offers Edit without replacing newer input.
  Hiding the read child does not retire that owner. Account/backend/client/room
  keys retire it; late replies cannot restore text into another scope.
- **Astra 2:** Cal29's keyed `ConversationDraft` owns text, edit mode, attachments,
  once-send intent, reply ID, busy state, mutation hooks and refusal recovery.
  It remains mounted while the read body unmounts. Late pick/upload/send
  continuations check the shell's scope. Reply previews read their body live;
  the shell retains only the reply ID. Complete before/after mounts assert
  edit → background → foreground → submit still calls `editMessage`, an attached
  image remains attached, and a refusal received hidden restores the text.
- **Grok 1:** an epoch change resets `start`, selected media and jump/layout state
  during render. The image requires a current selection. The selected row's
  recheck explicitly uses `keep:false`. Both a coalesced withdrawal and a real
  wasm-device program adoption exercise the complete pilot with an open photo.
  A React Profiler records every committed DOM tree, including the commit before
  passive effects: none contains the image after withdrawal/adoption. The
  generation fixture deliberately preserves the same photo ID.
- **Grok 2:** a quote target found in `page.items` selects its index rounded down
  to a 40-row window. Only absent targets with a continuation load another page.
  The mounted page-4 test loads four pages, mounts message 65, scrolls to its
  reported layout, and resumes ordinary auto-scroll after the jump clears.
- **Grok 3–4:** the installed README and this report now say a placeholder is
  evidence neither that the row exists nor that it does not. Both the installed
  README and client reference give the named `BoundedConversation` import. Tests
  apply each documented import and JSX substitution to the actual installed
  `app/conversation/[id].tsx`, then typecheck the whole generated starter.
- **Grok 5:** loading, denied, absent and partial placeholders have identical
  accessible text. Neither `Denied` nor `NO_BODY` can appear. The harness imports
  the complete real starter `Conversation.tsx` and `useOnceMedia.ts`; it selects
  a photo, withdraws/revokes its point, and proves no `client.asset` call occurs.
  A separate authorized open consumes one handle, which epoch reset releases.

The harness mounts the complete source files, including `ConversationDraft`,
`ConversationBody`, `Bubble`, composer callbacks and viewer. DOM substitutes
supply React Native/UI controls and layout events; no ownership/list/body
function is extracted or replaced. Real SDK hooks run over controlled shared
observations for deterministic transitions/counts. The adoption case instead
uses `createLocalClient` and the actual wasm device with literal fixture
programs, controlled schema/sync responses and controlled asset bytes. This is
not a full Cal29 native application or production asset-server qualification.

**Red evidence:** with both changed recipe/pilot files loaded verbatim from
`git show 37c77e1dfa:<path>`, the new React suite has **8 failures / 8 passes**.
The three original-before composer tests pass, while the three round-0-after
versions fail. Both starter refusal cases, page-4 jump, immediate recheck and
real-adoption stale-image cases fail. The baseline real-adoption log records
`image:true` in its first committed tree. The old installed README also fails
both new documentation tests. See `checks/round1-red-react-final.log.gz` and
`checks/round1-red-docs.log.gz`.

The review's surviving mutations are now killed, each in its own run:

| Mutation | Failure |
| --- | --- |
| Replace the entire pilot `ConversationDraft` with `return null` | Complete mount has 0 rows instead of 20 |
| Render `read.denied.message` in the starter placeholder | Accessible text differs from neutral loading/absence |
| Remove `keep:false` from the pilot selected-photo recheck | Viewer no longer shares the immediate-withdrawal owner |
| Change the documented named import to a default import | Actual route typecheck reports TS2613, no default export |

Logs: `checks/round1-mutation-*.log.gz`. These mutations do not survive in source.
The correctly neutral round-0 placeholder itself was already sound; its defect
was the weak oracle, so that regression is qualified by the killed mutation.

### Remeasured ownership and source

These are complete-component measurements. They include the original pilot's
receipt, quote, author and reaction reads, so they must not be compared as if
identical in scope to round 0's isolated L1/L2 counts.

| Mounted scenario | Observations | Owners | Mounted rows |
| --- | ---: | ---: | ---: |
| Original, after ten disjoint 20-row answers | 407 | 806 | 200 |
| Repaired pilot, same ten answers | 67 | 87 | 20 |
| Repaired pilot, one wide 80-row answer | 127 | 167 | 40 |
| Repaired pilot hidden, controlled source | 0 | 0 | 0 |
| Installed bounded recipe, first page | 22 | 23 | 20 |
| Installed bounded recipe hidden | 0 | 0 | 0 |

The original's duplicate quote/body subscribers share default observations;
Cal29's immediate-withdrawal body reads have a different retention policy from
its existing quote reads, which explains their separate observations. The
pilot's `keep:true` typing subscription still has the SDK's independent linger:
zero in the controlled source counts released ownership, not elimination of
that production linger. The installed recipe has no such `keep:true` owner.
Strict Mode initial recipe setup remains 46 opens / 23 closes = 23 owners;
final unmount balances every open and close, with no visibility/viewer listeners.

Reset probes re-confirm all four shell changes (hidden account, backend,
conversation arguments, replacement client). A coalesced generation reset
returns the starter's three-page chain to one and preserves draft/input identity.
The full pilot also resets two requested pages to one while preserving draft
text; hidden read owners release, foreground reacquires them, and in-scope
composer intent/recovery survives. Account/client/room changes during a held
send discard the old recovery in both compositions. The process and wasm
lifetime tests retain their actual-adoption/late-old-result checks.

| Source | Physical lines | UTF-8 bytes, excluding final newline |
| --- | ---: | ---: |
| Frozen before chat | 46 | 16,754 |
| Round-1 after chat | 66 | 19,053 |
| Added PageLifetime | 39 | 1,502 |
| Added useForeground | 9 | 663 |
| Whole changed pilot including helpers | **114** | **21,218** |
| Delta from frozen before | **+68** | **+4,464** |
| Delta from round 0 | **+7** | **+964** |

Selected L1/L2/L3 counts remain 1/211 B, 1/238 B and 1/87 B respectively;
these overlap the totals and are not a savings claim. `measurements.json`
contains final source hashes and locations. The pilot schema/generated API and
ownership specimen strictly typecheck; the complete edited chat parses. Missing
original Cal29 UI modules still prevent a full native-app typecheck/launch claim.

### Qualification

All commands use the prescribed PATH, shared Cargo target and disabled
incremental compilation. Final check logs are under `checks/`:

| Check | Final result |
| --- | --- |
| Final combined client/lifetime run on the rebuilt wasm (`round1-combined-final`) | **238 passed, 0 failed, 0 skipped** |
| Both lifetime files (`round1-lifetimes-final`) | 21 passed, 0 failed |
| Affected React/social-browser/pages/adoption/keep tests (`round1-affected-react-pages`) | 197 passed, 0 failed |
| Complete social starter + README examples (`round1-docs-final`) | 20 passed, 0 failed |
| Installed guide source, both substitutions and placeholder wording after final prose (`round1-substitution-final`) | 3 passed, 0 failed |
| Guide (`round1-guide-final`) | 111 passed, 0 failed |
| Package typecheck/build, pilot check and docs budget | Pass |
| Wasm budget (`round1-wasm-final`) | 2,048,753 B raw / 617,410 B gzip; unchanged 618,040 B cap (630 B headroom) |
| Reference check | 527 LLPs, 0 errors, 0 unchecked |

The initial shared-target build linked an older language-guide artifact: guide
output had five snippets while this tree contains seven, and the Rust guide test
saw an old native-smoke wording. Rebuilding this checkout's language crate fixed
both; a temporary copied CLI kept subsequent tests insulated
from concurrent shared-target replacement. The final wasm build likewise
recompiled this checkout's core/device before copying the raw input into the
script's local target path; it reproduces round 0's 617,410-byte gzip artifact.
The first shared-artifact wasm pass was 617,327 bytes and is not the final
measurement. The initial affected run was 24/25,
the initial guide 110/111; their corrected final runs above are green. Initial
harness development errors (missing fake-client link methods, the installed
route's directory name and literal-program argument declarations) were corrected
before baseline reproduction. Intermediate logs remain separate from final proof.

No full-suite rerun, native UI qualification, push or publication is claimed.
The round-0 full-suite inherited failures remain outside this recipe/pilot change.
