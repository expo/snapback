# Spike: run Snapback's Cloudflare bundle under celld (self-hosted DO runtime)

**Opened:** 2026-08-06
**Systems:** Deployment, Cloudflare, Runtime, Testing
**Related:** LLP 0083 (celld section), LLP 0014, LLP 0040, LLP 0048, LLP 0049, LLP 0086 §CC-2a

celld (github.com/denoland/celld, Apache-2.0) implements the actual
Cloudflare Workers/Durable Objects JavaScript API and wrangler config on
self-hosted infrastructure — V8 + per-cell SQLite + LTX replication to an
S3-compatible bucket. LLP 0083's celld section identifies a cheap spike:
our Cloudflare port (`cloudflare/src` — gateway Worker + `Coordinator` DO
with SQLite storage + handler Worker over service bindings, standard
`wrangler.jsonc`) appears to need exactly the surface celld supports.

**Task.** Attempt to deploy and run the notes app bundle
(`cloudflare/app/notes.app.js` + gateway + coordinator + handler workers)
under celld locally against MinIO. Record a dated result artifact under
`cloudflare/` or in LLP 0083.

**Known compatibility gaps to check (from celld's cloudflare-compat.md,
fetched 2026-08-06):**

- no `scheduled` (cron) handler — LLP 0049's cron hardening will not run;
- KV/R2/Queues bindings load but throw; Cache API, HTMLRewriter, TCP
  sockets absent;
- `routes`/`triggers`/`kv_namespaces` wrangler keys are deploy **errors**
  — check our wrangler configs for offending keys;
- celld accepts `wrangler.jsonc`/`.json`, not `.toml` (we use `.jsonc` —
  fine);
- WebSockets do not survive cell migration; single-node spike avoids
  this.

**Exit questions.** (1) Does the coordinator DO run with SQLite storage,
WebSocket hibernation, and alarms intact — do the Miniflare local-suite
gates (`cloudflare/test/local-suite.mjs`) pass against celld? (2) Could
the LLP 0048 conformance twin test celld as a third leg? (3) What would a
`celld-do-sqlite-v8` capability manifest honestly claim vs. the
`cloudflare-do-sqlite-v8` manifest? Findings feed LLP 0086 §CC-2a's
lock-in accounting for the LLP 0014 door-2 re-ratification.

**Non-goals.** No hosted rearchitecture, no production use — celld is
weeks old and "still evolving" (same discipline LLP 0087 applied to
Facets). Prior-art/optionality evidence only.
