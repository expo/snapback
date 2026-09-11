# Snapback 2 changed-binary doctor qualification

This run tests the remaining acceptance clause in
[`issues/20260907-snapback2-loop-budget-overruns-in-parallel-papercut-lane.md`](../../../issues/20260907-snapback2-loop-budget-overruns-in-parallel-papercut-lane.md):
two fresh changed release binaries must each complete their first external
`snapback2 doctor --json` launch in at most 0.5 seconds. No first observation
was discarded or used as a prewarm.

## Result

**Not qualified.** The two changed-binary first launches were **0.680638 s**
and **0.525602 s**. Their immediately adjacent second launches were
0.048704 s and 0.049517 s. The doctor's own reports attribute only 55.114 ms
and 50.571 ms to work after process entry, respectively.

Both release products were built serially from
`1b5f14394a30ed8355903a1a5b69ccde4ffc9946` with distinct Rust metadata so
the second build could not reuse the first product bytes:

```text
RUSTFLAGS='-C metadata=loop_budget_control_one' cargo build -q --release -p snapback2 -p snapback2-media
RUSTFLAGS='-C metadata=loop_budget_control_two' cargo build -q --release -p snapback2 -p snapback2-media
```

Before each first launch, inspection was limited to `shasum`, `stat`,
`codesign -dv`, `xattr`, process inventory, and load average; none executes
the product. The first launches used the same compiler/guide/template/test
runner environment as `scripts/measure.mjs`. The machine was the fleet-listed
local M1 Max (`Charlie’s MacBook Pro (2)`, ten logical CPUs), macOS 26.6
(25G72), Node 26.7.0, and Rust/Cargo 1.97.0. The one-minute load average was
8.48 before sample 1 and 9.98 before sample 2, with no Cargo, rustc,
`measure.mjs`, or doctor process active.

## Attribution

Both products were linker ad-hoc signed, carried `com.apple.provenance`, and
received a new inode and identifier. For sample 2, macOS unified logging shows
a 183 ms notarization network transaction followed by XProtect/Gatekeeper
analysis; `GK evaluateScanResult` arrived 0.459 s after the external timer
started, before the product's 50.571 ms internal report. Sample 1 showed the
same sequence, with a 338 ms notarization transaction and roughly 231 ms of
XProtect analysis.

Two separately linked, one-instruction C controls measured the host's
changed-executable first-launch floor at 0.575269 s and 0.245959 s. Explicitly
re-signing a product ad hoc under a stable identifier still produced a
0.525092 s first launch. The two valid Apple Development identities visible
to `security find-identity` were not usable non-interactively: `codesign`
returned `errSecInternalComponent` and left a temporary copy ad-hoc signed.
Developer mode is disabled on the host.

This evidence localizes the remaining miss to variable macOS launch policy,
not the certified doctor body. No repository source change can remove the OS
assessment while preserving the required changed-binary first observation.
Enabling Terminal developer mode, disabling Gatekeeper, or provisioning an
unlocked signing identity would change machine security/credential state, so
none was performed. Silver was also left untouched because its active process
and Codex session showed that it still owned the Clique benchmark lane.

Exact values are in [`samples.json`](samples.json); selected raw unified-log
lines for the second formal sample are in
[`sample-2-macos-launch-policy.log`](sample-2-macos-launch-policy.log).

## Fleet recheck: Apartment Air

A later recheck used the Apartment M5 Air because it already had developer
mode enabled. Black and Air were unreachable directly from the M1 control
plane, but both were reachable through Silver as a jump host. Silver itself
had developer mode disabled and no valid signing identity. Air reported one
valid Apple Development identity, but a noninteractive temporary-file signing
probe returned `errSecInternalComponent`; no credential prompt or machine
security change was attempted.

The Air's pre-existing trust made two new ad-hoc trivial-executable controls
pass at 0.411983 s and 0.373158 s. The product result did not follow. Two fresh,
byte-distinct release products at then-current integration head `7a709d324`
had first observations of **0.720010 s** and **0.556787 s**, with adjacent
second observations of 0.030027 s and 0.031615 s. Internal doctor work was
57.232 ms and 59.461 ms. The retained unified logs show a notarization request
and XProtect/Gatekeeper scan for each changed product despite developer mode.

The recheck therefore remains **not qualified**. Exact samples and host setup
are in [`air-recheck.json`](air-recheck.json), with the selected raw OS trace
in [`air-macos-launch-policy.log`](air-macos-launch-policy.log). The
[`fleet trust inventory`](fleet-trust-inventory.json) also records the other
candidate Macs: Silver had no identity and developer mode disabled; Black had
developer mode disabled and three listed identities, including Developer ID,
but its Developer ID signing probe also returned `errSecInternalComponent`.
Black was not measured while an unrelated Cargo test was active.
