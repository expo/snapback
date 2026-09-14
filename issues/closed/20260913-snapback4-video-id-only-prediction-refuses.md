# Snapback 4: video `{ id }` argument is refused by local prediction before the server

Status: Closed
Priority: P1
Date: 2026-09-13
Systems: local client, device prediction, asset arguments
Observed version: published `snapback4@0.2.6`
Code trace baseline: delivery `cbef8dbf0d85f2ec6b340be13cb4778e3b27a518`
Evidence status: received builder reproduction; independent grade pending

## Problem and reproduction

The documented asset call shape is to upload bytes, then pass `{ id }` in the
mutation. A mutation is allowed to read the facts that the server established,
including `clip.duration`. In the active Astra Clique M4 run, the local client
instead refused an id-only video mutation during device prediction with
`E_FIELD: missing field duration`; no mutation HTTP request was made. Passing
the complete asset object returned by upload allowed the same operation to be
sent and rendered successfully.

The reduced program shape is:

```quarry
mutation sendClip(clip: video <=50000000):
  duration = clip.duration
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else TOO_LONG
  return insert clips { clip }
```

After a successful video upload, call the local client's mutation with
`{ clip: { id: uploaded.asset.id } }`. The current result is an immediate
failed write carrying `E_FIELD`, even though the server accepts that documented
shape and resolves the upload facts by id.

This is P1 because the paved asset API fails before the authoritative server is
consulted and blocks ordinary video mutations on the local client. Supplying
all returned facts is a workaround, but it contradicts the documented `{ id }`
placement form and is not an authority boundary the predictor may rely on.

## Root cause

Confidence: **high from the received differential reproduction plus static
code trace; not independently reproduced or graded yet.**

The server's mutation path in
[engine/mod.rs](../../snapback4/crates/snapback4-core/src/engine/mod.rs) replaces
each image/video argument that names the caller's upload with
`asset.column_value()` from the authoritative asset record before Quarry runs.
The device path in
[engine/local.rs](../../snapback4/crates/snapback4-core/src/engine/local.rs) and
[device/predictions.rs](../../snapback4/crates/snapback4-device/src/device/predictions.rs)
runs the same program over the submitted argument without access to that server
asset record. Reading `.duration` from `{ id }` therefore produces `E_FIELD`.

[Device::admit](../../snapback4/crates/snapback4-device/src/device.rs) degrades
`RuntimeError::Prediction` to a durable, unpredicted outbox entry, but propagates
other errors from prediction. The `E_FIELD` consequently escapes admission and
the local client returns a terminal failure before its normal HTTP flush can
let the server judge the mutation.

The successful full-object workaround does not make caller-provided `type`,
`bytes`, dimensions, or duration authoritative. Those values can be forged or
stale; the server must continue to replace them from the upload record.

## Retained evidence

The files are retained outside the repository under
`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/`:

- `m4-video-probe.log` — id-only local mutation reports `E_FIELD: missing field duration`; SHA-256 `6768711c9744ec7f5afb9b0527f9fbf7dcf0549d2f8a367c68dd0047572dc6e3`
- `m4-field-why.txt` — published diagnostic expansion for `E_FIELD`; SHA-256 `e32e885395a949bce0ce932b6266b7c7ca3486c8b2e3f32639ec9dc5c576f67c`
- `m4-video-probe2.log` — full upload-facts workaround is sent and the video message renders; SHA-256 `a675b5a1274dcd0789986bb985e9036846eb3a91c1eb97c2e30957e1112a68ac`

This ticket records the builder's reproduction. No independent Snapback test or
benchmark grade has been run for this report, and the active benchmark lane,
instrument, prompt, and package pins were not changed.

## Second builder corroboration

The Muse lane on the same published pins later exhibited the same signature:
its upload response contained `duration=5000`, but the id-only video send
reported `E_FIELD` before any `/m/sendVideo` request appeared in a complete
POST trace. Its application workaround retains the uploaded duration in the
clip argument. The [public-evidence audit](../../benchmarks/runs/2026-09-13-snapback4-clique-0004/muse-m4-compact-video-provisional-attribution.md)
retains event and source hashes, including the failed interception excluded
from attribution and the truncated duration-hint response.

This is a second builder trace, not an independent auditor reproduction or
benchmark grade. The audit covers a fixed prefix of the then-active log and
does not certify the subsequent acceptance rerun. It corroborates the existing
issue without changing the benchmark's instrument, prompts, or package pins.

## Acceptance

- After a successful upload, an image/video mutation receiving the documented
  `{ id }` argument is durably admitted by the local client and reaches the
  server even when its Quarry program reads authoritative media facts such as
  `duration`, `width`, `height`, `bytes`, or `type`.
- A device that does not hold authenticated upload facts skips or safely
  degrades prediction instead of turning a missing fact into a terminal input
  refusal. The queued write retains its client-minted id and normal retry
  behavior.
- The server remains the authority for ownership, kind, size, dimensions,
  duration, placement, and the facts visible to Quarry. Extra fields supplied
  by application code cannot change the authoritative result or bypass
  `E_ASSET_UNKNOWN`, `E_ASSET_TYPE`, `E_ASSET_TOO_LARGE`,
  `E_ASSET_BOUNDS`, or `E_ASSET_PLACED`.
- `{ id }` and a full upload response produce the same authoritative mutation
  result. An unknown or unauthorized id is judged by the server as an asset
  refusal rather than being preempted by device `E_FIELD`.
- Focused regressions cover the id-only video program above and an image fact
  read on both device stores used by the JavaScript client: the browser wasm
  memory store and the native SQLite store. Both preserve the same admission,
  prediction fallback, HTTP submission, and eventual settlement behavior.
- Reopening or going offline after upload must not require trusting arbitrary
  caller facts: if authoritative asset metadata is unavailable locally, the
  mutation remains durable and unpredicted until the server can judge it.

## Relevant contract and implementation

- [package README assets section](../../snapback4/packages/snapback4/README.md)
  documents upload followed by `{ id }` and server-established facts.
- [language assets card](../../snapback4/crates/snapback4-lang/src/guide.rs)
  uses `.duration` while instructing clients to pass `{ id }`.
- [client contract](../../snapback4/packages/snapback4/src/contract.ts) states
  that `{ id }` is sufficient for row placement.
- [server mutation enrichment](../../snapback4/crates/snapback4-core/src/engine/mod.rs)
- [device local prediction](../../snapback4/crates/snapback4-core/src/engine/local.rs)
- [device admission and prediction replay](../../snapback4/crates/snapback4-device/src/device.rs)

## Resolution — 2026-09-13 (Lane C, LLP 3000.007 §8.4)

The local client records the authenticated `POST /assets` reply on its device,
under the uploader's principal and asset id. Prediction and durable outbox
replay replace image/video arguments from that receipt before Quarry runs,
including after an offline reopen. Without a receipt, admission keeps the
write durable and unpredicted for the server to judge; arbitrary argument facts
and another principal's receipts never supply prediction authority. The server
continues to enforce ownership, kind, size, placement and authoritative facts.

The device suite covers id-only image and video arguments, forged fact fields,
missing and foreign receipts, and reopened SQLite and memory stores. The live
process-client regression uploads a 60-byte MP4, reopens offline, predicts its
id-only mutation with duration 1,000 ms, reconnects, and requires `sent.result`
to equal the server's upload facts. Its ordinary bytes also survive a second
offline reopen. Targeted device tests: 21 passed, 0 failed; live client seams:
4 passed, 0 failed.
