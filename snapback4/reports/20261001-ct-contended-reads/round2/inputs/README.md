# Round-2 inputs

- `build.sh`: affected binary tests, restored production build, and the isolated
  maintenance-demotion build. The source is restored by an EXIT trap.
- `maintenance-demotion.patch`: the *only* difference between the two production
  maintenance A/B variants; apply to the round-2 tree from repository root.
- `qualify.sh`: baseline build, guide/lifecycle/KA checks, fresh prepare and
  restart/drain, corrected combined cells at every load, then exactly one suite.
- `harness-tests.mjs`: process-table overflow/failure, pending/parked maintenance,
  unexpected lease-change and missed-abandonment negative tests.
- `doctor-diagnostics.mjs`: production doctor formatting with controlled later
  maintenance/background failures and both passed/absent startup evidence.
- `darwin-check*`: standalone cross-check manifest/module includes used with
  `cargo check --tests --target aarch64-apple-darwin`; substitute `REPOSITORY_ROOT`.
  These are the unchanged round-1 wrapper inputs. The temporary directory
  disappeared after the check, so these preserved templates supply reproduction.
  Metadata only, no Mac run.
- `worker-negative.rs`: round-1 pool source with the round-2 queued-exit tests;
  `rustc --edition=2024 --test ...` then `partial_worker_exit` must fail.
- `mac-evidence.py`, `mac-maintenance-history.py`: read-only SQL extraction run
  over SSH on the operator's existing store. No auth/session tables are read.

The baseline source is an unmodified archive of 9845a1f013: `snapback4/Cargo.toml`,
`Cargo.lock`, `crates/`, `vendor/`, `packages/`, `apps/chat/`, `apps/chat-expo/`.
Unlike round 0 it needs no instrumentation patch: the mixed fixture records
client latency and read-only durable work state. All three binaries use the
production profile and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
The old `/tmp/ct-before` disappeared during this round, so no stale baseline
binary is assumed. Binary and input digests accompany the final results.

Prepared SQLite files, credentials, minted sessions and generated projects are
local measurement artifacts under `snapback4/target/ct-round2/` or ignored
project stores. They are not report artifacts and are not committed.

Per-cell raw samples and server logs, plus the fresh-restart client samples,
are losslessly stored as `.gz` with deterministic gzip headers. Expand them
with `gzip -dc`; summary JSON remains plain text. The complete-suite log is
plain text. Some raw terminal logs and the captured build diff are likewise
compressed to preserve their original blank lines and diff-context whitespace.
