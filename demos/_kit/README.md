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
