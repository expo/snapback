# Kit port binding: requested port is a silent reuse probe; bindPortExactly undocumented

**Status:** Resolved (2026-07-25)
**Severity:** P2
**Systems:** Local server lifecycle, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** demos/_kit/server-process.mjs, expo-jam-allaboard diaries 0001/0005
**Marker:** all-aboard-external-review

In `demos/_kit/server-process.mjs` the requested `port` is only a reuse
probe (`isPortOccupied`, `:123`): on any mismatch the kit spawns with
`--port 0` (`:175`) and the caller silently gets an OS-assigned port
unless it reads `baseUrl` back. The `bindPortExactly` option that binds
exactly-or-fails exists (`:67`, `:106`, verified against the ready file
at `:448-455`) but its own comment calls it a "test-only restart seam",
and it appears nowhere outside the source — `demos/_kit/README.md` is 14
lines with no options, and `guide/` has zero occurrences. The All Aboard
external review (Kimi, 2026-07-24) called this out, and the demo repo's
wrappers each rediscovered the option from source
(`apps/snapback/swiftui/server.mjs:53-55`).

Proposed: make explicit binding the default — bind the requested port or
fail loudly — with the probe/reuse behavior opt-in (it exists to serve
the shared-server acceptance flows, so it stays available). At minimum,
document both behaviors in the kit README and log the reassignment
prominently. Audit existing kit consumers for reliance on the probe
default before flipping it.

**Done when:**

- `demos/_kit/README.md` documents `startServer`'s port semantics:
  the probe/reuse behavior, `bindPortExactly`, and how to read the
  effective `baseUrl`.
- The default is decided deliberately (recommend: exact-bind default,
  probe opt-in) and existing consumers are migrated in the same change.
- A lifecycle test asserts the chosen default: requested-port-occupied
  fails loudly (or reuses only under the opt-in), never silently lands
  on a different port.

## Resolution (2026-07-25)

**Decision: keep the probe/verified-reuse default; make reassignment loud;
document both modes.** The recommended flip to exact-bind-or-fail was
rejected on the audit's evidence.

Audit (2026-07-24/25, `rg` across demos/, tests/, scripts/, guide/):
~25 call sites pass a fixed non-zero port and rely on the current default
— every `demos/_kit/tests/regression-*.mjs` and conformance suite
(4407–4438), the todo/todo-v2/graffiti/all-aboard headless, contract,
provider and cron suites (4399–4433), the demo headless runners
(`demos/todo*/surfaces/headless/run.mjs`), `demos/chat-matrix/dev.mjs`,
and the guide's verified acceptance snippet
(`guide/testing/acceptance.md`). These depend on (a) verified reuse of an
already-running dev server for fast iteration (the fleet's documented
workflow), and (b) the OS-assigned isolated fallback so parallel suites
sharing a requested port never collide (pinned by the existing
four-way-parallel lifecycle test). Exact-bind-or-fail as the default
would turn "a dev server holds the port" and "two suites run at once"
from working isolation into hard failures across all of them, and would
contradict the ENG-24378 invariant that cargo is never launched into an
occupied address. `bindPortExactly` remains the opt-in bind-or-fail mode.

Changes:

- `demos/_kit/server-process.mjs`: the previously **silent** path
  (requested port not adopted, child bound elsewhere) now prints a loud
  `PORT REASSIGNED: requested :N but the isolated child bound :M` line
  pointing at the returned `baseUrl`, `bindPortExactly`, and the README.
  The occupied paths already logged `PORT OCCUPIED:` / `PROVENANCE
  MISMATCH:`; they now additionally get the REASSIGNED line naming the
  effective port.
- `demos/_kit/README.md`: new "startServer port semantics" section
  documenting the probe/verified-reuse default, the OS-assigned isolation
  fallback, reading the effective origin from `handle.baseUrl`, and a
  "bindPortExactly: bind-or-fail" section (no probe, no reuse, no
  fallback; ready-file port verified against the request).
- `demos/_kit/tests/server-process-lifecycle.mjs` pins the chosen
  default: a fresh spawn on a requested port asserts the `PORT
  REASSIGNED` line (never silent), and the occupied-squatter case asserts
  both `PORT OCCUPIED` and `PORT REASSIGNED` alongside the pre-existing
  never-adopt / bindPortExactly-fails-loudly assertions. Suite: PASS.

No consumers migrated because the default did not change; all existing
call sites already read `server.baseUrl` back.
