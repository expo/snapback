# Snapback website — https://snapback.expo.app

The public web surface (author-directed 2026-08-08): a placeholder product
page at `/`, immutable documentation snapshots at `/v/<closure>/`, `/latest/`
as the moving alias for the newest assembled snapshot, `/guide/` as a
compatibility alias, `/docs/` redirecting to `/latest/`, and a root
`/llms.txt` for agents. Hosted on EAS Hosting (project
`@ccheever/snapback`, production URL `snapback.expo.app`); the earlier
Cloudflare Pages deployment (`snapback-docs.pages.dev`) was taken down the
same day.

## Redeploy

```bash
cd website
npm install
npm run deploy   # check:docs → assemble → expo export -p web → eas deploy --prod
```

`scripts/assemble-docs.mjs` runs the repo-root docs generator
(`scripts/generate-docs-site.mjs`) with a base derived from
`guide/published-closure.json`, for example `/v/0.1.17/`. It installs those
bytes once at `public/v/<closure>/`, refuses to replace an existing snapshot
with different bytes, and refreshes `public/latest/` and `public/guide/` as
exact copies. The generated pages and manifest identify the versioned path as
canonical; the aliases do not become independent content authorities.

`public/v/`, `public/latest/`, `public/guide/`, and the root `public/llms.txt`
are generated and gitignored. The assembler preserves older directories under
`public/v/` and only adds or verifies the current closure. `npm run check:docs`
assembles into a temporary directory, proves the aliases byte-for-byte, and
probes the immutable-overwrite refusal without changing `website/public/`.
Redeploy on every closure publication so `/latest/` tracks the newest
published closure (rapid-publication posture, LLP 0041).
