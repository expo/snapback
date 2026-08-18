# Exact: diagnose curried action expressions in function-typed component props

**Opened:** 2026-08-17
**Source:** Coterie backendless baseline (Diary 0086, 2026-08-15 entry);
LLP 0279 item 6

## Symptom

Contract curries `press=likePost(post.id)` when the expression sits on an
event attribute, but the identical-looking expression evaluates eagerly when
assigned to an ordinary component prop. The first Coterie port passed
curried actions through props, so every rendered feed card toggled its like
state during render — a silent side-effect class, not a type error. The
composition guide documents the distinction, but it is easy to miss while
mechanically extracting a reusable component.

## Ask

Add a compiler diagnostic when an action-application expression flows into a
function-typed component prop (the render-time-side-effect shape), pointing
at the row-identity-plus-bare-action pattern the guide teaches. Acceptance:
recompiling the original faulty Coterie composition produces the diagnostic.
External (Exact repo) fix; graduate to Linear (Exact project) when picked
up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-curried-action-prop-diagnostic.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
