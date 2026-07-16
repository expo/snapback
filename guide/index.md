---
title: The Snapback Guide
id: meta.index
order: 1
audience: agent-first
capabilities: [operating.served-guide]
authorities: [llp/0061-agent-first-snapback-guide.rfc.md, llp/0000-snapback.explainer.md]
examples: [demos/todo, demos/todo-v2, demos/cursors-web, demos/card-game]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-07-15
reviewed-commit: HEAD
---

<img src="../brand/snapback-mark.svg" alt="Snapback" width="96" />

# The Snapback Guide

How to build an application **on** Snapback — a complete backend that
scales to zero and back up: schema and functions, server-authoritative
data, live queries, ephemeral realtime, auth, and the client arms — taught
intent-first, with code that ran in CI.

**Audience:** agents (primarily) and humans (secondarily) building on
Snapback. In a checkout, read this corpus directly. Outside a checkout, a
running Snapback server exposes the same build-bound corpus at
`GET /_snapback/guide`, individual paths below that prefix, and the complete
single-request projection at `GET /_snapback/guide/flat.md`. Those responses
carry `x-snapback-guide-content-sha256` and
`x-snapback-server-build-commit`, so a consumer can refuse to combine cached
guide bytes with a different server build. Building Snapback itself is a
different job — that's `AGENTS.md` and the LLP corpus, not this guide.

**Start every task here:** check the
[capability index](./capabilities.md) first — it lists everything Snapback
has, including what this guide doesn't cover yet (explicit GAP rows), so
you never build around a feature because you didn't know it existed.

## The map

### Getting started
- [Your first backend](./getting-started/your-first-backend.md) — schema,
  functions, handlers, seed, codegen, load, query.
- [The authoring loop](./getting-started/the-authoring-loop.md) — edit →
  regenerate → acceptance test → inspect.

### Realtime
- [Live queries](./realtime/live-queries.md) — subscriptions, snapshot +
  replace/delta, durable push, the connection axis.

### Auth
- [Sessions and principals](./auth/sessions-and-principals.md) — the server
  derives who you are; scoped queries; logout barriers.
- [Targets — what each one claims](./auth/targets.md) — local vs hosted
  honesty; how to check the server instead of trusting prose.

### Clients
- [The Contract adapter](./clients/contract-adapter.md) — generated
  bindings, one-surface boot, derived optimistic overlays, offline classes.
- [The React arm](./clients/react.md) — hand-wired client, live queries in
  hooks, honest connection state.

### Testing
- [Acceptance testing](./testing/acceptance.md) — headless-first harness,
  vacuous-pass protection, safe server lifecycle.

### Recipes
- [Presence cursors](./recipes/presence-cursors.md) — ephemeral rooms, TTL,
  publish budgets (the cursors-web demo, distilled).
- [Hidden hands](./recipes/hidden-hands.md) — per-principal secrecy, logout
  blanking, lease-bounded offline retention (card-game, distilled).

### Meta
- [Capability index](./capabilities.md) — everything Snapback has, covered
  or GAP.
- [Conventions](./conventions.md) — page rules, snippet classes, link
  policy, freshness.
- [Retrieval eval protocol](./retrieval-eval.md) — how we verify a cold
  agent actually finds these pages.

## How to trust the code here

Every `js`/`ts`/`contract` snippet marked `source=` is a verbatim excerpt
of a file CI executes end-to-end — `scripts/check-guide.mjs` fails the
build if a snippet drifts from its source. Prose can rot; these can't
silently. Pages carry `targets:` and `maturity:` frontmatter so a claim's
scope is always explicit ([conventions](./conventions.md)).

The deeper design rationale lives in the LLP corpus (`llp/`) — every page's
`authorities:` frontmatter names its sources. The demos (`demos/`) are the
full working applications these pages distill.
