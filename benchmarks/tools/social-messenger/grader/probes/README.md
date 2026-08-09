# Holdout-probe machinery

**Provenance:** LLP 0201 D3.5 (holdout probes, custody, rotation) and
the brief's "Holdout probes" section. **Status:** 0.1.0-p1 DRAFT.

## What lives here — and what deliberately does not

- `categories.md` — the **published probe-category registry**. The
  categories and the obligations they test are public with the
  instrument; builders may read them freely.
- `commit-probes.mjs` — the sha256 commitment/verification tool.
- `rotation-log.md` — the custody and rotation log.

**No actual probe set is committed here.** Wave probe sets are
authored at wave time, held out from builders, and published only
after their wave completes. That is the design, not an omission: every
published claim is retroactively fully inspectable (LLP 0197's
publish-the-instrument rule holds), but no builder sees its own
wave's **scored** probes. What is public in advance is this category
registry, the trust obligations, and the scale envelope they test
against — all in the brief.

## Custody mechanism

1. Before a wave's **first lane starts**, the wave's probe-set file is
   hashed: `node commit-probes.mjs commit <probe-set-file> <wave-id>`.
   The sha256 is recorded in `rotation-log.md` (and in the wave
   record), so the set provably was not selected after seeing results.
2. After the wave's last lane is graded, the probe-set file is
   published; anyone can check
   `node commit-probes.mjs verify <published-file> <committed-hash>`.
   The rotation-log row is updated with the published path.
3. The next wave's set is **rotated**: new probe instances, every
   published category covered by at least one scored instance
   (LLP 0201 D3.5: "Each rotation covers every published probe
   category with at least one instance"). The rotation log records the
   category mapping per wave.
4. The hidden seed for the replay's deterministic actual-state sample
   is committed with the wave's probe set (brief, replay contract).

## Anchors are non-scored

Each category keeps **one unchanged anchor probe across waves** — a
published, quasi-public **continuity diagnostic** that prices
difficulty drift between waves. Anchors **never bear on O3/O5**; those
dimensions read only the wave's secret rotated probes (author ruling,
2026-08-08). Anchor results publish with every wave as diagnostics.

## Never-built rule

Probes whose target behavior a failed milestone never built score
under a preregistered rule **frozen with each wave's probe set**: each
probe declares, at authoring time, whether a never-built target scores
`not-passed-never-built` (counts against O3/O5 as not passed) or
`excluded-with-note` (excluded from the score with a published note).
The grader-report schema pins these outcome values.
