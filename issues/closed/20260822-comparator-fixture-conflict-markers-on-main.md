# Committed conflict markers in comparator generated fixtures break the cold gate

**Status:** Closed
**Opened:** 2026-08-22
**Closed:** 2026-08-23
**Systems:** CLI comparator kit, Codegen fixtures, Cold-install gate
**Introduced by:** `a0bb35684` (feat: implement LLP 0295 W4 composition), a
rebase of `a36e671a1` — rename/rename conflict left unresolved.

## Symptom

Four generated comparator fixtures carried unresolved git rename/rename conflict
markers (opening-side, separator, and incoming-side marker runs)
on `main`:

- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.06805c522cfdaf44964fb9455d90edf6322da527aec766a80c0aa0d8ca88d2ae.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.binding.c9821ce30935c543197520c888db26aaf8438bb393f97a6b9f5b4a48f3822797.mjs`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.b062362f7c1834fee1c126da4a650e3a58898013c3f57532fcc8576cad4d4714.json`
- `packages/snapback-cli/fixtures/comparator/app/snapback/generated/app.descriptor.eee5c7abb7665e8230ea869d6e09f3a2b3051c84ddf53ca8e541914e1258e618.json`

The `.mjs` files failed to parse (`Unexpected token '<<'`), so the complete
cold-install gate stopped before starter execution. The two sides differed only
in which descriptor hash the binding imported (`b062362…` vs `eee5c7…`).

## Resolution

Regenerated the complete generated closures for the comparator, push-seam,
conversation, and contention-calendar apps from their source definitions. The
regeneration removed both stale content-addressed binding/descriptor pairs from
each app and retained one coherent pair. A second regeneration produced no
changes. The push-seam regeneration uses its registered
`SNAPBACK_OUTBOUND_ACTIONS=1` policy; regenerating it without that flag produces
the wrong binding/descriptor identity.

The repository-wide generated-artifact driver now reaches its final diff gate.
It still reports the separately tracked, pre-existing 29-root committed-output
drift in `issues/20260815-artifact-schemas-v0-committed-output-drift.md`; those
unrelated rewrites were not folded into this repair. The four repaired roots
pass their graph, tracked-custody, and idempotence checks. Tracked files contain
no unresolved opening conflict marker.

The comparator profile (including minting and verifying a fresh comparator
receipt), the CLI verification suite, the push provider/seam acceptance, and
the conversation command/surface suites all pass. The push proof explicitly
disables the unrelated client RQS cache: its server-side registry, handoff
ledger, and provider assertions do not own client outbox transition custody,
whose pre-existing red remains recorded in
`issues/20260820-f3-bucket-b-pre-existing-reds.md`.
