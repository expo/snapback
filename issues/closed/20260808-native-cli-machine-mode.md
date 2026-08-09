# Native CLI machine-mode gaps: prose failures, ignored --json, no --version, opaque help

**Status:** Resolved
**Opened:** 2026-08-08 · **Severity:** P1 batch · **Area:** src/cli.rs / src/main.rs / snapback-app-cli

From the 2026-08-08 agentic surface audit (LLP 0202 theme 7). The packaged
CLI's data-driven help registry and the app CLI's frozen exit taxonomy are
the models; the native binary lags both:

1. **Failures are prose with exit 1; `--json` is not failure-safe.**
   `src/main.rs:3-19` prints `Error: {error:#}` for everything except
   `SNAPBACK_READY_DESCRIPTOR_REQUIRED`; every explicit exit in `src/cli.rs`
   is `exit(1)` (clap usage errors are 2). A failing
   `snapback fork create --format json` emits nothing parseable. Adopt the
   frozen 11-value taxonomy from
   `packages/snapback-app-cli/result-core.mjs:16-28` and emit a
   `hostOpsResult` envelope on failure whenever a JSON mode was requested.
2. **`snapback guide --json` is silently ignored** on the fuzzy-search and
   channel-listing branches (`src/cli.rs:2117-2167`; only the exact-symbol
   branch honors it, `:2143-2151`). The Node wrapper explicitly forwards the
   flag (`packages/snapback-cli/index.mjs:4413-4415`). Emit a
   `snapback.guide-search.v1` envelope (matches + zero-match) on every
   branch.
3. **`snapback --help --json` returns native verbs as a text blob.**
   `packages/snapback-cli/index.mjs:3178-3186` emits structured
   `packagedCommands` beside `nativeHelp.text` = raw `--help` stdout — ~33
   native verbs are not machine-enumerable. Add a native structured command
   inventory and splice it in.
4. **No `--version` on any of the three CLIs.** `src/cli.rs:730-735` sets no
   clap `version` (so `--version` exits 2 as unknown arg); no branch in
   `packages/snapback-cli/index.mjs` or `snapback-app-cli/cli.mjs` or
   `create-snapback-app/cli.mjs`. `snapback build-identity` already has the
   facts (`src/cli.rs:2510-2519`).
5. **Bare `snapback` starts a foreground dev server** instead of printing
   help (`src/cli.rs:727-741`, `:2200`; wrapper reproduces it,
   `index.mjs:4410-4421`). The detached refusal only fires when `/dev/tty`
   is absent, so a pty-attached agent hangs. Make bare invocation print root
   help (or require `--ready-file` regardless of tty).
6. **`snapback admin` browser default.** Without `--no-open` it spawns
   `open`/`xdg-open`, prints only `admin console opened`, and discards the
   fragment URL (`src/cli.rs:6494-6500`, `:6699-6711`) — headless boxes get
   exit 0, no URL, no browser. `admin link` is long-running with no `--json`
   and no ready-file (`:6025,:6056`). Print the URL always; add `--json`;
   default `--no-open` when `/dev/tty` is unavailable (check exists,
   `:4596-4606`).
7. **`snapback-app` help is 5 lines** (`packages/snapback-app-cli/cli.mjs:259-267`)
   with no per-command help; `subscribe`'s `--watch/--first-change/
   --timeout-ms/--args-json` and all seven `pair` flags are undocumented
   (`:352-373`, `:487-510`). Mirror the `PACKAGED_CLI_COMMANDS` registry
   pattern.
8. **Smaller:** CLI-only families (`store describe/export`, `auth
   backup/restore`, `binary-identity`, `runtime-qualify`) emit ad-hoc JSON
   with no `schemaVersion` and no committed schema (`src/cli.rs:2513-2919`)
   — route through `hostOpsResult` or commit schemas per LLP 0037; six
   `SNAPBACK_*` env knobs read by the server appear in no help (clap built
   without the `env` feature, `Cargo.toml:32`); `controls describe
   <unknown>` bails with no code and no pointer to `controls list --intent`
   (`src/cli.rs:5430-5432`); `SNAPBACK_CLI_ARGUMENT_INVALID` covers 46
   distinct usage failures with no `details.command` discriminator.

## Resolution (2026-08-08)

The native binary now shares the app CLI's frozen 11-value exit taxonomy and
projects JSON-requested failures through `hostOpsResult`, including a
`details.command` discriminator. Native guide search is total under the
`snapback.guide-search.v1` envelope, the packaged root-help document includes
a structured native inventory, and all three CLI entry points expose versions
derived from their build/package identity.

Bare invocation is help-only; explicit `start` was carried through the guide
and the shared demo server launcher. Admin console and link commands now have
headless-safe opening defaults, always expose the fragment-bearing URL, and
offer JSON plus an owner-lifecycle link ready file. The app CLI has
registry-backed root and per-command help covering subscribe and pair flags.
The remaining native JSON families now declare schema versions, the six
runtime environment knobs are documented in native help, and unknown controls
produce a stable code with the intent-list repair command. Governing behavior
is recorded in LLP 0024, with affected guide, generated reference, and test
projections updated alongside the implementation.
