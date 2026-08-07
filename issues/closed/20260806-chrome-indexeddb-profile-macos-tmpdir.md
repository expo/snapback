# Chrome IndexedDB can fail in the kit's default macOS temp profile

**Status:** Resolved
**Resolved:** 2026-08-06
**Severity:** P2
**Systems:** Acceptance testing, Browser kit, Chrome, IndexedDB, macOS
**Date:** 2026-08-06
**Related:** LLP 0015, `demos/_kit/chrome-process.mjs`, `demos/zerobugs/control/tests/acceptance/lane6b-live.mts`

## Problem

The Lane 6b Zerobugs supervising run launched Chrome successfully through
`launchChromeCdp`, but Chrome's IndexedDB initialization failed with:

`UnknownError: Internal error opening backing store`

The kit's default `tempRoot` is `os.tmpdir()`. On the affected macOS host that
is `/var/folders/.../T` (canonically `/private/var/folders/.../T`), not literal
`/tmp`. Supplying an otherwise equivalent short profile under `/tmp` made the
same application and Chrome process work. The current evidence establishes a
path-dependent interaction under the supervising shell, but not whether the
cause is path length, filesystem/sandbox policy, symlink spelling, or another
Chrome profile constraint.

The Zerobugs harness now passes `tempRoot: '/tmp'` while leaving profile
creation, Chrome process-tree ownership, and deletion to the shared kit. It
also retains an explicit `ZERBUGS_CHROME_PROFILE` override. This is a scoped
workaround, not a kit-wide diagnosis; other real-Chrome/IndexedDB harnesses
still use the default.

## Done when

- Reproduce or refute the failure with a small real-Chrome IndexedDB probe
  across the kit default, its realpath spelling, and literal `/tmp` under the
  same supervising shell.
- Record the exact Chrome/macOS/path identities and whether path length,
  symlink spelling, permissions, or filesystem attributes explain the result.
- If the default is broadly unsafe, update the shared kit with a portable
  short-profile policy and retain its process-tree-before-profile-deletion
  invariant; otherwise improve the startup/runtime diagnostic and document
  the required caller override.
- Run at least one existing IndexedDB acceptance harness and the Chrome
  lifecycle unit suite against the chosen resolution.

## Investigation — 2026-08-06

The focused probe is retained at
`demos/_kit/tests/chrome-indexeddb-profile-probe.mjs`. One Node process (PID
47705) launched every variant through `launchChromeCdp`, served the same
loopback origin (`http://127.0.0.1:59420`), and performed a real IndexedDB
open, schema upgrade, write, read, close, and delete for each profile.

Host identity:

- Chrome CLI and CDP: Google Chrome / Chrome `151.0.7922.76`
- macOS `26.5.2` (`25F84`)
- Node `v25.9.0`
- `os.tmpdir()`: `/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T`
- canonical `os.tmpdir()`: `/private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T`

| Variant | Exact generated profile path | Spelling / canonical length | Result |
| --- | --- | ---: | --- |
| Kit default spelling | `/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback-chrome-Tlf7PM` | 71 / 79 | PASS |
| Kit default realpath | `/private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback-chrome-Uu4s3Q` | 79 / 79 | PASS |
| Literal `/tmp` | `/tmp/snapback-chrome-61o5Zo` | 27 / 35 | PASS |
| `/tmp` realpath | `/private/tmp/snapback-chrome-IIlol7` | 35 / 35 | PASS |
| Deliberately long path under `/tmp` | `/tmp/snapback-idb-probe-roots-ufAR4L/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/snapback-chrome-7hKBJ8` | 180 / 188 | PASS |
| Short profile name under `/var/folders` | `/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/z-3lxKcA` | 57 / 65 | PASS |
| Short `/tmp` symlink spelling backed by `/var/folders` | `/tmp/sb-idb-var-47705/z-44QAPk` (canonical `/private/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/z-44QAPk`) | 30 / 65 | PASS |

### Hypothesis discrimination

- **Path length:** refuted for the current host state. The 180-character
  spelling under `/tmp` passed, as did both the 71-character default and the
  shorter 57-character profile in the per-user temp subtree.
- **Symlink spelling:** refuted. Both `/var` and `/private/var` passed, both
  `/tmp` and `/private/tmp` passed, and a short `/tmp` alias whose canonical
  target remained in `/private/var/folders/.../T` passed.
- **Permissions:** not causal in this run. Every generated profile was owned by
  uid 501 with mode `0700`. The `/var/folders` root was mode `0700`; the long
  `/tmp` control used an explicitly mode-`0700` parent and passed. `/private/tmp`
  itself was mode `1777`.
- **Filesystem and attributes:** both roots were on APFS device `16777234`.
  The per-user temp root carried the `sunlnk` flag and
  `com.apple.rootless: folders`; `/private/tmp` did not. Generated profiles in
  both subtrees had no filesystem flags and carried the same
  `com.apple.provenance` xattr. Because every `/var/folders` variant passed,
  those observed attribute differences do not explain the historical failure.

The original failure is therefore host-state-specific or transient and is not
reproducible on this host now. The evidence does not establish that
`os.tmpdir()` is broadly unsafe on macOS, and it does not support changing the
kit default. It also does not establish a more specific historical cause.

## Resolution

The default remains `os.tmpdir()`. The shared launcher now exposes
`chrome.diagnoseRuntimeError(error)` (and the independently exported
`diagnoseChromeRuntimeError`) for browser-runtime failures. It leaves unrelated
errors untouched, but recognizes `Internal error opening backing store` through
nested causes and aggregate failures and returns a typed
`SNAPBACK_BROWSER_INDEXEDDB_PROFILE_OPEN_FAILED` error containing:

- the exact Chrome profile path;
- the original failure chain;
- a machine-readable `snapback.browser-runtime-diagnostic.v1` record; and
- concrete recovery: `tempRoot: '/tmp'` for launcher-owned cleanup on macOS,
  or `userDataDir: <explicit writable profile>` for caller-retained profiles.

`demos/_kit/README.md` documents the lifecycle ownership distinction, the
diagnostic wrapper, and both caller overrides. The manual real-Chrome probe is
documented in `demos/_kit/tests/README.md`. The Lane 6b `/tmp` workaround stays
in place and may be removed separately; this resolution does not depend on
changing its known-good profile choice.

The process-tree-exit-before-profile-deletion invariant and existing cleanup
semantics are unchanged. Unit coverage proves the diagnostic is idempotent,
preserves unrelated error identity, carries both overrides, and coexists with
all existing process-tree, cleanup-order, caller-owned-profile, startup-failure,
and Windows-shaped lifecycle checks.

## Verification

- `node demos/_kit/tests/chrome-indexeddb-profile-probe.mjs` — PASS, 7/7
  variants, exact evidence above.
- `node demos/_kit/tests/chrome-process-lifecycle.mjs` — PASS (run twice after
  the code change).
- `SNAPBACK_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node stage0/browser/run.mjs`
  from `demos/zero-bakeoff` — PASS, 9/9. It proved standards-real IndexedDB +
  Web Locks, an IndexedDB commit before full Chrome `SIGKILL`, exact-profile
  relaunch with the persisted row, two-tab writer contention and takeover, and
  final profile deletion after both process groups were attested gone. The
  retained local receipt is
  `demos/zero-bakeoff/.runtime/stage0-browser/browser-harness.latest.json`.
- Lane 6b with
  `SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback`
  reported the expected configured-binary stamp mismatch (binary commit
  `5d6e2eff5c95cb5e747c59a74cc110b7b9ee68b5`, worktree commit
  `27c085769f0f5860b3f9ced2e1cd7ff17ebd74ca`) and later failed before its
  IndexedDB/reload assertion on an unrelated current React-binding exception.
  It is not counted as the acceptance witness; the isolated Stage 0 harness is.
- `./ref-check --verbose` — PASS: 189 LLP documents, 3,593 refs, 0 errors.
- `node scripts/check-inventories.mjs` — attempted, but the repository's
  concurrent working state is missing unrelated generated sources for
  `competitive-checkpoint` and `todo-v2`; the guide-manifest stage fails before
  inventory registration. No missing path names this ticket's files.
