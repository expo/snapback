# Retrieval eval run — 2026-08-06 — typing indicator (seed case 5)

**Protocol:** guide/retrieval-eval.md (LLP 0061 §5; seed case added by LLP
0187 T7 / LLP 0186 W2 from the 1/3 bakeoff vocabulary-split miss, where a
grep for `useSnapbackEphemeral` concluded "there is no React hook").
**Fixture:** fresh Claude subagent with no inherited conversation context,
cold in the Snapback worktree checkout at `42218ccae`, instructed to read
`AGENTS.md` first and then plan (read-only) "add a typing indicator" for a
React chat app.
**Run:** `guide/index.md` at tool use 2 (its map names the ephemeral page as
covering typing indicators and `useSnapbackPresence`), capability index at
tool use 3 ("typing indicator" matched verbatim in the `realtime.ephemeral`
alias row), `guide/realtime/ephemeral-state.md` at tool use 4. Seven tool
uses total.

## Rubric

- **(a) Loads the relevant guide page within ~15 tool uses: PASS.**
  `realtime/ephemeral-state.md` at tool use 4; the client half
  (`clients/react.md` §Publish and observe ephemeral presence) at tool
  use 6. The route ran through both vocabulary registers: the workload term
  ("typing indicator") hit the alias row, and the page bridged to the hook.
- **(b) Plans with the paved technique: PASS.** `defineEphemeral` collection
  (connection-keyed, conversation-scoped, TTL backstop, rate limits) plus
  `useSnapbackPresence` with `value: skip` observer semantics and the closed
  state machine; self-filtering by `selfKey`, never a readable label; the
  local-target-only caveat carried.
- **(c) Avoids the named anti-patterns: PASS.** Explicitly rejected storing
  `isTyping` in a durable table with a live query, hand-rolling the React
  lifecycle over `subscribeEphemeral` with `useEffect`/timers, and inventing
  a `useSnapbackEphemeral` hook — the last preempted verbatim by the pages'
  "there is no separate `useSnapbackEphemeral` hook" bridges.

**Verdict: PASS.** The bakeoff's schema-side/client-side vocabulary split
did not reproduce; the agent reached the hook from the workload-term entry
point and the wrong-guess symbol was named (and disarmed) by the corpus.

## Agent tool transcript

1. Read `AGENTS.md` — steered to the guide.
2. Read `guide/index.md` — map named the ephemeral page incl.
   `useSnapbackPresence`.
3. Grep of `guide/capabilities.md` for typing/ephemeral/presence — matched
   the `realtime.ephemeral` and `clients.react` rows.
4. Read `guide/realtime/ephemeral-state.md` — the CI-verified typing example.
5. Grep of section headings in `clients/react.md` and
   `recipes/presence-cursors.md`.
6. Read `guide/clients/react.md` (presence section) and
   `guide/recipes/presence-cursors.md`.
7. Grep of the shipped `chatTyping` schema fixture in
   `demos/improvement-sweep`.
