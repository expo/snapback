# Snapback 2 `exists` on a prefix of a longer unique index fails at certify, not at Quarry

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/packages/compiler/src/quarry/catalog.ts` (`selectIndex`), `bound-schema.ts`
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1010; `rule_types::check_exists` requires full unique key arity

## Symptom

`selectIndex(..., "exists")` accepts any index whose component count is **≥** the supplied keys, then prefers an exact-length candidate if one exists but will otherwise keep a longer index. `bindRuleExpr` / `lowerPointRead` emit that index with only the authored key terms.

Rust `rule_types::check_exists` and `validate_point_key_arity` require `key.len() == index.components.len()`. `lookup_indexed` would also refuse a short key. The TS binder therefore produces IR the certifier always rejects. `snapback2 check` / `compile()` still fail closed, so this is not an execution bypass — it is compiler-accepts / engine-refuses at the diagnostic boundary, with a certify-site error instead of a Quarry exists-site rewrite.

Typical miss: `exists memberships[.conversation]` selecting `byConversationPrincipal (conversation, principal)`.

## Proposed patch

For rule and point `exists`, require a complete unique ordinary index (same predicate as `mode === "point"`).

In `catalog.ts` `selectIndex`:

```ts
    if (mode === "point" && (!index.unique || index.components.length !== keys.length)) return false;
    if (mode === "exists" && (!index.unique || index.components.length !== keys.length)) return false;
    if (mode === "range" && index.components.length < keys.length) return false;
```

Remove `exists` from the `>= keys.length` branch. Keep the exact-length preference for ranges if needed.

Refuse at `selectIndex` with the existing “name the columns/index” rewrite so the author sees the exists site, not a certify schema error.

## Acceptance

- `exists memberships[.conversation]` against `byConversationPrincipal (conversation, principal)` is a Quarry rewrite at the exists site, not `E_TRACE_SUBSET` / certify arity later.
- `exists memberships[.conversation, viewer]` on that index still certifies.
- A complete unique one-column exists still works.

## Resolution (2026-09-11)

Both inferred and explicitly named exists indexes require a complete ordinary key at Quarry binding. The proposed unique-only restriction was rejected: Rust check_exists accepts complete nonunique keys, and shipped chat uses (conversation, principal, role) nonunique existence probes. Tests cover partial inferred/explicit rule keys, explicit program keys, complete unique/nonunique composite keys with native certification, and complete one-column unique keys. Eight direct compiler validation groups and compiler tsc pass against a fresh owner.

Validation: affected offline public-state, auth ownership and client sessions suite passed 101/101; the added rendered expiry probe also passed. Package build and affected reference check pass.
