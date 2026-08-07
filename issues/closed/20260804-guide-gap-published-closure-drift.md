# Guide gap: pages teach primitives the published closure does not contain

**Status:** Closed
**Impact:** 5
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Capability maturity, Codegen, Auth, Runtime, Agent experience
**Date:** 2026-08-04
**Governing:** LLP 0061, LLP 0134, LLP 0144, LLP 0171

## Problem

An agent building a chess backend against `@expo/snapback-*@0.1.8` authored
against two documented primitives that the installed packages do not have:

1. **`ctx.refuse` / per-function `refusals: [...]`** —
   `guide/backend/mutations.md`. Governed by LLP 0144 (Accepted; first slice
   landed 2026-08-01).
2. **`custody: 'anonymous-public'`** — `guide/auth/sessions-and-principals.md`.

Both pages are `maturity: shipped`, `status: current`, with **no version
fence**. Both exist in the source tree. Neither is in the published closure the
guide's own getting-started path tells an app author to install.

The framework already knows this class of drift exists. The authoring-loop page
states the rule:

> when a page describes a surface newer than the newest closure, it says so

The rule is unenforced, which puts the hole in exactly the place a reader is
most confident.

## What it cost

Both gaps forced workarounds, and **both workarounds are things the guide
separately names as anti-patterns**:

- Without `ctx.refuse`, the two rejection classes the app had to distinguish
  (out-of-turn vs. illegal move) both surface as `SNAPBACK_HANDLER_FAILED`. The
  arm shipped `refusalCodeOf()`, which regex-matches `CHESSFIELD_[A-Z_]+` out
  of the diagnostic message — against the guide's own explicit "assert on the
  code, never the message" rule. The arm flagged it as the weakest thing in its
  implementation.
- Without `custody: 'anonymous-public'`, the credential-less leaderboard read
  required a hand-rolled `fetch` against `/query/...` rather than the
  first-party client.

Time cost: roughly 4 minutes on the second gap alone, most of it re-reading the
guide convinced the option name had been mistyped, before grepping both trees
and finding the version split. Three of the arm's four largest time sinks trace
to this issue.

## Why this is worse than an ordinary docs bug

For a human, a doc describing an unreleased feature is an annoyance. For an
agent, **the text is the entire model of the system** — there is no ambient
memory of last quarter's release notes to correct it. Snapback states out loud
that its guide is optimized for agents "getting close to guarantees and
validating their own work." This is the specific failure that framing exists to
prevent.

## Proposed fix

The machinery already exists; only the join is missing.

1. Add **`since:`** to guide frontmatter — naming the closure in which the
   described surface became available — at page and, where a page mixes
   vintages, section granularity. Conventions live in `guide/conventions.md`
   (LLP 0061).
2. Extend **`scripts/check-guide.mjs`** (already in the local proof and the
   docs-only fast path) to join `since:` against the published package closure,
   and fail when a page claims `maturity: shipped` for a surface the newest
   published closure does not contain.
3. A page deliberately ahead of the closure declares `unreleased: true` and
   renders a banner.
4. Interim, before the check lands: fence the two known pages by hand.

Capability status remains LLP 0134's authority; this issue is about the
guide asserting availability, not about promoting anything.

## Evidence

- `diaries/0057-chess-backend-bakeoff.diary.md` — "What felt bad or surprising"
  and "Did agent-first hold up? (the claim, judged)"
- `~/projects/chess-bakeoff/implementations/snapback/conformance.mjs` —
  `refusalCodeOf()`, and the raw-`fetch` leaderboard read
- LLP 0171 §A — the same finding argued as the highest-leverage authoring repair

## Resolution (2026-08-06)

1. Added the checked-in newest-published record at
   `guide/published-closure.json`.
2. Added optional page and section `since` / `unreleased` conventions, schema
   validation, the repository-only consistency join, and manifest projection.
3. Added explicit 0.1.9 unreleased banners around the `ctx.refuse` and
   `anonymous-public` sections that are absent from 0.1.8.
4. Documented and proof-registered the mechanism with direct test fixtures, updated
   LLP 0061 and the authoring-loop narrative, and regenerated the guide corpus.
