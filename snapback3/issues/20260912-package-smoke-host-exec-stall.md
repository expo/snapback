# Host process startup stalls package smoke before application code

Status: Open
Date: 2026-09-12
Scope: Current development host; local tarball requalification
Author: Codex

The local package smoke currently times out while starting executables. The
failure is also reproducible with the repository's native worker. Samples of
both the npm-launched `/usr/bin/env` and the repository worker show their main
thread at `_dyld_start + 0`, with 96 KB process footprints and no application
frames. The underlying host cause remains unidentified.

This prevents a new package qualification result. The previous successful
archive and report remain intact; the pack script qualifies a scratch candidate
before replacing them.

## Environment and identities

- macOS 26.6.2 (25G83), darwin-arm64.
- Node v25.9.0, executable `/opt/homebrew/Cellar/node/25.9.0_3/bin/node`.
- npm 11.12.1; npm `script-shell` is unset (`null`).
- Repository and installed worker SHA-256 are identical:
  `f511ed8e4265b26b07bc578cf9018da12d680aa933a30f7dbf1979505b89484e`.
- Previous qualified archive SHA-256:
  `5ef9dcc357299f50c42d56cfab97241ba717208431db56c7a52873970cf0fdf8`.
- Archive: `.snapback3/packages/snapback3-0.0.1-experimental.0-darwin-arm64.tgz`;
  adjacent `.tgz.json` contains its earlier qualification result.

## Observations

The full pack/smoke passed at approximately 04:14 PDT. That invocation already
included the installed `npm exec --offline -- snapback3 check . --json`
witness, strict inferred TypeScript imports, server health, a seeded SDK query,
and a settled mutation. The current failure was reproduced at 04:31–04:38 PDT.

1. Fresh npm installation succeeds. The installed bin symlink points to
   `../snapback3/dist/cli.mjs`; the file has the expected executable mode and
   `#!/usr/bin/env node` header.
2. `npm exec --offline -- snapback3 check . --json` resolves that installed
   path. Its child remains `/usr/bin/env`, without starting Node. The existing
   30-second witness timeout returns empty stdout and stderr.
3. The retained npm environment resolves `node` to `/opt/homebrew/bin/node`.
   Independent `/usr/bin/env node --version`, direct Node `--version`, and
   `/bin/echo` probes succeed in approximately 20, 19, and 5 milliseconds.
4. Directly invoking the installed CLI with the known Node executable reaches
   native certification. Its native child then hits the existing 10-second
   `S3_CHECK` timeout, also without output.
5. The installed compiler API independently compiles the same two-operation
   notes fixture and writes a reusable `repro.json` artifact.
6. Both the repository release worker and the installed copy, invoked with
   that artifact and `--check`, hit controlled 5-second timeouts without output.
   A direct repository worker launch also remains stalled before entry.
7. `codesign --verify --verbose=2` accepts the installed worker. No signature
   or package-content difference was found between the compared workers.

The `/usr/bin/env` sample has 886 of 886 samples at `_dyld_start + 0`; the
repository worker sample has 809 of 809 there. These observations locate the
failure before application execution, independently of npm package resolution.
They do not identify the service or kernel condition holding startup.

## Retained evidence

The failed synthetic app remains at:

`/var/folders/ld/7bxg3rcx2l3_l0fpvn_b3_8w0000gn/T/snapback3-installed-D51iiy`

Its installed package, authored notes fixture, and
`.snapback3/build/repro.json` permit comparison without another installation.
Raw samples are `/tmp/snapback3-env-sample.txt` and
`/tmp/snapback3-worker-launch-sample.txt`. The bounded diagnostic processes have
been terminated; the development preview and unrelated processes were left
running.

The smoke script now identifies its failed phase and retains failed temporary
apps. Successful runs still remove their temporary app. Certification and
timeouts are unchanged.

## Requalification

From `snapback3/`, once host process startup is functioning:

```sh
node scripts/smoke-package.mjs .snapback3/packages/snapback3-0.0.1-experimental.0-darwin-arm64.tgz
node scripts/pack.mjs
```

A fresh successful result is required before describing this rerun as qualified.
No system-service changes are part of this ticket's investigation.
