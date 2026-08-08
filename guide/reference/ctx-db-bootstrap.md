---
title: Handler ctx.db bootstrap reference
id: reference.ctx-db-bootstrap
order: 805
audience: agent-first
capabilities: []
authorities: [llp/0004-application-data-api.rfc.md, llp/0194-generated-api-reference.rfc.md, packages/snapback-codegen/index.mjs]
examples: [packages/snapback-codegen/authoring-validation.test.mjs]
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-08
reviewed-commit: 729d95b3bbbdeaae309092af9e5bed167980c601
---

# Handler `ctx.db` bootstrap reference

> **Bootstrap boundary.** This page is a hand-fenced temporary reference, not
> a symbol-registry record. The generated app declaration currently owns the
> exact schema-instantiated handler context, but no published package owns a
> reusable `ctx.d.mts` declaration yet. The registry therefore excludes these
> names from runtime parity instead of inventing a second type authority.

The generated query context exposes a read-only `db`; the generated mutation
context narrows that property to the read-write database. Row, table, field,
index, insert, and patch types are instantiated from the same schema model that
codegen uses for the rest of the generated API.

## Query database

`GeneratedQueryDatabase` has these verbs:

- `get(table, id)` returns the typed row or `null`.
- `query(table)` returns `GeneratedQueryBuilder<Table>`.

The query builder has the exact shipped chain:

- index and predicates: `withIndex`, `eq`, `in`, `lt`, `lte`, `gt`, `gte`;
- ordering and bounds: `order`, `take`;
- terminals: `collect`, `first`.

Arguments are schema-derived: table names exclude non-readable system-owned
tables; index names are valid for the selected table; predicate fields and
values come from that table's generated row type.

## Mutation database

`GeneratedMutationDatabase` extends the query database with:

- `insert(table, values)` for insertable tables and generated insert shapes;
- `patch(table, id, values)` for patchable tables and generated patch shapes;
- `delete(table, id)` for deletable tables.

## Retirement trigger

Remove this bootstrap page when a published, type-only handler-context module
lands and the registry can project its symbols. At that point generated app
declarations should instantiate or re-export the published owner instead of
redeclaring the generic contract, and duplicate symbol ownership must fail CI.
