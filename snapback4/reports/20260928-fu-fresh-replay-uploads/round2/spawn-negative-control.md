# Spawn refusal negative control

Copied tracked Snapback 4 source to ignored `snapback4/target/fu-r2-spawn-no-guard/`, including the final `serve_overload` test. In that copy only, replaced `PendingRequest::drop`'s `self.admission.refuse(request, self.class)` branch with an empty body. Its owned `Request` consequently takes its ordinary destructor path on an actual failed thread spawn. The test uses the real socket, unfinished upload body, default connection limits and an impossible requested thread-stack size; no process/thread limit is changed.

Ran from the repository root:

```sh
CARGO_TARGET_DIR="$PWD/snapback4/target" cargo test \
  --manifest-path snapback4/target/fu-r2-spawn-no-guard/Cargo.toml \
  -p snapback4 --bin snapback4 \
  failed_thread_spawn_refuses_unfinished_upload_and_releases_permit -- --nocapture
```

Expected exit 101: one test fails, peer sees `HTTP/1.1 500 Internal Server Error` instead of 503; unfinished-body read lasts until the test peer's 500 ms deadline. The original guarded workspace passes all three overload tests after rebuilding (`spawn-qualified.log.gz`). This is a test-only copy; none of its changes were applied to product source.

The first copy omitted included app/benchmark fixtures and did not compile (`spawn-no-guard-setup.log.gz`, ours). Copied the tracked app fixtures and linked the existing read-only benchmark tree before the actual negative test. The corrected test result, not that setup error, is the regression evidence.
