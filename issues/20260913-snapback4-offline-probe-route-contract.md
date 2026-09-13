# Snapback 4: Client offline probe targets nonexistent /q/__probe and relies on 404 status

Status: Open
Priority: P2
Observed: 2026-09-13
Review finding: E01
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [local.ts](../snapback4/packages/snapback4/src/local.ts), [client.ts](../snapback4/packages/snapback4/src/client.ts), [native.ts](../snapback4/packages/snapback4/src/native.ts), [serve.rs](../snapback4/crates/snapback4/src/serve.rs)

## Problem and reproduction

In the client implementations (`local.ts:266`, `client.ts:201`, `native.ts:303`), when a client is in the `"offline"` link state, it periodically probes server connectivity:

```typescript
if (!closed && !sessionDead) await post("/q/__probe", {});
```

The server (`serve.rs:421-425`) routes `/q/:op` by looking up the operation in registered program definitions:

```rust
let program = shared.bound.lock().unwrap().programs.iter().find(|p| p.program.name == op).map(|p| p.program.clone());
let Some(program) = program else {
    respond(request, 404, json!({ "denied": refusal_json(&Refusal::new("E_OP", "op", format!("unknown operation {op}")).guide("programs")) }));
    return;
};
```

Because `__probe` is not a registered user program, the server returns:
`404 Not Found` with `denied: { code: "E_OP", family: "op", message: "unknown operation __probe" }`.

The client's `post` / `sendPost` function contains:
```typescript
if (response.status >= 500) { setLink("offline"); return { ok: false }; }
...
if (link !== "online" && credentials) setLink("online");
```

Because `404 < 500` and the refusal code is `E_OP` (not `E_AUTH`), the client considers the probe a success and transitions `link` to `"online"`.

### Flaws & Consequences:
1. **Server log pollution**: In production and development logs, every client reconnection spam-logs `E_OP: unknown operation __probe`, polluting monitoring tools and alarming operators.
2. **Proxy / CDN False Positives**: If an intermediate proxy, API gateway, ingress controller, or CDN sits between the client and server and returns a 404 or 403 when the upstream server is down or unrouted, the client falsely assumes the backend is healthy and transitions `link` to `"online"`, leading to thrashing retry loops.
3. **No Dedicated Liveness Contract**: There is no standard `/health` or `GET /health` / `POST /health` endpoint defined in the server or TypeScript contract.

## Acceptance

- Define an explicit health / probe route on the server (e.g. `GET /health` or a top-level `/probe` returning `200 OK` `{ "ok": true }`).
- Update `local.ts`, `client.ts`, and `native.ts` to probe the explicit health endpoint and require a `200 OK` response before transitioning `link` to `"online"`.
- Verify that reconnecting from an offline state does not log `E_OP: unknown operation __probe` on the server.

## Implementation locations

- [crates/snapback4/src/serve.rs](file:///Users/ccheever/projects/snapback/snapback4/crates/snapback4/src/serve.rs) (`handle_request`)
- [packages/snapback4/src/local.ts](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/local.ts#L263-L268) (`waitForChange`)
- [packages/snapback4/src/client.ts](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/client.ts#L198-L203) (`poll`)
- [packages/snapback4/src/native.ts](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/native.ts#L300-L305) (`waitForChange`)
