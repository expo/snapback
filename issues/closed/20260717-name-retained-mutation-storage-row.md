# Name the retained-mutation storage row projection

**Status:** Closed
**Severity:** P3
**Systems:** Storage, Client mutation replay, Rust quality gates
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0043; issues/closed/20260717-distinguish-zero-version-mutation-settlements.md
**Marker:** storage, replay, clippy, maintainability

Adding authoritative settlement metadata expanded the retained-mutation SQLite
projection to a seven-element anonymous tuple. The pinned canonical proof then
failed Clippy's `type_complexity` gate. Beyond the lint, positional fields made
the legacy and exact settlement cursors unnecessarily easy to transpose during
future migrations.

**Done when:**

- The query decodes into a named private row type rather than a long tuple.
- Destructuring preserves the existing validation and diagnostics unchanged.
- `cargo fmt -- --check` and Clippy pass.

## Resolution

The replay lookup now uses `RetainedClientMutationRow`, naming every identity,
payload, legacy cursor, and exact cursor field at the decode boundary. The
subsequent validation remains byte-for-byte equivalent while the canonical
Rust quality gate no longer needs a lint suppression.
