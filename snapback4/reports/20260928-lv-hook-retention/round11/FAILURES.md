# Round 11 failure accounting

All unexpected implementation, fixture and command-setup errors below are ours;
none is silently relabelled green. Expected controls are also attributed to LV.
The original logs are retained. Census and full-suite inventories appear below; an old-contract assertion is not a baseline product exemption.

- **Ours, expected regression:** before.log.gz, all nine round-11 real-host
  regressions fail on unchanged round-10 SDK at their state/retention assertions.
  The pre-LV SDK passes all nine. Round 11 passes all nine.
- **Ours, expected property control:** model-before.log.gz, seeds 1–30 fail on
  round-10 SDK; no-success-order.log.gz, seeds 1–30 fail after deleting only
  successful-local publication registration. The corrected implementation
  passes all 30.
- **Ours, fixture:** focused.log.gz, `pure local publication model seed N`,
  every N=1–30, failed with TypeError reading `key.every` because the model's
  minimal serialized Get lacked `key`. Supplying `key: []`, an index and args
  corrects fixture metadata. Full affected and final-targeted runs pass.
  A separate seed-1 diagnostic rerun reproduced that same TypeError.
- **Ours, setup:** before-missing-binary.log.gz, all nine new regressions failed
  at spawn ENOENT because the server binary had not been built in this restored
  worktree. Built the current server; the next run reached all intended assertions.
- **Ours, guide snapshot:** first whole-guide run, 97 passed / one failed:
  `familiar::every_moved_fact_has_its_why_or_details_home`, stale reads-06 text.
  Updating the existing snapshot to the edited guide corrects it.
- **Ours, command setup:** one initial test-file write used repository-prefixed
  paths while already in snapback4/, so neither file was written. The subsequent
  explicit-path creation succeeded. Initial `git archive` likewise used the
  wrong path prefix for its working directory; rerunning at repository root
  built the isolated pre-LV SDK. No product conclusion comes from either attempt.
- **Ours, read-only orientation:** guessed LLP/test/search/error-helper paths
  and one script glob did not exist; actual files were located with scoped rg.
  One overly broad review-tree path search was truncated. These changed no files.
- **Environmental availability, not a test exemption:** the documented
  `~/Dropbox/APIKeys/MACHINE_FLEET.md` is absent on this host. All tests use this
  worktree's local runtime; no remote or Expo UI qualification is claimed.

- **Ours, census setup:** the first round-10 control resolved a symlinked dist
  outside its package and could not resolve `#fetch`. It reports 46 pass / 44
  fail: 34 file-load failures plus ten already-known old-policy assertions.
  Every failure is named in census-round10-setup-failures.json. Copying src/dist
  inside the control package restores imports; the complete control then ran.
- **Ours, historical contract/fixture deltas:** the unchanged original corpus
  passes 1,007/1,007 on pre-LV, and has exactly the same 219 failures (788 pass)
  on round 10 and round 11. CENSUS.md and census-failures.json enumerate every
  name, original location and reason. No newly failing round-11 plain-read
  expectation was found. These are prior LV differences, not baseline or
  environmental test exemptions and not a green historical comparison.
- **Ours, old census teardown:** presence-refresh's old loading assertion leaks
  an interval after failing. After all other children ended, only that exact
  process was stopped in each LV control. Original assertions rerun with
  --test-force-exit give 9 pass / 1 fail on both, the same loading assertion.
  Both census root runners report all 1,007 tests with zero cancellation.

- **Full suite:** exactly one scripts/test.sh invocation, exit 0,
  `== 0 failure(s) in 1322 s`. No failing stage or test: ours 0 / baseline 0 /
  environmental 0. Declared skips are separately listed in full-suite-skips.json.
  The final affected, FU, guide and targeted regression runs have no failures.
- **Ours, report formatting:** final staged whitespace check found one extra
  blank line at CENSUS.md EOF; removed before the passing final check.
