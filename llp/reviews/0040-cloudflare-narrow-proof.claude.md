# Review: LLP 0040 — Cloudflare narrow proof

**Reviewed:** `llp/0040-cloudflare-narrow-proof.rfc.md` (working-tree revision, 2026-07-07 draft)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Fable 5
**Date:** 2026-07-07
**Redacted:** No — reviewed locally against in-repo documents and code; nothing
sent to any external provider beyond the model serving this Claude Code session.
**Method:** Single-session independent read of the draft, verified against
LLP 0014 (parent strategy), LLP 0007 §Commit-version graduation, LLP 0032 X3,
`src/manifest.rs`, and the `schemas/` drift-gate pattern. Same-family sub-agent
passes were used for document/code verification; this whole artifact counts as
**one** family's review.

> **Independence (LLP 0005).** This session did not author the draft (authored
> by Charlie Cheever / Codex, a GPT-family agent), so this is a genuine
> cross-family review. One caveat: the parent critique this RFC executes
> (LLP 0038) is Claude-authored, so agreement-with-0038 checks are partially
> intra-family; all findings below were verified against LLP 0014/0007 and the
> code, not against 0038's framing alone.

## Overall assessment

Right slice, right size, faithful to the version contract. The proof-not-product
framing, the single-DO version authority, the no-cross-stream-comparison rule,
and the honest capability-gap posture all match what LLP 0007/0014 pin. Two
classes of problems: (1) an internal contradiction — the design pins D1 while
Open Question 1 re-opens it; and (2) the draft silently drops several
validation requirements LLP 0014 already pins (bundle-hash validation,
ambient-power denial under V8, reset/seed, the shared todo fixture, WebSocket
hibernation, and cost/usage counters). The last two are not nice-to-haves: the
entire point of the proof per LLP 0038 is the scale-to-zero *economics* claim,
and a DO with a connected WebSocket subscriber stays pinned (billable) unless
the proof uses the hibernation API — "idle with no connections" and "idle with
a connected subscriber" are different measurements and only the second one
tests the claim that matters.

## Strengths

- The version contract section restates DK-2/LLP 0007 correctly, including the
  subtle "must not compare versions across apps or Durable Objects" rule.
- Non-goals are honest and specifically counter the temptation to claim general
  Cloudflare support from one proof.
- The "if one object becomes the bottleneck, that is a measured result, not a
  design failure" stance is exactly the corpus's evidence-first posture.
- The capability-report section correctly treats missing features as product
  facts, matching the established manifest mechanism.

## Concerns

1. **[HIGH] Design pins D1; Open Question 1 re-opens it.** "D1 stores app
   tables and system tables" vs "Should D1 hold all durable rows … or should
   the Durable Object's storage be the first durable store?" LLP 0014 genuinely
   leaves Profile A vs B open, and this RFC is the natural place to answer it —
   but it must decide (with a named fallback), not both pin and re-open.
   *Resolves with:* an explicit "this selects Profile A" decision plus a
   revisit trigger, or removal of D1 from the pinned design.
2. **[HIGH] The one mutation can dodge the V8 seam.** "One host-plan or simple
   JS mutation" — a host-plan mutation executes no JS, so choosing that option
   leaves "V8 execution instead of Ibex/Hermes," the RFC's own first forced
   seam, unexercised. *Resolves with:* require at least one JS handler
   executing in V8.
3. **[HIGH] Idle economics under-specified.** Measurements list "idle behavior
   and whether steady compute drops to zero" but never mention WebSocket
   hibernation (named twice in LLP 0014) or billable-usage/cost counters
   (LLP 0014 validation: "cost and usage counters are visible enough to support
   the scale-to-zero claim"). *Resolves with:* measure idle-with-connected-
   subscriber (hibernation) and idle-with-no-connections separately, and record
   billable usage for the idle window.
4. **[MEDIUM] Pinned 0014 validation requirements silently dropped:** stable
   bundle/schema hash validation at load; ambient Worker powers denied to
   handlers (no free `fetch`/env/bindings); deterministic reset/seed or a
   declared gap; the same generated artifacts accepted on both targets or every
   divergence capability-explained; reconnect diagnostics that say whether the
   client resumed the same object, a replacement, or needs a fresh snapshot.
5. **[MEDIUM] Measurement comparability.** LLP 0035's numbers are in-process
   and compute-isolated; Cloudflare numbers are network-inclusive and
   region-dependent. Without a stated method (percentiles, cold vs warm,
   region, client location) the two sets will be read side-by-side wrongly.
6. **[LOW] Open Question 3 is partially already answered** — LLP 0014 already
   requires recoverable diagnostics for D1/DO contention and overload, so only
   the *additional* code set is open.
7. **[LOW] DK-5 trigger unnoted.** X3 starting is a named revisit trigger for
   the deferred V8 conformance twin (LLP 0009/0032); the proof that fires a
   trigger should say so.
8. **[LOW] No proposed `targetProfileId`.** The profile id string is
   load-bearing in code and `schemas/`; the RFC should propose it.

## Suggestions

- Name the profile id (`cloudflare-d1-do-v8` or similar) and require the new
  capability manifest to validate against a generated JSON Schema, matching the
  existing drift-gate pattern.
- Add a checked-in wrangler/deploy config to acceptance explicitly.
- State that the benchmark report should land as a Research LLP with
  machine-readable JSON output, like LLP 0035.

## Open questions (for the author)

- Is Miniflare acceptable for the acceptance suite with real-Cloudflare runs
  reserved for the measurement report, or must acceptance run against real
  infrastructure? (The draft's OQ2, sharpened.)

## Recommended next step

Revise and stay `Draft`. The slice is correct; the fixes are scope-tightening,
not redesign. Worth a second family pass after revision given this RFC gates
the thesis's economics claim.

## Revisions applied (2026-07-07, at the author's request)

The user asked the reviewing session to apply improvements directly. Applied to
the draft: Profile A decided explicitly with a revisit trigger (concern 1);
at-least-one-V8-JS-handler requirement (concern 2); hibernation + cost-counter
measurements (concern 3); the dropped 0014 validation requirements restored
(concern 4); measurement-method/comparability section (concern 5); OQ3 narrowed
(concern 6); DK-5 trigger noted (concern 7); `cloudflare-d1-do-v8` proposed
(concern 8); LLP 0047 added to Related. Status left untouched.
