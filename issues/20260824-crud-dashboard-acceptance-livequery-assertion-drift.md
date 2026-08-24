# `package.test.mjs` asserts a `client.liveQuery` receiver the crud-dashboard scaffold no longer writes

Status: open
Filed: 2026-08-24
Area: packages/snapback-cli (scaffold templates, packaged qualification)

## Symptom

`node --test packages/snapback-cli/package.test.mjs` fails at
`packages/snapback-cli/package.test.mjs:716`:

```
AssertionError: The input did not match the regular expression
/client\.liveQuery\(api\.projectDetail/u
```

The scaffolded `crud-dashboard/acceptance.mjs` is the
`defineStarterAcceptance` document, which declares `api.projectDetail` as a
path entry and never spells a `client.liveQuery(api.projectDetail` call. The
tracked template `packages/snapback-cli/templates/crud-dashboard/acceptance.mjs`
spells `adminClient.liveQuery(api.projectDetail`, whose receiver is
capitalized and so does not match the lowercase `client.` the assertion
requires either.

## Provenance

Pre-existing on `origin/main` at 941e965ad; independent of the
`seth/knockoff-shared-development-auth` branch, which does not touch the
templates or the assertion. It was masked until 2026-08-24 by an earlier
failure in the same file (packaged runtime framework-drift detection, fixed on
that branch), which aborted the run before line 716.

## Next action

Decide which side is authoritative — the live-query call the assertion wants,
or the declarative path entry the scaffold now emits — and reconcile the other.
The assertion exists to keep the CRUD template demonstrating a live query
rather than a one-shot read, so prefer restoring an explicit live-query
observation in the scaffolded acceptance document over relaxing the regex.
