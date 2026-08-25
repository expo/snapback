# cli package suite inherited reds: `package.test.mjs:560` framework-drift, `application-auth-fixtures` module resolution, `familiar-dev-loop` codegen `kind` TypeError

- Status: Closed
- Date: 2026-08-23
- Systems: `packages/snapback-cli` (`runtime-readiness.mjs`, `package.test.mjs`)
- Governing: LLP 0189 (fix-forward), LLP 0232 (inherited reds are not a
  landing veto), LLP 0010 (runtime readiness receipt)
- Found by: the LLP 0299 landing's cli-package suite run

## Symptom

`node package.test.mjs` fails on macOS (Node 24.18.0) at the packaged
runtime readiness re-verification:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'coherent'
- 'framework-drift'
    at package.test.mjs:560:10
```

The test writes a fake packaged Hermes artifact, mints a readiness receipt,
rewrites the artifact bytes, and expects `packagedRuntimeReadiness({ verify:
true })` to report `framework-drift`; it reports `coherent`.

## Classification

Reproduced at the exact base SHA `59ae1a00e` in a clean detached worktree
after `bun install --frozen-lockfile` (2026-08-23), so it is an inherited
main red, not introduced by LLP 0299. Because `npm test` chains the cli
package suite with `&&`, this first command masks every later suite; the LLP
0298 landing ran the remaining commands individually to verify them.

## Second inherited red: `application-auth-fixtures.test.mjs`

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@expo/snapback-client'
imported from <tmp>/application-auth/browser-explicit/application/App.mjs
```

The test symlinks the repo's `node_modules` into its temp root and the
scaffolded app imports `@expo/snapback-client`; resolution fails from the
temp realpath. Also reproduced at base `59ae1a00e` in the same clean
worktree (bun-installed, workspace symlinks present), so it is inherited.

## Third inherited red: `familiar-dev-loop.test.mjs`

```text
CODEGEN_MODULE_EVALUATION_FAILED: Cannot read properties of undefined (reading 'kind')
  at Object.isStringLiteral (typescript.js)
  at resolveExport (packages/snapback-codegen/index.mjs:19600)
  at resolveLocal → builderTarget → ownCallee → collect
```

Reproduced identically at base `59ae1a00e`. `resolveExport` is in the
allowance/builder-site graph code that the LLP 0209 G0 B2 rounds landed on
2026-08-23 (`4627f9d95` "allowances mint only at top-level or exported-const
builder sites"); the Familiar template's exported-helper shape appears to
reach `isStringLiteral` with an undefined node. Owner: the G0 program.

## Fourth inherited red, fixed forward in the LLP 0299 landing: `expo-device-forwarding.test.mjs:17`

The assertion expected `SNAPBACK_DEV_AUTH_ORIGINS` to list `localhost` before
`[::1]`, while `expoBackendClientOrigins` on main orders `127.0.0.1, [::1],
localhost` — the order the receipt tests (`packed-dev-lifecycle`,
`expo-dev-loop`) require because `runDev` sorts admitted origins. Red at base
`59ae1a00e`; the LLP 0299 landing corrects the test expectation (function
untouched). Recorded here so the ticket's inventory stays complete.

## Next step

Determine whether the packaged-artifact digest is no longer part of the
receipt's verified set on darwin (a `runtime-readiness.mjs` regression) or
whether the fixture path the test writes no longer matches the artifact the
verifier digests (a test regression), then fix forward. Until then, run the
cli suite commands after `package.test.mjs` individually.

## Resolution (2026-08-25)

Red 1 was a verifier regression, not a Darwin fixture-path regression. The
fixture and `packagedRuntimeArtifactCandidates` both name the npm-surviving
`Frameworks/hermesvm.framework/Versions/1/hermesvm` file. The inherited
selector had allowed an explicitly overridden packaged runtime to use the
source-checkout candidate set, recording no packaged Hermes artifact and
therefore reporting a false coherent verdict after drift. The lane base
already contains the packaged-layout fallback that corrects that selector;
this change adds the remaining symlink case, resolving a configured runtime to
its physical source checkout before reopening its receipt and Hermes inputs.
The framework-drift assertion now passes and `package.test.mjs` advances to an
unrelated generated todo-template assertion.

Red 2 was fixture install topology. The temporary application realpath exposed
the repository's root `node_modules`, but Bun keeps the needed workspace links
under package-local installs and the root had no `@expo/snapback-client`.
The fixture now constructs its own minimal consumer `node_modules` with the
three imported Snapback workspace packages and React, so all four generated
applications resolve from their actual temporary realpaths.

Verification: `application-auth-fixtures.test.mjs` passes its one four-app
journey test. The package suite passes the readiness drift checks and stops at
the out-of-scope todo-template assertion expecting `client.query(...)` after
the template moved the sessions data leg to `sessionClient.query(...)`.

Red 3 remains owned by the separate codegen lane and is not part of this
resolution. Red 4 was already fixed as recorded above.
