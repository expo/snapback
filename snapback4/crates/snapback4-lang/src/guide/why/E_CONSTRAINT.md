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
  delay physical deletion. A `cap` counts live rows. Its maintained physical
  count proves room when below the cap; otherwise a bounded authorization
  walk checks live occupancy. Unique checks skip expired collisions at the
  same full key. These candidates use the internal ledger described in
  `guide rules`; exhausting the shared physical allowance refuses with E_RULE.
  Secondary-key predecessors remain until the sweep.
  A row inserted already expired by a program is retired at its commit's end,
  releasing its cap occupancy without a later deletion event. Reviving it
  within that commit preserves it. Seeds and loads keep expired rows for sweep.
  Devices queue occupancy-increasing writes on expiring capped tables without
  predicted rows: even a complete live snapshot omits unswept expired rows.
  Unique checks never scan unrelated keys; a saturated cap may inspect its group.
