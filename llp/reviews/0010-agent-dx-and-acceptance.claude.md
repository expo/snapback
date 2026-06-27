# Review: LLP 0010 — Agent DX and acceptance suite

**Reviewed:** `llp/0010-agent-dx-and-acceptance.spec.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the on-machine
Valet repository; nothing sent externally beyond the model serving this session.
**Method:** Single-session independent read-and-critique grounded in the Valet
retrospective evidence — especially the codegen-pipeline, deterministic-sync-testing,
machine-readable-conformance-corpus, and vite-plugin specs, the implementation-status
guide, and the demo diaries (which are, themselves, agent-DX field reports).
Requested with "revise to make them better"; this **applied** the edits below.

> **Independence (LLP 0005).** Drafted by Codex; reviewed/revised by Claude
> (cross-family). The diaries are first-hand agent-DX evidence — the most directly
> on-point source for this document of any in the corpus.

## Overall assessment

The strongest-aimed document in the set: it treats agent-first as a contract
(machine-readable diagnostics, inspectable artifacts, deterministic reset, capability
reports, honest CI gates) rather than a slogan, and its acceptance ladder is
sensible. Its gap was that it described the *shape* of good agent DX without the
*specific failures* that make or break it — and those are exactly what the Valet
diaries record, because the diaries are agent-authored DX reports. The single most
important addition is the **no-silent-drops** rule: Valet's regex-based schema codegen
silently stripped a field written as a validator-variable reference, so inserts
succeeded, filters returned nothing, and the agent debugged for seven steps against a
*false model of its own data*. That is the canonical agent-first failure, and a DX
spec that does not forbid it outright is incomplete. The revision adds it, plus the
harness/conformance-corpus contracts, the orchestrator tool surface, and the
parity-divergence capability flags.

## Strengths

- **Diagnostics-as-contract** (*Diagnostic Shape*) — stable codes, severity, source
  spans, "the diagnostic object is the contract, not the log" — is exactly right and
  is what made Valet's `exact:doctor` catch real bugs.
- **Capability reports + assert-the-gap CI** (*Capability Reports*, *CI and Review
  Gates*) — refusing to silently skip an unimplemented behavior is the correct
  discipline, and Valet's record shows how easily it is abandoned under pressure.
- **The todo floor and the acceptance ladder** are well-chosen; the
  externally-added collaborative rich-text stretch slice is consistent with the
  CRDT-deferral evidence.

## Concerns

- **C1 — "No silent drops" was missing, and it is the #1 agent-first hazard.
  [High]** Valet's regex+execute codegen silently dropped a field. *Resolves when:*
  anything codegen cannot parse emits a structured diagnostic with code + span and is
  never omitted; prefer AST over regex; validate manifest completeness against
  persistence. **Applied** (*Generated Artifacts*), with an `inputsHash`-style
  staleness marker.
- **C2 — The portability/conformance proof had no machine-readable contract, and the
  most critical runners are the ones that slip. [Medium-High]** Adopt Valet's corpus
  contract (cases as product artifacts, `required_capabilities`, soft-skip statuses,
  placeholder determinism, diffable results) and **sequence replay/wire runners
  first** — Valet built 4 of 9 and skipped exactly `wire` and `mutation_replay`.
  **Applied** (*CI and Review Gates*).
- **C3 — The test-surface story omitted the harness, its fault-injection, and the
  protocol-vs-handler-replay boundary. [Medium]** Valet's deterministic harness was
  right but applied mutations as snapshots, so handler replay — the hardest surface —
  went untested; multi-client browser tests are what caught the real bugs.
  *Resolves when:* both surfaces are specified and handler replay is first-class.
  **Applied** (new *Test Surfaces and Harness*).
- **C4 — The required tool surface existed in Valet (Vite plugin) with two DX
  anti-patterns to correct. [Medium]** Never silently serve stale bindings on codegen
  failure; local/offline tooling must exit cleanly (Valet's codegen returned non-zero
  offline); and provide a declarative, handler-bypassing seed. **Applied** (*Required
  Tool Surfaces*).
- **C5 — Known local-vs-server parity divergences should be capability flags, not
  tribal knowledge. [Low-Medium]** `new Date()` unpatched, mutable query builders,
  filter typos matching nothing, divergent id parsing, `withIndex` local-vs-server.
  **Applied** (*Capability Reports*).

## Suggestions (non-blocking)

- The `setTimeout`-ban and fixed-id-collision-pool disciplines from Valet's harness
  are cheap and high-value; the revision names them.
- Consider stating that the host-ops/structured-tree inspection surface (which the
  diaries call "a better test surface than a DOM") is a first-class agent affordance,
  alongside the diagnostic object.

## Open questions (for the author)

- The actual CLI/tool-surface names and whether they are CLI-/HTTP-/MCP-first (the
  doc's own open question; Valet's answer was "one internal API behind several
  surfaces").
- Which diagnostic codes are stable enough for v1.

## Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Status stays `Draft`.** Revise alongside the first local server; treat as
   required, not polish — the revision strengthens that framing with evidence.
2. **Charlie reviews C1/C2** — no-silent-drops and the conformance-corpus sequencing
   are the two with the most leverage on whether agents can self-correct.
3. **Build the harness with handler replay and the replay/wire conformance runners
   first**, against Valet's measured baselines (now in LLP 0008).
