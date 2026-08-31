# Quarry × Clique M1–M3 paper exercise

App-scale sequel to `spikes/quarry-authoring/` (LLP 0329.014.009): two blind
lanes (codex gpt-5.6-sol, grok-4.6, both xhigh) author the complete backend
data plane for the Clique reduced-run benchmark brief (M1 accounts/profiles,
M2 posts + follow graph, M3 messaging core) in **Quarry v0.2**
(`spec/quarry-spec-v0.2.md`), milestone by milestone against their own
evolving schema, cold, sandboxed from this repo. Oracle for coverage and
machinery diff: the real Coterie backend, `demos/coterie/snapback/`.

Results and analysis: **LLP 0329.014.010**.

Layout:

- `spec/quarry-spec-v0.2.md` — the one-pager + the .009 verdicts
  (auto-deref, bare-name fields, optionals, enum, asset, boundary kinds).
- `packet/` — preamble (output contract), app context, M1–M3 brief extracts.
- `run-lane.sh <codex|grok>` — sequential M1→M2→M3 lane driver (skips
  existing outputs; re-run to retry).
- `lanes/<model>/M{1,2,3}.md` — the designs, with the exact prompts beside
  them.
- `grading/grading-key.md` — oracle op inventory, real-backend machinery
  diff dimensions, per-milestone strain checklist (written after dispatch).
- `grading/lane-notes.md` — per-lane verdicts, coverage, size economics.
- `grading/cross-review/` — each family's adversarial review of the other's
  M3, prompts, and the orchestrator's adjudication.
