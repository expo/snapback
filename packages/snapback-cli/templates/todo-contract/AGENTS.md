# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin todo-contract digest=sha256:577c82063cab4a0ad3cab3073f347b63fbe6f9a540067845307970e955ad3603 -->
Mental model first: [Snapback in one screen](/_snapback/guide/start/mental-model.md) — that page
plus this stub is the whole first read (LLP 0259 Rung A).

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the authoritative aggregate `snapback verify`
receipt (acceptance evidence, not formal proof). `npm test`: unwrapped
`acceptance.mjs` debug path. `test:static`: no-server coherence.
`bun run carry:headless`: observations only after `prove`, never proof.
`carry:self-check`: wiring only.
<!-- script-glossary:end -->

Backend + headless. Edit `snapback/{schema,functions}.mjs` and `seed.json`
→ `generate` → `dev` → `prove`; generated files are codegen-owned.
`SnapbackClient` is the consumer; no UI ships. Auth starts in dev mode: switch
to `{ auth: { mode: 'sessions' } }` before users/uploads. Escalate:
`snapback guide <query>`.
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
