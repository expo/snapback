# Snapback 4 replay tests read startup logs before the expected banners appear

**Opened:** 2026-10-02, lane X27R on the Apartment M5 Pro mini
**Status:** Open; failed in the complete suite, passed in the isolated follow-up
**Severity:** Test reliability; no failed replay-policy or HTTP response observed
**Area:** `snapback4/crates/snapback4/tests/replay.rs`

The required complete `snapback4/scripts/test.sh` run on local source
`d7c8c35a59` (base `e15de2e49a`, Node 24.18.0, Rust 1.97.0, Xcode 27)
failed two tests in `snapback4::replay`:

- `replay_startup_and_doctor_report_the_active_policy`, line 102: after the
  successful `/m/send` reply, the stderr snapshot ends at the store banner;
  the expected replay banner is absent. Doctor reports the expected persisted
  replay policy. Assertion: `left: false`, `right: true`.
- `w7c_dev_banner_names_the_store_and_stdout_is_readiness`, line 330: after
  its successful HTTP reply, the snapshot for `--fresh` ends at the listening
  URL, before the expected `store: temporary — discarded on exit` line.

Exact target result:

```text
test result: FAILED. 20 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 18.35s
```

Both tests treat an HTTP reply as a barrier for all stderr startup text. The
observed prefix snapshots are consistent with a log-observation race, but an
isolated rerun or delayed-log control is still needed to establish attribution.
The test, dev/serve implementation and engine/client are unchanged by X27R;
its changes are the Expo app configuration, witness diagnostics/provenance and
exact native-preparation script forms. Do not label this a lifecycle failure
or convert the red complete suite to green based on a focused rerun.

Raw output is outside git in `~/x27r-evidence/full-suite.log` on that mini;
`~/x27r.final.md` retains the exact complete summary and SHA-256 evidence index.
Inspect the log ordering/flush contract and make the test wait for the event it
asserts, without relaxing the HTTP-readiness assertion or increasing a timeout
as a substitute for a barrier. This is separate from the supervised-worker
log race in `issues/20260930-snapback4-supervised-workers-log-race.md`.

After the complete suite finished, the unchanged target was run once with
`cargo test -p snapback4 --test replay` on the same host/toolchain. Result:

```text
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.74s
```

This establishes intermittent reproduction on this source, not baseline
attribution or a fix. The complete suite remains red:
`== 2 failure(s) in 2601 s` (`cargo test`, `client tests`; the second category
is the separately tracked browser replacement fixture). Follow-up output is
`~/x27r-evidence/replay-followup.log`.
