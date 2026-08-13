# Cloudflare proof surface: unauthenticated writes, global action budget, unbounded rate map

**Opened:** 2026-08-12 · **Severity:** P2 (operational / security on any internet-facing Worker) · **Area:** Cloudflare / hosted proof

The Cloudflare target honestly reports `hostedAuth: unavailable`. That is not a surprise. Three shipped details still make a public proof Worker more dangerous than “sessions not built yet.”

## A) Data plane never authenticates writes

Handler invoke always sends `authJson: JSON.stringify({})` (`cloudflare/src/coordinator.js:4004`). `kitQuery` / `kitMutation` / `executeAction` do not call `verifyConnection`. Gateway forwards `/mutation/:name` and `/action/:name` with no token.

Production All Aboard still exports `resetFeed`, `applyLiveFeedSnapshot`, `applyFeedTick`, `claimFeedPoll`, `refreshFeed` (uses `caltrainFeed`), `routeEstimate` (uses `directions`) (`cloudflare/app/all-aboard.app.js:184-201`). Connection-open rate limits do not apply — writes need no connection.

Anyone who can hit a public Worker can wipe/poison the shared board or spend configured API secrets.

*Fix:* Fail closed on non-public functions without a real principal. Until hosted auth exists, require admin token (or at least a connection grant) for every mutation/action that is not `authRequirement: 'public'`, and do not deploy `resetFeed` / snapshot writers / secret-backed actions on an internet-facing proof.

Related: `issues/20260810-hosted-gates-phase1-ungated-plane.md` (anonymous/declared external surface). That ticket does not name this public destructive/egress surface.

## B) Public action budget is global per action name

`claimActionBudget` (`cloudflare/src/coordinator.js:2518-2543`) keys `_snapback_action_limits` by `action_name` only. Default 60/min. `trigger === 'scheduled'` bypasses the budget. One anonymous caller can exhaust `refreshFeed` / `routeEstimate` for everyone, including cron-adjacent manual refresh.

*Fix:* Key the window by `(action, client address or connection id)` and keep a separate reserved budget for `scheduled`. Or require admin/connection auth for secret-backed actions.

## C) Channel A per-IP rate map never evicts keys

`channelARateWindows` (`cloudflare/src/gateway.js:67-86`) is a process-global `Map`. `channelAAdmitRate` trims timestamps inside a key’s window but never deletes idle keys. Key is `cf-connecting-ip`.

A long-lived gateway isolate accumulates one entry per distinct IP that requested HTML. Best-effort (degrade, don’t refuse), but it is unbounded isolate memory.

*Fix:* Drop keys whose window is empty; cap map size and evict oldest.

## D) Admin token comparison is not constant-time

`adminGated` (`cloudflare/src/coordinator.js:2143-2146`) uses `presented !== expected`. The local Rust path uses `token_eq` / `subtle`. Lower severity (timing on a hosted admin token) but inconsistent with the local floor.

*Fix:* Constant-time compare of equal-length digests, same as local.

## Confidence

High on all four mechanisms. A is a known proof posture with an unexamined public-deploy blast radius; B–D are concrete bugs on that surface.
