# Symbol-registry client page saturated its projection budget

**Filed:** 2026-08-15 · **Status:** Open · **Systems:** Reference, Guide,
Tooling

**Related:** LLP 0194 (OQ1 — initial projection budgets, module/symbol
slicing "must be measured"); scripts/generate-symbol-registry.mjs

## Problem

`guide/reference/expo-snapback-client.md` reached 408,072 bytes at main
`a93a11235` — 99.6% of the initial 409,600-byte (400 KiB) module-page
projection budget chosen when LLP 0194 landed. The next ~1.5 KB of client
surface (in this case 34 new `SNAPBACK_MEDIA_COLLECTION_*` diagnostic codes
projecting through `packages/snapback-client/diagnostic-codes.d.mts`) pushed
it to 409,909 bytes and hard-failed `scripts/generate-symbol-registry.mjs`,
blocking every landing that regenerates guide artifacts.

## Interim fix (landed with the media-collection rollout)

`modulePageBudgetBytes` raised 400 KiB → 450 KiB (460,800). This is a
one-notch relief, not a policy: the page grows with every diagnostic code and
client symbol, and will saturate again.

## Real fix wanted

LLP 0194 OQ1 anticipated this: per-package Markdown may exceed the flat-guide
discipline and module/symbol slicing must be measured. Either:

1. slice `expo-snapback-client.md` by submodule (assets, commands, micro,
   auth, ...) the way the package's subpath exports already split, or
2. move the diagnostic-code listing out of the module page (it already has
   its own registry page) so code growth stops taxing the symbol page.

Whoever picks this up should record the chosen shape as an LLP 0194 OQ1
measurement note.
