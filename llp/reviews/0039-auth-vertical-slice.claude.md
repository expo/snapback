# Review: LLP 0039 — Auth vertical slice

**Reviewed:** `llp/0039-auth-vertical-slice.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally; nothing sent beyond the model serving this
session.
**Method:** Single-session independent read, verified against LLP 0011 (parent
RFC, ratified v1 direction), LLP 0024 (authority tuple), and the code
(`src/local.rs` epoch/resync machinery, `src/manifest.rs`/`src/live_matcher.rs`
auth-variable exprs, existing `SNAPBACK_AUTH_USER_MISSING` sites). Same-family
sub-agent passes assisted verification; this artifact is **one** family's
review.

> **Independence (LLP 0005).** Draft authored by Charlie Cheever / Codex
> (GPT-family); this is a genuine cross-family review. Caveat: the parent
> critique (LLP 0038) is Claude-authored, so findings were checked against
> LLP 0011/0024 and code, not 0038's framing alone.

## Overall assessment

The right slice, and most of it is real: the protected `_auth_*` split, the
app-visible profile surface, epoch-fed `resync_required`, and declared auth
variables all match ratified LLP 0011 direction, and the epoch/resync and
auth-variable machinery it claims to reuse genuinely exists in code. The
concerns are (a) three silent divergences from the ratified parent (dropped
`roles`, collapsed `_auth_accounts`, weakened user-switch wording), (b) hard
0011 constraints a builder needs restated (transactional first-login
provisioning, credential work outside the write lock, token redaction), and
(c) one structural omission: the slice never says whether it authenticates the
live/outbox connection-id namespace — the known unauthenticated surface
(LLP 0038 Part 4 #6). An auth slice that leaves live streams drainable by
connection-id does not deliver "private rooms."

## Strengths

- Correct scoping instinct: one provider, one session flow, driving the same
  query/mutation/live/sync/diagnostics machinery every later provider will use.
- The epoch-advance + `resync_required` fail-closed posture avoids
  overclaiming live per-row permission re-evaluation — exactly 0011's line.
- Email-code-first with a local capture mailbox keeps the slice testable
  without external accounts, matching the corpus's acceptance discipline.
- Non-goals are honest and correctly resist the become-Clerk temptation.

## Concerns

1. **[HIGH] The connection-id namespace is unaddressed.** `ctx.auth` on
   requests and subscriptions is designed, but nothing says the outbox/stream
   endpoints stop being reachable by bare connection id. Either the slice binds
   the live/WS namespace to sessions, or that must be an explicit non-goal
   with rationale. *Resolves with:* a Design commitment (session-bound
   connection namespace) plus an acceptance criterion.
2. **[MEDIUM] Silent divergences from ratified 0011:** `roles?: string[]` is
   in 0011's *minimum* `ctx.auth` shape and 0024's `--as-role` depends on it —
   0039 omits it without comment; 0011 models user/account/session and Valet
   exported `_auth_accounts` — 0039's four tables silently merge account into
   identity; 0011's ratified user-switch rule is "wipe all local data,
   mutation queues, and subscriptions" — 0039's "wipes or invalidates retained
   local results" under-promises. Each is defensible; none is stated.
3. **[MEDIUM] Dropped 0011 constraints a builder will violate by default:**
   first-login provisioning transactional from the verified request (no
   webhook race); code hashing/verification outside the single-writer lock;
   session tokens stored hashed and redacted from logs/diagnostics; replay
   parity of `ctx.auth` (defer explicitly to LLP 0043).
4. **[MEDIUM] Cookie transport named without a CSRF/origin stance**, in a
   server whose loopback CORS deliberately echoes any localhost origin.
5. **[LOW] Diagnostic-code collision:** code already ships
   `SNAPBACK_AUTH_USER_MISSING`; the five new codes should be mapped to it.
6. **[LOW] "Session refresh" is one unspecified phrase** — rotation vs sliding
   expiry is a real design fork; pin it or move to Open Questions.
7. **[LOW] Missing acceptance criteria:** two clients on the same logical
   query receiving different authorized results (0011's sharpest
   partial-sync proof); single-use + attempt-limited codes with a lockout
   diagnostic; server-side logout revocation observable on the live path;
   impersonation emitting 0024's audit fact, not just console labeling; new
   `/auth/*` routes classified in the LLP 0031 registry.

## Suggestions

- Add per-address code-request throttling (anti-mail-bombing) — attempt
  limits protect exchange, nothing protects request.
- Note the existing Rust `AuthContext` in `src/ephemeral.rs` (room-permission
  shaped) that will collide in name with the new principal context.
- Relate LLP 0042/0043/0045 — the slice's session core, replay parity, and
  code-delivery path are consumed by all three sibling drafts.

## Open questions (for the author)

- Should the account/identity merge be permanent, or is `_auth_accounts`
  reserved for the first external OAuth provider?

## Recommended next step

Revise and stay `Draft`. The slice selection is right; the fixes are
alignment-with-parent and explicitness, not redesign. Given auth's blast
radius, a second family pass after revision is warranted.

## Revisions applied (2026-07-07, at the author's request)

Applied to the draft: session-bound connection namespace in Design +
acceptance (concern 1); `roles` restored to the context shape with role
*checks* a non-goal, account-merge and user-switch wording aligned and stated
(concern 2); provisioning/lock/redaction/replay-parity constraints restated
with 0011 citations (concern 3); cookie CSRF/origin stance (concern 4);
existing-code mapping (concern 5); refresh semantics moved to Open Questions
(concern 6); acceptance criteria added (concern 7); throttling line, sibling
Related links. Status left untouched.

## Correction (2026-07-07, later same session)

Concern 1's factual premise was stale. LLP 0038 Part 4 #6 described the
connection-id surface as unauthenticated, but the hardening commits that
landed after that review closed it: `/outbox/{connection_id}` and
`/live/{connection_id}/stream` are now `ConnectionAuth`-classified and require
a server-minted `connectionToken` (`src/server.rs` route taxonomy + grant
table). What remained genuinely missing — and what 0039 now specifies — is
binding that transport guard to the authenticated *principal* (token reuse
across principals rejected; session revocation invalidates the grant). The
draft and its acceptance criteria were re-corrected accordingly, with the
author's ratification recorded. The severity of the original concern drops
from HIGH to MEDIUM in hindsight; the design addition remains necessary for
"private rooms."
