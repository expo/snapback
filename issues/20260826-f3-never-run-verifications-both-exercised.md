# F-3: both never-run verifications are now exercised

**Status:** open (one green, one red with a named defect)
**Date:** 2026-08-26
**Systems:** publication, packaging, runtime attestation, cold clone
**Related:** LLP 0283 F-3, LLP 0041, `issues/20260826-cold-clone-cron-delta-outbox-not-writer.md`

LLP 0283 F-3 lists seven verification items, of which two had **genuinely never been
exercised**: the cold clone, and the npm closure pack plus install witness. Both have now
been run at `d3e573273`.

## Item 2 — cold clone: RED, one named defect

33 of 34 browser acceptance checks pass. Step 1 (production build from registry packages in
a genuine cold clone, no sibling checkout, no pin file) passes cleanly, so a stranger can
build this repo from nothing. The single failure is
`SNAPBACK_OUTBOX_NOT_WRITER` on "cron-authored delta reaches the browser through the
bindings (no pump)", tracked separately in
[`issues/20260826-cold-clone-cron-delta-outbox-not-writer.md`](20260826-cold-clone-cron-delta-outbox-not-writer.md).

## Item 3 — npm closure pack: GREEN

**13 packages packed `dry-run-ok`, zero refusals**, each with a content hash, and a
`snapback.package-candidate-ledger.v1` ledger written to `dist-publish/publish-ledger.json`
recording `mode: dry-run`, `sourceDirty: false`, and the exact revision. The run ended
`DRY RUN complete — nothing was published`.

Nothing was published and nothing can be by accident: a real publish requires **both**
`--publish` and `SNAPBACK_PUBLISH_CONFIRM=yes-really`.

### What it took to get there, and why that matters

The closure pack refused twice before passing, each time with a precise diagnostic. Both
refusals were the gate working correctly, not defects:

1. `SNAPBACK_RUNTIME_BINARY_MISSING` — it will not pack a closure whose runtime artifact does
   not exist, and it named the exact path and the command to fix it.
2. `SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED` — a plain `cargo build --release` is
   **not sufficient**. Without a `PackageCapabilityAttestationV1` the package must retain
   relation/activity GAPs. The attested artifact comes from
   `scripts/build-linux-runtime-release`, which emits the
   `SNAPBACK_RUNTIME_LINUX_X64_*` environment the pack then consumes.

This ordering is worth recording because it is not obvious from the scripts alone: **build
release → attest via `build-linux-runtime-release` → export its environment → run the pack.**

### One papercut

`scripts/build-linux-runtime-release` fails with a raw Node `EEXIST` traceback on
`build-attestation.json` when its output directory already contains a previous run, rather
than overwriting or saying "output exists; remove it or pass `--output-dir`". Passing a fresh
`--output-dir` works. Low severity, but it reads as a crash rather than a precondition.

## Status of the F-3 claim

Item 3 is green. Item 2 is red by exactly one named check with a precise diagnostic, now in a
fix lane. Neither may be described as unexercised any longer, and item 2 may not be described
as green.
