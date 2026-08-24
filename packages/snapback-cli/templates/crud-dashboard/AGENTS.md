# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin crud-dashboard digest=sha256:d558c0bce901b8fb47e342e247bfc475544637887b4bb078ed621e9dbfb82c7c -->
Read [Snapback in one screen](/_snapback/guide/start/mental-model.md); with this stub it is the
whole first read.

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the authoritative `snapback verify` receipt.
`npm test`: acceptance debug path. `test:static`: no-server coherence.
`carry:*`: observations after `prove`; `carry:self-check`: wiring only.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `src/App.tsx` →
`generate` → `dev` (backend + env) and `dev:client` (Vite) in terminal 2 →
`prove`. Expo has optional `dev:supervised`; Android emulators manually paste
printed `androidEmulatorUrl` (`10.0.2.2`) and restart Metro. Remove leftover
`SNAPBACK_DEV_CLIENT_PORT` / `SNAPBACK_DEV_BOOTSTRAP_PORT`; plain dev refuses
them with `SNAPBACK_CLI_ARGUMENT_INVALID`. Generated files are owned. Keep
`projectDirectory` team-join uniqueness; demo-public mutations are not a
production auth pattern. Escalate: `snapback guide <query>`.
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
