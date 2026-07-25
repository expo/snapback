# demos/_kit

Shared machinery every demo uses: the framework-neutral client
(`client.mjs`), safe server lifecycle (`server-process.mjs`), the acceptance
harness (`harness.mjs`), and shims re-exporting the codegen authoring
surface (`define.mjs`, `codegen.mjs` — kept because definition markers are
Symbols and one module instance must be shared).

**If you landed here to learn how to build on Snapback, start with the
guide instead:** [`guide/index.md`](../../guide/index.md) teaches the
authoring surface intent-first with verified snippets — many of them
transcluded from this kit and the suites that use it. The kit files are the
implementation; the guide is the map.

## Server launch: the LLP 0030 command-resolver ladder

`startServer` (`server-process.mjs`) resolves the server command by the
LLP 0030 §Server process ownership ladder instead of always compiling the
checkout:

1. **Caller-configured binary** — the `serverBinary` option (or the
   `SNAPBACK_SERVER_BINARY` environment variable) names an existing `snapback`
   binary; a missing path is a hard error. The booted binary's `/health` build
   stamp is still compared against the checkout, but a mismatch **reports**
   loudly (`handle.identity.verdict === 'stamp-mismatch'`) and boots anyway —
   the paved escape for a broken or drifted checkout HEAD: a known-good binary
   still boots and the drift is named, never hidden.
2. **Verified prebuilt binary** — with no configuration, an existing
   `<cwd>/target/debug/snapback` is booted *only* when the checkout is pinned
   (known commit, clean tree) **and** the spawned binary's stamp fully
   verifies against it (`verdict === 'verified'`). Any weaker outcome tears
   the child down and falls through with a diagnostic. This skips the cargo
   compile wait exactly when the built binary provably is this checkout's
   build.
3. **`cargo run`** — the source-tree fallback, and the default whenever no
   binary qualifies (including every dirty-checkout launch: only a rebuild can
   contain local edits).

Every spawned child is bound to its unique ready-file nonce via `/health`; the
returned handle reports `launch: { rung, command }` and `identity: { verdict,
mismatches, binary, expected }`. Verdicts: `verified` (same clean commit on
both sides), `unpinned` (commits agree but a dirty side means the bytes are
not pinned), `env-stamped` (an explicit `SNAPBACK_BUILD_GIT_COMMIT` /
`SNAPBACK_BUILD_GIT_DIRTY` in the launch environment — the deterministic CI
seam, attested rather than verified), `unverifiable`, and `stamp-mismatch`.

The kit **never injects** checkout-derived stamp values into children:
`build.rs` runs its own git probe over the binary's real inputs
(ENG-23365/ENG-23419), so the stamp stays independent of the expectation it is
compared against and the comparison carries information
(`issues/closed/20260724-kit-identity-stamp-env-injection-tautology.md`).

`deps.launchSpec` (via `__startServerForTests`) remains a **test-only** seam
that substitutes the cargo rung's command for lifecycle fixtures; production
callers wanting a specific binary should pass `serverBinary`.
