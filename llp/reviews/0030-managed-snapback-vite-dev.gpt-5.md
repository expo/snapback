# Review: LLP 0030 - Managed Snapback Vite dev loop

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-07-01
**Redacted:** No - reviewed local repository files and the in-repo LLP corpus; no separate external reviewer or provider was invoked.
**Method:** Same-session critical review requested as `$llp-review 0030 revise as you see fit`. Read the full LLP 0030 draft, LLP 0005 review guidance, the root Snapback LLP, and governing DX/client-integration material in LLP 0005, 0010, 0012, 0021, 0023, and 0024, plus current CLI, instance-lock, server route, admin dev-preset, and demo Vite proxy code.

> **Independence note.** LLP 0030's author line includes Codex. I did not author the draft in this session, but this is still a same-family GPT/Codex review pass, not cross-family model diversity. Treat this artifact as an honest GPT-family revision pass; get a fresh Claude or other non-GPT review if the author wants a fuller LLP 0005 loop before acceptance.

## Overall assessment

The RFC is directionally sound and fills a real gap: Contract/Exact app demos should not require hand-managed Snapback and Vite terminals when the selected backend is local. The core boundary is right: Snapback remains the backend authority and Vite is a dev-time orchestrator/proxy.

The main weaknesses were at the implementation seams. The draft risked letting the Vite plugin grow a lifecycle dialect parallel to LLP 0024 host-ops, attach to the wrong healthy server based on weak facts, expose admin/control routes through an ordinary app proxy, and leak dev-only backend details into browser or production code. I revised the RFC to make those boundaries explicit while leaving it in `Draft`.

## Strengths

- **Right product target.** The RFC directly addresses the manual two-terminal demo pattern that LLP 0010 and LLP 0021 already identify as integration friction.
- **Good authority split.** It keeps SQLite, runtime state, cron, live subscriptions, admin APIs, and app instance locks in the Rust server rather than embedding Snapback into Vite.
- **Useful lifecycle modes.** `off`, `external`, `attach`, `managed`, and `auto` give tests, CI, app demos, and native shells different control points instead of one hidden behavior.
- **Good DX instincts.** Stable relative `/snapback` paths, structured diagnostics, no stale codegen, and loopback defaults match the agent-first constraints in LLP 0010 and LLP 0012.

## Concerns

- **C1 - Host lifecycle could have forked LLP 0024. [High] [Applied]** The draft described a Vite-managed child process but did not bind the durable contract to `host.start`, `host.stop`, result envelopes, or shared diagnostics. I revised the Summary, Existing coverage, readiness, diagnostics, and implementation plan to make the plugin a current CLI orchestrator but future host-ops consumer/projection, not a competing lifecycle API.

- **C2 - Attach compatibility was under-specified. [High] [Applied]** A healthy `/health` response or open port is not enough; forwarding to the wrong app/database/artifact set is worse than failing. I added a target identity and attach-compatibility section requiring target profile, readiness, database/target id, app id/root, schema hash, function bundle hash, generated input hash, and schema/result-envelope version, with only explicitly weaker MVP policies allowed.

- **C3 - The default app proxy risked inheriting admin authority. [High] [Applied]** Rewriting all `/snapback/*` traffic to the Snapback root can make `/_snapback/*` admin/control routes reachable through an ordinary app dev server. I revised the proxy section and validation requirements so the default proxy exposes app routes only, with admin/control proxying as an explicit opt-in.

- **C4 - Dev-only virtual module facts needed production/build boundaries. [Medium] [Applied]** `virtual:snapback/dev` is useful, but private loopback URLs, command lines, environment variables, or diagnostics with secrets must not leak into generated Contract files or production bundles. I added serve-time-only, sanitized-state, and static-build failure/tree-shaking requirements.

- **C5 - Command resolution and teardown needed operational guardrails. [Medium] [Applied]** The draft showed `snapback` and `cargo run` examples, but did not say how tooling chooses a command or avoids expensive runtime bootstrap side effects. I added an explicit resolver order, capability diagnostic on missing binaries, a no-Hermes-build side-effect rule, and Valet-style teardown ownership.

- **C6 - Readiness payload shape needed to align with structured host facts. [Medium] [Applied]** `--startup-json` or `--ready-file` is the right direction, but the payload should not become a one-off event line. I revised it to carry schema/version, startup/request id, target descriptor, URL, pid, readiness, and diagnostics, and to be replaceable by a future `snapback host start --json`.

## Suggestions

- Keep the first implementation to lifecycle/proxy only: readiness handshake, attach/managed/auto, app-route proxy, structured proxy failures, and one migrated Contract demo.
- Make the first migrated demo prove a wrong-server mismatch, not just successful startup.
- Treat codegen/watch/hot-push as the second slice; it is valuable, but only after lifecycle identity is reliable.
- Reuse the existing admin dev-serve preset as evidence, but do not let the app plugin inherit admin-specific route or diagnostic assumptions.

## Open questions

- What names should weaker attach compatibility policies use, and which should be allowed by default?
- Should the first readiness affordance be `--startup-json`, `--ready-file`, or the first cut of `host.start --json`?
- Which package boundary is least likely to churn: `@snapback/vite`, a subpath of `@snapback/contract`, or a repo-local preset while packaging settles?
- What explicit admin/control proxy route should app surfaces use when they truly need one?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0030 in `Draft`. It is now precise enough for an MVP design spike around readiness/host-ops output, target identity, app-route proxying, and one demo migration. Before the author moves it toward `Accepted`, the most useful additional input would be a fresh non-GPT review focused on whether the host-ops and Exact/Vite package boundary is the right long-term ownership split.

## Re-review (2026-07-01): GPT-5 same-session pass after Claude proxy-authority revisions

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-07-01
**Redacted:** No - reviewed local repository files and the current LLP 0030 after the Claude review pass; no separate external reviewer or provider was invoked.
**Method:** Same-session re-review requested as `$llp-review 0030 revise as you see fit`. Read the current RFC, the Claude review artifact, the earlier GPT-5 artifact, the LLP 0005 review guidance, and current inspect/admin/demo evidence for runtime-state identity, browser-driven setup, and proxy route shape.

> **Independence note.** This is not a fresh independent review. This same GPT/Codex session already revised LLP 0030 and wrote the earlier GPT-5 artifact, so this section records an honest same-family re-review and edit pass only. Do not count it as an additional independent model-family review.

### Overall assessment

The Claude pass materially improved LLP 0030 by catching the real proxy-authority issue: the dangerous routes are root-level `/admin/*` and some `/ephemeral/*` routes, not only `/_snapback/*`, and current demos depend on browser-driven admin calls. After that correction, the remaining problem was sequencing and ownership: the RFC said setup should move out of the browser, but did not yet say when the plugin may run destructive setup.

I revised the RFC so the first slice is not merely lifecycle/proxy. It is lifecycle, app-route proxying, and one-shot managed setup from existing generated artifacts, with destructive setup allowed by default only when the plugin spawned the server.

### Concerns

- **R1 - Backend setup needed mode-aware ownership. [High] [Applied]** Moving `loadSchema`/`loadFunctions`/`reset`/`seed` out of the browser is right, but doing those calls from the plugin would still be dangerous if `auto` attached to an existing server. I added a `Backend setup ownership` section: `managed` and spawn-shaped `auto` may run one-shot setup; `attach`, `external`, and attach-shaped `auto` validate by default and require explicit opt-in before loading, resetting, or seeding shared state.

- **R2 - The MVP cutline contradicted the proxy fix. [Medium] [Applied]** The RFC still said the first useful plugin could manage lifecycle/proxying only, but the proxy allowlist cannot work until setup moves off the browser. I revised the Codegen/hot-push and Status sections: first slice includes one-shot setup from existing generated artifacts; codegen/watch/hot-push remains later.

- **R3 - Transitional setup needed a path before full host-ops exists. [Medium] [Applied]** The RFC now asks setup to use LLP 0024 host-ops, but those operations may not be implemented yet. I added a transitional allowance: the Node orchestrator may call existing admin HTTP endpoints as a host-ops projection, holding/redacting admin authority server-side, while the browser still receives only the app-route proxy.

- **R4 - Attach identity should reflect the inspect payload that exists today. [Medium] [Applied]** The Claude pass correctly said identity depends on inspect. I tightened the field list to the current nested shape: `schema.appId`, `schema.schemaHash`, `schema.inputsHash`, `schema.targetProfile`, `functions.appId`, `functions.bundleHash`, `functions.inputsHash`, `targetProfileId`, and `schemaVersion`. The expected descriptor comes from generated artifacts and config, not browser state.

- **R5 - Ready-file hygiene needed stale-file protection. [Low-Medium] [Applied]** Preferring `--ready-file` for `cargo run` is right, but a file contract can accidentally accept stale readiness. I added requirements for a per-session path, private temp/app-local ignored location, removal before spawn, atomic write after bind and lock metadata, and rejecting stale files.

- **R6 - Validation needed reload/HMR and attach-destructiveness checks. [Low-Medium] [Applied]** The validation list now asserts that `auto` does not reset/seed after attaching, and that browser reload/HMR remounts without rerunning backend setup so post-setup data survives reload unless an explicit reset was issued.

### Suggestions

- Implement the first migrated demo against a managed child first, where reset/seed is legitimate, then add attach-mode validation once target descriptors are proven.
- Make the setup policy visible in diagnostics. An attach-mode refusal to seed should be an actionable result, not a quiet skip.
- Treat a server-side app-data namespace as the likely follow-up once the proxy allowlist starts accumulating route exceptions.

### Open questions

- Should attached-server setup allow non-destructive schema/function load by default, or should every attached/external write-like operation require explicit opt-in?
- What is the exact config spelling for destructive attached/external setup, and should it require a typed confirmation value rather than a boolean?
- Should the target descriptor become a first-class host-ops artifact before the plugin ships, or is deriving it from inspect good enough for the first demo?

### Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0030 in `Draft` until the author decides the setup-ownership policy and app-data namespace question are settled enough. The next concrete implementation slice should prove managed child startup, one-shot schema/function/seed setup outside the browser, default app-route proxy rejection of `/snapback/admin/reset`, browser reload without reset, and one wrong-target diagnostic.

## Re-review (2026-07-01): GPT-5 same-session consistency pass after LLP 0031

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-07-01
**Redacted:** No - reviewed local repository files and the in-repo LLP corpus; no separate external reviewer or provider was invoked.
**Method:** Same-session re-review requested as `$llp-review 0030 revise if there are things that need to be fixed`. Read the current LLP 0030 draft, the existing GPT-5 and Claude review artifacts for LLP 0030, LLP 0031, and the current Snapback route tables in `src/server.rs` and `src/admin.rs`.

> **Independence note.** This is not a fresh independent review. This same GPT/Codex session has already edited LLP 0030, so this section records an honest same-family consistency pass only. Do not count it as additional cross-family review.

### Overall assessment

LLP 0030 is now aligned with the main findings from the earlier GPT and Claude reviews: the generic Vite relay defaults to `/__snapback/*`, the Exact preset may use `/__exact/snapback/*`, backend setup moves out of browser code, and the default proxy is an app-route allowlist rather than a deny-list. The remaining issue was smaller but real: after LLP 0031 was added, LLP 0030 spoke too definitively about some root `/ephemeral/*` routes that LLP 0031 intentionally leaves ambiguous.

### Concern

- **S1 - Proxy wording needed to distinguish destructive routes from unresolved taxonomy. [Medium] [Applied]** LLP 0031 classifies `/ephemeral/publish` and `/ephemeral/subscribe` as app-data, but leaves `/ephemeral/delete`, `/ephemeral/collections*`, `/inspect`, and `/connections/{id}/disconnect` open or ambiguous. LLP 0030 should not imply that all of those are already settled as destructive system routes. I revised the proxy, implementation-plan, validation, and open-question wording so the default Vite app proxy treats destructive or unclassified root routes as unreachable until LLP 0031 classifies or relocates them.

### Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0030 in `Draft`. The document is ready to drive the MVP spike, with LLP 0031 carrying the server-taxonomy cleanup that would eventually let the Vite proxy shrink from a method+path allowlist to the reserved-prefix rule.
