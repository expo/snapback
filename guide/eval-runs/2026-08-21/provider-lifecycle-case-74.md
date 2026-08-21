# Retrieval eval run — 2026-08-21 — case 74

**Intent:** Provider auth rebuild
**Fixture:** fresh `gpt-5.6-sol` Codex context; read-only; five tool calls.
**Verdict:** PASS — routed to `guide/recipes/provider-lifecycle.md` on tool
call 5 and used the documented blocked states plus teardown-before-rebuild
without polling, timeout, or predecessor connection rebind.

## Actual prompt

````text
Cold retrieval probe for guide/retrieval-eval.md case 74. You are a provider author new to Snapback. In at most 15 tool calls total, follow repository AGENTS.md and use only guide/index/capability/retrieval routes and the specific Guide pages they lead to; do not inspect implementation source, LLPs, issues, or prior eval-run evidence. Answer this exact intent: "I need a provider adapter pattern that can rebuild stream on auth without a timeout." Produce a concrete auth-transition and teardown plan using the documented provider states. End with a numbered transcript of the actual tool calls you used and state which Guide page you loaded and by which tool-call number. Do not edit files.
````

## Actual tool trace

1. `sed -n '1,240p' skills/snapback-authoring/SKILL.md` — exit 0.
2. `sed -n '1,240p' guide/index.md` — exit 0.
3. `rg` searched only `guide/index.md` and `guide/capabilities.md` for the provider/auth/stream route terms — exit 0.
4. `sed` read the matching routing excerpts from `guide/index.md` and `guide/capabilities.md` — exit 0.
5. `sed -n '1,280p' guide/recipes/provider-lifecycle.md` — exit 0.

## Final response (verbatim)

````text
Use one adapter-scoped manager per `(application, storage partition, server origin, settled authority)` tuple. Share its stable `connectionId` across query cells; never reuse a manager across authorities.

Auth-transition plan:

1. Signed out: expose protected queries as `status: "blocked"`, `reason: "authentication-required"`, `transitionOwner: "auth-coordinator"`.
2. During sign-in, sign-out, or authority replacement: expose `status: "blocked"`, `reason: "authentication-not-settled"`, with the same transition owner.
3. While blocked, start no live transport. Wait for the next provider snapshot—no timeout, polling, or guessed settlement.
4. On a principal-class change, quiesce and dispose every predecessor-owned subscription before opening anything for the successor.
5. Once successor authority is settled, create a new manager/connection for its tuple and start a fresh snapshot-with-subscribe. Never rebind the predecessor’s session stream to the new bearer.
6. For ordinary transport loss under unchanged authority, let the client’s bounded reconnect/resubscribe machinery recover the stream; do not rebuild the provider or add another retry loop.
7. Keep update callbacks non-reentrant: copy rows and lifecycle facts into the adapter store, return, and schedule further lifecycle work at a microtask/effect boundary.

Teardown plan:

1. Each cell releases its listener.
2. The final listener releases the logical subscription.
3. Dispose predecessor query owners before constructing successor owners.
4. Await each handle’s `settled()` only to observe its cleanup boundary; it does not replace `dispose()`.
5. Dispose the provider and its scopes/registries.
6. Await `client.close()` only when the adapter owns the client.
7. Verify inspection reports zero active connections, subscriptions, socket demand, timers, and listeners.

Tool-call transcript:

1. Loaded the required `snapback-authoring` skill instructions with `sed`.
2. Loaded Guide routing page `guide/index.md` with `sed`.
3. Searched only `guide/index.md` and `guide/capabilities.md` with `rg` for provider/auth/stream routing terms.
4. Read the relevant routing excerpts from `guide/index.md` and `guide/capabilities.md` with `sed`.
5. Loaded the specific Guide page `guide/recipes/provider-lifecycle.md` with `sed`.

The substantive Guide page was `guide/recipes/provider-lifecycle.md`, loaded on tool call 5.
````
