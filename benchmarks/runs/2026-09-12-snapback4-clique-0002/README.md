# Clique on Snapback 4 0.0.2 — media and scheduled jobs struck, Astra medium

**Status: complete.** The continuous session (2026-09-12 14:11–16:20 UTC)
went green on every milestone in scope; the independent grade passed 69 of
80 applicable assertions with two majors, both read against today's main
below; the M7 day-two session went green in 917 s. Every Snapback-attributed
finding but the expiry gap was fixed on main and published the same day
(0.0.4 through 0.0.16).

Commissioned by Charlie Cheever 2026-09-12: "do a clique benchmark run that
skips media and jobs and uses astra medium". LLP 3000 §3 names the Clique hub
run as one of the bakeoff's measurements; this is the first run of the
Snapback 4 candidate on the benchmark, one week into its four-week clock.

## Packet

| | |
| --- | --- |
| Packet | `~/clique-sb4-20260912/` (retained on the control machine) |
| Instrument | the repository's `benchmarks/briefs/social-messenger.md`, `protocol.md`, `schema/`, `fixtures/social-messenger/`, `tools/social-messenger/{CONTRACT.md, ui, choreography, grader, metering, observability, record-validator.mjs}` at the commit in the packet's `INSTRUMENT_COMMIT`, copied read-only |
| Overlay | `instrument/ENVIRONMENT.md` (copied below): media struck (avatars, photo/video messages, view-once, chat backgrounds, simulator artifacts); scheduled server-side work struck (the daily digest; expiry enforced at read time); everything else at the brief's bar; struck assertions recorded `struck-by-environment` |
| Snapback 4 | the published npm package `snapback4@0.0.2` with its platform binary `snapback4-darwin-arm64@0.0.2` (exact pin; the lane installed from the registry) |
| Start packet | the package README (the whole published surface on one page), `npx snapback4 guide` and its cards, `npx snapback4 why`, the generated `api.ts` |
| Builder | codex-cli 0.154.0 `exec`, `gpt-6-astra`, reasoning effort medium, one continuous session M1 → M2 → M3 → M4 → M5 → M6 → M8 |
| Host | macOS arm64, Apple M5 Max, 18 cores, 128 GB; ports 49200–49219; the loop-bar runs (`snapback4/loopbar`) shared the machine from 14:31 UTC |
| Evidence level | N=1; tokens harness-native (codex); calibration, not a claim-eligible magnitude (LLP 0201 D5) |

## Phases

| Phase | State |
| --- | --- |
| Continuous builder | **complete**: start 1789222278, end 1789230003 (7,725 s); M1–M6 and M8 green, M7 not-run by design; `builder-final-report.md`, `builder-essay.md`, `builder-platform-gaps.md`, `builder-diary.md`, `builder-run-log.md`, `record-astra-snapback4.json` beside this file |
| Independent grade (fresh Claude session on the frozen grader prompt) | **complete** (claude-opus-5, uncalibrated grader, not contaminated, one rerun used): 69 pass / 2 fail / 9 not-run / 21 not-applicable (struck) of 101 assertions; coverage spot-verification `honest`; defects 2 major, 2 minor, 1 cosmetic; O1 78, O2 48, O4 72 (O3, O5 null: no holdout set, no scale band in this scope); `grading-astra-snapback4.json`, `grading-astra-snapback4.trace.md` beside this file |
| M7 day-2 evolution (fresh Astra session, same lane) | **complete: green** in 917 s (start 1789233309, end 1789234226): group polls with idempotent vote intents, a backfilled conversation message count, pre/post snapshot equality for eight personas, all prior suites and the M7 choreography segment passing; two Snapback-attributed lines, both the day-two aggregate backfill (0.0.16); `m7-astra-snapback4.md`, `m7-astra-snapback4.run-log.md`, `m7-astra-snapback4.diary.md` beside this file |
| Record and validation | **complete**: the lane's own `record-astra-snapback4.json` validated by the lane; this README is the record |

## What the lane found in Snapback 4 during the run

Recorded here as they were attributed in the lane's `run-log.md`; each was
fixed on main the same day and published after the lane's pin (the lane keeps
0.0.2 for the whole run):

| Attribution | Finding | Fix |
| --- | --- | --- |
| snapback4-defect | `read <- public 'reason'` refused by the parser; only the table line `public 'reason'` parsed, while the README and the rules card listed the reason on the rule | 0.0.4: the parser takes the reason on the rule |
| snapback4-defect | a mutation the device refuses while predicting (a `require`, a unique clash) aborted the IndexedDB transaction on purpose and the abort surfaced in the page as an unhandled "aborted" beside the `failed` write | 0.0.4: the store owns the rejection; the Chromium witness requires no page errors |
| environment / snapback4 | killing the `npx snapback4` wrapper did not stop the binary ("Address already in use" on restart) | 0.0.4: the wrapper forwards signals |
| docs | the wire's `/auth/*` response shapes were not written down; the `sync` card said "contains the matching disjunct" where the validator requires the rule to be exactly the audience | README and card corrected (0.0.3, 0.0.4) |
| environment | the packet lacked `lib/json-schema.mjs`, which the choreography harness imports from the instrument's sibling directory | added to the packet for the later phases |
| snapback4 (secondary) | the online client reported an HTTP 400 refusal as "unreachable" | 0.0.5 |
| snapback4-defect (M3) | under `retain delivered-history` the device kept a left conversation's messages but hid every one, re-evaluating the read rule the server had already applied | 0.0.7: a synced table's rows are the partition; the device runs no read rule on them (LLP 3000 §7) |
| snapback4-defect (M3, repeat) | the IndexedDB abort page error, met again while predicting typing state | the 0.0.4 fix; counted twice by the lane on 0.0.2 |
| snapback4-defect (M3) | two writes issued at once on a healthy link: the second stayed `pending` until the next link change (a flush read the outbox once) | 0.0.8: a flush runs another pass for writes queued during it |
| snapback4 gap (M5, knowledge) | read-time expiry cannot be a read rule: rules compare with `=`/`!=` only (no `<`/`>` against `now`), and a rule that varies with time could not be an audience anyway; the lane filters expiry in its queries and purges from the client, so raw `/sync` and a history read cannot promise refusal before the purge | open: an `expires .col` clause on `sync` (the stream, the snapshot and the device's reads all exclude rows past it) is the shape; recorded as a follow-up, not struck |
| snapback4-defect (M5) | a screen navigating between two components observing the same query key rendered a stale value: the unmounting component's close removed the shared watch a moment before the mounting one subscribed, leaving it on a watch nothing updated | 0.0.12: a subscriber returning to a closed key re-registers and refreshes the watch (both clients); end-to-end test |
| snapback4-defect (M6) | a shaped history (`page { id, body, author: .. }`) dropped the card's `pending` word from the device's predicted rows, so a shaped screen could not show "Sending…"; the lane read the raw rows instead | 0.0.13: a shape built from a pending row is pending on the device |
| snapback4-defect (M6) | a device restarting with no network could not open its client at all, because the client fetched `/schema` before opening the replica it already held; the lane cached the schema itself through the `fetch` option | 0.0.14: the client opens the store first, keeps the compiled backend in it, and starts offline from the cache when the server is unreachable |
| snapback4-defect (M8, docs) | the README wrote `sum messages.x by ..`; the grammar is `sum <table> of <column> by ..` | 0.0.15: README |
| snapback4-defect (M8) | `upsert likesCount[postId]` on a table with a unique key over a reference was "ambiguous" between that key and `byId` (an id compares with a reference), and the rewrite named `byId` | 0.0.15: the index whose column types are the key's types is chosen |
| snapback4-defect (M8) | `snapback4 data` beside a running `dev` that was adopting a schema change raced it on the catalog: `E_STORE: UNIQUE constraint failed: _catalog.name`, and the adoption failed | 0.0.15: installs take the write lock first and re-read the catalog under it; the store waits up to five seconds for a lock |
| snapback4-defect (M7) | a `maintain` added on day two reported a rebuild but counted nothing that already existed (zero for old conversations, right for new writes); the session built its own paged ledger | 0.0.16: `adopt` builds every added or redefined aggregate from the rows in the store, fanned out to the partitions; a release over an old store builds unbuilt ones on open |
| snapback4 (M7, classifier) | adding optional columns with their own constraints classified as Narrowing | 0.0.16: only constraints over pre-existing columns and indexes narrow |
| snapback4-defect (M4) | `check` accepted `reactions` synced to a group with no index leading with the group column; the first `/sync` failed `E_SCHEMA` (503) and the client showed an empty partition with `fresh: false`, silently | 0.0.9: the validator requires the group index with the rewrite; a non-retryable refusal answers 500 and the client makes every read `denied` with it, once loudly |

## Anchors, for the comparison

Other Astra-at-medium lanes on the same brief, on this machine or its
predecessor as control plane. Scopes differ: this run strikes media and
scheduled work; the anchors ran the full brief. Clocks are wall seconds from
the lane's start to each milestone's first retained green (cumulative); the
Sep 5 wave ran three lanes in parallel on one machine, this run shares the
machine with the loop-bar runs. N=1 each; calibration, not a magnitude.

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Snapback 4 0.0.2**, this run | 873 | 1,416 | 2,922 | 3,601 | 5,030 | 6,013 | 7,128 | every milestone green in one continuous session; media and scheduled work struck; the expiry gap disclosed in the lane's `platform-gaps.md`; the full scale replay (167,157 actions) verified inside M6 |
| Snapback 2 0.0.4, Astra, 2026-09-05 (`~/clique-full-20260905`) | 449 | 1,184 | 1,916 | 2,511 | 5,599 | 6,208 | 7,885 | M1, M2, M5, M6 later regressed and were recorded `aborted`; M3, M4, M8 green |
| Snapback 2 0.0.29, Astra, 2026-09-12 (`benchmarks/runs/2026-09-12-snapback2-clique-0029`) | 469 (first green proof) | | | | | | | 13,667 s total including a 6,146 s scale replay; M1–M6 plus M8 web-green, then graded O1 73 / O2 55 |
| Convex 1.45.0, Astra, 2026-09-05 | 792 | 1,577 | 1,881 | 2,148 | 3,185 | 4,475 | 5,643 | every milestone green; no capability failures |

## What the builder wrote (essay, after M8)

The lane's `essay.md` (copied here when the phase closes) says the center
of the application was "unusually compact" — the data model, ownership
rules, sync audience and mutation intent in one Quarry program, with
follows and reactions as set-state intents behind uniqueness constraints
and no resolver layer — and that "several edges" were "unusually
demanding": expiry (a time comparison is not a rule; a guarded point read
was built and the gap disclosed), cold restoration fetching the schema
before opening the durable replica, a stale settings screen after
navigation between two components on one query key, retained history
hidden by local rule evaluation after a leave, the README's maintained-sum
spelling, and an index rewrite the upsert position did not accept. Every
edge but expiry was a defect fixed on main the same day (0.0.7, 0.0.12,
0.0.14, 0.0.15). Insights showed "the upside of those constraints":
server-computed totals over maintained aggregates instead of paging; the
plain JSON protocol and stable mutation ids made the replay adapter
"straightforward" and the full scale replay verified. The builder's
preference is "conditional": a relational application whose authorization
and synchronization rules fit Quarry, especially with offline writes at
the center, budgeting time for client lifecycle validation.

## The grade's defects, against today's main

| Defect | Severity | Disposition |
| --- | --- | --- |
| d-01 receipt-row updates never reached the sender's established replica in a group, even across a reload | major | not reproduced on 0.0.15 at the client level (the lane's schema, three clients, acknowledgements arrive within 3 s and survive a reload); the lane's UI on 0.0.2 likely sat on the orphaned-watch race fixed in 0.0.12 or its own aggregation; re-grade on a current pin owed |
| d-02 reactions through the UI intermittently never visible on the peer; the API path fine | major | the flush that read the outbox once (0.0.8) |
| d-03 a push payload dropped within ~12 s of an abrupt disconnect | minor | the lane's presence-lease design for the push seam |
| d-04 live updates intermittently past the 10 s budget | minor | load average 17–25 on the shared host (the loop-bar sets ran beside the lane) |
| d-05 `/q/history` short page with `complete: false` and no `next` | cosmetic | a cursorless page on the meter's cut; documented by the lane; `check` notes it today |

## Results

| Phase | Outcome |
| --- | --- |
| Builder (M1 → M2 → M3 → M4 → M5 → M6 → M8) | all green; 7,725 s wall; the full scale replay verified; twelve Snapback-attributed lines, eight distinct findings |
| Grade | 69 pass / 2 fail / 9 not-run / 21 struck of 101; coverage honest; 2 major / 2 minor / 1 cosmetic; O1 78, O2 48, O4 72 |
| M7 | green in 917 s; two attributed lines (one defect, fixed) |

What this run says, and does not: one lane, one model, media and scheduled
work struck, on a machine the loop-bar sets shared; it is calibration for
the Snapback 4 candidate a week into its clock, not a claim-eligible
magnitude. What it measured is the builder experience on the published
package: every milestone in scope reached green in one session, the day-two
session inherited the app and evolved it without a migration step, and the
defects the builder and the grader met were each small enough to fix and
publish within the hour. The unfixed gap is expiry as a time-dependent rule
(`NOT-DOING.md`, the `expires` clause on `sync`).
