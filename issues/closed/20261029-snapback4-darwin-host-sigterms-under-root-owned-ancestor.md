# snapback4 0.4.49: Darwin serve/dev SIGTERM themselves under a root-owned ancestor

Status: Resolved
Date: 2026-10-29
Scope: `crates/snapback4/src/supervisor.rs` (`adopt()`, macOS `identity()`), since `60bf7d65d1` and the SRV1 lifetime work.
Found by: the 0.4.49 publication. `publish.mjs --resume` re-runs `proveDarwin`, whose `checkVerbHelp` runs the installed
`snapback4-darwin-arm64` binary as `serve --help`.

## What happens

In 0.4.49, `supervisor::adopt()` runs for every `serve` or `dev` invocation, including `serve --help`. It walks the parent
chain up to the nearest npm. On macOS `identity()` reads each ancestor with `proc_pidinfo(PROC_PIDTBSDINFO)`. For a normal
user that call fails with EPERM on root-owned processes. Measured on the M5: `sshd-session: <user> [priv]`, `/usr/bin/login`
and launchd all return 0 bytes with errno 1, while the user's own processes read fine. `adopt()` takes that failure to mean
"an ancestor vanished while we captured launch custody" and sends itself SIGTERM.

The result: on macOS, running `snapback4 serve|dev` (or `serve --help`) directly from an SSH shell exits 143 at once with no
output. The chain there is zsh -> sshd-session -> sshd-session [priv], and the last one is root. A Terminal shell takes the
same path, because zsh's parent `login` is root. Runs under npm are not affected, since npm is found before any root
ancestor. Neither are runs reparented to launchd, because the walk stops at ppid 1. That is why the Mac publication suite
and dry run, which run detached, stayed green.

Reproduction on the M5 with the staged 0.4.49 darwin-arm64 binary:
- `./snapback4 --version` -> 0.
- `./snapback4 serve --help` inside an ssh session -> 143, no output.
- The same command from a job reparented to launchd -> 0 with the full help.

## Why it is a regression

At 0.4.43 (`6f3ef3b0d0`), `adopt()` only ran when `SNAPBACK4_SUPERVISOR_PID` was set, and it watched only the direct parent.
On Linux, `identity()` falls back to `opaque_identity()` when /proc is unavailable. That fallback treats `kill(pid, 0)` EPERM
as alive. The macOS branch has no such fallback.

## Expected

An unreadable but living ancestor is not a vanished one. On EPERM, fall back to the alive check, as Linux does, and do not
adopt custody for `--help`.

Add a Darwin witness that starts a host below a root-owned ancestor. In CI on a Mac that could be a sudo-less stand-in, for
example a test that stubs the identity read to fail with EPERM.

## Publication impact

0.4.49 was qualified (Linux receipt and Mac dry run green) and stopped before any upload pending a coordinator ruling. If it
is published as is, its finish must run detached, reparented to launchd, because the release's own Darwin consumer proof hits
this defect inside an ssh session.


## Resolution — 2026-10-29 (DARWIN1)

Implemented in `7234ee57f9` without a version bump. Native identity readers now
fall back to signal-0 liveness on unreadable metadata on every platform. Only
ESRCH establishes absence; EPERM preserves an unverified living identity.
Known zombies, verified birth changes, getppid reparenting, Linux PDEATHSIG
and private parent-pipe cleanup retain their existing death semantics. The
JavaScript parent watcher uses the same absence rule and falls back on empty
process-table output too. Discovery stops at an opaque ancestor without
inventing a parent or birth identity.

Help and version requests bypass native adoption, even with a dead supplied
launcher. Unsupported per-verb --version still returns its normal E_INPUT
rather than acquiring custody first. Regression tests inject libproc-style
EPERM and probe EPERM into ancestor capture/watching, then prove ESRCH still
reports loss; the CLI test poisons the supplied launcher for informational paths.

The actual supervisor module compile-checks for aarch64-apple-darwin against
the product's locked libc 0.2.189. A final packed Linux binary passes
help/version probes and real-launcher SIGKILL cleanup for both serve and dev
(pipe EOF in 132/126 ms, respectively). Existing packed serve/proof-kit and
production proofs pass. The affected lifetime/startup suite and final receipt
are recorded in WORKSTREAM-REPORT.md in the DARWIN1 worktree.

Two independent source reviews (Muse and fresh Codex), plus their final
informational-path delta reviews, are READY and preserved with lossless raw
transcripts under llp/reviews/3000.037.000-darwin1-*. Physical Mac runtime and
0.4.49 publication qualification remain with the publication host; this ticket
closes the implementation defect and does not claim publication qualification.
