# Latency Kanban (A2)

Paired provider-native implementations of LLP 0138's 500-card optimistic
board. Both arms inject 1,000 ms at the mutation authority boundary. Local
prediction, server acknowledgement, and independent-observer convergence are
recorded as different events.

```sh
cd demos/zero-bakeoff/apps/latency-kanban
npm run generate:snapback
npm run accept:snapback
npm run accept:zero
npm run typecheck
```

The Snapback runner owns an isolated in-memory server. The Zero runner reuses
the qualified shared PostgreSQL 17 process but owns a distinct database, API
server, `zero-cache-dev` process tree, clients, replica, and cleanup. Neither
runner treats an unavailable runtime as a pass; it emits a machine-readable
`GAP` result and exits non-zero.

Stable UI identifiers are `lk-board`, `lk-card-<id>`, `lk-move-<id>`,
`lk-status`, and `lk-error`.
