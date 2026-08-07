# Packaged-store qualification literals red the HTTP diagnostic inventory

**Status:** Closed
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Related:** `dbfeee26a`, LLP 0110, LLP 0166

The final wave-drift merge of completed main exposed a focused failure in
`server::tests::s5_d10_production_diagnostic_inventory_cannot_drift`.
Landing `dbfeee26a` added five production Rust `SNAPBACK_*` literals for the
public-package store qualification path without extending the inventory's
reviewed non-HTTP exclusions:

- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_MODE`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_IDENTITY_UNQUALIFIED`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_SUITE_UNQUALIFIED`
- `SNAPBACK_PACKAGED_STORE_QUALIFICATION_CLOSURE_INVALID`

The first two are process environment variable names. The remaining three
are CLI-local `packaged-store-qualification-receipt` minting diagnostics
returned through `anyhow`; none can be emitted by the Snapback HTTP server.
Classifying them as HTTP statuses would therefore invent a request path that
does not exist.

## Resolution

The five literals now have explicit, reason-bearing entries in
`NON_DIAGNOSTIC_SNAPBACK_LITERALS`. This preserves the forcing function for
new server diagnostics while honestly distinguishing package qualification's
environment and CLI protocol from the reviewed HTTP table. The exact focused
inventory test passes after the correction.
