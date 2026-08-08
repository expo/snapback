# Stored table fields reject literal-union (enum) validators

**Opened:** 2026-08-08 · **Severity:** P3 (schema surface; duplicate fail-closed guards in every app)

`v.union` of literals is rejected on stored table fields
(`SCHEMA_INVALID_VALIDATOR`, probed at scaffold time), so source varchar
enums (`role: crew|user`, `visibility: internal|public`) are stored as
`v.string()` and every writer/ingest path re-implements the closed-domain
guard (the control's `W-ENUM`: compiler guards + ingest guard + every Lane 4
writer). Authorization-relevant domains (role, visibility) deserve
schema-level closure so query auth can never treat an unknown role as crew.

Ask: admit closed literal-union validators on stored fields (or a dedicated
enum declaration) with generated-contract support. Removes W-ENUM.

- **Claimed 2026-08-08:** session dc26442d (13-ticket sweep orchestrator) is executing this ticket now; sibling sessions should not duplicate.
