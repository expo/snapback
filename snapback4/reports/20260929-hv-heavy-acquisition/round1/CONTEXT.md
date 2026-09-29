# HV round 1 context

Read-only `llp-orient` used the populated skill at
`/home/ccheever/lanes/enginefix/vendor/llp/skills/llp-orient/SKILL.md` because
this worktree's skill symlink target is absent.

Scope: MemoryStore representation and the wasm bridge, production artifact
size, acquisition attribution and a proposal under the existing governing LLP.
The Snapback 4 root and .007 are current; no new LLP is introduced.

- LLP 3000 §4 and rules/RULES.md: independent Snapback 4 checks; own workspace.
- LLP 3000.007 §20.4: strict host durability, format-3 upgrade, whole-publication
  undo, complete indexes before prediction replay in the current implementation.
- LLP 3000.007 §18.2: retained history and current coverage remain distinct.
- LLP 3000.015 §3: live authorization and expiry still govern acquisition.
- LLP 3000.002, proposed device representation and codec redesign: canonical
  serialization and monomorphic codecs; measured bytes rather than estimates.
- LLP 3000.022 §3: delivery candidates qualify against the published image.

The current sync guide and AQ/HV reports govern fixture and observation meaning.
The round-1 instruction supersedes round 0's proposed budget increase: 593,719 B
is fixed. No server shift, dropped index, smaller horizon, or relaxed durability
is authorized. Background word indexing is a proposal only, for later review.
Risks: directory boundaries after bulk load, undo after partial replacement,
and mixing pending-index readiness with row coverage. Update .007 and the report;
hand-off: none. Both review families' round-0 findings belong to the later round.

Merged origin/main at 30c3a13804 before product edits. LLP revision history and
append-only journal conflicts preserve both sides. Code merged automatically.
Regenerated delivery-await-boundary.json by invoking awaitBoundary(), retaining
EA's identity wait, KR's assertion correction and the Worker snapshot Mac fix.
