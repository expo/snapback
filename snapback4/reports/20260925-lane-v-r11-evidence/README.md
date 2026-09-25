# Round 11 evidence

Commands run from `snapback4/`, with `$HOME/.local/bin` and `$HOME/.cargo/bin`
on `PATH`. The source and tests implement the round-10 review rulings in
`~/sb4-intent/reviews/v-r10.astra.md` and `v-r10.grok.md`.

- `stream-receipts.log`: `cargo test -p snapback4-core --test stream_receipts`.
- `build-native.log`: `cargo build -p snapback4` after the negative server control.
- `client-targeted.log`: `node --test packages/snapback4/test/acquisition.test.mjs
  packages/snapback4/test/client-seams.test.mjs
  packages/snapback4/test/client-lifecycle.test.mjs`.
- `browser-fixed.log`: `node --test packages/snapback4/test/web-admission-review.test.mjs`.
- `ref-check.log`: `./ref-check --verbose` from the repository root.
- `full-suite.log` and `full-suite.exit`: complete qualification using
  `SNAPBACK4_RUST_TEST_PROCESSES=4 taskset -c 64-79 scripts/test.sh`.

Negative controls use the same real Chromium/IndexedDB/server harness. These
nonzero exits are intentional:

```sh
SNAPBACK4_WEB_ADMISSION_FOCUS='known NOT_ADMIN receipt' \
SNAPBACK4_WEB_ADMISSION_MUTANT=authored-refusal \
node --test packages/snapback4/test/web-admission-review.test.mjs

SNAPBACK4_WEB_ADMISSION_FOCUS='sent_seq alone' \
SNAPBACK4_WEB_ADMISSION_MUTANT=receipt-lookup-save \
node --test packages/snapback4/test/web-admission-review.test.mjs
```

`mutant-authored-refusal.log` fails because `mutate` returns `sent` instead of
`failed`. `mutant-receipt-lookup-save.log` fails because lookup leaves the durable
history row `failed` instead of `sent`, before any flush can repair it.

`browser-old-server.log` ran the three new cases against the pre-fix round-10
native server. The refused `_ops` case fails because the actual sync response
acknowledges sequence 3 instead of omitting the refused ID. The other two cases
pass. This tests the server-filter removal independently of the client guard.

`browser-fixture-rewind.log` is an initial full browser run with one test-fixture
failure (plus its parent): earlier cases advanced the shared store above the
synthetic catch-up watermark 7. Production correctly returned `E_STORE_RESTORE`.
The corrected fixture retains exactly `sent_seq: 7` and no `observed_seq`, but
uses a covering page at `max(7, current watermark)`. Its lookup-persistence
assertion still runs before that page or any flush. This failure is ours, not
a baseline or environmental failure.
