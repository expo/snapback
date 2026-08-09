# npm packages ship no README — nothing on npmjs points at the golden path

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

`npm view @expo/snapback-* readme` returns nothing; a newcomer landing on npmjs sees no pointer to `snapback new`, the shipped templates, or the in-tarball authoring skill. Two bare lanes independently resorted to `npm pack` + tarball spelunking to find the gold mine (`skills/snapback-authoring/SKILL.md`, `templates/expo-chat`).

**Ask:** publish a short README per public package (golden path: `npm create snapback-app` / `snapback new`, skill location, served-guide pointer). Cheap, and it is the pre-install orientation surface LLP 0195 cares about; relates to LLP 0198 P2.

## Resolution (2026-08-09)

Root cause: `scripts/snapback-publish.mjs` stages a sparse package by copying
only the source manifest's explicit `files` allowlist, so any `README.md`
omitted from that list disappears before `npm pack` can apply npm's normal
implicit README inclusion.

Added `README.md` to the six incomplete allowlists in the current publisher
inventory (`@expo/snapback-contract`, `@expo/snapback-codegen`,
`@expo/snapback-app-cli`, `@expo/snapback-cli`, `@expo/snapback-vite`, and
`create-snapback-app`) and made `scripts/package-readme-funnel.test.mjs`
enforce that every inventory member keeps the README in the staging
allowlist. The ticket's nine named packages already had source READMEs at
resolution time, as did the two newer publisher-inventory members
`@expo/snapback-expo` and `create-snapback-app`, so no new README prose was
needed.

Tarball proof used the permitted one-package staged-directory path: copy only
`packages/snapback-cli/package.json#files` plus `package.json` into a temporary
directory, run `npm pack <stage> --ignore-scripts` with an isolated npm cache,
then inspect the archive. The pack reported
`expo-snapback-cli-0.1.0.tgz` with 216 entries, and
`tar -tzf <tarball> | rg '^package/README\.md$'` returned
`package/README.md`.

Affected checks:

- `node --test scripts/package-readme-funnel.test.mjs` — pass.
- `node packages/snapback-runtime-darwin-arm64/package.test.mjs` — pass.
- `node packages/snapback-runtime-linux-x64/package.test.mjs` — pass.
- `./ref-check --verbose` — pass (213 LLP docs, 4,502 refs, 0 errors).
