# Managed dev loop rejects native load's two JSON documents

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** CLI, Developer experience, Local server
**Date:** 2026-08-05

## Problem

The packaged `snapback dev` loop starts a healthy local server, then aborts
while loading a valid generated schema/functions pair:

```text
SNAPBACK_DEV_SERVER_LOAD_FAILED: schema/function load failed
Error: host-ops error response was not JSON
Failed to read JSON: expected value at line 1 column 1
```

Reproduced while building
`demos/relay-room-bakeoff/snapback-expo`. The native command invoked by the
wrapper is successful, but `snapback load` emits two complete JSON result
documents: one `schema.load` result followed by one `functions.load` result.
Running the same native load directly returned both `ok: true`; reset/seed and
subsequent query/mutation host operations also passed.

This leaves the managed happy path unusable for this generated app and forced
the demo to add a lower-level `scripts/dev-server.mjs` provisioner.

## Acceptance

- `snapback dev <backend>` accepts the documented native `load` output shape
  without treating two successful envelopes as malformed JSON.
- A regression test loads both schema and functions through the packaged dev
  command and reaches its ready event.
- One failing envelope still produces the exact failing operation's diagnostic
  and non-zero exit.
