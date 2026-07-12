# ENG-24189 Phase 0 — All Aboard macOS-native evidence

This directory preserves the macOS-native half of the LLP 0052 Phase 0
update-economy reproduction. It is evidence, not a benchmark claim across
machines, and the wall-clock arms below were captured sequentially rather than
as randomized cold launches.

## Provenance

- Snapback product checkout: `6f18648654d27dab1220fd9358380816d840975d`.
- Initial Exact renderer/counter checkout: `2b1bd500fca36370ccbe80d32c2a6df1baed6e93`.
- D3 closure recheck: Exact `928b1bd60` (the integrated ENG-24188 branch,
  including the unchanged-pager descriptor cache), using the same prebuilt
  ExactAppMac host binary. No native rebuild was needed because the closure was
  in the served JS renderer.
- Host: ExactAppMac/AppKit/Hermes on macOS 26.5.2, with
  `EXACT_RUNTIME_THREAD=1` and `EXACT_PRECOMPUTED_FIRST_FRAME=0`.
- Snapback backend and Vite/native relay were isolated on non-default loopback
  ports. The product tree was backed by the real in-memory All Aboard backend.
- The measurement-only overlay selected the four app arms at runtime and
  installed Exact's development reporter. It is not part of the product
  implementation.

The web report used Snapback `8c289e1`; this native capture used `6f18648`.
Those revisions are not byte-identical: `8c289e1` adds the lazy web probe and
changes the acceptance runner. The product UI inputs (`app.contract`, `data.ts`,
`native.ts`, and route modules) are unchanged, but these native numbers should
still be described as the same representative product tree, not as a strictly
paired run of the same harness revision.

## Native 2×2 app-mitigation matrix

Each arm settled for 2 seconds, then sampled a 10-second steady-state window.
Renderer D3/D4 flags were disabled for this matrix so the two application
mitigations could be isolated.

| Arm | Waves / commits | Recomputes | Effect runs | Skipped effects | Signal writes | Element attempts (equal) | Text attempts (equal) | Protocol ops / bytes | Layouts | Commit time |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pre | 10 / 10 | 170 | 4,410 | 220 | 400 | 2,800 (2,800) | 1,420 (1,420) | 1,440 / 30,630 | 10 | 23.97 ms |
| clock-only | 2 / 2 | 34 | 882 | 44 | 80 | 560 (560) | 284 (284) | 288 / 6,126 | 2 | 3.70 ms |
| palette-only | 8 / 8 | 136 | 2,208 | 1,496 | 320 | 920 (920) | 1,136 (1,136) | 1,152 / 24,504 | 8 | 19.01 ms |
| current | 3 / 3 | 51 | 828 | 561 | 120 | 345 (345) | 426 (426) | 432 / 9,189 | 3 | 11.07 ms |

The useful decomposition is per commit as well as per wall-clock window:

- The clock quantization reduces commit frequency. In this sequential window,
  current versus pre reduced commits, recomputes, text attempts, protocol ops,
  protocol bytes, and layout requests by 70%.
- The palette singleton reduced native element attempts from 280 to 115 per
  commit (58.9%) in the initial tree. Native element attempts were already
  value-equal and encoder-no-op; this measures avoided JS-side renderer work,
  not previously emitted element opcodes.
- Combining both mitigations reduced effect runs by 81.2% and element attempts
  by 87.7% over the sampled window. The exact commit count is phase-sensitive,
  so the raw values and per-commit interpretation are more durable than a single
  headline ratio.
- With D3 disabled, every re-fired raw-text binding still emitted. The pre arm
  therefore produced 142 equal text writes, 144 protocol ops, and one layout
  request per commit.

The raw before/after snapshots for all four arms are in
`native-matrix.json`.

## D3 and the zero-protocol gate

The first D3-on capture at Exact `2b1bd500` skipped all 142 same-text writes in
each of three current-arm commits and reported no layout request, but it still
reported exactly one protocol op and 53 bytes per commit. The live protocol tap
decoded that residual as:

- `SetPagerBindings` (`0x23`) on root/view 0;
- 38 payload bytes: a two-byte count plus two 18-byte binding descriptors;
- 53 wire bytes: an 8-byte v2 buffer header, 7-byte op header, and 38-byte
  payload.

That was not commit framing. It was a real, complete pager-binding snapshot that
the host parsed even though the descriptors were unchanged. The pre-fix files
are preserved as `native-current-d3-on-before-pager-cache.json` and
`native-current-d3-protocol-tap-before-pager-cache.json`.

Exact `928b1bd60` caches the last pager descriptor set and skips only unchanged
snapshots while retaining LLP 0336's required zero-count detach-before-destroy
signal. Rechecking the current arm for 12 seconds on the same native host gave
three commits with:

- 336/336 value-equal element attempts (112 per commit; already encoder-no-op);
- 414/414 same-text writes skipped (138 per commit on the integrated tree);
- **0 protocol ops, 0 protocol bytes, and 0 layout requests**;
- an armed protocol tap whose high-water sequence remained zero.

The canonical `native-current-d3-on.json` and
`native-current-d3-protocol-tap.json` contain that post-fix result. LLP 0052's
D3 gate does not need a framing exclusion; the real redundant opcode was fixed.

## Acto snapshot

The source-pinned native entry initially lacked Exact's app-agent bootstrap.
After binding that seam, the direct agent server and Vite relay produced one
bundled tree + annotated screenshot + diagnostics observation:

- snapshot ID `s_1783802532412_34`, root 0;
- 528 native host nodes in the rendered All Aboard board;
- annotated capture at 684×557;
- 65 diagnostics: 36 `clipped` warnings and 29
  `scrollContentClipped` infos. Inspection showed these are predominantly
  deliberately offscreen pager siblings and list content, not a blank or
  zero-sized root.

See `snapshot.json` and `snapshot-annotated.png`.

## Time Profiler and thread conclusion

A 20-second Instruments Time Profiler recording completed, but the window was
polluted by a long agent reporter evaluation. It is not valid evidence for a
percentage breakdown of protocol apply, text remeasurement, or layout. It does
provide a qualitative thread receipt: sampled JS/Hermes work ran on
`com.exact.runtime` through `ExactDedicatedRuntimeExecutor.runLoop`, while the
main thread was in the AppKit run loop. This confirms the configured dedicated
runtime thread, but it does not locate the short steady-state kernel/apply work
with enough resolution to make a stronger attribution claim.

The `.trace` directory is intentionally not committed. The attachable archive
is named `all-aboard-pre-time-profiler.trace.zip`:

- size: 3,535,995 bytes (source `.trace` directory: approximately 20 MiB);
- SHA-256: `35ff59f2470ff6233ad9576d3c467cbf6de010949b1e80ab2961a55536452796`.

A future attribution trace should use native signposts around protocol parse,
text measure, layout, and presenter apply and avoid `run-js` during the window.

## Physical-device caveat

`Charlie’s iPhone XS Max (2)` was listed as unavailable/offline before and after
the run, so no physical-iPhone claim is made here. A booted iPhone simulator was
present, but this capture deliberately records only the requested macOS-native
evidence. Physical iPhone behavior remains to be rechecked when the device is
available.

### Later physical-device attempt (2026-07-11)

The same named device later appeared locally as a paired iPhone 17 Pro Max on
iOS 26.5.2 with Developer Mode enabled. Against source-pinned Exact
`1debc7156`, the Debug `ExactApp` host built and signed successfully,
`com.exact.ExactApp` installed, and a UIKit/Hermes source envelope launch reached
native runtime creation and connected the iOS target. The device then locked;
the host denied a clean relaunch, so the attempt stopped there.

That receipt proves build, signing, installation, runtime creation, and target
connection only. It does **not** prove a rendered All Aboard tree, screenshot,
user-visible correctness, D1–D5 counters, frame timing, or kernel/thread-stage
attribution on physical iPhone hardware. Those claims remain open until an
unlocked-device run can capture them directly (ENG-24221).

## Artifact checksums

| File | SHA-256 |
|---|---|
| `native-matrix.json` | `ebd7ca49671da07067313e4da5b2f6a7dddd934b889505d39dbc23868ee5c5d2` |
| `native-current-d3-on.json` | `aac60eb7fa3c7a90f6abdba92b40cd22463e9659e6d427fe8887558372f6cb65` |
| `native-current-d3-on-before-pager-cache.json` | `158ce190c4ae1a46b543cc0e6f2d9abdafa35d8cf3ba4489e7f2d550102eaf29` |
| `native-current-d3-protocol-tap.json` | `f6865ab870f83df3587fae207f241fa79349c16b1858b56cf145addea74bb57b` |
| `native-current-d3-protocol-tap-before-pager-cache.json` | `894626008bd250b8668e9eb4d3559281a5143a4698d4c9b141af17966ddc5952` |
| `snapshot.json` | `8a932dff53ac698381de87bc1c9c53dc4651f4098c5963bb01c99a9366a64034` |
| `snapshot-annotated.png` | `807f46a8cd1cf9da5e72969611c2f503fd917b41c02d72159b3a2c992e84331a` |
