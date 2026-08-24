# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin crud-dashboard digest=sha256:80a65071e71bae0aefad443538b0932f3aca8e0c7333dc1ded27f8fcb323a5fc -->
Mental model: [Snapback in one screen](/_snapback/guide/start/mental-model.md); with this stub it is
the whole first read.

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt (acceptance evidence, not formal proof). `npm test`: unwrapped
`acceptance.mjs` debug path. `test:static`: no-server coherence.
`bun run carry:headless`, `bun run carry:web-browser`: observations only after `prove`, never proof.
`carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `src/App.tsx` →
`generate` → run `dev` (backend) and `dev:client` (Vite) in separate terminals
→ `prove`; generated files are codegen-owned. The consumer
uses `useSnapbackQuery` / `useSnapbackMutation`. Keep `projectDirectory`'s
team-join uniqueness. Sample data/mutations are public for sign-in-free demos,
not a production auth pattern. Escalate: `snapback guide <query>`.
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
