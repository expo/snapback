# Codegen: API envelope, public projections, and app binding declarations

**Status:** Shelved
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Codegen: API envelope, public projections, and app binding declarations” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the fix requires a few coordinated implementation and test surfaces, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Codegen, Docs artifacts
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §3/§5, LLP 0031 D3 (PublicFunctionManifest), LLP 0037 (Rust schema source of truth)
**Marker:** app-cli, sub-stage-a, codegen

`@snapback/codegen` grows the **API envelope** as a build output: the
source-stripped function-manifest projection, operations schemas keyed
by stable function id, `api.d.ts`, and an app-owned **bindings-only
declaration member** (working name `code-mode.bindings.d.ts`; the
frozen envelope DTO chooses the final distinct name). It contains
callable signatures per kind (`Promise<unknown>` results in v1,
`AsyncIterable<unknown>` for LiveQuery), but no engine globals. The
engine separately owns its ambient declarations and `types` merges
those two inputs into the local `code-mode.d.ts`; these are three
physically distinct products, not two byte-different artifacts sharing
one name. The envelope's identity is the SHA-256 of its
uncompressed RFC 8785 (JCS)-canonicalized bytes. Served declarations
and schemas must be generated from typed public projections: no
filesystem paths, no source fragments, no source-derived comments or
free-form text (the fixed codegen banner is the one named exception).

Round-10 integrity residue is owned here rather than hidden behind one
function-keyed digest map. The frozen DTO partitions declarations into
exact independently hashed leaves: schema/app-global declarations
(including data model, tables, shared ids/references, permissions,
memberships, contexts, and ephemeral types) are attested by the schema
artifact; operation schemas and callable binding leaves are attested by
the function artifact under stable function ids. The contract pins the
member segmentation and exact hashed bytes, including the zero-function
case and schema-only/function-only updates. A digest inside the envelope
is never its own trust root.

**Done when:**

- The envelope is emitted and listed in `artifacts.json`; its JCS
  preimage and hash are reproducible byte-for-byte across runs.
- The nested manifest projection validates in CI against the
  Rust-generated `PublicFunctionManifest` schema (LLP 0037 single
  source of truth); a field added in Rust but unclassified in the
  emitter fails the build.
- The app-owned binding member compiles with the engine-owned ambient
  declarations; `types` produces the distinct merged `code-mode.d.ts`,
  and typecheck fixtures compile LLP 0062 §3's examples against that
  merged output exactly.
- Schema- and function-owned digest manifests cover every declaration
  leaf exactly once. Zero-function, schema-only, function-only, and
  forged table/shared-declaration fixtures (with all envelope-local
  hashes recomputed) prove the independent trust roots.
- Legacy manifests with absent `authRequirement` normalize to
  `optional-user` in the projection (never null).
- Authoring-invalid and engine-reserved export names are rejected by
  codegen; only valid exports that are hazardous as object/thenable
  properties reach the engine's alias-suppression path.
- Planted source/path/comment sentinels in a fixture app cannot reach
  any envelope member; the permitted banner is asserted exactly.

## Shelved (2026-08-01, author decision)

Temporarily shelved per Charlie's 2026-08-01 decision on the
triage-sweep recommendation: the app-cli program is paused (owning RFC
LLP 0062 parked at Review since 2026-07-17; LLP 0122 Q6 still open on
the CLI's shape). Reopening condition: LLP 0062 leaves Review or the
program is recommissioned. The design content here is not invalidated
by the shelving.
