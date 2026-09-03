# snapback2 hangs at compiler-worker shutdown when `node` is a shim (volta)

**Opened:** 2026-09-02 · **Closed:** 2026-09-02 · **Systems:** `snapback2/crates/snapback2/src/project.rs` (`CompilerWorker::terminate`)
**Severity:** P1 — every verb that compiles (`init`, `check`, `dev`, `test`) hangs forever on affected machines; the nextest `owner` and `init` suites hang 20+ minutes outside a sandbox. **VERIFIED by orchestrator on pristine origin/main `85a4c13a6`.**

`terminate()` did `child.kill()` (SIGKILL), `child.wait()`, then `output_thread.join()`.
When `node` on PATH is the volta shim (`~/.volta/bin/node -> volta-shim`), the shim spawns
the real node as a child instead of exec'ing it. SIGKILL to the shim orphaned the real worker
(reparented to pid 1) with the stdout pipe's write end open, so the reader thread never saw
EOF and `join()` blocked forever. The join was added by the 2026-09-02 review sweep
(`git diff 0b3a42a3d 85a4c13a6 -- snapback2/crates/snapback2/src/project.rs`); before it, the
orphan leaked silently instead of hanging the verb. Codex sandboxes resolve `node` to a real
binary, which is why the sweep's own qualification did not see it.

Repro: `SNAPBACK2_COMPILER=<dist>/compiler.mjs SNAPBACK2_TEMPLATES=<dist>/templates
snapback2 init <tmp> --client none --json` never returned; `sample <pid> 1` showed
`CompilerWorker::terminate → JoinHandle::join → pthread_join`; the orphaned `node … --worker`
sat idle with ppid 1.

## Resolution

The worker now starts in its own Unix process group, shutdown sends `SIGKILL` to the entire
group before reaping the direct child, and output-reader drainage has a four-second bound.
If a descendant nevertheless keeps stdout open, shutdown detaches the reader and logs the
worker pid instead of hanging. The regression worker spawns a `sleep 60` descendant with
inherited stdout; dropping the worker returns in under five seconds and verifies the
descendant is dead. The compiled-execution regression also drops the real bundled worker
after compiling tuple-cursor, capped-count, and Id-argument programs.

Verified with:
`cargo test -p snapback2 dropping_worker_kills_descendant_holding_stdout_without_hanging -- --nocapture`.
