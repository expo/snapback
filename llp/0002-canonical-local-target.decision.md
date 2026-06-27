# LLP 0002: Canonical local dev/test target

**Type:** Decision
**Status:** Accepted
**Systems:** Runtime, Storage, Developer experience, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-06-25
**Revised:** 2026-06-26
**Related:** LLP 0000, LLP 0001, LLP 0003, LLP 0004, LLP 0006, LLP 0009, LLP 0010, LLP 0014, https://github.com/ccheever/ibex

## Summary

The canonical environment for building, running, and validating Snapback is the
full server — code hosting *and* data store — running **locally on your machine
via Ibex + SQLite**. This is the *first standard target*; other configurations
are valid, and more may be standardized later.

## Context

- Snapback is agent-first: agents must build, run, and validate their work
  against a known environment, so a single canonical target makes those
  validation loops reproducible. (LLP 0000, agent-first DX.)
- Snapback can run several ways — a full local server (Ibex + SQLite), a V8-based
  runtime, Postgres at scale, Cloudflare, and partial setups such as running only
  the Wasm part of the sync engine in the browser.
- Without a designated standard, tests, reference apps, CI, and agents would each
  pick differently and "works on my setup" drift sets in.

## Options

- **A — Full local server on Ibex + SQLite (chosen).** Code hosting + data store
  on your machine. Matches the Valet shape, exercises the real runtime + store +
  server boundary, needs no cloud, and gives the fastest loop.
- **B — Partial / browser setups** (e.g. Wasm sync engine in the browser). Valid
  and useful for specific tests, but not a full-stack standard.
- **C — Cloud / V8 / Postgres / Cloudflare targets.** Real deployment targets,
  but heavier and less reproducible as the default dev/test loop, and dependent
  on external infrastructure.

## Decision

Standardize on **A** as the *first standard target*: the whole server (code
hosting + data store) running locally via Ibex + SQLite. Reference apps and the
acceptance suite run here by default; agent build→run→validate loops assume it;
tooling and CI should make it a one-command default. "First standard" is
deliberate — additional targets (browser Wasm sync, Postgres, Cloudflare) may be
standardized later. Local success is necessary but not sufficient: it must not
be treated as proof that Postgres, Cloudflare, or other deployment profiles work.

## Consequences

- The reference apps (LLP 0000) and the future acceptance suite default to this
  baseline.
- Agent validation loops target it; the feedback loop is local and fast.
- The application data API (LLP 0004) should be validated here first: schema,
  generated functions, `ctx.db`, generated client calls, and live query updates
  all need to work against the canonical target before broader deployment work.
- It exercises Ibex + SQLite + the local-server boundary — the same shape as
  Valet — so Valet's empirical failures (recovered in
  [LLP 0006](./0006-valet-retrospective.research.md); noted in
  [LLP 0001](./0001-prior-art.research.md)) bear directly on making this
  solid.
- The SQLite↔Postgres portability contract (LLP 0000) matters more here: local
  SQLite testing must predict Postgres behavior, or the standard target gives
  false confidence.
- Tooling should provide a one-command bootstrap, seeding/fixtures and reset, and
  a way to exercise realtime + partial sync against a purely-local server.
- CI should be able to run the canonical target headlessly, or the project should
  define an explicit CI surrogate and document what it does not cover.
- The next standard target should likely be Cloudflare, matching LLP 0000's
  implementation order; local-first standardization should not crowd out the
  Cloudflare strategy.
- The local target should eventually exercise the same code-execution sandbox,
  secret handling, and app/tenant isolation model as hosted targets.

## Open questions

- The exact bootstrap (a single command?), fixtures/seeding, and reset story.
- How realtime + partial sync are exercised against a purely-local server.
- Parity gaps between local SQLite and production Postgres that could make local
  tests misleading.
- How Ibex and the local server are packaged for macOS, Linux, and CI.
- How the local target represents filesystem/object storage and notification
  providers without external services.
- How code sandboxing and tenant isolation are tested locally.
- Which Cloudflare profile becomes the second standard target (strategy drafted
  in [LLP 0014](./0014-cloudflare-strategy.rfc.md)).
- When and whether to promote additional standard targets.

> **Status note.** Accepted by Charlie Cheever on 2026-06-26 as the canonical
> first development and test target.
