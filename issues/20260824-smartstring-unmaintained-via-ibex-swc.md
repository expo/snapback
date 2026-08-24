# `smartstring` is unmaintained through Ibex's SWC parser pin

**Status:** Open
**Systems:** Rust dependencies, Runtime, Ibex, Security
**Date:** 2026-08-24
**Advisory:** `RUSTSEC-2026-0249`
**Related:** `.cargo/audit.toml`, `vendor/ibex`, `crates/snapback-runtime`

## Problem

`cargo audit --deny unmaintained` reports `smartstring` 1.0.1 as
unmaintained. The compiled dependency chain is:

```text
snapback-runtime
  -> vendored ibex-runtime
  -> swc_ecma_parser 41.1.2
  -> smartstring 1.0.1
```

This is an upstream maintenance warning, not a vulnerability with a patched
`smartstring` release that Snapback can select directly. Snapback does not own
the SWC parser dependency; the pin is part of the vendored Ibex runtime's
JavaScript parsing closure.

The root `.cargo/audit.toml` therefore carries a narrow ignore for only
`RUSTSEC-2026-0249` so `--deny unmaintained` continues to enforce every other
warning while this dependency remains outside Snapback's direct control.

## Remediation

Update the SWC dependency closure in the Ibex repository to a maintained
parser/string stack, qualify Ibex's parsing and runtime behavior there, then
advance Snapback's `vendor/ibex` revision and lockfile to that result.

When the upgraded Ibex revision removes `smartstring` 1.0.1 from Snapback's
compiled graph, remove the `RUSTSEC-2026-0249` ignore from
`.cargo/audit.toml` in the same landing.

## Acceptance

- Ibex no longer resolves `swc_ecma_parser` through unmaintained
  `smartstring` 1.0.1.
- Snapback advances the vendored Ibex revision and lockfile with its affected
  runtime/parser checks passing.
- `cargo audit --deny unmaintained` passes after the audit ignore is removed.
