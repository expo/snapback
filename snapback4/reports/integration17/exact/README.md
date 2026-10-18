# Integration 17 Exact witness

PASS: fresh synced and online apps from a clean clone of Exact2 `origin/main`, commit `b28c0c1a64226420e43f0786f072e1a852287a3b`, including EX10 `contract migrate`. Scratch root: `/home/ccheever/sb4-loop/prewave17/`.

The clone began clean. The only tracked scratch edits replace Exact's pinned0.4.29 core/device/lang Cargo dependencies with local merged0.4.33 paths and refresh its private Cargo lock. This strengthens the witness: the synced client device is built from the merged engine. The exact patch is `local-dependencies.diff`. No Snapback product source was edited by this lane.

Both parent projects install the provisional merged npm pack, assert `snapback4`0.4.33, and use `SNAPBACK4_BIN` pointing to merged `target/debug/snapback4`. Binary version0.4.33, source commit and SHA256 of binary/client are asserted and recorded in `source-binding.json`. The synced device's embedded stamp is0.4.33 (`synced-device-stamp.json`). Exact's saved npm pin still says0.4.29 in its printed installation advice; it does not choose the explicit binary or scratch engine paths used here.

The apps use the complete synced/online examples from the fresh clone's `snapback4/README.md`, including their literal schemas, Contract, TypeScript and tests. New app scaffolds are generated before replacing the greeting sources with these documented examples.

| App | `snapback --rebuild` | `contract migrate` | `test web` |
|---|---|---|---|
| synced | PASS | PASS, no retired spellings | 2 passed,0 failed: another persona reads a post; offline note survives and reconnects |
| online | PASS | PASS, no retired spellings | 2 passed,0 failed: another viewer reads a write; expected domain refusal exposed |

The synced example emits one existing Exact accessibility warning about its absolute maximum width. The online example emits no warning. Neither is a test failure.

The overall command was:

```sh
timeout 3600s env INTEG17_CLIENT=/tmp/integ17/client-dev/snapback4-0.4.33.tgz CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=4 PATH=/home/ccheever/.bun-1.4.2/bin:/home/ccheever/.cargo/bin:/home/ccheever/.local/bin:/usr/local/bin:/usr/bin:/bin node /home/ccheever/sb4-loop/prewave17/integ17-exact.mjs
```

The app commands, with all shared environment above, were:

```sh
# cwd /home/ccheever/sb4-loop/prewave17/synced/app
timeout 1800s bun exact.mjs snapback --rebuild --port 43225
timeout 1800s bun exact.mjs contract migrate app.contract
timeout 1800s bun exact.mjs contract types app.contract -o app.contract.d.ts
timeout 1800s bun exact.mjs test web --backend http://127.0.0.1:43225
# cwd /home/ccheever/sb4-loop/prewave17/online/app
timeout 1800s bun exact.mjs snapback --rebuild --port 37917
timeout 1800s bun exact.mjs contract migrate app.contract
timeout 1800s bun exact.mjs contract types app.contract -o app.contract.d.ts
timeout 1800s bun exact.mjs test web --backend http://127.0.0.1:37917
```

Each backend runs with `timeout 1800s <merged-binary> dev --port <port> --no-watch` from its parent project and is stopped after the browser tests. Every command succeeds. `commands-final.json` records all exact arguments and working directories, including install and scaffold. Setup commands/results are in `setup.json`; gzip logs retain stdout/stderr verbatim. `integ17-exact.mjs` is the reproducer intended to reside at the scratch root beside `exact2/`.

This is an integration witness using the provisional merged client pack, not a publication qualification receipt. The integration's final prepared client qualification is recorded separately.
