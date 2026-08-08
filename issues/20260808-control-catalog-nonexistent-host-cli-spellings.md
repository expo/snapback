# Control catalog advertises a `snapback host …` CLI spelling that does not exist

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Control catalog, CLI, Guide
**Date:** 2026-08-08

Seven control-catalog rows (and one prose reference) advertise CLI
spellings with a `host` prefix, but the binary has no `host` subcommand —
the real commands are top-level `snapback start|stop|inspect|reset|load|run`.

Evidence:
- scripts/generate-control-catalog.mjs:98-105 hardcodes the `snapback host …`
  spellings; src/cli.rs:744-794 declares Start/Stop/Inspect/Reset/Load/Run
  at top level with no `host` group.
- Live probe: `target/debug/snapback host --help` →
  `error: unrecognized subcommand 'host'`. The packaged npm CLI delegates
  unknown commands verbatim to the native binary, so the spelling fails on
  every install channel.
- `snapback controls describe app.inspect` on the built binary prints
  `"cli": "snapback host inspect"` — the catalog agents are told to trust
  hands them a command that errors.
- Wrong rows: guide/operating/agent-controls.md:111 (`host inspect`),
  :112 (`host reset`), :191 (`host run`), :192 (`host load --functions`),
  :197 (`host start`), :198 (`host stop`), :209 (`host load --schema`);
  prose repeat at guide/operating/host-ops.md:271 ("same … flags as
  `host inspect`"). Notably `host.restart`'s row (`snapback restart`,
  agent-controls.md:196) is already correct.

Ask: correct the spellings in generate-control-catalog.mjs's CLI map,
regenerate the catalog/inventory projections, and fix the host-ops.md prose.

Found by the 2026-08-08 comprehensive docs review (operating slice).
