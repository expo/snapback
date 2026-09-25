# Pre-slot device compatibility witness

`device.wasm.gz` is the actual Lane U round-1 wasm artifact retained by its
Chromium acquisition harness, before event slots. Uncompressed: 1,776,336 bytes,
SHA-256 `157158ee62a2442cfbc9fedb9848f0b6939cd3da58b493d2d55bc7374401e02c`.
The digest is independently recorded in
`reports/20260925-bounded-following-r1/inventory.json` and the round-0 Z inventory.
It recognizes `timeline-v2` but not `timeline-event-slots`. It uses the same
wasm-bindgen WebDevice ABI as the current device; the test copies the current
glue into an isolated module and initializes that module with these old bytes.

`backend.json` is a genuine pre-slot `/schema` response compiled from the
adjacent `schema.q` by the published 0.4.1 Linux binary (SHA-256
`9549fd7314bfc9dca3f24405d527bdc7c7c95f9af7eb3d04aca74d1784b6e9fe`).
It is not a modern schema with the capability removed. This is the successful
installation/adoption control and the prior persisted state for refusal tests.
