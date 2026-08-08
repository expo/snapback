# MCP control server: unencoded args in admin URLs + `close()` can orphan the native server

**Opened:** 2026-08-08 · **Severity:** P2 (curated-authority boundary bypass in local dev; orphaned managed process) · **Area:** snapback-cli MCP

Two defects in `packages/snapback-cli/mcp-control.mjs`, both where the code
diverges from its own sibling patterns.

## A) Tool args interpolated into admin URLs without encoding

`mcp-control.mjs:1814, 1844`:

```js
`/_snapback/api/data/${args.table}`   // data.scan
`/_snapback/api/jobs/${args.id}`      // jobs.show
```

`callTool` never validates args against the advertised `inputSchema`, and
sibling tools (`cron_run` :1873, `connection_disconnect` :1901) use
`encodeURIComponent` while these two do not. An MCP client can pass
`table: "../telemetry/export"` or `id: "../data/users?limit=500"`; the string
lands in `new URL(...)` with the auto-minted admin token attached, reaching
admin routes outside the curated tool surface and outside the per-tool
secret-read-lease scoping. Server-side gates may blunt impact, but the
curated-authority boundary is bypassable.
*Fix:* `encodeURIComponent` both, and reject `/ ? #` before minting the lease.

## B) `close()` can orphan the managed native server

`mcp-control.mjs:2254-2263` (stopEnvelope 1659-1710):

```js
try { await this.stopEnvelope(requestId()); } catch { this.child.kill('SIGTERM'); }
```

guarded by `existsSync(this.readyFile)`. But `stopEnvelope` reports most
failures by *returning* an `ok:false` envelope, not throwing (missing
admin-token carrier, native stop `ok:false`, deleted ready file → the
`existsSync` guard skips `close()` entirely). In each case the spawned child
keeps running with no SIGTERM fallback, holding its port; the child handle is
never `unref()`d so the MCP node process cannot exit after stdin closes. This
contradicts the "Never leave a managed child orphaned" comment.
*Fix:* inspect the returned envelope and kill whenever `ok !== true`; drop the
`existsSync` precondition for the kill fallback.

## Confidence

High on both inconsistencies; medium on blast radius (local dev threat model).
