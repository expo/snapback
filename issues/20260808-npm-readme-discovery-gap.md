# npm packages ship no README — nothing on npmjs points at the golden path

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

`npm view @expo/snapback-* readme` returns nothing; a newcomer landing on npmjs sees no pointer to `snapback new`, the shipped templates, or the in-tarball authoring skill. Two bare lanes independently resorted to `npm pack` + tarball spelunking to find the gold mine (`skills/snapback-authoring/SKILL.md`, `templates/expo-chat`).

**Ask:** publish a short README per public package (golden path: `npm create snapback-app` / `snapback new`, skill location, served-guide pointer). Cheap, and it is the pre-install orientation surface LLP 0195 cares about; relates to LLP 0198 P2.
