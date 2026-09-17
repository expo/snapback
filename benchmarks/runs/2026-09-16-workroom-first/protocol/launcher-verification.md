# Pilot launcher verification

Historical initial-pilot runner SHA-256 (not the repaired r3 runner):
`35f2417ea79479f18c0ae8d19e4107d1cf10284c0f25505a6b283c4dbe11f53b`.
Node 24.13.1. No real model was used by these mock checks.

- Neutral packet staged outside Git; starter 294 and conformance 96 records
  generated and independently verified. Delivered manifest SHA-256:
  `da59b8261abc345758d761042cca6513c29f3e270f97062038503e58b7f3be70`.
- Original candidate mock checks retained successful, exit-7 and unavailable
  native-rollout outcomes with private logs and end records.
- Repaired candidate: same-group descendant remaining after leader exit was
  terminated and its group disappearance recorded; authored app FINAL and
  CLI last-message had distinct retained identities.
- Repaired candidate: changed brief failed post-run integrity and returned
  126; wrong child-PATH Node version was refused before spawning the builder.
- Final candidate: fake ps returning another PGID never caused a negative-PGID
  signal. Exact-child cleanup recorded TERM then disappearance; with a delayed
  fake ps allowing the child to install its TERM-ignore handler, it recorded
  TERM, five-second wait, KILL, and confirmed disappearance. Both refusals
  returned 1 and retained end.json.
- Final syntax and git whitespace checks pass. The one-line final delta only
  removed an unrecorded early TERM in the failed-PGID branch; the affected
  exact-child paths were rerun. Other repaired paths are unchanged.

Private mock receipts live below `/tmp/workroom-review.W8gyXV/` on the control
Mac; its `*-stage-path` files identify the retained cases. These are launcher
checks, not Workroom application acceptance or benchmark results.

Sol and Grok independently cleared the final hash, with received source and
delta reviews retained in `../reviews/`. The first Grok attempt returned no
verdict and is not counted. Sol cleared before diagnostic launch; Grok's fresh
inline-source review completed while the diagnostic was running. This is
verification, not a scored-cell or application-qualification verdict.

## Descendant-custody repair after the capped pilot

The hash and review record above describe the launcher that started the first
pilot. That run is failed/capped: after its four-hour SIGTERM, the recorded
Codex group was gone but its `npm run acceptance` child survived in a distinct
PGID and reparented to PID 1. Nothing in that attempt is a scored result or a
cold-cell qualification.

The bounded repair at base `abe888311` records PID, start token/time, UID,
PPID, PGID and command SHA-256 for the Codex leader and every adopted process.
While the exact leader is live, a five-second snapshot loop adopts only
same-UID processes whose current PPID names a currently identity-verified
ledger member. An intentional ceiling, disk-floor or driver-signal stop first
sends only the revalidated Codex leader SIGINT and allows five seconds for
ordinary command cancellation. Terminal cleanup then validates every current
group member before signalling adopted descendant groups and the original
Codex group, and finally revalidates and cleans remaining exact adopted PIDs.
TERM and KILL waits are bounded. Exact signalling identity is PID, UID and
start token/time; a mismatch in any of those refuses the signal. PPID, PGID and
command SHA-256 are observed coordinates: their initial and latest values and
changes remain receipted, but normal reparenting, group changes and exec/argv
evolution do not create identity uncertainty. Foreign or unknown group
members, snapshot failures, cleanup refusals and survivors still fail closed
and remain in `end.json` plus the private custody event stream. Stop requests
clear the sampling timer and wait for any active sample before starting the
singleton cleanup. The authored `app/FINAL.md` and Codex's private last message
remain separate artifacts.

The cadence change is measurement-led instrumentation, not a product-runtime
claim. On the loaded control host, a full `processSnapshot` over approximately
3,212 rows measured 120.0 ms mean and 128.4 ms p95. At the former 500 ms
cadence that is about 24% nominal wall-time duty for the monitor path, not 24%
of all-host CPU. Five seconds reduces that nominal monitor-path wall duty to
about 2.4% on that host.

This is sampled, run-local ancestry custody, not generic subtree custody. A
process that double-forks and reparents between snapshots can escape adoption;
the end receipt says so explicitly and cannot by itself qualify a cold cell. A
launchd policy that cleans only Codex's
PGID does not repair a descendant that escaped into a distinct PGID. No cold or
scored cell could reuse this launcher until the opt-in actual-Codex ordinary
exec-spawn/session coverage below passed and its receipt was retained. The r2
result below clears that narrow precondition; it does not broaden the sampled
ancestry custody claim or qualify a scored cell or application.
The r2 result applies only to the sealed candidate now represented by base
`31dc2214f6295efd0570959f2683c51182e1b710`; changed r3 bytes require their own
actual coverage before any such reuse.

Focused mock command (Node 24.13.1):

```sh
/Users/ccheever/.volta/tools/image/node/24.13.1/bin/node --test benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs
```

Expected for r3: fourteen passes and one explicit skip. The retained opt-in
pre-cold-cell coverage command was:

```sh
WORKROOM_ACTUAL_CODEX_CUSTODY=1 \
WORKROOM_ACTUAL_CODEX_RECEIPT_DIR=/tmp/workroom-actual-codex-custody-20260917-r2 \
/Users/ccheever/.volta/tools/image/node/24.13.1/bin/node --test \
  --test-name-pattern='actual Codex ordinary exec-spawn custody' \
  benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs
```

It ran against the sealed candidate in this worktree on the control Mac with the receipt directory
initially absent and production `CUSTODY_SAMPLE_MS=5000`. It used one real
`codex exec` session and an ordinary foreground tool
command whose dependency-free fixture creates a distinct child PGID. The
retained `/tmp/workroom-actual-codex-custody-20260917-r2/coverage-receipt.json`
reports `passed: true`, `receipt.ok: true`, attempted leader SIGINT, the native
Codex thread ID, the exact fixture child among an adopted distinct group, zero
uncertainties and zero survivors. Before this documentation-only edit, the
repaired runner SHA-256 was
`10663ed1e623e2c5243283d2803d81609227a240ad1dac23adf35375be211064` and
the focused test SHA-256 was
`c166d9a51e2b6f0366288b700b8b401dc87bd27d83e2cd776cf746ed7996a38d`.

## Failed actual-Codex custody coverage r1

The first opt-in actual fixture at
`/tmp/workroom-actual-codex-custody-20260917-r1/` exited 1 after 13.15 seconds.
It retained native thread `01a0acdb-447d-7313-a354-ad20c9a0fef8` and fixture
child PID 8084. Sampling successfully adopted the actual ancestry chain,
including distinct PGIDs 8043, 8044 and 8084, and cleanup left no surviving
exact adopted PIDs. The marker parsed successfully; there was no newline
defect.

The receipt nevertheless failed qualification. The verified leader's SIGINT
grace expired after five seconds, so graceful cancellation was not proven.
More importantly, ordinary exec/argv evolution changed command SHA-256 for
processes whose PID, UID and start token/time remained stable. Treating that
evidence coordinate as immutable caused false identity-change uncertainties
and group-signal refusals for PGIDs 8043 and 7106. That is the repaired semantic
mismatch above. The five-second SIGINT grace is unchanged: the next real run
must determine whether the corrected identity rule yields `receipt.ok: true`
through bounded group cleanup even when graceful cancellation expires.

Retained r1 SHA-256 evidence:

- coverage receipt: `ff1acb45f712c3bf9be8f29ef9d2c36fc2815a4dd449ac00d5c2544a5cb1db35`
- Codex stdout JSONL: `3322c4500dec0ac29a22811098fd8cc91bb272008921ca19c64019ffda45deb3`
- Codex stderr: `301299f60b1c5afe9836c5be1385f38ea94d5de9051cca1721c5786eebac54a5`
- fixture source: `edaac673f71932c7e1fd11a9d7a4b4cf9fa0be4722cbde46b08ea973a7ec4f75`
- parsed marker: `5b85720217656ba59944e09ad8a854fa93b7ca4e73ee868e5fd00ac568799f71`

This r1 record is useful custody evidence but does not satisfy the documented
pre-cold-cell qualification. At that checkpoint no successful actual coverage
had been retained; r2 supersedes only that qualification outcome, not this
failed r1 record.

## Passed actual-Codex custody coverage r2

The exact command above ran under Node 24.13.1 with tool session 93079 and Node
test PID 3980. The exact actual-test pattern was
`actual Codex ordinary exec-spawn custody`; no actual coverage other than that
pattern ran. The test completed in 19.711510958 seconds with 1 pass and 0
failures. It retained native thread
`01a0ace4-5c9e-78a0-a3b6-bcc896f2fc96` and fixture PID 5215.

The coverage record reports `passed: true`, `receipt.ok: true`, seven adopted
identities, `uncertainties: []` and `survivors: []`. Leader SIGINT was attempted,
but its grace period expired; this result therefore does not claim that SIGINT
contained the native exec. Verified terminal cleanup made descendant groups
5202, 5209 and 5215 and the original leader group 4005 disappear after SIGTERM.
An independent post-check also found every adopted exact PID absent: 4005,
4010, 4011, 5202, 5209, 5210 and 5215.

Retained r2 SHA-256 evidence:

- coverage receipt: `3e753bd875c153ba2c4f60ca0cd7c57158cc67fefdd2c6b3805561d6d41a4419`
- Codex stdout JSONL: `b2c066988c84502129b10c1d46088f88f209d7d38f261794e1dcf1b20f587018`
- Codex stderr: `916f5185bd68346d3c0e81ce6d60ad32c43a13a60628db9750af6a7b487e8763`
- fixture child: `d4426a2dc863d74b162e408922ff8f76140cc8bb229be04a3ec4f66802eb7cb9`
- parsed marker: `ab3f008c8b772a9de2e955487a153742f83f5ddac68435b9b34fce0741fe3f44`

This passes the retained pre-cold-cell coverage requirement only for the
ordinary exec-spawn/session path under the sampled-ancestry limitations above.
It does not establish generic subtree custody or fast-double-fork custody, and
it is not itself a cold-cell, scored-cell or application qualification.

## Passed actual-Codex custody coverage r3

A fresh independent Sol review found a P1 in the sealed 31dc candidate. Its
terminal cleanup adopted once, froze the then-current descendant PGIDs, and
disabled adoption during group and exact-PID waits. A distinct-PGID child first
visible while a verified parent remained live during cleanup could therefore
survive while the receipt incorrectly reported `ok: true`. This is separate
from the documented fast-double-fork/reparent-between-snapshots limitation.

The bounded r3 repair lets an adopt-enabled snapshot extend custody from any
currently stable PID/UID/start-token ledger identity, including a verified
adopted parent after the original leader exits. A new identity still requires
its current PPID to name that currently verified ledger identity; PID 1 and
other unrelated processes are never ancestry roots. Graceful, group, exact-PID
and terminal snapshots all keep adoption enabled. Cleanup drains each observed
group at most once, resamples, handles newly observed groups, then uses exact
identity cleanup for safe ledger members left by a refused or unchanged group.
`adoptedGroups` is captured after the drain. Group signalling still requires
every current member to be a verified ledger identity; unknown or foreign
members refuse the group signal.

One internal, non-configurable 30,000 ms signalling/drain budget starts at
`_cleanup` entry, before graceful SIGINT, and clamps the graceful, group and
exact-PID polling waits plus the evolving drain. It is not a hard 30-second
stop-to-end wall-clock bound: an already active sample is awaited before
entry; a snapshot begun before the deadline has its own two-second timeout;
and the final evidence snapshot has a separate two-second timeout. This
bounded snapshot overhead is outside the drain budget, as is the separate
identity-unverified exact-child fallback. Exhaustion records
`PILOT_TERMINAL_CLEANUP_DEADLINE_EXHAUSTED`, performs an adopt-enabled final
snapshot, retains actual verified survivors and forces `ok: false`, including
when the last signal action races the deadline. Driver SIGINT/SIGTERM handlers
remain installed until custody cleanup or the exact-child fallback finishes;
repeated signals still converge through `requestStop` and the existing cleanup
singleton, and the handlers are removed only afterward.

Node 24.13.1 syntax checks pass. The focused deterministic suite reports 14
passes, 0 failures and one explicit actual-Codex skip. The new old-fail/new-pass
cases cover a distinct-PGID child first visible during its parent's TERM wait,
extension from a verified adopted parent after leader exit, and the 30-second
drain budget expiring during graceful cancellation with real final survivor
evidence.

The exact invocation below then ran against these exact uncommitted r3 bytes,
with the receipt directory initially absent, production
`CUSTODY_SAMPLE_MS=5000`, and the 30,000 ms signalling/drain budget. Tool session
42313 ran Node test PID 80789. The exact actual-test pattern completed in
25.754435625 seconds with 1 pass and 0 failures. It retained native thread
`01a0ad07-c8a5-7c02-9507-31fa653e2194` and fixture PID 83357.

The coverage record reports `passed: true`, `receipt.ok: true`,
`terminalCleanup: {limitMilliseconds: 30000, exhausted: false}`, seven adopted
identities, `uncertainties: []` and `survivors: []`. Leader SIGINT was attempted
but its grace expired, so this result does not claim graceful containment.
Verified SIGTERM cleanup made descendant groups 83306, 83322 and 83357 and the
leader group 80838 disappear. An independent `kill -0` check found every exact
adopted PID absent: 80838, 80843, 80849, 83306, 83322, 83342 and 83357.

The r3 runner and focused-test hashes used by that retained actual run are:

- runner: `b0ee4a49874f4d5723d431b7bc0f0e6aab6c61b617da1a201938fedcae429498`
- focused test: `97b43df6893810efa7c8f1ddf403ac1bd9057cbfab8604e313de42f42df8301e`

The retained invocation was:

```sh
WORKROOM_ACTUAL_CODEX_CUSTODY=1 \
WORKROOM_ACTUAL_CODEX_RECEIPT_DIR=/tmp/workroom-actual-codex-custody-20260917-r3 \
/Users/ccheever/.volta/tools/image/node/24.13.1/bin/node --test \
  --test-name-pattern='actual Codex ordinary exec-spawn custody' \
  benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs
```

Retained r3 SHA-256 evidence:

- coverage receipt: `dd0f9199b13490676eeb418d7078f31473cea0c1e261e27c274e54773b105d4d`
- Codex stdout JSONL: `41460e98a479adecafc27108518248813eba4e949a69fe1bc1dc39d9a2032498`
- Codex stderr: `2fecbb9755d3fbc762af749392187930065cdb3e1ce8fd1b541b061bf59a3ddd`
- fixture child: `9ece6afc0255ab7fe0200c0c2f93f5f09674dd7c52c00a65794485f55b841541`
- ordinary-exec-spawn marker: `fa7e120c9df8b918831f492904aff00582cd96d615560afe82399cf67d578c44`

The retained r2 receipt remains useful evidence for the obsolete 31dc
candidate only; it does not qualify r3. The r3 pass qualifies only the ordinary
exec-spawn/session path under the sampled-ancestry limitation. It does not
prove generic subtree or fast-double-fork custody, a cold or scored cell,
application qualification, or the late-visible-child race beyond the
deterministic mock cases. A process that double-forks and reparents between
snapshots can still escape sampled ancestry, so this diagnostic launcher makes
no generic subtree-custody claim.

## Bounded contract clarification — 2026-09-17

The supervisor narrows the timing claim to the contract stated above. This
documentation-only correction changes neither runner nor test bytes and does
not create any new execution evidence. The prior hard overall 30-second claim
was inaccurate; it is not retroactively treated as satisfied. No fourth
product-code repair round was undertaken.

Two further bounded completeness limits remain. Five seconds of
SIGINT grace can leave only 25 seconds for the leader group's default TERM
wait, exhausting the budget before KILL; the survivor/deadline receipt is
then non-green. A cap/disk/driver stop preserves its original process exit
code even when cleanup is non-green. Consumers must inspect `end.json`'s
`custody.ok`, not treat the preserved 124/125/130/143 exit alone as successful
cleanup. Those limits are retained, not described as stronger containment.

## Recorder-failure isolation — 2026-09-17

A later source review of the warm Workroom runtime found that a throwing
custody recorder could interrupt seeded cleanup. This shared-helper repair
keeps recording failure from interrupting identity-checked cleanup and
latches one in-memory `PILOT_CUSTODY_RECORD_FAILED` uncertainty. Even a
failure on the final completion record makes the receipt non-green.
It changes neither process discovery nor signalling authority nor timing.

Native Codex GPT-5.6 Sol (high) authored the change at
19:58:39.355Z–20:01:29.208Z. Root audited the complete source/test delta and
mechanically integrated the exact reviewed bytes:

- runner SHA-256: `32234d430e1235248e19e87795d0bb0d74cd42f1c5da41abe1d0cfdb32bc2a2c`
- tests SHA-256: `75109fc0d769d59846f830f531e5dd76dfa0878a434b39f207a71396102e1f7d`

An independent Node 24.13.1 run on 450b passed 20 deterministic tests, failed
zero and skipped the one opt-in actual-Codex test (77.4 ms). Its retained
log is `/tmp/workroom-custody-recorder-isolation-20260917/independent-node24-tests.tap`,
SHA-256 `6c9533221ff61a0dac2a0fbede97ba6169757acdf563fd3878d7c681613a9643`.
The author also ran fake tests despite the source-only phase instruction;
that fact is retained rather than presented as independent verification.
Six new cases cover first-seed, persistent post-seed, uncertainty-record,
completion-record, repeated-record and TERM/KILL-with-survivor failures.
These are injected recorder failures, not actual disk-fault or OS coverage.

Both independent source reviews are READY:
[Sol](../reviews/custody-recorder-sol.md) and
[Grok](../reviews/custody-recorder-grok.md).
Sol rechecked its own original caller finding with current pinned source;
Grok freshly read the current helper and full warm runtime packet.
Neither verdict qualifies an unreviewed provider-wrapper composition.

The earlier actual-Codex receipts above remain bound to their earlier
runner revisions. That opt-in witness was not rerun for this repair, and
no new cold/scored-cell, application acceptance, generic subtree custody
or whole-wrapper hard-deadline claim follows.
