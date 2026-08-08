# expo-chat template: missing expo-crypto and upload UI shipped in dev mode

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Templates, Expo client, Offline, Assets
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

Two gaps in the flagship messaging template, both hit by measurement lanes:

1. **`expo-crypto` is not in the template's dependencies**, though the guide
   requires it for `registerExpoFileSystemRqsFiles` — so the headline
   offline-retention capability silently stays in-memory for anyone who
   doesn't read the guide page (typecheck catches it only once the
   registration is added). Add the dependency and the registration call to
   the template itself.
2. **The template ships upload UI while defaulting to dev mode**, where
   app-side uploads cannot work (sessions custody required) — embedding the
   exact contradiction the authoring skill's step 6 warns about. Either the
   template defaults to sessions mode, or its upload UI is fenced behind a
   clearly-marked mode flip with the skill's warning inline.

Acceptance: a scaffolded expo-chat app reaches offline retained render and
an in-app upload with zero dependency or mode edits, or the template
comments state the required step at the exact point of use.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolved — 2026-08-08

Both gaps closed in the template itself:

1. **Durable retention wired.** `expo-crypto ~57.0.1` added to the template's
   dependencies and `registerExpoFileSystemRqsFiles(FileSystem, { crypto:
   Crypto })` registered at the App.tsx root behind a `Platform.OS !== 'web'`
   guard (web's ladder resolves the IndexedDB arm; expo-file-system throws on
   web at module scope — comment carries the hazard). The recurring typecheck
   harness (`tests/expo-chat-template-typecheck/`) gained the same dependency
   for parity and its lockfile was refreshed; `acceptance.static.mjs` now
   asserts the registration stays wired.
2. **Sessions default (preferred option).** The schema now declares
   `auth: { mode: 'sessions' }`. This resolves more than the upload
   contradiction: in dev mode the template's own `dev` script
   (`snapback dev snapback --expo`) landed in `authority-required`
   (`SNAPBACK_AUTH_POLICY_UNAVAILABLE`) because the supervised loop's
   auto-mint requires sessions mode — so the starter's supervised loop never
   reached `ready` as shipped. With the sessions default the supervisor
   auto-mints and the authenticated send/upload path works with zero edits.
   The live `acceptance.mjs` was moved off the dev-profile declared-`userId`
   path onto the paved sessions pattern (`session mint` +
   `createExternalSessionClient`); `acceptance.static.mjs` pins the mode.
   The authoring skill's step-6 claim ("scaffolds default to dev mode") was
   corrected in both skill copies; template AGENTS.md and
   `guide/clients/react-expo.md` note the new defaults.

Other templates: `react` and `todo-contract` share neither gap (no upload
UI; web resolves the browser IndexedDB arm without registration) — no
changes.

Evidence (2026-08-08, worktree at fa65ff8c3 + this change, runtime
`target/debug/snapback`):
- `packages/snapback-cli/package.test.mjs` — pass (scaffold, codegen,
  skill-copy identity, static acceptance).
- `scripts/check-expo-chat-template-typecheck.mjs` — pass (parity, codegen,
  strict tsc).
- Hand-wired scaffold live `acceptance.mjs` — `status: "passed"`, 4/4 checks,
  clean cleanup, sessions bundle hashes.
- Supervised probe on the same scaffold (`runExpoDev` + headless Metro):
  state `ready`, exchange `authority.status: "ready"` with an `sbs_` bearer.
- `node scripts/check-guide.mjs` — ok (also repaired the page's dangling
  reference to the since-closed
  `issues/closed/20260807-supervised-expo-web-carrier-unpaved.md`).
