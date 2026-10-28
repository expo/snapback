# Test runs leak /tmp/snapback4-fresh-<pid>-<ulid> store directories

Status: Open
Date: 2026-10-28
Scope: `crates/snapback4/src/serve_readers.rs` (`FreshDirectory`) and the test harnesses that stop `snapback4 dev --fresh`.

On 2026-10-28 the coordinator removed 2,589 `/tmp/snapback4-fresh-<pid>-<ulid>`
directories from the shared Linux host. Every one belonged to a dead process,
some held about 1 GB, and together they covered roughly the last day of
qualification and lane runs. 156 more had accumulated by 18:40Z the same day.

`dev --fresh` (and `serve --fresh`) creates the directory in `FreshDirectory::new`
and removes it only in `impl Drop for FreshDirectory`. SIGTERM and SIGINT unwind
through that Drop, and the directory is removed: checked with `dev --port 0
--fresh --no-watch`, where `kill -TERM` and `kill -INT` leave nothing. SIGKILL
cannot unwind, so the directory stays.

The Rust integration tests stop their dev hosts with `std::process::Child::kill()`,
which is SIGKILL on Unix, in `impl Drop for Host` (`dev_reset.rs`, `latency.rs`,
`replay.rs`, `clock.rs`, `overload.rs`, `dev_refusals.rs` and others; 22
`"--fresh"` starts under `crates/snapback4/tests`). One run of the `dev_reset`
test binary (4 tests, 0.38 s) left 3 new directories, from pids that were
already dead. Every Rust suite, affected run and publication qualification adds
dozens more. Test-file timeouts that kill process groups with SIGKILL leak the
same way from the JS side.

Fixes, either or both:
- Test hosts send SIGTERM, wait with a short bound, and only then SIGKILL (a
  shared helper in `tests/support`).
- Product: put `--fresh` stores under a per-user runtime directory and sweep
  `snapback4-fresh-<pid>-*` entries whose pid is gone at startup. Alternatively,
  register the directory for removal from the signal and exit paths that do not
  unwind.
