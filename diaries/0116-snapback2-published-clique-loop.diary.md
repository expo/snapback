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
Grok4.6 xhigh full Clique build started at13:17:49Z on the exact public release,
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
