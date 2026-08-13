# Settlement re-entry failure report

## Classification

**(b) The public detail contract changed deliberately, so the test needed to
select the development projection explicitly.**

This is not a regression in either run commit named by the charter. The
handler-error projection is unchanged between base `9a8edc949` and `HEAD`, and
neither `5190b7cce` nor `fc31cf716` changes `HandlerErrorExposure`,
`project_handler_failure`, or the handler-envelope message extraction path.
A detached scratch build at `9a8edc949` reproduced the same assertion failure.

The controlling author-routed precedent is
[`issues/closed/20260809-main-red-handler-error-exposure-triple.md`](issues/closed/20260809-main-red-handler-error-exposure-triple.md#resolution--2026-08-10),
whose resolution says verbatim:

> The sequence test is specifically proving the LLP 0135 app-authored
> throw/console disclosure channel, not the production-default error
> projection. `13ab8037c` had already pinned that invocation to development
> exposure while retaining the original `"tentative:1"` expectation and the
> no-durable/no-result-trace assertions; this lane preserved and reverified
> that correction.

The served guide records the same deliberate contract in
[`guide/backend/mutations.md`](guide/backend/mutations.md#debug-snapback_handler_failed-under-the-dev-supervisor):

> This visibility split is intentional: managed development favors the shortest
> debugging loop, while production remains redacted by default because exception
> messages and stacks can contain handler source, arguments, or other private
> context. The enriched message is debugging evidence, not stable product copy;
> declare a refusal code for any condition a client must branch on.

This preserves LLP 0193's diagnostic-quality property: managed development
still carries the extracted error, while production continues to protect
handler source, arguments, and other private context. The settlement test is
using the authored throw only as an internal re-entry witness; it is not making
the throw text an application contract.

## Root cause

The test was introduced before commit `a8787cb536` and asserted directly on
`diagnostic.details["message"]`. Commit `a8787cb536` then introduced the
development/production exposure split. The exact causal hunk was:

```diff
+impl HandlerErrorExposure {
+    fn from_process_environment() -> Self {
+        match env::var(HANDLER_ERROR_EXPOSURE_ENV).ok().as_deref() {
+            Some("development") => Self::Development,
+            _ => Self::Redacted,
+        }
+    }
+}
...
+    if exposure == HandlerErrorExposure::Redacted {
+        error.diagnostic.message = "JavaScript handler failed".to_owned();
+        error.diagnostic.details = json!({ "function": function });
+        return Err(error);
+    }
```

The test was not updated to select development exposure. Its later compile gap
after the required `authority_profile` field was added hid the stale assumption
until this run.

Temporary instrumentation captured the actual pre-fix diagnostic at `HEAD`:

```json
{
  "code": "SNAPBACK_HANDLER_FAILED",
  "severity": "error",
  "subsystem": "runtime",
  "message": "JavaScript handler failed",
  "details": {
    "function": "throwSettlement"
  }
}
```

The detached `9a8edc949` probe produced the same failing assertion:

```text
thread 'settlement_identity_is_stable_across_a_genuine_re_entry' (...) panicked at tests/mutation_settlement_identity_v0.rs:248:14:
handler failure carries the extracted error message
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.09s
```

All temporary diagnostic instrumentation was removed.

## Fix

The one invocation whose authored error text supplies the re-entry witness now
runs inside the existing thread-local
`snapback::runtime::with_development_handler_error_exposure` seam. The original
message parsing and both settlement assertions are unchanged. The production
default remains redacted.

```diff
-        let error = invoke_with_id(snapback, "throwSettlement", json!({}), client_mutation_id)
-            .expect_err("the retry probe deliberately throws before settlement");
+        // The re-entry witness is carried by an app-authored throw, whose
+        // message is intentionally visible only under development exposure.
+        let error = snapback::runtime::with_development_handler_error_exposure(|| {
+            invoke_with_id(snapback, "throwSettlement", json!({}), client_mutation_id)
+        })
+        .expect_err("the retry probe deliberately throws before settlement");
```

## Verification

Bootstrap:

```text
[snapback-bootstrap] exact link + launch + handler-VM qualification smoke passed with dynamic-loader overrides scrubbed
[snapback-bootstrap] Ibex runtime bootstrap complete
```

`cargo test --locked --test mutation_settlement_identity_v0`

```text
running 6 tests
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
```

`cargo test --locked --lib settlement`

```text
running 17 tests
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 2629 filtered out; finished in 0.69s
```

The first invocation of that exact command did not reach the test binary
because rustc encountered a transient incremental-cache copy failure:

```text
error: unable to copy .../target/debug/incremental/.../69pqze7fn2yn49w1693l1xga4.o to .../target/debug/deps/...69pqze7fn2yn49w1693l1xga4.1xg4k7l.rcgu.o: No such file or directory (os error 2)
error: could not compile `snapback` (lib test) due to 1 previous error
```

An exact retry rebuilt the affected cache and produced the 17/17 result above.

`cargo test --locked --lib media_ref_projection_acceptance_tests`

```text
running 10 tests
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 2636 filtered out; finished in 0.15s
```

`./ref-check --verbose`

```text
ref-check: ok — 245 LLP docs, 5959 refs in 13554 files, 0 errors, 0 unchecked
```
