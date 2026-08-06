# Zerobugs acceptance program

This directory is the acceptance-program workspace for LLP 0183, the
Zerobugs-quality relational application surface. Stage 0 freezes a
source-faithful comparator and its acceptance inputs before capability work
begins.

## Directory map

- `stage0/` contains source-freeze evidence.
- `manifest/` will contain versioned acceptance manifests.
- `control/` will contain the future Stage 0.5 application built on the current
  shipped Snapback surface.
- `arms/` will contain future provider arms.
- `evidence/` contains immutable receipts for provider attempts.
- `scripts/` contains source-pin tooling.

## Source pin

The comparator is `rocicorp/mono` at commit
`25c2c7308d3eb674d2d895022c9da11ef0c742fb`, restricted to `apps/zbugs` and
`packages/zero`.

Fetch the pin into the ignored `.pin/` directory:

```sh
demos/zerobugs/scripts/fetch-zerobugs-pin.sh
```

Pass a target directory as the first argument to use another location. For an
offline verification run, set `ZBUGS_PIN_SOURCE` to a local Git checkout at the
pinned commit.

## Evidence rule

Provider-attempt receipts are immutable. In particular, the first-attempt
receipt is never rewritten: consistent with LLP 0138, remediations append a
new attempt and retain the original evidence.
