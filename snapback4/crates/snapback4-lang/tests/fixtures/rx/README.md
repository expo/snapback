`legacy-{zero,one}-hop.q` and `.json` pin entire backends compiled by the
integrity-verified published Linux 0.4.13 binary. `legacy-provenance.json`
records the package integrities and source/backend/schema SHA-256 digests.
The compiler sees `schema.q` inside the application's `snapback/` directory.

The one-hop fixture repeats a parent in comparisons and a probe key, uses
old/next images, and includes a legacy final obligation without reference
keys. Its final located certificate must coalesce identical parent sites,
even though the meter and `why` count each occurrence. The zero-hop control
keeps the same operations, replacing ordinary write predicates with `allow`.

`rx_legacy_identity.rs` compares site lists, schema hashes and all serialized
backend bytes. The opt-in `rx-rule-hop-capability.test.mjs` recompiles with the
actual published binary, adopts with the current CLI, and upgrades acquired
native and wasm devices with a pending edit. It checks that generation,
watermark, confirmed images, pending base and query availability survive.

To reproduce these fixtures, extract the pinned packages under
`target/rx/published/{package-name}/package/`, keeping their `.tgz` archives
in `target/rx/published/`. From `snapback4/`, run
`node reports/20261006-rx-rule-hops/round-1/freeze-legacy.mjs`.
Do not regenerate them with the current compiler: they are the legacy oracle.
