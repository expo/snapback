# Retrieval eval run — 2026-08-21 — case 73

**Intent:** Provider WebSocket fan-out
**Fixture:** fresh `gpt-5.6-sol` Codex context; read-only; three tool calls.
**Verdict:** PASS — routed to `guide/recipes/provider-lifecycle.md` on tool
call 3, rejected a process-global pool, and named the real-manager
N-cells/one-transport regression.

## Actual prompt

````text
Cold retrieval probe for guide/retrieval-eval.md case 73. You are a provider author new to Snapback. In at most 15 tool calls total, follow repository AGENTS.md and use only guide/index/capability/retrieval routes and the specific Guide pages they lead to; do not inspect implementation source, LLPs, issues, or prior eval-run evidence. Answer this exact intent: "My adapter opens one connection per query and now has too many websockets. Should I add a connection pool?" Produce a concrete provider plan and identify the N-cells/one-transport regression route. End with a numbered transcript of the actual tool calls you used and state which Guide page you loaded and by which tool-call number. Do not edit files.
````

## Actual tool trace

1. `sed -n '1,240p' guide/index.md` — exit 0.
2. `rg -n -i -C 3 'provider|connection pool|websocket|transport|N-cells|one.transport|adapter' guide/capabilities.md guide/retrieval-eval.md` — exit 0.
3. `sed -n '1,280p' guide/recipes/provider-lifecycle.md` — exit 0.

## Final response (verbatim)

````text
No—do not add a process-global connection pool. Add one connection manager above the query cells it serves.

Concrete provider plan:

- Create the `SnapbackClient`, connection manager, external-store registry, and provider once at adapter scope.
- Define one manager per `(application, storage partition, server origin, settled authority)` tuple.
- Mint one stable, readable `connectionId` per manager. Every query cell under that tuple reuses it.
- Deduplicate identical logical queries by canonical `(provider, query, authority, args)` key and refcount their listeners.
- Allow distinct queries to remain distinct logical subscriptions while sharing the manager’s single transport.
- Never share a manager across different authorities or storage partitions.
- Wait for settled authority before subscribing. During `authentication-not-settled`, wait for the provider’s next snapshot—do not poll or add a timeout.
- On authority replacement, dispose predecessor subscriptions before creating the successor manager and subscriptions.
- Let Snapback’s manager handle transport reconnects; do not create fallback sockets or new connection IDs.
- On teardown, dispose cells, provider scopes/registries, and the client if the adapter owns it. Verify connections, subscriptions, socket demand, timers, and listeners all reach zero.
- Keep resource limits qualitative; the Guide does not establish a numeric WebSocket budget yet.

The regression route is the React provider lifecycle fixture named by the Guide:

`packages/snapback-react/package.test.mjs`

Its N-cells/one-transport case mounts six distinct provider cells, waits for six server subscriptions, and asserts:

- `transportOpens === 1`
- one active connection
- six active subscriptions/listeners
- provider disposal closes exactly one transport
- subscriptions reach zero afterward

Use the same shape for your adapter acceptance test, plus owner-scoped inspection through provider `inspection()` and client `localResourceInspection([connectionId])`.

Tool-call transcript:

1. Loaded `guide/index.md` with `sed`.
2. Searched the permitted capability/retrieval routes in `guide/capabilities.md` and `guide/retrieval-eval.md`; case 73 routed this intent to `recipes/provider-lifecycle.md`.
3. Loaded the specific Guide page `guide/recipes/provider-lifecycle.md` with `sed`.

The governing Guide page was loaded on tool call 3.
````
