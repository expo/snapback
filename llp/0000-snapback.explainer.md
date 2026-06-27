# LLP 0000: Snapback

**Type:** Explainer
**Status:** Draft
**Systems:** Project
**Role:** Root
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-06-27
**Related:** https://github.com/ccheever/llp

## Summary

Snapback is the root project for this repository. [observed: repository path
`/Users/ccheever/projects/snapback` and remote
`https://github.com/ccheever/snapback.git`]

The product purpose, runtime architecture, and implementation boundaries are
not documented in the repository yet. Keep this document in `Draft` until a
human confirms the project intent and the first real subsystem boundaries.

## Current Repository State

At LLP adoption time, the repository contains no application source files or
project documentation beyond the LLP scaffold. [observed: `rg --files` returned
no tracked project files before scaffold creation]

## LLP Adoption

This repository keeps its LLP corpus directly in `llp/`, without a submodule for
the documents themselves. The adopted pieces are:

- `llp/` for project-local LLP documents.
- `AGENTS.md` for agent-facing LLP rules.
- `ref-check` for deterministic LLP metadata and reference validation.
- `.github/workflows/ref-check.yml` to run validation in CI.
- `skills/` as a project skill aggregate; its entries are symlinks into
  branch-tracking upstream submodules under `vendor/llp` and
  `vendor/ccheever-skills`.
- agent-local discovery symlinks from `.agents/skills`, `.claude/skills`,
  `.cursor/skills`, `.pi/skills`, and `.opencode/skills` to `skills/`.
- `scripts/sync-agent-skills` and `.githooks/` to refresh project skill links
  after normal checkout/merge operations.

## Next Decisions To Capture

As soon as the project has concrete direction, update this document with:

- What Snapback does and who it is for.
- The first major subsystem boundaries.
- Non-obvious constraints that future code should preserve.
- Links to follow-on LLPs for architectural choices, implementation plans, or
  design principles.
