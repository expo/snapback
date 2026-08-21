# Bugboard

A small React + Vite bug tracker powered by Snapback. Issues update live and
support creation, priority, filtering, and status changes. The Snapback npm
packages are pinned to the `0.1.24` release that held the `latest` tag when
the demo was created on 2026-08-17.

```sh
bun install
bun run --cwd demos/bug-tracker dev
bun run --cwd demos/bug-tracker prove
```

The proof writes `.snapback/verify-receipt.json`. It covers a fresh local
sessions server, the live list, creation, and a status update. This demo does
not claim hosted deployment, multi-tenant isolation, visual browser acceptance,
or complete read/write provenance in the registered-path aggregate.

Read `AGENTS.md` before adding features. With the dev server running, the
served guide and capability index live at
`http://127.0.0.1:4287/_snapback/guide/index.md` (or run
`snapback guide <query>`).
