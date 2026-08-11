# demos/_kit

Shared machinery used across demos: the framework-neutral client
(`client.mjs`), sessions-mode acceptance personas (`as-user.mjs`), safe server
lifecycle (`server-process.mjs`), the acceptance harness (`harness.mjs`), and
shims re-exporting the codegen authoring surface (`define.mjs`, `codegen.mjs`
— kept because definition markers are Symbols and one module instance must be
shared).

**If you landed here to learn how to build on Snapback, start with the
guide instead:** [`guide/index.md`](../../guide/index.md) teaches the
authoring surface intent-first with verified snippets — many of them
transcluded from this kit and the suites that use it. The kit files are the
implementation; the guide is the map.

## `startServer` port semantics

The `port` option is **not** a bind guarantee. By default it is a
verified-reuse probe:

- If the requested port answers `/health` **and** the caller-declared
  identity matches (`provenance: { appId, artifactsPath }` for bundle
  provenance, or `binaryProvenance: true` for the server-binary identity),
  the running server is reused (`handle.reused === true`) and nothing is
  spawned. Reuse is verified, never assumed (ENG-22757).
- In every other case — port free, occupant unverifiable, occupant not
  Snapback — the kit spawns a fresh isolated child with `--port 0` and the
  OS assigns the port (ENG-24378: cargo is never launched into an occupied
  address). The handle's `baseUrl` then differs from the requested port,
  and the kit prints a loud `PORT REASSIGNED:` line naming both ports.

**Always read the effective origin from the returned handle** — never
reconstruct it from the port you asked for:

```js
const server = await startServer({ port: 4399, db: ':memory:', cwd: repoRoot,
  provenance: { appId: 'todo', artifactsPath } });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
```

This probe/reuse default is deliberate (audited 2026-07-24, see
`issues/closed/20260724-kit-bind-port-exactly-default-and-docs.md`): the
fixed-port acceptance suites depend on verified reuse for fast iteration,
and parallel suites depend on OS-assigned isolation. The lifecycle suite
pins both the default and its loudness.

### `bindPortExactly`: bind-or-fail

When the caller needs the requested port *exactly* — restart seams that
must reclaim a released origin, wrappers that advertise a fixed URL — pass
`bindPortExactly: true` with an explicit port (1–65535):

- no preflight probe and no reuse: the child is asked to bind that exact
  port atomically;
- if anything else holds the port, startup **fails** (the child's bind
  error surfaces as "exited before verified readiness"); it never falls
  back to another port;
- the ready-file port is verified against the request, so a child that
  silently lands elsewhere is rejected.

## Child death watchdog

After readiness verifies, the kit watches the spawned child so a dead
backend can never masquerade as a live one:

- `handle.exit` — `null` while alive; `{ code, signal, expected }` once
  the child closes (`expected` is `true` only when an owned teardown began
  before the exit). Always `null` for a reused server: there is no owned
  child to watch.
- `startServer({ onUnexpectedExit })` and `handle.onUnexpectedExit(fn)` —
  notified once if the child dies before `stop()` is requested (late
  subscribers fire immediately). Restart-on-death is caller policy; the
  kit only detects and reports.
- `handle.assertAlive()` — throws a typed error
  (`error.code === 'SNAPBACK_SERVER_CHILD_DIED'`) once the child has
  exited, so wrappers fail fast instead of surfacing raw connection
  errors.
- `handle.stop()` after an unexpected death still tears down and cleans
  up, but **rejects** with `SNAPBACK_SERVER_CHILD_DIED` rather than
  attesting a clean shutdown.

## Chrome profiles and IndexedDB diagnostics

`launchChromeCdp` creates an isolated profile below `os.tmpdir()` unless the
caller supplies `tempRoot` or `userDataDir`. A `tempRoot` override keeps the
profile launcher-owned: the whole Chrome process tree is stopped and its exit
is attested before the profile is deleted. A `userDataDir` override makes the
profile caller-owned so restart tests can retain the exact profile; the launcher
still owns and attests every Chrome process tree.

Chrome can report the opaque runtime exception `UnknownError: Internal error
opening backing store` when `indexedDB.open()` cannot initialize its files. Wrap
browser-evaluation failures through the returned handle to attach the exact
profile and a typed recovery without changing unrelated errors:

```js
const chrome = await launchChromeCdp({ chromeBin });
try {
  await runBrowserChecks(chrome.ws);
} catch (error) {
  throw chrome.diagnoseRuntimeError(error);
} finally {
  await chrome.stop();
}
```

The matching diagnostic code is
`SNAPBACK_BROWSER_INDEXEDDB_PROFILE_OPEN_FAILED`. On macOS it recommends
`tempRoot: '/tmp'` for launcher-owned profiles, or an explicit writable
`userDataDir` when the caller needs to retain the profile. The default remains
`os.tmpdir()`: the 2026-08-06 real-Chrome matrix recorded in the closed ticket
could not reproduce the earlier host failure and refuted path length and symlink
spelling as general causes.

Run the manual matrix on the current host with:

```bash
CHROME_BIN='/path/to/Google Chrome' \
  node demos/_kit/tests/chrome-indexeddb-profile-probe.mjs
```

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
   contain local edits). Before spawning Cargo, the kit runs the same exact
   link-and-launch probe as `scripts/ibex-doctor`: this checkout's manifest,
   lockfile, feature selection, native inputs, target, and final binary must
   link and launch. Missing symbols and stale-override evidence remain typed on
   `error.diagnostic` and `error.runtimeRecovery` instead of collapsing into an
   opaque harness startup failure.

Every rung is additionally gated on the persisted **runtime readiness
receipt** (`<binary>.runtime-readiness.json`, `snapback.runtime-readiness.v1`
— LLP 0115 CV-3): the digest-bound record that this exact binary, against the
current Hermes artifacts, created and destroyed its restricted no-eval handler
VM (`snapback runtime-qualify`, LLP 0115 CV-2). The `cargo` rung's exact-link
probe qualifies and issues the receipt for the binary it just built; the
`configured` and `prebuilt` rungs verify it and self-heal an
absent/stale/incoherent receipt by re-qualifying the resolved binary — a
binary that cannot qualify fails with the shared
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED` /
`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` codes (prebuilt falls back to the
cargo rung; configured is a hard coded error). The `reused` rung cannot
re-qualify a running process, so it binds by identity instead: reuse requires
a locally receipted, digest-coherent runtime whose build identity the live
`/health` stamp matches; anything else refuses reuse and starts a fresh,
receipt-gated server.

Every spawned child is bound to its unique ready-file nonce via `/health`; the
returned handle reports `launch: { rung, command }` and `identity: { verdict,
mismatches, binary, expected }`. Verdicts: `verified` (same clean commit on
both sides), `pinned-binary-dirty-checkout` (the binary's own stamp is a
clean exact build of the agreed commit — exact commit evidence — and only the
comparing checkout is dirty; LLP 0115 CV-15 split this out of the old
`unpinned` so an explicitly configured exact binary is not misread as weak
provenance), `unpinned-binary` (the binary's own stamp is dirty or of unknown
dirtiness, so *its* bytes are not pinned to the commit), `env-stamped` (an
explicit `SNAPBACK_BUILD_GIT_COMMIT` / `SNAPBACK_BUILD_GIT_DIRTY` in the
launch environment — the deterministic CI seam, attested rather than
verified), `unverifiable`, and `stamp-mismatch`.

It also reports `runtimeRecovery`, the same
`snapback.runtime-recovery.v1` record emitted by repository
`scripts/ibex-doctor`/bootstrap and packaged `snapback doctor`/`dev`. That
record keeps the selected binary, resolver rung, expected checkout state,
actual stamp, reuse reason, and exact safe override together. A final launch
failure carries the record on `error.runtimeRecovery` and prints it once.

The kit **never injects** checkout-derived stamp values into children:
`build.rs` runs its own git probe over the binary's real inputs
(ENG-23365/ENG-23419), so the stamp stays independent of the expectation it is
compared against and the comparison carries information
(`issues/closed/20260724-kit-identity-stamp-env-injection-tautology.md`).

`deps.launchSpec` (via `__startServerForTests`) remains a **test-only** seam
that substitutes the cargo rung's command for lifecycle fixtures; production
callers wanting a specific binary should pass `serverBinary`.
