# Clique on Snapback 4 0.1.0 — the whole brief, Astra medium

**Status: complete.** The continuous session (2026-09-12 23:30 – 2026-09-13
01:27 UTC, 7,002 s) went green on every milestone of the full brief — media,
view-once, server-enforced expiry with no client open, the scheduled digest,
nothing struck; the independent grade passed 84 of 101 assertions (100 of 119
by independent execution before one coverage adjudication), with two majors,
one of them read against today's main below; the M7 day-two session
delivered its polls, its backfilled count and an exact migration comparison
but closed `capability-failure` on the one assertion that the previously
green M1 suite still passes, because the app's logout crash (the grade's
d-01) was already there and the rules say preserve, not repair. Every
Snapback-attributed finding was fixed on main and published the same night
(0.1.1 through 0.1.8).

Commissioned by Charlie Cheever 2026-09-12: "complete snapback4 to the point
where the entire clique benchmark can be run". This is the second Clique run
of the Snapback 4 candidate and the first on the whole brief; the first,
with media and scheduled work struck, is
`benchmarks/runs/2026-09-12-snapback4-clique-0002/`.

## Packet

| | |
| --- | --- |
| Packet | `~/clique-sb4-20260912-full/` (retained on the control machine) |
| Instrument | the same read-only snapshot the struck run used (the repository's brief, protocol, schema, fixtures and tools at the commit in the packet's `INSTRUMENT_COMMIT`) |
| Overlay | `ENVIRONMENT.md` beside this file: nothing struck |
| Snapback 4 | the published npm package `snapback4@0.1.0` with its platform binary `snapback4-darwin-arm64@0.1.0` (exact pin; the lane installed from the registry): expiry (`expire at .col`), assets (upload, authorized serving, `once`), jobs and schedules, on the 0.0.16 core |
| Start packet | the package README (the whole published surface on one page), `npx snapback4 guide` and its cards (now including `expire`, `assets`, `jobs`), `npx snapback4 why`, the generated `api.ts` |
| Builder | codex-cli 0.154.0 `exec`, `gpt-6-astra`, reasoning effort medium, one continuous session M1 → M2 → M3 → M4 → M5 → M6 → M8 |
| Host | macOS arm64, Apple M5 Max, 18 cores, 128 GB; ports 49300–49319; the lead session built, tested and published the fix-forward releases on the same machine while the lane, the grader and M7 ran (the grader's trace records load 12–20 during its suite runs) |
| Evidence level | N=1; tokens harness-native (codex); calibration, not a claim-eligible magnitude (LLP 0201 D5) |

## Phases

| Phase | State |
| --- | --- |
| Continuous builder | **complete**: start 1789255852, end 1789262854 (7,002 s; the report closed at 1789262924); M1–M6 and M8 green, M7 not-run by design; closure walls M1 654 s, M2 607, M3 716, M4 151, M5 673, M6 1,180, M8 2,945; the scale replay settled 167,157 actions in 512 s on a fresh instance and verified against the invariant manifest; `builder-final-report.md`, `builder-essay.md`, `builder-diary.md`, `builder-run-log.md`, `record-astra-snapback4.json` beside this file |
| Independent grade (fresh Claude session on the frozen grader prompt) | **complete** (claude-opus-5, uncalibrated grader — the claude family is uncalibrated at N=1 — not contaminated, one rerun used): 84 pass / 1 fail / 16 not-run of 101 assertions; coverage spot-verification `dishonest` on one of 17 sampled mappings (m3-a11, a quote-jump test that asserted only a bubble count; the grader shows the jump does not happen), which adjudicates M3 to capability-failure for O1 alone; defects 2 major, 2 minor, 4 cosmetic; O1 62, O2 48, O3 null (no holdout set), O4 35 (no native simulator proof for the M6/M8 assertions; the web choreography shows ordered warm-offline flush, dual-client convergence and cross-device read state), O5 band 30 (the following-feed ratio 19.2× against ≤3×; the cold-sync probe's timeout); `grading-astra-snapback4.json`, `grading-astra-snapback4.trace.md` beside this file |
| M7 day-2 evolution (fresh Astra session, same lane) | **complete: capability-failure** in 1,386 s (start 1789265724, end 1789267110): group polls with unique changeable votes and durable offline intents, a backfilled maintained count grouped by conversation, tombstone and expiry, the pre/post snapshot comparison exactly equal for every M6 field, all previously green suites passing except M1 — which fails at logout/signup navigation with the pre-M7 schema too (the grade's d-01), preserved as the rules require — so m7-a09 fails and the frozen choreography's segment reads non-green by suite linkage; `m7-astra-snapback4.md`, `m7-astra-snapback4.run-log.md`, `m7-astra-snapback4.diary.md` beside this file |
| Record and validation | **complete**: the lane's own `record-astra-snapback4.json`; this README is the record |

## What the lane found in Snapback 4 during the run

Recorded here as the lane attributed them in `run-log.md` (31 correction
events in the builder phase: 20 agent, 4 environment, 4 ambiguous, 3
package; nine grouped loops in M7: 3 agent, 1 environment, 3 ambiguous, 2
package); each was fixed on main the same night and published after the
lane's pin (the lane keeps 0.1.0 for the whole run):

| Attribution | Finding | Fix |
| --- | --- | --- |
| snapback4-defect (M1) | the backend accepted TCP but `/schema` answered after 2 s once two clients were writing: the wire served requests from a pool of four threads, and every connected device holds one long poll open, so a fifth request waited behind the polls (reproduced: four polls, `/schema` in 14.5 s; also the struck run's d-04, read then as host load) | 0.1.1: one thread per request; twelve polls open, `/schema` in 1.4 ms |
| snapback4-defect (M2) | a video argument carried only the upload's id, so `require clip.duration <= 60000` raised `E_FIELD` inside the mutation: the server's facts reached the row at the write, after the program had read the argument; the lane checked the 60 s bound on the client and disclosed it | 0.1.2: an `image`/`video` argument naming the writer's own upload carries the server's facts before the program runs, every key present and null where the kind has none |
| snapback4-defect (M2, knowledge) | the README described a `maintain` as a row read "by group"; the read is the number | 0.1.2: README |
| snapback4-defect (M5) | the `expire` card wrote `now + ttl if ttl`, prose in the shape of code that the grammar lacked; `E_QUARRY_SYNTAX` | 0.1.3: Quarry gains `a if cond else b` (the untaken arm never evaluated, `x != null` narrowing in the taken arm); the card and the README say `expiresAt: now + ttl if ttl != null else null` |
| snapback4-defect (M8, knowledge) | `sum(page, .x)` as the README spelled it was refused; a bare `return` was refused; `/` was found only through its diagnostic | 0.1.4: `sum(page, .x)` is real (a loop pushing each row's field, then the sum, on both hosts); a bare `return` is `return null`; the README says there is no `/` and what `divmod` binds |
| ambiguous (M8), read here as the package's | the unattended digest proof asserted 1.5 s after the two-minute boundary and found nothing; the restarted backend then fired the schedule once for that boundary | 0.1.5: the server's clock ticks once a second (a quiet tick is a few index probes) |
| capability gap (M6/M8 scale) | the cold-sync probe for `u0500` on the memory store over the 990,355-row corpus blocked Node past 30 s at 2.2 GB: one snapshot response for a partition of 227,699 public rows plus a group's 490,000 receipts, because the schema synced posts, follows, likes and feed entries `public` and messages and receipts with no `last N` | 0.1.6: the snapshot is paged (`next` tokens, one short transaction per page on each side, the first page clears, the watermark lands with the last, the next page fetched while this one applies); `check` notes every synced table without a horizon (`N_NO_HORIZON`) with the line to add; the README says the memory store is for tests and Node opens SQLite |
| snapback4-defect (M8 closure) | queued writes did not always flush in submission order: the outbox flushed by id, and two ids minted in one millisecond ordered by their entropy; the lane re-ordered them through the client's `fetch` and `store` seams and declared it as reading the installed package's `dist/local.js` | 0.1.7: ids minted by one process strictly increase; each write takes a submission number at admission, persisted with the entry and flushed by; twenty offline sends in one burst arrive in order |
| performance (O5) | the following feed merged `[f.followed] for f in follows[viewer] first 1000`: a thousand lanes, a page of 21 each, 21,000 rows per read, past the meter and 19.2× the five-lane read | 0.1.8: `check` notes a merge whose lanes may exceed fifty with its row count and names the fan-out-on-write shape (a table of entries per reader, synced to `.reader`); the feed's shape stays the app's to change |
| snapback4-defect (M7) | a maintained count over an expiring table counts an expired row until the sweep (within five seconds on 0.1.0, one since 0.1.5) while a read of the row is null at once; the session's strict assertion at the instant of expiry failed and it built expiry buckets | 0.1.9: the `expire` card and the README say so; an aggregate is exact within the sweep's tick |
| snapback4-defect (M7, knowledge) | `sum(page, .value)` refused (the 0.1.4 fix, unseen on the pin); `expire` on a `maintain` unsupported | as above; `expire` is a table line, and a maintained value row has no lifetime of its own |

Not attributed to the package, recorded for the comparison: the app's
logout crash (d-01, `client.session().token` read in an effect's cleanup
after `signOut()` — the card types `session()` as nullable), the push-seam
log not applying revocation (d-03), the lane's `API.md` documenting only
`dev` and an unauthenticated `/seed` (d-04; `deploy` and `serve` are the
README's §6), and four cosmetic findings in the app.

## Anchors, for the comparison

Other Astra-at-medium lanes on the same brief. Clocks are wall seconds from
the lane's start to each milestone's closure (this run and the struck run:
closure; the Sep 5 wave: first retained green). N=1 each; calibration, not
a magnitude.

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 | Total | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Snapback 4 0.1.0**, this run | 654 | 1,261 | 1,977 | 2,128 | 2,801 | 3,981 | 6,926 | 7,002 | the whole brief; every milestone green; graded 84/1/16, O1 62, O2 48, O4 35, O5 band 30 |
| Snapback 4 0.0.2, 2026-09-12 (`…-clique-0002`) | 873 | 1,416 | 2,922 | 3,601 | 5,030 | 6,013 | 7,128 | 7,725 | media and scheduled work struck; graded 69/2/9 of 80 applicable, O1 78, O2 48, O4 72; M7 green in 917 s |
| Snapback 2 0.0.29, 2026-09-12 (`…-snapback2-clique-0029`) | 469 | | | | | | | 13,667 | including a 6,146 s scale replay; M1–M6 plus M8 web-green; graded O1 73, O2 55, O4 65 |
| Snapback 2 0.0.4, 2026-09-05 | 449 | 1,184 | 1,916 | 2,511 | 5,599 | 6,208 | 7,885 | | M1, M2, M5, M6 later regressed and were recorded `aborted` |
| Convex 1.45.0, 2026-09-05 | 792 | 1,577 | 1,881 | 2,148 | 3,185 | 4,475 | 5,643 | | every milestone green; no capability failures |

## What the builder wrote (essay, after M8)

`builder-essay.md`, in its own words: the backend "was a schema,
authorization rules, indexes, synchronization declarations, queries,
mutations, and jobs in one Quarry file"; "the most successful part of this
experience was the connection between authorization and synchronization";
expiry and assets "were similarly useful primitives … A view-once photo had
an access lifecycle rather than merely a frontend boolean"; the compiler
"identified missing expiry indexes, nullable references, unsupported terms,
and operations whose reads could not establish completeness"; but "the
published documentation and accepted syntax did not always agree … together
they added a substantial discovery tax to an otherwise compact backend"
(every mismatch it names is fixed above); the scale replay "was a strong
part of the package experience"; and of the cold sync and the feed, "those
results are not merely language defects. My receipt design broadcasts
individual recipient receipts to conversation members … Snapback made the
sync policy easy to declare; it did not make a costly policy cheap."

## The environment overlay

# Clique on Snapback 4 — environment overlay (authoritative over the brief on environment facts only)

This run is **M1 → M2 → M3 → M4 → M5 → M6 → M8** of `social-messenger.md` in one
continuous session, in that order, **with nothing struck**: media (avatars,
image and video posts, photo and video messages, view-once photos, chat
background images, asset revocation), server-enforced expiry with no client
open, and the scheduled daily digest are all in scope exactly as the brief
specifies them. **M7 is a separate fresh session run later by the orchestrator
after grading; do not attempt it.** Where this file and the brief conflict on an
*environment* fact, this file wins; on a *product* fact the brief wins.

Nothing is `struck-by-environment` in this run. Every assertion in
`schema/social-messenger/assertions.json` is graded at the brief's bar; a
requirement the platform cannot meet is recorded as `capability-failure` with
the exact diagnostic, never omitted.

## Host

- macOS arm64, Apple M5 Max, 18 cores, 128 GB RAM. One lane runs on this
  machine; other processes may share it.
- Node **24.18.0** is first on your PATH via an absolute toolchain directory
  (`~/.volta/tools/image/node/24.18.0/bin`). If a tool hangs at exit, use the
  absolute node. Bun 1.3.12 is available. **No docker.**
- Playwright chromium is not pre-installed; `npx playwright install chromium`
  inside your copied choreography directory installs it (network is available).
- iOS simulators exist (Xcode, iPhone runtimes). Android is out of scope.

## Instrument

`./instrument/` is a read-only snapshot of the repository's benchmark instrument
(commit in `../INSTRUMENT_COMMIT`): the brief `social-messenger.md`,
`CONTRACT.md`, `protocol.md`, `schema/` (assertion manifest with executor
classes; run-record schemas), `fixtures/` (personas, starter segments
`starter-m1.log`, `starter-m2.log`, `starter-m3.log`, `sample-50.log`, the
hash-pinned `scale.log`, window and digest configs, `media/`), `ui/` (the
frozen UI kit), `choreography/` (the two-client Playwright harness), `grader/`,
`metering/`, `observability/`.

**Do not write into `./instrument/`.** Copy `instrument/choreography` into your
lane directory before `npm install` there, and pass `--receipts` so receipts land
in your lane. Copy fixtures you need; never modify them.

## Seeds

Replay each starter segment through the app's own write path when its milestone
first needs it (M1: `starter-m1.log`; M2: `starter-m2.log`, media lines
included — the fixture assets are under `fixtures/media/`; M3:
`starter-m3.log`). The scale replay (`scale.log`) runs as the brief says:
adapter authored inside M6's budget, executed on its own recorded clock against
a **fresh** backend instance seeded with the starter log, verified against
`invariant-manifest-combined.json`, media actions included.

## Ports and processes

Use only the port range named in your prompt. Record every server PID you start
in `run-log.md` and kill only those PIDs at the end; never `pkill`, `killall`, or
any pattern kill — other work shares this machine.

## Green bar

A milestone is green only when (1) `npm run acceptance -- --milestone mN` passes
with a coverage manifest mapping every suite-required assertion of that milestone
(`instrument/schema/social-messenger/assertions.json`) to a test, and (2) the
matching two-client choreography segment passes for every check. Record `green`,
`capability-failure`, `aborted`, `blocked-by-M{n}`, or `not-run` per milestone
exactly as the brief defines them. Safety limit: **four hours of wall clock per
milestone**; on exhaustion record `capability-failure` and proceed to the next
non-blocked milestone. Two consecutive capability failures end the lane.

## Tokens

Token accounting is harness-native (codex JSON events). Do not estimate tokens
in prose.
