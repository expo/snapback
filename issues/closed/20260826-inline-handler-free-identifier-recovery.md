# `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER` refuses the idiomatic spelling without naming the admitted one

**Filed:** 2026-08-26 · **Resolved:** 2026-08-26
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-explicit`
**Systems:** Code generation, Diagnostics, Guide, Agent experience
**Owner:** LLP 0108 (grammar) / guide
**Related:** LLP 0310 F6 / P7,
  `issues/closed/20260801-0137-a4-outbound-notification-effects-unauthorable.md`

## Problem

The lane hoisted a shared regex to a module-level `const` and used it inside an
inline handler — the ordinary JavaScript move. Codegen refused with
`SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER`. The lane recovered by switching to a
function declaration, but only after a correction loop inside the Clique clock.

This ticket does **not** propose changing the grammar; LLP 0108 owns that and
the refusal may well be right. It proposes closing the recovery gap.

Filed under the pit-of-success standard recorded in LLP 0310 (2026-08-26): a
capable agent taking the idiomatic path and being refused is evidence about the
authoring surface, not about the agent. A design that refuses the natural
spelling owes the reader the admitted one at the point of refusal.

## Evidence

- `benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-explicit/run-log.md`
  (1787656800)
- LLP 0310 F6, inventory row P7

## Direction

1. The diagnostic must name the working shape inline — "a function declaration
   is admitted here; a captured module-level `const` is not" — with the
   rewrite, not just the refusal.
2. The explicit start packet should warn before the first handler is written,
   where it costs one sentence rather than a correction loop.
3. Check whether the same free-identifier class has other idiomatic triggers
   (imported helpers, module-level maps) and whether they all produce a
   recovery-bearing diagnostic.

## Resolution — 2026-08-26

1. **Done.** `freeIdentifierHints` (`packages/snapback-codegen/inline-handlers.mjs`)
   now names the admitted rewrite in every arm: a top-level value gets
   "turn `<name>` into a same-file function declaration … or pass the value
   through args or ctx"; an import gets "inline the value at the use site, pass
   it through args or ctx, or move the logic into a top-level function
   declaration in this file". The refusal no longer stops at *why*.
2. **Done.** `guide/backend/handler-runtime.md#can-i-import-a-helper` says the
   hoisted regex/map/constant is exactly what this refuses and to reach for the
   function declaration first. The expo-chat start packet's refusal trap now
   carries the concrete instance, so an agent is warned before the first handler
   is written. That addition was paid for inside LLP 0259's 16 KiB steering
   ceiling by compressing the trap it extends; the aggregate sits at 16384/16384,
   so any further packet addition must trade for its bytes.
3. **Checked.** The two emitting sites are the handler expression and the custom
   authorization evaluator; both route through `freeIdentifierHints`, so both
   idiomatic triggers (module-level values and imported helpers) now produce a
   recovery-bearing diagnostic. `SNAPBACK_INLINE_HELPER_INADMISSIBLE` remains the
   separate code for an otherwise invalid same-file helper.

The grammar is unchanged; LLP 0108 still owns it.
