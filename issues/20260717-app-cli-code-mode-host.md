# Code mode: broker protocol, script host, lifecycle, ceilings

**Status:** Open
**Impact:** 4
**Urgency:** 2
**Ease:** 1
**Confidence:** 3
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Code mode: broker protocol, script host, lifecycle, ceilings” shows the issue materially affects a supported product or engineering path; it can wait behind current correctness blockers, while delivery is a dependency-heavy, multi-stage program, with a clear design but unresolved dependencies.
**Severity:** P2
**Systems:** Tooling, Client integration, Security
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §3 (Review revision `14f54843…`), ibex LLPs 0013/0014 (boundary framing)
**Marker:** app-cli, sub-stage-c, code-mode

`run <script.ts|js>` / `run -`: a parent-owned script-host child; the
broker protocol is a versioned, transport-neutral frame schema (the
future MCP catalog's substrate too). Per the final LLP 0062 §3:
frozen null-prototype `api`; **valid app exports** that are hazardous
as object/thenable properties (`then`, `constructor`, `__proto__`, …)
lose the property alias only (typed diagnostic; callable via the
stable `snapback.function(id)` fallback — one hazardous name never
disables the app). Syntactically invalid and authoring/engine-reserved
names remain invalid at codegen and forged-envelope admission; they do
not receive the fallback. Engine metadata lives on the separate
frozen `snapback` global; typed brokered errors with per-call
timeouts (default 60s, explicitly included in exit 9's frozen meaning)
and pinned exit precedence (uncaught → the underlying class, including
exit 2 for in-run validation refusals);
async-iterable LiveQuery subscriptions under the §2 renewal/rotation
rules; erasable-syntax-only TS via the engine's own version-pinned
transform (no experimental Node flags; `import type` erased, dynamic
`import()`/`import.meta` refused); result = awaited default export
under the strict LLP 0010 value profile, validated child-side before
transfer and re-validated in the parent, **snapshotted before
`signal` fires**; the **signal-first lifecycle state machine**
(bounded 2s grace with broker refused — local-only cleanup, named;
provisional settlement until strict-profile and size admission;
parent-monotonic race ordering; late frames dropped with a
diagnostic); finite default ceilings (`--timeout` 120s, `--max-calls`
1000, subscriptions 16, broker message size, **V8 heap ceiling** —
honestly not total RSS; unexplained OS kills are exit 1 — and the
stdout ceiling with typed overflow). Typing is **three physical
products**: a distinctly named app-owned bindings member in the
envelope, engine-shipped ambient declarations, and the
`types`-merged `code-mode.d.ts` output the acceptance suite typechecks.

**Done when:**

- The host-portable contract suite passes: language profile cases,
  the export-name split both ways, caught/uncaught broker failures
  of every exit class, every ceiling including child heap-witnessed
  OOM, the signal-first grace window observed (cleanup runs; broker
  refused; forced kill at expiry), provisional-settlement failures
  exiting 10/11, snapshot-before-signal asserted, racing terminals
  in pinned order, and iterator disposal.
- The broker frame schema is committed with its own version, per-call
  timeout semantics, and drift gates; frames carry no bearer material
  (planted-secret suite, connection tokens included).
- Typecheck fixtures compile LLP 0062 §3's examples against the
  `types`-merged `code-mode.d.ts` exactly.
