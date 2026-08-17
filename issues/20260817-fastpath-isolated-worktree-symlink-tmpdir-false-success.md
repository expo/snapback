# Fastpath isolated-worktree ceremony silently no-ops (ok:true) under a symlinked TMPDIR

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Publication, Fastpath release
**Date:** 2026-08-17
**Governing:** LLP 0041 §fast-path; scripts/snapback-fastpath-release.mjs

## Problem

`scripts/snapback-fastpath-release.mjs` guards its CLI entry with

```js
const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
```

`runCeremony`'s isolate mode provisions the worktree under `tmpdir()` and
spawns the child as `node <worktree>/scripts/snapback-fastpath-release.mjs …`.
On macOS `tmpdir()` returns `/var/folders/…`, a symlink into
`/private/var/folders/…`. Node's ESM loader realpaths the module URL, so
`fileURLToPath(import.meta.url)` is the `/private/var/…` path while
`resolve(process.argv[1])` keeps the `/var/…` spelling. The comparison fails,
`invoked` is false, the child loads as a module, performs **no ceremony work**,
and exits 0 with empty stdout. `defaultContinueInWorktree` then parses no
trailing JSON, substitutes `{ok: status === 0}`, and the wrapper reports
`{"ok":true}` — a false success on the release path.

Observed 2026-08-17 during the 0.1.24 ceremony: `stage --version 0.1.24`
"succeeded" in seconds with no pass-1 artifacts. Workaround used for the
ceremony: run with `TMPDIR` pointing at a real (non-symlinked) directory.

Prior ceremonies (0.1.22/0.1.23) predate whichever environment change exposed
this here; the defect is latent for any macOS default TMPDIR.

## Desired outcome

- Compare realpaths (e.g. `realpathSync` both sides) or drop the argv check in
  favor of an explicit `--entry` guard.
- `defaultContinueInWorktree` must treat an exit-0 child with no parseable
  trailing JSON as a failure, never as `ok:true` — the stage/release passes
  always emit a JSON result line on success.
- Regression test covering a symlinked tmpdir.
