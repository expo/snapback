# expo-chat template ships .gitignore instead of gitignore.template, so npm pack strips it

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Templates, CLI, Packaging
**Date:** 2026-08-08
**Related:** issues/20260807-expo-chat-template-cold-install-coverage.md, issues/20260808-expo-chat-template-web-deps.md

`npm pack --dry-run` in packages/snapback-cli lists every expo-chat template
file **except** `.gitignore` — npm-packlist always excludes `.gitignore`,
even under a `files` allowlist. The react and todo-contract templates use the
`gitignore.template` convention that `scaffoldApp` renames on scaffold
(packages/snapback-cli/index.mjs:1494-1498); expo-chat ships a literal
`.gitignore` instead.

Consequence: every real out-of-repo `snapback new --template expo-chat`
since the 0.1.12 publication yields a project with **no `.gitignore` at
all** — `node_modules/`, `.expo/`, `.snapback/`, `dist/`, and
`snapback/generated/*` are all committable, directly contradicting the
guide's generated-artifact custody policy (commit only `artifacts.json`).

In-repo tests cannot catch it: `package.test.mjs` compares two scaffolds
from the same unpacked source, and the cold-install leg checks
generate/typecheck/acceptance, not file presence.

Ask:
1. Rename `templates/expo-chat/.gitignore` → `gitignore.template` to match
   its siblings.
2. Add a `.gitignore`-presence assertion to the packed cold-install leg so
   the class cannot recur.

Found by the 2026-08-08 comprehensive docs/templates review.
