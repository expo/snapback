# Snapback 4: the device wasm is not byte-reproducible across macOS publication hosts

- **Status:** Open
- **Date:** 2026-09-29
- **Area:** `snapback4/scripts/build-wasm.sh`, the client package's `dist/wasm/snapback4_device_bg.wasm`, `snapback4/scripts/publish.mjs --prepare-client`
- **Found by:** the 0.4.8 publication, when qualification moved from the office M1 to the black M5 at the same release commit (7a056f2fee)

Preparing the client at the same commit, with the same user and the same worktree path (`/Users/ccheever/projects/snapback-pub-048`), produced different tarballs: the M1's `snapback4-0.4.8.tgz` hashed `4db93c51…`, the M5's `00aeda90…`. The only differing file among 205 is `package/dist/wasm/snapback4_device_bg.wasm` (M1 `d4851792…`, M5 `58ec25a4…`). The Linux qualification receipt binds the client's integrity, so a Darwin dry run on another host cannot reuse a Linux receipt produced from a different host's client; 0.4.8 re-ran Linux qualification against the M5's client.

Find the source of the difference (toolchain or wasm-bindgen versions, LLVM, embedded paths, build-order or codegen-unit nondeterminism, `CARGO_INCREMENTAL`, or host CPU features) and make the wasm build reproducible across the publication hosts: pin what must be pinned, set `-C codegen-units=1` or equivalent determinism flags if needed, and add a check that two clean builds of the same commit produce identical wasm bytes. Until then, a publication must prepare its client and qualify Linux against it on the same Darwin host that runs the dry run and finish.
