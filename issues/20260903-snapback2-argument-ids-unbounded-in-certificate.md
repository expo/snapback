# snapback2: argument ids are not length-bounded, so the certificate under-prices them

**Status:** Open — implementation landed; served-program regression still unqualified

**Opened:** 2026-09-03 (row-width lane, blind review, inherited hole)
**Area:** `snapback2/crates/snapback2-core` (`argument_max` in `retention.rs`, argument validation in `engine/mod.rs`)

An `Id`/`Principal`/`Ref` argument is priced at a fixed 144 bytes
(`declared_column_max`), but argument validation does not bound the length of
an id value: the reviewer served a 5,008-byte id through a program whose
certificate priced the argument at 151 bytes. Either bound id/principal
arguments (and columns) at the 144-byte maximum the estimator assumes, refusing
longer values as `E_INPUT`, or price them by the real maximum. The former is
the honest fix: 144 is already the wire assumption everywhere.

Pin: a program returning `{ id: args.id }` served with a 5,000-byte id is
refused as input, and the certificate covers the accepted maximum.

## 2026-09-11 triage

**Priority:** P2 (verification gap; original under-pricing was P1).
**Disposition:** Open, narrowed to the requested served-program pin.
Source now enforces the same canonical identity ceiling used by the certificate.

Commit `799ba19a6` added `value.rs::validate_identities`: any `Value::Id` whose
tagged canonical UTF-8 representation exceeds 144 bytes refuses `E_INPUT`,
recursively through arrays/rows/maps. `engine/mod.rs::validate_arg_value`
calls it before untyped descriptor validation; the serving path's
`validate_typed_arg_value` calls `cap.rs::validate_arg_identities`, which uses
the same 144-byte rule except for a canonical maintained-address Ref priced by
its declared target maximum. The twin's
`value-runtime.ts::validateIdentity` uses the same
`JSON.stringify({ Id: id }) <= 144` rule, while
`retention.rs::argument_max` prices Id/Principal at 144 and references by the
declared table identity maximum.

**Verification:** the 2026-09-11 evaluator suite passed, including its
136-character `store.put` refusal and exact 144-byte `wideId` boundary. The
accepted evaluator boundary is covered. Native source also has direct
`identity_fits` / `validate_arg_value` boundary checks in
`engine/search_boundaries.rs`. Neither cited result is a fresh owner/served
execution of the original `{ id: args.id }` program.

**Remaining acceptance:** qualify the original served-program pin with a
5,000-byte argument and the accepted canonical maximum, retaining its
certificate/output bound. This is a missing verification result, not evidence
that the implemented admission rule still accepts the oversized argument.
