# Review: LLP 0030 - Managed Snapback Vite dev loop

**Reviewer family:** Claude (Opus 4.8, 1M context)
**Provider / runtime:** claude-code, fresh session (did not author the draft)
**Date:** 2026-07-01
**Redacted:** No - reviewed local repository files only (the LLP corpus plus current CLI, instance-lock, server-route, and demo Vite/bridge code); no external provider was invoked.
**Method:** sub-agent-free direct review requested as `/llp-review 0030 revise as you see fit`. Read the full LLP 0030 draft, the LLP 0005 process guide, and the load-bearing cited docs (0010, 0012, 0021, 0023, 0024), then verified the RFC's claims about "what exists today" against `src/cli.rs`, `src/instance_lock.rs`, `src/server.rs`, `demos/all-aboard/surfaces/contract/vite.config.ts`, `demos/all-aboard/surfaces/contract/main.ts`, and `demos/_kit/client.mjs`.

> **Independence note.** LLP 0030's author line is "Charlie Cheever / Codex," and the only prior review (`0030-…gpt-5.md`) honestly labels itself a same-family GPT/Codex pass and asks for "a fresh Claude or other non-GPT review." This is that review: an independent Claude-family pass, not the session that drafted the document. It satisfies the second family in the LLP 0005 multi-model loop; the author still decides what to apply.

## Overall assessment

Directionally correct and worth building. The core boundary — the Rust server keeps SQLite, runtime state, cron, subscriptions, admin APIs, and instance locks; Vite is a dev-time orchestrator/proxy that shells out rather than embedding — is the right call and matches what the code already assumes. The RFC's factual claims about the current world check out: the CLI really is `snapback --host/--port/--db/--memory` (`src/cli.rs:16-31`), readiness really is a prose `snapback listening on http://…` line (`src/cli.rs:69`), the file-backed instance lock really records `pid/host/port/url/started_at_ms` (`src/instance_lock.rs:24-33`), and the demo really does proxy `/snapback` at an env-var-or-hardcoded port (`demos/all-aboard/surfaces/contract/vite.config.ts:12,41`). The GPT-5 pass already hardened the biggest seams (host-ops forking, attach compatibility, virtual-module leakage).

The one place this draft is not just under-specified but **pointing at the wrong target** is the proxy security boundary. The RFC anchors its admin-authority protection to `/_snapback/*`, but the privileged, state-mutating routes live at `/admin/*` on the server root, and the demo this plan proposes to migrate drives those `/admin/*` routes *from the browser* on every boot. The mitigation as written is simultaneously too loose (wrong prefix) and too strict (its app allowlist would break the demo). Everything else below is refinement; this one is load-bearing and I revised the RFC for it.

## Strengths

- **Grounded in the real code, not an idealized one.** The motivation's three failure modes (ceremony, wrong-server, opaque failure) are exactly what `all-aboard`'s hardcoded `:4420`-outside-the-scan-range proxy plus manual two-terminal README (`demos/all-aboard/README.md:45-61`) produce today. The RFC is fixing a problem that visibly exists.
- **Right authority split and right refusal to embed.** Keeping the Rust server as the unit of backend authority, and making the plugin a *consumer/projection* of LLP 0024 host-ops rather than a competing lifecycle dialect, is the durable call.
- **Lifecycle modes are the correct control surface.** `off / external / attach / managed / auto` give CI, native shells, and demos distinct behaviors instead of one magic default, and the "healthy but incompatible server is more dangerous than a missing one" framing is the right instinct.
- **Honest about MVP weakness.** The draft already concedes that first-cut attach may only have db-path + `/health`, and labels that a weaker compatibility level rather than pretending it is the strong one.

## Concerns

- **C1 - The proxy admin-authority guard names the wrong route prefix, and its app allowlist would break the demo it migrates. [High] [Revised]** The RFC's protection is "do not forward `/_snapback/*` by default" and its app allowlist is `/health`, `/query/*`, `/mutation/*`, `/live/*`. But `src/server.rs:50-75` puts the privileged, state-mutating routes at the server *root*: `/admin/schema`, `/admin/functions` (loads executable handler bundles), `/admin/reset` (wipes state), `/admin/seed` — none of them under `/_snapback/*`. A `/snapback/*`→root rewrite therefore exposes `/snapback/admin/reset` etc. regardless of a `/_snapback/*` deny-list. Worse, the browser surface *depends* on exactly those routes: `demos/all-aboard/surfaces/contract/main.ts:76-79` calls `loadSchema`/`loadFunctions`/`reset`/`seed` through the `/snapback` proxy on every boot and every HMR dispose/reboot. So the enumerated allowlist (which omits `/admin/*`) would break the demo's own bootstrap, while the `/_snapback/*` deny-list would leave the destructive routes wide open. **Fix (applied):** (a) make the proxy an explicit *allowlist*, never a deny-list — new privileged routes keep appearing at root, so a deny-list fails open by construction; (b) move backend setup (schema/functions/seed) out of the browser and into managed bring-up via host-ops (`schema.load` / `functions.load` / `app.reset --seed`), which is where LLP 0024 already puts it — this both closes the hole and makes the app-route allowlist sufficient, so it strengthens the RFC's own thesis rather than just patching it.

- **C2 - "Later documented app-data routes" hides that privileged and app routes are interleaved at the root with no namespace boundary. [Medium] [Revised]** The app-data surface at root is not a safe-by-construction namespace: `/ephemeral/*` mixes benign `publish`/`subscribe` (the All Aboard demo needs these) with destructive `delete`/`cleanup`, and `/connections/{id}/disconnect` and `/outbox/*` also sit at root (`src/server.rs:62-75`). A prefix-coarse allowlist (`/ephemeral/*`) re-imports the destructive members. The deeper point: the proxy-safety problem is really a *server-side route-taxonomy* problem, and solving it only in the Vite allowlist treats a symptom. **Fix (applied):** require method+path granularity for the default allowlist, and raise a server-side app-data namespace (one prefix the browser may call) as the durable alternative that makes the proxy boundary trivial. Added as an open question, not a mandate.

- **C3 - Strong attach compatibility silently depends on `app.inspect` exposing artifact hashes it may not carry yet. [Medium] [Revised]** The RFC says attach facts can come from "instance-lock metadata plus a follow-up server probe," but the lock records only `pid/db_path/host/port/url/started_at_ms` (`src/instance_lock.rs:24-33`) — *none* of schemaHash, bundleHash, appId, or targetProfile. Every fact above "a server for this db is on this port" must therefore come from `/inspect`. LLP 0012's V0 Runtime State *specifies* those fields, but specified ≠ implemented, and the RFC treats them as available. **Fix (applied):** name the concrete fields the strong level needs from `app.inspect`/runtime-state, and state plainly that until inspect carries them, the weaker db-path+health level is the *only* one actually reachable — so it is the honest MVP default, not a fallback.

- **C4 - `auto` default + managed spawn + browser-driven `reset()` is a silent data-loss footgun on the shared default db. [Medium] [Revised]** The single-owner lock stops two *servers* over one db; it does nothing about two *clients* both driving `/admin/reset` through a proxy against one attached server. In `auto` mode (the proposed default) the plugin may attach to a server another surface/agent is using on the default `.snapback/dev.sqlite3`, and a browser reload then wipes that shared database via `main.ts:78`. The RFC's safety story covers "don't start a second server" and "don't attach to the wrong server" but not "attach-mode reset is destructive to whoever else holds that server." **Fix (applied):** folded into C1's "setup out of the browser" resolution and called out explicitly as a footgun of `auto`.

- **C5 - Readiness-over-stdout collides with `cargo run`, which is the only managed path that exists today. [Low] [Revised]** The RFC's clean `{"event":"snapback.ready",…}` line assumes a quiet stdout, but its own source-tree command is `cargo run --manifest-path …`, and cargo prints `Compiling…`/`Finished` to the stream the plugin would parse. There is no published `snapback` binary yet, so source-tree `cargo run` (with this repo's Hermes/ibex bootstrap fragility — see the DYLD_FRAMEWORK_PATH note in project memory) is the *primary* managed path, not a fallback. **Fix (applied):** noted the cargo-stdout hazard and flipped the MVP readiness preference toward `--ready-file` (out-of-band) for the cargo case, keeping `--startup-json` for a clean packaged binary.

- **C6 - "WebSocket live subscriptions work through the proxy" is an unproven validation item; today's demo long-polls. [Low] [Revised]** The existing `all-aboard` proxy sets no `ws: true` (`vite.config.ts:41-46`) and the client reaches live data by polling an outbox over plain HTTP (`main.ts:90-97`, `client.mjs`), not over a durable WS stream. So migrating that demo as-is would *not* exercise the WS-through-proxy path the validation section claims. **Fix (applied):** validation now requires either a demo surface that actually uses the durable WS stream or a dedicated WS-through-proxy test, so the checkbox cannot be ticked by a demo that never opens a socket.

## Suggestions

- Keep C1's structural resolution as the headline of the MVP: managed bring-up loads schema/functions/seed via host-ops, the browser calls only app routes, and the proxy is a small explicit allowlist. That single move retires C1, C2, and C4 at once.
- Make the first migrated demo prove the *authority boundary*, not just startup: assert that `/snapback/admin/reset` (and `/snapback/_snapback/api/host-ops`) are rejected by the default app proxy, alongside the wrong-server mismatch the GPT-5 pass already asked for.
- When host-ops lands `host.start --json`, prefer the ready-file/enveloped path over stdout scraping specifically because the launcher may be `cargo`.

## Open questions

- Should Snapback grow a single server-side app-data namespace so the dev proxy boundary is safe by construction, instead of every proxy re-deriving an allowlist against interleaved root routes? (This is the clean long-term fix for C1/C2.)
- Where should schema/function/seed loading live once the browser stops doing it — a managed-server startup step, a host-ops call the plugin makes, or a Node seed script — and which becomes the migration recipe for existing demos?
- Until `app.inspect` exposes schemaHash/bundleHash/appId/targetProfile, is db-path+health attach acceptable as the shipped default, or should `auto` refuse to attach (and only spawn/`external`) until strong identity is available?
- Does `auto` need a hosted/shared-db guard so a browser reboot cannot silently reset a database another agent is actively using?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0030 in `Draft`. With the C1 proxy correction applied it is now precise enough for the MVP spike, and it has had the cross-family input the GPT-5 pass asked for (author + GPT + Claude ≈ the LLP 0005 loop for an ordinary proposal). The most useful remaining input before `Accepted` is not another review round but a design decision on the two structural questions this pass surfaced: (1) where backend setup moves once the browser stops driving `/admin/*`, and (2) whether to introduce a server-side app-data namespace so the proxy boundary stops depending on a hand-maintained allowlist. Both are cheap to decide now and expensive to retrofit after the first demo migrates.

## Re-review (2026-07-01): Claude same-family pass focused on the dev-relay URLs

**Reviewer family:** Claude (Opus 4.8, 1M context)
**Provider / runtime:** claude-code, fresh session (did not author the draft)
**Date:** 2026-07-01
**Redacted:** No — reviewed local repository files only (`src/server.rs`, `src/admin.rs`, `src/cli.rs`, `src/instance_lock.rs`, the demo Vite/bootstrap code) plus the sibling `../exact` checkout to verify the `/__exact/*` namespace claim; no external provider was invoked.
**Method:** Re-review requested as `/llp-review 0030 look especially at the URLs that get chosen for like /__snapback etc. revise as appropriate`. Verified every route claim in the RFC against the actual router tables before revising.

> **Independence note.** This is a *same-family* Claude re-review, not additional cross-family diversity — the first section of this file was also a Claude pass. Count it as one more honest Claude revision, not a second independent model family. This pass also *applied* edits to the RFC; the author still decides what to keep and owns any `**Status:**` change.

### Overall assessment

The URL scrutiny was warranted: the route section had a load-bearing factual error and a naming choice that works against its own stated safety goal. Both are now fixed in the RFC. The rest of the document held up well under a second read.

### Strengths (re-verified against code)

- The Exact-preset route `/__exact/snapback/*` is genuinely grounded: `../exact/packages/exact-devtools/src/vite-plugin.ts` registers a real `/__exact/*` dev-server namespace (`/__exact/ws`, `/__exact/agent/*`, `/__exact/mcp`, `/__exact/module-graph`, `/__exact/startup-*`). Nesting the relay under `/__exact/snapback/*` inherits a prefix that already disambiguates it from `/_snapback/*`. That half of the route convention was right.
- The allowlist-not-deny-list instinct from the first pass is still the correct spine; this pass only made its *justification* accurate.

### Concerns

- **U1 — The RFC claimed no privileged routes live under `/_snapback/*`; they do. [High] [Applied]** The prior text asserted "the privileged routes that exist today are under `/admin/*` and `/ephemeral/*` at the root, *not* under `/_snapback/*`." `src/admin.rs:312-330` shows otherwise: `/_snapback/api/functions/{name}/run` (runs mutations/actions), `/_snapback/api/cron/tick`, `/_snapback/api/cron/{name}/run`, and `/_snapback/api/ephemeral/cleanup` are all privileged writes there. **Fix (applied):** rewrote the allowlist paragraph to say privileged routes exist *both* at the root *and* under `/_snapback/api/*`, so a deny-list on either prefix leaves the other exposed — only an allowlist is safe.

- **U2 — The generic default `/__snapback/*` is one underscore from the real `/_snapback/*` admin namespace, and the rewrite makes that a live hole. [High] [Applied]** The relay strips its prefix onto the server root (the demo does `path.replace(/^\/snapback/, '')`, `vite.config.ts:44`), so a browser request to `/__snapback/_snapback/api/functions/x/run` rewrites straight onto the real admin API. The two tokens differ by a single, near-invisible underscore — the opposite of the "visually and mechanically distinct" boundary the section demands. `__snapback` is *also* already the runtime handler-global token (`globalThis.__snapbackHandlers` / `__snapbackInvoke`, `src/runtime.rs:768`), so the URL prefix would overload it a third way. **Fix (applied):** changed the generic default to `/@snapback/*` (Vite's own dev-sigil family — `/@vite/`, `/@fs/`, `/@id/` — reads as dev-only and cannot be confused with `/_snapback/*`), recorded the firm constraint that the generic relay prefix be lexically unmistakable from `/_snapback/*`, and kept `/__exact/snapback/*` for the Exact preset. The exact spelling stays the author's call as long as it meets that constraint; `/snapback-dev/*` is noted as an equally safe alternative.

- **U3 — The root `/admin/*` aliases are ungated, which is *why* the allowlist is load-bearing — the RFC didn't say so. [Medium] [Applied]** `src/server.rs` `apply_schema`/`load_functions`/`reset`/`seed` (lines 339-371) call no `authorize()`; only the `/_snapback/api/*` handlers in `admin.rs` do. So even with `SNAPBACK_ADMIN_TOKEN` set, an unauthenticated `POST /admin/reset` succeeds on loopback — the proxy allowlist is the only thing standing in front of it. **Fix (applied):** stated this explicitly in the allowlist paragraph and added an open-question note that gating the root v0 aliases behind the same `authorize()` check would close the gap server-side.

- **U4 — The authority-boundary validation only tested a direct `/admin/*` hit, not the rewrite-into-admin path. [Low-Medium] [Applied]** The prior validation asserted the proxy refuses `/__snapback/admin/reset` but not `/__snapback/_snapback/...`, which is the sharper case given the prefix-strip rewrite. (The first pass's suggested `/_snapback/api/host-ops` probe named a route that does not exist yet; the real admin API is `/_snapback/api/*`.) **Fix (applied):** validation now asserts refusal along both a direct privileged path (`/@snapback/admin/reset`) and the rewrite-into-admin path (`/@snapback/_snapback/api/inspect`, `/@snapback/_snapback/api/functions/{name}/run`).

### Suggestions

- When implementing, add one integration test that literally issues `/@snapback/_snapback/api/functions/x/run` and asserts a proxy-level refusal, not a backend 401 — the point is that the request never reaches the server, so a token-gated 401 would be the wrong pass condition.
- Consider whether the ungated root `/admin/*` v0 aliases should simply be retired in favor of `/_snapback/api/*`; the proxy allowlist would still be needed, but the "only guard" framing (U3) would soften.

### Open questions

- Is `/@snapback/*` the spelling the author wants, or does the leading-underscore "reserved" aesthetic matter enough to pick a different distinct token (e.g. `/snapback-dev/*`)? The constraint is settled; the spelling is a bikeshed the author owns.
- Should gating the root `/admin/*` aliases land *before* the first demo migration, so the proxy allowlist is defense-in-depth rather than the sole guard?

### Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0030 in `Draft`. With U1–U4 applied, the route/authority section is now factually accurate and the generic relay prefix no longer collides with the admin namespace. This was a same-family pass, so it does not add a new independent model family to the LLP 0005 loop — but the specific question the author raised (the dev-relay URLs) is resolved. The remaining pre-`Accepted` decisions are unchanged from the first pass: where backend setup moves off the browser, and whether to introduce a server-side app-data namespace (or gate the root `/admin/*` aliases) so the proxy boundary stops depending on a hand-maintained allowlist.

### Correction (2026-07-01, same session): the `/@snapback` recommendation is withdrawn

U2 above recommended changing the generic default to `/@snapback/*`. On follow-up with the author, that is **withdrawn** in favor of `/__snapback/*`, for two reasons that surfaced after the initial pass:

- **Vite matches `server.proxy` keys by prefix** — `context[0] === "^" && new RegExp(context).test(url) || url.startsWith(context)` (Vite 8, `dist/node/chunks/node.js:18020`). A `/@snapback` relay would prefix-match and hijack `/@handle`-style app routes (`/@username` profile pages à la Mastodon/Medium). The `/@` space belongs to applications; a dev-infra relay should not squat there. (Vite only reserves specific `/@fs/`, `/@id/`, `/@vite/` prefixes, so `/@username` navigations themselves work via the SPA fallback — but a proxy *key* in that space is the problem.)
- **Consistency:** Exact already ships a `/__exact/*` dev-server namespace (`/__exact/ws`, `/__exact/agent/*`, …) and the two plugins load together, so the generic Snapback relay should share the `/__` convention rather than diverge to `/@`.

The `/__snapback` vs `/_snapback` look-alike that motivated U2 remains, but it is human-only: the allowlist mechanically refuses `/__snapback/_snapback/...`, and app code only ever writes the relay prefix. The durable fix is the server-side route-taxonomy cleanup — finish the LLP 0017 root-vs-`/_snapback` migration so the root holds only app-data and `/_snapback/*` holds every privileged/system route — now reframed in the RFC's open questions. The RFC has been updated to `/__snapback/*` throughout; U1, U3, and U4 stand as written.

## Re-review (2026-07-01): Claude pass after LLP 0031 + the GPT-5 consistency pass

**Reviewer family:** Claude (Opus 4.8, 1M context)
**Provider / runtime:** claude-code, same session that reviewed 0030 earlier (did not author 0030; did author 0031)
**Date:** 2026-07-01
**Redacted:** No — reviewed local repo files only (`src/server.rs` `handle_live_socket_text` / `LiveSocketClientMessage`, the current 0030 draft, the GPT-5 0031 review); no external provider invoked.
**Method:** Re-review requested as `/llp-review 0031 and 0030 revise if can be improved`. Cross-read the GPT-5 review of 0031 (whose G3 flagged WebSocket-carried operations) against 0030's proxy allowlist.

> **Independence note.** Same-family Claude re-review of 0030 (I have reviewed it before), so it does not add a new independent family. It is an independent reviewer *of 0030* in the authorship sense — I did not write 0030 — but I did write 0031, so treat the cross-doc framing accordingly.

### Concern

- **C7 — The method+path allowlist is blind to operations multiplexed over an allowlisted WebSocket route. [Medium] [Applied]** 0030 forwards `/live/*` and requires WebSocket upgrade support, but `/live/{connection_id}/stream` is not one operation — `src/server.rs` `handle_live_socket_text` accepts `ephemeral_publish`, `ephemeral_subscribe`, and `ephemeral_delete` messages over that socket. `ephemeral_delete` is precisely the operation 0031 leaves unclassified (its G3). A method+path allowlist reasons at HTTP-path granularity and cannot see these sub-operations, so if any is authority-bearing, forwarding `/live/*` re-admits it through the front door the allowlist is meant to guard — and 0030 explicitly anticipates "any future realtime transport," which generalizes the hole. The proxy cannot enforce this; it is a server-side obligation (0031 transport parity). **Fix (applied):** added a proxy-surface paragraph stating the allowlist's limit and pointing the fix at the server, and a validation item asserting a system-classified live-socket message is refused even when the socket is proxied. This is the proxy-layer twin of 0031's G3, which neither the GPT-5 consistency pass nor my earlier C1–C6 caught.

### Recommended next step

Proposed only; this review does not change `**Status:**`. Keep 0030 in `Draft`. C7 is now consistent with 0031's transport-parity rule; the substantive remainder is unchanged (backend-setup ownership and the 0031 taxonomy landing). Note the honesty caveat: 0030 has had genuine cross-family input (GPT-5 + Claude), but 0031 — which 0030 now leans on — has had exactly one independent pass (the GPT-5 review), since I authored it.

## Re-review (2026-07-01): Claude reconciliation pass after LLP 0031's decisions were settled

**Reviewer family:** Claude (Opus 4.8, 1M context)
**Provider / runtime:** claude-code, fresh session (did not author the 0030 draft)
**Date:** 2026-07-01
**Redacted:** No — reviewed local repository files only (`src/server.rs`, `src/admin.rs`, `src/ephemeral.rs`, `src/local.rs`, `src/manifest.rs`, `demos/_kit/client.mjs`, demo acceptance tests) plus the current 0030 and 0031 drafts; no external provider invoked.
**Method:** Cross-doc reconciliation requested as part of `/llp-review 0030 and 0031 … settle the open decisions`. Verified route/handler claims via three code-verification sub-agents and one adversarial 0030 review pass, then applied the edits below to align 0030 with LLP 0031's now-settled classifications.

> **Independence note.** Same-family Claude re-review of 0030 (I have reviewed it before), so it does not add a new independent model family. It applied edits to the RFC; the author still decides what to keep and owns any `**Status:**` change.

### Overall assessment

The RFC was written while 0031's five classifications were open, so its proxy allowlist, WebSocket-smuggling concern, and validation items materially contradicted the settled decisions — 0030 repeatedly labelled `/ephemeral/delete` and `/ephemeral/collections/ensure` "destructive or unclassified" routes the proxy must refuse, when D1/D4 make them app-data the proxy must forward. These were mechanical reconciliations against now-settled decisions, not redesign; the RFC's spine (allowlist-not-deny-list, backend setup off the browser, plugin-as-host-ops-projection) is unchanged and sound.

### Concerns (applied)

- **R1 — Proxy forward/refuse lists mislabelled four settled routes. [High] [Applied]** Corrected five locations (the allowlist paragraph, the `/_snapback/api/*` enumeration, the enumerated forward set, implementation step 6, and the validation refuse-list): `/ephemeral/delete` and `/ephemeral/collections/ensure` move into the forwarded app-route allowlist (D1/D4); `/connections/{id}/disconnect`, `/ephemeral/cleanup`, and `/ephemeral/collections` (register) stay refused; the D5 gated writes (`/_snapback/api/{schema/load,functions/load,app/reset}`) are added to the refuse enumeration. Added a positive assertion that the forwarded app-data routes are reachable.
- **R2 — WebSocket sub-operation concern dissolved. [Medium] [Applied]** `handle_live_socket_text` (`src/server.rs`) accepts exactly `ephemeral_publish`/`ephemeral_subscribe`/`ephemeral_delete`, all app-data under D1, so the proxied socket carries no system authority. Reworded the proxy-surface paragraph and the validation item from "prove a system op is refused" to "confirm every live-socket op is app-data; a proxied `ephemeral_delete` succeeds (parity)," keeping the forward-looking guard tied to 0031's WebSocket message-kind assertion.
- **R3 — Attach must read the gated inspect when authorized. [High] [Applied]** D3 trims public `/inspect`. Added an explicit source rule: the orchestrator reads the gated `/_snapback/api/inspect` when it holds admin authority (superset, plus the `server` block for mismatch diagnostics) and falls back to the trimmed public `/inspect` for identity facts in unauthorized `attach`/`external`; this read is never the browser's. Recorded the cross-doc constraint that D3 must keep the identity facts public.
- **R4 — Backend setup can now name concrete endpoints. [Medium] [Applied]** Named the D5 gated writes as the host-ops projection target, and made explicit that until they land the transitional path is the Node orchestrator POSTing the ungated root `/admin/*` aliases server-side — safe because server-side, not because gated.

### Recommended next step

Proposed only; this review does not change `**Status:**`. Keep 0030 in `Draft`. It is now consistent with the settled 0031 decisions and ready for the MVP spike. The outstanding review debt is not on 0030 — which has had genuine cross-family input — but on **0031's** enforcement-test design, which both documents now depend on and which has not had a cross-family pass over the revised text.
