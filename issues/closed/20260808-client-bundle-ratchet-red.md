# Client bundle ratchet is red on the pinned toolchain

**Opened:** 2026-08-08 · **Severity:** P2 (package performance / release gate) · **Area:** client bundle metrology

## What

Under the exact Node 24.18.0 / esbuild 0.28.1 measurement authority,
`node scripts/client-bundle-metrology.mjs --check` fails:

```text
public-subpath-rqs-registered
  minified  32,045 -> 32,144  (+99)
  gzip      10,651 -> 10,686  (+35)
  brotli     9,371 ->  9,389  (+18)

react-external
  gzip      29,002 -> 29,003  (+1)
```

The first proof attempt under Node 25 failed earlier on the measurement-method
identity, but this pinned rerun proves the size failure is independent of that
environment mismatch. The current report attributes the registered-RQS closure
primarily to `rqs-preload.mjs`, `rqs.mjs`, and the auth-invalidation contract.
Recent route-retention diagnostics are a plausible legitimate source, but the
ratchet requires attribution and a disposition rather than an unexplained
baseline rollover.

The one-byte React gzip movement should be checked for shared-code growth or
deterministic compression sensitivity; it should not be silently rounded away
without preserving the ratchet's intended threshold semantics.

## Fix

Attribute the deltas to exact commits/modules, remove accidental closure growth
where possible, and write the governed rollover only for legitimate shipped
feature weight. Keep historical receipts immutable.

## Acceptance

- `node scripts/client-bundle-metrology.mjs --check` passes on pinned Node
  24.18.0.
- The disposition records module-own byte deltas and behavior evidence for any
  accepted rollover.
- No development-only or optional capability is pulled into either static
  production closure accidentally.

## Confidence

High on the deterministic gate failure; medium on whether the 99-byte RQS
growth should be trimmed or dispositioned as legitimate.

## Disposition (2026-08-08 review-fixes sweep)

Not fixed in the sweep (needs the pinned Node 24.18.0 / esbuild 0.28.1
measurement authority + attribution judgment, not a mechanical edit). The deltas
are small (+99 B minified on the registered-RQS closure; +1 B gzip react) and,
per the ticket, plausibly legitimate route-retention feature weight. Recommended:
attribute the deltas to exact modules and either trim accidental closure growth
or write a governed rollover with module-own byte evidence — keeping historical
receipts immutable. Note: Lane D/F landed React/client changes via bypass while
client-bundle-metrology was already baseline-red, so this ratchet should be
re-measured and re-baselined once the sweep's client changes have settled.

## Resolution — 2026-08-10 (overtaken)

Overtaken by today's metrology work: Charlie's 2026-08-10 standing policy
(LLP 0145 §Phase A dated amendment, 6a025aabe) replaced per-instance
attribution rulings; the flagged +99 B/+1 B growth was absorbed into the
subsequent governed rollovers (search-prewitness-refusal,
rqs-store-competing-writer, lease-custody-and-remediation,
live-wire-replay-seam — each with attribution, byte deltas, and behavior
train). `client-bundle-metrology.mjs --check` is green on current main
under the pinned Node 24.18.0 (58 profiles, no frozen ceiling regressions;
verified at 0eac1d309). Nothing left to attribute or trim under the old
posture. Closing.
