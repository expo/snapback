# Real pre-RP stores

Generated on eb1000 on 2026-10-03 by commit
`a8c20c40e986f8af98f4579386bdb80b9fa7f69e` in the separate
`/home/ccheever/sb4-intent/rp-baseline` checkout. Its compiler, core and device
sources were unchanged. The only temporary addition was `generate.rs` as a
submodule of `tests/declarative_receipts/allocation.rs`, reusing that version's
test helpers. The old compiler says `send` predicts **never**.

`schema.q` uses receipts and a row-keyed unread count. `server.sqlite` contains
conversation `c`, members `alice`/`bob`, and settled message `m1`, ordinal 1.
`backend.json` is the real public projection emitted by that engine. Its
capabilities have not been edited. `memory.json` is the old memory device's
drained persistence batch; `device.sqlite` is the old native device database.
Both devices retain the real server incarnation and clock, have acquired the partition, owe delivery `[1,1]`, and
hold unsent write `alice7` in their outbox (no predicted row under the old rule).

Reproduce in a checkout of that exact commit, copying only the schema and
fixture generator to an empty output directory:

```sh
# Append to snapback4-lang/tests/declarative_receipts/allocation.rs:
# #[path = "/absolute/path/to/generate.rs"]
# mod rp_fixture;
RP_FIXTURE_DIR=/absolute/output LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT \
  cargo test -p snapback4-lang --test declarative_receipts generate_predecessor -- --nocapture
```

The original SQLite files were 253,952 / 290,816 bytes (server/device). To keep
every new artifact below 256 KB, Python's SQLite ran `PRAGMA journal_mode=DELETE`,
`PRAGMA page_size=1024`, then `VACUUM` after both old engines had closed. The
entire `iterdump()` before and after was asserted identical. This changes only
physical packing, not a schema, capability, row, index, outbox or debt value.
Empty assets/owner files are omitted. No gzip, video or large log is committed.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| backend.json | 68,248 | 82801996f888251d50ef811f3e12daf93de37fbc3ad76161582cdb7eedcec56f |
| memory.json | 85,847 | 4661ed8953d552e62a7fa2b526067d0fac5124b51df141d02d06be8d8e671338 |
| server.sqlite | 125,952 | a275ac13f0caf84f148f1fa91bfee4467bda129f431b9107bc51ec6ad4b2b3ed |
| device.sqlite | 133,120 | 5634f2c8c942709e39b695f563889b225168ed4b2a07e77c26881c9b86a43a8a |
| schema.q | 3,420 | 50dd73317112b2c1268b67fda69fececa0f5173b6572742a80a89ebe393683ba |

The RP tests copy these immutable fixtures into temporary stores. The Rust
test opens/adopts the server and both devices through Kept, Initial and Install,
retains the old queue/debt, predicts a new send, settles both sends, obtains exact
count 3, and reports the preserved delivery positions. The wasm test opens the
same persisted memory fixture in all three modes, adopts a newly compiled
backend, predicts a new send, and reopens with both outbox entries and unchanged
settled-only debt.

The actual a8c20c40e9 wasm was also rebuilt on eb1000: it opens this memory
fixture and rejects a backend emitted by the RP compiler with
`E_SCHEMA_CAPABILITY: receipt-derived-prediction-v1`. This is separate from
the unknown-capability unit test; no capability was renamed to simulate age.
