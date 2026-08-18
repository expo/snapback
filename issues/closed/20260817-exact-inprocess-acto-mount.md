# Exact: public in-process API to mount a routed .contract graph into an Acto tree

**Opened:** 2026-08-17
**Source:** Coterie M1 acceptance skeleton (Diary 0086); LLP 0279 item 13

## Gap

There is no public in-process API that mounts a routed `.contract` module
graph into an Acto semantic tree without the Vite/host surface. Coterie's
headless acceptance is therefore generated-binding provider evidence over
the frozen `sm-*` vocabulary — the frozen target IDs identify intent, but no
mounted UI tree is interacted with unless a browser or native host runs.

## Ask

Expose an in-process mount (module graph in, semantic tree + interaction
surface out) so acceptance runners can drive mounted `sm-*` nodes headlessly.
This would add a mounted-headless evidence tier between generated-binding
proof and browser/native-context proof (see LLP 0281 W9 and LLP 0266 D10).
External (Exact repo) feature; graduate to Linear (Exact project) when
picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-inprocess-acto-mount.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
