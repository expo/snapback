# Pilot launcher verification

Final runner SHA-256:
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

Focused mock command (Node 24.13.1):

```sh
/Users/ccheever/.volta/tools/image/node/24.13.1/bin/node --test benchmarks/runs/2026-09-16-workroom-first/protocol/run-pilot.test.mjs
```

Expected here: eleven passes and one explicit skip. The retained opt-in
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
