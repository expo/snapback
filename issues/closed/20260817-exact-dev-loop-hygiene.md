# Exact: dev-loop hygiene — nonlocal typecheck, hot-reload ViewNotFound, Image-alt false positive

**Opened:** 2026-08-17
**Source:** Coterie backendless baseline and M3 entries (Diary 0086);
LLP 0279 item 15

## Symptoms

Three development-surface frictions, none a product-semantics defect:

1. **Nonlocal typecheck.** `bun run typecheck` follows the linked Exact
   source graph, so a dirty sibling Exact checkout failed an early Coterie
   run on errors in code Coterie does not own, and the later pass was
   green only because the sibling changed. App typecheck outcomes should be
   local to the app (or clearly partitioned app-versus-linked-source).
2. **Hot-reload wedge.** Repeated native hot reloads could coalesce into a
   rejected `ViewNotFound` protocol frame; only a clean scoped simulator
   relaunch restored a valid tree. The loop should recover or name the
   recovery.
3. **Image-alt false positive.** The runtime logged an Image-alt warning
   even though every rendered image in Acto carried an accessibility label.

## Ask

Fix each independently; they are bundled here because all three are
dev-loop trust papercuts observed in one program. External (Exact repo)
fixes; graduate to Linear (Exact project) when picked up.

## Resolution (2026-08-17)

Graduated to the Exact repo: `issues/20260817-exact-dev-loop-hygiene.md` there. Picked up by the
sbs-orchestrate Exact-side batch; further state lives in the Exact ticket.
