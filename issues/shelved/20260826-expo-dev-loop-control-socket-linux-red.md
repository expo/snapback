# `expo-dev-loop.test.mjs` control-socket suite is red on Linux (two distinct modes)

- Status: Open — one cause found and fixed, at least one more outstanding
- Date: 2026-08-26
- Systems: `packages/snapback-cli` (`expo-dev-loop.test.mjs`
  `runControlSocketSuite`), LLP 0310.000 Track E
- Governing: LLP 0189 (verification cadence), LLP 0232 (inherited reds are not a
  landing veto)
- Related: `issues/shelved/20260826-expo-dev-loop-carrier-startup-timeout-load-sensitive.md`

## How this was found

Local macOS runs of this file could not complete under fleet load, so the suite
was run on the `expo-build-1000` Hetzner host (96 logical CPUs, load < 1). It
completes there in ~80 s instead of hours — and fails, in ways macOS does not.

**Both failures reproduce at `a55e95b92` (before the LLP 0310.000 wave) and at
`16f4fb1ee` (after it), with the same runtime binary.** They are inherited, not
introduced.

## Cause 1 — umask-dependent fixture mode (FIXED)

```
AssertionError: an Expo owner publishing the control socket must tighten its
ready-file directory
493 !== 448          # 0o755 !== 0o700
```

**The product is correct here; the test was not portable.** `fixture()` created
the project root with no explicit mode, so it inherited the ambient umask. On the
common Linux default of `002` that yields a group-writable `0775` project root.
`inspectSecureDirectoryChain` then refuses with `writable-component`, `runDev`
correctly declines to treat the tree as secure custody and skips the
`chmodSync(controlStateRoot, 0o700)`, and the assertion fails for a reason
unrelated to the behaviour under test. Verified by probe on the host:
`reason: 'writable-component'`, `observedMode: 509` (`0o775`), `umask: 002`.

Fixed by creating the fixture project root at an explicit `0o755`. On macOS
(umask `022`) that is bit-identical to the previous behaviour — verified
directly, both spellings produce `0755` — so it cannot regress the platform the
suite already passed on.

## Cause 2 — dispatcher-serialization HTTP failure (OPEN)

With cause 1 fixed, the suite advances and then fails differently:

```
TypeError: fetch failed
  [cause]: SocketError: other side closed (UND_ERR_SOCKET)
  at runControlSocketSuite (expo-dev-loop.test.mjs:2075)
```

in the "control dispatcher: HTTP dev-fresh serializes both ways" case, where an
HTTP `dev-fresh` races a socket reload. At `16f4fb1ee` the suite instead reaches
line 2203 (`ignoredStdinFixture`, `stubbornMetroDuringReload`) and fails an
`assert.equal(reload[1].ok, true)`. Both are downstream of cause 1 and neither
was reachable before it was fixed, so which of them is the *next* real blocker is
not yet established — they may be one problem or two.

Not diagnosed here. This is Track E's surface and the investigation that found it
was scoped to unblocking something else.

## Why it matters beyond the suite

1. Snapback ships a Linux runtime and the Clique lanes run on Linux. A control
   plane whose test suite has never been green on Linux is a coverage claim that
   does not hold where the product actually runs.
2. LLP 0310.000's A1/A3 live-arm coverage sits after this suite in the file, so
   it is blocked behind these failures on Linux exactly as it is blocked behind
   the load-sensitive carrier row on macOS. It has still never executed on any
   platform.

## Reproduction

```
ssh ccheever@100.65.137.99            # expo-build-1000
cd ~/lanes/sb0310-a1                  # worktree at 16f4fb1ee, already installed
export PATH=$HOME/.local/bin:$PATH
env -u NODE_PATH -u NODE_OPTIONS \
  SNAPBACK_RUNTIME_BINARY=$HOME/projects/snapback/target/debug/snapback \
  node packages/snapback-cli/expo-dev-loop.test.mjs --control-socket-only
```

`~/lanes/sb0310-base` is the same worktree at `a55e95b92` for the inherited-vs-
introduced comparison. Both are retained for whoever picks this up; delete them
when done.
