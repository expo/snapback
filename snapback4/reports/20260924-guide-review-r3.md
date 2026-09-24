# Lane F round 3 — close the round-2 guide reviews

Date: 2026-09-24. Branch: `sb4-intent/f-guide`.
Starting commit: `5b3126bd1`.
Implementation commits: `79e8f1869`, `aa4209fcb`.

All requested findings are fixed. No engine, compiler, authorization,
disclosure, durability, meter, package version or publication change.
The temporary ordering mutation used to test the regression was restored
byte-for-byte. Nothing was pushed.

## File map

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/guide/bounds.rs` | Removed the early incidental `E_BOUND` token and the dangling “as above.” The heap rule points to Operations; the original defining ceilings paragraph is selected again. |
| `crates/snapback4-lang/src/guide/feeds.md` | Says 50 immediately, then the rest of a 1,000-event window. Refusal rows now state their reason as well as their repair. The final compatibility section defines the older profile-cap note. |
| `crates/snapback4-lang/src/guide/search.rs` | Added separators at both boundaries of the included membership-search text. |
| `crates/snapback4-lang/src/guide/rules.md` | Defined `E_RULE` before the table that merely lists it. |
| `crates/snapback4-lang/src/guide/writes.rs` | Defined `NOT_FOUND`, `E_INPUT` and `E_CONFLICT` before their earlier incidental mentions. |
| `crates/snapback4-lang/src/guide/services.rs` | Copied the ten existing OIDC refusal paragraphs verbatim from `SERVER.md`, before the reference-only code list. |
| `crates/snapback4-lang/tests/guide.rs` | Pins the complete backfill sentence and the exact older-posts sentence within the Following contract; registers the new definition tests. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Adds the all-code definition census, the specific bounds excerpt assertions, the exact search heading assertion, and the all-card heading separator check. |
| `crates/snapback4-lang/tests/guide/feeds.rs` | Creates the lowest id last, retains a tied pair, and tests published `unrepost` after delivery to the owner and follower. Shares compilation of the published block between the two tests. |
| `JOURNAL.md` | Appends the dated implementation and qualification entry. |
| This report | Records scope, decisions, regressions and qualification. |

## Audit and scope decisions

Reviewed the first prose paragraph selected for every one of the 195 registered
codes, across 25 default cards. Compared the selections before and after the
round-2 reordering. `E_BOUND` was the displaced definition. The wider requested
audit also found older reference-only OIDC excerpts, write-refusal listings,
and feed rows that gave only a repair. Those now carry definitions. The OIDC
paragraphs retain the published reference's exact wording.

The regression has a separately reviewed defining fact for every registered
code. It checks the actual card excerpt, excluding the code registry's opening
summary, and requires the same excerpt from `why` and repeated diagnostics.
New codes must acquire a reviewed fact. It does not derive expected facts from
the paragraph selector or automatically accept whichever paragraph comes first.

Scanned all 29 canonical rendered cards for headings attached to prose and for
missing blank lines before headings. The reported search boundary was glued;
the other include boundary lacked a blank line. Both are fixed. Every card's
first paragraph is unchanged from round 2; its old/new lead audit remains in
`reports/20260924-feeds-and-card-leads-r2.md`.

No new Quarry form was needed. Every modified card's Quarry block is unchanged
byte-for-byte. The existing feed forms still compile without diagnostics or
notes and execute in the guide tests:

| Form | Published example |
|---|---|
| Planned Global union | `view activity:` with posts and reposts branches; `return activity last 20 by .at after c { *, card: posts[.post] }` |
| Materialized Following | `view following: activity where .actor = viewer or exists follows[viewer, .actor]` |
| Bounded Trending predicate | `return posts where .at > now - 1d and .at <= now and not .removed last 10 by .likeCount, .at after c` |
| Repost removal | `mutation unrepost(postId: posts):` followed by `delete reposts[viewer, postId]` |

## Tests and negative controls

| Test | What it proves |
|---|---|
| `why_bound_defines_the_ceiling_and_withheld_count` | The card excerpt names the examined and write ceilings, the refusing meter, ceiling and site, and the reason counts are withheld. The registry's summary cannot satisfy the assertions. |
| `w11_every_registered_code_quotes_its_definition` | Every registered code selects its defining facts on its default card; CLI and inline diagnostic excerpts agree. |
| `search_membership_heading_is_a_separate_output_line` | The output has an exact `## Search every chat I'm in` line. |
| `every_card_separates_headings_from_prose` | All canonical cards keep headings at line starts and separate them from previous content. Fenced examples are excluded. |
| Existing Following-contract text test, strengthened | The first 50 are part of the 1,000-event window, and older posts remain in `posts`, not an invented profile. |
| Existing published Following execution test, strengthened | `p0000` is later than `p1004` and must lead both own and delivered pages. `p1004` and `p1003` still tie on time, so the id tiebreak remains tested. The 1,005 originals, reply exclusion, immediate 50 and total 1,000 window remain covered. |
| `published_following_unrepost_hides_the_delivered_event` | The owner and follower first see the repost, including `post`, `actor` and `repost`; published `unrepost` hides it for both before cleanup, retains the original, and stays correct after cleanup. |

Nine deliberate mutations failed at their intended assertions:

1. Restore the early heap-section `E_BOUND` mention.
2. Restore “immediately and backfills up to 1,000.”
3. Restore “Older posts remain on the author's profile.”
4. Replace published `unrepost` with `return null`.
5. Remove the separator before the membership-search heading.
6. Remove the blank line before the admin-search heading.
7. Remove `at` from the generated `byReaderTime` index. The test fails with
   `p1004` where `p0000` is required, after clean compilation.
8. Restore the pre-fix definitions in bounds, feeds, rules, services and writes.
   The census reports 31 missing defining facts.
9. Put an incidental `E_INDEX_KEY_BYTES` paragraph before its definition.

Each mutation was isolated and restored byte-for-byte before the final checks.
During test development, the new repost assertion initially confused the source
row id with the distinct feed event id. Corrected the test to compare the event
id across both readers. This was an introduced test failure, not an engine bug.
The new heading scan also caught the second separator before qualification.

## Qualification

- Frozen Bun install passed: 506 installs across 500 packages, no changes.
- Guide tests: **66 passed, 0 failed**.
- CLI check/why/diagnostic tests: **68 passed, 0 failed**.
- One full `scripts/test.sh` run: **`== 0 failure(s) in 399 s`**, exit 0.
  No introduced, baseline or environmental suite failures. The complete log
  contains no failure markers. Client tests: 1,088 passed, 10 skipped.
- `git diff --check` passed. Largest changed Rust source: 1,192 lines.
- Feeds: 303 lines. README unchanged at 292/300 physical lines; no budget raised.
- WASM unchanged: 1,744,842 B raw / 484,967 B gzip; budget 486,000 B.

Logs are under `~/sb4-intent/`: `lane-f-r3-bun.log`, `lane-f-r3-guide.log`,
`lane-f-r3-check.log`, `lane-f-r3-suite.log`, `lane-f-r3-mutations.log`, and
`lane-f-r3-mutant-*.log`. Initial red evidence is in
`lane-f-r3-before-fixes.log` and `lane-f-r3-guide-initial.log`.

## Deviations and open problems

No round-3 scope deviation or newly open problem. The all-code audit required
the additional definition repairs described above. No current form changed.

The inherited full-history search example still deliberately emits its asserted
`N_NO_HORIZON` note. Its source and exact test exception are unchanged. Reproduce
by copying the first Quarry block in
`crates/snapback4-lang/src/guide/search_all.md` into an otherwise empty project's
`snapback/schema.q` and running `snapback4 check`. The existing
`every_card_compiles_clean` test pins this `search`, block 1 exception. A horizon
would change that example's full-history contract; suppressing the note would
hide acquisition cost. All feed blocks remain silent. No new exception was added.
