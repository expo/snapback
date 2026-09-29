# Snapback 4: the device wasm is not byte-reproducible across macOS publication hosts

- **Status:** Open
- **Date:** 2026-09-29
- **Area:** `snapback4/scripts/build-wasm.sh`, the client package's `dist/wasm/snapback4_device_bg.wasm`, `snapback4/scripts/publish.mjs --prepare-client`
- **Found by:** the 0.4.8 publication, when qualification moved from the office M1 to the black M5 at the same release commit (7a056f2fee)

Preparing the client at the same commit, with the same user and the same worktree path (`/Users/ccheever/projects/snapback-pub-048`), produced different tarballs: the M1's `snapback4-0.4.8.tgz` hashed `4db93c51…`, the M5's `00aeda90…`. The only differing file among 205 is `package/dist/wasm/snapback4_device_bg.wasm` (M1 `d4851792…`, M5 `58ec25a4…`). The Linux qualification receipt binds the client's integrity, so a Darwin dry run on another host cannot reuse a Linux receipt produced from a different host's client; 0.4.8 re-ran Linux qualification against the M5's client.

Find the source of the difference (toolchain or wasm-bindgen versions, LLVM, embedded paths, build-order or codegen-unit nondeterminism, `CARGO_INCREMENTAL`, or host CPU features) and make the wasm build reproducible across the publication hosts: pin what must be pinned, set `-C codegen-units=1` or equivalent determinism flags if needed, and add a check that two clean builds of the same commit produce identical wasm bytes. Until then, a publication must prepare its client and qualify Linux against it on the same Darwin host that runs the dry run and finish.

## HV round 4 evidence (2026-09-29)

The merged HV/WD artifact now fits with portable binaryen 132.0.0 pinned in the
workspace lockfile and invoked from node_modules. This does **not** close this
issue: identical input optimizes identically across Linux/macOS, but upstream
Rust output differs. With Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1:

- Linux Cargo wasm: 2,518,352 B, SHA-256
  `61b5e994565f50db71b8d4dfae4c95be6f58a4bb829af8009e22d33c958e5265`.
- Mac Cargo wasm: 2,518,632 B, SHA-256
  `14a9796c0dfd1989ea1dd94c5bba5ece70bb791cb69a792f48f516a223239d8a`.
- Final Linux: 1,978,828 B, hash `5740f90a…`; GNU gzip 593,295 B.
- Final Mac: 1,979,135 B, hash `549de290…`; Apple gzip 593,652 B.
- Optimizing the Linux wasm-bindgen input on the Mac gives exact `5740f90a…`;
  Apple's gzip prices that same artifact at 593,714 B. Compression implementation
  is another input to the size claim (the fixed cap is 593,719 B).
- Rust data sections embed host-specific Cargo and toolchain paths. Remapping
  sysroot, Cargo home and workspace removes those paths, but outputs still differ:
  Linux 1,977,628 B / 593,198 B gzip; Mac 1,977,967 B / 593,617 B gzip. Discarded.
- The wasm-bindgen 0.2.127 installations have different walrus dependency versions:
  Linux 0.26.4 versus Mac 0.26.5. Binding/optimizing the same Mac Cargo input on
  Linux differs from the Mac final artifact only in that producer-version byte.
  This isolates that downstream difference, not all upstream codegen differences.

Both hosts repeat identically; no full cross-host byte identity is claimed.
All source, toolchain and artifact bindings, remote scripts and logs are in
[HV round 4](../snapback4/reports/20260929-hv-heavy-acquisition/round4/REPORT.md).
The existing single-preparation publication rule above still applies.
