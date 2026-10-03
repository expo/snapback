# Round 8 reproduction, custody and failure ledger

Base `9b7dc784049646a83d4a951f69c37bd326e9b781`, branch
`sb4-np/nx-export-proves-native-slim`. Read the complete Astra review at
`eb1000:~/sb4-intent/reviews/nx-r7.astra.md` and the surviving
`/tmp/nx-r7-review-oi09j9j4/make-probe.py`. This round responds to the review;
it does not claim a new independent reviewer verdict.

## Reproduce

From `snapback4/`, with the frozen dependencies and built JS package:

```sh
export PATH="$HOME/.volta/bin:$PATH"
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo build -p snapback4
cargo test -p snapback4 --bin snapback4 verbs::witness -- --nocapture
cargo test -p snapback4 --test witness -- --nocapture
node --test packages/snapback4/test/export-native.test.mjs packages/snapback4/test/export-native-round2.test.mjs packages/snapback4/test/export-publication.test.mjs packages/snapback4/test/export-failure.test.mjs
```

The native helper unit fixtures execute the sibling `target/debug/snapback4`,
as the existing worker watchdog fixtures do; build it first. This executes the
production native supervisor, anchor and platform watcher, not a test twin.
The resolver owner fixture runs the actual Rust resolver in a separate test
process so real SIGTERM/SIGINT/SIGKILL cannot change the parallel test runner's
signal state. Darwin also tests SIGTERM and timeout through the real public
`witness ios --build --smoke --export` CLI with fake xcrun. Linux's public iOS
CLI still refuses before native preparation; its resolver/group regressions
exercise the production functions and native helper through the isolated owner.
No real simulator is used anywhere in these checks.

Mini: actual Volta launcher on PATH, Node 24.18.0. Linux:
`/tmp/sb4-nx-r8.2Of3jA` on 100.65.137.99, Node 24.13.1, Rust 1.97.0,
kernel 6.8.0-138-generic, Bun frozen install, `CARGO_BUILD_JOBS=8`, same SQLite
flag. No other worktree or simulator is used. `source-transfer.json` records
both the initial source archive and the final overlay (two test-containing
Rust files). `linux-validation.json` rehashes all 2,359 final source files and
the copied logs before scratch deletion. Built `dist/resolve-binary.js` and the
embedded benchmark inputs are included from the outset.

`run-suite.py` makes exactly one canonical `scripts/test.sh` invocation,
records its PID and final status, and keeps the actual Volta launcher on PATH.
No guard, concurrency, sample count or suite-budget override is applied.
`tested-source.json` binds the final affected files verified on both hosts;
`suite-start-source.json` binds the canonical invocation. One later test-only
path change gives the resolver fixture a private parent instead of scanning
the host temp root during `recovery::begin`. `fixture-scope-change.json` records
that delta; product code is unchanged. Affected units were repeated on both
hosts, with no restart of the canonical suite. Final suite result and archive identity are recorded in the report.

## Structural boundary and regressions

A native guardian outside the process group spawns a native anchor that is
the group leader, then holds that child unreaped through group cleanup.
The driver fsyncs the PGID, anchor birth, guardian birth and reaping lock into
`live.json` before releasing the launch pipe. The anchor runs either the Node
resolver or the actual worker. Launchers never select the custody mechanism.
The old JS runner remains only as a legacy-recovery regression fixture.

Recovery holds the reaping lock and verifies the original anchor birth before
whole-group STOP/KILL, then repeats inspection to two consecutive empty checks.
The native guardian uses group KILL with its unreaped child directly and also
requires two empty checks. No captured child list decides which PIDs to kill.
Darwin's zombie birth uses the SDK's `sysctl(KERN_PROC_PID)` / `extern_proc`
prefix; `proc_pidinfo` and `getpgid` both hide zombies. A matching live guardian
plus held reaping lock justifies the recorded group after the leader exits.
Linux uses `/proc` birth including zombies. The exited-anchor regression
pauses only its own guardian, kills only its own anchor, joins another owned
member, recovers it, resumes the guardian, and checks cleanup.

The three earlier late-member tests remain. Three additional cases remove
the worker first, assert that the snapshot contains only the anchor, and join
a member immediately after that final empty-child snapshot. Direct Node,
non-exec shell shims and Volta-style spawn-and-wait shims all run on both hosts.
Retry, repeated output cleanup and exactly one shim invocation remain asserted.
The original mismatched-birth, lost-anchor, TERM-resistant descendant, live
wrapper, publication, repeated SIGKILL orphan and lease regressions remain.

Linux arms `PR_SET_PDEATHSIG` on the supervisor, anchor and worker, checking the
parent after arming. On Darwin each native helper watches its owner with
kqueue `EVFILT_PROC/NOTE_EXIT`, also checking the parent after registration.
These are kernel owner-death notifications, independent of inherited pipes.
See [Linux's parent-death contract](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html)
and [Apple's kqueue contract](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html).
The SIGKILL regression demands that the stalled launcher and descendant are
already dead before invoking recovery; Rust Drop cannot satisfy that case.

Resolution gets `min(30 seconds, --timeout)`, starting before launch; its native
custody handshake has a separate five-second bound and cancellation polling.
Timeout names the launcher in `E_WITNESS_PROCESS` and says to finish the pinned
Node installation/download in the project before retrying. The signal tests
use the ordinary 30-second resolver budget, then send the signal after the
journalled launcher actually starts. The unit timeout case chooses three
seconds; the real Darwin CLI timeout case chooses two. Each checks no surviving
launcher/descendant and requires cleanup before `finished.json` can appear.

Final mini owner-response measurements, including group cleanup: SIGTERM
269.306 ms, SIGINT 244.065 ms, SIGKILL 65.615 ms. The timeout completed 2.689 s
after the observed launcher marker (its deadline starts earlier). These are
regression observations, not a latency qualification or native timing cohort.

## Failures during implementation (retained, all resolved)

- `mini-units-1.log`: 40 passed before the exited-anchor regression was added.
- `mini-units.log`: 40 passed / one failed. The new exited-anchor test exposed
  that Darwin `proc_pidinfo` excludes zombies. Product custody defect in the
  first implementation; fixed by the `KERN_PROC_PID` birth lookup.
- `mini-units-2.log`: 40 passed / one failed. Zombie birth now matched, but
  Darwin `getpgid` also excludes zombies. Product custody defect in the second
  implementation; fixed by using the recorded group only with the retained
  zombie birth, matching guardian and held reaping lock.
- `mini-units-3.log`: 40 passed / one failed. The new signal fixture incorrectly
  used a one-second timeout; it expired before its launcher reached the marker
  under concurrent startup. The observed outcome was the expected timeout
  refusal, not an uncancellable resolver. Signal cases now use the ordinary
  30-second budget; the separate explicit timeout regression uses three seconds.
- `mini-units-4.log`: 40 passed / one failed. The fixture observed its PID file
  after creation but before printf completed. Both new shell fixtures now
  publish the descendant marker with rename, as the existing Node fixture does.
  No production guard or deadline was changed for this fixture synchronization.
- `mini-units-final.log`: 41 passed. `mini-integration.log`: 55 passed (before
  the marker-publication fixture correction; the canonical run repeats it).
  `mini-js.log`: 19 passed. Linux: 42 units / 13 integration / 18 JS passed,
  one existing Darwin-only skip. No Linux setup/test failure occurred. The final
  private-parent fixture recheck again passed 41 mini / 42 Linux units.

A preliminary read-only SSH command using `eb1000` failed because that alias
is absent on the mini. The fleet's authenticated address 100.65.137.99 was used.
No verification was claimed for that failed lookup.

## Remaining scope

LLP orientation covers preparation, abandoned-process recovery and their
regressions. LLP 3000 §4 is the Snapback 4 fence; LLP 3000.030 §15 governs group
custody, publication, leases and retention. Both are current LLPs. The witness
card was read and now states the resolver deadline/remedy without increasing
its 399-line count. LLP 3000.030 §15 and the JOURNAL are updated in this change.
The affected LLP audit found no invalid @ref; repository ref-check reports
525 documents, 10,187 refs, zero errors and zero unchecked. No Snapback 1/2
inventory or runtime bootstrap was invoked. Hand-off: none.

The new `issues/20261002-snapback4-nx-custody-recovery-residuals.md` records the
remaining exceptional recovery window after another actor kills the guardian,
legacy unpinned-group reuse, intentional group escape, outside joiners and
stalled inspection/kernel limits. Normal guardian-owned cleanup has no numeric
PID reuse interval. Neither platform has an unconditional orphan-free claim.
Publication verification, swap-back, orphan reconciliation and leases remain
intact. Social's 25-second target stays open; candidate median 26.716 seconds
from round 5b, pending quiet-host measurement. No new timing cohort or budget
change. Wasm unchanged; no publication, push, M6/M8 or real simulator claim.

Evidence tooling: the archive/copy script raised `NameError` only in its last
informational print (`len(m)` instead of `len(manifest)`), after writing the
manifests, receiving Linux's 2,359-file validation, copying every log, and
checking their hashes. An independent read-back check of those outputs and the
current tested-source hashes passed before deleting Linux scratch. This was a
reporting-script failure, not a product/test failure or missing validation.

Git staged whitespace checking flagged terminal blank lines in seven small log
views. Only those presentation bytes were normalized; the complete original
logs remain in the external archive. `small-log-formatting.json` records both
hashes, and Linux validation retains the originals. No result changed.

## Canonical result

Exactly one invocation, exit 0: **`== 0 failure(s) in 2426 s`**. Client pool:
5,767 passed, zero failed, five existing skips. Final models: 79/79. Guide:
110/110. CLI units: 244 passed, four existing ignored. Witness integration:
55/55. There is no canonical failure to classify. The known delivery-fault
follow flake did not reproduce; this lane does not claim to fix it.

The private-parent follow-up used `/tmp/sb4-nx-r8-final.DZuddG`, verified all
2,359 source files again and passed all 42 witness units. Both Linux scratch
directories were deleted after source/log read-back verification. The canonical
snapshot and one-line test-only path delta are retained separately from the
final tested-source digest. All product-source bytes are identical.

The final archive script completed log/source read-back verification and report
updates, then its optional `rmdir` of the final mini fixture parent found the
expected empty `retention.lock`. Inspection confirmed that was its only entry;
only that owned lock and directory were removed. This cleanup-script error did
not affect the completed tests or archived evidence.
