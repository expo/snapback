# `snapback-package-cold-install.mjs` lost `--help` and now runs the full proof instead

**Status:** Open
**Severity:** P3
**Systems:** Release, CI, Developer experience
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0041; PR #4 (`984b6a06`);
`scripts/snapback-package-cold-install.mjs`
**Marker:** release, cli-ux, papercut

The staged-registry rewrite removed the `usage` constant and the

    if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }

block along with the `--install-source` flag it documented. The script now
contains no occurrence of the string `help` at all. `--help` is not an error
either: unknown flags are ignored by `valueAfter`, so
`node scripts/snapback-package-cold-install.mjs --help` executes the entire
cold-install proof — spawning a staged registry, installing tarballs into a
temp scaffold, and driving a managed dev server — instead of printing usage.

The surviving flags are `--ledger`, `--receipt`, and `--keep`; `--install-source`
is gone. There is no self-describing record of that.

## Proposed fix

Restore a `usage` string covering the current flag set and the `--help`/`-h`
early exit. Consider rejecting unrecognized `--` flags rather than silently
ignoring them, so a stale `--install-source tarball` in someone's shell history
fails loudly instead of running a different proof than intended.

## Related robustness note in the same file

`runAsync` registers no `error` handler on the spawned child. A spawn failure
(`ENOENT`) emits `'error'` with no listener, which throws, and the returned
promise never settles. The synchronous `run` helper checks `result.error`;
`runAsync` should reject symmetrically.
