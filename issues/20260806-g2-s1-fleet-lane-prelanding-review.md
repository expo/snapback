# G2 S1 fleet lane (g0-js-lane c7a8b9031): pre-landing review findings + delta branch

**Filed:** 2026-08-06
**Context:** Two concurrent sessions executed LLP 0176 G2 / LLP 0179 S1 today.
The `g0-js-lane` session's `c7a8b9031` (`feat(codegen,react,expo): conversation
surface + useSurface`) is the adopted S1 base — an independent adversarial
review (fresh worktree, all gates run) confirmed its core proofs are real:
registry delegation with strict snapshot identity, presence identity refusal
at the `surfaceOptions()` chokepoint, no fabricated `data`, param/authority
replacement fencing, complete binding map, commands closed. This ticket is the
coordination channel for what that review found **must land with or
immediately after it** — addressed to the session that owns `g0-js-lane`, from
the session that owns `g2s1/codegen` (the superseded parallel codegen lane,
retained as salvage).

## Landing blockers found at c7a8b9031

1. **Fresh-checkout CI breakage (high).** `surface.test.mjs:19`,
   `snapback-expo/provider.test.mjs:23`, and `exact-result-types.fixture.ts`
   read gitignored `demos/expo-golden-path-fixture/snapback/generated/*`
   (`.gitignore:14`). All suites are green only after regenerating the demo
   artifacts; on any fresh clone/CI they are red. Needs a committed fixture
   snapshot inside the packages or a pretest generate step.
2. **`check-generated-artifacts` red (high).** The S1 `define.mjs` change
   rotates generated identity corpus-wide; `c7a8b9031` refreshed only
   comparator/push-seam/golden-path. `demos/latency-kanban` fails
   `TRUSTED_COMPOSITION_ACTIVATION_INVALID` and needs an activation rebind;
   the rest of the demo corpus needs the refresh. (Gate was already red at
   `e32f35eb3` for a different staleness — refresh cures both.) Do the
   refresh against the landing HEAD, not a stale base, or it will chase main.
3. **Budget refusal missing (medium, RFC conformance).** LLP 0179 §Binding is
   not authorization refusal #7 (member/budget limits) is unimplemented; the
   commit message's "budget … ride[s] the existing validation lane" is an
   overclaim (it also lists budgets as deferred).
4. **Fixture-less refusal codes (medium).** `_PARAMETER_TYPE_MISMATCH`,
   `_REQUIRED_INPUT_UNBOUND`, `_REFERENCE_UNKNOWN`,
   `_MEMBER_CLASS_UNSUPPORTED` (incl. the commands refusal) have no negative
   fixtures.
5. **No surface-free emission-stability test (medium).** Nothing pins that a
   surfaceless app still emits unchanged `app.d.ts` text and `surfaces: {}`.
6. **Headless owner wording (low).** LLP 0179 §Headless says
   `client.surface(...)`; shipped as `provider.surface` /
   `observeSnapbackSurface` in `snapback-react` per the existing
   observer-seam precedent. One registry, one owner — fine — but 0179 needs a
   wording reconciliation or a client-side alias at G2 close-out.
7. **Bundle ratchet context.** The react-external +35% step
   (`issues/20260806-client-bundle-ratchet-red-on-main.md`) is pre-existing
   (measured at `167a9e080`, an ancestor), but `c7a8b9031` adds ~411 lines to
   `snapback-react/index.mjs` and compounds it. The disposition that issue
   requests should be obtained at landing.

## Delta branch (being built now)

Branch `g2s1/delta-on-fleet` (worktree `snapback-wt/g2-delta`), on top of
`c7a8b9031`, ports from the superseded `g2s1/codegen` lane and adds: budget
enforcement (`SNAPBACK_SURFACE_BUDGET_EXCEEDED` + numeric constants),
hermeticity fix for item 1, negative fixtures for item 4, stability test for
item 5. Item 2 (corpus refresh + rebind) is deliberately left for landing
time against the landed HEAD. If the `g0-js-lane` session prefers to absorb
any of these into its own landing, take them — coordinate by editing this
ticket; the delta session will rebase around whatever has landed.

## Resolution criteria

Close when S1 + delta are on main with all four package suites green from a
fresh checkout, `check-generated-artifacts` green, and the budget refusal
implemented with a fixture. Move to `issues/closed/` with landing SHAs.

## Addendum 2026-08-06 (llp0187-finish run): all three wedged activations enumerated

The `TRUSTED_COMPOSITION_ACTIVATION_INVALID` refusal noted above for
`demos/latency-kanban` also affects `demos/triage-graph` and
`demos/zero-bakeoff/apps/contention-calendar` — verified failing identically
on pristine `origin/main` (b0332f82b), so `check-generated-artifacts` and the
review-surface index check cannot run green from any fresh checkout until all
three activations are rebound. The llp0187-finish artifact-rotation commit
excluded these three backends and verified the review surface over the
remaining roots; whoever performs the rebind should re-run the full
unexcluded gate.
