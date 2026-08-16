# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin crud-dashboard digest=sha256:b554883fef971228106e7cbf3e82738dd9dc815a7c9f205b05366930f4f089f0 -->
Mental model first: [Snapback in one screen](/_snapback/guide/start/mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

- Loop: edit `snapback/schema.mjs` + `snapback/functions.mjs` +
  `snapback/seed.json` → `bun run generate` → `bun run dev` →
  `bun run prove` — the acceptance command (receipt:
  `.snapback/verify-receipt.json`); carrier kit: `npm run carry:web-browser`.
- Edit targets: those three plus `src/App.tsx`; `snapback/generated/` is
  codegen-owned (commit `generated/artifacts.json`).
- Consumer: `useSnapbackQuery` / `useSnapbackMutation` (with a replayable
  `optimistic:` projection) from `@expo/snapback-react`;
  `projectDirectory` is a relational query joining projects to teams —
  keep its joined uniqueness intact.
- Sessions is the schema default; the sample data and mutations stay
  public so the scaffold works without sign-in UI.
- Escalate one page at a time: `snapback guide <query>`.
<!-- start-packet:end -->

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds
typed control tools with local admin authority. Preview setup with
`snapback agent setup --print <client> --server mcp-control`. With the dev
server running this packet is served at
`http://127.0.0.1:4287/_snapback/guide/start/crud-dashboard.md` (replace the
origin if startup selected another port); `snapback guide <query>` is the
budgeted lookup channel.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); it repeats this packet-first contract.
