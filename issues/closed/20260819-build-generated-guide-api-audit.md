# Build-generated guide API needs a sound expansion proof

**Status:** Closed
**Owner:** Snapback security gates
**Due:** 2026-09-19
**Resolved:** 2026-08-20
**Related:** LLP 0284 §3.7,
`crates/snapback-server/generated/embedded-guide-api-shape.v1.json`

## Resolution

The public Guide API is no longer generated into Cargo's `OUT_DIR`.
`snapback-server::guide` directly consumes the committed
`generated/embedded_guide_api.rs` artifact. Its three `OUT_DIR` includes are
expression-position data under committed types (`&str`,
`&[EmbeddedGuideFile]`, and `&[&str]`), so producer output cannot add module
items or change those public declarations.

The committed `embedded-guide-api-shape.v1.json` manifest pins and the
privilege gate verifies:

- the exact including source and relative include path;
- the API artifact SHA-256 and its syn-parsed item shape;
- the exact three expression-position generated-data includes;
- the complete scanner catalog of raw SQL names, LLP 0284 seed types, and
  authority discriminators, none of which may occur in the artifact; and
- Cargo's selected custom-build source path and SHA-256.

The gate never compiles or executes `build.rs`. Ordinary builds consume the
same committed API artifact the gate parses. Producer behavior can still alter
data, fail, hang, or exercise ambient authority; this closure is deliberately
only an API-shape privilege proof, not a producer sandbox or data-semantics
proof.

The expiring `embedded-guide-generated-table` review row was removed. Harness
coverage plants bare and qualified hostile `OUT_DIR` item includes, observes
`generated-api` refusal plus manifest include-set drift, removes them, and
observes the committed proof restore. Separate mutations prove that raw SQL,
an LLP 0284 seed, an authority discriminator, producer bytes, and the
Cargo build-target path all fail closed without producer execution.

## Rejected approach retained for history

The prior replacement for this review debt compiled and executed the producer
with ambient host authority and gate-distinctive inputs. A producer could probe
a denied write, network access, environment value, target detail, or any other
audit/ordinary-build difference, then emit harmless output only under audit.
That approach remains unsound and was not restored.
