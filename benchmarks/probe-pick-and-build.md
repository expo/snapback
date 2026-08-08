<!-- @ref LLP 0198#ii1-what-surpass-means--a-claim-ladder — L5's
     instrument: revealed preference under commitment, per-cell
     verdicts, never pooled across model families. -->

# Probe: pick-and-build (revealed preference, L5's instrument)

**Status:** authored 2026-08-08 under LLP 0198 P3; no run yet. Cells
freeze at scheduling per LLP 0197 rule 1.

## What it measures

Whether an agent, given a brief and both platforms' surfaces, *chooses*
the backend — and stands by the choice after building with it. A
stated-preference poll measures brand prior and prompt framing; this
probe makes the choice costly (the agent must build what it picks) and
captures preference **after experience**, which is the form a skeptic
cannot dismiss as framing (LLP 0198 L5; GPT-family round-1 review's
brand-prior point).

## Protocol

1. **Choice under commitment.** A fresh-context agent receives the
   brief plus both platforms' surface artifacts (docs entry, template
   inventory, skill content) in the cell's redaction condition, and
   must pick one platform and justify the pick *before* building.
2. **Build.** The agent builds the brief with its pick under normal
   lane rules (`protocol.md`); the run is recorded like any lane run.
3. **Post-build preference.** After acceptance, the agent answers: keep
   the pick or switch, and why. The record captures the pick, the
   post-build answer (regret/switch/confirm), and whether the
   justification cites properties the measured record supports or
   contradicts.

## Cells and decision rule (preregistered)

- A **cell** is model family × brief family × redaction condition.
  N≥5 fresh contexts per cell. Verdicts are judged **per cell and
  never pooled** across cells (LLP 0198 L5; cross-family pooling is
  barred for the same reason as token pooling).
- **"Favors Snapback"** in a cell = strict majority of picks with no
  majority post-build regret.
- **"Neutral"** = neither platform meets the favors-condition.
- L5 reads: favors-Snapback on offline/realtime/media/trust brief
  cells, at worst neutral on plain-CRUD cells, in **every** family
  cell measured.

## Redaction conditions

- `redacted`: platform names/branding stripped from the surface
  artifacts; capability content intact. Both platforms are likely
  identifiable from their artifacts regardless — LLP 0198 OQ4's
  residual — so the publication label always carries the condition.
- `named`: surfaces as published. Run alongside `redacted` when the
  brand-prior delta is itself the question.

## Publication

Per LLP 0197: all cells reported (no cell dropped for result), the
publication-safe projection only, and the probe's cells live in the
rung matrix like every other claim input.
