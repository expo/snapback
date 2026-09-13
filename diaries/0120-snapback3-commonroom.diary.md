# Diary 0120: Snapback 3 Commonroom

**Date:** 2026-09-12
**Subject:** the first independently runnable Snapback 3 product slice
**Agent:** Codex / GPT-6 Astra, with bounded implementation lanes and a fresh same-family reviewer
**Design:** [LLP 2000](../llp/2000-snapback3.rfc.md)
**Application:** [Commonroom](../snapback3/examples/chat/README.md)

## The result and its scope

Commonroom is a real React chat application backed by the new Node owner and
Rust SQLite worker. It has group and private conversations, live messages,
unread state, conditional edits, account switching, durable offline sends,
recoverable refusals, and drafts saved per account and conversation. Its eight
Quarry operations are inferred and certified through the actual compiler.

The source lives in `snapback3/` in the main checkout, as Charlie requested.
Snapback 1 retains its root layout; Snapback 2 and Fable's Snapback 4 are sibling
directories. The compiler, core, evaluator, Unicode contract, and semantic corpus
were copied from Snapback 2 at `a93edb979a5cbe6357f1fc1f95b66f85bd308844`.
The SDK, React bindings, Node owner, operation ownership, CLI, and example are
the new experiment. No mutable sibling implementation package is imported.

This is a small product slice. It has no create-room or membership-management
screen, media, feed/follows, effects/jobs, connected presence, native app, managed
host, or backup/restore interface. Inherited syntax for unsupported runtime
capabilities is refused at project admission. This application and fixture do
not establish full Clique parity, the M1–M8 workload, or a win over a sibling.

## What felt good

- Reusing a certified execution model let the application test real authorization
  immediately. The example did not need to invent an API server or duplicate the
  membership rule in React.
- An unread count and a message page can be separate resources with separate
  availability. React renders those states directly; it does not manage receipts
  or decide that missing evidence means a count of zero.
- One saved operation owns admission, retry identity, terminal recovery, and
  observation by relevant queries. The application requests a send once, then
  clears only the submitted draft after durable admission.
- The same headless SDK powers React and the installed-package witness. Generated
  declarations check actual example calls. Rolldown and TypeScript keep the build
  conventional and satisfy the author's toolchain preference.
- Browser tests against a temporary real application found the same behavior the
  interface presents. Headless Chrome avoided taking focus from the main machine.
  The layout was also inspected directly at desktop and 390 × 844 mobile sizes.

## Friction that changed the implementation

The first live path invalidated queries after a commit. That introduced a visible
gap while the client reacquired them. The owner now sends independent authorized
resource replacements over POST SSE. A mutation receipt alone also removed a
pending message before its query showed the committed row; the SDK's `observing`
phase now owns that transition.

Independent review found several real safety defects beyond the initially passing
tests: facts became usable before their storage transaction completed; a stale
stream could follow a known newer commit; manifest requests could finish out of
order; empty results could fail to revoke old data after fact-pool renewal; and a
retained operation handle could reveal the previous account's work. The repairs
preserve positive admission order, apply negative authorization information even
under storage failure, retain a sequence floor across reopen, and seal old handles.
Those scenarios have regressions. Shared facts improve composition only if these
boundaries remain explicit.

Quarry still needs explicit branches for null narrowing. A cursor index needs a
total order including identity; the unique-key upsert form infers the lookup
without another `by` clause. These forms became part of the real example rather
than hidden fixes to its generated output. There is no new authoring-language
claim here.

The build had two concrete integration traps. Bun's `file:` dependency could leave
the example pointing at an old package snapshot after new chunk names were built;
the example is now an ordinary workspace dependency. Rolldown's JSON lowering
could turn nested `__proto__` keys in the Unicode contract into JavaScript
prototype setters. A JSON loader that emits `JSON.parse` preserves those own keys;
the inherited evaluator corpus exposed and verifies that difference. The pinned
Rolldown build copies the example's authored CSS assets explicitly.

The owner tests also exposed an inappropriate runner boundary: a Bun `node:test`
compatibility timeout could leave the next file registered inside the prior test,
and a 100 ms child-start allowance measured machine load. Owner tests now run on
Node through a small Rolldown test build, with an explicit silent-child timeout
and bounded wait for restart. Client and browser tests continue using Bun's native
test API.

The SDK removes coordination responsibilities, but the application still owns
conversation selection, cursor navigation, draft retention, conflict presentation,
and read-marker policy. The example is substantial UI code, not evidence of a
tiny complete application. Line counts alone would obscure this cost.

## The hub measurement

The deterministic fixture has 100 groups, 900 direct conversations, 100,015
messages, 6,800 memberships, 1,000 read cursors, and 4,901 personas. Groups contain
50 members. The hub belongs to every conversation. Exact seed bytes:
23,383,389; SHA-256
`9155c01c2c14d4769f032419fb38264d9b1c3c913e37af1e825dbc4ff284c35d`.

The large import first hit limits inherited from small development seeds. Its
private administrative path now has explicit input and execution bounds while
retaining validation and one atomic application-data transaction. Public operation
budgets do not change. The ordinary seed path and delivery-custody budget remain
as inherited.

After admission, the first full import exceeded a 180-second timeout. A one-second
process sample showed most execution in `forget_created_points`, which scanned
all transaction-local points on each row write. The existing preimage supplies
the exact keys to remove. Targeted removal and ordered lookup preserve creation
authority without that quadratic scan. Regressions cover updates, repeated key
changes, deletion, nonunique peers, and preexisting rows that must not acquire
transaction-local creation authority.

One subsequent release-worker run on the Apple M5 Max Mac, with other work on the
machine, produced these measurements:

| Work | Result |
| --- | --- |
| Fresh database import and worker startup | 12,187 ms |
| All 1,000 inbox entries, 20 pages | 44.8 ms; 593,424 wire bytes |
| Inbox page latency | p50 1.95 ms; p95 2.68 ms |
| All 100,015 messages, 3,000 pages | 3,899 ms; 62,814,275 wire bytes |
| Message page latency | p50 1.28 ms; p95 1.84 ms |

The [complete measurement record](../snapback3/benchmarks/hub-worker-20260912.json)
binds fixture and native binary hashes. The script reads actual authorized query
envelopes over local JSONL and includes IPC, serialization, and JSON parsing. It
does **not** include HTTP, browser storage, rendering, or first offline evaluation.
Its one-run page distribution is not a cross-run latency qualification. The
62.8 MB delivery volume is a cost to investigate in the full browser acquisition
experiment, not an achieved end-to-end acquisition target.

## Verification and the next comparison

The new tests exercise lost replies, database reopen, terminal receipt persistence
failure, same-identity recovery after program removal, account separation,
conflicting edits, refused compilation, successor installation, and a killed
owned worker. Browser tests exercise the actual built UI and IndexedDB. The
package witness installs a tarball into a fresh directory and uses its bundled
worker through the public CLI and SDK.

Final affected checks passed: 660 Rust tests on EPYC (two inherited ignored
tests), 32 client tests, 16 owner tests on Node, four draft tests, five compiler
tests, and 266 evaluator corpus cases (27 explicitly server-only skips).
TypeScript checks pass. Every authored source file stays under 1,500 lines.

Five headless Chrome journeys also verify the complete offline reopening path.
After a first online visit, the app's service worker caches only integrity-checked
HTML, JS, and CSS. With the entire browser context offline, a closed page reopens
from that shell, recovers its queued operation from IndexedDB, and sends it once
after reconnect. An update test proves old and new shell caches coexist while the
new worker waits; closing the last old tab activates it without losing the draft.
No API or account response enters the shell cache.

The qualified private `darwin-arm64` tarball is 3,926,125 bytes, with 11,637,134
unpacked bytes including its worker. An external npm install passed certification,
all four exported type surfaces, a seeded query, and a durably settled mutation
without a worker-path override. This is local distribution evidence, not an npm
registry publication or another-platform claim.

A later package requalification timed out before application code started.
Both npm's launcher and the byte-identical repository worker remained at
`_dyld_start + 0`; the underlying host cause is still unknown. The earlier
qualified archive and report remain intact. Failed smoke runs now report their
phase and preserve the synthetic installation for inspection. The
[local issue](../snapback3/issues/20260912-package-smoke-host-exec-stall.md)
records the bounded probes and required rerun; this later attempt did not pass.

The fresh reviewer assessed the new behavior and focused inherited-core changes;
this was a same-family review, not a fabricated cross-family consensus. The
inherited Rust and evaluator suites remain part of the verification boundary.
The global reference scan reports 19 preexisting false references inside ignored
review JSONL under `.llp/ship-runs/clique-tickets-20260911`; none is in this slice.
The optional root inventory run also reports inherited Snapback 1 drift: an
unregistered `scripts/caps.test.mjs` and missing local contract/client package
dependencies in the guide registry. Those files are unchanged; Snapback 3's
independent workspace does not import that inventory or bootstrap.

The comparison with Snapback 2 is architectural so far: S3's public write path has
no client grant allocator, and query resources own independent acquisition while
sharing evidence. Static certification and Quarry remain. Fable's Snapback 4 tests
the other proposed substrates independently. The next fair comparison needs the
same application workflows, full durable acquisition, active foreground writes,
day-two schema/policy changes, and an outside builder. This first implementation
makes that comparison possible; it does not decide it.

## 2026-09-12: completed Snapback 2 wave feedback

Charlie supplied the final Clique diagnostic report after the first S3 landing.
It sharpens the distinction between working subsystems and a successful product.
The single-client Commonroom experience is useful evidence for this application;
it does not establish that an outside builder can assemble a larger app with the
same ease. S3 still inherits the generic index layout and bounded Quarry model.
Its worker-only hub timing is not a browser acquisition result. LLP 2000 §14 now
maps each structural concern to the current S3 boundary and the next comparison.

Inspecting the actual S2 0.0.31 repair exposed two omissions in the earlier fork.
The copied evaluator still classified a missing public unique-key read as partial
despite held, exhausted range evidence. The compiler still advised mutation
preconditions for read/channel comparisons. The new tests failed against both
old paths before their S2-derived fixes were applied. Reusing a tested foundation
also creates a concrete responsibility to examine later fixes; a new SDK does
not make inherited evaluator bugs irrelevant.

The affected checks pass: 37 client, evaluator and draft tests; seven compiler
tests against the built API; 266 shared evaluator cases with 27 server-only skips;
and compiler/SDK TypeScript checks. The added evaluator controls use synthetic
schema/program identities and test incomplete, revoked and wrong-rule evidence,
negative write refusal, and a surviving noncanonical row. They are not an installed
package, native certificate, or real-browser mixed-count witness. No Rust changed.
The global reference scan retains the same 19 ignored-review-log errors.

Independent review caught a weak inherited refusal control: after changing a
write rule, its range still carried the old schema's rule hash. The test could
therefore remain partial for missing coverage instead of the intended missing
write authority. It now recomputes that hash, first proves the same store can
answer the public point read, and contrasts the refused write with a successful
write supplied explicit negative authority. The five Commonroom browser journeys
also pass against the rebuilt app; their scope remains the existing workflows.

A fresh host-specific package qualification subsequently passed, including npm
installation outside the repository, the installed CLI, all four type exports,
server health, a seeded query and a durably settled mutation. The updated tarball
is 3,926,594 bytes (11,638,629 unpacked), SHA-256
`aa973ab8bd0ca090b28a50585379f5b6c66f47ac02ae172618afeb0b68a49c68`.
Its native worker is byte-identical to the earlier one. The prior host startup
stall did not recur in this attempt; its underlying cause is still unknown.
Nothing was published to npm. The root inventory scan retains the same unrelated
Snapback 1 failures recorded above.

Whole-app browser acquisition, server storage attribution, useful byte headroom,
and a fresh builder performing a feature/schema change remain the important
unmeasured outcomes.

## 2026-09-12: choosing the relevant Clique experiment

The [first Astra medium run](../benchmarks/runs/2026-09-12-snapback3-clique-astra-medium/README.md)
finished its text account/profile slice, then stopped at required avatar uploads.
I let the full benchmark's prerequisite chain block the questions this experiment
was meant to answer. The private package correctly refused unsupported media,
but that refusal supplied no evidence about client coordination or acquisition.
The independent grader also found actual account-flow defects, so even the
partial application was not established as a polished product.

Charlie redirected the run to the relevant scenarios. The
[focused variant](../benchmarks/runs/2026-09-12-snapback3-clique-focused-astra-medium/README.md)
starts a fresh Astra medium session from supplied prerequisite source and keeps
the product package unchanged. Text-projected fixture messages preserve their
identities and authorization scopes. Independent expected data comes from the
frozen logs, rather than from the application's reported totals. Preparation is
separate from the builder clock; application dependency installation and loader
authoring remain on that clock.

This is a useful correction to the evaluation sequence: test a complete selected
data lifecycle and retain each failure, then ask a fresh builder to change it.
The continuous build and independent assessment are complete. They establish
useful one-client behavior at the selected scope, but expose acquisition and
retention failures that the first slice did not exercise. The fresh M7 build
and its independent assessment have also finished. Their small-database success
does not resolve those acquisition failures.

## 2026-09-12: what the focused run exposed

The outside builder used one ordinary client for inbox, selected history,
summary reads and mutations. A denied summary stayed Unknown without disabling
messages, auth restoration worked in the independent probe, and two offline
clients recovered their saved sends after page close/reopen. Starter Insights
had reachable navigation and independently correct totals. These are useful
outcomes; they do not amount to a complete social product.

The harder experience sits between those features. The builder wrote a serial
acquisition helper, waited explicitly for in-flight resources, and calculated
unread from a bounded recent-message summary. It had to stop waiting for
`complete` on fresh paginated responses that supplied data and a cursor with
`complete: false`. The guide did not make this path clear; the
[guide-gap ticket](../snapback3/issues/20260912-guide-gap-paginated-resource-readiness.md)
records it. Counting client instances alone would miss this coordination work.

The worker-only timing was particularly misleading as a product intuition.
Final complete 10,000-message browser acquisition took about 33 seconds; the
100,000-message account never completed before the three-minute cutoff.
Useful first content appeared much sooner. A separate CPU profile attributes
browser SDK, React and persistence-await work, with explicit measurement
limits. Nearly half of logical server database bytes belong to the inherited
generic index family. We now have a browser profile and storage breakdown to
work from, rather than an unmeasured assumption that normalized persistence
made acquisition inexpensive.

The most consequential test changed when the foreground send occurred. The
builder sent near acquisition startup and passed full offline verification.
The independent assessor sent after substantial acquisition: all 10,000 IDs
were eventually fetched, but only 200 were reachable through offline pagination
after close/reopen. It reproduced the failure twice. Server rows remained
intact; the local sequence-wide fence is consistent with the cache replacement.
An accumulator of IDs ever fetched was not a durable-content oracle. The
[retention ticket](../snapback3/issues/20260912-acquired-history-lost-across-sequence-advance.md)
preserves the distinction and the authority constraints a repair must respect.

The assessment was not automatically trustworthy either. Its first navigation
probe ended on the group, then waited for a DM-only message. The report called
the timeout an intermittent app defect even though the corrected probe selected
the DM and passed. I preserved both probes and rejected that finding in a
separate disposition. A zero-to-zero unread assertion and a confounded
delivered-only receipt check also remain weaker than a complete UI result.
Grader statuses were kept out of the next builder's regression inputs.

The experimental package stayed fixed. The failed collection filter that
omitted static assets under `dist/assets/node_modules` was repaired by restoring
their exact frozen bytes, not by changing the application. The CPU diagnostic's
first helper failure was retained before its single retry. These are evaluation
mistakes, separate from the observed product failures. Snapback3 still needs a
clearer ordinary acquisition contract and substantially cheaper browser work;
the run establishes no equal-scope performance win over Snapback2 or Snapback4.

Charlie singled out acquisition time during the run and asked whether there was
a plan to make it fast. LLP 2000 §16 now makes the next experiment concrete:
target a complete 10k workflow under three seconds on the checked browser host,
first measure a compact authorized dataset through the browser, then build
SDK-owned bounded acquisition with shared facts/evidence, incremental processing
and fewer persistence/publication boundaries. The current profile's 151 page
responses and 85,697 persistence row entries for 10,000 messages give that work
a measured starting point. The target is not a performance result or a promise
about every network. Retention, authority, foreground operations and the full
offline endpoint stay part of the work; the benchmark package remains fixed.

## 2026-09-12: fresh builder, polls and migration

A fresh Astra medium session added polls and persisted message counts in
976 seconds. Independent assessment supports all nine selected M7 assertions
and reran the 25 prior passing regression IDs. The existing UI qualifications
remain, and large acquisition was not rerun or repaired. The migration preserved
all 42 persona-visible records and their populated receipt, timestamp, reaction,
reply, edit and tombstone controls. Its public replay backfilled both original
conversations, and the visible group count advanced from nine to ten to eleven
as a poll and text arrived. An original offline vote survived actual browser
close/reopen and settled with two votes total, without replacement or duplication.

The authoring cost remained substantial. Optional arithmetic and cross-table
ID errors required compiler corrections; a bounded tally scan was replaced by
a maintained aggregate. The backfill rejects conversations beyond 200 visible
messages and has no larger resumable path. A wrong persona list caused an
explicit late census failure after the two backfill commits. A corrected
all-persona census and physical row count proved this small fixture was fully
covered; that does not establish a general migration solution.

The retained old client kept its original send but could not execute it under
the changed program. A coordinator control confirms its public status is
`parked` with `S3_OPERATION_CHANGED`; the original input remains inspectable
and no server message appears. The app has no complete recovery presentation,
and the guide promises parked dismissal that the SDK refuses without a terminal
receipt. That [recovery gap](../snapback3/issues/20260912-guide-gap-parked-operation-recovery.md)
needs a concrete user flow, not a claim of automatic compatibility.

The second assessment also needed inspection. Its snapshot comparator compared
principal objects by identity; all their content and required message fields
actually matched. Its nonmember-read helper discarded `status` and `error`,
then described missing data as never completing. The corrected control returned
`denied` and `NOT_MEMBER` four times. Its hidden-settings wait was a driver
precondition failure. Raw failed attempts remain alongside the dispositions.
These corrections neither erase the real acquisition failures nor turn selected
passes into a full Clique score.

After the benchmark, Charlie explicitly asked us to try reaching sub-three-second
acquisition. That is the next implementation task under LLP 2000 §16, with the
fixed package and collected run retained as the baseline.

## 2026-09-12: first acquisition speed experiment

The browser can persist the exact 10,000 full message objects, build simple
history/search indexes and answer local queries in about 1.36 seconds in a
small diagnostic. The full-row digest survived readback in all three fresh
profiles. Authentication, query evidence, the SDK evaluator and the application
were deliberately outside that timer. This is useful headroom evidence, not a
fast Snapback3 result. An earlier tuple experiment also exposed evaluation
friction: its first communicated timer included the later audit, and a draft
mistakenly described a field from the later migration schema. The final record
binds the actual copied schema and preserves both cohorts and corrections.

The first implementation gives acquisition a public SDK owner instead of
requiring another application page walker. Its retained dataset is separate
from the live screen's changing snapshot. That separation has made authority
rules more explicit: a newer known commit must suspend old evidence, including
after immediate offline reopening, while retaining physical history for
revalidation. Simply keeping old rows queryable would conceal a possible
revocation. Integration review also caught a concrete mismatch between repeated
page revalidation keys and the owner's unique-key request contract before the
production app run. Mock client tests alone would not have qualified that path.

The third integrated candidate completed three fresh application endpoints in
2.617, 2.823 and 2.896 seconds. Each retained the exact 10,000 full message rows
through all 151 SDK pages, including physical browser reopening with the
network offline and only static shell assets cached. The application declares
the inbox and its message page chains through its existing client; it no longer
owns the traversal loop. This is implementation-team adaptation of the fixed
app, not a fresh outside-builder result.

Review remains necessary even when the timing and ordinary reopen pass. Fresh
independent Sol and Grok reviews found that a denial for one dataset could
delete another dataset's durable checkpoint. They also identified failure paths
where withdrawn authority could be restored after a failed storage write, and
where a rejected mutation receipt advanced the known sequence without
withdrawing acquired readiness. Repairs and targeted controls precede the
final timing cohort. A fast happy path does not establish the complete product
contract.

The first ten-pair cohort on candidate v5 reached a 2.865-second median for the
whole 10k application endpoint, compared with 6.949 seconds for the fixed serial
walker under the same harness. Two of the ten candidate runs still exceeded
three seconds. All exact-content audits and strict physical offline reopens
passed. A full 100k account also passed in 21.970 seconds; a separate simulated
50ms/10Mbit-down/5Mbit-up condition took 5.476 seconds for 10k. These results
belong to v5 and remain separate from later qualification. The initial summary
said three v5 runs exceeded three seconds; a coordinator recalculation corrected
that count to two. The per-trial timings and their median were unchanged.

Further review found two lifecycle races outside that happy path: immediate
reopen could load old authority before a failed withdrawal's cleanup completed,
and cancelling while invalidation persisted could be overwritten by a captured
automatic restart. The SDK now owns the shared-adapter persistence barrier and
checks current handle state at both restart boundaries. Focused reproductions
failed first, then passed with the fixes. The final optimization reuses owned
decoded envelopes across repeated walks, while checking every row binding and
manifest lifetime. It simplifies repeated internal work without adding another
application cache or reader. V6's ten-pair result was effectively unchanged at
2.866 seconds, versus 7.073 seconds for the matched serial walker. There is no
isolated measured speedup to attribute to this representation cache.

Lifecycle review was more demanding than the timed happy path. A held resource
could retain a withdrawn declaration; ready cancellation could retain its RAM
pool; and a delayed old cancellation could affect a successor declaration.
Repairing the durable guard also exposed a memory-adapter notification mismatch:
a refused cleanup preserved storage but still withdrew a subscribed successor's
live data. Another public API check showed that mutating the caller's declaration
could redirect cancellation to a sibling dataset. The SDK now owns declarations,
withdraws acquired-origin resources with their dataset, and uses matching
checkpoint conditions for durable changes and notifications. Regression tests
exercise held values and subscribed clients, rather than checking storage alone.
V8 passes 83 focused SDK tests with 338 assertions. Both review families
accepted the final repair delta; all nine real IndexedDB groups and five
foreground/recovery controls passed on its exact package.

The application now declares an offline dataset through `client.acquire()` and
awaits its durable completion, replacing the serial walker and in-flight
readiness loop. This is implementation-team evidence about the supported path;
the outside Astra builder has not been rerun on it. The broader product concern
remains: v8 needed 23.825 seconds for 100k messages and 5.421 seconds for 10k
under the shaped network. Application code and manifest transfer accounted for
about 1.94MB of that run's 2.191MB encoded responses. Reducing startup transfer,
whole-corpus storage work and retained-version growth remains useful work.

The final v8 cohort met the declared 10k target: 2.807 seconds median across
ten candidate trials, versus 6.875 seconds for ten matched serial trials. Every
trial passed exact message field/ID/content checks and full physical offline
reopen. One candidate trial exceeded three seconds (range 2.461–3.046 seconds).
The first inbox was visible in a median of 435ms; physical offline reopen,
including its full audit, took a median of 1.477 seconds. This is a useful
measured improvement at a fixed scope, with every earlier failed candidate
retained. It does not establish the broader product or builder comparison.

## 2026-09-12: Full Clique integration in progress

The next commission covers the complete M1–M8 benchmark, including media,
autonomous work, native reopening, and delivery semantics. The useful reuse
from Snapback2 is substantial: asset authority, delivery receipts, the local
mutation evaluator, timers and bounded jobs already express difficult rules.
The remaining work is to make those rules agree across the Node owner, Rust
worker, durable client, and application-facing API.

The first media checks passed with a substitute validator while the actual
Rust codec helper did not compile. Preserving that failure exposed three
ordinary integration errors; after repair, real helper/worker/HTTP tests passed
upload, attachment authorization, once-open concurrency and restart. Review
then found the incomplete reclamation lifecycle: discard had no path to release
charged slots after physical deletion. That integration is still being tested.

Worker review found that hiding system operations from the manifest did not
prevent a session from guessing their names. It also found unbounded cleanup.
A separate integration check caught a test using a bookkeeping signature the
compiler could never produce. The repaired worker now exercises the real
compiler's `{ outboxId, effect, result }` contract and persists its semantic
binding through restart. Root verification of the rebuilt worker and Node owner
passed all 28 owner tests, including autonomous work with no clients.

Native code now has one entrypoint supplying SQLite, streaming fetch and secure
identities to the shared client. Local readiness no longer waits for a hung
network request. These are promising reductions in application coordination,
but review found two defects before simulator qualification: the default
database did not distinguish backend URLs, and a throwing observer could stop
other peers' account-change notifications. The latter was independently
reproduced against real SQLite after its transaction had committed. Device
proof remains outstanding.

The isolated Node effect runner also needed a stronger memory check: a small
V8 heap limit still allowed a touched 128 MiB typed array. The candidate now
uses a sampled RSS watchdog as well as process, time and I/O boundaries; it
does not claim a hard resident-memory ceiling. Full owner integration is still
pending. The complete Clique builder run has not started, and the frozen v8
acquisition result does not qualify this growing candidate.

The next independent owner review exposed a second weakness in our own green
checks: the lost-enqueue test dropped the HTTP reply only after the Node operator
had received and logged the job ID. It did not exercise loss of the worker reply
before that publication. Source inspection confirmed that this earlier loss
left the durable job undiscoverable through the exposed operator log. The same
review found successor commit/restart-file ordering and timer-store-failure
retry defects. These are assigned repairs; the earlier 28 passing owner tests
remain real, with their narrower coverage preserved.

Native repairs now scope default SQLite storage to the backend URL and isolate
post-commit observers. Twelve actual SQLite tests exercise the exported Expo
construction path, lost reply, rollback and cross-account interleavings. They
do not establish Hermes behavior or OS-process restart. A separate iOS witness
is preparing those checks on the owned Durand simulator.

The first actual Hermes launch reached the SDK and failed before a backend
request: the client checked that `window` existed, then called
`window.addEventListener`. React Native's window alias had neither DOM event
method. Expo crypto, streaming fetch and SQLite were available. A separate
Node probe with the same host shape reproduced the failure. The client repair
now owns capability detection and listener cleanup; the native fixture keeps
its real host without a DOM shim. This is precisely the platform boundary
that the Node SQLite fixture could not establish.

The owner recovery repairs now commit the accepted project definition with its
generation, recover job IDs from durable operator-attributed records, and close
an owner after a terminal timer/storage fault. The final suite passed 36 real
Node owner tests and 10 worker tests, including exact worker-commit-before-reply
loss, whole-owner reopening, stored-definition tampering and the recovery CLI.
A compiled timed query also refreshed over SSE without writes while a concurrent
constant query did not. These close specific evidence gaps; effects and the
full application remain outside that result.

Media review found a concrete false-ready path. Removing the entire `mdat`
payload from the canonical MP4 left a 6,241-byte skeleton; the actual helper
still returned successful video facts and produced a finalized file. Existing
successful-upload tests could not establish playable input validation. Source
inspection also confirmed late growth reservation, raw-stage cleanup lost after
attachment, rejected bodies draining outside the upload limit, and shutdown
releasing helper/worker custody too early. The next repair groups these around
complete upload ownership. The review's HEIC/MOV demand was a scope mismatch:
the full Clique brief names JPEG/PNG/WebP and MP4/H.264/AAC. S3's narrower format
contract needs explicit documentation and a versioned helper handshake, without
claiming all of Snapback2's format support.

The corrected native package reached actual Hermes auth, acquisition, live
streaming and durable offline enqueue on Durand. Three successive harness
assumptions interrupted the subsequent restart audit: selecting the only
Snapback database instead of the current URL's file, reading SQLite while its
owner held an exclusive lock, and treating a raw query envelope as SDK-unwrapped
data. Those failures and queued SQLite backups are retained. After Durand became
unreachable, qualification moved to a fresh headless local simulator with an
audit of the remaining harness assertions. Native OS-restart/replay qualification
is still pending; none of these intermediate steps is a full Clique M6/M8 pass.

The local iOS26.5/Expo57/Hermes witness subsequently passed. Three distinct
terminated Expo processes preserved the same two immutable queued operations,
then their committed receipts. The server committed them at sequences 3 and 4;
both bodies appeared exactly once after replay. Root independently compared the
entire stored request objects with transport replay, checked all three SQLite
backup hashes and terminal records, and confirmed that the 18 scoped native
source/build/package files still matched the frozen native revision. The first
local attempt is retained too: its harness expected a restored acquisition
checkpoint to be `ready`, although restart deliberately resumes validation.
Accepting that bounded validation state does not claim new network confirmation.
The final witness proves this small native persistence case, not full native
Clique, media playback, search or large acquisition.

The exact malformed MP4 control now fails with the rebuilt helper: removing
`mdat` from the canonical clip returns `E_ASSET_TYPE` and leaves no output.
The valid clip still validates and is emitted byte for byte. The old accepted
output and both helper hashes remain in the run evidence. The helper tests
also cover duration/sample inconsistencies and image orientation; browser
playback and upload lifecycle qualification remain separate Node work.

The native result now has a compact tracked record under
`snapback3/benchmarks/native-platform/results/20260913-ios-hermes-restart.json`,
with package/source/harness/SQLite identities and explicit scope limits. Raw
SQLite and traffic remain in the ignored run directory. Both final native
reviewers receive the same frozen source and actual evidence.

The coherent Node media repair now passes33focused tests under Node and the
existing36owner tests without skips. The actual helper/worker/HTTP path played
the canonical MP4 through an expiring private carrier: Chrome observed320×240,
a five-second duration and advancing playback time. Bun's CDP/nested-test
compatibility failures were retained as harness failures; the controlled
browser and owner tests use Node. All observed test processes exited. The
media SDK/cache/native player path and full Clique qualification remain ahead.

Final native review found no SDK defect in either family. One reviewer identified
reusable-harness integrity gaps around acquisition linkage and the package bytes
Metro loads. Root's supplemental audit confirms all127installed package files
match the fixed archive and all acquisition/request/server digest records match.
The native implementation item is closed; a bounded harness repair and new
small device run stay in the native qualification work. The reviewed SDK bytes
remain frozen while the broader product integration continues.

The final owner review exposed six more concrete lifecycle gaps despite the
passing focused suite. Root independently reproduced a single queue-busy error
closing BackgroundOwner and used the actual jobs DDL to show that a one-row
recovery page scanned and sorted history. Both families also found recovery
still reading an unused filesystem candidate; seed retry was lost when initial
and replacement arguments were split. Post-commit project/job diagnostics
could imply an outcome that was not known. These now form one explicit lifecycle
matrix, covering startup, recovery, overload, discovery and confirmation,
instead of another isolated happy-path repair.

The native instrument repair now has a fresh actual passing run with unchanged
SDK and app sources. It checks all thirteen acquisition fields, exact linked
resources and rows, and full requests through four real SQLite captures.
Archive-to-install comparison covers 127 files before and after Metro; actual
source-map contents bind the three loaded SDK modules. Root independently
opened the SQLite backups and compared their operations, checked the installed
payload and source-map contents, and rechecked all 57 final manifest entries.
Two new harness failures remain recorded: an early parameter wiring error and
an overly strict expectation that every reopened checkpoint must immediately
be `acquiring`. A valid checkpoint can also remain `ready`; neither permits a
claim of fresh network confirmation. The bound result has its own tracked
record and does not replace the earlier result.

The second media review found four smaller but real gaps. The actual helper
accepted a modified canonical clip with 70.013 seconds of sample timing while
reporting five seconds, accepted zeroed SPS/PPS syntax with preserved NAL
headers, and panicked on an eight-byte truncated configuration. The real frozen
Node HTTP path also returned 404 for an expired carrier on an otherwise public
asset. All four root controls are retained for one combined repair. The native
SDK component remains closed, and portable pending-query prediction starts
independently so these media repairs do not stall the ordinary one-client
experience again.

Charlie then asked whether to stop here and focus on Snapback4. Codex
recommended the shift and paused the S3 expansion. The two active implementation
agents and the final owner reviewer were interrupted; all their recorded child
processes exited, while Commonroom remained running. The current source includes
unfinished prediction and media repair work. The source snapshot, frozen reviewed
revisions and measured acquisition/native evidence remain available for reuse.
No full Clique result was reached. The cost of bringing the additional S3
machinery through all product boundaries is itself useful evidence in the
comparison; it does not erase the narrower results that passed.
