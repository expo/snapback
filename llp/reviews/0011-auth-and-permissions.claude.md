# Review: LLP 0011 — Auth and permissions

**Reviewed:** `llp/0011-auth-and-permissions.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the on-machine
Valet repository; nothing sent externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the Valet
retrospective evidence — especially Valet's auth-system explainer, swappable-auth-
provider RFC, react-subscriptions explainer, and implementation-status guide, plus
the multiplayer diaries. Requested with "revise to make them better"; this
**applied** the edits below and **flagged** one genuine direction call.

> **Independence (LLP 0005).** Drafted by Codex; reviewed/revised by Claude
> (cross-family). Valet's swappable-auth provider was one of its most fully-built
> late subsystems, so most of this is `[observed]` from a working implementation.

## Overall assessment

The draft's thesis — auth as first-class data, authentication vs. authorization
split, permissions feeding sync visibility, BYOP without ceding data ownership — is
correct and matches both LLP 0001's synthesis and what Valet built. Two things
needed attention. First, several questions the draft left open were *answered* by
Valet's shipped auth system (the stable-principal + identity-link model, write-side
fail-closed RLS, user-switch wipe, webhook/admin/deletion rules) and could be
adopted rather than re-derived. Second — and more important — the draft contains one
requirement, **live permission-change remove-deltas to still-connected clients**,
that is *harder than anything Valet shipped*: Valet resolved a subscription's auth
variables once at subscribe time and required a resubscribe on auth change. Stating
that requirement as if it were free would set a trap for implementation. The revision
adopts the answered parts and **flags the hard part as a ratifying decision** rather
than silently choosing for the author.

## Strengths

- **Authorization feeds sync, not the UI** — "if a row is not visible … it must not
  enter the snapshot, delta, or local store" is exactly Valet's enforced RLS and the
  card-game requirement.
- **`ctx.auth` as a stable minimum shape** with test/doctor impersonation is the
  right agent-DX affordance; Valet's dev mode is the proven model.
- **BYOP framed as identity source, not data owner** — matches Valet's stable-
  principal design precisely.

## Concerns

- **C1 — Live permission-change remove-deltas are harder than what shipped; flag,
  don't assume. [High — direction call]** Valet froze auth vars at subscribe time and
  required resubscribe on change; mid-connection re-evaluation (emit `remove` to
  connected clients, filter resumed changes through *current* permissions) is real,
  budgetable work. *Resolves when:* the author chooses to build per-update
  re-evaluation or adopt resubscribe-on-change, and the validation test is written
  against that choice. **Flagged** (not silently decided) — surfaced in *Local-First
  and Realtime Implications*, *Validation Requirements*, and *Open Questions*.
- **C2 — "Auth as first-class data" needs the protected-vs-app-queryable split.
  [Medium-High — partial contradiction]** Valet kept core `_auth_*` tables
  server-authoritative, unsynced, and hidden from client types to prevent leaks;
  only app-defined profile/membership data keyed by `userId` was queryable, and the
  portable bundle exported identity but not sessions/codes/secrets. *Resolves when:*
  the doc distinguishes the two. **Applied** (*Authentication Model*).
- **C3 — The BYOP model and its safety rules were open; Valet answered them.
  [Medium]** Stable principal id + `_auth_identities` links; transactional first-login
  provisioning (not webhook-raced); **cross-provider email auto-link opt-in only**
  (account-takeover vector); webhook HMAC verified by the runtime *before* the
  adapter (replay window + body cap); admin ops gated; `UserDeleted` does **not**
  cascade-delete app data. **Applied** (*Authentication Model*, *Bring Your Own
  Provider*).
- **C4 — RLS must enforce on writes and fail closed; the draft only implied reads.
  [Medium]** Insert/update(pre+post-merge)/delete all checked; missing auth var →
  null → no rows; unauth + auth-referencing filter → reject, never return all.
  **Applied** (*Authorization Model*).
- **C5 — Offline `ctx.auth` parity and user-switch hygiene were unstated. [Medium]**
  `ctx.auth` must exist offline and agree across optimistic and server replay (the
  diary's single biggest offline-first blocker); a user switch must wipe all local
  data/queues/subscriptions; identity is derived server-side, never trusted from a
  client token. **Applied** (*ctx.auth*, *Local-First and Realtime Implications*).
- **C6 — Concrete implementation rules worth pinning now. [Low]** Argon2 hashing must
  run outside the DB lock (given single-writer SQLite); dev-mode impersonation is
  explicit/`--dev`-only/logged. **Applied** (*Authentication Model*, *Admin, Tests,
  and Impersonation*).

## Suggestions (non-blocking)

- Either Clerk or WorkOS is a proven first BYOP adapter (Valet shipped both).
- Permission rules should be structured, serializable predicates (Valet resolved
  `{$var}` at subscribe time); opaque rules are not incrementally matchable — keep
  them aligned with LLP 0008's analyzable-query line.

## Open questions (for the author)

- **The C1 direction call** — live re-evaluation vs. resubscribe-on-change — gates
  how hard the sync side of auth is; it should be decided before sync hardens.
- First built-in auth methods; roles as core vs app data; org/team modeling.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.**
2. **Charlie makes the C1 call** — it is the one genuinely new design decision this
   document forces, and the rest of the auth/sync surface depends on it.
3. **Charlie reviews the adopted Valet model** (C2–C6) — the protected-vs-queryable
   split (C2) is the one with product-surface consequences worth ratifying.
