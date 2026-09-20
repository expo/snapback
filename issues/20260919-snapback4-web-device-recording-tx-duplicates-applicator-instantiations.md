# Snapback 4: the web device instantiates every transaction-generic applicator function twice since Repair B

**Priority:** P3
**Status:** Open
**Date:** 2026-09-19
**Scope:** `snapback4/crates/snapback4-device/src/device/deferred/recording.rs`, the `fn …<T: DeviceTx>` applicator functions it is passed through (`deferred::events_recording`, `history::events`, `media::remember`, `media::leave`, `device::leave`, `Boundaries::marker`, `Boundaries::save`, …); the wasm size ratchet (`metrics/wasm-budget.json`)

Repair B (`201c45d245`, LLP 3000.001 #reliability-catchup) raised the wasm
budget from 411,000 to 434,000 B gzip — measured 433,908, the largest single
raise since the ratchet exists. Attributing the artifact before (`87aaae52cc`,
410,426) and after (hash-stripped twiggy symbols, code and data only):

| Where the +104,001 raw bytes went | raw B |
| --- | ---: |
| `device::deferred` (new: deferred publication, the recording transaction) | +35,648 |
| `device::predictions` (replay capture) | +13,212 |
| `device` (`apply_publication_inner`, `sync_state_inner`, `open_store_mode`) | +11,842 |
| B-tree instantiations over new key and value types | +11,799 |
| serde for three new types (`ReceiptStore`, `deferred::RowEffect`, `predictions::Capture`) and other | +9,351 |
| `store_identity`, `media`, `boundary`, `history`, `opening` | +12,995 |

Most of it is a new subsystem and costs what a subsystem costs; the family and
absence checks pass at that commit, so nothing accidental of the serde or
table classes came in. One part is recoverable: `Recording<'_, T>` implements
`DeviceTx` by delegating to the real transaction, so every applicator function
generic over `T: DeviceTx` is now instantiated twice on the web — once for
`MemoryTx` and once for `Recording<MemoryTx>` — with identical bodies.
Forty-four symbols are instantiated over `Recording<..>` (22,476 raw B), and
22 of them have an identical-signature `MemoryTx` twin (18,244 raw B of
overlap). Duplicated code compresses at about 0.15, so the recoverable gzip is
roughly 3,000–5,000 B, under a fifth of the raise.

Fix, when a lane is in that code anyway: route the applicator path through one
instantiation — either always through the recording transaction, or through
`&dyn DeviceTx` for the functions the recorder wraps — and measure. Not worth a
lane of its own. Evidence: `~/projects/snapback-dm-20260917/measure/rb-*.top.json`
and the attribution script in that directory's history (LLP 3000.002).
