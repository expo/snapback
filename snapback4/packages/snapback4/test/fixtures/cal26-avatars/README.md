# Calibration #26 avatar reproduction

The seven `.q` files are byte-for-byte copies of
`~/sb4-intent/cal26-app/snapback/` supplied for lane AV on 2026-09-29.
They are test data, including the application's unrelated operations: keeping
the full program preserves the generated read, residency and authorization
context. No test-only query, rule or mutation was added.

`../cal26-avatar.png` copies the benchmark's 729-byte
`benchmarks/fixtures/social-messenger/media/avatar-alice.png`, which the
builder's `scripts/seed.mjs` uploads for Alice and Carol. The fixture uploads
fresh copies and places them through `placeAvatar`; it never seeds fake asset
facts or bypasses placement authority.

`asset-avatars.test.mjs` uses the package's built public entry points, real HTTP
and real React in Chromium. The online and wasm clients use `createApp`;
the process client uses `createLocalClient`/`SnapbackProvider`, with only the
device JSON transport bridged from Chromium to the actual Node `processDevice`.
It does not fabricate browser admission capabilities for the process host.

For the published-package control, set `AV_CLIENT_DIR` to the unpacked
`snapback4@0.4.8/dist` directory and `SNAPBACK4_BIN` to the unpacked
`snapback4-linux-x64@0.4.8/snapback4` binary. The report records tarball hashes,
source hashes, the frozen application witness, and the non-reproduction of the
grader's permanent-loading claim.
