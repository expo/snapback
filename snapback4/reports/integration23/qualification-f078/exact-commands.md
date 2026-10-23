# Exact 0.4.39 qualification commands

Clean Exact2 origin/main at clone: `14c091f205f62c32ed9d585ae75148cffc12dfa2` (EX10 contract migrate present).
Merged Snapback source: `02cb35b7a8cbd44a8795401fcf513166287a634a`.
Native SHA-256: `94d3bec462d9d97d2a067c3e7d6165553f81b17a7337a978fdb257c341c7c6b4`.
Client tar SHA-256: `0db7dfee7482d0d62be8ed1f6f84af3b8126c3304411b10eb65c9034c0fda96f`.

Environment: Bun 1.4.2 on PATH, `SNAPBACK4_BIN=/tmp/integ23/frozen-production39-r12/snapback4-bin`, the retained Chromium binary, and same-command `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=8`.

Private clone setup changed only the SDK tar dependency, three local Snapback crate paths, and their lockfiles. The checked-in Exact product implementation was unchanged. Source/setup diff is retained separately.

The web device was prepared with:

```sh
timeout 600s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=8 cargo update --manifest-path snapback4/Cargo.toml --workspace
timeout 2400s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=8 bun snapback4/web/build.mjs
```

## synced

Result: 2 passed, 0 failed.

Working directory: `/home/ccheever/sb4-loop/prewave23/synced-r6`.

```sh
timeout 600s bun install
```

Working directory: `/home/ccheever/sb4-loop/prewave23/synced-r6`.

```sh
timeout 1800s bun /home/ccheever/sb4-loop/prewave23/exact2-postfix/scripts/exact.mjs new app --snapback --port 27406
```

Working directory: `/home/ccheever/sb4-loop/prewave23/synced-r6/app`.

```sh
timeout 1800s bun exact.mjs snapback
```

Working directory: `/home/ccheever/sb4-loop/prewave23/synced-r6/app`.

```sh
timeout 2400s bun exact.mjs test web
```

Backend: `timeout 7200s /tmp/integ23/frozen-production39-r12/snapback4-bin dev --port 27406 --no-watch` from the app parent; owned servers were stopped and reaped.

## online

Result: 1 passed, 0 failed.

Working directory: `/home/ccheever/sb4-loop/prewave23/online-r6`.

```sh
timeout 600s bun install
```

Working directory: `/home/ccheever/sb4-loop/prewave23/online-r6`.

```sh
timeout 1800s bun /home/ccheever/sb4-loop/prewave23/exact2-postfix/scripts/exact.mjs new app --snapback --port 27407 --online
```

Working directory: `/home/ccheever/sb4-loop/prewave23/online-r6/app`.

```sh
timeout 1800s bun exact.mjs snapback
```

Working directory: `/home/ccheever/sb4-loop/prewave23/online-r6/app`.

```sh
timeout 2400s bun exact.mjs test web
```

Backend: `timeout 7200s /tmp/integ23/frozen-production39-r12/snapback4-bin dev --port 27407 --no-watch` from the app parent; owned servers were stopped and reaped.

The online app keeps the fresh backend on `online only` and uses its authored small contract/app binding; the synced app is freshly scaffolded. The harness asserts the actual `/online` versus `/ts` device mounts and real backend write/read results. No claim of an untouched online frontend is made.
