# Snapback 4: generated proof scaffolds miss the frozen-first-read replay bar

Status: Open
Owner: integration / TOK4 first-read and SCAF1 proof-scaffold owners
Found: 2026-10-28, matched wave-34 whole-session replays

SCAF1 at product commit 1ccf620a0a generates scripts/proof-scaffold after green check. Four final after sessions completed with the original 0.4.46 first-read content and exact harness builder flags/brief. Post-schema lookup calls are 4/8 (Codex 001/039), 6/5 (Muse 019/018); every lane misses <=3. Codex model calls are 31/40, missing <=28. Codex read the packet zero times; Muse read it 1/3 times; none edited its generated files or selected its business-proof entrypoints. Full input decreases overall but wall increases.

Integrate TOK4 discovery by the agreed scaffold directory name, then remeasure the combined surface with unchanged proof requirements. Do not claim the isolated SCAF1 benchmark passed or that its generated lane tests replaced the builders' suites. The generated probe is a backend-only private-roster skeleton; app frontend/readiness integration remains explicit and showed up as CPAP friction. Coordinate that handoff with VER1 while keeping its starter files separate.

Evidence: snapback4/reports/20261028-scaf1/model-replays.json, adoption.json, proof-strength.json and README.md. All eight ordinary acceptance suites pass and reject wrong actor, wrong code and removed deadline/approval guard controls (24 assertion failures). The installed generated packet separately passes its real-account/upload/clock/approval/browser negatives. These scoped controls are not exhaustive security equivalence or proof of scaffold adoption.
