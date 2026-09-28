# Lane EX round 5 — ordinary search in the published social starter

2026-09-28. Branch `sb4-intent/ex-social-example`. First fetched and merged
`origin/main`: fast-forward from `be9ca4f44` to `aa4763bc5`, including EX's
landed rounds 0–4 (`ae265b730`) and OS (`b607c2b85`). No conflicts, push,
publication, shared installation, dependency or version change.

Read the landed search card and LLP 3000.028 §3.3, all five prior EX prompts,
reports and journal entries, and the Snapback 4 fence. The request/OS merge
message still describes immutable-scope admission; the actual landed §3.3
round-7 decision and search card explicitly remove that restriction after
adding authorized ID overlap. This round leaves that engine contract alone.
The starter already declares `conversation` and `at` immutable; both remain,
with a comment explaining stable search positions.

## Context and scope

Read-only `llp-orient` covers the social generator, generated Search screen,
compiled cards and browser/public-client witnesses. Governing documents:
LLP 3000 §4/§7 (fence and tested guide), LLP 3000.028 §3.3/§8 (ordinary search,
SDK-owned composition/accumulation and published recipes), and LLP 2000.000 §7
(declared partition custody). LLP 3000 and 3000.028 are in `llp/current/`, not
foundation. Existing recipe references still apply. The scoped corpus audit
adds this round to §8 and its Revised line; no new design or hand-off is needed.

The scope preserves the one-invocation composed page, keyset continuation,
authorization, acquired retained images, truthful coverage and source identity
contracts of LLP 3000.028#3.3. No SDK, core, device, meter, schema descriptor,
public Read contract, budget or wasm input changes. Native Expo lifecycle
qualification remains outstanding under LLP 3000.028#8; this browser witness
does not close it.

## Delivered changes

- Replaced the starter's `searchHeld`/`searchNewest` pair and obsolete rewrite
  warning with `query search(q, c): return messages matching q last 20 by .at
  after c`. `searchChat` remains its ordinary pinned query. Search.tsx calls
  `usePage(api.search, { q })` without a link-state operation switch.
- The screen renders `page.items`, `page.hasMore`, `page.loadMore` and the
  SDK's combined read. There is no application page cache, append or dedup
  loop. Shared ReadState shows “Partial results” only on a ready incomplete
  answer, independently of freshness and continuation.
- Client, search, offline-interactions, social, app, sync and receipts cards,
  the held-query explanation, starter/package READMEs and client reference
  describe ordinary search and its retained domain. Optional explicit held
  and current-only scopes remain documented as deliberately narrower features;
  the card explicitly says not to switch between them by connectivity.
- The search card's executable ordinary examples and package README document
  the expected `N_NEVER_COMPLETE` empty-needle browse note and `N_SYNC_ORDER`
  window coverage note. The guide pins exactly those two notes, their query
  site and the actual published blocks. Other examples retain their existing
  clean-compilation requirements. Both retained-search schemas explicitly declare `retain delivered-history`.
  The original unsynced-held control still
  compiles all three old explicit operations after removing only the new
  ordinary query. Its every-note assertion is unchanged.
- Moved the expanded search-form guide test into the existing guide/client.rs
  module to preserve the 1,500-line source limit. Package README stays 300/300.
  Audited card consumers; existing global-search tests still consume the
  exact published example and pass.

## Browser witnesses and sensitivity

All three new cases mount the generated Search.tsx through the real AppProvider,
SDK Pages, wasm device, IndexedDB and HTTP server. Only React Native host views
and router navigation are DOM counterparts. Search answers, cursors, coverage,
row identity and leave processing are not mocked.

The fixture has 520 messages in a current conversation and 25 in a conversation
that each fresh browser device acquires before leaving. Only the oldest 20
current messages match coffee; the 500 acquired current messages do not match.
Replica residency is asserted at 525 rows. Thus the old current coffee matches
must come from the server; the departed coffee images must come from the device.
Their interleaved timestamps define the independently expected order.

1. Search spanning live and departed conversations requires the exact combined
   20-row prefix, including both server-only and retained hits.
2. A mounted search before leave is complete with `next`, and must not show
   “Partial results”. After a real leave and sync, a new search still requires
   the exact combined prefix and the honest retained-coverage partial label.
3. Pagination requires exactly the expected 20 → 40 → 45 accumulated rows,
   no repeated ID, exhausted continuation, and retained incompleteness. A new
   unmatched needle clears the old accumulation and shows an empty partial
   answer rather than pretending there are no possible matches.

`mutate-search.mjs` restores both the exact old schema and old Search.tsx from
`ae265b730` only in fresh generated output. All three cases fail at the combined
prefix assertion: the online current-only list omits departed hits. The parent
fails because its three subtests fail. This is intentional negative-control
sensitivity, not a product failure. The public-client starter smoke additionally
requires ordinary all-chat search to retain its coffee hit after leave online.

## Checks and evidence

Existing Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127.
All commands run from snapback4 except the root reference audit. Logs and
patches are losslessly gzip-compressed; `logs.json` records their uncompressed
lengths and SHA-256 hashes.

| Check | Result | Evidence |
| --- | --- | --- |
| CLI and client builds | Pass | build-qualified.log.gz, client-build.log.gz.gz |
| Whole guide, final layout | 98 passed, 0 failed | guide-final-layout.log.gz |
| Browser + starter | 20 passed, 0 failed | affected.log.gz |
| Final search browser synchronization | 4 passed, 0 failed | search-browser-final.log.gz |
| Existing initializer recipes | 4 passed, 0 failed | init-recipe.log.gz |
| Compiler guide consumers | 61 passed, 0 failed (held 14, owner keys 4, residency 41, search 2) | guide-consumers.log.gz |
| Published global-search consumer | 17 passed, 0 failed | search-global.log.gz |
| Exact pre-OS split mutation | All three cases fail as intended | mutant-split-final.log.gz |

The browser count includes its parent tests. The final four search cases are
already included in the 20 and are not additive. The five starter tests cover
new/check, full generated Expo app and four guide snippets typechecking,
public-client smoke and cold owner-key coverage on native and wasm.

Ran `bash scripts/test.sh` **exactly once**, exit **1**. Its exact summary is:

```text
== 1 failure(s) in 1352 s
   client tests
```

The only full-run failure is **ours**: the newly added ordinary-search smoke
assertion in `social-starter.test.mjs:207` called `.map` on an unavailable
`data` field. That assertion assumed a one-shot read was immediately ready.
The failing log did not print the non-ready variant; it is not evidence of a
baseline runtime failure. Ordinary composition may return loading when a
concurrent sync invalidates its attempt, as the landed search card documents.
The correction waits through loading, fails immediately on a refusal, and
still requires the exact retained ID. Persistent loading still times out.

Full-run totals: **Rust 4,250 passed / 0 failed / 33 ignored**; **client shards
4,421 passed / 1 failed / 10 skipped**; **client models 79/79**; **fixture
wrappers 9/9**. All other suite categories pass, including build, production
wasm/budget, release guard, package and app typechecks, and README 300/300.
The three new browser cases all pass in that run. `test-sh.log.gz`,
`full-suite.json` and `suite-summary.json` retain the result and counts.

After the full run, fixed only the smoke's readiness assumption and added
`retain delivered-history` to the two search-card schemas that describe
retained search. Those declarations make the executable examples demonstrate
their prose, as the starter already does. No application implementation changed
after the full-run snapshot. `tested-diff.patch.gz` records the launch snapshot;
`post-suite-changes.patch.gz` records every subsequent source change.

Final affected checks: **24/24** browser/starter/initializer tests
(`affected-post-suite.log.gz`), **98/98** whole guide (`guide-post-suite.log.gz`),
and **17/17** published global-search consumers (`search-global-post-suite.log.gz`),
plus the rebuilt CLI (`build-post-suite.log.gz`). No second full run and no claim
that the full suite passed on the final tree. **Baseline failures: 0;
environmental failures: 0.**

## Failure ledger

| Classification | Attempt | Disposition |
| --- | --- | --- |
| Ours, corrected | guide.log.gz: every_card_compiles_clean and the_readme_quarry_compiles_clean | New ordinary examples emit the two legitimate coverage notes. Documented both and pinned their exact codes/count/site for the actual published blocks. Final guide passes. |
| Ours, corrected test setup | mutant-split.log.gz | Wrapper resolved the binary one directory too high, so scaffolding failed before assertions. Corrected the wrapper; all three semantic controls then failed as intended. |
| Ours, corrected after full suite | test-sh.log.gz: starter smoke, unavailable `data.map` | Await a ready ordinary search page; fail on refusal and retain the exact ID assertion. Final affected 24/24 pass. |
| Intentional negative control | mutant-split-qualified.log.gz and mutant-split-final.log.gz | Three combined-prefix failures plus their parent; no production files changed. |

Inspection/edit setup mistakes used guessed offline/browser helper paths or a
redundant snapback4 prefix from inside that directory; they made no edits and
were corrected. The initial affected command named `init-recipes.test.mjs`
(plural), which Node did not select; ran the actual `init-recipe.test.mjs`
separately (4/4). The source-length audit caught guide.rs at 1,516 lines before
landing; relocating the test leaves 1,487. None required a production workaround.

## Wasm and limits

A fresh production build before this round's checks measures **2,039,451 B raw /
592,719 B GNU file-input gzip-9**, budget **593,719 B**, headroom **1,000 B**.
SHA-256 `7189290aff31e3e7cdf33141cf30d09235abb14d58ca65bceb8333784ca8444d`.
This equals the landed OS artifact; the old round-4 EX artifact predates OS.
The full suite rebuilt exactly those bytes: **0 B raw / 0 B gzip delta**,
identical SHA-256. `wasm-before.json` and `wasm-after.json` record both
measurements; `audit.json` confirms no wasm input changes.

Final reference audit: **522 LLP documents, 9,836 references, zero errors or
unchecked references** (`ref-check-final.log.gz`). Source caps, whitespace and
journal append-only preservation pass (`audit.json`).

Native Expo/Hermes/iOS/Android lifecycle proof remains outstanding. No new scale,
calibration, publication, whole-changing-corpus exactly-once, or full §8 claim.
