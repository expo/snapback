# Review: LLP 0023 - Admin console dev-serve loop

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-06-27
**Redacted:** No - reviewed local repository files and the in-repo LLP corpus; no separate external reviewer or provider was invoked.
**Method:** Same-session critical review requested as `$llp-review 0023 revise if you can improve it`. Read the full LLP 0023 draft, LLP 0005 review guidance, LLP 0000, LLP 0017, LLP 0021, diary 0005, and the current admin/build-preset files that the proposal would change.

> **Independence note.** LLP 0023's author line names Claude, not Codex/GPT-5, so this is a real GPT-family review artifact for LLP 0005 purposes. This pass also applied revisions, so future readers should treat it as the review that produced the current GPT-5 edits, not as an independent review of the final revised text.

## Overall assessment

The proposal is a good idea and the basic design is the right one. LLP 0017 already permits a Vite-like server only as a console-development convenience, and LLP 0023 chooses the lower-coupling side of that option: keep the Rust Snapback server authoritative, serve only the web UI from Vite, and proxy `/_snapback/api/*` back to the real server so browser code stays same-origin.

The draft was strongest on direction but a little too optimistic at the operational seams. "Runs under Vite" does not by itself prove hot module replacement, a Vite proxy to privileged admin routes must default to loopback, generated Contract binding files need a clear dev lifecycle, and "same plugin chain" needed to distinguish shared compile config from static/native export concerns. I revised the RFC to make those constraints visible without changing the proposed architecture.

## Strengths

- **Correct authority boundary.** Snapback remains the source of truth for admin facts, runtime state, and process-local ephemeral data. The Vite process renders UI only.
- **Same-origin browser model is preserved.** Proxying `/_snapback/api/*` from the Vite origin avoids CORS, local-token special cases, and dev-only `AdminClient` branches.
- **No Rust changes is a reasonable v1 constraint.** A Rust-side Vite proxy would be more production-like, but it would add a dev-only server path for little gain in the first loop.
- **The anti-drift instinct is right.** Extracting shared Exact/Contract Vite config from the existing build preset is the right way to avoid a dev path that works only because it accidentally omits production plugins or aliases.
- **The RFC respects LLP 0017.** Production and ordinary local inspection still use packaged static assets or the embedded console, never a required Vite runtime.

## Concerns

- **C1 - HMR was overclaimed. [Medium] [Applied]** The draft treated the existing `import.meta.hot.dispose` hook as proof that `.contract`, `theme.ts`, and boundary edits would hot-reload without a full page refresh. That may be true if the Exact/Vite module graph accepts those updates, but it is not guaranteed by serving through Vite. Resolved by adding an HMR/remount section and validation that records whether edits are true HMR or fast reload, while requiring clean disposal/reset either way.

- **C2 - The proxy needed an explicit local security default and error shape. [Medium] [Applied]** The admin API is privileged. If the Vite server binds to a non-loopback host by default, the dev proxy can accidentally expose local admin routes to the LAN. Also, a dead proxy target often becomes an opaque fetch or HTML parse failure. Resolved by requiring loopback binding by default, explicit opt-in for non-loopback, startup/pre-proxy reachability checks, and a structured `SNAPBACK_ADMIN_DEV_API_UNREACHABLE` diagnostic.

- **C3 - "Same plugin chain" needed sharper boundaries. [Medium] [Applied]** The serve path should share Exact/Contract plugin construction, ordering, aliases, dedupe, entry shape, and any route-registry requirement, but it should not inherit static/native export preflights, base-path rewrites, HBC/native targets, or `outDir` behavior. Resolved by splitting the proposed helper into shared base config plus build-only and serve-only layers.

- **C4 - Generated binding lifecycle was under-specified. [Low-Medium] [Applied]** `app.contract` imports generated files under `admin-ui/generated/contract/`. Regenerating once at startup is enough for ordinary UI polish, but edits to `contract-bindings.mjs` or the generator can leave the module graph stale unless the loop handles them deliberately. Resolved by making startup generation mandatory and naming watch/regenerate or clear restart diagnostics as part of v1.

- **C5 - Browser dev and native/static launch shapes should stay visibly separate. [Low] [Applied]** LLP 0021 already calls out wrong-server-shape diagnostics. A browser-only dev server should not look like a native Exact static envelope. Resolved by making dev serve skip native export and fail native-envelope requests clearly if that path is probed.

## Suggestions

- Keep the first implementation boring: one Snapback terminal, one Vite terminal, no server auto-start until the manual loop is reliable.
- Add the dev helper in the shared `packages/snapback-contract` preset rather than only in `admin-ui/`, even if the admin UI is the only first caller.
- Treat "no production build" as the required ergonomic win; treat true HMR as the preferred result that must be verified against Exact's current plugin behavior.

## Open questions

- Does `exactVitePlugin` currently self-accept `.contract` updates in serve mode, or does the first implementation need an explicit remount/fast-reload boundary in `main.ts`?
- Should binding-list changes auto-regenerate generated modules and invalidate Vite's module graph, or should v1 require a dev-server restart for that rare edit class?
- Should a non-loopback dev server be forbidden entirely for admin surfaces, or allowed behind the same explicit local-admin token posture as Snapback itself?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0023 in `Draft` until the first dev-serve implementation proves the Exact plugin's serve-mode behavior. The revised RFC is implementation-ready enough for a v1, but acceptance should wait for one concrete validation run covering proxy failure, loopback binding, generated binding startup, and `.contract`/theme/boundary edit behavior.

## Re-review (2026-06-27): GPT-5 same-family pass after Claude revisions

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-06-27
**Redacted:** No - reviewed local repository files and the current LLP 0023 after the Claude review pass; no separate external reviewer or provider was invoked.
**Method:** Same-session re-review requested again as `$llp-review 0023 revise if you can improve it`. Read the updated RFC, the Claude review artifact, `src/cli.rs`, `src/instance_lock.rs`, `src/local.rs`, and the Contract/Exact integration notes.

### Overall assessment

The Claude pass improved the RFC substantially: it caught that 4287 is the start of an auto-scan range, made startup API preflight non-fatal, aligned the `SNAPBACK_ADMIN_DEV_API` name, and surfaced the same-machine loopback proxy risk. I found two follow-up corrections worth applying.

### Concerns

- **R1 - Instance-lock discovery was overgeneralized to `--memory`. [Medium] [Applied]** The RFC's recommended server command is `snapback --memory --port 4287`, and `src/cli.rs` only acquires `DatabaseInstanceLock` for file-backed servers. `LocalSnapback::memory()` has no database path and no lock sidecar, so `dev.mjs` cannot discover a memory server through instance-lock metadata. Resolved by saying instance-lock discovery is available only for file-backed servers with an unambiguous database path, while `--memory` v1 should use a pinned port or explicit `SNAPBACK_ADMIN_DEV_API` unless Snapback later adds a separate process registry.

- **R2 - SSE and WebSocket proxy requirements were conflated. [Low] [Applied]** The Claude pass correctly added a future live-push proxy question, but the phrasing implied an SSE channel needs `ws: true`. SSE/EventSource needs streaming without response buffering; WebSocket needs Vite proxy WebSocket support. Resolved by separating those requirements in the RFC's open question.

- **R3 - The same-origin base URL belongs to `main.ts`, not `AdminClient`. [Low] [Applied]** The RFC said `AdminClient` calls the admin API same-origin. The code path is more precise: `main.ts` constructs `location.origin + /_snapback/api` and passes it into `AdminClient`. Resolved with a narrow wording change.

### Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0023 in `Draft` until implementation validates the port-target behavior for both pinned `--memory` and file-backed servers. The document no longer needs another same-family pass; a future review should be implementation evidence or a different family if the author wants more scrutiny.
