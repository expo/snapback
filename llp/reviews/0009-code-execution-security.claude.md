# Review: LLP 0009 — Code execution security and tenant isolation

**Reviewed:** `llp/0009-code-execution-security.rfc.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the on-machine
Valet repository; nothing sent externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the Valet
retrospective evidence — especially Valet's js-runtime-sandbox, local-execution-
context, swappable-handler-runtime, portable-runtime-adapters, environment-secrets
specs and its implementation-status guide. Requested with "revise to make them
better"; this **applied** the edits documented below.

> **Independence (LLP 0005).** Drafted by Codex; reviewed/revised by Claude
> (cross-family). The corrections are grounded in Valet's implementation-status
> record, which states plainly what was built and what was a no-op stub.

## Overall assessment

The draft's *posture* is right — capability-limited runtime, no ambient access,
fresh contexts by default, honest separation of local/self-host/multi-tenant threat
models. But it contained the **single most consequential factual error in the set**:
it lists "invocation wall-clock timeout" among the limits Snapback enforces, and
asserts "the programming model must not depend on engine-specific powers." Valet's
record contradicts both. Its Ibex/Hermes watchdog was a **no-op stub** — and because
the engine's `eval` is a synchronous FFI call, an async wall-clock timeout cannot
preempt a running handler, so runaway code was *never terminated* ("unsafe against
CPU-exhaustion attackers"). And its engines were **not interchangeable**: the
default engine rejected `async` handlers, forcing a switch to the legacy engine. The
isolate-clean V8 path — the one suited to untrusted multi-tenant code — was designed
but never built. A security RFC that assumes enforcement the canonical engine cannot
deliver is worse than one that admits the gap, so the revision makes the document
honest about what each engine can actually enforce.

## Strengths

- **Capability shape and fresh-context default** are exactly right and align with
  what Valet shipped (fresh runtime per invocation, complete isolation).
- **Three-tier threat model** (local / self-host / multi-tenant) is the correct
  framing and prevents a local-only ambient-power design.
- **"Diagnostics useful without leaking secrets"** anticipates the secret-handling
  discipline Valet learned the hard way.

## Concerns

- **C1 — The RFC claims an enforced wall-clock timeout the canonical engine cannot
  enforce. [High — strongest in the set]** Valet's watchdog was a no-op; sync FFI is
  not preemptible. *Resolves when:* the doc states honestly that on Ibex/Hermes
  CPU/wall-clock limits are not enforceable in-process; real containment needs an
  engine watchdog, a killable process/isolate, or the V8 path; the capability report
  must mark each limit *enforced* vs *advisory*. **Applied** (*Summary*, *Resource
  Limits*, *Validation Requirements*).
- **C2 — "Engine choice is not a fork in the programming model" is false as
  observed; the RFC needs a runtime conformance contract. [High]** The default
  engine rejected `async`. *Resolves when:* the doc defines the language/feature
  floor every acceptable engine must pass, with a conformance suite, and names the
  V8/killable-isolate path as a load-bearing prerequisite for hosted code (it was
  never built in Valet). **Applied** (*Runtime Boundary*, new *Engine and threat
  model*; contradiction also flagged in LLP 0000 via 0006).
- **C3 — Pooling is unsolved, not merely unproven. [Medium]** Valet found no safe
  shared-VM technique on Hermes (no snapshot/restore). *Resolves when:* fresh-per-
  invocation is the durable default and pooling is framed as research. **Applied**
  (*Invocation Isolation*).
- **C4 — Secret handling needed concrete, hard-won rules. [Medium]** SecretString at
  the edge (never plain String); **never hash secret values in audit logs**
  (low-entropy brute-force); no read-back API; fresh nonce per write; and honest
  defense-in-depth (the runtime cannot prevent deliberate exfiltration). *Resolves
  when:* these are stated. **Applied** (*Secrets*) — also answers the doc's own open
  question on representing secret handles.
- **C5 — Raw-source handler shipping is a dead-end the draft left open. [Medium]**
  Valet shipped `handler.toString()`, which is why module-scope references threw on
  replay (the diary self-containment footgun) and which precludes multi-file/npm/
  tree-shaking/source-maps. *Resolves when:* go to hashed, bundled artifacts.
  **Applied** (*Supply Chain and Generated Bundles*).
- **C6 — Surface enforcement is defense-in-depth, not a boundary, and must use an
  AST. [Medium]** Valet's static surface checks were an escape-hatch arms race
  (`Reflect.get` tricks); the real boundary is the runtime not exposing the
  capability. *Resolves when:* the doc says so and mandates AST over regex.
  **Applied** (*Capability Model*).
- **C7 — Concrete runtime invariants worth pinning. [Low]** Raw-pointer DB access
  valid only under the held mutex; no nested transactions; no fetch-in-transaction;
  the blocked-global set for queries/mutations. **Applied** (*Runtime Boundary*).

## Suggestions (non-blocking)

- The "adopt the capability shape required by hosting where cheap" line must not be
  read as "Ibex is hosting-ready" — the revision says this explicitly, but it is
  worth a ratified emphasis given the multi-tenant ambitions.
- The held-DB-lock-for-whole-handler model couples directly to handler time budgets
  (LLP 0008's P99 ~1s under contention); they should be designed together.

## Open questions (for the author)

- The concrete enforceable-limit plan (engine watchdog vs killable isolate vs V8) —
  the gating security item.
- Which engine, on which target, is the first hosted/multi-tenant profile (gated on
  the unbuilt V8 path).

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** Review again before any app code runs outside trusted
   local development — the revision makes that gate sharper, not softer.
2. **Charlie reviews C1/C2 first** — the timeout-enforceability and engine-fork
   corrections change what the product can safely promise.
3. **Treat the V8/killable-isolate path as scheduled work**, not an aside, before
   hosted multi-tenant is offered.
