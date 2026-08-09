# Snapback website — https://snapback.expo.app

The public web surface (author-directed 2026-08-08): a placeholder
product page at `/`, the published documentation projection at
`/guide/`, `/docs/` redirecting to `/guide/`, and a root `/llms.txt`
for agents. Hosted on EAS Hosting (project `@ccheever/snapback`,
production URL `snapback.expo.app`); the earlier Cloudflare Pages
deployment (`snapback-docs.pages.dev`) was taken down the same day.

## Redeploy

```bash
cd website
npm install
npm run deploy   # assemble-docs → expo export -p web → eas deploy --prod
```

`scripts/assemble-docs.mjs` runs the repo-root docs generator
(`scripts/generate-docs-site.mjs`), mounts its output under
`public/guide/` with links rebased to the `/guide/` base path, writes
the root `llms.txt`, and emits the `/docs/` redirect. `public/guide/`
and `public/llms.txt` are generated (gitignored); the generator remains
the single content authority (LLP 0195). Redeploy on every closure
publication so the site tracks the newest published closure (rapid-
publication posture, LLP 0041).

Follow-on: first-class `--base` support inside the generator so the
link checker validates the rebased links themselves
(`issues/20260808-docs-generator-base-path.md`).
