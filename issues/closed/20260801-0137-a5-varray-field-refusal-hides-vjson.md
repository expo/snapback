# A5 sweep: v.array table-field refusal names the Json primitive but not v.json()

**Opened:** 2026-08-01
**Systems:** Codegen, Schema, Guide
**Related:** LLP 0137 (A5 arm), demos/improvement-sweep/arms/a5-snapback-web/findings/0137-a5-f2-varray-field-refusal-hides-vjson.json

The validator vocabulary is asymmetric across authoring positions:
`v.array(...)` is accepted in result schemas and in mutation args, but a
table field declared `v.array(v.number())` refuses at generation with

    SCHEMA_INVALID_VALIDATOR: sourceEmbeddings.vector has unsupported
    validator primitive/field type "array"/"Json"

The message names the internal Json primitive yet does not say that
`v.json()` is the documented, working column type for exactly this value
(guide `getting-started/your-first-backend.md` lists it in the complete
validator set; the A5 probe confirmed it generates and round-trips arrays
and nested objects through insert, patch, live queries, and versioned
seeds). The A5 arm first shipped a JSON-string workaround (stringify/parse
at every boundary) for its citations and embedding-vector columns before a
probe surfaced `v.json()`.

Fix shape: accept `v.array(inner)` on table fields as sugar for `v.json()`
(same stored primitive), or make the diagnostic say "use v.json() for
structured columns" — plus one guide line noting that arrays as column
values are spelled `v.json()`.

---

**RESOLVED 2026-08-01 (fix-wave α1).** The array-field refusal now
appends: "(table fields have no array node; declare the field v.json()
to store an array, or model one row per element)"
(packages/snapback-codegen/index.mjs validator report).
