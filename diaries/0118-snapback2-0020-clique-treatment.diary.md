# Diary 0118: Snapback 2 0.0.20 Clique treatment

**Date:** 2026-09-09
**Revised:** 2026-09-09 (review corrections: sampling, scoring scope and O1 adjudication, clocks, latency attribution, and evidence provenance)
**Author:** Codex (orchestration); builders: GPT-6 Astra (medium), Grok 4.6
(xhigh), Muse Spark 1.3 (xhigh); graders: fresh Claude Opus 5 sessions;
scorers: each builder family at xhigh
**Systems:** published `snapback2@0.0.20`, Quarry, the React and Expo client
arms, offline custody, assets, effects, schedules, the frozen Clique
social-messenger instrument
**Related:** LLP 1018, LLP 0201, LLP 0197,
`benchmarks/runs/2026-09-09-clique-snapback2-0.0.20-treatment/`, and the
2026-09-05 three-backend baseline

## Why this run happened

The September 5 Clique run scored Snapback 2 0.0.4 at 64, 57, and 78 in
the Astra, Grok, and Muse narratives, a mean of 66 against Convex's 81.
The scores agreed on the shape more than the exact number: Snapback's
authorization, offline, media, and write primitives were competitive, while
composition, client integration, diagnostics, and discovery made an agent pay
for them.

Charlie approved thirty concrete rulings across the chat template, Quarry,
diagnostics, the plain client tier, screen composition, and shipped bytes.
Those rulings landed before the package was published. The existing guide and
package documentation were then audited against the integrated surface, built
into the tarball, and exercised through an isolated install. The resulting
`snapback2@0.0.20` and `snapback2-darwin-arm64@0.0.20` artifacts were published
and registry-integrity checked before this treatment began.

This is a treatment rerun, not a fresh nine-cell benchmark. Three cold agents
built only the Snapback lane from the public package. Their same-family scorers
then read the new Snapback narrative beside that family's unchanged Convex and
Supabase narratives. Each score is one fresh session. The differences are
useful directional calibration, not a causal estimate or a promotion claim.

## The three builders

### Astra

Astra completed M1–M6 and M8 with green suites and required web choreography,
exported seven Hermes bundles, and ran the full 167,157-action replay. Every
action settled, all 225 invariants passed, and the 10%, 50%, and final
checkpoints were green. The first verifier run was red only because the agent's
verifier omitted the starter-author identity map; the same unchanged database
passed after the verifier was corrected.

That backend result did not make the scale experience green. The cold browser
sync repeat for 100 conversations exceeded thirty seconds in its first warm-up:
zero of 20 measured samples completed, and no p95 exists. The group send/render
check also exceeded thirty seconds. Observed heap grew from
roughly 31 MB to 364 MB, with a separate peak near 485 MB. At ordinary scale,
web sends took 5–9 seconds while direct Node mutations took 23–52 ms, leaving
the sender visibly pending for 7–9 seconds. Feed APIs could page hundreds of
rows, but the React surface stopped at twenty because `usePage` reported no
next page.

The independent grade's 101-key M1–M7 serialization subtotal was 83 pass,
9 fail, and 9 not-run, with honest coverage. Its eighteen M8 results were
16 pass and 2 fail, making the full 119-assertion O1 scope accounting
**99/11/9**. O5 is **band 30**, not null. It recorded three majors: React
pagination, web send latency, and cold-sync time/memory. Astra's holistic score
was 80, versus 64 for its 0.0.4 observation; its fresh control scores were
Convex 82 and Supabase 76.

M7 was a capability failure even though most of the evolution work succeeded.
Polls, live and offline voting, the migration, count backfill, and snapshot
preservation passed. The required a09 regression re-exposed the inherited feed
pagination and pending-reply failures. Forty-eight persona-visible records,
including fifteen distinct messages, survived the migration comparison; later
receipt advancement was the only allowed snapshot change.

### Grok

Grok reached green M1 and M2. Its M3 suite passed, but the two-client
choreography remained non-green, so M4–M6 and M8 were suite-only and correctly
reported as blocked rather than upgraded to milestones. It did not run the
scale replay.

The grader's 101-key M1–M7 serialization subtotal was 68 pass, 9 fail, and
24 not-run. M8 added 9/2/7, making the full 119-assertion O1 scope accounting
**77/11/31**. It found dishonest suite coverage, six majors, five minors,
and one cosmetic defect. Two majors look
like product seams worth fixing independently of this particular app: the
first profile write after signup was refused without a replayable grant in
three of three attempts, and messages took about 4.6 seconds, 39.4 seconds,
or never appeared inside sixty seconds after sending. All six commits were
verified only afterwards, so commit-versus-visibility timing remains unresolved.

The other four majors were predominantly application mistakes. The send path
stored `expiresAt: null` because the expiry calculation was trapped in a
nested lexical block; the app never called the procedure that advanced
`newPostsInFollowing`; periodic digests treated standing unread totals as new
activity; and a 223-character push preview was not truncated to eighty.

Grok scored the new Snapback narrative 67, versus 57 for its 0.0.4 narrative;
its fresh controls were Convex 80 and Supabase 49. In M7, all 6/6 suite-required
assertions passed (11/11 coverage), as did the snapshot comparison and live poll
tallies. Offline vote reconciliation did not. Adding poll fields to retained
message rows exceeded a closure bound, and the membership-scoped fill exceeded
the certified job-step budget; those were useful legibility findings even
though the milestone did not go green.

### Muse

Muse reported green M1–M4 and a green M5 suite. M1 and M4 retain direct
receipt-backed standing; the final lane admits that its post-fix M2 receipt
was not preserved and its M3 segment receipt is absent. The frozen M5
choreography then
became the run's longest correction loop. Its first attempt passed none of the
four required checks; later attempts separately made warm offline search,
expiry, color selection, background commit, and view-once upload state work,
but observer-side propagation and media rendering repeatedly missed the
thirty-second bar. Every attempt and its host-load context remain in the raw
lane. During this loop Muse also changed its copied `choreography.mjs`; the
final diff was 324 insertions and 12 deletions, rather than confining adaptation
to `adapter.json`.
The root frozen instrument remained unchanged and the segment hunks are
confined to M5 plus shared helpers, so M1–M4 keep their standing; later M5
receipts cannot establish a canonical green milestone.

At epoch `1788992935`, exactly four hours after M4 green, the orchestrator
stopped only the original Muse GUI service and its two children. A fresh
same-family xhigh closeout inherited the lane, attempted no repair, recorded
M5 as `capability-failure`, and applied the brief's dependency graph: M6 was
blocked by M5, M8 was blocked through M6, and scale was not run. It wrote the
essay and final report, cleaned the lane-owned backend PID, and ended at
`1788993273`; total lane wall was about 8.98 hours. Its independent grade
and the separate M7/scorer results follow.

The independent grade then tested the artifact rather than accepting those
milestone summaries. Its 101-key M1–M7 serialization subtotal was 80 pass,
5 fail, and 16 not-run, with honest coverage, one blocker, three majors,
four minors, and two cosmetic findings. M8 added eighteen not-run assertions
outside the JSON key map: full 119-assertion O1 scope accounting **80/5/34**.
Original O1/O2 were 62/34; O3–O5 were inapplicable. The fresh Claude
[O1 adjudication addendum](../benchmarks/runs/2026-09-09-clique-snapback2-0.0.20-treatment/grading-muse-snapback2-o1-adjudication.md)
corrects O1 to **28**. The frozen rule keeps all milestones in the denominator
but gives non-green milestones no completeness credit: only M1 and M4 qualify,
25/119 credited assertions. The 80 independently passing observations remain
unchanged, including 55 in non-green milestones. The original grader JSON/trace
are preserved; the addendum supersedes only O1's value and reasoning. O2–O5,
defects, coverage, and holistic scores are unchanged.

The blocker came from application deduplication after media upload. A
duplicate client key returned its old row without claiming or discarding the
new asset, eventually filling the owner-wide forty-object pending pool and
refusing every persona's media sends for twenty-four hours. The majors were
also application-local: an incorrect relative import prevented the M6 suite
from ever starting, duplicate compose test IDs made the reply screen
undrivable, and the web composer could not preview or submit video posts.
Independent replay made only M1 and M4 green under the frozen suite-plus-
choreography bar; M2, M3, M5, and M6 were non-green.

The fresh M7 session was a sharp contrast. In roughly twenty-five minutes it
added group polls with idempotent, changeable votes, live tallies, and an
offline vote that reconciled. Its feature suite passed 6/6 and the sole frozen
M7 choreography segment was green. The pre-M7 schema already exposed a raw
message-count maintain; the session added a composite visible-only maintain
and installed the additive successor without refusal. The eight-person
snapshot comparison found zero drift across 48 pre-existing message views;
the inherited M6 import failure remained red and untouched. The holistic score
then put Snapback at 48, against Convex at 82 and Supabase at 72. That scorer
read the builder narrative, not the later M7 repair, and penalized the M5
failure, blocked M6/M8, missing scale replay, and bespoke client recovery work.

## LLP 1018 measure count

The following is a conservative, cross-lane-deduplicated count against LLP
1018 §1. It describes the 0.0.20 build shape, not a causal delta attributable
to the thirty rulings. It excludes harness adaptations and mistakes the
graders located wholly in application logic.

| Measure | Count | Observed mechanisms |
| --- | ---: | --- |
| Application-owned infrastructure avoided | 7 | password/KDF and session service; a separate row-policy layer; authenticated object storage and once-view ledger; durable outbox/replay ledger; local held-row store and prefix index; subscription/invalidation coordinator; scheduler/job checkpoint store |
| Application-owned integration still added | 6 | same-origin gateway; signup-then-login bridge; explicit outbox/drain gating and receipt coalescing; authenticated blob-URL/retry choke; persisted paging/search stash; periodic tiny-query heartbeat |
| Contracts still derived from behavior | 7 | signup lacks a replay grant; connected writes can remain queued behind a serial drain; partial/loading snapshots require preservation rather than replacement; tokenless asset URLs do not serve web media; idle live pushes cluster and cold coverage is costly; the React page hook can terminate while server cursors remain; owner-wide media admission quota gives leaked pending uploads a platform-wide blast radius |

The media entry in the final row counts only the platform-wide blast radius
of owner-wide admission quota: one persona's leaked pending uploads can refuse
media sends for every persona. The early return after upload that caused the
leak is an application-local bug and is excluded from the 7/6/7 count. This
distinction preserves the exclusion above without hiding the blocker.

The first row is the intended platform leverage. The latter two rows explain
why that leverage did not produce a consistently smaller or more reliable
client across all three builders.

## What became more elegant

The best evidence is not that the backend learned new primitives. It is that a
cold agent could use more of the existing system without rebuilding its public
contract.

- The packaged guide was actually the source of truth. It contained the final
  live-query recovery guidance, offline contract, Quarry spelling, diagnostic
  forms, and shipped client surface. Astra and Grok each scored Snapback's
  setup/docs experience 78; their Convex controls averaged 76. Muse scored it
  58, however, leaving the final three-family mean at 71 versus Convex's 77.
  That mixed evidence does not support a causal documentation claim.
- Astra composed a full application through M8 and a verified backend replay.
  That is stronger than the 0.0.4 run's story of good primitives hidden behind
  corrective caches, permanent resume anchors, and experimentally discovered
  client rituals.
- Quarry's explicit index spelling, direct maintained reads, composition
  helpers, full diagnostics, and product-shaped chat template reduced several
  earlier translation loops. The agents still wrote substantial application
  code, but less of it was compatibility plumbing for obsolete surface forms.
- The plain client tier made ordinary screen state more legible. The remaining
  failures were observable behaviors—pagination ended, a send stayed pending,
  or a cold sync exceeded its budget—rather than several competing status and
  refusal vocabularies.

## What still fought the builders

The three independent grades point to one dominant remaining system: client-side
delivery, preparation, and hydration.

Messages were slow or absent within the observation windows in both Astra and
Grok. Astra isolated the delay in the browser path to the server, comparing
browser sends with direct Node mutations. Grok verified all six commits only
afterwards; its evidence does not resolve commit-versus-visibility timing.
These findings do not establish already-server-committed delivery latency.
Muse independently observed remote changes arriving in long clusters
and added a periodic tiny-query heartbeat as an application workaround. That
agreement is stronger than any one agent's root-cause guess.

The same distinction appeared at scale. Astra's owner-side replay was complete
and fast enough to verify, while browser hydration exceeded thirty seconds and
used hundreds of megabytes. The page-hook failure was narrower but similarly
compositional: the server could page the dataset and the React surface declared
it complete after the first twenty rows.

Auth also retained a sharp boundary. Grok's first post-signup write could not
obtain or replay a grant until reload. That is especially damaging in a system
whose value proposition is durable local intent: the first mutation is where
the promise must be clearest.

The backend's ceilings were legible but consequential. M7 exposed both a
retained-closure bound and a job-step bound. Legibility is an improvement over
an opaque failure, but the builder still had to reshape a routine evolution
around those ceilings.

Finally, several Grok majors are a useful warning against blaming every red on
the platform. Missing a procedure call, computing expiry in an inaccessible
scope, treating totals as deltas, and forgetting preview truncation are app
bugs. The independent grader and frozen choreography were valuable precisely
because they separated those mistakes from product behavior.

## Environment and orchestration lessons

The raw treatment harness remains on the black M5 Max at
`/Users/ccheever/clique-full-20260909-snapback2-0020/`. The committed record
contains public-safe narratives, reports, grades, M7 records, and scores—not
raw model transcripts or credential-bearing invocations.

Stale listeners from another program occupied the original port range, so the
treatment used predeclared alternate ranges for all three lanes. SSH processes
could not read Muse or Claude credentials from the logged-in keychain; scoped
GUI LaunchAgents started those exact sessions without copying credentials.
Load above 90 is a raw-host-only orchestrator observation, with Spotlight,
an unrelated simulator session, and Chrome visible; no committed receipt
substantiates that number. The copied Muse grading trace independently records
load as high as 78. Timing evidence preserves its own context, and lower-load
failures remain part of the record.

Muse Spark 1.3 xhigh is the same documented substitution as the September 5
control: requested Muse 3.1/ultra was unavailable. Its scorer exited zero without
the expected `FINAL.md`; the orchestrator mechanically concatenated only ordered
root `run.output.delta` chunks, then ran the unchanged aggregator. The aggregate's
“Clique full run” heading is generic for this treatment with frozen controls.

The [treatment README's source corrections](../benchmarks/runs/2026-09-09-clique-snapback2-0.0.20-treatment/README.md#corrections-to-verbatim-sources)
annotate source errors without rewriting the originals: Astra's 13,231-second
wall is 3.68 h; Muse's start-to-M4 interval is 17,606 s / 4.89 h, not
27,606 s / 7.7 h. Muse's M7 green segment was recorded in the raw receipt at
2026-09-10T00:33:11.772Z (about epoch 1789000392), before terminal end
1789000504; the source's approximate 1789000600 was too late. Muse's essay
incorrectly says it was written after M8; M8 was blocked. The README also
links the copied evidence and Astra's byte-exact sources; normalized reports
identify uncopied artifacts as raw-lane locators.

The Muse lane's choreography drift is an agent-integrity finding, not a reason
to rewrite history. The orchestrator neither restored the lane copy nor gave
the builder hints. It retained the changed file beside the receipts, compared
it with the untouched root instrument, and excludes any post-change M5 green
claim from canonical evidence.

Two sequencing decisions were worth the time. First, audit and package the
docs before a benchmark that explicitly scores discovery. Second, grade the
builder artifact before M7 mutates it. Each M7 session began only after its
independent grader had written a schema-valid report and exited.

Exact and Contract were not used in this run.

## Final calibration

The final three-family means are Snapback 65, Convex 81, and Supabase 66.
Snapback's Astra and Grok scores rose from 64 to 80 and 57 to 67, while Muse
fell from 78 to 48; the treatment mean is therefore one point below the 0.0.4
mean and sixteen behind Convex. Category means still show the intended
primitive strengths—authorization 87 versus Convex 74 and offline sync 63
versus 46—but the composition gaps remain: queries/live 67 versus 87, client
integration 66 versus 81, and scale/limits 44 versus 80. Setup/docs improved
for the Astra and Grok observations but the three-family mean is 71 versus
Convex's 77.

This falsifies a simple “the thirty rulings made everything elegant” story.
The package let two cold agents build more effectively, and Muse's green M7
showed that a fresh agent could evolve the model cleanly once the base app was
understood. It did not make the end-to-end result robust across builders.
Delivery latency, hydration cost, pagination, first-write custody, and the
interaction between media admission and quotas remain material. LLP 1018's
cold-run obligation is satisfied, but the document stays Active/current while
the accepted client follow-up owner and these residual findings remain.


## 2026-09-11 — engineering the shared client and starter follow-up

This is a source-and-test engineering follow-up to the treatment's composition
and recovery friction, not a new builder run or competitor score. The work is
commissioned in LLPs 1018.008.005.000 and 1018.008.006.000.

The starter now uses one paged item resource for primary conversation data and
retained recipient history. It exposes older messages and more search results
in both arms. The real-owner screen control loaded 105 messages through
50/100/105, applied a middle edit and a newest insertion/removal across that
loaded collection, and continued search from 20 to 40 results. Cold offline
history reached the same 105 original-recipient messages while the composite
summary stayed unavailable. A queued create appeared once across three pages.
The source decision and each selected row's evidence stay in the client.

Both composers now call the shared bounded recovery action and read the
mutation's current durable work. The previous application-owned online/settled
sequence, per-composer ledger search and per-device-list dismissal predicate
are gone. Draft lifetime and product advice remain application code. Brief
refusal labels link to explicit diagnostic details; a user need not read an
operation name or compiler rewrite to understand that a message was not sent.

The complete chat template TypeScript corpus, counting physical source once
across both arms and shared code, changed from 27 files/1,718 lines at
`bf8450849` to 28 files/1,751 lines. This is not a line-count reduction: the
additional paging controls and inspectable details buy actual behavior.
`useSnapbackClient` occurrences fell from four to zero; the two Composer
`client.online()` calls disappeared. Two `outbox.settled()` calls remain in
the Expo witness, which measures settlement rather than owning product recovery.
React/Expo Thread components remain 60/43 lines.

A source-level review caught two small but meaningful ownership mistakes: a
later recovery initially waited for the first resume before starting another,
and a headless page subscriber could lose a loadMore call made inside its
notification. Both now have causal controls and fixes in the existing owners.
This is the kind of application bookkeeping the shared API should prevent.
Exact and Contract were not involved. No new Convex/Supabase timing comparison,
native simulator run, or published-package qualification is claimed here.
