# Retrieval eval summary — 2026-08-21 — provider lifecycle

Cases 70, 73, and 74 were rerun as three independent cold
`gpt-5.6-sol` Codex contexts after the review fix. Each run was read-only,
limited to 15 tool calls, and barred from implementation source, LLPs, issues,
and prior eval evidence.

**Verdict: PASS (3/3).** Each intent independently routed to
`guide/recipes/provider-lifecycle.md` and produced the required lifecycle plan
without the prohibited connection-pool, timeout/polling, or auth-rebind
patterns.

- [Case 70 — provider connection lifecycle](./provider-lifecycle-case-70.md)
- [Case 73 — provider WebSocket fan-out](./provider-lifecycle-case-73.md)
- [Case 74 — provider auth rebuild](./provider-lifecycle-case-74.md)

Each linked record retains the exact submitted prompt, the actual tool-command
trace, and the verbatim final response from that fresh context.
