# Indexes — E_CONSTRAINT

E_CONSTRAINT means a unique key, product cap, immutable field, format or
postcondition rejected the write. Keep the rule and correct the named input.
For a visible duplicate handle, choose a different handle; `if absent` is
appropriate only when doing nothing on an existing row is the intended write.

For `after insert <- exists t[key]`, a local hit satisfies the postcondition.
A local miss predicts `E_CONSTRAINT` only when the key proves readability
and its synced group is fully held without a horizon. Otherwise either an
ordinary insert or an upsert queues without a predicted row; the server
decides the postcondition when the write arrives.

- **Expire:** `expire at .expiresAt` (a `time ?` column; its sweep index is generated). A row past that time is
  absent to every reader on every host from that moment, before any rule;
  the server sweeps on a one-second tick, at most 2,000 rows per pass, and
  the deletion streams to each device holding it. Backlog or downtime can
  delay physical deletion. A `cap` on an expiring table uses a maintained
  physical count: unswept expired rows still occupy capacity. Unique checks
  skip expired collisions at the same full key under the examined meter;
  secondary-key predecessors remain until the sweep, so replacement at a full
  cap refuses until that sweep frees room. The refusal names the sweep timing.
  A row inserted already expired by a program is retired at its commit's end,
  releasing its cap occupancy without a later deletion event. Reviving it
  within that commit preserves it. Seeds and loads keep expired rows for sweep.
  Devices queue occupancy-increasing writes on expiring capped tables without
  predicted rows: even a complete live snapshot omits unswept expired rows.
  Unrelated live or expired rows are never scanned for a write's constraints.
