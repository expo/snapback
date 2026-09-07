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

The authorized Astra reproduction/repair attempt was rejected by its provider before any tool or edit. The failed attempt and clean source are preserved; no model-switch or rephrasing retry was made. The unresolved [filesystem ticket](../issues/closed/20260906-snapback2-rebuilt-survivor-uniqueness.md) keeps the combined candidate's limitation visible. Separate production Hermes and compiler/offline work continues. No competitor rerun or new overall score is claimed.


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


### 2026-09-06 — Historical Twin lifecycle closes with the exact ordinary cursor

The strict ordinary-cursor derivative passed the once-only 10k Twin invocation across all three historical arms in 96.822s. All lifecycle phases completed, including the unchanged contradictory-fact atomicity checks, injected publication rollback and populated replacement/reopen. Both whole-state comparisons matched without omitting persisted fields; the earlier successful carrier run was reused. The exact decoded cursor check preserved the ordinary API contract while leaving nonordinary h1 requirements intact.

[Complete outcome and source custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/resident-linux-strict-twin-complete/README.md) retain the original failures, original limits and a separate reporting KeyError after successful execution. The old failed next value remains unknown. Raw states and backend records are retained externally under their complete manifest. This closes the historical ordinary fixture only; it supplies no current P2, media, Unicode, device or full Clique qualification and changes no competitor baseline.


### 2026-09-06 — Alternate-Mac staging stops before publication

Apartment M1 accepted the exact 0.0.14 source, private Node/npm image, qualified tarballs and new writable resume. Its existing npm identity check returned E401, so staging stopped before any publisher or consumer execution. Public package ownership did not substitute for authenticated access. No credentials were copied or changed, and the first cleanup assumption failure remains recorded alongside the retained private compile cache.

[Complete staging and authentication custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-014-apartment-auth-blocked/README.md) preserve the original package bytes and all prior qualification outcomes. The unchanged publisher has no imported-consumer receipt path; Root separately authorized one complete Office invocation under current-authentication, capacity and original-deadline conditions. This entry records the stopped Apartment stage, not that later attempt's result.


### 2026-09-06 — A second Office invocation still misses the chat deadline

The once-only complete Office publisher retry again stopped at the original30s chat-test deadline, despite current authentication, exact valid resume custody and the acknowledged hold on new heavy checks. Todos and the preceding consumer steps passed; no chat receipt completed. Both normal owner stops passed, all59 recorded work PIDs were absent, and both exact package versions remained E404. No npm publication or metric append occurred.

[Full failure and timer custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-014-office-second-withheld/README.md) distinguish130.924s driver time from129.030s publisher time and126.744s summed consumer steps. The temporary chat project was removed by normal cleanup, so a precise unlogged failure cannot be invented. Root authorized a separate secure-authentication design for a complete unchanged Apartment invocation; no arbitrary Office retry or credential transfer follows from this record. The original qualified package bytes and earlier outcomes remain intact.


### 2026-09-06 — Cold public pages expose missing coverage dependencies

The third full R8 review finds two more gaps that narrow store tests missed. After two ordering keys move, the actual cold offline Client selects a historical capped answer expanded with new bodies and drops its known halo. A delayed FULL page changes interior issuing keys without changing current bodies or the last endpoint; warm and cold then disagree about coverage. These are source-bound counterexamples with native initial fixtures and synthetic later frames, not a native emission or device claim.

The next coherent ownership replacement must carry exact issuing-key and missing/fallback custody into receipt comparison and preserve the local partial result through public retry/subscription paths. Keeping the old row-pool hash as a shortcut would retain both the duplicate work and the semantic bug. Complete Astra/Grok verdicts disagree; both actual terminals and the disclosed Astra coordination-file read are preserved. [Round3 evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-full-r8-review-r3/README.md).

This is required correctness work, not byte-budget progress:73,023gzip is still7,023over66,000, original movement deadlines remain unqualified, and historical resident results do not qualify this current source. Existing Convex/Supabase baselines remain fixed; no new full Clique score follows.


### 2026-09-07 — Insert-result proof must describe the actual captured value

Both independent R15 reviews require changes despite the original public inserted-row lookup now working. Unknown private insert inputs can borrow table column names and produce a certified Shape key whose actual member is missing. A reassigned database receiver can also retain new row authority; exact source execution throws while lowered IR performs database work. Parent controls distinguish these new acceptances from inherited dispatch and direct optional-member behavior.

[Complete reviews, actual identities and exact counterexamples](../benchmarks/runs/2026-09-06-clique-improvement/evidence/compiler-insert-r15-reviews/README.md) preserve the working public values, original failures, certificate-only limits and corrected manifest custody. The same author is repairing snapshot-member and current-receiver proof on a separate R16 stage under original deadlines. No product clearance, issue closure, competitor rerun or standalone compiler landing follows; coordinated execution-graph integration remains required.


### 2026-09-07 — Ad hoc admission: preserve authority while deleting duplicate work

The ordinary owner path certified a compiled ad hoc request once as compiler output and twice against the same live generation. The bounded repair retains compiler admission plus one complete live admission for query, mutation and job enqueue. Plans keep their certificate; rehearsals keep separate live and snapshot-copy admission. A deferred clock callback preserves successful admission before the execution sample. Current schema/effects/programs/schedules and execution/transaction checks remain authoritative. No cross-request cache or allocator change was introduced.

The separate native synthetic diagnostic records 3→2 certification calls for ordinary execution/enqueue, 2→2 for plans and 3→3 for rehearsal. This proves removed work, not a speedup or attribution of the ongoing native projection's HTTP timings. The 68 affected tests passed; three measurement tests remained ignored. Preserve the original missing-media-helper failures and first rehearsal observer assertion failure alongside the corrected prerequisite/remaining-tail receipts. Both fresh independent reviews returned READY; [the exact source, full reports and prior observations](../benchmarks/runs/2026-09-06-clique-improvement/evidence/adhoc-admission-dedup/README.md) retain their scope. The reviewed seven-file patch survives current-main integration without conflict or semantic resolution; the running 26c9 scale source and qualified 014 artifacts remain untouched.


## 2026-09-06 — Image sharing needed an adapter-level ownership check

The unlanded fca223 image-sharing checkpoint passed scoped Linux checks, including original10s movement43/43 and cap2/2, but both fresh nativeAstra/xhigh and Grok4.6/xhigh reviews remain NEEDS_CHANGES. Equal public values hid a distinct-current/effective-object refresh gap. Astra's tiny shipped-adapter/no-storage-driver probe also exposed full-row JSON strings retained beside typed rows; inspecting only carrier/Twin identity or enumerable object counts missed that ownership. An omitted optional indexed __proto__ field revealed a separate raw/cold key lookup mismatch. These are candidate-runtime findings, not published-app diagnoses or phone-memory measurements.

The useful next step is concrete removal of duplicate ownership and own-property lookup, with cold deletion/abort/genericJSON and exact sparse-equality controls. Root authorized that work through the same sole author; no finish or landing is claimed. The unchanged completefive-root measurement74243gzip remains8243over66000, so representation changes have not closed the byte budget. No comparator baseline rerun, native/device test, resident measurement or Exact2 qualification follows from these scoped checks. [Final fullreports, exactrawprobes and model/terminal custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-option1-review/README.md).


## 2026-09-06 — Published 014 through the complete Apartment consumer path

The exact qualified guide/assets/drain pair reached npm after the complete unchanged publisher ran on Apartment. Its original installed chat consumer passed in 9.990 seconds and the publisher in 39.319 seconds. This gives an actual successful path after the preserved Office timeouts; differing host/load observations alone still do not explain those failures. The producer's exact 39.3-second dry:false metric row is retained once, with all previous rows unchanged.

The helper initially exited 1 after a post-publisher E404. A first separately recorded public registry observation remained mixed; the next matched both exact integrity values and latest tags. Fresh registry installation then passed all 154 file comparisons and unchanged Expo/guide checks, including the Assets README route and 26 public template operations. We retained the earlier failure and publicationUnknown metadata instead of treating publisher exit 0 as sufficient registry proof. The earlier prefix refusal and discarded-output parser failure also remain recorded, without inventing the old output's cause.

[The complete release evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/release-014-published/README.md) binds source0fd, actual author identity/terminal, owned cleanup, original immutable artifacts and separate convergence observations. The user-visible guide changes are now available in published014. The pending compiler/native/twin graph remains separate and unlanded; no blocked builder restart, benchmark score, native-device or full Clique claim follows from this publication.

### 2026-09-07 — R16 compiler review failures retained; R17 repair active

The independent R16 reviews of e19565bd against dd54ba3b ended with Astra CHANGES_REQUIRED and Grok scoped READY. Astra established two introduced checked-private regressions: reassigned object `length` became collection cardinality, and a pure conditional INSERT helper lost its common required id. Direct scan loops still accepted a replaced database receiver on both versions; Grok also retained inherited ctx/args metadata misuse. Its narrower READY does not refute those counterexamples. Actual terminal/model receipts and the full reports are retained in `evidence/compiler-insert-r16-reviews/`, with exact paired source/IR/value/JavaScript controls and original failed checks. Grok's copied report explicitly redacts only the fleet address and binds the unchanged original hash; its “eval native” wording means the adapted IR evaluator, not native-server execution.

The same author is repairing these paths in R17, with value representation kept separate from read-key authority and assignment RHS/first-error behavior preserved. R17 has not yet frozen or cleared independent review. Compiler-only landing remains held for coordinated native/evaluator/client compatibility; the published0.0.14 and frozen benchmark inputs are unchanged. The existing compiler loop remains open; no duplicate review-round ticket or clearance claim is added.


## 2026-09-07 — A successful reset needed a populated cold-reopen control

Fresh review of unlanded 2ce04895 found that successful in-memory reset completion was insufficient evidence of durability. The public reset/rebuild/complete path cleared its pending marker and held 11 rows, but the shared database projection omitted deletions for the removed metadata root's children. Cold reopen restored the pending marker. Astra reproduced this through shipped adapter JavaScript with a synthetic transactional map driver; Grok's independent source-only READY does not refute the counterexample. This is candidate-runtime evidence, not a published app diagnosis or real-device test.

The concrete follow-up is changed-root key ownership and real SQLite/FakeIndexedDB completion/reopen plus failed-publication/retry controls. Preserve the removal of serialized body mirrors; adding payload retention to recover child keys would undo the ownership objective. Root authorized the same writer to include this bounded repair in the range-preparation successor. No completion or landing is claimed. The unchanged full five-root measurement 74,399 gzip remains 8,399 over 66,000 despite correctness and ownership improvements. [Closed reports, original/final probes and actual review identities/terminals](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-image-dedup-review/README.md). No comparator rerun, current resident measurement or phone qualification followed from this evidence packaging.

## 2026-09-07 — Prepared populated-evolution diagnostic on 0.0.14

This was a scoped engineering exercise, not a cold Clique builder or formal M7
continuation. Three rooms, 12 messages, six reactions and 12 read receipts
survived a maintained-count rebuild and an ordinary column's expand/fill/contract
cycle, with snapshots through both personas and a restart check. Rehearsal
left live categories null; the real job filled them and allowed narrowing. A
new message advanced its room count from four to five and survived restart.

The existing maintain declaration and operator job made this straightforward:
no raw SQL or custom repair tool was needed. The unpleasant part was discovery.
The published compiler still required queries to avoid table names, and the
first narrowing attempt failed on seed shape before it reached live data.
Updating the seed did not backfill the store; the guide now says so beside
the fill recipe. An initial journey result-narrowing error was mine and the
diagnostic identified it clearly. Checks took several seconds on this host,
while individual operator calls were generally fractions of a second.

Compared with hand-written SQL migrations, the certified fill and discarded
rehearsal snapshot reduced manual repair work here; no Convex/Supabase timing
comparison was run. Media bytes, polls, expiry semantics, native clients, and
offline intents across schema changes remain unexercised. The unchanged
journey ran on fresh isolated seeds; before/after API snapshots independently
proved preservation of the actual migrated store.

[Fixture, limitations, and original failures](../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md).


## 2026-09-07 — Generic backend metadata needs normalization before splitting

The fresh 23a0 review found an inherited gap in the public backend replacement contract despite the prior root-deletion repair. Existing undefined children could trigger a misleading carrier error; trailing array holes could successfully persist as a shorter array. Astra's exact three-source projection probes and current public-backend synthetic-driver control distinguish failed replacement with retained prior state from a successful wrong cold roundtrip. Grok's independent source-only READY does not negate that executed observation. This is unlanded runtime evidence, not a published app or real-device diagnosis.

The same author is authorized to repair generic JSON semantics before entry splitting while retaining bounded journal updates and keys-only committed ownership. Required rollback/retry/reopen/outbox controls remain scoped and source-bound. No repair completion is claimed here. [Closed full reports, original probes and actual reviewer identities/terminals](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-range-preparation-review/README.md). The complete runtime measurement of 75,799 gzip still fails the 66,000 ceiling, independent of correctness improvements; no comparator rebuild, new resident population or phone claim accompanied this evidence work.


## 2026-09-07 — Pending client intents across an actual successor

A source-built client and real owner preserved queued envelopes through
close, an optional-column addition, and reopen. The surprising result was
that both predicted writes correctly conflicted: scoped rule verdicts bind
the entire schema, so the apparently harmless addition invalidated their
previous authority evidence. The client exposed E_OFFLINE_CONFLICT and kept
the original data intact; explicit new intents then committed and maintained
the count. The guide now explains that recovery without suggesting that an
agent rewrite an admitted intent.

A deliberately lost acknowledgement after an actual commit was easier:
after restart and operation removal, the cold client retried identical bytes,
received the stored terminal, and left exactly one message. The ordinary
client and operator paths needed no application-owned corrective cache,
subscription coordinator, resume anchor, or data surgery. One contract needed
probing before the guide update. These are engineering observations, not
fresh-builder measurements or a Convex/Supabase comparison.

The [evidence and original failures](../benchmarks/runs/2026-09-07-snapback2-evolution-diagnostic/README.md)
separate this graceful file-carrier reopen exercise from physical process
kill, native qualification, and formal M7. M7's handoff is prepared for the
existing full benchmark lane; its prerequisite current-release M6 application
and grading remain outstanding.


The independent [real-browser session exercise](../benchmarks/runs/2026-09-07-snapback2-1018-browser/README.md)
also passed duplicate subscriptions and follower takeover through the ordinary
React chat template and actual IndexedDB/Web Locks. Two queued posts survived
closing the writer page and settled in order through the follower. The witness
needed to observe operation readiness immediately before disconnecting and
actual replay before asserting settlement; transient empty follower state was
not evidence of queue loss. No application cache, per-tab database, recovery
polling, or queue merger was added. These known-template observations do not
establish fresh-builder discovery counts or published-package qualification.


The count exercise used public queries and separate real guest clients instead
of fabricated coverage. Two held principal counts supported a predicted atomic
allocation; one missing count correctly disabled prediction. A complete zero
query carried no absence evidence, so a new group's allocation still queued
without prediction and committed on reconnect. This conservative limitation is
[filed](../issues/20260907-snapback2-public-zero-count-does-not-enable-offline-cap-prediction.md).
A full second principal rejected the allocation and rolled back the first
insert. This qualifies representative two-principal acquisition and cap
behavior; it is not the 49-insert scale witness. The earlier schema-conflict
[guide gap is closed](../issues/closed/20260907-guide-gap-snapback2-schema-changes-can-conflict-queued-writes.md).


### 2026-09-07 —015 standard qualification passes; focused CLI source remains held

The [frozen015 qualification and closed source-review packet](../benchmarks/runs/2026-09-06-clique-improvement/evidence/cli-015-qualified-review-hold/README.md) records an actual Apartment standard full-engine/media dry-run pass at ff894d7ce: publisher267.652602625 seconds, all19 installed-consumer steps, full todos6/chat30 checks, original deadlines and no retries. The producer metric appends exactly267.3 seconds with dry:true. No015 npm publication occurred.

Fresh blind Astra/xhigh requires changes while Grok4.6/xhigh is source-only READY. Actual controls confirm discovery-index drift can report a different journey as the selected success, and valid option-shaped names can produce help-success without a test receipt. Both full reports and actual terminals are retained; the same author consumed them and handed off a separate owned repair checkout. The successful frozen qualification does not clear that later repair. Original setup failures, full-suite/check/size reds, reduced-coverage timing limits and unavailable original reviewer identity remain explicit; no current native/compiler/offline or full Clique qualification follows from this result.


## 2026-09-07 — Canonical reconstruction needs exact fallback behavior

The frozen 82c43 runtime redesign removed repeated constructors and restored generic metadata/viewed-literal semantics, but independent review caught a malformed-domain hashing regression. A string or singleton array passed through the existing one-key tag helper now retained its container rather than the parent's tagged wrapper. Astra executed the exact parent/candidate comparison; Grok's source-only READY does not refute the two differences. This is unlanded synthetic canonical-identity evidence, not a native program or published app failure.

Root authorized a separate isolated Astra/xhigh repair while the original author continues source-only max design against unchanged bytes. All five probe cases, refusal/payload ordering and original affected limits remain. [Both full reports, exact probe/source/output and actual model/terminal records](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-runtime-redesign-review/README.md). The full runtime still measures 75,815 gzip against 66,000; minified reduction did not produce gzip savings. No competitor rebuild, resident population or device claim accompanied this evidence preparation.


## 2026-09-07 — Exact malformed-domain hashing restored

The isolated0ecd repair restores the earlier canonical wrapper for singleton string/array loop domains. Five fixed parent oracles preserve both changed cases and the unknown-payload/order/refusal controls; the existing evaluator passes under its original bound. Fresh independent native Astra/xhigh and Grok4.6/xhigh reviews both find the narrow repair READY. Their complete reports preserve scope and process limitations.

[Exact repair and closed review evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/offline-domain-fallback-repair/README.md). This repairs an unlanded synthetic hasher compatibility regression, not a published native admission failure. Source remains separate from the ongoing Unicode experiment. The complete runtime size failure and cumulative integration work remain open; no comparator rebuild, new memory population or device claim accompanies this evidence.

### 2026-09-07 — Lossless Unicode packet experiment did not reduce shipped bytes

The single source-bound literal/affine packet experiment matched all 11,007 decoded integers and 15,128 typed elements and passed the unchanged evaluator/foundation. It removed 3,408 minified bytes while adding 485 gzip bytes: **76,300**, still over the fixed 66,000 complete-runtime limit. The experiment was rejected and retained only as isolated evidence; smaller expanded data is not compressed-size or phone-memory proof. A progress-file mismatch delayed the already-authorized remote checks and was corrected without changing source or limits. Full evidence is in `revisions/twin-unicode-packet-rejection/`. No product publication, competitor rerun, second encoding variant or startup/resident claim followed.

### 2026-09-07 — literal absence compiler repair, scoped reviews closed

Frozen d3e497 restores the public `[2,null]` presence-narrowed row insertion with complete source/row/ID values; literal absence no longer invents a present Text alternative. Fresh Astra and Grok reviews both completed scoped READY. Exact reports, native model/terminal receipts and before/after witness are retained in the R22 closed-review packet. Seven foreign type errors, adapted-evaluator custody and Grok45s semantic-child admission deviation remain explicit. This is no native/package or coordinated main integration claim; inherited member-origin provenance work stays separate.

## 2026-09-07 — repaired CLI 0.0.15 published; fresh Grok run started

Qualified78924 landed as624a06df; its exact Darwin-arm64/shim pair is published with both SRIs/latest015 verified. Full Apple qualification retained todos6/chat30 and19 consumer steps. The resumed publisher finished37.253s with19 aggregate consumer checks; initial E404 made activation exit1/publicationUnknown, and registry01–03 remained incomplete before04 converged. No replay. Fresh registry equality covered156 packed leaves. An obsolete013 guide assertion stopped the first verifier, then remaining current-source checks passed on the same install, including images/HEIC and untouched Expo init/check with26 public operations. Original negatives remain. Producer metric37.2s at11:59:22 precedes positive registry04 around12:04:59; the report's contrary ordering is corrected in the packet annotation.

The CLI repair prevents misleading passes from registration/body drift and nonzero/grace exits while preserving duplicate/literal names and ordinary help. Both final source reviews are scoped READY; unavailable historical raw bundles and the leaked-handle assertion limitation remain disclosed. Append exact254.4s dry qualification and37.2s real publication metrics once. No later-main qualification is inferred.

Root started one full Grok4.6/xhigh published015 run at12:14:09.918Z, sessionef729bac-41cc-4d76-818a-10d84382e47c, PID17895/supervisor17894. All169 instrument leaves and original full milestones/populations/deadlines remain pinned. Office M1Max differs from the M5 comparator hardware; baselines stay retained and results are pending. Evidence: benchmarks/runs/2026-09-06-clique-improvement/evidence/cli-015-published.

## 2026-09-07 — bounded timing of the existing ad hoc admission repair

The same historical26c9 source plus the already landed three-file5dc repair completed a fixed baseline-first3+20 putMessage diagnostic. Median285.813→194.598ms and p95286.738→195.280ms; all46 committed receipts and final stopped-store rows/ledger/counts/sequence/allocator/certificate assertions passed. The31.9% median difference is scoped to this comparison: fixed order, cache/observation timing, namespace differences, real clocks and shared R25 work are confounds. It does not establish full-population completion or causal attribution of the entire original285ms.

The first attempt's SQLite lock failure occurred before any request and remains preserved. Its one successful22.118s build was reused; the reviewed correction observed starting state before owner startup and final state after graceful stop, preserving original30s requests and all assertions. Both owners and supervisor exited0; no retries, population replay or new product repair. Six separately reported R24 children violated the posted scheduling hold but their exact timing falls outside the actual owner window; R25 overlap remains explicit. The original scale still stopped incomplete162050/167244 under its unchanged accumulated28800s cap. Evidence: benchmarks/runs/2026-09-06-clique-improvement/evidence/adhoc-admission-performance.

### 2026-09-07 — A smaller source implementation still increased the complete bundle

A bounded structural codec experiment removed substantial tagged admission, wire construction and canonical constructor bodies while retaining explicit phase and refusal policies. Complete runtime-matched Node and Bun oracles agree with the parent, including the added schema-root and getter-order controls; the unchanged cap and whole movement tests pass. Capturing the parent before edits made the initial custody-path error and later boundary discrepancies reviewable instead of erasing them in a new baseline.

The replacement removed 2,684 production source bytes, but the complete fixed-five-root result increased to **76,335 gzip bytes**, **520 above the historical 75,815 anchor** and **10,335 over 66,000**. It was rejected after its single measurement and retained only as isolated checkpoint b1c9e956. Source similarity and fewer semantic bodies did not predict compressed output. [Full evidence](../revisions/twin-structural-codec-rejection/README.md) keeps the original failures, exact model/terminal, source and measurement. No second variant, product integration, changed deadline/population, comparator rebuild or memory/phone claim followed.

### 2026-09-07 — Source-only partition design did not establish a large deletion

After rejecting the structural codec, a read-only recommendation investigated one indexed partition with a sparse prediction view against retained `0ecd6015a7a1f0c291a224baef37f832b6b3154a`. The superseding elimination proof rejected that implementation hypothesis: the existing index implementation is already shared, and committed, historical, effective-query and temporary prediction state need distinct operations. The proposed rewrite did not establish a defensible second whole layer to remove.

[The recommendation, superseding proof and exact source inputs](../revisions/twin-partition-design-rejection/README.md) preserve that sequence. Gross source/minified attribution is not removable or additive gzip savings; no >10 KB reduction was demonstrated. This is not a mathematical impossibility claim. No implementation, new measurement, build/probe, native work or benchmark followed. All five exports, semantics, original limits and the open size/integration work remain unchanged.

### 2026-09-07 — Passing suite labels can hide missing acceptance checks

The full published0.0.15 Grok run reached9/9 M2 browser passes after preserving its earlier failures. Its latest frozen M3 attempt passed live DMs, typing expiry and sent/delivered/read transitions, but failed group receipts, membership/history behavior and quoted replies; one optional avatar check was skipped. The run remains active and has no holistic score.

Reading the actual application acceptance source exposed a separate measurement problem: quoted-reply tests check stored IDs without rendering or tapping; seed replay checks only the presence of data, not duplicate identities; pagination labels never request a second page. Unmapped required tests can inherit an unrelated pass, although that fallback did not activate in the captured M3 receipt. These are gaps in the app-authored tests, not proof of corresponding Snapback engine defects. Improving the build experience requires observable complete behavior, not accepting convenient green labels.

[Source-bound interim audit and unchanged receipts](../benchmarks/runs/2026-09-06-clique-improvement/evidence/grok-015-interim-acceptance-audit/README.md) retain the exact evidence. Final acceptance source must be audited again before grading. The live benchmark was left untouched; valid Convex/Supabase baselines remain reused, and the Office/M5 hardware difference remains a confound. No new full milestone or comparative win is claimed.

### 2026-09-07 — Published0.0.15 Grok score is63; Convex remains ahead

The completed Grok build received63/100 from a fresh Grok4.6/xhigh narrative scorer. The retained earlier scores are Snapback57, Convex78 and Supabase47, so the result remains short of the goal. This uses the same anchors/categories but a disclosed single-backend prompt, and Office differs from the baseline M5 host; the six-point difference is not a controlled causal improvement estimate.

The builder finished in10204.303s with M1/M2 browser green, M3/M4 red and later browser/full-scale/native proof absent. The scorer calls out web offline, Quarry expressiveness/authorization friction and incomplete scale evidence; it also noticed permissive view-once and trending tests. Those narrative attributions need the separate assertion audit before being treated as proven product defects. [Full score, prompt delta and terminal custody](../benchmarks/runs/2026-09-06-clique-improvement/evidence/grok-015-holistic/README.md). The independent Astra audit remains running; no comparator rerun or holistic win is claimed.


## 2026-09-07 — Independent Grok 0.0.15 assertion audit

The independent Astra xhigh audit finished, but fresh runtime phases aborted: the unchanged lock failed npm ci twice on missing snapback2-linux-x64 metadata, and the isolated choreography copy omitted an external helper. No runtime product verdict follows from those setup failures. Clean-install triage is assigned separately; the original app, lock, receipts and failed attempts are preserved.

Source review exposed missing feed pagination/video playback, newest-ten Trending instead of the requested ranking, incomplete custom-client operations and incorrect digest counter wiring. Of 58 mapped acceptance entries, 13 mapped tests support their stated scope, 15 are partial and 30 unsupported. Passing suite labels therefore do not establish full functionality. All 110 assertions have fresh runtime not-run; source judgments remain distinct. Grok's holistic 63 remains below Convex 78; no both-backend win or native/full-scale completion is claimed.

Evidence: [independent assertion audit](../benchmarks/runs/2026-09-06-clique-improvement/evidence/grok-015-assertion-audit/README.md). Root read the full report and independently checked 334 original/copy source and symlink pairs. The next execution decision depends on clean-install evidence, while compiler and web factory-setup repairs continue independently.


## 2026-09-07 — Make browser carrier setup mistakes actionable

The published client let `offline: { store: indexedDbRangeStore }` construct, then failed during login with E_OFFLINE_CARRIER and “this.store.open is not a function.” A minimal browser reproduction established the builder/factory mistake. The fix rejects it at construction with the corrected `indexedDbRangeStore()` spelling and adds the missing setup example to the offline guide. Valid custom factories and carrier failures retain their behavior.

Candidate620616271 passed35 affected tests and real IndexedDB/Web Locks setup controls; independent Astra xhigh and Grok4.6 xhigh reviews both returned READY. Root integrated the five files unchanged. The guide-only budget grows512 bytes for432 bytes of setup guidance. This is an ergonomic repair, not proof of the original app's only failure, the offline bar, or a comparative benchmark win. Publication qualification remains separate.

[Source review and evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/web-carrier-setup-r1/README.md) preserve those limits and actual review identities.


## 2026-09-07 — Runtime audit confirms incomplete app behavior

The unchanged published0.0.15 Grok app ran under an explicitly changed npm10 toolchain after the npm11 setup failures. Feed pagination remained stuck at20, eligible edits failed three times, and digest counts disagreed with actual unread messages. Authentication, ordinary live updates and first/second view-once asset retrieval had bounded positive observations. No app repairs were mixed into this audit.

Root read the complete report and caught a coverage overclaim: an own-repost test does not establish visibility through a different followed reposter. Two-image rendering, avatar decoding and physical process restart likewise require stronger observations. Passing app-authored suite labels are not enough; these gaps remain visible instead of becoming a better-looking score. The separate Grok63 remains below Convex78; Supabase47 and valid comparator baselines are retained.

[Preserved audit and separate Root validation](../benchmarks/runs/2026-09-06-clique-improvement/evidence/grok-015-assertion-continuation/README.md). Native, full-scale, M7 and the full model/size requirements remain outstanding. This evidence does not attribute every app defect to the backend.

## 2026-09-07 — Exact-lock installation exposed an absent optional platform

The completed Grok 0.0.15 app could not reach startup in the independent audit:
its two original `npm ci` attempts failed on `snapback2-linux-x64@`. Producer
and auditor both recorded Node 24.18.0 and npm 11.16.0 on Darwin arm64. The
original and audit locks were byte-identical. Registry metadata was easy to
compare by integrity; the surprising friction was that a Linux package never
published for this release could prevent a Darwin install.

Three preserved dependency-only controls isolated npm's optional-dependency
behavior. npm 11 reproduced the failure; npm 10.9.8 installed the unchanged
app lock, with all 723 installed entries matching locked version, URL and
integrity. That is a disclosed setup workaround, not an app acceptance result.
The original failed audit and its receipts remain intact. The smaller publication
consumer also lacked React because its separate install used
`--legacy-peer-deps`; repository consumer qualification already supplies React.

The product change selects optional platform dependencies from the artifacts
staged for publication and checks resumed tarball identities and dependencies.
A Darwin-only release no longer references an absent Linux version. Metadata
tests preserve multiple selected platforms, and a fresh exact-lock fixture
installs under npm 11.16.0 with default peer and optional dependency semantics.
These mechanical package tests do not qualify a Linux binary or a new release.
Selected non-secret setup evidence is retained in
[`clean-install-platform-triage-20260907.json`](../benchmarks/runs/2026-09-06-clique-improvement/evidence/clean-install-platform-triage-20260907.json).

## 2026-09-07 — Packaging review caught an overly broad name filter

The independent Astra review reproduced loss of an unrelated optional
`snapback2-plugin`: staging removed every dependency with the `snapback2-`
prefix. The fixture had preserved only a package named `unrelated`, so it missed
the collision. Platform selection now uses the two exact supported package
identities for both removal and validation. The preservation fixtures include
`snapback2-plugin` and `snapback2-plugin-tools`, each single-platform selection,
and both platforms together, while retaining normal and peer metadata.

The closed review evidence also preserves two distinct limits: installing both
platform tarballs as mandatory dependencies fails on the foreign platform, and
an unresolved synthetic optional still exposes npm 11's lock behavior. Neither
is repaired or disguised by this small preservation correction. Host-only
packaging evidence does not qualify a Linux runtime or alter the old published
package and application locks.


## 2026-09-07 — Published fixes survive public installs

Published 0.0.16 carries the browser carrier setup guidance and staged-platform packaging fix, including the earlier CLI DX delivery. Fresh public Expo/guide verification passed all 12 commands. A separate default npm 11 install and fresh exact-lock npm ci both passed with all 156 packed files verified in both consumers. This removes the reproduced new-package setup obstacle without rewriting historical 0.0.15 locks or audit failures.

Functional publication checks passed, but chat check still exceeded 1 second and the 17 measured consumer steps alone totaled 31.402 seconds against 30. The initial registry E404 is preserved; later exact public identities confirmed publication without republishing. No native-device or benchmark improvement follows from installation proof. Grok remains 63 versus Convex 78 and Supabase 47 until a new full run is graded.

[Release and installed evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/cli-016-published/README.md) records the commands, original failures, actual terminals and source/artifact identities. Compiler diagnostics remain in the separately reviewed, unintegrated compiler work.



### 2026-09-07 — Compiler R29 closed review and integration hold

The loop-reaching-origin candidate `ef88cac15` versus `9995d41a` received scoped READY from both closed independent Astra/xhigh and Grok4.6/xhigh reviews, with actual native and outer exits0. Seven inherited affected-type diagnostics remain exit1 and exactly equal controls; original setup failures and report precision notes remain preserved. [Full evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/compiler-loop-reaching-r29-reviews/README.md).

This is not a whole compiler/native/package clearance. Read-only integration assessment identifies the reusable3eba v5 recipe and reviewed0ecd client correction, preserves current-main uniqueness and newer features, and finds no cleared native endpoint for two outstanding62fc absence-pricing findings. Stopped scopes remain stopped; no integration, new tests, publication or frozen016 change resulted from this evidence handoff.
