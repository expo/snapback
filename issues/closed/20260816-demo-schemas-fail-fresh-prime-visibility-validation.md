# Demo schemas fail fresh-prime visibility validation

Date: 2026-08-16
Status: Open

Freshly priming `demos/rbac/snapback` on current main produces artifacts that
the server refuses during startup visibility validation. The exact diagnostic
is:

```text
SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN: table applications visibility membership resource field _id does not exist
```

Reproduction:

```sh
node packages/snapback-codegen/index.mjs demos/rbac/snapback
```

Then compose the fresh `generated/schema.manifest.json` and
`generated/functions.manifest.json` into the ordinary cold-start artifact and
launch the worktree server. Startup fails before readiness with the diagnostic
above. The `applications` table declares membership visibility through
`resourceField: '_id'`, but server-side schema validation does not recognize
the server-owned `_id` field as a declared table field.

Commit `80ff4864f` ("declare honest table visibility across scaffold
templates") is the template-side precedent: generated backends should carry
explicit visibility that is honest and accepted by current composition and
startup validation.

The browser-auth bootstrap harness has moved from `demos/rbac/snapback` to the
self-contained
`tests/acceptance/fixtures/browser-auth-backend` backend so demo drift cannot
block auth acceptance. Demo owners should sweep freshly primed demo schemas,
repair visibility declarations that current server validation rejects, and
verify each affected demo reaches readiness from its freshly generated
artifacts.
