# Q09 `ResolvedSession` narrowing resume point

**Status:** Open
**Systems:** Auth, Types, Kernel, security-boundary fixtures
**Date:** 2026-08-25
**Rows:** F119, C001
**Ruling:** LLP 0303 — DERIVE

## Context

Q09 was deliberately set aside so the Q11 authority-root lane could converge
and commit. The rebased supervisor WIP had combined both roots; commit
`677db24b498fad75d845fd306bf17913204d523e` is the compiling checkpoint after
the Q09-only surface was removed.

## Exact work set aside

The following Q09-only changes were reverted, without reverting adjacent Q11
work:

1. `crates/snapback-auth/src/auth/provider.rs`: the new provider-owned opaque
   `ResolvedSession` wrapper and its private resolution identity were removed;
   the existing shared `ResolvedSession` fact type is used again.
2. `crates/snapback-types/src/contract_types.rs`: the WIP rename from
   `ResolvedSession` to `CatalogResolvedSession` and its fact-only
   documentation were reverted.
3. `crates/snapback-kernel/src/storage/auth_catalog_ops.rs`: Q09 type-name
   changes were reverted while Q11 test-support/database-binding changes in
   the same file were retained.
4. `tests/fixtures/security-boundaries/src/bin/construct_resolved_session_from_parts.rs`,
   its Cargo bin entry, and its attack-inventory row were removed because that
   compile-fail claim no longer matched the narrowed tree.

The accidentally committed generated
`demos/shindig/snapback/.generated.regenerate.lock` was also removed at the
checkpoint; it is not Q09 work.

## Resume direction

Restore the provider-owned opaque session resolution as a separate lane,
repeat LLP 0303 revisions (n), (o), and (p) for that root, restore an honest
no-feature dependent witness, and claim only F119/C001. Do not infer Q09
closure from the Q11 work or its `ResolvedAppAuthority` payload opacity.
