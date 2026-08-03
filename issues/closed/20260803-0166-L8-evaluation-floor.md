# 0166 L8 — the evaluation refusal floor (gated profile NOT built here)

**Status:** Open (program: `20260803-0166-impl-program.md`; requires L2)
**Spec:** LLP 0166 §D7 (Current law; the ship gate)

Scope — deliberately minimal:

- Register `SNAPBACK_LOCAL_EVALUATION_UNADMITTED` in the LLP 0048
  corpus (with this implementing slice, per the placeholder rule) and
  refuse any `TransformPlanV1` / local-evaluation attempt with it;
  retained fragments decode and serve as opaque snapshots only
  (LLP 0080's rule for every plan without the new class — which is, in
  v1, every plan: reclassification is per-plan and owner-issued, and no
  owner has reclassified anything).
- S6's pre-gate legs only.

Explicitly OUT of this ticket (and this program): implementing
`TransformPlanV1`, the fixed pipeline, the dual-runtime reference and
conformance corpus, and any plan reclassification. That half opens only
when 0166 OQ7 / LLP 0157 OQ9 (corpus ownership — LLP 0051's owners
decide) is adjudicated and an owner reclassifies a first plan; it is a
follow-on ticket at that point, gated by §D7's full ship gate
(amendments are landed; corpus + oracles + per-plan opt-in are not).

Done means: S6's pre-gate legs pass (refusal with the registered code;
opaque-snapshot semantics hold); the code is registered, not
placeholder; nothing evaluates.

---

**Progress (2026-08-03):** implemented (Codex, session-supervised) and
landed. `SNAPBACK_LOCAL_EVALUATION_UNADMITTED` registered as a real
code; `evaluateLocal` refuses every request without inspecting it;
`readOpaqueSnapshot` serves owner-produced bytes only; no TransformPlanV1
surface exists. S6 pre-gate legs green. Ticket stays Open until the
program umbrella closes it.
