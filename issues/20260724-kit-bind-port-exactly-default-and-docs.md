# Kit port binding: requested port is a silent reuse probe; bindPortExactly undocumented

**Status:** Open
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
