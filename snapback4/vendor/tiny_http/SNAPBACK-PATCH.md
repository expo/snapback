# tiny_http 0.12.0: bounded unread-body draining

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

This patch bounds drain memory; it does not introduce a socket deadline or
change tiny_http's connection/reuse protocol. Replace it with an upstream
release when that release contains the equivalent correction.
