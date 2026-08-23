# Committed conflict markers in comparator generated fixtures break the cold gate

**Status:** Open
**Opened:** 2026-08-22
**Systems:** CLI comparator kit, Codegen fixtures, Cold-install gate
**Introduced by:** `a0bb35684` (feat: implement LLP 0295 W4 composition), a
rebase of `a36e671a1` — rename/rename conflict left unresolved.

## Symptom

Four generated comparator fixtures carry unresolved git rename/rename conflict
markers (`<<<<<<<< HEAD:<path>` / `========` / `>>>>>>>> a36e671a1 …:<path>`)
committed on `main`:

- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.06805c522cfdaf44964fb9455d90edf6322da527aec766a80c0aa0d8ca88d2ae.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.c9821ce30935c543197520c888db26aaf8438bb393f97a6b9f5b4a48f3822797.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.b062362f7c1834fee1c126da4a650e3a58898013c3f57532fcc8576cad4d4714.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.eee5c7abb7665e8230ea869d6e09f3a2b3051c84ddf53ca8e541914e1258e618.json`

The `.mjs` files fail to parse (`Unexpected token '<<'`), so the complete
cold-install gate stops before starter execution. The two sides differ only in
which descriptor hash the binding imports (`b062362…` vs `eee5c7…`).

## Why this is filed, not fixed here

These are generated fixtures owned by the LLP 0295 W4 composition work. The
correct resolution is a regeneration that reflects W4's intended
binding/descriptor pairing, not a hand-merge guess between two descriptor
hashes — picking the wrong side would silently ship an incoherent fixture.
The owning session should regenerate the comparator fixture app and commit the
single coherent pair.

## Fix

Regenerate `fixtures/comparator/app/snapback/generated/` from its source app so
exactly one binding/descriptor pair remains (no markers), then confirm the
cold-install gate reaches starter execution and `comparator-profile.test.mjs`
passes. If both hashes are legitimately needed, the generator must emit them as
distinct files without a conflict, not as one merged file.
