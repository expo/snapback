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
## Note (2026-08-25)

The third inherited red, `familiar-dev-loop` failing in codegen while reading
TypeScript node `kind`, was already fixed on this lane's base by the
`ExportDeclaration.moduleSpecifier` guard in `9653d21d2`. This lane adds an
owned-graph specifier-less re-export regression on the function builder graph
(`defineGraphQuery` through a specifier-less barrel, resolved via
`generateInProcess`) and confirms `familiar-dev-loop.test.mjs` passes with the
lane's qualified shared runtime. (The framework-drift and application-auth-fixtures reds
were resolved separately; see the Resolution above.)

## Follow-up (2026-08-25 — `package-test-todo` lane)

The next package-suite abort was receiver-spelling drift. The todo acceptance
had moved its sessions data legs from `client.*` to `sessionClient.*`, while
`package.test.mjs` still required `client.query(api.listTodos` and
`client.mutate(api.createTodo`. The assertions now require the exact
session-bound receiver and still name both generated operations, so the guard
continues to prove the query and mutation the starter claims.

The packed `prove` red was a second, independent acceptance-document drift.
The todo starter was the lone first-party template still hand-authoring the
legacy five-check `snapback.starter-acceptance.v1` receipt with
`queryFunctionId`/`mutationFunctionId` keys. The verifier correctly requires
the registered path ids `list-todos` and `create-todo`, so it reported both
`SNAPBACK_VERIFY_COVERAGE_PATH_INCOMPLETE` diagnostics and
`SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED`. Todo now uses the public
`@expo/snapback-acceptance` declaration/runner like the other starters, derives
its verify profile from that same declaration, and keeps the session-bound
query, mutation, and observation assertions in application source. The shared
runner's `bindingFor(app)` projection mints a supervised-dev loopback binding
from `ready.serverUrl` without weakening session custody. A new checkout-local
fresh scaffold passed `npm run prove` against the lane's prebuilt runtime: all
five verifier stages and `todo-contract-live` passed.

Template portfolio qualification now runs each packed scaffold's `prove` after
generate and static acceptance. Its independent unit guard also carries the
four Vite typecheck inputs (`@types/node`, `types`, `lib`, and the Vite client
reference) for both Vite templates plus the CRUD
`adminClient.liveQuery(api.projectDetail` spelling requested by the templates
review.

Continuing the sequential package suite exposed two more test-fixture drifts:
the media and Expo-chat blocks dynamically imported generated API modules from
no-install temporary scaffolds after those modules began importing their
declared `@expo/snapback-client` dependency. Those assertions now inspect the
same structured generated descriptors rather than requiring an undeclared
fixture install, preserving the command/surface guards.

The suite then reached a genuine product defect and the lane stopped as
required. `buildRelease` rejects freshly generated application manifests at
`snapback.v1` against the canonical target-level capability manifest at
`snapback.v0`, reproducing independently as
`SNAPBACK_DEPLOY_GENERATED_IDENTITY_MISMATCH`. The open follow-up is
`issues/20260825-build-release-capability-schema-identity-mismatch.md`; release
code was not changed in this lane.

Final scoped evidence: the independent template-qualification test passed 4/4;
todo static coherence passed; the package-test inventory passed with 354
declared test files; and `ref-check --verbose` reported 311 LLP docs, 6,567
refs, 12,179 files, and zero errors/unchecked refs. The final long package run
reported 0 pass / 1 fail at the open release-build defect above. A defensive
whole-inventory run also reported the unrelated inherited `guide-manifest` red
for missing generated demo/Contract snippet sources; this lane did not touch
those guide or demo surfaces.
