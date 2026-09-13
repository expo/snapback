# tiny_http 0.12.0: bounded host, unread-body draining and worker reservation

Source: the crates.io `tiny_http` 0.12.0 archive, from
<https://github.com/tiny-http/tiny-http>. The original MIT and Apache-2.0
licenses, normalized/original Cargo manifests, source, tests and examples
are preserved here. This directory is excluded from the Snapback 4 workspace
and selected with its `[patch.crates-io]` entry.
Original crates.io archive SHA-256:
`389915df6413a2e74fb181895f933386023c71110878cd0825588928e64cdc82`.

Local change, 2026-09-13 (R18): `src/util/equal_reader.rs` drains an unread
Content-Length body through a fixed 8 KiB buffer. Upstream allocated a buffer
equal to the entire declared remainder in `Drop`, so an early size refusal
in the HTTP handler still allocated the oversized declared body. EOF or an
I/O error now exits that drain without an allocation based on Content-Length.
Focused unit tests cover EOF, an I/O error and a normal multi-buffer drain.

This first patch bounds drain memory. Replace it with an upstream release
when that release contains the equivalent correction.

Local change, 2026-09-13 (performance work): `src/util/task_pool.rs` reserves
reported idle workers for already queued connections before assigning another
accepted connection. A notified worker still counts as idle until it reacquires
the queue lock; several accepts could otherwise reserve the same worker and
wait for a keep-alive connection to close. The regression holds the real
dispatch lock across five arrivals with four idle workers: the old predicate
starts only four tasks before release, while the fixed predicate starts five.
The helper only exposes that locked dispatch path to its unit test. Connection
parsing, request/response framing and the bounded drain above are unchanged.

Local change, 2026-09-13 (HTTP correctness): `src/response.rs` omits
`Content-Length` for 1xx and 204 responses, whose bodies the response writer
already suppresses. This prevents a 204 CORS preflight from advertising JSON
bytes that will never be sent. `src/request.rs` also exposes
`respond_checked`, which preserves client disconnect, write and flush errors
for one-view asset delivery. A checked write failure shuts down the connection
and invalidates its sequential response queue before releasing the writer, so
a later pipelined response cannot be appended after a truncated body. Ordinary
responses retain upstream's behavior.
`src/client.rs` bounds request/header lines at 8 KiB, the complete header
section at 64 KiB and the header count at 100; an oversized header section is
answered with 431 instead of growing until the peer stops sending.

Local change, 2026-09-13 (security S11): `Server::http_with_limits` admits a
bounded number of accepted sockets before creating connection threads. A
lease covers the connection and every request-owned reader/writer. This
entrypoint serializes requests within each persistent connection until the
previous response and body reader finish; pipelining cannot build an
unbounded request queue. `ConnectionLimits` sets a header byte cap and
absolute header/body/write deadlines plus idle socket timeouts. Read/write
syscalls use the smaller remaining phase deadline, so progress cannot reset
it. Timed-out sockets close; `Request::abort` lets the host close an
admission-refused request immediately without draining its body. The legacy
entrypoints retain their API and framing. Snapback's binary unit tests cover
connection overload, idle clients, header/body dribbling, stalled readers,
bounded pipelining and short requests progressing under saturated polls.
