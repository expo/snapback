# Diary 0116: Clique on published Snapback 2

**Date:** 2026-09-05
**Author:** Codex (orchestration); fresh builder: GPT-6 Astra, xhigh
**Systems:** Snapback 2, reduced Clique M1–M3, React web
**Related:** LLP 1002 §7–§11, LLP 1007 §5, `benchmarks/runs/2026-09-05-snapback2-loop/`

## Preparation

The prerequisites landed as `cf390fc23`. This run uses the first public npm
release, `snapback2@0.0.1`, with `snapback2-darwin-arm64@0.0.1`. The package
includes the effects engine and the full media helper. The scoped brief is
React web and text-only; it is not the Expo/media capability benchmark and
has no competitor lane. The builder receives no source checkout or prior
implementation, and no steering after the brief.

The prerequisite work exposed two concrete loop problems. Missing media
helpers were reported by `test` as missing owner metadata; startup now
preserves the actual refusal. Derived verification repeatedly exercised
equivalent query/mutation intersections and reset the same seed for every
replay. Representative coverage is now explicit and bounded, policy checks
remain exhaustive within their declared budget, and missing evidence blocks.
The installed chat test fell from roughly 25 s to 9 s; the entire packed
consumer proof, including a mounted React live update, took 20.81 s. A larger
67-operation, 242-message production-profile fixture passed in 29.195 s.

The installed auth recipe now teaches Quarry and explains mutation reads
under the caller’s read rules. Local `why` output points to that recipe, and
CLI `why` refuses mutation execution. Hidden and missing ordinary responses
remain indistinguishable.

## Fresh build

The run started at 06:54:05 UTC and reached its 1,200-second deadline at
07:14:05 UTC. The loop bar is **not met**. The final backend receipt passes
all eight derived checks and two authored journeys. Eighteen API acceptance
groups, browser account checks, and the production build pass; the composite
browser feed/chat check fails waiting for a message in the second browser.
API assertions are builder-authored, not independent grading. In particular,
the retained-history test holds an in-memory copy, not browser persistence
evidence. No Expo, media, offline, comparison, or promotion claim follows.

Installation, Quarry diagnostics, seed setup, and backend verification were
usable within the clock. The builder corrected maintain syntax, ambiguous
indexes, TypeScript narrowing, and missing seed witnesses. A named spread
shape over a merged feed was rejected; spelling the fields explicitly worked.
That remains an unclassified compiler/guide limitation, not a proven defect.
The builder used timestamped rows for typing and split receipt queries from
message history to keep queries bounded. No Convex or Supabase lane ran, so
this diary makes no comparative speed claim. Exact and Contract were unused.

Three problems consumed the browser phase:

- Published default fetch used the client as the browser fetch receiver.
  Chromium rejected requests with `Illegal invocation`; an explicit wrapper
  let the builder continue. An independent synthetic-origin Chromium probe
  reproduced default failure and wrapper success without accessing the app.
  The default transport is now bound to the host global, with a regression
  covering auth, query, and SSE requests. This is a confirmed platform defect.
- Successful password logins consume a durable quota of eight globally and
  three per email per minute. Repeated three-user seed and acceptance logins
  reach it; the undifferentiated `E_AUTH_INVALID` encouraged the builder's
  login-to-signup fallback, producing `E_AUTH_EMAIL_TAKEN`. The counters were
  not inspected during the run, so this diagnosis is inferred from code and
  request sequence. The builder's claim that restarting clears a process-local
  quota is wrong: the quota is stored in SQLite. Follow-up: the login ticket.
- The app keeps all 14 rooms mounted and opens at least three SSE queries
  for each, plus receipt queries. Hidden rooms still subscribe. The selected
  room has no roster/history and the send input remains populated. Browser
  connection starvation is a strong inference, not proven without a network
  capture. Unnecessary hidden-room subscriptions are an app error; the
  platform's one-stream-per-query browser scaling merits investigation.

The builder also wrote token-store adapters with incorrect method names and
storage-key handling; those were app/test errors. Chromium installation was
an environment correction. Overlapping attempts prevent an honest precise
count of platform-attributed correction loops. The failed browser acceptance
already settles the bar.

The untouched brief, publication integrity, and run record are retained under
`benchmarks/runs/2026-09-05-snapback2-loop/`. The working app, screenshots, and
raw transcript remain under `/Users/ccheever/snapback2-clique-benchmark-20260905`.
The timed app is not patched after the deadline. Raw logs include fixture
sessions and are retained locally; the committed record contains only summary
evidence and content hashes. The browser transport fix is post-run work and
cannot turn this run green.

## Post-run release

The browser receiver fix landed as `2c4ac025e` and was published in both
`snapback2@0.0.2` and `snapback2-darwin-arm64@0.0.2`. Production qualification
passed in 129.8 s. A fresh npm install then passed default auth, query, and SSE
in Chromium 153, without a fetch wrapper. The runtime bundle hash matches
the independently checked build. Fifty-six client/assets tests pass, and
independent review found no material issue. `post-run-release.json` retains
that evidence separately from the timed 0.0.1 benchmark.

During prerequisite verification, the broad test script had one unchanged
media output-drain timeout failure under concurrent build load; its quiet
targeted retry passed. That observation is recorded in the existing flake
ticket. The complete script was not reported as unconditionally green.

## Full Clique improvement loop, 2026-09-06

The full three-backend run's evidence was recovered from the M5 Max black.
Its narrative-based holistic scores on Snapback 2 0.0.4 are Astra 64 versus
Convex 84 / Supabase 77, and Grok 57 versus 78 / 47. The score tables and
original scorer prompt are retained in
`benchmarks/runs/2026-09-05-clique-full-3x3/`. They are baseline observations,
not measurements of the fixes published since then in 0.0.6.

A fresh Astra-medium full Clique build now uses npm 0.0.6, isolated from the
repository and prior apps, under `/Users/ccheever/clique-improvement/` on the
office M1. Installation and `doctor` passed; M1 is underway. The canonical
brief still contains placeholder caps, so the builder records actual elapsed
time without inventing numeric cap compliance. This run's different hardware
and agent harness preclude a matched timing comparison to the baseline.

The baseline makes recovery and client integration a priority alongside the
already-landed media and query fixes. Current L7 review residue identifies
startup auth transitions that can skip offline metadata/resume, report login
failure after authentication succeeded, or expose predecessor held coverage
during a transition. An Astra-xhigh lane is reproducing and correcting these
against the current product; no new result is claimed yet.

Muse is an evidence limitation: the three earlier xhigh builders are still
live remotely, and a fresh ultra request explicitly falls back to xhigh.
The new SSH process also cannot read the locked Keychain credentials. Existing
sessions are preserved. An xhigh result cannot establish the user's ultra bar.

### M1–M2 evidence and review, 2026-09-06

The fresh 0.0.6 builder passed M1 and M2, including the frozen two-browser
choreography (three and nine required assertions). Corrected setup metadata
and the hash-bound suites are retained under
`benchmarks/runs/2026-09-06-clique-improvement/evidence/`. Initial metadata
overclaimed prepack verification; the builder corrected it and reran both
milestones. iOS bundle export passed, but simulator execution remains absent.

Built-in auth, avatars, and live profile changes required little backend code.
The main M1 failure was the app's form initialization overwriting edits.
M2 exposed product friction: conditional feed returns lost their cursor,
whereas separate Global/Following queries paged through all 43 entries; a
unique-index migration required finding `--apply-migration` in the installed
binary because neither the refusal guide nor help supplied the command.
Both are now filesystem tickets. React Native Web also dropped the frozen
kit's accessibility values, and one browser lacked the H.264 fixture codec;
the builder preserved the kit, transported the same declared accessibility
semantics, and recorded the browser change as environment work.

The asset-recovery fix passed the full existing test script, then Astra's
review found cleanup/outbox admission, cleanup-auth, and active-upload quota
edges. The auth fix's first 118 passing tests likewise missed account-switch
and startup interleavings found independently by Astra and Grok. These patches
are held for revision, rather than treating broad green tests as evidence
that every lifecycle case is correct. Received reviews and current targets
are retained in the improvement run directory. M3 is underway; no new
holistic score or overall comparison win is claimed.


### M3–M4 evidence and bounded revisions, 2026-09-06

Published 0.0.6 now passes the M3 and M4 browser choreography. M4 passes all
five required assertions: photo render, video playback, live reactions, edits,
and deletion. Its suite hash and raw receipt are retained in the improvement
run directory. iOS bundle export remains distinct from native execution. M5
is underway; independent scoring and fresh-session M7 remain outstanding.

M3 needed separate per-message receipt and latest-message queries after nested
shape alias refusals and nested pagination disrupted inbox draining. M4's
ordinary media upload was compact; authenticated image bytes needed an app
resolver for the frozen kit's URI interface. Operation names `delete` and
`reactions` caused reserved-word/import-collision refusals. These are concrete
authoring costs to address, not benchmark-suite failures to conceal.

Auth cancellation now has failing-before/passing-after regressions and 173
affected tests green. Cursor provenance has a committed candidate with compiler,
evaluator, and package suites green; consolidated verification and review remain.
Asset review caught local serialization taking custody too early and finalizer
cleanup becoming unretryable after a filesystem failure. A final bounded revision
is in progress. None of these candidate fixes is yet claimed as published.


### Auth final-review hold, 2026-09-06

Astra's review of `0e6cebfcd` found two cancellation cases beyond the
fetch-level regression tests: an aborted outbox replay can retain the drain
barrier, and a 401 body parsed after replacement recovery can still expire
the restored custody. The exact review is retained with the run. This lane
has reached the repository's three-round rule; further auth edits are held
pending the author's explicit extension. Other implementation and benchmark
work continues. No auth landing or publication is claimed.


### Unattended continuation, 2026-09-06

The author explicitly authorized unattended decisions and extending fix loops
beyond three rounds for this session. Auth and cursor revisions resumed under
Astra xhigh in their existing named lanes. Asset final revision and CLI help /
migration discovery fixes continue independently. M5 now compiles and applies,
with acceptance still pending. The builder reports a substantial search cost:
Unicode prefix keys need application-maintained hashing/index writes because
the published words primitive supplies ASCII whole words. This is a product
design finding to evaluate after the run, not evidence that search acceptance
has passed.


Asset revision `f7d251394` fixes serialization-before-custody, retryable staging
deletion after worker exit, and terminal-result cleanup ordering. All three
residuals reproduced on preceding code; 99 JS and 62 Rust affected tests pass.
The terminal HTTP 200 rejection is a supported client contract exercised by
injected transport; the current owner normally returns HTTP 401 for an
expired session. Independent final reviews and full verification remain.


### M5 green, 2026-09-06

Published0.0.6 passes the full frozen M5 web choreography, backed by the
six-ID suite. Shared color/background, one-view behavior, warm-offline search
and real five-minute expiry/reopen are exercised. Suite hash verified before
retaining evidence. The builder corrected its Map serialization and web
accessibility/image-root bridge after two application-red browser runs and
one auth-setup fatal; these were recorded separately from platform friction.
M6 is next; native simulator execution is still absent.


### CLI improvement landing, 2026-09-06

Both reviewers cleared the CLI help and executable migration recovery change.
Full tests passed; the initial doctor timing miss is retained alongside a
focused unchanged-binary comparison and one passing canonical warm check.
The source delta integrates unchanged on main. Production0.0.7 qualification
first stopped because staged doctor could not resolve declared TypeScript
through Bun's isolated layout. Release preparation is provisioning the same
locked dependencies through the supported hoisted layout and repeating the
qualified path, without bypassing staged doctor or consumer isolation.


### Published0.0.7, 2026-09-06

The CLI help and migration-command improvement is published in both npm
packages. Registry integrity and fresh installed bytes match the qualified
production tarballs, with Hermes, media codecs, and installed guide/help
checks passing. Original failed staging/dependency layout and first doctor
timing samples are retained; dependency provisioning changed only the private
release lane. The current cold build stays on0.0.6 through M6/M8. Auth, cursor,
and asset work is now combined on an integration branch; its source merged
without conflicts, while a six-byte guide budget overflow needed a prose
trim before the affected checks can pass.


### Integration and M6 follow-up, 2026-09-06

Combined verification exposed a guide budget overflow and then an existing
test's exact prose contract; both were repaired through prose only. The
affected test evidence is green, while independent integration review found
an upload-cleanup cancellation interaction that individual lane reviews had
missed. Repair continues before publication. The builder's M6 required suite
is green, but real offline reconnect still fails on conflicting inbox
deliveries in published0.0.6. A passing suite is insufficient to claim that
user workflow works; retain the browser failure and investigate separately.


### M6 web green, 2026-09-06

The real two-message offline queue and ordered reconnect flush now pass the
frozen choreography, with all five required suite IDs passing. Avoiding SDK
drain:true in three queries through explicit page subscriptions unblocked the
app; preserving the membership reference shape alone did not. The second
conflict was on a flat revocation query, so join shape is not a sufficient
diagnosis. Product reproduction/repair continues independently. Frozen source
and receipt hashes are retained; the native simulator artifact is still absent.
M8 is underway on the same published0.0.6 continuous build.

### Frozen M8 and independent native evidence, 2026-09-06

The builder completed and froze its continuous application, but its original
green M8 receipt lost the exact bound suite when that file was overwritten.
An unchanged-source repeat failed two-device offline convergence and its
dependent receipt check. Preserve both observations; the final artifact is
not a verified M8 pass. Independent outcome and scale grading now run from
the frozen application with builder narratives excluded.

Native M6 supplied evidence the web run could not: real Release Hermes
execution failed to populate history because subscriptions reported a missing
SSE response body. Two durable pending bubbles and ordered manual flush worked;
history, media restoration, and search remained unqualified. Premature read
ticks were also observed. These failures illustrate why successful web tests
and a Hermes export cannot substitute for the Expo workflow. Product transport
attribution and the separate application receipt handling are being checked.

The SDK repair loop is exposing interactions between authority transitions,
asset conversion, and queued writes that isolated tests missed. Before/after
regressions now cover the complete byte conversion boundary; a further FIFO
terminal-error case remains in repair. The author explicitly permits more
than three rounds. Search foundation work has started to remove application
posting maintenance rather than preserve that ergonomic burden as a recipe.
No fresh matched Convex/Supabase comparison or Muse ultra score is available.

### Native transport repair and candidate witness, 2026-09-06

Both independent reviewers cleared the native logical-stream fix. Expo's
physical fetch already streamed correctly; reconstructing each subscription
with React Native's global Response discarded its readable body. The client
now retains the logical stream directly. The new regressions are registered
in both existing test entrypoints, so ordinary verification will exercise them.

The candidate ran in an actual Release Hermes iOS app. One process received
five existing history rows, including the three original fixtures, then a
sixth row through a later live callback after an ordinary backend send. Native
SQLite held the six messages. Before/after screenshots and complete callbacks
are the primary evidence; a recorder filename collision prevented a video of
the successful transition. The original frozen 0.0.6 M6 failure remains intact.

All 189 selected tests pass at their original deadlines. A separate recovery
case passes its assertions on Node22 but its file remains alive until timeout;
uncleared timers in the existing owner harness are being investigated and
repaired separately. This does not become a full-suite green claim.

### Published 0.0.8 and the next cold run, 2026-09-06

The integrated auth, asset, cursor, shape, reconnect, overlay, and native fixes
are published as 0.0.8. Both independent final integration reviews are READY.
Fresh npm installation matches all 153 packed files; installed version,
Hermes doctor, and media checks pass. Initial npm processing delay and an
unsupported verification-command spelling remain in the release record.

The separate owner harness repair clears losing timers and failed-start
children. Its affected 200 cases pass; the matching Node22 recovery case
passes at the original 10-second deadline. This repairs test lifecycle
bookkeeping, not a claimed product speedup. Later search-lane full runs still
have owner-file deadline failures under shared load; those are retained and
investigated rather than erased by the earlier scoped green result.

A new Astra-medium build started at 10:30:01Z on the original M5 host, with
the original fixtures/assertions and no previous app, score, or fix notes.
Its first concrete platform friction is `guide app`: the untouched chat
template reports a missing internal timer-binding certificate even after
`check` succeeds. Reading installed guide files lets the builder continue,
but that workaround defeats the intended app-aware discovery path. A separate
product lane is reproducing and repairing the inventory mismatch; the blind
builder remains on published 0.0.8.

Independent grading of the old 0.0.6 artifact reached the 50% scale checkpoint
with all data invariants passing and zero failed receipts. Following-feed
scaling still fails: the 500-follow p95 is 7.05 times the five-follow p95.
Private profiling reproduces the failure and attributes most native cost to
repeated whole-schema policy hashing, SQLite cursor lifecycle, and quadratic
row-membership bookkeeping. The proposed repair preserves the query and its
authorization/receipt semantics; its 2.36-times mean-cost estimate is not an
executed result. Full scale, fresh M7, and comparative holistic wins remain
unproven. Search work targets the separate application posting-maintenance
burden; its Unicode foundation is implemented but search is not active yet.

## 2026-09-06 — Completed scale evidence and the next repair boundary

The old published 0.0.6 scale run completed 167,244 settled actions with no
failed actions and all checkpoint invariants passing. Following-feed p95
ratios missed the 3× target at every checkpoint. A source-frozen engine repair
reduced the first 10% client ratio to 2.754× with all ten full-output comparisons
byte-identical. Its first larger-checkpoint results were 3.208× and 3.246×,
so the full performance target remains unmet. We retained all samples and
started a separate residual repair; the 10% pass is not a full-curve claim.

The guide timer repair and shared Unicode foundation passed both independent
Astra xhigh and Grok 4.6 xhigh reviews and landed on main. The guide now agrees
with its cache writer about public operations. The fresh published 0.0.8 builder
reports M1–M4 web green and has reached M5; it still needs an application-owned
prefix index and offline matching. Engine/compiler/twin integration aims to
remove that duplicated authoring burden, but it is not yet qualified.

A separate fresh Astra-medium M7 session launched against frozen 0.0.6 after
independent continuous grading. Preparation used only the original starter log
and exported per-persona API snapshots. Its 390 API and 914 preservation checks
passed before the authoring clock. A preparation-only backend restriction had
accidentally propagated into the proposed M7 handoff; corrected before launch,
with original handoff files retained. Full M7 web/native verification is allowed.
Aggregate native M6 and M8 qualification gaps remain explicit; this diagnostic
continuation does not turn them green. No comparative win has been established.

## 2026-09-06 — Published guide repair and completed diagnostic M7

Published 0.0.9 from reviewed source793f707e0; the registry install matches all
154 packed files. The actual chat Expo guide failure now passes before and
after check without rewriting cache or backend files. The first publication
attempt stopped before upload because the working resume copy inherited0444;
only that owned copy was made writable. The unchanged tarballs then published.
The shim's initial registry-processing404 was retained until the registry exposed
its exact integrity. No repack or repeated production dry run was needed.

The fresh 0.0.8 builder reached M5 green, with all four frozen choreography
assertions passing and a native Release app built; M6 continues. Its current
choreography identity records Node25.9.0. Host equality and launch preparation
do not justify an unverified identical-toolchain claim.

The separate old-package M7 author implemented polls and a persisted maintained
visible-count backing structure exposed through conversation fields. The enum
change needed an explicit migration plan; backfilled maintains then worked.
Its new-feature API/web/expiry/Hermes-export checks pass, while prior regression
remains incomplete. Migration introduced no additional snapshot difference,
but regression actions changed final receipt/profile/settings values. The
original strict failures remain intact. Source and stopped database state are
frozen for independent grading; original M7 services are cleaned up.

Independent search compiler review caught captured-alias shadowing that could
incorrectly drop a discovery filter; the repair is in its next review round.
A separate operation-name fix also exposed silent omission of aliased effect
exports and is being repaired. Client tests found repeated normalization outside
the reported budget. These are unpublished findings; green focused suites did
not establish complete correctness. No comparative win is claimed.

## 2026-09-06 — Independent M7 findings and fresh M8 progress

Independent Grok M7 grading on frozen0.0.6 confirms eight assertion IDs with
stated limits; the prior-regression assertion fails. It independently observed
live vote updates, queued browser votes, persisted counts, and closed-client
expiry. The additional empty question/option requirement fails through the API,
despite declared text minimums. Compiler inspection finds minimums retained in
the Quarry AST but dropped from argument types; a current private reproduction
and repair are queued. This is the kind of declared validation an app author
should be able to rely on without duplicating UI checks. The sealed author's
recording supplement is B8 78 and M7-only holistic70, not a complete benchmark
score or a comparison. Both reports are retained with their differing scope.

The fresh0.0.8 run records passing M6 API/push/custom-client checks and M8
maintained totals, UTC buckets and Trending checks. Its retained replay snapshot
has 137000 of 167244 actions and 0 failures. Final scale,
native, multi-device, digest and independent grading remain separate. The
builder reports a cached Insights query refused with `readTime was not pinned`,
while direct authenticated reads work. It used explicit server reads for load
and refresh. A separate lane is checking the current contract and a minimal
reproduction; the frozen run receives no fix guidance. This workaround adds
client plumbing to an otherwise useful server-maintained Insights model.

Actual provisional search execution now returns20 newest rows across100 lanes.
It exposed a second normalization caused by object-field insertion order in a
cache identity; the repair remains unpublished. Feed's latest first curve passes
all three ratios, but review reproduced unbudgeted retained seek parameters,
so memory accounting must be fixed before landing. Passing output/performance
checks alone did not establish the resource contract.

## 2026-09-06 — Fresh scale completion and full client size trade

The fresh published0.0.8 M6 replay completed167244 actions with zero failures
and passing final invariants. A new completed-M8 backend replay is separate.
Its scheduled digest works with clients closed across a backend restart and
stays quiet in the next period. The native app reaches login, but its isolated
Xcode test target cannot yet prove offline behavior; web durable queue evidence
is retained separately. These records do not establish a full green benchmark.

The complete search client checkpoint is46838gzip, including previously
omitted projection/receipt bodies. Root revised the speculative34000 ceiling
to50000, target48000, under unattended delegation. Actual attribution did not
identify enough duplicate code to justify a27.4% reduction; required search,
Unicode, receipt and carrier behavior stays present. Earlier44290 was incomplete,
not a pass. Runtime resource limits stay unchanged. The feed memory repair's
first curve meets all three ratios; code reviews are still pending. Compiler
review has exposed more shared type/capture provenance errors, so the next
repair addresses their cause rather than accepting a bounds-only workaround.

## 2026-09-06 — Published feed repair and fresh Grok run

The feed memory repair completed both independent reviews and landed. Its first
client curve passes all three scale checkpoints, with identical results and
bounded retained seek accounting. Published0.0.10 passed its sole production
dry run, then actual publication and a fresh registry install: all154 packed
files match and the installed Hermes/media/Expo chat checks pass. The first
shim-processing E404 is retained; there was no repack or republish. A fresh
Grok 4.6 xhigh full Clique build started at13:17:49Z on the exact public release,
with the frozen instrument and isolated ports. No comparative win is established.

The earlier46838gzip search checkpoint was still incomplete: it omitted parts
of persistent-store and OfflineRuntime behavior. The final complete five-root
boundary measures62624gzip against39671 for the same baseline roots. Root's
current unattended decision is66000 ceiling/64000 target; earlier34000/50000
limits and partial checkpoints remain historical. Full final qualification is
pending, with runtime resource ceilings unchanged.

The ongoing0.0.8 builder exposed another persistent-client problem after reload:
`conflicting deliveries for chats.list at seq 3264`. Its separate authenticated
inbox query/cache workaround adds plumbing while keeping message history and
outbox on the SDK. An independent product diagnosis is pending; the exact browser
diagnostic and provenance are retained in the inbox-restore ticket. The builder's
attribution is evidence to investigate, not a confirmed cause. The M8 scale
replay had152000/167244 actions and zero failures at13:18:31Z; completion and
independent grading remain separate.


## 2026-09-06 — Full M8 replay completed

The second, completed-M8 replay on published0.0.8 settled all167244 actions with
zero failures and all11 final invariant groups passing. Its own clock was2471s;
546.979s of probes are recorded. Final API latency samples are retained unchanged,
including the older slow following-feed result. These do not borrow the new
0.0.10 repair's numbers. The builder is still finishing regressions and reporting;
independent full-app grading and native qualification remain outstanding.

The inbox investigation reproduced a separate candidate-only custody bug: an
identical delivery could conflict after its program arrived because local receipt
filtering changed the stored fingerprint. The fix must preserve raw identity
without prematurely granting coverage. It does not establish the cause of the
original published0.0.8 error. The later descending resume-log refusal was an app
configuration mistake; an ascending sync anchor adds another authoring obligation.


## 2026-09-06 — Clock-sensitive persistent delivery reproduced

A real native query that reads the clock returns a different result and range
receipt when time advances, even with no database commit. Both warm and
cold-reopened file carriers reject that legitimate same-sequence delivery.
This is now a source-bound native reproduction, separate from the earlier
synthetic pre-program custody case and from the still-unattributed published
inbox failure. The repair needs authoritative execution identity while retaining
same-sequence durable-data disagreement controls. Clock-aware Insights should
not require authors to split their data flow merely to avoid cache conflicts.


## 2026-09-06 — Argument minimum admission across channels

The separate native channel witness passes77 paired subscribe/publish cases,
including recursive list and optional argument minima. The existing74-case
query/mutation/job witness remains unchanged. Invalid arguments leave durable
state unchanged and produce no observed event in the retained windows. These
results show declared text minima reaching actual admission rather than relying
on UI validation or a job body running. The candidate is still unpublished.
The witness also notes an authored channel argument format is absent from its
IR; a bounded semantics audit is pending, with no format-enforcement claim.


## 2026-09-06 — Compiler capture and argument audit

The immutable-capture repair now preserves actual tuple values through shadows
and prevents later destination types from inflating earlier search bounds. Its
112 focused checks pass; the full comparison adds43 passes with the same183
inherited dependency failures. Independent review and integration remain pending.
An additional private harness case still silently scans an array's initializer
instead of its mutated components. That counterexample remains an open repair,
with no claim yet that public Quarry can express it.

The format audit confirmed that accepted query, mutation, job and channel
arguments lose authored handle/URL formats. Native, compiler and client support
are being coordinated. Version identities protect matched compiled custody;
they cannot retrofit strict decoding into old raw-IR owners. Silent acceptance
of ignored constraints is more costly for an app builder than an actionable
compiler diagnostic, because a successful check gives false confidence.


## 2026-09-06 — Real clock updates survive persistent reopen

The new native execution timestamp now lets a candidate file carrier accept a
moving window becoming empty at the same database sequence, both warm and after
reopen. A second timed query stops reading its row, while the untimed history
anchor and shared durable row remain intact. This is the behavior an app author
expects from clock-sensitive data without separate cache plumbing. The focused
proof is retained with its source-custody limits; guard/revalidation tests and
final package qualification remain pending. It does not establish the cause of
the original published inbox failure.


## 2026-09-06 — Published 0.0.8 builder completes; independent audit starts

The Astra medium builder finished in15,482 seconds through closeout. Its seven
web milestone groups and Hermes exports passed, and the167,244-action scale
run reported no invariant failures. Native functional qualification remains
unproven, M7 is unattempted, and the performance gate failed. An independent
grader now runs the sealed application with fresh state and exact package bytes.

The offline restart repair ultimately corrected a duplicate asynchronous app
bootstrap that selected a second partition. That app error should remain
distinct from the unresolved published inbox cache conflict. Search still
requires client-maintained prefix postings, which adds authoring work and lets
a custom client omit terms; the indexed server search repair is not yet shipped.
The candidate persistent client now passes38 checks under its original10-second
deadline on M5, but its full runtime remains457 bytes over the66,000-byte limit.
These observations identify remaining work; they do not establish a win over
Convex or Supabase.


## 2026-09-06 — Interim Astra holistic rescore: 72 / 83 / 74

The completed published0.0.8 Snapback run scored72, against83 for the retained
Convex run and74 for Supabase, using the original neutral rubric. The prior
baseline was64/84/77; this is a new narrative rescore with historical controls,
not a controlled estimate of improvement. M7 remains absent for allthree.

The reviewer valued integrated row authority, media and durable queues. Search
postings authored by the client, live/offline query workarounds, diagnostic
friction and the500-follow ratio reduced the score. Those findings support the
current indexed-search, clock/custody and compiler work. Later published0.0.10
feed fixes do not receive retrospective credit. Root retains unresolved inbox
and resume attribution separately from the scorer’s builder-based labels.


## 2026-09-06 — Independent 0.0.8 outcome audit

The fresh Grok 4.6 xhigh audit finished:93 assertions passed,13 failed and13
were not run. This diagnostic result is separate from the narrative score.
The removed-member live-message check failed despite denied API reads; its
cause needs investigation. Starter search indexes were empty until a separate
indexing script ran, confirming the cost of app-authored search maintenance.
M6 push coverage claimed closed clients while keeping the recipient open.
Native cold-start and durable-queue restart remained unproven.

Original suite failures and all accommodations are retained. The audit did not
change product sources. M7 preparation now uses a fresh starter-only copy and
per-persona API snapshots; missing M6 qualification stays explicit. These
findings prevent treating the builder’s green summaries as complete proof.


## 2026-09-06 — M7 launched; offline batch evidence retained

A fresh Astra medium M7 continuation started at 16:03:26 UTC on the published
0.0.8 application. Preparation verified all 153 installed package files and
exported each persona’s API-visible starter data before its authoring clock.
The snapshot contains 15 distinct messages and no message media or reactions;
those empty fields cannot prove migration behavior for populated fields. The
run remains diagnostic because native M6/M8 qualification is still missing.
The preparation also retained a strict media-byte comparison failure: served
PNGs have an extra EXIF chunk, while the original image chunks match.

Separate repair probes now cover complete batches, not only individual clock
updates. The first candidate let an older positive row hide a newer checked
absence. Its repair passes that case, but a later positive can still hide two
conflicting facts at an earlier sequence in the same batch. Both captured
45-source graphs and results are retained in the review evidence; the existing
writer owns the remaining repair. These are synthetic transport controls with
actual native v5 inputs, not claims that the native owner emitted contradictions.


## 2026-09-06 — Live-cutoff failure traced to unfinished removal

The unchanged M3 browser assertion failed again on sealed 0.0.8. Its next
full-page navigation began about 2.3 ms after the remove call, before any
observed removal request, durable intent, or result. Authenticated follow-up
reads showed the member still present. The subsequent live message therefore
arrived while that membership still authorized it.

A separate control waited for the removal commitment at sequence 403 before
sending at 404. The removed member received no new payload or bubble and kept
the prior message exactly once; its API query was denied. This is a causal
control, not a replacement acceptance pass or a reconstruction of the original
grader’s missing trace. The remaining question is the app/SDK completion
contract across full-page unload. No native authorization repair is justified
by this evidence. The untouched assertion failure and failed control setup
remain retained, and all owned diagnostic servers were stopped.


## 2026-09-06 — Grok 0.0.10 completed; migration regression correction

The fresh native Grok 4.6 xhigh run completed in 12,875.542 seconds. Only M1 and
M2 achieved both suite and required choreography green. Later suites passed,
but live membership/media/insights choreography remained failing or unproven;
native M6/M8 and M7 were missing. The scale adapter skipped 56,900 actions, so
its named-subset check does not qualify the full corpus. All 154 installed
package files still match the release; recorded services are stopped.

The builder liked asset arguments, maintained counts, policy declarations and
the durable offline queue. It struggled with certifier bounds, prefix-search
postings, web/native imports and schema evolution. Its reported global upload
staging exhaustion and text-bound widening failures now have a separate tiny
published-package reproduction lane. These are observations to diagnose, not
yet proven product causes or reasons to raise bounds blindly.

The 0.0.8 M7 builder completed its poll/migration implementation but reported
regression failure. I had overextended a preclock restriction: original
regression suites intentionally call idempotent seed helpers, and my global
no-reseed rule blocked those calls. I archived the complete first attempt and
resumed the same medium session with that restriction corrected, unchanged
assertions and the original four-hour deadline. Original historical suite
receipts now accompany the correction. No database reset, cleaner baseline or
historical application repair is authorized; original failures remain visible.

Fresh client review also exposed another sequence-integrity case: a later row
move can hide an earlier contradictory checked absence in one batch. The
synthetic public-frame repro uses actual native certificates and reproduces
warm and after reopening. The sole writer is repairing this and measuring a
shared compact-tree implementation against the unchanged 66,000-byte gzip
ceiling; the reviewed 66,681-byte build still fails that ceiling.


## 2026-09-06 — Native text arguments verified across operation kinds

The frozen v5 compiler/native fixture now has actual HTTP/SSE proof across
queries, mutations, jobs and channel subscription/publication: 645 primary
admission responses matched the expected 270 accepts and 375 refusals. The
141 observed channel events matched their expected payloads; invalid jobs
left the empty queue/state unchanged, and invalid publishes were paired with
quiet windows and valid liveness controls. This verifies the same public
argument contract across operation kinds without adding handler guards.

The evidence is deliberately scoped. A separate compiler review found private
alternate constructor spellings that silently erase the descriptor; that
repair is still underway, and a later compiler must be qualified separately.
No package, native source-review, offline, or comparative benchmark pass is
inferred from the format matrix.


## 2026-09-06 — Independent migration preservation and targeted repairs

The independent native Grok xhigh API audit passed m7-a08 on the completed
Astra medium 0.0.8 continuation: all 15 original messages survived across 48
persona views, and all 18 original profile/post asset downloads match the
preclock API bytes. Caller-specific receipts only advanced lawfully. There
were no preclock message attachments or reactions, so their populated cases
remain unproven. The resumed native meter has a backward counter; final totals
stay null, with no invented estimate or new comparative score.

Tiny installed 0.0.10 investigations now explain two concrete friction points.
Released assets share the small pending-upload count until their grace period
ends, so ordinary avatar replacement or deletion can exhaust staging despite
few live assets. Required Text maximum widening is also classified as a
destructive type change even when every existing value fits; explicit apply
then fails required-column admission and rolls back safely. Separate Astra
xhigh lanes are repairing successor compatibility and designing bounded asset
grace accounting. These reproductions do not prove every original benchmark
failure had the same cause.

The bounded background loader passed its first real native proof: 537 source
actions, full 16-profile/64-follow/64-post batches, 38 messages including an
image and video, pagination, member denial, and duplicate-ID atomic rollback.
Its separate full search curve is running under the unchanged sample counts,
ratios and population cap. Original results remain intact. This remains a
native search projection, not full Clique action replay or a holistic win.

The user clarified that valid Convex/Supabase baseline scores should be reused.
Fresh control rebuilding is therefore shelved; effort stays on Snapback
repairs and new Snapback measurements. Targeted missing evidence can be
collected when it changes comparison validity.


### 2026-09-06 — Empty aggregate buckets in the native scale checker

The first native projection run reached the 10% checkpoint, then its checker incorrectly required a physical counter row for every conversation. A read-only audit of the stopped snapshot found all 10,015 messages counted correctly across 903 stored buckets; the other 99 groups had zero messages and no stored aggregate row. All 1,002 membership counts and 2,054 membership IDs/roles matched the canonical projection. This is a checker bug, with no native maintenance defect established.

We preserved the original failed attempt and intentionally cancelled the batch attempt that used the same checker. One request was in flight when cancelled, so its last acknowledged ordinal is not claimed to equal final database state. Neither attempt produced query timings or a completed history census. A separate checker correction must pass the actual stopped snapshot and malformed-bucket controls before a fresh curve starts. The concrete friction was confusing a logical zero aggregate with physical materialization; Snapback makes that distinction observable. No comparison with other backends was measured here.

Evidence: [report](../benchmarks/runs/2026-09-06-clique-improvement/evidence/native-scale-checkpoint-diagnosis/report.md) and [complete diagnosis](../benchmarks/runs/2026-09-06-clique-improvement/evidence/native-scale-checkpoint-diagnosis/diagnosis.json). Existing Convex and Supabase baseline scores remain reusable; this correction is confined to a separate Snapback diagnostic harness.

## 2026-09-06 — Pending asset slots repaired without release admission

Astra, isolated `clique-asset-pending` lane, implemented root's decision in
`/Users/ccheever/clique-improvement/revisions/asset-pending-r1/root-decision.md`.
The full Clique outcome bar remains unchanged. This source repair is not a
published-package or benchmark qualification.

The durable ledger made the defect easy to isolate: 43 successful claims and
40 deletes left 40 pending objects before the patch, despite only 2,000 charged
bytes in the core fixture. Receiving uploads (including cancellation custody)
keep their slots; never-claimed ready uploads keep theirs; released ready
originals now retain their byte charge without consuming pending object slots.
No quotas, grace interval, affine ownership, automatic cleanup/replay boundary,
or release/reset admission policy changed. The original proposed broader policy
was rejected, not implemented with its difficult guarantees silently removed.

The authored public Quarry witness made 43 distinct claims, released 40, and
reported zero pending objects with 6,240 charged original bytes. A declared
256 MiB upload was refused before its body because those released bytes still
counted. Restart preserved the originals and release timestamps; a fresh account
uploaded a small image, and the creator re-claimed the identical old record and
received its original bytes. True creator/owner pending limits and successful
replacements have separate public controls. Core logical-time tests cover the
full grace boundary and retained once history; these are not 24-hour endurance
or physical-device observations.

Automatic File substitution and transactional ownership kept the Quarry fixture
small. The misleading part was operational: `listUploads()` also lists releases,
so its page length is not pending usage. The new release/cancellation fields and
concise guide now explain that distinction. Immutable equal-content uploads are
still distinct IDs; this is a deliberate difference from content-addressed
storage, not a deduplication repair. No Exact or Contract work occurred here.

The first core failure is retained. The package build first timed out at 60s,
then exposed the offline guide's exact byte budget; the concise version passed
without raising that budget. Initial witness authoring missed an await on
`assetUrl`; the combined test file then exceeded its original 10s bound and left
an owned process. A retry encountered that same owned port before cleanup.
Those failures remain recorded; only launch-recorded owners were stopped.
Splitting independent cap/replacement coverage keeps the original timeout bound.

Proofs, hashes, commands, exits and cleanup are in the same revision directory's
`implementation-report.md`, `source-receipt.json`, and `receipts/`. The inherited
reset ordering, ready/failed cleanup accounting, failed-delete sibling progress,
sweep cost and late rung/view/scratch custody remain open in
`issues/20260906-snapback2-asset-custody-gc-follow-up.md`. The original reseed ticket
remains open for benchmark attribution; none of its previous failures became a
pass by changing expectations.

### 2026-09-06 — Pending uploads and a public decimal fallback

The asset policy review exposed an unacceptable trade in the proposed broad quota redesign: legitimate live usage could make later asset deletion permanently unavailable. Root rejected new ordinary-release/reset capacity refusal. The isolated repair instead frees pending-object slots after successful release while retaining existing original-byte admission and full grace. Its first regression reproduced 40 released assets consuming all 40 pending slots with only 2,000 charged bytes. This is a before-fix observation, not a passing owner/package result. Existing cleanup and physical-custody debt remains open.

The next compiler review found that public Quarry `captured = amount ?? 2` followed by a Decimal3 insert can return 2 but store 2000 in user units: actual IR return2000 versus stored2000000. Complete source/IR/ClientStore evidence and reconstructed compiler comparisons establish the mismatch; final native/package execution has not been claimed. Private helper register collisions and lost producer/operand semantics are also retained. This is the kind of silent conversion that makes the build experience worse even when a check passes; central representation and binding repairs are required before integration. No competing backend behavior was measured by these witnesses.

Evidence: [asset decision](../benchmarks/runs/2026-09-06-clique-improvement/evidence/asset-policy-disposition/README.md) and [compiler review](../benchmarks/runs/2026-09-06-clique-improvement/evidence/compiler-r7-review/README.md). Existing control baselines stay reused. Full Clique wins remain unproven.


### 2026-09-06 — Local repair handoffs and remaining compiler origin gaps

The public asset repair now demonstrates 43 claims followed by 40 releases, zero pending slots, and 6,240 retained original bytes. A declared upload at the unchanged byte ceiling still refuses before its body; restart, another small upload and same-ID claim pass. Astra independently approves the narrow predicate change; the Grok review is still running. Released rows remaining visible in upload listings was initially confusing, so the API and guide now distinguish pending slots from retained bytes. Failed combined-file attempts remain failures; separately passing checks do not erase their original deadlines.

The widening repair now refuses an invalid legacy row that survives maintained-target rebuilding. The ordinary public three-generation witness preserves the installed generation and sequence on refusal, while 47 focused Rust checks cover required fields, projection ownership and mixed-drop rollback. This restores a predictable development contract: a refused schema change leaves the working database intact. The witnesses are newly reconstructed local evidence, not recovered remote runs. The implementation commit is pushed to its review branch; independent reviews and integration are pending.

Compiler descriptor review still found false native-constructor trust through mutable/container aliases and other modules, plus a migration suggestion that silently widens an authored list maximum from 2 to 100. These are complete-project counterexamples, not merely type-check concerns. The next repair must bind origin to the actual project and validate the entire migration wrapper. No Convex/Supabase behavior was measured by these probes; valid baseline scores remain reused.

Full reports and exact source identities: [local handoffs](../benchmarks/runs/2026-09-06-clique-improvement/evidence/local-fix-handoffs/README.md). The full Clique objective, production publication and offline client resource qualification remain open.


### 2026-09-06 — Asset review closure and another succession transition

Both fresh independent code reviews now approve the pending-slot repair at `3e9238787`. Grok independently built the frozen core and passed all 30 asset tests; root verified all 944 supplied source leaves unchanged and retained the full terminal report. The offline guide should say that **unclaimed** media may expire, so queued-upload guidance is not mistaken for expiry of live claimed originals. Production/package qualification stays separate.

The next widening review found an ordering concern the 47 passing cases did not cover: retiring a maintained table and using that table as the source of a new maintain can make admission compute replacement IDs before rebuild deletes source projections. The resulting surviving row may violate the successor constraint. Evidence currently consists of source inspection and a pure ordering model, not an executed Rust reproduction. Root authorized reproduction and a repair that makes exemptions match actual rebuild ownership. The original passing proof remains valid for its own scenario and is not generalized to this transition.

[Complete review reports and disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/local-fix-handoffs/README.md). Asset work can land independently while compiler, succession and offline resource repairs continue; no competing backend rerun or full Clique win is claimed.


### 2026-09-06 — Drain review and real request boundaries

The real-owner drain regression now fails exactly where the reviewer predicted: the structured unsupported-log refusal has no `cap: 50`, but the old test still expects it. The repair must retain the rejected descending/non-page/oversize operations and the full52-note budget exercise. This is test integration friction, not a new demonstrated drain runtime defect. The existing drain-admission client test also needs registration in the canonical runner.

A separate Grok review initially flagged a cap32 retry mismatch. Reading the complete request path showed that the production client slices the request to32 before sending it; more live subscriptions do not produce an oversized resume body. The same reviewer withdrew that finding in an additive follow-up. Keeping the first report made the reasoning auditable, and checking public reachability avoided an unnecessary product change. No new competing-backend behavior or full Clique win was measured.

[Complete reviews and disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/drain-integration-review/README.md). The actual repair, fresh review, package qualification and benchmark remain pending.


### 2026-09-06 — Drain correction approved

The unchanged real-owner test now reproduces the missing-cap assertion, and the corrected complete test passes all three refused operations plus the unchanged52-note/large-envelope exercise. The existing three client refusal/custody tests also pass within the original10s limit and are registered in the canonical runner. The code correction stays in the test layer; no runtime behavior changed. Both fresh Astra xhigh and native Grok4.6 xhigh reviews approve it, and root verified all961 supplied leaves for each. Their checks were independent source review, not duplicate owner execution.

The isolated correction branch is pushed. Combining it with the separately repaired migration ordering is underway; that integration and the production Hermes/package path remain unqualified. Full reports and receipts: [drain review closure](../benchmarks/runs/2026-09-06-clique-improvement/evidence/drain-integration-review/README.md#correction-closure). Existing Convex/Supabase baselines remain reused.


### 2026-09-06 — Rebuilt survivors and uniqueness remain open

Fresh review of the ordering repair found a separate invariant gap: uniqueness is checked over projections while ordinary survivors of a rebuilt table can be omitted. The concrete three-generation trigger is currently static, not executed. The next repair needs the complete resulting logical row set, with exact replacement exclusions; another local exemption would leave this boundary fragile. Existing ordering and asset rollback integration tests pass for their own cases.

The authorized Astra reproduction/repair attempt was rejected by its provider before any tool or edit. The failed attempt and clean source are preserved; no model-switch or rephrasing retry was made. The unresolved [filesystem ticket](../issues/20260906-snapback2-rebuilt-survivor-uniqueness.md) keeps the combined candidate's limitation visible. Separate production Hermes and compiler/offline work continues. No competitor rerun or new overall score is claimed.


### 2026-09-06 — Compiler project authority repair reaches review

The compiler now checks descriptor origin against the actual project instead of trusting isolated module bindings. The retained complete-project replay shows 35 unsafe admissions closing, 17 still-valid programs keeping identical semantic output, and 40 previous refusals staying refused. Migration guidance also stops inventing a list maximum of100 when the authored wrapper cannot be validated. This makes a refusal more useful than a plausible replacement that changes the application's constraints. The public authoring language remains Quarry.

Root verified all208 frozen compiler files against the committed candidate. The923 affected callbacks passed in41 bounded selections at the original30s limits; this does not establish a whole-package pass. Fresh independent reviews are underway, and separate optional-list/operand/callback findings remain in the next repair. [Full handoff and custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/compiler-r4-handoff/README.md). No new native, published-package or benchmark result is claimed. Existing Convex and Supabase scores remain reusable unless a material benchmark or comparison change invalidates them.


### 2026-09-06 — Offline correctness checkpoint still exceeds resources

The held-search repair now preserves the distinction between a row being absent and a row being outside a previously certified range. Its controls cover movements in either arrival order, cold reopen, and contradictions involving IDs never previously held. A new carrier regression also caught missing private metadata being silently upgraded; old experimental coverage now resets while preserving queued intent and seals. These are useful correctness fixes, but they do not establish practical offline capacity.

The exact checkpoint is72,199gzip bytes,6,199over the fixed66,000 limit. Central ownership consolidation did not produce a net bundle reduction: the final result is269bytes larger than the prior format3 checkpoint. The movement matrix still fails10s; its longer43/43 run is exploratory. One full-population cap test passes after proving the setup replacement produces the identical14,569,662-byte state and key order. That is setup allocation improvement, not evidence of a faster product cold open.

[Full report and frozen source custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/twin-r8-checkpoint/README.md). The checkpoint branch is pushed for recovery, with no main landing or release claim. A bounded structural analysis will inform the next implementation decision. No new Convex/Supabase behavior or holistic score was measured.


### 2026-09-06 — Reviewed drain improvement lands independently

Unsupported offline drain shapes now produce structured refusals while preserving coverage, grants, watermarks and queued writes. Valid bounded ascending pages keep their certified cursor, including cold-start tail handling. The correction preserves the full52-note owner budget exercise; its independent-main run passes in17.95s. Seven unchanged client cases retain their earlier source-bound passes.

All28 changed files match the reviewed implementation and correction. Main's migration implementation is unchanged, so the unresolved uniqueness issue remains open rather than holding this independent improvement. The guide retains pending-upload versus retained-byte distinctions and unclaimed-media expiry wording. [Landing evidence and review disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/drain-independent-landing/README.md). Production publication and full Clique qualification remain separate; existing competitor baselines stay reused.


### 2026-09-06 — Equivalent source names still hide a type error

The next independent compiler review found that `./bounded-lib.d.ts` and `child/../bounded-lib.d.ts` can lose the supplied declaration while the canonical filename works. A missing type then gets a false clean type-check result. The candidate's later lowering refuses rather than publishing a program, so this is a source/type-analysis defect, not a demonstrated native exploit. The next correction must preserve distinct authored/library identities after normalization or refuse before substitution.

Both complete [R4 review reports and disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/compiler-r4-review/README.md) are retained. Grok approves the scoped descriptor/migration repair; Astra requires the additional custody correction. Separate native checking also showed that the optional-list fallback needs faithful guarded lowering before it can pass the actual owner certificate. Neither compiler-only successes nor the existing competitor scores are relabeled by these findings.


### 2026-09-06 — Asset fix reaches the registry

The pending-slot fix is now published as 0.0.12. Reusing the exact qualified production packages made actual publication an 84.408-second operation, with all standard consumer checks still executed. The first shim lookup returned E404 while npm processed the accepted publication; preserving that failure and checking visibility later avoided an unnecessary republish. The later fresh registry installation matches all 154 original packed files and the untouched Expo template passes init/check/guide with 26 public operations.

Private pinned Hermes preparation was expensive, but its completed artifacts now provide a reusable qualified build input for the next release. The separate drain fix is preparing as 0.0.13; it is absent from 0.0.12. These checks establish installed tooling, not native app execution or a full Clique win. [Publication evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/asset-publication-012/README.md). Existing Convex/Supabase baselines stay fixed unless a material comparison change invalidates them.


### 2026-09-06 — Receipt ownership review closes, rollback repairs remain

Both fresh independent reviews approve removal of the duplicate retained receipt-body map. The deterministic ownership regression supports that removal, but the complete runtime grew by 30 gzip bytes to 72,229, still 6,229 over budget. Removing a retained instance can help ownership without reducing emitted code; neither result establishes realistic resident memory.

Astra reproduced duplicate-absence removal and malformed standalone rehydration losing prior state on both parent and candidate. Grok independently identifies the same inherited defects by source. They are tracked for the next sequential repair, while the current carrier stage consolidates repeated transaction preparation. [Full reviews and disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/receipt-ownership-review/README.md). No full Clique score, native qualification or competitor rerun was produced.


### 2026-09-06 — Drain release production qualification passes

Version 0.0.13 passed the unchanged production dry run in 607.143 seconds, including the full media engine and standard installed consumers. The original packages also pass untouched Expo tooling; their shipped offline and live-query guides match the reviewed drain source exactly. Root independently matched all 154 installed files to those packages. The completed pinned Hermes install was reused without another Hermes source build.

An external receipt-path mistake failed before installation and was corrected without repeating production qualification. The complete report retains that failure and the separate postprocessing mistakes. [Preparation evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-preparation-013/README.md). Actual publication and registry verification follow; no native acceptance, search resource closure or new holistic score is claimed.


### 2026-09-06 — Published drain release enters a cold full run

The unchanged publisher resumed the qualified 0.0.13 artifacts in 72.770 seconds. npm accepted both packages before the shim was visible; two E404 observations remain in the record, followed by matching integrity and a fresh registry Expo pass. All 154 installed files match. Reusing completed production qualification kept this release incremental while still exercising standard consumers. [Publication evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-publication-013/README.md).

The next cold full Astra-medium build actually launched against this published version at 23:31:31Z. Its native identity confirms medium and M1 begins at 23:32:00Z. Original Convex/Supabase baselines stay fixed; another diagnostic rescore must not silently replace them. The M1 host differs from the historical M5, so elapsed-time differences cannot be attributed solely to the backend. No new milestone, native proof or holistic win is claimed yet.


### 2026-09-06 — Frozen harness dependency restored during the cold run

The cold packet omitted choreography's original JSON-schema helper outside the copied subtree. The builder supplied an AJV substitute and reported M1 green, but that was not source-equivalent qualification. Restoring the exact frozen helper and fixture layout fixed module resolution without changing the assertions. A narrow same-session environment notice makes that repair available to the builder while retaining both milestone clocks and all previous failures.

The deliberate CLI interruption also stopped its static web server; the backend remained intact. The resumed medium-effort session recorded that distinction and owns restoring its web process. No corrected choreography pass is claimed yet. This was benchmark packaging friction, not an established Snapback defect, and it provides no reason by itself to replace the existing competitor scores. [Restoration and actual resume evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-013-environment-repair/README.md).


### 2026-09-06 — Expo startup becomes easier to discover

The cold build looked for an Expo guide while the existing app guide described certified backend facts. Both commands behaved as designed, but the package introduction did not make the startup route obvious. The README and existing grammar now lead to the Expo chat init command and distinguish init, auth and app guide roles. Locally installed README commands use npx.

This is Snapback documentation friction rather than a new native capability. Keyword output and fenced examples remain unchanged; the first external prose checker had a wrong no-fences assumption, and its failure is preserved alongside the corrected pass. The narrow change is not yet published or injected into the current cold benchmark. [Source and validation evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/guide-expo-startup/README.md).


### 2026-09-06 — Full offline review finds three remaining entrypoint gaps

The full review went back before the first R8 change instead of assuming that intermediate implementation was already reviewed. Astra reproduced two inherited standalone defects: externally frozen wrappers still allow nested caller mutation, and malformed receipt boundaries can destroy prior authority before refusing. Grok found a separate public offline projection path that bypasses the online denied/partial field filters. Both complete reviews require changes.

The next repair covers these entrypoints together, after resident harness preparation releases the same writer. This is additional correctness work, not resource progress: 72,555 gzip bytes remains over budget, original movement deadlines remain failed, and realistic paginated resident measurement is pending. [Reviews and exact limits](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review/README.md). Existing competitor baselines remain fixed.


### 2026-09-06 — Cold run stops during M4 at a provider block

The corrected original-validator M1 and M2 runs passed, but M3 exposed an attribution problem: the seeded group includes Erin while the frozen receipt scenario never opens her client. The original emitted failure remains intact, including a separate DM transition failure. A later real Erin client allowed a supplemental pass; it does not replace the standalone result.

During M4 the provider explicitly blocked the builder request. No retry or model switch was attempted. The authored work, export inventory, actual native terminal and surviving backend ownership are preserved; incomplete choreography and ambiguous cumulative metering remain unqualified. This stop is not scored as a Snapback product failure or a benchmark win. [Terminal and milestone evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/astra-013-terminal/README.md). Independent repairs continue with the original competitor baselines.


### 2026-09-06 — Final diagnostic evidence recovered before the M5 leaves

The original Grok-built 0.0.10 application audit completed while the remote host was unavailable. Its final diagnostic record is now recovered: 69 pass, 20 fail and 21 not-run assertions, with no holistic score. Reading the complete report clarifies why suite flags alone were misleading: some checks asserted only API completion or literal true, while pagination, recipient media and several later workflows were missing or failing. Supplementary controls establish narrower behavior without rewriting the original failed choreography.

The asset staging observations predate the published pending-slot fix. Other findings need current-surface diagnosis before treating application mistakes as platform defects. For example, push formatting already has an effect-run JavaScript path; a full message written directly into an 80-character preview field does not prove the platform lacks formatting. Native and full-scale evidence remain absent. [Complete recovered diagnostic report and custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/grok-010-final-diagnostic/README.md).

M5 recovery is complete. Future Linux-compatible work is assigned to the EPYC/Hetzner fleet, with isolated pinned runtimes; Apple-specific work uses other Macs. This operational change does not replace competitor scores or turn cross-host timing into a backend comparison.


### 2026-09-06 — Asset documentation becomes reachable by topic

The cold build's `guide assets` lookup could not reach upload and rendering instructions already present in the package README. Deriving topic entries from existing README headings closes that discovery gap without another page to maintain. `assets` now returns its exact defining paragraph and a pointer to the full section; all23 language-construct excerpts and native lookup precedence stay unchanged.

Both independent reviews approve the exact three-file change, with focused generation and private native lookup evidence. The retained projection is not a complete rebuilt package, so standard production qualification still follows. The original failed lookup and incomplete cold run remain unchanged, with no replay or new score. [Full reviews and source custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/guide-readme-topics/README.md).

The recovered0.0.11 preparation also remains failed: its consumer timeout controls even though captured output contains passing checks. [Original report and terminal/cleanup custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-011-recovered/README.md) preserve that result. Existing competitor baselines remain reusable.


### 2026-09-06 — Page coverage still needs separate exhaustion evidence

The next complete R8 review exposed a distinction that the narrow entrypoint tests missed. A malformed empty-range cursor can persist before hydration rejects it, and consuming the one held halo can turn a capped page into an unsupported complete result. Astra reproduced both with exact before/final source records; Grok's independent source review found no material defect. The disagreement does not clear either concrete reproduction.

The authorized repair must validate complete bounds before publication and keep exact page values separate from proof that the server range is exhausted. This matters for offline behavior: a full-looking held page must not promise that an unseen tail does not exist. The initial halo/program fixture is native, while malformed receipt derivatives and queued-overlay installation are explicitly synthetic. No public/native bypass or new competitor behavior was established.

The preceding entrypoint fix passes its scoped public/Twin controls but grows the complete runtime to 72,709 gzip, still 6,709 over budget. Original movement failures and realistic current resident qualification remain open. [Full reports, terminal identities and exact probe evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review-r2/README.md). This records engineering friction and required follow-up, not a full Clique win or a reason to rebuild valid Convex/Supabase baselines.


### 2026-09-06 — Preserve failed qualification and move native preparation to Linux

The first 0.0.14 standard production attempt reached installed chat testing, then exceeded the original 30-second command deadline. Earlier media/todos passes and retained tarballs did not qualify the release. The full record keeps the actual 698.799-second publisher failure, no chat receipt or producer metric, and completed owned cleanup. Heavy host load is context, not proof of cause. A separately authorized second attempt has its own qualification record. [First-attempt evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-014-first-failure/README.md).

The first historical ordinary 10k Linux resident invocation exposed a harness ordering problem: an answer-envelope conflict fired before the intended durable-fact guard. Later atomicity and lifecycle assertions therefore remained unproven. A four-field warm-frame proposal preserves the negative frames and assertions while changing answer custody explicitly; its 500-to-501 answer count means old timings cannot be relabeled. [Original failure](../benchmarks/runs/2026-09-06-clique-improvement/evidence/resident-linux-first-failure/README.md) and [correction disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/resident-linux-contradiction-proposal/README.md) remain separate from the newly authorized run. These historical arms do not qualify current P2 code.

EPYC built the exact frozen native search owner with the existing matching Rust toolchain in 56.64 seconds; all 23 unchanged programs and certificate identities matched in 0.283 seconds. A complete source export mattered because the earlier narrow archive omitted required Unicode inputs. This proves Linux preparation and admission only. The original media helper lacks a build/source attestation, so its capability and the historical 910-message media projection need explicit preparation before a Linux scale derivative can run. [Native preparation and sanitized provenance](../benchmarks/runs/2026-09-06-clique-improvement/evidence/search-native-linux-owner-preparation/README.md). No M5 run, full Clique score, device proof or competitor rerun was added.


### 2026-09-06 — Cold reopening must preserve issuing keys

A bounded follow-up turned the remaining cold-movement review uncertainty into a concrete disagreement: moving two retained page members leaves the warm result partial, while reopen incorrectly restores an exact capped result using their current keys. The native initial page is unchanged; later matching-plan images are synthetic checked-admission controls. The fix must recover existing immutable issuing proof rather than infer old membership from today's row bodies.

[Source-bound diagnostic](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-cold-movement/README.md). The original wrong-planHash fixture was correctly refused and remains separate. Root authorized the narrow lifecycle repair alongside the two earlier P2s; no resource or integration pass follows from finding it.


### 2026-09-06 — Second 0.0.14 preparation qualifies the unchanged package

After deliberate fresh capacity observation and a brief hold on new owned heavy checks, the unchanged standard publisher passed in 89.344s (88.6s producer metric); chat passed in 25.016s under its original 30s limit. Fresh original-tarball Expo/guide verification passed in 17.320s, including all 154 packaged files, the unchanged 26 public operations and the source-derived assets lookup. The exact package bytes equal the first failed pair, with separate attempt custody. The first timeout remains a failure with no proven causal attribution; no deadlines or assertions changed.

[Completed preparation and writer terminal](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-014-second-qualified/README.md). Actual registry publication is a separate authorized continuation; this preparation is not a benchmark or device result.


### 2026-09-06 — Preserve publication and resident limits after new failures

The actual 0.0.14 publisher stopped before either npm publish call when chat hit its unchanged 30s deadline. Both exact versions still returned E404. The earlier successful preparation and qualified pair remain distinct; no retry, metric or registry-installed pass followed. Root authorized read-only timeout and alternate-Mac preparation. [Exact withheld-publication record](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-014-publication-withheld/README.md).

The corrected Linux ordinary carrier passed all three historical arms and both full-state comparisons; Twin stopped during baseline load at its h1 assertion, before later lifecycle coverage. A separate read-only diagnosis found an ordinary-cursor contract mismatch and proposed an exact decoded-position check. Actual failed next remains unlogged, and no new population is authorized. [Mixed outcome and original limits](../benchmarks/runs/2026-09-06-clique-improvement/evidence/resident-linux-corrected-outcomes/README.md).


### 2026-09-06 — Compiler readiness requires a matching execution graph

Both final independent reviews marked the repaired R13 compiler READY within their code and behavior scope, and the R14 explanatory prose was accepted. Actual integration checks nevertheless found an ordinary authoring incompatibility: the new compiler emits `Index.components` and `Scalar` scan prefixes, while current main still expects the earlier schema and expression forms. The unadapted evaluator refuses the new schema before execution. The retained 0.0.14 decoder certifies main's two ordinary programs and all 27 shipped chat programs, then refuses the corresponding candidate output.

This is a concrete reason to hold the standalone compiler landing. The native, evaluator and client changes must land as a coherent graph while preserving newer main offline, drain and asset behavior; erasing refinements or adapting away the mismatch would hide the dependency. The exact owner witness is scoped to unchanged decoder paths, not a rebuilt current-main runtime. [Full paired reviews, corrected custody and compatibility disposition](../benchmarks/runs/2026-09-06-clique-improvement/evidence/compiler-r13-r14-ready-held/README.md) preserve the evidence. No compiler code, product prose, benchmark replay or new score is included in this entry.
