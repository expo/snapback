# snapback-authoring skill not distributed to scaffolded apps

**Status:** Closed — resolved in the same landing (2026-08-07)
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** CLI packaging, Scaffolds, Agent context injection
**Date:** 2026-08-07
**Related:** LLP 0186 (W2 context-injection surface), LLP 0187 (T4 funnel)

## Problem

The LLP 0186 W2 published authoring skill
(`skills/snapback-authoring/SKILL.md`, landed 2026-08-07) existed only in
this repository. External consumers scaffolding via `snapback new` or
`create-snapback-app` never received it: nothing in the
`@expo/snapback-cli` template mechanism carried the skill, so coding
agents working in a scaffolded app had no `.claude/skills/` /
`.agents/skills/` discovery path for it — the W2 context-injection
surface stopped at the repo boundary. The skill's relative links
(`../../guide/...`) would also have been dead outside a checkout.

## Resolution

- A byte-identical packaged copy ships at
  `packages/snapback-cli/skills/snapback-authoring/SKILL.md` (`skills`
  added to the package `files`, so the skill is inside the published
  tarball and offline scaffolds work). An anti-drift assert in
  `packages/snapback-cli/package.test.mjs` fails if the packaged copy
  stops byte-matching the canonical file.
- `scaffoldApp()` now emits the skill into every scaffolded app at the
  four agent discovery paths (`.claude/skills/`, `.agents/skills/`,
  `.cursor/skills/`, `.opencode/skills/`, all
  `.../snapback-authoring/SKILL.md`), applying a deterministic emit-time
  transform (`renderScaffoldAuthoringSkill`): `../../guide/...` link
  targets are rewritten to the served-guide surface
  (`/_snapback/guide/...`) and a note after the H1 explains that the
  Guide is served, not checked out (`snapback guide <query>` /
  `/_snapback/guide/<path>`). The canonical repo copy is unchanged.
- The scaffold result gains an additive `skillFiles` field; each
  template's `AGENTS.md` gets a one-line pointer to the shipped skill.
- Tests cover the byte-match, the transform (no `../../guide/` residue),
  the four emitted files per scaffold, and the AGENTS.md mention.

## LLP 0186 W2 note (recorded here)

LLP 0186 was modified by another concurrent session at resolution time,
so per landing discipline the dated W2 amendment note lives in this
ticket instead: *2026-08-07 — W2 skill distribution: `snapback new` /
`create-snapback-app` scaffolds now emit the published authoring skill
(drift-checked packaged copy, served-guide link rewrite) at the
`.claude`/`.agents`/`.cursor`/`.opencode` skill discovery paths.* Fold
this into LLP 0186's W2 implementation record at the next quiet edit.
