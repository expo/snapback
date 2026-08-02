# 0062-01: API envelope codegen

**Status:** OPEN. **Authority:** LLP 0062 §1/§5, residue items #3/#9
(declaration-integrity grammar; distinct app-only vs merged `types`
DTO roles); LLP 0037 (Rust-owned envelope DTO + committed schema).

Emit the app's API envelope as data: source-stripped function-manifest
projection, `operations/*.args.schema.json`, typing artifacts
(`code-mode.d.ts` groundwork), app-only vs merged partitions with
segmented hashed bytes under a versioned admission grammar; degenerate/
forged cases refuse. Rust-owned `ApiEnvelopeV1` DTO, committed schema,
drift gates. Codegen validates emission against the schema (DK-7).

Done when: envelope emits for the fixture apps, the grammar refusals
have tests, and the engine can load it as inert data locally (serving
is 02).

---

**Progress 2026-08-01 (Rust authority half landed).** `src/api_envelope.rs`
carries the Rust-owned `ApiEnvelopeV1` DTO (`deny_unknown_fields` throughout),
the committed `schemas/api.envelope.schema.json` under the ordinary drift
gate, the versioned admission grammar (size/function/schema-count/depth/
declaration bounds), JCS canonicity verification, the domain-separated
envelope and member digests, `verify_member_digests` (recomputes every member
against the carried map), and `verify_correspondence` (exact-equality of the
nested projection against the server-derived `PublicFunctionManifest`, plus
identity and function-set agreement). Eight refusal/admission tests green,
including zero-function, forged-member, unknown-member, noncanonical, and
mismatched-pairing cases.

Design decision recorded: the envelope's `functions` member is held as a
received value and never round-tripped through the typed projection —
deserializing and re-serializing could normalize away a smuggled
source-bearing member, which is the exact disclosure hole §5's
exact-equality rule closes. The committed schema still documents the
projection shape via `schemars(with = PublicFunctionManifest)`.

**Remaining, with a design fork the next fork should decide first.**
0062 §5 assumes *codegen* emits the canonical envelope and the server
ingests it byte-exact ("never reserializes it"). Implementing that requires
a JavaScript mirror of `PublicFunctionManifest` in codegen plus the
CI-validated anti-divergence gate §5 itself calls for — real work, and the
divergence risk is the reason the gate exists. The cheaper faithful
alternative: **codegen supplies only the members it owns** (operation
schemas, `appBindings` declaration, per-member digests) and the *server*
composes the envelope from its own projection at activation, making
divergence structurally impossible and correspondence trivially true. That
changes §5's "server never reserializes" clause, so it is an author/design
call, not an implementation shortcut — raise it before building either half.
