**NOT READY — one High (P1) and one Medium (P2) finding remain.** The original round-2 reproductions pass, but the class is not structurally closed.

**P1: Receipt-dependent target selection can still predict the wrong row.**

The [key guard](/home/ccheever/sb4-intent/review-ry-r3-astra/snapback4/crates/snapback4-core/src/schema/receipts.rs:173) checks the physical index’s columns. An ordinal test evaluated afterward escapes it.

Reproduction: after acquisition, a competing server send takes ordinal 1. The device predicts its new message at 1; the server assigns it 2. With an admitted `cap 20 by conversation`:

```quarry
for target in messages where .conversation = conversation first 20 by .id:
  if target.ordinal = 1:
    update messages[target] { text: 'edited' }
```

On both stores, with full acquisition, this remains `predictable: true`. The device edits its new message; the server edits the competing message. This reproduces within one transaction and as a follow-up.

The aliased selection `messages[id = subject, ordinal = 1]` also escapes: it predicts an edit locally, while the server refuses `MISSING`. That reproduces **with and without a horizon**, on both stores and transaction arrangements. The receipt touch records the dependency, but successful predictions bypass the refusal guard. [Reproductions](/tmp/ry-r3-astra-rr3habhe/snapback4/crates/snapback4-lang/tests/declarative_receipts/review.rs:156).

**P2: A maintained column derived from receipt accounting can still drop a valid follow-up.**

The [table classifier](/home/ccheever/sb4-intent/review-ry-r3-astra/snapback4/crates/snapback4-core/src/schema/receipts.rs:155) covers aggregate-view targets, but misses ordinary parent rows containing mirrored maintained columns.

Reproduction: add a `shelf` reference to messages and declare `shelves.total` as `sum messages of .recipients by .shelf`. Admit a send, then read the shelf and require `p.total > 0`.

Both stores return terminal `NEED_TOTAL`, leaving only the send queued. Executing those same intents on the server produces total 1 and accepts the follow-up. This reproduces with full acquisition and the shipping message horizon. Receipt dependency must survive onto the maintained parent field. [Reproductions](/tmp/ry-r3-astra-rr3habhe/snapback4/crates/snapback4-lang/tests/declarative_receipts/review.rs:207).

The concrete checks were:

| Claim/check | Independent result |
|---|---|
| Original Astra reproductions | All **14 witnesses and controls pass**, including counter reads and maintenance overflow. Claim 1 remains incomplete because of P2 above. |
| Direct receipt-owned targets | All **120 ordinal-target and 30 other owned-key scenarios pass**. Claim 2 remains incomplete because of P1 above. |
| Generated coverage | All **382 scenarios**, in ten tests, pass. Disabling only `observe_receipts(schema)` produces **six admission failures and four passes**; restoring it passes all ten. |
| Full-suite evidence | All **1,851 source hashes match**. The retained log confirms **0 failures in 1,323 s**. I audited, rather than reran, that full suite. |
| Wasm | Independent rebuild matches **2,011,439 B raw / 604,295 B gzip and SHA-256**. The budget equals measurement. The recorded merge cost is **2,019 B gzip** over RY round 2; the structural guards add **647 B** over that merged baseline. The reasoning is proportionate and preserves PR’s contribution. |

Sends, creates, joins, edits by id, and the documented reaction-upsert flow still predict. Additional checks passed: **452 device tests**, **107 guide tests**, and both non-receipt output-order probes. No non-receipt semantic regression was found. The empty-clause path adds no storage or meter work, although constant guard checks still execute; literal zero CPU overhead is not established.

The review checkout is unchanged. Nothing was pushed.
