# Applied mutations pay an extra global-lock turn for function_invocation_facts

**Opened:** 2026-08-09 · **Severity:** P3 performance papercut ·
**Owner seam:** src/server.rs `invoke_mutation` response assembly ·
**Found by:** Lane C profiling of
`issues/closed/20260808-p1-commit-turn-overhead.md`

After a mutation commits, `invoke_mutation` re-acquires the global Local
lock via `with_snapback(...)` just to read `function_invocation_facts`
for the response envelope (src/server.rs, facts leg after the staged
write). Measured on the 5.5M-row obs0 burst arm: ~5 ms of lock-held work
plus 15–130 ms of lock-queue wait per applied mutation at burst peak
(durable→200 p50 grew 16.7→53–62 ms while the queue was hot).

Ask: fold the facts read into the commit turn (capture the facts inside
the staged write's `work` closure, where the lock is already held), or
serve it from state that does not need the global writer lock. Response
shape and facts semantics must be byte-identical; the win is one fewer
lock round-trip per applied mutation under burst.
