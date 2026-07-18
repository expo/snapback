# Capture All Aboard browser startup failures

**Status:** Closed
**Severity:** P1
**Systems:** All Aboard demo, Acceptance testing, CI, Local server lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-17
**Related:** LLP 0010; LLP 0027; ENG-22480; ENG-22753; ENG-24378
**Marker:** acceptance, cold-clone, diagnostics, process-lifecycle

The All Aboard Contract and React browser suites launched the Snapback API with
an ad hoc `cargo run` child whose stderr was piped but never consumed. When the
cold-clone workflow's API child exited, the only retained evidence was the
string `API server exited`: the exit code or signal, startup diagnostics, and
runtime-loader failure were all discarded. The unread pipe could also apply
backpressure to a sufficiently verbose child.

The same suites duplicated listener reuse, port selection, startup polling,
and single-process termination even though the shared server lifecycle helper
already provides verified provenance, an OS-assigned spawn port, a unique
ready-file handshake, bounded stdout/stderr capture, spawn/exit diagnostics,
and process-tree teardown.

The migration also made an existing credential assumption explicit: bundle
provenance can identify a reused process, but cannot prove that process accepts
a token freshly minted by the test. Reusing such a process and then issuing
admin cron writes with the new token deterministically fails authorization.
The old launch path also wrote its predictable test token into `process.env`,
which then flowed into the Vite and Chrome child environments even though
neither process needs admin authority. The cold-clone wrapper likewise allowed
an ambient caller token to reach registry install and production-build code
before clearing it for browser acceptance.

While verifying that repair, the cold-clone wrapper exposed a second diagnostic
failure: it streamed the harness's potentially large single-line JSON report
straight through `tee`. A nonblocking PTY could reject that write with EAGAIN
after the suite had already reported 34/34, and the wrapper collapsed the
pipeline status into a misleading `browser acceptance exited 1`.

**Done when:**

- Both All Aboard browser arms launch or reuse the API through the shared
  server lifecycle helper.
- A child that fails before readiness reports its exit code or signal and a
  bounded output tail.
- API reuse requires both the committed All Aboard bundle identity and a
  caller-supplied token for that existing process; default runs stay isolated.
- Fresh runs consume the shared lifecycle's random server token, and neither
  Vite nor Chrome inherits `SNAPBACK_ADMIN_TOKEN`.
- The isolated cold-clone lane drops any ambient admin token before install,
  build, browser, or server subprocesses begin.
- The returned isolated API origin is passed to Vite and every direct client.
- Teardown awaits the shared process-tree cleanup rather than signaling only
  the leader process.
- The cold-clone wrapper retains the complete report without making terminal
  streaming part of the acceptance result, and emits bounded human-readable
  diagnostics on CI failure.
- Focused browser and cold-clone proofs pass, and the remote cold-clone lane
  provides actionable output if a separate Linux startup defect remains.

## Resolution

Both browser arms now delegate API reuse, launch, readiness, bounded output
capture, and teardown to `demos/_kit/server-process.mjs`. The suites retain the
same requested-port reuse candidate only when the caller supplied the existing
server's admin token, and still require committed-bundle provenance. Default
runs force a fresh child and consume the shared lifecycle's random returned
token. Both paths use the helper's returned origin when an isolated child binds
an OS-assigned port. Vite and Chrome receive an explicitly unprivileged copy of
the parent environment with `SNAPBACK_ADMIN_TOKEN` removed. The cold-clone
wrapper removes that variable at lane entry, before invoking registry packages
or production-build plugins.

The cleanup stack returns the helper's asynchronous process-tree stop promise,
so the acceptance harness observes complete teardown. The cold-clone wrapper
now writes the complete output directly to its temporary artifact, reports the
acceptance process's own status, and applies independent summary/count gates.
On CI failure it prints a bounded tail before naming the full artifact path;
terminal transport is no longer part of the suite's pass/fail result.

Verified with:

- `node --check` for both browser suites
- Contract/Exact browser acceptance: 34/34
- React control-arm browser acceptance: 18/18
- `scripts/cold-clone-check.sh`: registry install, production build, and 34/34
  browser checks (`COLD-CLONE CHECK PASS`)
- `SNAPBACK_ADMIN_TOKEN=sbat_sentinel_must_not_escape scripts/cold-clone-check.sh`:
  the same full pass with an ambient-token containment sentinel
- `bash -n scripts/cold-clone-check.sh`
- `git diff --check`
- `./ref-check --verbose`
