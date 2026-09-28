# Lane FL — deterministic client flake fixtures

Date: 2026-09-28. Branch: `sb4-intent/fl-client-flakes`.
Base: `ea7ecc896c166c31caf88f843e0c4dce4ea900b6`.
The first command was `git fetch origin && git merge origin/main`; already up to date.

## Outcome

Both reported failures are fixture timing races. No product source or timing,
Quarry lifetime, public contract, dependency, version or budget changed.
The lost-reply test now selects HTTP retry explicitly, with separate coverage
for sync recovery. The typing test owns its clocks and reply ordering while
using the real server, rules, member commits and unchanged four-second expiry.
The two tickets are closed under `issues/closed/` with their original records
and resolutions. One journal entry accompanies the changes. Nothing is pushed
or published, and `scripts/test.sh` is not run.

## Cause and evidence

`reproduce.mjs` loads the two baseline test sources directly from the base
commit with Node module hooks. It does not replace runtime code or tracked
fixture files. From `snapback4/`:

```sh
node --import ./reports/20260928-fl-client-flakes/reproduce.mjs --test --test-concurrency=95 --test-name-pattern='W6d native: two client POSTs|^online: kept typing survives' packages/snapback4/test/client-seams.test.mjs packages/snapback4/test/ephemeral-keep.test.mjs
```

`reproduction.log.gz` records both expected baseline failures:

- Lost reply: the ticket's exact 100 ms delay before the thrown loss produces
  `1 !== 2`. The committed write is acknowledged by sync before a retry POST.
- Typing: instrumented response `nextExpiry = 1790590855975`. The first hidden
  publication has both wall and client time `1790590855975`; the subsequent
  server answer is empty. A controlled 2,400 ms pause immediately before the
  burst assertions extends their sampling interval across that deadline and
  reproduces `no publication hides typing during the burst`. The expiry is
  legitimate, not premature withdrawal. This establishes the hypothesized
  timing mechanism; it is not a claim to have reconstructed EX's exact OS
  scheduling trace.

The retry fixture now gates sync at dispatch **and** response delivery, from
before admission until its second mutation reply. Every online/web/native arm
keeps identical request bodies, exactly two POSTs, the exact replay envelope,
one authoritative row, and reopen assertions. The delayed throw is permanent
fixture coverage. New web/native recovery tests hold the first reply after
commit, queue explicit sync before releasing the loss, then require exactly
one POST, one terminal event, one row, a result-free replayed sent receipt,
reuse of that receipt on the same client, and durable lookup after reopen.

The typing observer's `ServerClock` and host episode clock are controlled.
Wire clock samples are removed, while change-poll heartbeat bytes still pass
through. After one completed replacement, three real live replacement bodies
are held across the remaining member commits. All 20 member revisions must
be delivered. The burst occupies 500 logical milliseconds, within default
retention's separate one-second episode; keep:true is also checked one
millisecond before its original four-second row deadline and exactly at it.
All retained burst publications still contain the peer and mark revalidation;
keep:false still publishes loading and the peer again. Member commits cannot
change the captured deadline. After the 21st member commit a direct server
query must be empty at/past the **original** deadline; only any remaining time
is advanced, never a fresh four seconds after the burst. Releasing the old
live bodies cannot resurrect typing. There is one setTyping, no renewal and
no stopTyping.

`slow-typing.mjs` inserts 4,500 ms of real delay after all three bodies are
held. `controlled-delay-final.log.gz` passes online, wasm and process despite
crossing the real lifetime. It retains the server's actual expiry proof and
both withdrawal/resurrection assertions.

## Sibling census

Searched the whole client test directory for lost replies, POST counts,
`nextExpiry`, deadlines, wall clocks and sleeps, then inspected the relevant
fixtures. `timing-search.txt` retains the narrowed timing search.

Changed:

| File / witness | Race removed; proof retained |
| --- | --- |
| `client-seams.test.mjs`, W6d online/web/native | Sync gate selects exactly two POSTs; new web/native tests select one-POST recovery. |
| Same file, immediate/queued replay (online/process) | The previous gate started only after the first response. Gate now starts before sending and covers in-flight sync delivery; exact replay/no-result, two identical POSTs, one row and one event remain. |
| Same file, offline media cache | Upload/view no longer races a one-second fixture deadline. Place a row with an explicit future deadline, prove bytes retained offline, then sample the device clock at that exact deadline. Idle offline purge still occurs without sync. The fixture row's input deadline changes; no product expiry policy does. |
| `ephemeral-keep.test.mjs`, all three tiers | Controlled clocks and held live bodies separate burst retention from original-deadline withdrawal. |
| `ephemeral-mock.test.mjs`, renewal / per-table life | Controlled Date, timers and monotonic sender clock replace 650/600 ms sleeps. Also assert visible one millisecond before renewed expiry, then absent at expiry while the longer-lived table survives. |
| `keep-observation.test.mjs`, online held refetch | Freeze the 100 ms fixture clock until initial publication, then check +99 and +100 ms. Loading before held replacement and eventual null remain. |
| `client-lifecycle.test.mjs`, device visible lifetime | Freeze the 80 ms fixture clock through publication and unsubscribe; cross exact deadlines explicitly. Publication and cancellation of the closed watch's timer remain. |

Checked without changing:

- Other caller-id/receipt-eviction tests in `client-seams`: offline gates and
  terminal receipt waits already bind the intended path.
- `client-lifecycle` sync-before-admission, sync-before-lost/delayed increment,
  shared observer preflight: explicit gates/queued sync bind the order; they
  retain one authoritative increment. `transport-outcomes`, `pending-writes`,
  `web-admission-review`, `delivery`, `delivery-refusal`, `delivery-cas`,
  `web-durability`, `web-navigation`, `server-runtime`: controlled transport,
  admission, provider or timer gates; no second caller-id POST assumption of
  the repaired kind.
- `keep-clock`, `keep-expiry`, `keep-app-expiry`, `keep-authority`,
  `keep-authority-react`, `keep-device`, `keep-adoption`, `keep-incarnation`,
  `keep-reset`, `answer-withdrawal`, `retention-online-boundaries`,
  `retention-store-withdrawal`, `retention-lifecycle`, `expiry-retry-watch`,
  `server-clock-regressions`: already controlled clocks, explicit boundary
  samples, held replies or non-expiring fixture data.
- `expired-server-watch`: intentionally expired real replies under a frozen
  estimate and controlled retry scheduling. `ephemeral-reclamation`: explicit
  dev-clock advance. `ephemeral-fencing`/`ephemeral-adoption`: explicit
  epoch/incarnation delivery holds, not a no-expiry wall-clock burst.
- `ephemeral-e2e` renews during the real typing acceptance measurement;
  `ephemeral-watches` checks actual notification and refresh latency, with
  delivery timestamps and dispatch-bound cadence. `typing-expiry` captures
  browser publication against an explicit row deadline. `server-clock-wire`,
  `server-clock-browser`, `local-e2e`, `native-e2e`: wire/browser/integration
  timing witnesses. These measurements remain measurements; no thresholds
  were relaxed to claim determinism and no wholesale timing rewrite is claimed.

## Qualification

Host: Linux x86_64, 96 CPUs / available parallelism 96; Node v24.13.1,
Bun 1.3.14. The suite's ordinary Node file concurrency is 95. Dependencies,
Cargo target, wasm and TypeScript output were created in this worktree.
Existing installed Node, Bun, Rust and wasm tools were used; no tool installed
on a shared path. Build and guide logs are retained here.

Build prerequisites passed: `bun install --frozen-lockfile`,
`cargo build -p snapback4`, `bash scripts/build-wasm.sh`,
`bun run --cwd packages/snapback4 build`, and the chat app's CLI `check`.
Wasm build: 2,018,847 B raw / 585,970 B gzip, within unchanged 586,193 B budget.
The whole guide passed: `cargo test -p snapback4-lang --test guide`, 93 passed,
zero failed/ignored. Root `./ref-check --verbose` passed: 522 LLP documents,
9,784 refs, zero errors/unchecked. No complete Rust or publication-suite claim.

Loaded checks use `repeat-loaded.py`: eight independent Node invocations at
once, each `--test-concurrency=95`, beside 32 recorded `nice -n 10` Python
processes continuously burning CPU. Child PIDs, exact commands, load,
durations, final typing source digest, per-run statuses and raw test outputs
are retained. Every scheduled run completes; no fail-fast or red filtering.
The final typing batch borrows the still-running 32 burners recorded in the
first batch's metadata. Only those recorded burner PIDs are terminated.

| Final qualification | Result |
| --- | --- |
| Four final sibling/seam files, 50 complete runs each | 7,900 cases passed; no failures, cancellations or skips (`repeated/`). |
| Final `ephemeral-keep.test.mjs`, 50 complete runs | 150 cases passed; no failures, cancellations or skips (`typing-qualified/`). |
| Total final repeated coverage | 8,050 passing cases across the five changed files. |
| Delayed-throw coverage | Permanent 100 ms throw delay exercised in every seams run, both HTTP-retry and sync-recovery paths. |
| 4.5 s typing pause | Online/wasm/process 3/3 passed (`controlled-delay-final.log.gz`). |
| Whole guide | 93 passed; zero failed/ignored. |

Archived raw logs use `.log.gz`; runner commands write `.log` when rerun.

The original five-file batch completed 50/50 green in 544.338 s, 8,050
cases. Its typing fixture was refined while that batch was in progress,
so those 150 typing cases are **not** counted as final-source qualification.
The other four files were unchanged throughout that batch. An intermediate
50-run typing batch also passed 150/150 but is diagnostic only because its
source changed during the batch (`typing-final/`). The final typing-only
batch took 105.461 s, ran entirely beside the original batch's burners,
and its recorded source SHA-256 still matches. Final coverage substitutes
that batch's 150 cases for the original 150 rather than adding them twice.

The sole main client invocation (197 regular files, concurrency 95) finished
with 3,826 passed, two module-load failures, ten existing skips, zero
cancellations in 464.969 s. All acquisition shards passed (47 tests total),
and all server-e2e shards passed (nine tests). The two module-load failures
and their successful prerequisite repair are recorded below.
The serial session/client model files passed all 79 tests (including both
5,000-sequence session arms), zero failures/skips, in 287.288 s. Thus the
original client phase totals 3,961 passed, two load failures, ten skips and
zero cancellations. The corrective two-file run adds the 48 tests that could
not load initially; there is no second whole-suite invocation.

The ten unchanged skips are listed verbatim in `client-skips.txt`: one macOS
Expo-media witness, two opt-in managed identity fixtures, one published
0.2.27 bounds control, one published 0.2.33 F2 control, four published 0.2.33
capability/control cases, and one actual 0.2.32 server compatibility case.
No skip was introduced or removed. Chromium witnesses ran; there is no
missing-browser skip hidden in these counts.

`run-client-suite.py` mirrors only the client portion of `scripts/test.sh`:
ordinary files with suite-selected concurrency, acquisition in four shards,
server-e2e in three shards, then the two model files serially. It records the
exact file inventory and commands. It neither sources nor executes test.sh.

## Failure ledger

| Classification | Failure | Disposition / evidence |
| --- | --- | --- |
| Baseline, intentional reproductions | Lost-reply `1 !== 2`; typing's burst-retention assertion, two failed tests | `reproduction.log.gz`; both mechanisms repaired. |
| Ours, intermediate fixture | Initial controlled typing fixture omitted the separate default episode wall clock: online and process default-retention assertions failed | `focused-1.log.gz`, 10 pass / 2 fail. Added controlled Date.now; `focused-2.log.gz` is 3/3. |
| Ours, intermediate fixture | First mock-clock conversion did not advance the sender's monotonic renewal clock: empty-patch renewal assertion failed | `siblings-focused.log.gz`, 2 pass / 1 fail. Control performance.now too; `siblings-focused-2.log.gz` is 4/4. |
| Ours, intermediate transport | The first long-pause control buffered poll heartbeat bytes: all three tiers went offline and withdrew; diagnostic online rerun also failed | `controlled-delay-fixed.log.gz` (0/3), `controlled-delay-debug.log.gz` (0/1). Preserve heartbeat stream; `controlled-delay-fixed-2.log.gz` and `controlled-delay-final.log.gz` each pass 3/3. |
| Ours, command setup | First reproducer command used an extra `snapback4/` path from inside that directory, so hook creation and its import failed | Corrected path before the recorded baseline reproduction; no source/runtime implication. |
| Ours, command setup | Ref-check was first launched from inside snapback4 and found no root llp corpus: 1,071 reported missing refs | `ref-check-wrong-cwd.log.gz`; rerun at repository root passes. These are not 1,071 product regressions. |
| Ours, exploratory reads | Initial root-relative package path, uninitialized local skill symlink, absent build outputs/config, and guessed clock/guide/media/test filenames were missing | Corrected paths or read the existing adjacent llp-orient skill read-only; no build/test result was inferred from a failed read. |

The sole whole-client invocation reports two environment/setup failures:
`event-slot-capability.test.mjs` and `event-slots.test.mjs` failed at module
load because `target/event-slots-traces.json` was absent. FL omitted that
fresh-tree prerequisite; these were not product assertions or baseline
content regressions. `event-slots.test.mjs` documents the producer normally
run by test.sh's Rust phase. Generated it with
`cargo test -p snapback4-device --test event_slots_trace`, then reran only
those two files at concurrency 95. The whole-client invocation is not
silently relabelled green, and the whole client suite is not run a second time.
The producer passed both Rust tests; the two client files passed all 48 tests
with zero failures, cancellations or skips (`event-slots-producer.log.gz`,
`event-slots-prerequisite-rerun.log.gz`).

## Governing context and affected-document audit

Used llp-orient read-only for this test-only scope. The local vendor skill
was uninitialized, so read the existing skill at
`../lane-ex/vendor/llp/skills/llp-orient/SKILL.md`. The context pack is scoped
to the two fixtures and their timing siblings:

- `LLP 3000#6`: at-most-once and convergence invariants; `LLP 2000.000#7.2` / `#7.3`:
  stream correlation, prediction and durable caller ids.
- `LLP 3000.017#2.2` / `#2.4`: four-second row life, renewal and ephemeral client
  behavior. `LLP 3000.019#3.3` and `LLP 3000.023#3.1` / `#3.2` / `#3.3`: retained answers,
  independent episode and row deadlines, revalidation and mandatory expiry.
- Read the current reads/writes/expiry guide surfaces and the existing test
  `@ref`; the retention reference still applies. These LLPs are in current/
  (except the 2000.000 design brief); none is promoted to foundation here.
- Risk: fake time must not buffer heartbeat delivery or replace actual server
  expiry. The delayed control and independent real-server deadline assertion
  cover both. Real latency acceptance tests still measure host scheduling.
- No product design decision changed, so no new LLP or guide edit is needed.
  Update only the tickets, this report and the append-only journal. Hand-off:
  none; supervisor owns the subsequent landing suite and Mac publication.

Final audit: no product-source diff; all five tested source SHA-256 values
match `final-source-sha256.json`; append-only journal and staged whitespace
checks pass. Baseline content failures outside the deliberate reproductions:
zero. Remaining failed affected tests: zero. The original full client record
still includes the two repaired setup failures above.
