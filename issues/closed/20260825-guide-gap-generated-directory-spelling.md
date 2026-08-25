# Guide and start packets still say `_generated/` after 0.1.27 refuses that directory

**Filed:** 2026-08-25 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Guide, Code generation

## Problem

0.1.27 emits `snapback/generated/` and refuses `_generated/`. The familiar
Clique start packet / older briefs still say `_generated/`. Codegen's
directory mismatch was closed
(`issues/closed/20260815-familiar-codegen-generated-directory-mismatch.md`).
The **docs spelling** is still wrong and charged orientation in this run.

## Direction

Replace `_generated/` with `generated/` on the familiar profile page, the
expo-chat start packet, and any Clique-facing brief that still uses the
old path. Keep a one-line note that `_generated/` is a refused alias.

## Resolution (2026-08-25)

Resolved the guide work. `guide/backend/familiar-profile.md`, the live
`guide/start/expo-chat.md` packet and its generated
`packages/snapback-cli/templates/expo-chat/AGENTS.md` projection, and the live
`benchmarks/runs/2026-08-17-model-profile-app-matrix/template-clique-familiar.md`
brief use `generated/` and state that `_generated/` is a refused alias.
Retrieval case 98 uses the teaching pages' "refused alias" vocabulary, and the
per-page guidance check verifies that both named guide pages retain the
correction. Frozen run prompts remain unchanged. This resolution changes
documentation only; it does not make a new codegen claim.
