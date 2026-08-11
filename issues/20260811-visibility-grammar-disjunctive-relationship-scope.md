# Visibility grammar cannot express disjunctive relationship scoping (the Clique feed shape)

**Filed:** 2026-08-11
**Systems:** Security/authorization, Code generation, Live queries
**Related:** LLP 0231 (OQ1 — the visibility grammar), LLP 0201 (Clique
benchmark), LLP 0056 (memberships), ship run `llp0231-visibility-20260811`
(Lane C)

## Problem

The shipped visibility union (`public-read | owner | membership`) — and the
table-level policy LLP 0231 D1 builds on it — has **no disjunction**. A
follow-graph feed policy is:

> a post row is visible to the caller if the caller follows its author
> **or** the caller is its author

That is a disjunctive, relationship-composed row predicate. Follow edges model
naturally as LLP 0056 memberships (`(follower, followee, 'follower')`), so
both arms are individually expressible today — `membership` kind and `owner`
kind — but there is no way to declare their union on a table.

Until the grammar has it, any Clique-shaped feed query (LLP 0201's
social-messenger benchmark is exactly this app; its Following feed includes
the viewer's own posts with **no persisted self-follow edge**, per the 0201
revision (j) ruling) stays hand-enforced in a JS handler — precisely the
undeclared-boundary situation 0231 exists to end, on the workload we
benchmark with.

This is the row-level sibling of the pointing-room field-level counter-example
(`revealed || owner`) that reshaped 0231 D3: disjunction is the recurring
missing connective.

## Why it matters

- Benchmark leverage: LLP 0231's ergonomic win covers Clique's group-messaging
  milestones (membership scoping declares once) but leaves the feed milestone
  unimproved. The grader's holdout probes test cross-user leakage; a
  hand-enforced feed boundary is where a builder agent will leak.
- Design-pressure timing: Lane C of the ship run is choosing the composition
  IR now. Choosing a predicate IR that cannot later carry `anyOf([...])`
  bakes the wall in; choosing one that can costs little now even if the
  authoring surface ships later.

## Proposed shape (for the OQ1 design pass, not decided here)

- `visibility: anyOf([owner('authorId'), memberOf(follows, resource: rowField('authorId'))])`
  — a single top-level disjunction of existing union kinds, each arm already
  individually lowerable (owner → plain `FilterExpr`, membership → correlated
  `EXISTS`; `src/storage.rs` lowers membership predicates into ANDed
  `EXISTS` today, so the work is an OR node in the lowering plus invalidation
  dependencies for both arms).
- Hazards to check (from the ship-run orientation map): RQS/`single_table_v1`
  demotion semantics for disjunctive policies; live-delta path
  (`src/live_matcher.rs:769` forces conservative replace for membership
  predicates — an OR arm containing membership inherits that); index-prefix
  reachability per arm.

## Acceptance

- The Clique Following-feed policy (follows-author OR is-author, no
  self-follow edge) is declarable at the table locus and composes into
  generated plans, with a leak probe (`asUser`) proving both arms and their
  negation.
- Or: a recorded design decision in LLP 0231 OQ1 explaining why disjunction is
  refused and what the sanctioned feed pattern is instead.
