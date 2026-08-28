# Building this Snapback app

<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->
<!-- start-packet:begin media-feed digest=sha256:1b7d57cd1e10b67ef9be2dc79a45afc784ce6bfb287bb55c655a31e7fc40ebfb -->
Read [Snapback in one screen](/_snapback/guide/start/mental-model.md); with this stub it is the
whole first read.

<!-- script-glossary:begin -->
## Scripts

`prove`: only done-oracle; writes the `snapback verify` receipt. `npm test`:
acceptance debug. `test:static`: no-server. `carry:*`: post-proof observations.
<!-- script-glossary:end -->

Edit `snapback/{schema,functions}.mjs`, `seed.json`, `App.tsx`, and
`pagination.mjs` → `generate` → `dev` (backend + env) and `dev:client` (Metro)
in terminal 2 → `prove`; `dev:supervised` is optional. Android emulator: set
printed `androidEmulatorUrl` as `EXPO_PUBLIC_SNAPBACK_URL`; restart Metro.
Plain dev refuses stale `SNAPBACK_DEV_{CLIENT,BOOTSTRAP}_PORT` pins.
`publishEntry` owns upload/finalize/attach. Base64 video or data-URI media is
row data under the 32 KiB ceiling, not an upload. Paginate on immutable
`pageKey`; escalate with `snapback guide <query>`.
<!-- start-packet:end -->

## Operate it

`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds
typed control tools with local admin authority. Preview setup with
`snapback agent setup --print <client> --server mcp-control`. With the dev
server running this packet is served at
`http://127.0.0.1:4287/_snapback/guide/start/media-feed.md` (replace the
origin if startup selected another port); `snapback guide <query>` is the
budgeted lookup channel.

This app ships the `snapback-authoring` agent skill at
`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,
`.cursor/`, and `.opencode/`); it repeats this packet-first contract.
