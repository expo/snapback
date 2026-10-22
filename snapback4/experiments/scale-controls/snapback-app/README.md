# S1-SK: the Quarry W1–W5 fixture

This is the Snapback 4 application for LLP 3000.009.001.002 §4, beside the
typed SQL and native Convex controls. It is a synthetic Clique-shaped benchmark,
not a replay of Clique's production data or a complete chat product.

`snapback/schema.q` defines rooms, users, memberships, messages and counters.
Room `total` and user `sent` are engine-owned maintained columns, updated in the
message transaction. Message reads and posts require membership; posts derive
the sender from the session. Membership rows are visible to their principal.
Counter updates require ownership, or membership for the ownerless shared
counter. Counter ownership and room are immutable. Signed-in readers may see
room totals and user counters, matching the raw control's table read authority.
Bootstrap/roster changes are operator fixture work, with no public writer.

| Workload | Quarry operation | Equivalent control operation |
|---|---|---|
| W1 | `W1(message)` | Authorized message by id |
| W2 | `W2(room)` | Member's newest 20, descending at/id |
| W3 | `W3()` | Own 32 ordinary memberships, room totals and max(0,total-last_read) |
| W4/W5 | `increment(counter)` | Atomic, authorized read-modify-write, exact returned value |
| Post witness | `post(room,body)` | Member post plus atomic room/sender maintenance |

Quarry infers indexes from these reads and unique keys: message room/time order,
membership room/principal and principal/room, user principal and identities.
`check --cost` retains the actual plans. IDs are stable strings (`r0000`,
`u0000`, `m0000000001`, `c0000`) mapped to the controls' integer keys by the
HTTP adapter. Principals are `bench:0` through `bench:255`.

The fixture generator in `scripts/snapback.py` translates `seed.sql`: 256 users,
1,025 rooms, 8,448 memberships, 257 counters and 1M identical message images.
It omits maintained fields, seeds in bounded batches through native dev `/seed`,
sets the identical last-read offsets, stops dev, restores a SQLite backup into
the deployment directory, then runs `deploy`. Full message-image and aggregate
equality are checked through Snapback's read-only administrative SQL views.
No managed data is populated by SQL writes.

The benchmark serves the deployment using `serve`, with ordinary application
sessions minted by the operator service through `/auth/session`. Bearer material
is private and excluded from evidence. The engine hashes and resolves each
token against its stored session, expiry and current authority on each request.
No persona, seed, trusted-principal adapter, crypto shortcut, or extra HTTP
server lies on the measured request path. The target in `src/snapback.rs` talks
only to HTTP and can also measure a future Postgres-backed `serve`.

These tables are online only: W1–W5 do not measure replication or live delivery,
and the matched controls have no W6 implementation in this campaign. `serve`
retains its ordinary commit log, rules, meter and background behavior. Its
current detached query readers and single FIFO writer are used unchanged.

Build and detached run commands are in the parent [README](../README.md).
