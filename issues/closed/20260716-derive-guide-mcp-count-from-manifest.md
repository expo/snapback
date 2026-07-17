# Derive the Guide MCP resource count from its manifest

**Status:** Closed
**Severity:** P1
**Systems:** Guide, MCP, Acceptance tests, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0061 §4 — Distribution and discovery
**Marker:** build-integrity, guide, regression

The Guide MCP integration test hard-coded 27 guide pages even though the
manifest-derived runtime correctly began serving the 28-page corpus after the
RBAC guide was added. The canonical proof therefore failed with 30 resources
observed versus 29 expected, while the Guide checker correctly reported all 28
pages.

**Done when:**

- The integration test derives its expected page count from the exact embedded
  manifest returned by the MCP server.
- It continues to require exactly the manifest, flat projection, and every
  manifest page, all bound to one build identity.
- The focused MCP integration test and canonical proof pass.

## Resolution

Closed 2026-07-16. The MCP integration test now parses the returned embedded
manifest before checking the resource catalog and derives the expected count
as `pages + 2`. This keeps the end-to-end assertion closed over the exact
build-bound corpus without duplicating a page-count constant.
