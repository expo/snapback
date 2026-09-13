# Landings must name the rows they close

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Systems:** Process
**Date:** 2026-08-24
**Related:** `issues/shelved/20260824-liveness-row-bucket-assignment.md`, LLP 0303, LLP 0283

## The problem

The programme is tracked as "N of 96 rows landed", where the 96 are the independent surfaces in
`issues/shelved/20260824-liveness-row-bucket-assignment.md`. That number cannot currently be computed.

The OAuth consent lane landed eleven commits (`312ffc059..71dc8d565`). Searching all eleven commit
messages and bodies for row identifiers returns **nothing** — no `F###`, no `C###`. The work is real
and the commits are well written, but nothing ties them to the inventory the programme is measured
against.

The best available proxy is indirect: counting call sites of the shared derivation predicate
`require_agent_grant_management_session` on `main` gives **7**, up from **4** before that landing —
so roughly three more subjects are now derived. That is an inference from a helper's popularity, not
a measurement, and it will stop working the moment a lane derives through a different predicate.

## Why it matters

Three separate counts have been published in this programme and corrected: "137 liveness-only rows"
which was 134, "47 of 68 P2 rows planned" which was 34 at row granularity, and an in-session claim of
"3 of 96 landed" whose relationship to the OAuth landing is now unclear. Each correction came from
someone recounting by hand.

An unmeasurable completion metric is worse than a pessimistic one: it makes "are we converging"
unanswerable, which is the question the whole programme is steered by.

## What to do

**Every landing names the rows it closes, in the commit message, using the identifiers from the
bucket assignment.** A trailer is enough:

```
Closes-rows: F170, F171, F172, F173
```

And where a landing does *not* close a row it touches — because it hardens a fixture, fixes drift, or
partially derives — say that too:

```
Touches-rows: F149 (fixture only; derivation unchanged)
```

This costs a line per landing and makes the count a `git log` query instead of an archaeology
exercise. It also forces the author to state which row they believe they closed, which is exactly
the claim a reviewer should be checking.

## Retrospective: what the OAuth landing actually closed

Reconstructed here rather than left owed, since the whole point of this ticket is that the count
should be knowable.

The bucket assignment defines the OAuth consent rows as:

| Row | Site | Condition |
|---|---|---|
| F170 | `engine:5059` | OAuth-specific wrapper around the same decision as F182 (a duplicate) |
| F171 | `engine:5099` | Session authority, source `AgentGrantManagement`, `authority.user_id == consenting_user_id` |
| F172 | `engine:5137` | Exact authority user and session equal `effective_user_id`/`session_id` |
| F173 | `engine:5157` | `authority.user_id == consenting_user_id`, request storage-verified for that user |

On `main` after the landing:

- `require_agent_grant_management_session` now has **7** call sites in `engine.rs`, up from 4,
  including one binding `(consenting_user_id, _)` and one binding `(effective_user_id, session_id)` —
  the shapes F171/F173 and F172 respectively describe.
- `consenting_user_id` appears **0** times in `crates/snapback-server/src/server/oauth.rs`, so the
  server no longer supplies it.
- Exactly **one** `consenting_user_id: &str` parameter remains in `engine.rs`, at line 5357 — inside
  **`deny_oauth_authorization`**.

That last fact is the useful one. The surviving parameter is precisely the deny path, which belongs
to a separate, still-unlanded lane. So the approve/consent side is derived and the deny side is not,
which is exactly the asymmetry that lane exists to close and independently corroborates that these
rows moved together.

**Assessment:** the OAuth landing closes **F171, F172 and F173**, with **F170** following as the
duplicate wrapper. Stated as an assessment rather than a fact, because it is reconstructed from
call-site shapes rather than from a claim the landing made — which is the entire failure this ticket
is about. A `Closes-rows:` trailer would have made it a lookup.

---

## Correction: "11 of 96" was overcounting. It is 7.

The deny/revoke landing did carry a `Closes-rows:` trailer — the mechanism proposed by this ticket
was adopted immediately, which is the good news. But it named **function names**, not row
identifiers:

```
Closes-rows: deny_oauth_authorization (derivation), deny_grant_request (derivation),
             revoke_grant_for_user (derivation), revoke_grants_by_actor_for_user (derivation)
```

Checking each against the bucket assignment: **none of the four appears in it.** They were not
catalogued rows. They came from a neighbourhood audit recorded in
`issues/shelved/20260824-deny-paths-left-unfixed-beside-fixed-approve-paths.md`, after two earlier lanes
fixed approve-style operations and left the adjacent deny operations untouched.

So the accurate ledger is:

| Source | Rows in the 96 |
|---|---:|
| Landed before this session (F188, F190, F191) | 3 |
| OAuth consent landing (F170–F173) | 4 |
| **Total against the 96** | **7** |
| deny/revoke landing (4 boundaries, adjacent work) | **0** |

**Approximately 7 of 96, not 11.** The deny work is real and valuable — it closed a genuine
denial-of-service and state-corruption surface, and made the OAuth consent/deny pair symmetric — but
it is *additional* to the inventory rather than progress through it.

### What this changes about the trailer

The trailer needs to be **row identifiers from the bucket assignment**, and where a landing closes
something outside the inventory it should say so explicitly:

```
Closes-rows: F170, F171, F172, F173
Closes-adjacent: deny_oauth_authorization, deny_grant_request, revoke_grant_for_user,
                 revoke_grants_by_actor_for_user   (neighbourhood audit; not in the 96)
```

Without that distinction the trailer reproduces exactly the ambiguity it was introduced to remove —
a reader summing trailers would have reached 11 too.

### On the pattern

This is the fourth count in this programme published and then corrected: 137→134, 47→34, an unclear
in-session figure, and now 11→7. Every one was an over-count, and every one was found by recounting
by hand rather than by a check. That consistency is itself a signal: the natural failure mode here is
crediting adjacent or duplicated work to the inventory, so a count should be treated as unverified
until each identifier has been looked up.