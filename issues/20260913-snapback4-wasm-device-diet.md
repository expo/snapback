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

## 2026-09-17 plan rewrite, from a build

The linked plan was rewritten the next day after building and attributing
the current artifact, which the first plan had not done. Today's module is
1,891,742 B raw / 520,557 B gzip (it was 454,735 three days earlier). A
fresh `twiggy` attribution puts serde at 41% of the code, not two thirds;
`BTreeMap` monomorphization at 505,002 B raw in roughly 960 generic items,
which no earlier candidate list names; and the NFC tables at 60,005 B gzip.
A no-codec probe — every typed serde entry point in the device crate made an
opaque import — still weighs 384,443 B gzip, so codec replacement alone
cannot reach the target. Routing the device's typed JSON through one serde
family saves 61,680 B gzip for about fifteen lines, more than the rejected
handwritten decoder did.

The plan is now a measured ladder: instrument and a reported budget (S0),
one serde family (S1), small ordered maps (S2), host Unicode folding on the
web (S3, needs a ruling), a derive-driven compact codec in three parts (S4),
reachability (S5), then the author's decision with numbers (S6). Its own
estimates end near 180,000, above this ticket's target, and it says so. The
scratch builds are measurements, not landed changes. This ticket stays open.

## 2026-09-17 first rungs landed

S0 and S1 of the ladder are on main. One text serde family in each direction
takes the web device from 520,557 to 461,533 B gzip alone (raw 1,891,742 →
1,573,446) with canonical bytes, duplicate-field refusal and error positions
unchanged; decode-and-apply and a 100,000-row cold open are unchanged in paired
native runs, and Chromium acquisition, fresh-realm IndexedDB reopen and the
scale witness pass. The tree as landed is 466,171 B, because the retained-read
composition landed first and costs about 4,600. `scripts/attribute-wasm.mjs`
prints the attribution and fails on a second serde family;
`metrics/wasm-budget.json` (467,000) is reported by every suite run.

S2's first cut saved 35,525, not the estimated 100,000 — duplicated B-tree code
compresses at about 0.15 — and both review families found conversions sized by
data that turned metered linear passes into unmetered quadratic ones. Narrowed
to compiled structures only it saves 19,897 alone, and the lead shelved it:
under 4% does not justify a custom container in the core's public types. The
candidate is kept on branch `sb4/diet-maps`. A scratch build says the next
rung, keeping server-only engine code out of the web build, is worth 26,315. The plan's
restated ladder ends near 300,000 B gzip, twice this ticket's target: the
executor and device logic alone are about 130,000. The plan now says plainly
that 150,000 needs a compact shared execution representation or a web device
that does less. This ticket stays open.

## 2026-09-17 reachability landed; `main` is 16,000 over where it was

S5 keeps server-only engine code out of the web device: the prefetch planner
(−6,931 B gzip), partition-log event construction (−1,243; the meter charges
and fallible scans of deriving them stay) and the structural admission check
(−13,480; the web device now trusts the compiler's and server's check, stated
on the cards and in the README). 466,618 → 444,964 at its base.

The tree it landed on is larger than that: in the eighty minutes between the
two diet landings `main` grew from 466,618 to 505,030, and S5 lands at
482,965. One attribute accounts for 33,460 of the growth —
`#[serde(untagged)]` on `ir::LaneSource`, which makes serde buffer the input
and instantiate every reachable IR reader a second time. `attribute-wasm.mjs
--check-families` fails on it, so `measure-wasm.sh` is red on `main` and this
landing records no measurement line. A repair lane is commissioned (decode
the enum without buffering, same wire shape; refuse the content-reader
representations in the suite's source census). The budget is 483,000,
report-only. This ticket stays open.

## 2026-09-17 the content reader is out again; the next rung is sized

S1b landed: `ir::LaneSource` decodes by streaming with its wire bytes
unchanged, and the web device is 451,283 B gzip (from 482,965).
`attribute-wasm.mjs --check-families` and `measure-wasm.sh` are green on
`main` again, and the suite's source census now refuses the serde
representations that select the content reader, so this class of regression
fails a landing. S4a (the backend image) was sized by two scratch probes —
ceiling 377,414, with a stand-in compact decoder 402,463 — at about −45,000,
and is commissioned. With S3 (host NFC, −58,832, awaiting the author's
ruling) the ladder's measured rungs would put the device near 347,000; the
target of 150,000 still needs the S6 decision. This ticket stays open.

## 2026-09-17 the backend image measured and stopped; the ladder is walked

S4a's own probe — the web device opening from a compact backend image, JSON
path compiled out — measured 451,283 → 416,502 B gzip: 34,781, under the
plan's 36,000 stop rule, so the lane stopped before host integration and the
lead let the rule stand. The tested codec and the probe are on branch
`sb4/diet-s4a`. Every rung that needs no ruling has now been built and
measured: `main` is 451,283 (from 520,557, and from 505,030 this morning).
S3 (host NFC) is rebuilt on today's tree at 392,551 and waits for the
author. With S3 ruled in, and S4a and S2 revived, the device would be near
338,000. The
ticket's 150,000 needs the S6 decision: a compact shared execution
representation, or a web device that does less. This ticket stays open for
that decision.

## 2026-09-18 rulings: S3 landed, the budget is a ratchet, the target is re-set

S3 landed on the author's ruling — NFC only from the browser, guarded at
open — and the device is 409,620 B gzip (from 520,557 when this ticket was
filed). `scripts/build-wasm.sh` now fails above `metrics/wasm-budget.json`
(410,000); a landing that needs bytes raises it in the same commit with the
reason. The 150,000 target is retired as a finding: no representation work
reaches it, and the S6 decision is deferred. This ticket stays open as the
ratchet's home and for S6; S2 (−19,897) and S4a (−34,781) wait on branches.

## 2026-09-18 Repair B lane, round 12 delta recorded in round 13

The round-12 device is 488,235 B gzip, **+658 B** over round 11's
487,577 B. Round 13's full blocking-suite build reproduces 1,686,925 B raw /
488,235 B gzip. That measurement predates the S3 landing and the ratchet
above; against the 410,000 B budget now enforced by `scripts/build-wasm.sh`
the lane's tree is over, and it must be re-measured on the integrated tree
before any publication. Round 13 changes test fixtures only;
this records the lane's existing growth, without changing the budget or
claiming size qualification. The full build output is retained in
`snapback4/target/review-fix13/full-suite.log`. This ticket remains open.


## 2026-09-18 Repair B integration, round 2

The merge of main `04def4945` and lane `456782dbb` starts at 436,594 B gzip,
26,135 B above the measured main parent (410,459). Ordered source ablations
attribute 10,824 B to deferred fold/record/install, 6,889 B to capture/declaration,
1,654 B to private restore observation/evidence, 1,218 B to wasm opening and
checked kept-backend installation, and 5,550 B to the remaining shared
publication/lifecycle/wire/outbox integration. These are order-dependent
compression/reachability measurements, with a stated residual; TypeScript
opening code itself adds no wasm bytes.

Combining the recording maps and avoiding unnecessary collection sorting save
2,654 B against the correctness-fixed tree. The final build is 433,908 B gzip,
22,908 B over the unchanged 411,000 budget, and 23,449 B above the main parent.
A shared trait-object applicator compressed 2,640 B worse and was reverted.
The serde-family and forbidden-code census passes. The remaining lane delta
would spend 21.3% of the diet's 110,098 B recovered on this main parent. No
ratchet increase is authorized or made by this integration.

The [integration report](../snapback4/reports/20260918-repair-b-integration-r2.md)
records the probe method, exact artifacts and command output locations. This
ticket remains open for the author's budget decision and S6.
