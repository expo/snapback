# F3b historical-image counterexample and SDK recovery regression

RFC revision 7 resolves the original stop: each derived form bounds its own
rows; a historical composed commit that outgrows the stream ceiling uses the
existing SDK snapshot restart. There is no write-time stream-byte guard.

The maintained fixture, `packages/snapback4/test/helpers/timeline-recovery.q`,
reproduces the same sequence under default meters:

1. Register and acquire the author on WASM/memory and native/SQLite SDK clients.
2. Keep them offline, with one predicted timeline post pending on each.
3. Publish one post together with 1,021 empty public notes: 1,024 writes.
4. Grow each note separately to 9,000 newline characters. Each update's actual
   encoded HTTP stream response fits under 16 MiB.
5. The historical commit re-reads those larger images; at `limit: 1` its
   response is `E_BOUND` with `snapshot: true`, in the same generation.
6. Drive each client's ordinary `sync()`. Assert it reaches limit 1, restarts
   a snapshot, reaches the server watermark and Following page, and preserves
   the pending write's ID, arguments, event ID supply and predicted row keys.
7. Release mutation submission and assert both receipts become sent, both
   outboxes empty, and both complete Following pages equal the server's.

Run from `snapback4/`, serially with the pinned Node 24 PATH:

```sh
cargo build -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
cargo test -p snapback4 --test timeline_delivery -- --nocapture
cargo test -p snapback4 --test timeline_delivery_counterexample -- --nocapture --test-threads=1
node --test packages/snapback4/test/timeline-delivery.test.mjs
# The same SDK regression, as a standalone experiment:
node experiments/f3b-deliverability/reproduce.mjs
```

The Rust historical measurement runs in the ordinary suite; it pins the
original commit and all 1,021 later row images and uses the production HTTP
serializer. `timeline_delivery` asserts the bounded derived contribution
and measures the maximum-backfill promotion's actual recipient pages. The
package test runs the positive SDK recovery regression in the ordinary suite.

The experiment uses real HTTP encoding, unchanged ceilings, public mutations,
and the actual WASM and native SQLite devices. Only the link and mutation
submission are delayed: `/sync` responses are neither mocked nor rewritten.
Direct device calls inspect state/outbox evidence; mutation admission, sync,
reacquisition and reads run through the SDK. The fixture owns and removes its
temporary databases and child processes. The original counterexample and its
measurements remain in the lane report.
