Verdict: READY

Candidate `7884642fbddeb56bd18a03215e23c6761c76cd87` against parent `1bb06d52112a770257d3a64a4e2a3eeb8754fb4f` implements the publication contract: a packed release shim declares only the platform artifacts selected for that publication, at the shim version. Production qualifies and stages the host platform and does not require Linux. The selection helper still represents multiple platforms when both are supplied. Existing app/lock and registry artifacts were treated as historical evidence, not repair targets.

The written review is in `review.md`.

## Actionable findings

None.

## Contract assessment

### Packed identities match selected dependency metadata

**Source deduction.** `selectedPlatformDependencies` (`snapback2/scripts/consumer-smoke.mjs:8-20`) rebuilds `optionalDependencies` by keeping non-`snapback2-*` entries, then inserting each selected artifact at `manifest.version`. It refuses an empty selection, a version other than the shim's, a duplicate name, and a name that is not `snapback2-<os>-<arch>`. `verifyPlatformDependencies` (`consumer-smoke.mjs:29-50`) unpacks every staged tarball's `package/package.json`, refuses a record that disagrees with the packed `name`/`version`, then requires the shim's `optionalDependencies` to equal that rebuilt map.

Parent `prepare()` packed the shim snapshot as copied from source (`baseline/snapback2/scripts/publish.mjs:577-578`). Source still lists both platforms (`snapback2/packages/snapback2/package.json:116-119`). Candidate `prepare()` rewrites the snapshot after the host platform is packed and before the shim is packed (`snapback2/scripts/publish.mjs:577-580`).

**Reproduced (reviewer counterexample, not a candidate failure).** Workspace-cwd `npm pack` of a host-only staged shim produced `optionalDependencies: { "snapback2-darwin-arm64": "0.0.15" }` with `snapback2-linux-x64` absent from both the tarball and the generated lock. `verifyPlatformDependencies` accepted those `npm pack` tarballs.

Fixture tests cover one-platform and two-platform maps, identity mismatch, and a resumed shim that still advertises Linux while only Darwin is in the artifact list (`snapback2/scripts/publish.test.mjs:35-79`).

### Production qualification and resumed artifacts

**Source deduction.** Default `qualifyArtifacts` runs media qualification then `verifyPlatformDependencies` (`publish.mjs:601-606`) before `stagePublication` returns. `main()` then runs `consumerSmoke` and only afterwards `convergeArtifacts` / `npm publish` (`publish.mjs:877-899`). Qualification therefore happens before publication.

`loadResume` (`publish.mjs:307-317`) returns an existing resume when tarball SRI matches. It does not rewrite tarballs. A parent-era immutable shim that still declares both platforms while the resume lists only the host artifact fails verify with "stage a new publication" (`consumer-smoke.mjs:46-48`) and is not mutated. `prepare()` is not reached while that resume still loads (`publish.mjs:608-610`); restaging requires discarding the resume/state directory. That matches "a mismatched immutable shim is refused and must be staged again."

The supplied `--self-test` output already includes the resumed-shim refusal test passing. This review did not rerun `--self-test`.

### Unrelated optional, normal, and peer metadata

**Source deduction.** Staging assigns only `optionalDependencies` and writes the parsed manifest (`consumer-smoke.mjs:22-27`). `dependencies`, `peerDependencies`, and `peerDependenciesMeta` are not edited. Tests assert they round-trip (`publish.test.mjs:44-47`).

**Reproduced.** Host-only `npm pack` kept `dependencies.typescript`, the full `peerDependencies` object, and `peerDependenciesMeta`. Current source has no non-platform optional dependencies; after host-only staging the map is only the host package.

### One vs several platform selections, without implying Linux runtime qualification

**Source deduction.** Production `prepare()` always passes a single host artifact `snapback2-${process.platform}-${process.arch}` (`publish.mjs:561-579, 873-874`). Development packing does the same (`consumer-smoke.mjs:153-169`). The two-platform test (`publish.test.mjs:35-51`) feeds synthetic `package.json` names to the helper; it does not build or publish a Linux binary. LLP 1002 §11 states that this is packaging evidence, separate from runtime/platform qualification. That matches the implementation.

### Development packing vs production packing

**Source deduction.** `packDevelopmentConsumer` calls the same `stagePlatformDependencies` before `npm pack --ignore-scripts` (`consumer-smoke.mjs:169-171`). `measure.mjs` is unchanged and still calls `packDevelopmentConsumer`. Production additionally verifies packed identities, including resumed tarballs. Development always restages from source and does not call `verifyPlatformDependencies`. Relevant staging behavior is shared; resume enforcement is production-only, which is the intended split.

### Fixture tests vs a realistic selected-artifact / exact-lock npm 11 consumer

Historical npm 11 `npm ci` on the original app and the publication consumer failed with `Missing: snapback2-linux-x64@ from lock file` (empty version). The published `snapback2@0.0.15` packument lists both optionals; `snapback2-linux-x64` is 404; the preserved locks copy Linux into `node_modules/snapback2.optionalDependencies` and omit a `node_modules/snapback2-linux-x64` inventory entry. npm 10 `npm ci` on the same app lock succeeded. npm 11.16.0 `validate-lockfile` errors when the ideal tree contains a node the lock lacks; arborist marks failed optionals inert and omits version-less inert nodes from the lock. Those inputs were not repaired.

Candidate fixture coverage:

- Staging unit tests use in-memory `package.json` rewrite, not `npm pack`.
- The install test (`publish.test.mjs:81-131`) uses `tar -czf` tarballs, sibling `npm install` of shim+host+react+typescript, then `npm ci` with default peer/optional semantics and unchanged bytes. Supplied `--self-test` recorded that test passing on Node v24.18.0 / npm 11.16.0 in 2.3s.
- The install test does not assert lock contents directly; it asserts `npm ci` success and installed versions.
- Production `consumerSmoke` still installs all artifact tarballs with `--legacy-peer-deps` and is not an exact-lock `npm ci`. The new test is the exact-lock evidence.

**Reproduced by this review.** Production-shaped `npm pack` from a workspace-root cwd of a host-only staged shim, sibling install of the packed tarballs, and npm 11 `npm ci` succeeded with a linux-free lock. Packed identities matched the selected host.

A first counterexample that *also* preserved a fake `unrelated@1.2.3` optional (as the staging unit test does) packed Darwin-only platforms correctly, then failed `npm ci` with `Missing: unrelated@ from lock file`. That is the same npm 11 mechanism as the historical Linux hole. It is not a production-source defect: current `optionalDependencies` contain only the two platform packages, and host-only staging leaves only the selected host, which is packed. It does show that the staging unit test's `unrelated` package is metadata-only and would not survive exact-lock `npm ci` unless that optional actually resolved.

**Unverified (limits, not failures).** No registry-only nested install (consumer depends solely on `snapback2` and fetches the host optional from a registry) was run; network/registry is out of scope. Source deduction: a new publication that omits Linux from the shim map will not put Linux in the ideal tree, so the historical `Missing: snapback2-linux-x64@` path should not recur for a *new* packument. Old `0.0.15` registry metadata still declares Linux. No `prepare()` / cargo / native production staging was executed.

## Commands run

Reviewer executions, after reading candidate/parent source. `--self-test` was not rerun; the supplied product log was used.

1. `python3 run-local.py counterexample scratch/npm-pack-staged-shim.mjs --purpose "Check whether npm pack from a workspace-root cwd preserves Darwin-only staged optionalDependencies and yields a linux-free npm 11 lock that npm ci accepts"`

   - pid 75095, exit 1, 5.97s, not timed out
   - Packed shim `optionalDependencies` were `{ unrelated: 1.2.3, snapback2-darwin-arm64: 0.0.15 }`; lock had no `snapback2-linux-x64` entry
   - `npm ci` failed: `Missing: unrelated@ from lock file`

2. `python3 run-local.py counterexample scratch/npm-pack-host-only-ci.mjs --purpose "Repeat production-like npm pack of a host-only staged shim without extra optionals, then npm 11 ci on the generated lock"`

   - pid 75677, exit 0, 4.80s, not timed out
   - Packed and lock `optionalDependencies` were `{ snapback2-darwin-arm64: 0.0.15 }`; `lockLinux: null`
   - `npm ci` accepted unchanged package/lock bytes; installed host `0.0.15`

`publish.mjs` was not imported or executed except insofar as the supplied packet already contains `--self-test` output. No baseline suite, historical app control, publish, registry, or native/build work was repeated.

## Fixture and qualification limits

- Candidate tests never call `npm pack`; production and development packing do. The reviewer `npm pack` counterexample closed that gap for host-only metadata. It does not replace a production `prepare()` run with real binaries.
- Exact-lock evidence is sibling tarball install of selected artifacts plus `npm ci`, which is the selected-artifact shape used by `consumerSmoke`. A consumer that depends only on a registry `snapback2` tarball and resolves the host optional as a nested registry fetch was not executed.
- Two-platform helper tests are synthetic JSON names, not a Linux runtime qualification.
- `packDevelopmentConsumer` does not run `verifyPlatformDependencies`; resume/immutable-shim enforcement is on the production qualify path only.
- Existing `inputs/original` and `inputs/publication-consumer` locks still embed Linux on `snapback2@0.0.15`. They remain invalid for npm 11 `npm ci` until a new publication is consumed and a new lock is generated. That is outside this change.
