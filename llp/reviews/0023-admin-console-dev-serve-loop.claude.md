# Review: LLP 0023 — Admin console dev-serve loop

**Reviewer family:** Claude (Opus 4.8)
**Provider / runtime:** claude-code session in this repository (`/llp-review 0023`)
**Date:** 2026-06-27
**Redacted:** No — reviewed local repository files only (the LLP 0023 draft, LLP 0005/0017/0021, diary 0005, the existing GPT-5 review, and the admin-ui / build-preset / cli.rs / instance_lock.rs sources the proposal touches). No external provider was invoked.
**Method:** Same-session critical review requested as `/llp-review 0023 revise if you want`. This pass also applied revisions to the RFC.

> **Independence note (read this first).** LLP 0023's author line is **Claude (Opus 4.8)** and this reviewer is **also Claude (Opus 4.8)** — not merely the same family but the same model, in a fresh session. This is therefore *not* the cross-family round LLP 0005 asks for: the GPT-family perspective was supplied by the existing `0023-…gpt-5.md` review (concerns C1–C5, already applied). This artifact is the fresh-Claude-session critical pass that LLP 0005's multi-model loop names as component (c) — a second independent reading within the Claude family, no more. Because it also applied edits, treat it as the review that produced the current Claude revisions, not as an independent read of the final text. The honest tally for this low-stakes RFC: author (Claude) + one cross-family review (GPT-5, applied) + this same-model second read.

## Overall assessment

The proposal is sound and the architecture is the right one — I agree with everything the GPT-5 review already established, so I won't restate C1–C5. The Vite-side loopback proxy that keeps Snapback authoritative and the browser same-origin is the lowest-coupling option consistent with LLP 0017, and the anti-drift move (extract a shared `contractViteBaseConfig`, layer build-only and serve-only concerns on top) is correct. The factual premises check out against the code: `main.ts:57-64` does wire `import.meta.hot.dispose` to dispose the surface, reset links, and `reset()` the runtime; `main.ts:22-27` computes the same-origin base URL (minor nit: the draft attributes this to `AdminClient`, but it's `adminBaseUrl()` in `main.ts` that computes it and passes it in); and `build-preset.mjs:64-74` does order `exactVitePlugin` before `contractVitePlugin` with `configFile: false`.

Where the draft (and the GPT-5 pass) were too trusting is the **API-target seam**. The whole loop hinges on the Vite proxy reaching the right Snapback process, and the draft hardcodes `127.0.0.1:4287` as if 4287 were a fixed port. It is not — it is the *start of an auto-scan range* — and the privileged admin API it forwards to is open on loopback by default. Those two facts produce the concerns below. I revised the RFC to resolve them without changing the architecture.

## Strengths (beyond what GPT-5 already credited)

- **The factual scaffolding is real, not aspirational.** The hooks the RFC leans on (`import.meta.hot.dispose`, the same-origin base URL, the plugin ordering, the `build.mjs`→preset path) all exist in the tree today, so the "reuse, don't rebuild" framing is honest. `main.ts:6` even already says "In production … the same Rust server on one origin — no dev proxy," so the codebase anticipated this exact RFC.
- **Build/serve parity via one shared config is the correct anti-drift primitive** (§Shared Vite config), and mirroring `build.mjs`/`build.sh` with a `dev.mjs`/`dev.sh` pair keeps the dev path discoverable next to the build path it parallels.
- **Native-export and base-path concerns are scoped out cleanly** (§Native-export preflights), which is what keeps serve mode from accidentally re-importing the LLP 0268 machinery.

## Concerns (new — not covered by GPT-5's C1–C5)

- **K1 — The `127.0.0.1:4287` proxy default is unsafe because 4287 is a scan-range *start*, not a fixed port. [Medium] [Applied]** `cli.rs:13,22`: a bare `snapback --memory` scans `4287–4387` and binds the first free port. If 4287 is occupied (a second instance, an unrelated process, a previous run not yet released), the server lands on 4288+ and the proxy silently points at the wrong process or nothing. Guessing 4287 is *worse* than a clean failure, because pointing at a wrong-but-live process yields confusing data rather than an honest `ECONNREFUSED`. Resolution: the documented default works only when the server is *pinned* (`--port 4287`, as the two-terminal example does); otherwise the loop must discover the bound port — Snapback prints it (`cli.rs:68`, `snapback listening on http://…`) and records `port`/`url` in its instance-lock metadata (`instance_lock.rs:30-32,84-102`), which `dev.mjs` can read. I revised §Serving and the API seam to say this.

- **K2 — Loopback binding does not stop a same-machine browser page from driving the privileged admin API through the proxy. [Low-Medium] [Open question added]** C2 correctly fixed LAN exposure (loopback bind). But the admin API is *open on loopback by default* — `cli.rs:79,81`: writes require `SNAPBACK_ADMIN_TOKEN` only when it is set, and reads are unauthenticated. Once Vite proxies `/_snapback/api/*` at the dev origin, a drive-by `fetch()` from another tab (or a DNS-rebind against the dev origin) can reach admin routes — including writes — with no CSRF defense beyond the optional token. This is dev-only and somewhat theoretical, so I did not over-engineer it, but it deserves an honest open question: an Origin/Host allowlist on the dev proxy, or recommending `SNAPBACK_ADMIN_TOKEN` in dev, closes it.

- **K3 — The proxy is HTTP request/response only; a future live-push/SSE admin channel would silently break under it. [Low] [Open question added]** Verified: today's `admin-client.mjs` is pure `fetch` + `JSON.parse` (GET `/inspect`, GET `/data/:table`, POST `/functions/:name/run`, POST `/ephemeral/cleanup`) — no `EventSource`/WebSocket — so v1 is fine with a plain proxy. But Snapback has a live-push slice (LLP 0020) and the console already renders a `subscriber_count`. If the console later consumes a stream over `/_snapback/api`, the simple proxy will buffer/break it without `ws: true` / disabled response buffering. Worth a note now so it isn't a surprise later.

- **K4 — The startup preflight conflicts with the two-terminal model unless it is non-fatal. [Low] [Applied]** The draft offered "preflight the API target by default, *or* install a proxy error handler." Because the loop is two *decoupled* terminals, the developer may legitimately start Vite before Snapback. A hard startup preflight would then fail a perfectly normal startup order. Resolution: make the startup preflight a non-fatal warning; the load-bearing diagnostic is the per-request proxy error handler (→ `SNAPBACK_ADMIN_DEV_API_UNREACHABLE`). I resolved the "or" in the RFC's favor of the per-request handler.

- **K5 — The dev path silently inherits `build.sh`'s prerequisites. [Low] [Applied]** `build.sh` requires a `bun` runtime and an Exact checkout at `SNAPBACK_EXACT_ROOT`/`../../exact`, and errors clearly when they're missing. `dev.mjs`/`dev.sh` will need the same, but the draft's two-terminal recipe doesn't mention them — a newcomer hits a missing-Exact error. Noted in the implementation sketch.

- **K6 — Env-var naming is inconsistent. [Low] [Applied]** `SNAPBACK_DEV_API` drops the `ADMIN` segment that `SNAPBACK_ADMIN_DEV_HOST` (same RFC) and `SNAPBACK_ADMIN_DIST` (existing) both carry. Since nothing is built yet, renaming is free. I changed it to `SNAPBACK_ADMIN_DEV_API` throughout.

- **K7 — "One command" overstates what the design delivers. [Low] [Applied]** The Goals say "One command brings up a live dev loop," but the recommended design is explicitly two processes; the command brings up only the UI half. Softened the goal to match the decoupled design the RFC actually recommends.

## Suggestions

- Default `dev.mjs`'s API target from the instance-lock `url`/`port` Snapback records, falling back to `SNAPBACK_ADMIN_DEV_API`, then to pinned-4287 — so the zero-config case is *correct*, not just convenient.
- Keep `generated/contract/*` regeneration idempotent. Those files are **tracked** (not gitignored — `.gitignore` only covers `src/__generated/`), so a non-deterministic generator would dirty the working tree on every `bun run dev`. Add a validation that an unchanged-input boot leaves them byte-identical.
- Endorse GPT-5's "keep v1 boring" suggestion: no Snapback auto-start until the manual two-terminal loop is reliable.

## Open questions (additions to the RFC's list)

- Should the dev proxy enforce an Origin/Host allowlist (or require `SNAPBACK_ADMIN_TOKEN`) so only the console — not an arbitrary page in the dev browser — can drive the admin API through it? (K2)
- If the console later consumes a live-push/SSE channel over `/_snapback/api`, what does the proxy need (`ws: true`, disabled buffering)? (K3)
- Should `dev.mjs` default the API target from the instance-lock `url`/`port` rather than assuming 4287? (K1)

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0023 in `Draft`. With the GPT-5 cross-family round applied and this same-model second read applied, the *review* bar for a low-stakes, reversible DX RFC is met — LLP 0005 asks for "one round from a different model family plus the author's critical pass" for ordinary proposals, and that has happened. What remains is not more review but one concrete validation run (proxy failure path, loopback binding, port-discovery vs. pinned 4287, generated-binding startup idempotence, and `.contract`/theme/boundary edit behavior). The author can move straight to `Accepted` once that run confirms the Exact plugin's serve-mode behavior; another review family would be over-buying for a change this size.
