# CLI/dev process teardown leaves orphans across several hand-rolled variants

**Opened:** 2026-08-08 · **Severity:** P2 (orphaned dev servers holding fixed ports — the known "stale server" failure mode) · **Area:** snapback-cli / snapback-expo

Process teardown is reimplemented in at least four places with differing rigor.
The best variant (`doctor`: stop → SIGTERM → bounded wait → SIGKILL,
index.mjs:569-601) is not shared, so weaker copies orphan children. Symptoms all
match the recurring "stale servers on fixed ports (e.g. 4420)" trap.

## Sites

1. **No SIGHUP handling.** `index.mjs:2472-2479` (`shell:true, detached:true`)
   and `expo-dev.mjs:1042-1044` (`detached: platform!=='win32'`) spawn detached
   process groups, but only SIGINT/SIGTERM are hooked (index.mjs:4231, 4301);
   `rg SIGHUP` finds nothing. Closing the terminal SIGHUPs the foreground group
   → the CLI dies via Node's default handler, never running `close()`, and the
   detached Vite/esbuild/Metro trees survive as orphans holding ports.
   *Fix:* `process.once('SIGHUP', stop)` alongside SIGINT/SIGTERM in both wait
   blocks.

2. **`runDev().close()` has no fallback when native `stop` fails.**
   `index.mjs:2289-2293` (also 2800-2807): `closeManaged` calls
   `native(binary, ['stop', …])` and ignores the result — no SIGTERM/SIGKILL
   escalation, no exit wait. A non-zero `stop` (stale nonce, hung server,
   timeout) reparents the runtime child to init still holding the SQLite DB and
   port. *Fix:* mirror the doctor pattern on `stop.status !== 0`.

3. **Client-arm SIGKILL timer is `unref`'d, so it rarely fires.**
   `index.mjs:2560-2564`: `signalGroup('SIGTERM'); const escalate =
   setTimeout(…SIGKILL…, 5000); escalate.unref?.();` — `close()` returns and the
   process exits within ms, so the 5s timer dies with it. A client tree that
   ignores/mishandles SIGTERM is orphaned every quit. *Fix:* await client-arm
   exit with a bounded deadline (as `stopProcessGroup` in expo-dev.mjs already
   does for Metro).

4. **First-start/restart teardown** sends SIGTERM/SIGKILL without awaiting exit
   before throwing/respawning (index.mjs:2276-2287, 2643-2658) → DB-lock races
   on the immediate retry.

## Fix (structural)

Extract one `stopProcessGroup(child, {graceMs})` primitive (the expo-dev variant
is closest) and route all four sites plus `runDev.close()` and the MCP
`close()` through it. This retires roughly six findings as one class.

## Confidence

High on each site; the detachment is deliberate, the missing lifecycle handling
is the gap.
