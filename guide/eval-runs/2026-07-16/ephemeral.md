# Retrieval eval run — 2026-07-16 — intent 2 (ephemeral)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5).
**Fixture:** fresh Codex subagent with no conversation context, cold in the
Snapback checkout at `2a372af`, instructed to read `AGENTS.md` first and
then plan “Let two users of my Snapback app see each other's cursors”
(read-only; no writes).
**Run:** the relevant recipe was loaded at tool use 7, within the ~15-use
retrieval budget. The agent continued beyond retrieval to verify the complete
implementation and acceptance contract.

## Rubric

- **(a) Loads the relevant guide page(s) within ~15 tool uses: PASS.**
  Reading order through retrieval: LLP orient instructions and root LLP →
  `guide/index.md` (tool use 5) → `guide/capabilities.md` (6) →
  `guide/recipes/presence-cursors.md` (7). Supporting target, authoring-loop,
  and acceptance pages were loaded at uses 12–14.
- **(b) Plans with the paved technique: PASS.** The plan uses
  `defineEphemeral` with scoped/routed latest-state values, generated
  descriptors, `subscribeEphemeral`, the overlay snapshot/delta model, a
  bounded leading/trailing publisher, honest connection state, fresh
  resubscription after resync, and two-client acceptance.
- **(c) Avoids the named anti-patterns: PASS.** It explicitly rejects durable
  cursor tables, polling, raw ad-hoc WebSockets, caller-invented presence keys,
  publish-budget violations, reset-on-mount, and offline retention of cursor
  state. It makes no hosted-target claim.

**Verdict: PASS.**

Together with the 2026-07-15 realtime run and the auth run beside this file,
this completes the three-intent Phase 1 retrieval baseline.

## Agent tool transcript

1. Read the LLP-orient instructions and confirmed a read-only context workflow.
2. Read root LLP 0000, lines 1–260.
3. Read root LLP 0000, lines 261–620.
4. Read root LLP 0000, lines 621–980.
5. Loaded `guide/index.md`.
6. Loaded `guide/capabilities.md`; found `realtime.ephemeral` pointing to
   the presence-cursors recipe and marked local/shipped.
7. Loaded `guide/recipes/presence-cursors.md`, the direct intent match.
8. Searched the cursor demo and guide for collection, subscription, connection,
   resync, budget, and `@ref` usage.
9. Read the cursor demo schema and React hook.
10. Read LLP 0013, lines 1–420.
11. Read LLP 0013, lines 421–900.
12. Loaded `guide/auth/targets.md`.
13. Loaded `guide/getting-started/the-authoring-loop.md`.
14. Loaded `guide/testing/acceptance.md`.
15. Enumerated cursor-demo acceptance files.
16. Read the relevant React browser-acceptance excerpts.
17. Located LLP 0034 sections and read its conformance context.
18. Read LLP 0034 through §6, including the target referenced by the hook.

## Agent plan (retained)

1. Declare a scoped ephemeral collection beside durable tables: room/board
   scope and routing, `key: 'connection'`, bounded TTL/value/rate budgets,
   latest-state delivery, and explicit publish/subscribe rules.
2. Regenerate and commit the generated artifacts.
3. Health-check and provision idempotently on boot; never reset on mount.
   Create a fresh connection identity for the subscription lifecycle.
4. Subscribe through `subscribeEphemeral(collectionRef, { connectionId,
   scope })`; render `overlay.currentEntries()` and identify self by the
   connection key.
5. Publish pointer coordinates below the generated budget. Drive the local
   self cursor immediately outside the React render path while network
   publication updates peers.
6. Render the connection axis honestly. On `needs_resync` or socket regain,
   mark stale and take a fresh ephemeral snapshot; never durable-resume it.
7. Dispose the overlay, listeners, and timers. Let server expiry prune healthy
   rooms and freeze the last renderable map while stale/disconnected.
8. Prove two real clients see each other, room isolation holds, rate rejection
   is observable, TTL/disconnect removes presence without durable writes,
   reconnect converges, and durable traffic is not starved.

Anti-patterns named by the agent: durable tables, polling or raw socket glue;
caller-invented identity; blind over-budget retries; connection-id reuse across
lifecycles; reset on mount; offline cursor retention; hand-edited generated
artifacts; and hosted claims for the local-only capability.
