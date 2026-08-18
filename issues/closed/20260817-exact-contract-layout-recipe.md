# Exact: paved Contract layout/session-wiring example

**Opened:** 2026-08-17
**Source:** Coterie round-1 review fixes (Diary 0086); LLP 0279 item 16

## Gap

Without a layout component, every Coterie route repeats the same session
provider query and primary-navigation action wiring. The diary judges the
repetition honest and readable at the current size but names it "the first
place I would look for a paved Contract layout example as the stage-2 screen
count grows." There is currently no documented layout composition pattern
for routed Contract apps.

## Ask

Publish a paved layout example (shared session/header/navigation wiring
around routed children, with dynamic `route.params` preserved) in the Exact
composition docs, ideally extracted from Coterie's route set. External
(Exact repo) docs; graduate to Linear (Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-contract-layout-recipe.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
