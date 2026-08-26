# `expo-dev-loop.test.mjs` dies on `@expo/snapback-client` resolution from a temp scaffold

- Status: Closed 2026-08-26
- Date: 2026-08-25
- Systems: `packages/snapback-cli` (`expo-dev-loop.test.mjs`)
- Governing: LLP 0189 (fix-forward), LLP 0232 (inherited reds are not a
  landing veto)
- Related: `issues/closed/20260823-package-test-framework-drift-red.md` fixed
  the same shape in `application-auth-fixtures`, `media`, and `expo-chat`
  blocks; this file was not part of that sweep.

## Symptom

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@expo/snapback-client'
imported from <tmp>/settled/snapback/generated/app.binding.<digest>.mjs
```

The process dies before any test reports, so there is no TAP output at all —
`node --test expo-dev-loop.test.mjs` reports `tests 1 / fail 1` for the file
itself, and `node expo-dev-loop.test.mjs` exits non-zero having printed only
the stack.

## Classification

Inherited. Reproduced at `fdc635267` in a clean detached worktree with the
repo's `node_modules` symlinked in, identically to the working tree, and again
after rebasing onto `0be248038` (which carries the 2026-08-25 fix for the
sibling suites). The fixture project is copied into a temp directory with no
`node_modules`, and the generated app binding now imports its declared
`@expo/snapback-client` dependency, which cannot resolve from a temp realpath.

## Consequence

The supervisor-descriptor assertion added by the shared-development auth
landing — that `.snapback/expo-supervisor.json` records the `sharedAuth`
projection, and that a fixture declaring no provider records `no-broker` rather
than staying silent — is landed but unexecuted until this is fixed. The
recorded projection itself was verified live against a real supervisor on
`demos/knockoff`; see
`issues/closed/20260825-auth-status-cannot-observe-shared-broker.md`.

## Next step

Apply the same remedy the closed ticket used for its sibling suites: have the
assertions inspect the structured generated descriptors instead of importing a
generated module from a no-install scaffold, or give the temp scaffold a
resolvable dependency root.

## Resolution — 2026-08-26

`fixture()` no longer symlinks the repo's `node_modules` into the scratch
project. It builds a real dependency root
(`materializeFixtureDependencyRoot`): every installed top-level entry is
symlinked through, and `@expo/` is a real directory overlaying **every**
`@expo/*` workspace package read out of `packages/*/package.json`. That is the
"give the temp scaffold a resolvable dependency root" branch of the direction
above; the assertions keep importing the generated modules, which is what makes
them worth running.

The root cause was that bun links the workspace packages under
`packages/*/node_modules`, not at the repo root — `ls node_modules/@expo` holds
`snapback-acceptance` alone — so a symlink to the root could never resolve
`@expo/snapback-client` from a temp realpath.

Verified directly: a scratch project built by the same helper imports
`@expo/snapback-client` and `@expo/snapback-react` from
`<project>/snapback/generated/*.mjs` successfully (19 scoped entries, 14
top-level entries).

Note that the file still cannot report green on a loaded machine for an
unrelated reason — see
`issues/20260826-expo-dev-loop-carrier-startup-timeout-load-sensitive.md`, which
fails earlier in the file than this scaffold ever ran.
