# Attempt 1 (Astra builder, snapback4@0.2.12) — aborted at M1 on a packet defect

Started 2026-09-14 17:30:40 UTC, ended 17:43:37 UTC (777 s, exit 0).

The frozen choreography (`instrument/choreography/setup-identity.mjs`,
`startup.test.mjs`) and `instrument/metering/manifest.mjs` import
`../../lib/json-schema.mjs`. The prompt tells the builder to copy
`instrument/choreography` into the lane, and from
`lanes/astra-snapback4/choreography/` that import resolves to `lanes/lib/`,
which the packet did not provide. The 0.2.9 Astra builder
(`~/clique-sb4-20260914-astra-0.2.9`, run-log epoch 1789372051) supplied a
bridge itself and recorded it as environment. So did the 0.2.10 Astra
builder (`~/clique-sb4-20260913-relaxed-3models`, epoch 1789385143). This
builder instead recorded M1 `aborted` (attribution=environment; its suite
had passed with complete coverage) and blocked M2–M8. That was a lawful
reading of "record the exact instrument skip", and it measures the packet,
not the backend. The attempt is kept here unscored.

Packet fix before attempt 2: `lanes/lib/json-schema.mjs` is a byte copy of
the packet's own `lib/json-schema.mjs` (same sha256, below). The frozen
import now resolves as the instrument intends. No check, prompt, template or
instrument file changed; the lane was restored cold, and the builder is not
steered.
7b882f6147e6efde88bc41f4dbc6806e712fb54c2e1b47a214a5d59e96f02660  lib/json-schema.mjs
