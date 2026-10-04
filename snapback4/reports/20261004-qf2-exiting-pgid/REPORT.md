# QF2 — bounded retries for exiting process routing

Date: 2026-10-04. Host: eb1000 (`expose-builder-pixel`), Linux only.
Base: `6e4967479f`; branch `sb4-intent/qf2-exiting-pgid`. No push or publication.

## Finding and decision

RP's `familiar-forms.test.mjs` passed its native subtest, then cleanup refused
this exact row before selection or the disappeared-PID recheck:

```text
1301666       0 4294967295 1000 Sun Oct  4 05:45:04 2026 X+ snapback4
```

Tracking: `issues/20261004-snapback4-qf-exiting-linux-pgid-inspection.md` on
main since RP's merge `718ac00471` (confirmed by fetching during qualification).
This change resolves that finding; no duplicate closed copy is added.
The original isolated reproduction is `/tmp/rp-r7-main-inspection/`.

Choose the commissioned **bounded fresh-snapshot** option. On a precisely
recognized exit-time routing anomaly, discard the entire table and take at
most two more complete snapshots, 50 ms apart. No row from a discarded table
contributes membership, ancestry, or a liveness verdict. A clean fresh table
must pass the existing routing and scoped-metadata validation. Persistent
anomalies fail with the first error and exact row bytes, even if `exists`
returns false. Changed anomalous PIDs do not restart the budget. Other damaged
prefixes still refuse immediately; a failed reread cannot establish success.
Each ps invocation retains its two-second / 16 MiB bound (three calls maximum
per inspection, plus 100 ms total retry delay).

This avoids trusting the apparent identity of a damaged row. Keeper custody,
runner signaling, Linux `/proc` identity, native Node verdicts, leak checks,
guards and seeds are unchanged. `?` and exiting/tracing flags never grant
ownership. The runner still only closes its keeper's pipe; that keeper alone
kills its own group.

## Platform audit

- Linux's [`do_task_stat`](https://github.com/torvalds/linux/blob/master/fs/proc/array.c)
  initializes PPID to 0 and PGID/session to -1 before attempting the sighand
  read; its state table identifies X as dead. The RP capture supplies the
  unsigned ps presentation. Recognize X with PGID -1/4294967295, or PPID 0
  with an otherwise valid PGID, and only known procps stat flags.
- Darwin [`state()`](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c)
  prints Z for SZOMB, appends E for P_WEXIT before zombie state, and X for
  P_TRACED. [`tasks.c`](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/tasks.c)
  maps unknown Mach state to ?. Unknown is not dead. With sentinel PGID, Z,
  ? or an E flag permits a retry; tracing X alone does not. Valid-routing ?,
  E and X remain conservatively live.
- Darwin [`keyword.c`](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/keyword.c)
  reads PGID as UINT but uses PIDFMT `d`.
  [`fmtcheck`](https://github.com/apple-oss-distributions/Libc/blob/main/gen/FreeBSD/fmtcheck.c)
  treats d/u as the same argument type, so the printer retains signed -1.
  Tests also cover unsigned 4294967295 defensively. This is a source audit
  and synthetic-table execution on Linux, **not macOS qualification**.

`audit-sources.json` retains source URLs and SHA-256s. A Linux C probe of the
downloaded Darwin `fmtcheck` plus its `%*d`/`%*u` call selected `%*d` and
rendered unsigned -1 as `-1` (`darwin-format-probe.txt`). Only Darwin-specific
symbol annotation macros were disabled for that compilation; no macOS host
was contacted.

All recognized forms require a positive signed-pid_t-range PID, in-range
nonnegative PPID and well-formed UID/date/state/command fields. A sentinel is
never accepted as a group ID. Recognition only permits another snapshot.

## Verification

Final 11 QF2 regressions against the original main module: **8 fail, 3 pass**,
exit 1 (`pre-fix.log.gz`). Both existence values and both inspection phases
reproduce the captured-row failure. The persistent-file and conservative
state controls already pass on main. The baseline used an isolated temporary
copy of the runner, reporter, keeper and final test/fixtures, with only
`test-processes.mjs` replaced by `git show 6e4967479f:snapback4/scripts/test-processes.mjs`.

Final focused command, from `snapback4/`:

```sh
node scripts/run-client-tests.mjs 1 files \
  packages/snapback4/test/test-processes.test.mjs \
  packages/snapback4/test/test-file-runner.test.mjs \
  packages/snapback4/test/replacement-fixture.test.mjs
```

**80/80 pass, zero skips** (`focused.log.gz`): all 69 existing checks plus 11
QF2 tests. Recorded-row file regressions cross exists true/false with before
release/cleanup verification, retain the exact row for two snapshots and
require successful native exit, file verdict and acknowledged keeper cleanup.
The persistent-file control requires native exit 0 but inspection failure.
Synthetic controls cover Darwin spellings/flags, rejected lookalikes, failed
rereads, fresh-scope classification, changing PIDs and the three-snapshot bound.

Full command: `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`.
**Exit 0: `== 0 failure(s) in 1575 s`**, 04:17:54Z–04:44:09Z.
Rust: 4,811 passed, 34 existing ignored; doctests: 18 passed. Fixture wrappers:
9/9. Ordinary clients: 307/307 files, 6,123 passed and 11 existing skips.
Serial models: 79/79. Total JavaScript: 6,211 passed, zero failures/cancellations,
11 existing skips across 310 file results. `familiar-forms.test.mjs` passes.
`full-suite-summary.json` and `full-suite.log.gz` retain the complete results.
The suite uses unmodified file selections, CPU-derived pool (24 slots here)
and full-count serial models. No reduced counts, new skips or guard overrides.
Node 24.13.1; Bun 1.3.14; Rust 1.97.0. Dependencies were installed with
`bun install --frozen-lockfile`.
An independent copy of RP's existing local build cache (excluding incremental
state) warmed this worktree; Cargo rebuilt/validated it here. No shared target
directory was used or modified.

`llp-orient` context: [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#publication-suite-under-contention)
(current); LLP 2000.000 supplies the design brief; `rules/RULES.md` and
`snapback4/NOT-DOING.md` supply the fence. Scope is process inspection and its
tests, with no authoring or contract change. The affected corpus audit updates
§7, AGENTS and the fixture field audit together. No new LLP; hand-off: none.
Reference audit: 527 LLPs, 10,302 references, zero errors/unchecked. Final
whitespace checks pass. `source-before.sha256` and `source-after.sha256` agree
for every runner/keeper/reporter and focused-test input; no source or test
amendment occurred during qualification. `artifact-index.json` binds the retained
logs and result records. No independent review or macOS execution is claimed.
