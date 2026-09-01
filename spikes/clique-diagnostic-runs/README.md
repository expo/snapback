# Clique diagnostic runs against Snapback 2 — TS vs Quarry

First executions of the Clique reduced run (M1–M3) against Snapback 2, as
**diagnostic** runs (protocol rule 6 unmet — the platform is unpublished, so
lanes consumed `npm pack` tarballs of the exact would-publish artifacts;
rule 3 — media/assets struck, so `brief-diagnostic.md` is a new,
non-comparable brief version). Analysis: **LLP 0329.014.011**.

Three cold lanes, same model family, same brief, blindness-fenced from this
repo:

- `ts-lane/` — backend authored on the TS surface. **Green 20/20**, ~65 min.
- `quarry-lane/` — backend authored 100% in Quarry (`backend/*.q`, 67
  certified ops) through `snapback2-quarry`'s `quarryc` (Quarry → TS
  emission, generated code never hand-edited). **Green 19/19** + a
  self-added 8/8 headless-Chrome UI smoke, ~61 min.
- `quarry-paper/` — control: same brief authored in Quarry with no
  toolchain at all (LLP 0329.014.010 protocol).

Each lane dir: RUN-DIARY.md (the qualitative instrument), run-summary.json,
acceptance-output.txt, and the authored backend. Executed-backend size:
TS 1,211 lines / 42.0 KB vs Quarry 434 lines / 13.9 KB (3.0×).

Platform/tooling findings filed from these runs:
`issues/20260831-insert-return-reevaluates-row-expression.md` (P1,
orchestrator-verified), `…-descending-cursor-after-semantics.md`,
`…-quarryc-branch-write-trace-undercount.md`,
`…-snapback2-test-wedge-rule-restricted-seeds.md`, plus the three TS-lane
tickets landed earlier the same day (output-ceiling accounting, mutation
reads under viewer rules, certify-green-runtime-red gaps).

Rig: `run-lane` machinery and packaging recipes live in the session
program's memory; artifacts were produced under scratchpad workspaces and
only run records land here.
