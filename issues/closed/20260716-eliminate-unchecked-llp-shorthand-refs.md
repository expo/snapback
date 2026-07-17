# Eliminate unchecked LLP shorthand references

**Status:** Closed
**Severity:** P3
**Systems:** LLP corpus, Ref checker, Schemas, Source annotations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0000
**Marker:** documentation-integrity

`./ref-check --verbose` currently succeeds with 15 informational findings for
`@ref LLP` shorthand targets that have no validated mapping. They occur in
committed schemas, package entry points, and Rust source. Unlike numbered LLP
references, these annotations cannot be checked for document or anchor drift.

The checker documentation says project-defined shorthand mappings are allowed,
but the repository currently provides no mapping authority or validation path.

**Done when:**

- Inventory all current shorthand occurrences and decide whether each should
  name a specific numbered LLP/section or a deliberately shared corpus target.
- Replace accidental shorthand with canonical `LLP NNNN#section` references.
- If intentional shorthand remains, define one explicit repository-owned
  mapping format and teach `ref-check` to resolve and validate it, including
  missing-target and stale-anchor tests.
- Keep generated-schema annotations tied to their source authority so
  regeneration does not reintroduce unchecked references.
- `./ref-check --verbose` completes with zero unchecked shorthand findings.

## Resolution

Closed on 2026-07-16. All 15 informational findings were accidental parser
fallthroughs from otherwise intended numbered references; no shared shorthand
mapping was justified:

- lifecycle annotations now resolve to
  `LLP 0032#phase-3--lifecycle-and-resource-hardening`, with journal retention
  also resolving to `LLP 0008#retention-and-resume`;
- the Contract adapter's combined annotation is split between
  `LLP 0012#capability-manifest` and
  `LLP 0051#d6-clients-by-class-online-fallback-parity-by-construction`;
- permission-backing codegen resolves to
  `LLP 0053#two-orthogonal-declarations`;
- generated connection and mutation wire descriptions resolve to
  `LLP 0051#d4-finish-dk-7-the-live-envelope-becomes-schema-governed`;
- generated membership-expiry descriptions resolve to
  `LLP 0056#writes-a-declared-transition-policy-closed-by-default`.

The eight schema findings came from three Rust `schemars` doc authorities whose
reference target and gloss were separated by an escaped JSON newline. The Rust
comments were reflowed and the committed schemas regenerated, preserving LLP
0037's Rust-first source-of-truth rule. The codegen comment change participates
in the generator's input identity, so all committed demo artifacts were
regenerated; the remote-service publication also refreshed the affected schema
digests. A ref-check regression now requires this repository to retain zero
unchecked shorthand findings.

Verification: `./ref-check --verbose` reports 0 errors and 0 unchecked;
`python3 tests/ref_check_v0.py` passes 2 tests; and
`cargo test --locked --test artifact_schemas_v0` passes all 19 schema authority,
drift, validation, and publication-integrity tests. The schemagen binary unit
test also passes.
