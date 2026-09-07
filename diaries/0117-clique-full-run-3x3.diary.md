# Diary 0117: Clique full run — Snapback 2 0.0.4 vs Convex vs Supabase, three builder models

**Date:** 2026-09-05 → 2026-09-07
**Author:** Claude (orchestration, harness, grading dispatch); builders: GPT-6 Astra (medium), Grok 4.6 (xhigh), Muse Spark 1.3 (xhigh, substituting for the requested but unavailable Muse 3.1 ultra); graders: Claude Opus 5 (uncalibrated); scorers: each builder family at xhigh
**Systems:** Snapback 2 (`snapback2@0.0.4`, Quarry, React/Expo arms, offline carrier, assets, effects, schedules), Convex 1.45.0 (anonymous local), Supabase (`supabase-js` 2.112.4, hosted project), the frozen social-messenger instrument (brief, fixtures, choreography, grader)
**Related:** LLP 1017 (the cap + complete fan-out rule this run pinned), LLP 1006, LLP 1012, LLP 1016, `benchmarks/runs/2026-09-05-clique-full-3x3/` (records, grades, M7 reports, holistic scores), the seventeen `issues/2026090[67]-snapback2-*.md` tickets

## What was run

Nine lanes: each of three builder models built the full Clique brief (M1 → M2 → M3 → M4 → M5 → M6 → M8 continuously, then the 167,157-action scale replay) once on each backend, alone and timed, from the published package and public docs only, never a source checkout. Then each lane was graded by a fresh other-family session against the frozen assertion set, and then a fresh session of the same builder model did the M7 day-2 evolution (group polls plus a backfilled message count, forcing a real migration) on the graded artifact. Finally each builder family scored all three backends out of 100, overall and across twelve categories, from its own three lanes' narratives.

Waves ran sequentially (astra 16:30Z 2026-09-05, grok 21:40Z, muse 01:25Z 2026-09-06 after a first attempt died fourteen minutes in on a provider outage). The harness, prompts, and scripts live outside the repository at `/Users/ccheever/clique-full-20260905/`; everything claim-relevant is copied into the run record.

## Outcomes

Builder outcomes (green means suite and choreography receipts):

| Lane | Milestones | Scale replay | Wall |
| --- | --- | --- | --- |
| astra-snapback2 | M3, M4, M8 green; M1, M2, M5, M6 green then self-downgraded after an end-of-run regression pass exposed accumulated staging-quota state | PASS on attempt 3 (attempt 1 refused by the builder's own `cap 100`) | 4.1 h + continuation |
| astra-convex | all green | verified | 94 min |
| astra-supabase | all green | verified | 111 min |
| grok-snapback2 | M1, M2 green; M3 suite only, choreography never green; M4–M8 suites only | unfinished | 3.0 h under load 45–112 |
| grok-convex | all green | verified (2,222 s) | ~2 h |
| grok-supabase | M1 green, then aborted | — | — |
| muse-snapback2 | **all green**, final regression all suites pass on the shipping bundle | PASS (1,047 s, checkpoints 10/50/final) | 8.25 h |
| muse-convex | all green after a continued session (the first idled after M5) | PASS, 67/67 invariants | 22 h elapsed, mostly idle |
| muse-supabase | all green per its report; closing steps done in a continued session | not recorded as verified | ~10 h |

Independent grades and M7 results are tabulated in the run record README. The short version: Convex lanes graded highest and most consistently, Supabase ranged from the best single grade (astra, 92 of 101 passing, honest coverage) to the worst (grok, 56 with four blockers), and Snapback 2 lanes graded 68 to 81 passing with one blocker each in two of them: the staging leak (astra) and a following feed that silently drops all but 40 follows (muse). Every completed M7 leg was green, on every backend, in 13 to 31 minutes of active work; the Snapback 2 migrations went through the schema successor with byte-identical persona snapshots.

Holistic scores (each family from its own lanes, overall out of 100): Snapback 2 64 / 57 / 78 (mean 66), Convex 84 / 78 / 82 (81), Supabase 77 / 47 / 62 (62) for astra / grok / muse.

## How Snapback 2 felt, across three builders

The three snapback2 diaries agree on the shape even where their outcomes differ.

**What was genuinely good.** The data model is the sync model: read, insert, and update rules, retain policies, and caps on the table, and a delivery log that gives each recipient a replica of what they may see. Password identity to a viewer-keyed profile read was one line. Set-state mutations with client mutation ids were idempotent by default. Size-bounded image and video columns replaced buckets and signed URLs. A typing channel with a five-second TTL was the whole typing indicator; a schedule on a row's expiry column was the disappearing-message timer. Maintained counts, backfill jobs, and a durable digest that survived a backend restart. And offline: a durable, ordered, idempotent outbox with restart recovery that the muse lane called "seven tests of behavior I never implemented" and every scorer put far ahead of both alternatives.

**Writing Quarry.** The first hours are spent getting the program to certify (index names, a reserved column name, list bounds, merge ceilings, effect grants); after that writes are fast. The vocabulary is small and the accepted-versus-refused forms of nullable references, optional access, loop populations, aggregate keys, and time are not interchangeable and not all documented. Time is nominal, except that adding zero to now yields a numeric epoch, and day bucketing cannot be expressed at all. A rule-denied lookup looks like a missing row. Bounds refusals give architectural repairs, not local ones.

**What made for slow going, worst first.**

1. The staging ceiling and its leak: an idempotent retry's early return leaves the already-staged upload unattached and nothing releases it; a handful of retries exhausts the per-principal and then the owner-wide ceiling, restarts do not reclaim, and there is no discard or sweep verb. This ended the astra lane's final validation and the independent grader rated it a blocker.
2. Certified ceilings that the brief walks into: the enriched following-feed merge certifies to about 360 follows against a 500-follow envelope; cap metering charges N examined per capped write, so a per-user cap of 1,000 made a 49-invitee group create uncertifiable (a direct cost of LLP 1017's metering rule, now ticketed); subscriptions per client hit 256 and crash the browser when a hook is mounted per row.
3. Client capability contracts discoverable only by probing: grant lifecycle, outbox entry states, drain completion, live echo shapes with nulled joins, the byte-path viewed guard with no refusal code, the per-origin navigator lock, the resume log cap. The best lane estimated a third of its build time went here.
4. Effects: authored fetch headers dropped, basic string methods refused in the TypeScript subset, a URL grant required even for a placeholder provider.
5. Single-cell asset custody: one upload per recipient for per-recipient grants, and no server one-use delivery, so view-once is a UI promise.
6. The Expo web path: Metro resolves the React entry to the RN export until aliased, RN-web strips the accessibility attributes the choreography reads, a filled input does not enable a disabled button. Two builders said the choreography bar was lost on observability in Expo web, not on wire correctness.
7. Reconnect identity flicker in the auth hook, one writer per partition making a second tab a separate database, delivered receipts as application rows though the delivery log already knows, no presence primitive, no text search, docs drift (README says the outbox is deferred while the guide says it shipped; unknown guide topics; stale-page errors after a clean check; no successor/migrations page).

**Against Convex and Supabase, in the builders' words.** Convex has the better developer experience today: documentation that answers, behavior predictable from reading, a per-query hook cheap enough to use per row, and the least assembly for connected transactions, live queries, and scheduling; it leaves offline entirely to the app and its reactivity is server-authoritative. Supabase gives full control of Postgres, Auth, Storage, and Realtime as separate systems with maximum visibility and maximum wiring burden; every cross-system guarantee is integration code the app owns, and its hosted signup throttle stopped one lane's scale replay. Snapback 2 collapses the systems and owns the seams, "which is bliss until a seam leaks, at which point Supabase's visibility beats Snapback's opacity." Muse's verdict for Snapback 2: "the powerful local-first choice, priced in probes"; grok's: "a better idea than Convex or Supabase, not yet a better path for a timed solo build if the grade is two-browser choreography."

## What the orchestration taught

- **Provider outages and idle loops dominate wall clock.** The muse CLI died on transport errors, idle-looped for seventeen hours after a session ended, and buffered its event log so silence looked like a stall. Completion must be read from marker files, not process state; continuation prompts that reconstruct state from receipts recovered both affected lanes.
- **Grade before M7.** M7 changes the artifact; the grade must bind the pre-M7 state.
- **Load is a confound, not an excuse.** The grok wave ran under load 45–112 and the last M7 legs under 300+ from unrelated indexing; the record says so beside every timing, and the scorers were told not to charge it.
- **Hosted Supabase is shared state.** Lanes drop their prefix at the end, so graders and M7 sessions recreate the schema from lane scripts; foreign residue under a sibling prefix is left alone.
- **The record is the deliverable.** Nine grading reports and traces, the M7 reports, the astra run records, the holistic score tables, and seventeen tickets are on main; the raw harness stays on the host.

## Deviations to read the grades with

No committed holdout probe set (O3 null everywhere), an uncalibrated Claude grader as the other family for all three builders, timing checks best-of-3 with load recorded, one lane graded on substitute ports because another program held its documented ports, the muse builder substituted for the requested Muse 3.1 ultra, and two lanes finished through continued sessions that are recorded as such. This is an N=1 calibration run, not a claim-eligible wave.

## Status of this diary

The grok-supabase M7 continuation and the muse-supabase M7 session were still running when this entry was written; their results are appended below when they land.
