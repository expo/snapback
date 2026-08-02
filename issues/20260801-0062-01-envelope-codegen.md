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
