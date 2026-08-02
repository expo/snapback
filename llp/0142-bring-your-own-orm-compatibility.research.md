# LLP 0142: Bring-your-own ORM compatibility

**Type:** Research
**Status:** Draft
**Systems:** Product, Application data API, Storage, Schema, Migrations, Sync, Realtime, Auth, Developer experience, Competitive analysis
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-01
**Revised:** —
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0008, LLP 0011, LLP 0046,
LLP 0080, LLP 0081, LLP 0120, LLP 0127, https://github.com/expo/valet

## Summary

A reported Valet-derived experiment by Seth explores a variant in which an
application keeps its own ORM — for example Drizzle or Prisma — instead of
using Snapback's application data API as the sole authoring and execution
surface. This is a legitimate adjacent product question, especially for
existing databases and teams with an established relational stack.

The current conclusion is deliberately narrow:

> **Table bring-your-own ORM compatibility for now. Continue focusing Snapback
> on greenfield applications, and make no changes to the current product or
> development direction.**

For a greenfield application on Snapback's paved path, a separate ORM is not
normally needed. Snapback's schema, named functions, `ctx.db`, generated
clients, migration model, and inspection surfaces collectively occupy the
application data-layer role. More importantly, that integrated surface gives
Snapback the facts required for authorization-aware live queries, local-first
retention and replay, read-set validation, atomic changesets, deterministic
system values, and portable SQLite-to-Postgres behavior.

This Research records why the adjacent idea remains interesting and why it is
not being adopted now. It does not evaluate Seth's implementation, authorize a
bakeoff, add an ORM adapter, change the Postgres plan, or weaken any existing
Snapback contract.

## Question and scope

"Bring your own ORM" can mean several materially different things:

1. use an ORM's schema syntax as an input that Snapback translates into its own
   manifests and closed plans;
2. use familiar ORM query syntax as a frontend that compiles into the subset of
   operations Snapback can analyze;
3. let arbitrary ORM-generated SQL read and write a Snapback-managed database;
   or
4. attach Snapback's sync and realtime facilities to an independently managed,
   possibly multi-writer database.

The first two are authoring-compatibility ideas. The latter two change database
authority and make Snapback more like a sync layer over an existing backend.
They should not be treated as one feature or conflated with adding another
storage engine beneath Snapback.

This document evaluates only the architectural and product shape implied by
those meanings. No source artifact from the reported experiment was reviewed,
so this document makes no claim about what that implementation currently
supports or proves.

## Findings

### F1. Greenfield Snapback does not ordinarily need a separate ORM

LLP 0004 defines Snapback's paved path as a typed, function-first API over a
portable document/relational layer. Application handlers read and write through
`ctx.db`; clients use generated references; raw SQL and direct table writes are
escape hatches rather than the product API.

This is intentionally broader than an ORM. The same declaration and execution
surface participates in schema validation, query admission, authorization,
transactional mutation semantics, live-query dependency tracking, offline
behavior, generated client types, and target conformance. Adding a second
ordinary data-access abstraction to a greenfield project would duplicate
authoring concepts and make it less clear which system owns those guarantees.

### F2. A storage adapter and an ORM adapter are different seams

LLP 0007 and LLP 0046 place SQLite and Postgres below one Snapback-owned
portable contract. A target-specific storage adapter may implement that
contract differently while the schema, functions, queries, mutations, and
observable behavior remain Snapback-owned.

An application-level ORM sits above that seam. If arbitrary ORM operations are
authoritative, they can select engine-specific semantics, issue writes outside
Snapback's mutation boundary, and introduce schema or migration facts not
present in Snapback's generated artifacts. A future Postgres target therefore
does not imply, require, or automatically enable Prisma or Drizzle compatibility.

### F3. Arbitrary ORM execution obscures facts Snapback uses for correctness

Observing changed rows through triggers or change-data capture can support a
useful realtime feed, but it does not by itself recover all of the intent and
authority Snapback currently receives before execution. Depending on the mode,
Snapback may no longer know:

- the exact read dependencies used to preserve a mutation invariant;
- which writes form one logical application changeset;
- the caller and authorization facts governing the operation;
- whether an offline mutation may be replayed and how conflicts settle;
- whether a query is safe to retain or evaluate on another execution site; or
- whether SQLite, Postgres, and a local replica implement the same semantics.

Those losses need explicit capability boundaries. A system that provides
database-change notifications while declining Snapback's offline, conflict,
and authorization guarantees may still be valuable, but it is a distinct
contract rather than a transparent replacement for `ctx.db`.

### F4. The adjacent adoption opportunity is real

Bring-your-own ORM compatibility could materially help:

- an existing application with a schema and migration history;
- a team standardized on Prisma, Drizzle, or direct SQL;
- a database written by services outside Snapback;
- a workload needing relational operations outside Snapback's admitted
  vocabulary; or
- a team that wants Snapback primarily for client sync and realtime delivery.

The gap is concrete rather than hypothetical. LLP 0080's first relational
profile deliberately supports a bounded two-source join while excluding
arbitrary SQL, aggregates, recursive queries, and many-to-many fan-out. Those
limits are appropriate for the current portable and authorization-aware path,
but they leave room for a differently scoped product to be attractive.

### F5. If revisited, compatibility should be capability-graded

A future investigation should compare at least three honest modes rather than
promise one undifferentiated adapter:

| Candidate mode | Authority | Plausible contract |
| --- | --- | --- |
| Integrated Snapback | Snapback schema and mutations | Full Snapback guarantees |
| ORM authoring compatibility | ORM schema/query input translated into admitted Snapback plans | Full guarantees only for translated operations |
| External database / change capture | ORM, SQL, and other writers remain authoritative | Realtime or sync features with explicit nonclaims |

This table is an option map, not a roadmap. No row is selected or scheduled by
this Research.

## Disposition: tabled

Snapback will continue to prioritize the integrated greenfield product. This
means **no changes to the current product and development direction**:

- Snapback's schema and function manifests remain the paved-path source of
  application data facts.
- `ctx.db` and generated function references remain the ordinary application
  API.
- The local-first, realtime, authorization, mutation, and migration programs
  retain their current constraints and priorities.
- The SQLite-to-Postgres graduation remains a Snapback storage-target concern,
  not a bring-your-own ORM program.
- No Prisma, Drizzle, generic ORM, arbitrary SQL, or external-database adapter
  work is authorized by this document.
- No active plan, issue, acceptance gate, staffing request, or release claim is
  created by this document.

The idea may be reconsidered only through a new, explicitly authorized research
or bakeoff phase. Useful revisit triggers would include sustained demand from
existing-database adopters, evidence that greenfield focus has reached its
intended product milestone, a concrete implementation with independently
verified guarantees, or a strategic decision to offer a separately positioned
sync-layer product.

If reopened, the first evaluation should test external multi-row writes,
authorization changes, offline mutation conflicts, schema drift and migrations,
nontrivial relational queries, and multi-writer transaction ordering. A later
RFC — not this Research — would own any product or API decision.

## Confidence

- **High** that a separate ORM is unnecessary for ordinary greenfield use on
  Snapback's intended paved path; this follows directly from LLP 0004, LLP 0007,
  and the current guide.
- **High** that arbitrary ORM authority cannot silently inherit Snapback's full
  sync, authorization, replay, and portability guarantees; those guarantees
  consume facts declared above the physical storage seam.
- **Medium** that an ORM-compatible or external-database mode represents a
  meaningful adoption opportunity; the customer shapes are credible, but this
  document contains no market sizing or comparative implementation evidence.
- **Low** on the capabilities of Seth's reported experiment because its source,
  tests, and receipts were not reviewed here.

## Parked questions

- Is the strongest future opportunity schema import, query-syntax compilation,
  arbitrary database observation, or a separately positioned sync product?
- Which Snapback guarantees can be preserved when another writer owns the
  transaction boundary, and which must become explicit nonclaims?
- Can an admitted subset of an ORM remain stable across ORM releases without
  creating a second full authoring surface?
- Would compatibility improve adoption enough to justify the permanent schema,
  migration, authorization, and support matrix?

These questions are intentionally parked. They create no present work.
