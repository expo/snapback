# Snapback 4: online fallback hides device-held retained history after a leave

Status: Open
Priority: P2
Date: 2026-09-14
Systems: local-first client reads, retained history, horizons

## Evidence

The CU2 device regression uses conversations, self-synced membership rows,
and messages with `retain delivered-history`, with a message acquisition
horizon of 25. After acquiring 25 of 26 messages and removing the viewer,
the live stream leaves 25 physical rows on both SQLite and memory. The
local `last 50 by byTime` read returns those 25 rows with `complete: false`;
the same engine query as the revoked viewer returns zero rows with
`complete: true`. The assertions are in
`snapback4/crates/snapback4-device/tests/retained_history.rs`.

`snapback4/packages/snapback4/src/local.ts`, `evaluateLocal`, replaces an
incomplete local answer with `server()` while online when no predictable
write is pending. The server answer is returned directly. It does not
delete the retained device rows. This explains how the 0.2.9 and 0.2.10
browser probes can show `[] / complete: true` while the device still holds
history. The CU2 regression proves the paired device/server results; it
does not exercise the browser's fallback end to end.

The related device replacement-snapshot loss is repaired separately in
`issues/closed/20260914-snapback4-retained-history-with-horizon-drops-rows-on-removal.md`.
Fixing that loss alone does not fix this visible online fallback.

## Follow-up

Define how a client presents a device-held retained answer alongside an
online fallback after revocation, then cover online and offline reads and
subscriptions on the real client. Preserve truthful completeness and the
server's current-image security rule; do not grant access to revoked
images or claim that an exhausted horizon is complete. This requires client
package work, which the CU2 brief explicitly excluded.
