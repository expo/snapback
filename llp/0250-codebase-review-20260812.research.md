# LLP 0250: Codebase review — security, correctness, and performance (2026-08-12)

**Type:** Research
**Status:** Review
**Systems:** Project, Runtime, Security, Auth, Storage, Live queries, Assets, Client integration, Cloudflare, CLI, Testing
**Author:** Charlie Cheever / Grok 4.6
**Date:** 2026-08-12
**Revised:** 2026-08-12 (single-family super-refine final-budget r3 by
Codex; remains Review)
**Related:** LLP 0008, LLP 0009, LLP 0038, LLP 0044, LLP 0047, LLP 0049, LLP 0060, LLP 0076, LLP 0172, LLP 0188, LLP 0200, LLP 0204, LLP 0216, LLP 0231, LLP 0251

## Summary

A whole-codebase review of Snapback on 2026-08-12, scoped to security,
correctness, and performance. Every load-bearing claim below was spot-verified
against the code. This is a high-confidence defect inventory, not an exhaustive
assurance claim. It is a Research document in the corpus's own sense — findings
with file references, not a proposal — and the 2026-08-12 successor to
[LLP 0038](./0038-snapback-system-review.research.md) for *defects and risks*,
not for product-strategy scoring.

**The verdict, up front.** The local security floor is unusually disciplined
for a young backend: constant-time compares on secrets, owner-only capability
files, fail-closed hosted source derivation, webhook SSRF that actually
re-validates DNS, route-registry policy axes, no cookie CSRF surface, and
honest Missing rows for query/mutation preemption. The defects that remain are
mostly *inconsistency with a control that already exists on a sibling path*,
not missing design.

Three findings are P1:

1. Host-mediated `ctx.fetch` / `ctx.fetchStream` skips the webhook SSRF
   policy (and follows redirects / env proxies).
2. Incremental live delta can leave a transferred-away owner-visible row on
   the client.
3. The JS client's default offline queue double-applies mutations against
   Cloudflare, which has no client-mutation ledger.

Everything else is P2/P3 or a documented tradeoff. Broader work that should
not be a ticket: unify outbound destination policy
([LLP 0251](./0251-outbound-destination-policy.rfc.md)), and keep landing
LLP 0231 / 0172 so visibility and function auth stop being warn-only.

## Method

Primary sources: `src/`, `packages/snapback-{client,contract,react,cli,codegen,expo}/`,
`cloudflare/src/`, `llp/0009`, `llp/0060`, `llp/0047`, `llp/0216`, `llp/0231`,
and the open `issues/` tree (to avoid duplicates). Provenance: `[observed]`
for facts in this repository; `[inferred]` for reviewer judgment. The evidence
snapshot is repository commit
`b5b5d2d5b931634a718a72aba44a3dbd7e39ac09`. Symbol names and LLP section
anchors are the stable lookup keys below; any line number is only a hint within
that snapshot.

The four read-only passes were: auth (`src/auth/` plus server admission and
routes); execution isolation (`src/runtime.rs`, local action hosts, Ibex and
workerd/Cloudflare execution); storage/live/assets (`src/storage/`, live-query
matching, replication, and asset backends); and clients/CLI/Cloudflare
(`packages/`, CLI surfaces, and `cloudflare/`). P1 means a shipped path can
cause an authorization/confidentiality/integrity failure or duplicate external
effect once its documented capability is enabled; P2 is material but
target-limited, conditional, or presently masked; P3 has narrower impact.

Already-open tickets that this review **does not re-file**:

- `issues/20260808-admin-console-origin-hardening-revisit.md` (app-origin
  `localStorage` console credential; loopback admin reads / DNS rebinding)
- `issues/20260808-live-query-reevaluation-cost-at-scale.md`
- `issues/20260808-p1-write-priority-scheduling.md`
- `issues/20260808-assets-finalize-memory-and-cpu-under-global-lock.md`
  (updated in this pass with the S3 streaming remainder)
- `issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`
- `issues/20260810-hosted-gates-phase1-ungated-plane.md`
- Query/mutation wall-clock / CPU as honest Missing (LLP 0009 / 0047 / 0216)
- Table visibility warn-only (LLP 0231 D2); function auth implicit
  `optional-user` (LLP 0172)

## Findings

### P1 — security / correctness

| ID | Finding | Ticket |
|---|---|---|
| R1 | `ctx.fetch` / `ctx.fetchStream` (local ureq + Cloudflare `fetch`) have no public-IP / metadata / redirect / env-proxy policy. Webhooks do. Official fixture takes `args.url`. | `issues/20260812-host-fetch-ssrf-parity-with-webhooks.md` |
| R2 | Incremental live delta Skips owner-visibility exits that are not also `plan.filters`. Client keeps the transferred-away row. Standard-pattern CRUD is safe; handwritten owner-visible live queries are not. | `issues/20260812-live-delta-owner-visibility-exit-skipped.md` |
| R3 | `mutate({ queue: 'auto' })` replays `clientMutationId` on Cloudflare, which mints a fresh `mutationId` and never consults the ledger. | `issues/20260812-offline-queue-double-applies-on-cloudflare.md` |

### P2 — security

| ID | Finding | Ticket |
|---|---|---|
| R4 | Dev body `auth.userId` + reflected localhost CORS is unauthenticated impersonation from any other localhost origin. Sessions mode closes this; Dev is the default local profile. | `issues/closed/20260812-dev-body-impersonation-loopback-cors.md` |
| R5 | OAuth `served_origin` trusts `Host` and always emits `http://`. Local-only facade; Host spoof still redirects token endpoints. | `issues/closed/20260812-oauth-metadata-trusts-host-header.md` |
| R6 | Default Node RQS/outbox store writes `~/.snapback/rqs` with no `mode` (0644 under umask 022). CLI secrets elsewhere are 0600. | `issues/20260812-rqs-outbox-file-store-world-readable.md` |
| R7 | `open` / `xdg-open` argv carries `sbcc_` in the URL fragment. Linux `/proc/<pid>/cmdline` is world-readable. | `issues/20260812-admin-console-credential-on-browser-argv.md` |
| R8 | `runtime.log` / `SNAPBACK_HANDLER_CONSOLE=stderr` skip the action secret redactor. Error envelopes are scrubbed; logs are not. | `issues/20260812-runtime-log-skips-secret-redactor.md` |
| R9 | Cloudflare proof Worker: unauthenticated mutations/actions (including `resetFeed` and secret-backed `refreshFeed`), global-per-name action budget, unbounded Channel A rate map, non-constant-time admin compare. | `issues/20260812-cloudflare-proof-surface-hardening.md` |

### P2 — correctness / availability

| ID | Finding | Ticket |
|---|---|---|
| R10 | Ibex `ex_hermes_eval` copies an unbounded C string; `DID_NOT_SETTLE` echoes it in details. Workerd caps at 8 MiB before parse. | `issues/20260812-ibex-eval-output-unbounded.md` |
| R11 | Invocation IIFE is assembled by sequential global `str::replace`. User/secret bytes containing a later placeholder become SyntaxError or rewritten secrets. Workerd passes JSON. Not a claimed RCE. | `issues/20260812-invocation-iife-global-str-replace.md` |
| R12 | Search live Query deps have `predicate: None` → ConservativeFallback on every commit, including disjoint tables. | `issues/20260812-search-live-query-dep-missing-predicate.md` |
| R13 | `asset_read_authorized` still emits dead `CapturedReadKind::Permission` (ignored by matcher and read-set validation). This is a dormant authorization-boundary defect: today's production reserved-asset live path always re-runs, so its symptom is masked. | `issues/20260812-asset-read-emits-dead-permission-kind.md` |
| R14 | Fork clone/scrub openers do not set LLP 0188 persist-WAL. Last-opener close can checkpoint/unlink `-wal` that LTX still names. | `issues/20260812-fork-clone-skips-replication-persist-wal.md` |

### P3

| ID | Finding | Ticket |
|---|---|---|
| R15 | Data-patch apply token is consumed outside the Local lock, before the CAS. Conflict burns the one-shot token with no row change. | `issues/closed/20260812-data-patch-token-consumed-before-cas.md` |

### Documented tradeoffs / honest gaps (do not re-file)

- Admin console `localStorage` credential on the app origin; loopback admin
  *reads* without a token; no `Host` validation on the main listener. The
  2026-08-12 pass added a blast-radius note to the existing ticket covering
  OAuth, Dev impersonation, `/mcp`, and `/connection/open`.
- Query / top-level mutation / module-preflight have no forcible kill on
  Ibex. Manifest says Missing. Workerd process-kills. LLP 0216 is the
  launch gate.
- Implicit table visibility is warn-only (LLP 0231). Implicit function auth
  is `optional-user` (LLP 0172). Combined with R1, an omitted `auth` on an
  action that fetches is anonymously invocable.
- Full `SnapbackClient` inherits `SNAPBACK_ADMIN_TOKEN` from the environment
  by design. The app-data façade (`packages/snapback-client/app-data.mjs`)
  exists specifically to not do that. Footgun if an agent constructs the
  full client in an SSR process; not a bypass.
- Asset finalize CPU still inside the global writer (existing ticket). S3
  never got the streaming `copy_from_staging` (remainder added there).
- Live re-eval cost and write-priority remainder (existing LLP 0200 tickets).

## Already well-handled `[observed]`

Do not spend a landing on these as if they were missing:

- Local-target constant-time compares on admin tokens, session hashes,
  signed-url HMAC, impersonation capability, and secret-read leases
  (`token_eq`). Cloudflare's proof compare is R9.
- Owner-only files: `O_NOFOLLOW`, euid, mode `0600`, nlink==1, ACL
  fail-closed.
- Hosted effective source: loopback terminator only, single
  `X-Forwarded-For`, rightmost hop, malformed/duplicate fail-closed.
- Webhook SSRF: public-IP + pin + no redirects + no env proxy.
- Route registry pairs policy axes; hosted operator surface is a uniform 404.
- CORS never sets `Access-Control-Allow-Credentials`. Session/admin secrets
  are headers.
- Admin/setup XSS: `textContent` / `setAttribute`, CSP, Trusted Types.
- Connected-client witnesses are hard-capped (32,768).
- HTTP queries stay off the global writer via the read lane (service
  principals excepted).
- `/api/v1/run` untrusted code is refuse-closed until LLP 0047 evidence.
- Warm VM is a no-op; lifecycle is fresh-per-invocation.
- Prototype pollution on contract overlays is tested (`__proto__` as own
  data on a null prototype).
- Asset HTTP keys go through `validated_key`; signed URLs HMAC over
  identity + generation + expiry, not a blob path.

## Broader issues (LLP, not ticket)

1. **Application/integration destination policy is several products.**
   Webhooks, local and Cloudflare action fetch, current Expo push, and
   `src/ask.rs` each carry URL/transport rules. Ask accepts a manifest-selected
   OpenAI-compatible base, sends a bearer credential, and disables redirects,
   but does not classify/pin DNS or refuse environment proxies. It belongs in
   [LLP 0251](./0251-outbound-destination-policy.rfc.md)'s shared floor because
   LLP 0204 D5 puts provider HTTP on the egress machinery. It is not folded
   retroactively into R1's ticket: unlike that P1's handler-authored URL, Ask's
   destination is manifest-selected, so this review records it as architectural
   scope rather than claiming the existing user-URL defect ticket covered it.
2. **Matcher vocabulary is the live-auth ceiling.** Owner-visibility exits,
   search missing predicates, and dead `Permission` captures are the same
   class: the incremental lane only knows what the capture recorded. LLP
   0200 / 0008 already own scheduling; they should absorb a “capture must
   be sufficient for skip *and* exit” obligation rather than growing a
   third live RFC.
3. **Proof deploys are not a hosted product.** Cloudflare `hostedAuth:
   unavailable` is honest. Shipping `resetFeed` and secret-backed actions
   on a public Worker is still an operational choice that needs a gate,
   not just a capability row.

## Suggested order of work

1. R1 (fetch SSRF parity) — exploitable on today's local target once
   outbound is on, and the primitive already exists.
2. R2 (live owner-exit) — authorization leak, small matcher fix.
3. R3 (CF double-apply) — client must honor the capability gap.
4. R4 + R5 + the existing admin Host/CORS ticket — one listener-level pin
   covers Dev impersonation, OAuth, MCP, and admin reads.
5. R6–R8, R10–R11 — local hygiene (file mode, argv, redactor, eval bound,
   IIFE JSON).
6. R9 — before any internet-facing proof deploy, not before local
   authoring.
7. R12–R15 — matcher/search, asset Permission, fork persist-WAL, data-patch
   token.

## Confidence

High on R1–R8, R10–R12, R15 (code paths read and compared to siblings).
High on R2's matcher mechanics; medium that many apps hit it (standard
patterns force replace). High on R9 as a public-Worker risk; the target
does not claim hosted auth. Medium on R13's live symptom (masked today).
Medium on R14's stopped-G2 last-opener case (needs a replicated fixture).
