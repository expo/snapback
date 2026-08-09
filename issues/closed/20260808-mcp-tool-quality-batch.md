# MCP tool-quality batch: wrong readOnlyHint, no outputSchema, unvalidated args, resource bloat

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P1 (readOnlyHint) / P2 (rest) · **Area:** mcp-control.mjs / guide_mcp.rs

From the 2026-08-08 agentic surface audit (LLP 0202 theme 9).

1. **`snapback_asset_export_cut` is annotated `readOnlyHint: true` while
   writing to the host filesystem** — its own description concedes it writes
   "the consistent-cut manifest and every referenced blob object … into an
   empty directory on the server host"
   (`packages/snapback-cli/mcp-control.mjs:891-900`; catalog row agrees
   `behavior.readOnly: true`). Harnesses auto-approve `readOnlyHint` tools,
   so this is a safety-semantics bug, not a papercut. Fix:
   `readOnlyHint: false` (app state is read-only; the host filesystem is
   not), keep `destructiveHint: false`; re-audit the annotation test's
   assumptions (`mcp-control.test.mjs:221-244`).
2. **No tool on either server declares `outputSchema`** despite every call
   returning `structuredContent` (`mcp-control.mjs:2116-2122`; `listTools`
   `:2125-2144`); the generated app-data tools literally record
   `outputSchema: 'unknown'` with a self-disclosed note (`:266,:279-287`).
   Fix: declare the shared `hostOpsResult` schema on all 42 pinned tools.
3. **Arguments are not validated against the declared `inputSchema`, and two
   path segments bypass the hardened encoder** — raw `encodeURIComponent`
   for `cron.runOne`'s `name` (`:1894`) and `connectionId` (`:1922`) versus
   the typed `encodedAdminPathSegment` used at `:1829,:1864`; an omitted
   `name` yields `/_snapback/api/cron/undefined/run` → HTTP 404 instead of a
   typed `SNAPBACK_MCP_ARGUMENT_INVALID`. (The closed
   `20260808-mcp-admin-url-arg-injection-and-orphan.md` covered only
   `table`/`id`.) Fix: route every segment through the typed encoder; reject
   missing required fields before dispatch.
4. **108 of 111 guide resources share a path-echo description**
   (`src/guide_mcp.rs:126`) though the manifest carries per-page
   `capabilities`/`status`/`maturity`. Fix: compose descriptions from those
   fields.
5. **`tools/list` ships the app-data catalog twice**
   (`mcp-control.mjs:2148` whole catalog in `_meta` + `:2143` full per-tool
   entries duplicating each tool's own `inputSchema`). Fix: trim per-tool
   `_meta` to `functionId` + `capabilityGaps` + `syncabilityClass`.
6. **No guide-search tool anywhere in MCP.** LLP 0042 deliberately forbids
   tools on the resource-only server, but `mcp-control` already has 42 tools
   and re-serves the guide (`:2164-2169`) — none searches docs. Fix: a
   `snapback_guide_search` tool wrapping the existing
   `guide_reference::lookup`/section search.
7. **Every guide/catalog resource operation spawns a fresh native child**
   (`spawnSync(binary, ['mcp'])` per call, `:1025-1031`; `listResources`
   does two, `:2158-2169`). Fix: memoize per `catalogDigest` for the process
   lifetime.

Adjacent, already tracked in `issues/20260808-tooling-robustness-papercuts.md`:
the `snapback_run_function` missing-catalog authority-gate default and the
unguarded `functions.manifest.json` parse.

## Resolution (2026-08-08)

The MCP control surface now marks asset export as host-filesystem-mutating
(`readOnlyHint: false`, still non-destructive), and the generated control
catalog agrees. All pinned and generated tools declare one shared
`hostOpsResult` output schema. Every call is validated against its published
input schema before dispatch, invalid calls return
`SNAPBACK_MCP_ARGUMENT_INVALID`, and all dynamic path segments pass through
the typed encoder.

Guide resource descriptions now derive from manifest status, maturity, and
capabilities. App-data tool metadata is reduced to function identity,
capability gaps, and syncability. The control server adds
`snapback_guide_search` over the native exact-symbol/section-search path while
the Guide MCP remains resource-only. Native Guide/catalog projections and
searches are memoized by build catalog digest for the server process lifetime.
The MCP acceptance covers safety annotations, schema declarations and
validation, both Guide search modes, lean metadata, encoded-path refusals, and
digest-keyed memoization.
