# PIPE: independent PostgreSQL reader statements

Base: `bd50485b8c9ba1048ba7ed905b64444e219aeec6`, branch `sb4-pg/pipe`,
expo-build-450a. Own `snapback4/target`, six Cargo jobs, line-tables-only
dev/test profiles. Private PostgreSQL 16, no existing cluster or host workload
modified. Raw evidence is retained externally under `/tmp/sb4-pipe`.

The governing context is LLP 3000, the store-port §8, round-trip §3.6 and
§13, and accepted controls RFC §12. The author's M1b evidence explains the
S1b stall with Nagle and its removal with TCP_NODELAY. The M-suite branch
was unavailable from this lane's origin; it is treated as supplied evidence.

Detached reader handles share at most 30 physical connections, opened lazily.
Each has a depth semaphore (1–8, default 4). The one reader runtime I/O
thread drives tokio-postgres 0.7.18; synchronous request threads await their
own result. Parse/Bind/Execute/Sync sends one single statement per flight,
with an independent implicit transaction and snapshot for each request.
Statements return ordinary driver binary rows through the existing FromSql
path. G4a calls the same bounded facts SQL, decoder, Rust resolver and meter.
The typed literal encoder still checks all composed parameters, including
NUL and byte admission. No result or authority decision is cached.

A multi-statement read acquires exclusive physical-connection custody before
its first preparation/command and holds it through rollback. It keeps the
existing repeatable-read transaction and ordered SimpleQuery flights. Pipeline
reads cannot join that transaction. A speculative SQL failure can reopen the
ordinary snapshot, as G4a requires; a connection failure returns a retryable
error without adapter replay. Completed requests retain their results.
Closed slots are replaced only for a later handle, never an in-flight request.

The writer and lease keep their synchronous driver and commit ordering.
Both drivers use tokio-postgres's TCP socket connector, which sets
TCP_NODELAY before startup. Reader startup pins and verifies UTF8,
extra_float_digits=3, bytea_output=hex, read-only mode and backend affinity.
The shared settings guard remains on every fallback flight. Application SQL
cannot mutate reader connection settings through the independent seam.

HTTP retains its existing 30 executing short workers and 98 waiting sockets.
The manual benchmark instead supplies 128 concurrent core-query clients to
show the transport at depth 1/4/8. It includes authority, collection, Rust
execution and result serialization; it is neither a raw SQL ceiling nor an
HTTP S1 capacity/SLO qualification. The fixture has 34 memberships and three
messages per room; W2 and W3 use the actual scale-controls program shapes.
Measured loopback load and full qualification are recorded below when complete.
