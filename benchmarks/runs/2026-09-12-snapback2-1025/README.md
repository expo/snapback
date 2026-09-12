# LLP 1025 implementation evidence — 2026-09-12

Base: `86411120303c1ea87a890f829fd5bfc3eb70f01d`.
Source reviewed: `19ee70941d` (same-family independent review, no material
findings remaining). Full combined suite ran at `1ed90fe087`; the later source
delta corrects one standalone copied-app journey, which passed separately.
Final documentation/evidence commits do not change the engine or recipe.

Implemented: recipient-period custody with paired explicit positive chat totals,
and pinned-clock timer draining before job chunks (LLP 1025.000 / 1025.001).
Receipt exemption withdrawn after memory/validation audit; cascade, defer and
missed-period catch-up shelved with reasons in their LLPs. No ceiling changed.

## Executed evidence

- `clique.check.json.gz`: current complete corrected production app, 70 admitted
  programs. Final digest: closure 1,890,203; heap 2,774,764; examined 1,514;
  steps 27,884. This is the production correction, without inspection/helpers.
  A real debug CLI check took 6.52 s on the Linux warm lane, outside a release
  product-latency claim. The copied source is reproduced by the correction
  README's existing patch chain; retained benchmark originals were not edited.
- `owner-{distinct,post,expiry,incarnation,101-final,emission-matrix,ordinary-unsend}.json`:
  seven passing real-owner journeys, 187/117/771/555/718/465/285 ms respectively.
  These use the existing isolated headless harness and production mutations.
  They cover private source and aggregate authority, forgery, distinctness,
  replay/post deletion, clients-closed native expiry, incarnation cleanup and
  pruning, activity in membership 101, and emission-time read/unsend/expiry.
- `tests.log.gz`: `snapback2/scripts/test.sh` exit 0 on the Linux EPYC warm lane;
  1,450 package and 1,204 native tests pass, compiler/evaluator/artifact checks
  pass. Native totals are 1,197 parallel + 7 serial tests. Package wall time
  77 s exceeds the existing 60 s total-loop target; functional green is not a
  claim that the loop target is met. The first integrated run found a stale
  guide-wording assertion; the correction and full successful rerun are real.
- The native suite includes
  `period_digest_restart_preserves_cutoff_receipts_and_one_logical_effect`:
  disk-backed runtime close/reopen, saved cutoff/cursor, failed effect attempt
  retried with the same identity/payload, and no duplicate logical emission.
  It does not execute an external provider or physically kill an owner process.
- `measure.log`: pinned Node 24.18.0 / esbuild 0.25.9 / gzip 9. Latency checks
  pass: incremental 3.08 s, affected consumer checks 23.36 s, project check
  0.927 s, doctor 0.037/0.036 s, init-to-dev 1.604 s. Canonical package sizes
  142,989 / 152,942 / 156,395 / 89,843 match the already recorded main source.
  The four historical byte-baseline guards still fail; runtime stays under
  90,000. Both actual loop/twin appends are retained in `snapback2/metrics/`,
  including the first run's wrong-Node qualification refusal. No baseline reset.
- `ref-check.log`: pass. `caps.log`: existing 205/204 source-count failure.
  `source-cap-delta.json` shows every changed source remains below 1,500 lines;
  the printed smallest S1 overflow path is not attributed as the breaker.
  `inventories.log`: existing root caps-test registration and stale/missing S1
  generated artifacts. See the existing 2026-09-11 scripts-inventory and package
  growth issues. These failures are preserved, not reported as green.

## Uncompleted hub owner witness

`owner-hub.failed.json.gz` is the exact failed receipt. The final seed has
3,904 rows and is a **static literal**, not executable seed-generation code.
`owner-hub.q` is an admitted chunk-2 setup job; `owner-hub-schema.q` supplies its
plan table. The helper's final generation is
`56162634dc5fedca49181904973f852a11b33e12fe688df40a36a411579a2df8`.

Startup refuses the seed at 41,336,564 heap bytes against 8,388,608. No journey
ran. The original 15,804-row one-write setup also exceeded 10,240 rule probes;
moving conversation population into chunks did not solve follow-table seed
cost. The failed setup is retained here, outside runnable correction fixtures.
Compiler acceptance at the declared envelope is not a full hub runtime pass.
The remaining bounded setup work is tracked in
`issues/20260912-snapback2-hub-digest-owner-qualification.md`.

To reproduce this **failure** in an isolated copy after the production patches:
append `owner-hub-schema.q` to `snapback/schema.q`, copy `owner-hub.q` as
`snapback/hub.q`, decompress `owner-hub.seed.ts.gz` to `snapback/seed.ts`, and
copy `owner-hub.test.ts` to `snapback/tests/hub.test.ts`. Run the current checkout's
owner/compiler with the journey name in that file. Its setup job requires
`{ periodStart: 2100000000000 }`. The assertions describe the intended successful
witness: 100 groups, 900 DMs, 500 follows, membership-1,001 refusal, one scheduled
digest with counts 1 / 500 / 1,000 / 1,000 and no SDK client attached at emission.
They have not passed in this run.

No credential, database, provider setting or external delivery is retained.
This record does not qualify npm publication or browser/device performance.
