# Operating/deploying pages sweep: packaged-first admin console, stale CLI-only claim, check count, small links

**Opened:** 2026-08-08 · **Severity:** P3 (documentation, batched)

One editing pass over guide/operating/ + guide/deploying/ closes all of
these:

1. **admin-console.md is written exclusively for a source checkout**
   (:33-56 `cd admin-ui && ./build.sh`, `cargo run …`; :123, :140-163,
   :180, :209 all `cargo run -- admin …`). It never shows the installed-CLI
   spelling `snapback admin --ready-file …` — the exact command
   `snapback dev --expo` itself recommends
   (packages/snapback-cli/expo-dev.mjs:1519) — despite being served to
   out-of-repo consumers via /_snapback/guide. Lead with the packaged form;
   keep cargo as the contributor variant. Also reword the hub cell at
   recipes/coming-from-convex-and-supabase.md:46 ("The `snapback dev`-printed
   admin console URL" — plain `snapback dev` prints only `serverUrl`;
   only the Expo supervisor path emits a console command).
2. **host-ops.md:243-245 says seven asset operations "stay CLI-only for
   now"** — five now have MCP tools (`snapback_asset_delete`, `_gc_sweep`,
   `_rotate_signing_key`, `_export_cut`, `_import_cut`;
   packages/snapback-cli/mcp-control.mjs:846-890, dispatch :1945-1957).
   Only `asset.put` and `asset.ensureSeedFixture` remain cliOnly.
3. **cloudflare.md:38 claims "currently runs 28 checks"** — the canonical
   count is 29 (cloudflare/test/local-suite-manifest.mjs:38, changed
   d04c465cd 2026-08-04). Prefer dropping the literal and pointing at the
   manifest constant so it cannot drift again.
4. **Hub link mistarget:** recipes/coming-from-convex-and-supabase.md:150
   routes "admin-impersonated CLI lane" to admin-console.md; the content is
   at host-ops.md:247-262.
5. **`debug.live.forceResync` has a catalog Guide pointer but no actual
   guidance:** agent-controls.md:178 points at host-ops.md where the op
   appears only as a table row (:85); its arguments (`--connection-id`,
   `--subscription-id`, `--reason`, `--clear-retained`, `--startup-nonce`;
   src/cli.rs:1311-1341) are documented nowhere. Three-line usage note.

Found by the 2026-08-08 comprehensive docs review (operating slice).
