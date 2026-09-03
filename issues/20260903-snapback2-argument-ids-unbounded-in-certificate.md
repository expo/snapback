# snapback2: argument ids are not length-bounded, so the certificate under-prices them

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
