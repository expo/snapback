# snapback4: the wasm device's diet

**Filed:** 2026-09-13 · **Area:** `crates/snapback4-device` (web) · **LLP:** 3000 §7 (one implementation, 2026-09-13)

**Status:** Open — architecture planning in
[LLP 3000.002](../llp/3000.002-end-to-end-resource-bounds.research.md#proposed-device-representation-and-codec-redesign).
The original attribution and candidate list below are historical, not a
measurement of the current checkout.

The unified device measures 1,212,047 B raw / 313,763 B gzip as wasm
(`metrics/wasm.jsonl`, `metrics/client.jsonl`). The ruling accepts the
number and asks for a diet. A symbol-bearing build (the `wasm` profile
with `CARGO_PROFILE_WASM_STRIP=none`, `twiggy top` summed by crate) says
what the bytes are, uncompressed:

| Crate | Bytes | Share of code |
| --- | --- | --- |
| serde_core (derived visitors for the IR, the schema, the pages) | 284,226 | 21% |
| serde_json (parsing, `Value`, `to_value`) | 335,416 | 25% |
| alloc (String, Vec, BTreeMap; much of it instantiated by serde) | 266,671 | 20% |
| core (fmt, slices, str) | 180,662 | 13% |
| snapback4_core (the interpreter, the rules, the meter) | 125,737 | 9% |
| snapback4_device (the device, the memory store, the dispatcher) | 60,791 | 5% |
| `.rodata` | 52,134 | 4% |

The interpreter itself is a tenth of the module; two thirds is JSON.
The IR (`ir::Program`) and the schema arrive as `GET /schema` JSON and
every call's arguments and answers are JSON, so serde's derived visitors
for every IR node and every wire struct are compiled in, and
`serde_json::Value` with `to_value`/`from_value` beside them.

Candidates, in the order to try, each measured before the next:

1. **One wire form for the backend, decoded by hand.** Decode the
   backend through `serde_json::Value` once and build the IR with a
   small hand-written walker, dropping `#[derive(Deserialize)]` from
   the IR and schema types on the device (keep it on the server behind
   the `sqlite` feature). Removes most of serde_core's visitors and their
   `alloc` instantiations. Expected: the largest single win.
2. **Answers as text, not `Value`.** The dispatcher builds answers with
   `json!` and `to_value`; write them with a small JSON writer over the
   value model (`wire::to_json` already exists) and drop `to_value`.
3. **Fewer `format!` sites.** Error messages through `format!` pull
   `core::fmt`; a device's refusals could carry static codes with the
   message built on the JavaScript side from the code.
4. **`serde_json` without `std`** (`alloc` feature only) once nothing
   needs `std` readers; small.
5. **`-Z build-std` with `panic_immediate_abort`** would remove the
   panic machinery, but needs nightly; not on the pinned toolchain.

Not candidates: `opt-level = "z"`, fat LTO, one codegen unit, `panic =
"abort"`, `wasm-opt -Os` — already in the `wasm` profile. `wasm-opt -Oz`
inflates the gzip (measured; the script keeps the smaller).

Done when: the gzip is under 150 KB with every device scenario green on
both stores (`cargo test -p snapback4-device`), the Chromium witnesses
green, and the number in the journal.

## 2026-09-16 planning follow-up

Main was fast-forwarded to `18c8f5daf` before source/design inspection.
The earlier diet lane recorded 454,735 → 402,428 → 394,126 gzip bytes;
its final notes survive at `2944f6ffe`. The 60,609-byte apparent saving
was rejected: integration reverted the reply writer in `1e9944cb4` and
the backend decoder in `e429dc724`. The commissioning request identifies
a real acquisition regression. This planning pass verified the reverts,
but did not independently reproduce or isolate that regression.

The linked Draft research plan recommends a compact backend image, one
typed command/value codec and typed durable records, keeping the shared
Rust interpreter initially. It requires actual acquisition and offline
reopen at the first end-to-end slice, with the complete artifact and host
costs counted. A shared compact execution representation is a later
decision if measured codec removal still cannot fit. The experiments do
not establish that replacing interpreter semantics is necessary.

The target remains strictly below 150,000 gzip bytes under the plan's
conservative decimal interpretation. Both-store semantics, browser
durability, retained history and outbox custody must survive. The ticket
remains open; the plan supplies no new size result or implemented fix.
