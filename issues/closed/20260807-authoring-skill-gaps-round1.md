# Authoring skill: four content gaps from the first skill-equipped measurement

**Status:** Resolved (2026-08-07)
**Impact:** 2
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Agent skills, Guide
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Lane 2 (skill-equipped) enumerated exactly where the skill was wrong or
silent: (1) it names only the `react` template — `expo-chat` (far better
for messaging briefs) is discoverable only via CLI help; (2) silent that
app-side uploads require sessions mode while scaffolds ship dev mode —
the largest single time block; (3) silent that the supervised web carrier
is unpaved (see 20260807-supervised-expo-web-carrier-unpaved); (4) trap
list misses the surface-command optional-input refusal. Update
skills/snapback-authoring/SKILL.md (and the packaged copy sync + rosetta
checker will carry it); keep each addition one line — the skill is a
router, not a manual.

## Resolution (2026-08-07)

All four gaps absorbed into `skills/snapback-authoring/SKILL.md` (packaged
copy `packages/snapback-cli/skills/snapback-authoring/SKILL.md` synced in
the same commit; byte-match test and `scripts/check-rosetta.mjs` green):

1. Golden-path step 1 now names `--template expo-chat` for
   messaging-shaped briefs alongside `react`.
2. Golden-path step 6 states that app-side uploads require sessions mode
   while scaffolds default to dev mode — flip
   `{ auth: { mode: 'sessions' } }` before building upload UI.
3. Trap 8 states the supervised web carrier's current state honestly:
   native-first today; the web carrier's three walls (bootstrap CORS,
   AppState deep-import, `blob:` picker URIs) point at
   `issues/20260807-supervised-expo-web-carrier-unpaved.md`. Checked
   before wording: no paving commits on origin/main as of 6a1de382f, and
   that ticket is still Open.
4. Trap 9 adds the surface-command optional-input refusal with the
   split-command workaround; the fix ticket
   (`issues/20260807-surface-command-optional-input-undefined.md`) is
   still Open as of 6a1de382f, so the trap is worded present-tense.

Follow-on ownership, not residue: when the web-carrier paving or the
optional-input fix lands, the landing change should re-word trap 8/9
(their tickets already carry the skill pointer via this note).
