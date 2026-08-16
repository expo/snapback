# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin todo-contract digest=sha256:b16be0861943e1b1d92e99ce4c6b625e797e5e06b216f3be1867da9a8fc87b32 -->
Mental model first: [Snapback in one screen](/_snapback/guide/start/mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

- This starter is backend + headless client only — no UI ships. Want a UI
  out of the box? Scaffold `react` or `expo-chat` instead.
- Loop: edit `snapback/schema.mjs` + `snapback/functions.mjs` +
  `snapback/seed.json` → `bun run generate` → `bun run dev` →
  `bun run prove` — the acceptance command (receipt:
  `.snapback/verify-receipt.json`); carrier kit: `npm run carry:headless`.
- Consumer: the headless `SnapbackClient` — `client.query(api.listTodos,
  {})` and `client.mutate(api.createTodo, …)` as `acceptance.mjs` shows.
- Auth: dev mode; flip to `{ auth: { mode: 'sessions' } }` before users or
  uploads.
- `snapback/generated/` is codegen-owned (commit
  `generated/artifacts.json`).
- Escalate one page at a time: `snapback guide <query>`.
<!-- start-packet:end -->

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds
typed control tools with local admin authority. Preview setup with
`snapback agent setup --print <client> --server mcp-control`. With the dev
server running this packet is served at
`http://127.0.0.1:4287/_snapback/guide/start/todo-contract.md` (replace the
origin if startup selected another port); `snapback guide <query>` is the
budgeted lookup channel.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); it repeats this packet-first contract.
