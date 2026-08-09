# Guide/docs hygiene batch: false template count, skill routing gaps, GAP-row cliff, orphan docs/

**Status:** Closed
**Opened:** 2026-08-08 · **Severity:** P2 batch (item 1 is P1) · **Area:** guide / skills/snapback-authoring / capabilities index / docs/

From the 2026-08-08 agentic surface audit (LLP 0202 themes 5 and 10).

1. **(P1) The guide states a false template count and hides two shipped
   templates.** Five templates ship
   (`packages/snapback-cli/templates/`: `crud-dashboard`, `expo-chat`,
   `media-feed`, `react`, `todo-contract`);
   `guide/getting-started/the-authoring-loop.md:47` says "Three templates
   ship" and names three; `crud-dashboard` and `media-feed` appear nowhere
   in `guide/` or in `skills/snapback-authoring/SKILL.md` (step 1 names only
   `react` and `expo-chat`). Both are cold-install-proven
   (`scripts/snapback-package-cold-install.mjs:2901,2947`). They landed
   *before* the page's own review pin, so this is a review miss, not lag
   (`issues/20260808-llp0196-template-program-execution.md:84`: "No guide
   page or LLP document changed in this lane"). Fix: list all five with one
   line each; add the two names to the skill; add
   `packages/snapback-cli/templates` to the page's `authorities:` so
   freshness can see the next drift — note `checkFreshness`
   (`scripts/guide-lib.mjs:647`) diffs `authorities:` only and ignores
   `examples:`, which is why this page could never warn.
2. **The authoring skill never routes to the generated API reference** — no
   mention of `guide/reference/index.md`, `registry.json`, or
   `snapback guide <ExactSymbolName>` (847 symbols, budgeted lookup). One
   line in the "load the guide first" block closes it.
3. **Capability GAP-row cliff.** 11 of 15 GAP rows carry no `issues/` link,
   and 11 share the same `2026-08-31` review date — one day on which CI
   hard-errors for eleven rows at once, where the cheapest green is a bulk
   date roll. Fix: stagger the dates; require an issues link in
   `checkCapabilityIndex` (`scripts/guide-lib.mjs:574-576`).
4. **`docs/` is an unrouted orphan.** Linked from nothing;
   `docs/llp-0097-implementation-plan.md` and
   `docs/migration-presentation-contract.md` carry no status/freshness and
   are referenced by nothing. Move under `llp/` or add a one-line
   `docs/README.md` declaring the directory legacy.
5. **Smaller:** `guide/surface-map.md:13` pins a 9-char `reviewed-commit`
   where the convention (`guide/conventions.md:48`) is the full 40; the
   freshness-saturation ticket
   (`issues/20260808-guide-freshness-warning-saturation.md`) understates
   progress (measured now 45/65 = 69%, not 62/64 = 97%) and should absorb
   the `examples:`-blindness from item 1; `guide/clients/headless.md` and
   `packages/snapback-client/README.md` should state the
   no-agent-registration boundary at the credential-mode fork so agents stop
   hunting for a route that does not exist (LLP 0202 P0 #4's only
   presently-actionable slice).

## Resolution (2026-08-08)

The hygiene batch landed across the guide, checker, skill, and package readme:

- `guide/getting-started/the-authoring-loop.md` now lists all five packaged
  templates with one-line intent summaries and treats the template directory
  as a freshness authority. `skills/snapback-authoring/SKILL.md` routes CRUD
  and media briefs to their templates.
- The authoring skill routes declaration-exact questions to
  `guide/reference/index.md` and `snapback guide <ExactSymbolName>`.
- All capability GAPs now link durable `issues/` custody; the eleven shared
  review dates are staggered, and `scripts/guide-lib.mjs` rejects future GAP
  rows without an issue link under the governing LLP 0061 reference.
- `docs/README.md` labels the directory as a legacy shelf and points readers to
  `llp/` and `guide/` without moving historical files.
- `guide/surface-map.md` has a full 40-character review pin;
  `issues/20260808-guide-freshness-warning-saturation.md` records the corrected
  45/65 measurement and the `examples:` freshness blind spot; and the headless
  guide plus package README state that agent-authority mode only adopts an
  already-issued credential and has no user-facing registration/initial-token
  route.

The generated symbol registry, reference pages, and guide manifest/flat
projection were regenerated after these source changes.
