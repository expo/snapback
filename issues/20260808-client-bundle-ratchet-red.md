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
