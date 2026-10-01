**NOT READY — one High (P1) finding remains.**

**Compound-value builtins can still bypass receipt observation.** [`share()`](/home/ccheever/sb4-intent/review-ry-r4-astra/snapback4/crates/snapback4-core/src/engine/runner.rs:1099) compares entire records without recording their receipt dependencies.

With Alice and Bob in an empty conversation:

```quarry
mutation shareSend(conversation: conversations):
  m = insert messages { conversation, sender: viewer, text: 'checked', photo: null, at: now }
  n = share(1, [m], {
    id: m.id, conversation, sender: viewer, text: 'checked',
    photo: null, at: now, ordinal: 1, recipients: 1
  })
  require n = 1 else ACCOUNTING
```

The device’s inserted record has `recipients: 0`; the server’s has `recipients: 1`.

| Comparison record | Device | Server |
|---|---|---|
| `recipients: 1` | Terminal `E_INPUT: recipient missing from shares`; **outbox empty** | Accepts the send |
| Change to `recipients: 0` | **`predictable: true`**, message displayed | Refuses `E_INPUT` |

Both outcomes reproduce on memory and SQLite, with full acquisition and the shipping horizon: **eight reproductions**. [Fixture](/tmp/ry-r4-astra-jfjonyny/snapback4/crates/snapback4-lang/tests/declarative_receipts/review_extra.rs:26), [results](/tmp/ry-r4-astra-jfjonyny/share-final.log).

Additional probes show missing observation in composite `min`/`max` and record-valued `group` keys. The recursive observation added for binary comparisons needs to cover other consumers of compound values too.

The claim checks were:

| Claim | Independent result |
|---|---|
| **1. Every authored accounting read defers** | **Refuted above.** The prior rounds’ reported failure shapes now defer correctly, including Astra’s maintained-column follow-up and all five Grok `bySender` cases. |
| **2. Ordinary flows still predict** | Confirmed for sends, creates, joins, stable-id edits, reaction upserts, inserted-id reuse and text-only conditional edits. No unintended over-conservatism found in these controls. |
| **3. Redundant guards removed; generated coverage expanded** | Confirmed. All **704 generated scenarios** pass. Disabling only `observe_receipts(schema)` produces **12 failures / 3 passes** in the final round-4 extension; restoring it passes **15/15**. The missing compound-consumer cases explain why that coverage still passes. |
| **4. Tests, suite and wasm** | Independently passed **140 receipt tests and 110 guide tests**. All **2,335 captured source hashes match**; the retained full-suite log confirms **0 failures in 1,305 seconds**. I audited that suite rather than rerunning it. The wasm rebuild matches **2,017,966 B raw / 605,913 B gzip**, including SHA-256; the budget equals measurement. |

For apps without a receipts clause, both-store controls preserve prediction and terminal-refusal behavior, and serialization omits the empty dependency metadata. The observer is disabled and adds no storage reads or meter charges. There is still shared artifact cost—**+1,618 B gzip, approximately 0.27%**—plus constant guard checks and schema storage; zero CPU or memory overhead is not established.

The review checkout is unchanged. Nothing was pushed.
