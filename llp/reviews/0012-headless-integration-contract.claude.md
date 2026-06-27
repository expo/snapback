# Review: LLP 0012 — Headless integration contract

**Reviewed:** `llp/0012-headless-integration-contract.spec.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the on-machine
Valet repository; nothing sent externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the Valet
retrospective evidence — especially the codegen-pipeline, react-subscriptions,
wire-protocol, native-sdk-tiers, and vite-plugin specs, and the demo diaries (which
are mostly *about* the Contract↔Snapback integration boundary this Spec defines).
Requested with "revise to make them better"; this **applied** the edits below.

> **Independence (LLP 0005).** Drafted by Codex; reviewed/revised by Claude
> (cross-family). The diaries are the most direct evidence for this document of any
> in the corpus — every Contract+Snapback demo *is* an exercise of this boundary.

## Overall assessment

The keystone idea is right and was already well-stated: a single set of generated
facts (manifests, capability reports, diagnostics, runtime state) that every adapter
consumes, so Contract/Exact gets the richest paved path without growing a private
backend and React/Expo stays first-class. The draft's gap was that it specified the
*artifacts* but not the **packaging, versioning, and adapter behaviors** that the
diaries show are where integration actually succeeds or fails — and on this boundary,
the diaries are unanimous: the integration cost was "almost entirely packaging," and
in the sharpest finding, **`tsc` passed while reporting real unresolved-module
errors**, so typecheck — an agent's primary self-validation signal — was "lying about
being green." A headless contract whose published artifacts are not trustworthy enough
for honest typecheck has not really shipped. The revision adds the packaging bar, the
Online-vs-Parity capability class, the current-value+subscription seam, the reference
adapter's race-handling, and the single-source + drift-gate versioning. The doc's one
unchanged dependency is not Snapback's to resolve: the canonical Contract/Exact
definition is still owed by the ratifying source (LLP 0000 terminology gap, C1 there).

## Strengths

- **Shared facts, not private code paths** (*Contract Artifacts*) — "adapters do not
  infer backend semantics from private code paths" is the invariant that keeps
  React/Expo first-class, and it is testable.
- **Capability manifest + "surface, don't silently fall back"** is the right
  posture; the Online-vs-Parity distinction (added) makes it concrete.
- **Honest about the missing Contract/Exact definition** — it defines Snapback's
  side of the boundary and defers the term, which is the correct interim state.

## Concerns

- **C1 — Packaging and typecheck honesty were unspecified, and the diaries say
  that is where integration lives or dies. [High]** No published typed package →
  hand-maintained alias maps → `tsc` green while broken; React-coupled
  "framework-agnostic" client; ~200 lines of bridge glue copied per demo. *Resolves
  when:* the contract ships real, typed, versioned packages (not source aliases), a
  build preset that owns wiring, and the bridge as a first-class adapter; "honest
  typecheck" becomes a validation requirement. **Applied** (*Contract Artifacts*,
  *Validation Requirements*).
- **C2 — The Online-vs-Parity capability class was missing. [Medium-High]** An
  online-only adapter must not be reported or documented as local-first; "no local
  handler execution means no parity claim." *Resolves when:* the manifest encodes the
  class. **Applied** (*Capability Manifest*, *React and Expo Requirements*).
- **C3 — The initial-snapshot seam (the diaries' most repeated Snapback complaint)
  belongs in the runtime-state contract. [Medium]** Every demo primed from
  `getAllDocs` because subscribe delivered no authoritative initial value. *Resolves
  when:* subscription state is one "current value plus subscription" seam.
  **Applied** (*Runtime State*).
- **C4 — The reference adapter's race-handling should be specified, not re-derived.
  [Medium]** Pre-subscribe delta queueing filtered to `version > subscribeResponse`;
  pre-auth buffering; full-resync-on-reconnect; error→empty-array (not `undefined`);
  `skip` = full unsubscribe; combined pending count. **Applied** (*Runtime State*,
  *React and Expo Requirements*).
- **C5 — The function manifest needs an explicit, validated read-set/primary-table.
  [Medium]** A namespace/table mismatch silently left data unreachable by the UI in
  Valet (no error). *Resolves when:* the table binding is a checked manifest fact (it
  also feeds LLP 0008's matcher). **Applied** (*Function Manifest*).
- **C6 — Versioning needed a single source of truth, a drift gate, and capability-
  based resolution. [Medium]** Valet hand-synced `protocol.ts`/`protocol.rs`, computed
  two divergent schema hashes, and a peer checkout silently lagged a vendored one.
  *Resolves when:* one source-of-truth schema with a CI drift test, explicit hash
  scope, an `inputsHash` staleness marker, and probe-by-capability resolution.
  **Applied** (*Versioning*).

## Suggestions (non-blocking)

- A `@expo/snapback/contract`-style first-class bridge (Valet's unbuilt
  `openSnapbackContractRuntime`) would retire the per-demo glue the diaries complain
  about in every entry.
- The Contract web-E2E gotcha (a per-render DOM mirror fights Playwright
  actionability) belongs in the eventual Contract/Exact adapter notes.

## Open questions (for the author / ratifying source)

- **The canonical Contract/Exact definition** — unchanged gating dependency
  (LLP 0000 C1); not Snapback's to invent.
- Physical package boundaries (one package with adapter entrypoints vs. per-framework
  packages); which artifact schemas must be stable before implementation.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** Revise when the canonical Contract/Exact reference
   lands and when the first generated adapter exists.
2. **Charlie reviews C1** — the packaging/typecheck-honesty bar is the one with the
   most leverage on whether an agent can trust this boundary at all.
3. **Validate with two real adapters** consuming one generated app (the doc's own
   two-surface test), with honest typecheck on both as an explicit gate.
