Verdict: READY

Candidate `f681a72ef3ff495edfc354291ba232c19018259e` against parent `7884642fbddeb56bd18a03215e23c6761c76cd87`. Changed product leaves in this packet: `snapback2/scripts/consumer-smoke.mjs`, `snapback2/scripts/publish.test.mjs`, `llp/1002-dev-loop.spec.md`. Diary body omitted by `commit-files.json`. `publish.mjs`, `measure.mjs`, `packages/snapback2/build.mjs`, and `packages/snapback2/package.json` are byte-identical to the parent.

## Summary

The parent used two different classifiers: it stripped any optional whose name started with `snapback2-`, then accepted a selected artifact if the name matched `^snapback2-[a-z0-9]+-[a-z0-9]+$`. That removed `snapback2-plugin` during Darwin-only staging and would have treated `snapback2-plugin-tools` as a platform if selected. The candidate replaces both sides with one exact-identity predicate: `snapback2-darwin-arm64` and `snapback2-linux-x64` only. Staging, verification, Darwin-only / Linux-only / both selections, refusals-before-write, resumed-shim mismatch, packed identity checks, and the host-only npm 11 lock fixture all follow from that predicate. Production still stages the host package, verifies packed names and the dependency map, then runs installed-consumer qualification before publish. No product defect is deduced from the candidate source, and no new execution was required to resolve a material uncertainty.

Passing `publish --self-test` and historical outputs are evidence of recorded runs, not an author or peer verdict. The assessment below is from candidate/parent source, the intended contract, and those raw records.

## 1. One supported-platform classification

Source deduction. `isPlatformPackage` at `snapshot/snapback2/scripts/consumer-smoke.mjs:8-10` is the only classifier. `selectedPlatformDependencies` uses it both to drop old platform entries (`:14-15`) and to accept selected artifacts (`:17-19`). `stagePlatformDependencies` (`:26-31`) and `verifyPlatformDependencies` (`:33-54`) both call that helper, so strip and accept cannot drift.

Parent (`baseline/snapback2/scripts/consumer-smoke.mjs:10-14`):

- removal: `!name.startsWith('snapback2-')`
- acceptance: `/^snapback2-[a-z0-9]+-[a-z0-9]+$/`

Those are not the same set. `snapback2-plugin` is stripped by the prefix and is not a two-word suffix, so it disappeared from Darwin-only output. Historical r1 Astra `preserve-optional.mjs` recorded that first failure: after staging, `snapback2-plugin` was `undefined` while `unrelated` survived (`evidence/raw/prior-metadata-counterexamples/astra/executions/01-counterexample.stdout.log`, exit 1). `snapback2-plugin-tools` matches the old acceptance regex, so a selected plugin-tools artifact would have been written as a platform.

Candidate behavior for the names the contract names:

| Name | Strip as old platform? | Accept as selected artifact? |
|---|---|---|
| `snapback2-darwin-arm64` | yes | yes |
| `snapback2-linux-x64` | yes | yes |
| `snapback2-plugin` | no (preserved) | no |
| `snapback2-plugin-tools` | no (preserved) | no |
| `snapback2-darwin-x64` | no | no |
| `react` | no | no |

Current source `packages/snapback2/package.json:116-119` declares exactly those two platform identities at `0.0.15`. Recognizing either name is not runtime qualification. The classifier is hardcoded to those two strings rather than “every optional in the source shim”; that is what prevents a plugin in `optionalDependencies` from becoming a platform. Adding a third platform later requires updating this predicate in the same change as the source manifest. That coupling is the stated exact-identity rule, not a defect in this correction.

`stagePlatformDependencies` assigns only `optionalDependencies` and writes after `selectedPlatformDependencies` returns (`consumer-smoke.mjs:27-30`). Ordinary `dependencies`, `peerDependencies`, and `peerDependenciesMeta` remain the parsed manifest fields. Throws happen before `writeFileSync`.

## 2. Valid selections and refusals before write

Source deduction, with recorded self-test stdout as a run record only.

`publish.test.mjs:35-52` stages `[darwin]`, `[linux]`, and `[darwin, linux]` from a fixture that spreads `{ unrelated, snapback2-plugin, snapback2-plugin-tools }` onto the source optionals. Expected optionals are those three plus the selected platform names at the shim version. `peerDependencies`, `peerDependenciesMeta`, and `dependencies` are asserted equal to source. Each staged directory is packed with `tar` and passed to `verifyPlatformDependencies`.

`publish.test.mjs:54-64` refuses, without rewriting the shim bytes:

- no artifacts
- version `0.0.0-invalid`
- duplicate `platforms[0]`
- `react`, `snapback2-plugin`, `snapback2-plugin-tools`, `snapback2-darwin-x64`

Empty selection throws `a staged shim needs at least one platform artifact` (`consumer-smoke.mjs:13`); the others throw `invalid staged platform …` (`:19`). Both match `/platform/`. Duplicate detection is `Object.hasOwn(dependencies, artifact.name)` after platforms have been filtered out, so a second copy of a selected platform is a duplicate rather than a no-op.

Linux-only here is a metadata map: the linux fixture is `{ name, version }` with no `os`/`cpu` and no linux binary. It does not qualify a linux runtime.

Recorded product self-test (`evidence/raw/product/publication-self-test.stdout.log`, exit 0, 6.44s): the three staging tests, the refusal test, resumed-shim, packed-identity, and npm 11 consumer all reported pass under Node v24.18.0 / npm 11.16.0. That run is not treated as proof; it matches the source.

## 3. Packed names, versions, and dependency maps

`verifyPlatformDependencies` (`consumer-smoke.mjs:33-54`) unpacks each tarball’s `package/package.json`, requires `manifest.name`/`version` to match the artifact record, requires a `snapback2` shim, then rebuilds the expected optional map with the same helper from the packed shim plus every non-shim artifact. Length plus per-key version must match. A mismatched immutable tarball is refused; the helper does not rewrite tarballs.

Covered in tests:

- Staged Darwin-only, Linux-only, and both, including plugin optionals in the packed shim, then `verifyPlatformDependencies` (`publish.test.mjs:48-50`).
- Resumed shim that still advertises both platforms while only darwin is in the artifact list (`:66-73`). Tarball bytes are compared before/after the throw.
- Artifact record version disagrees with packed identity (`:76-80`).

Source deduction for the adjacent missing/extra cases that the test file does not name as separate titles:

- Extra non-platform artifact in the verify list: `selectedPlatformDependencies` throws `invalid staged platform` because `isPlatformPackage` is false.
- Extra recognized platform in the artifact list but not in the packed shim: expected gains that name; actual does not; length/key check throws `optionalDependencies do not match`.
- Packed shim still has a platform that is not in the artifact list: the filter removes it from expected; actual still has it; same throw. That is the resumed-shim test.
- Normal `dependencies` and `peerDependenciesMeta`: staging never assigns those keys (`consumer-smoke.mjs:29`).

Production packing uses `npm pack`; the tests pack with `tar -czf` of a `package/` tree. Both expose `package/package.json` to the same verifier. Historical r1 Grok `npm-pack-host-only-ci.mjs` already showed `npm pack` preserving a Darwin-only optional map when no unresolved extra optional was present.

## 4. Production and development call paths

Unchanged files; behavior change is only the imported helper.

Production (`snapshot/snapback2/scripts/publish.mjs`, identical to parent):

- `package.json` script `publish:npm` → `node scripts/publish.mjs` (`snapshot/snapback2/package.json:11`).
- `main` builds `name = snapback2-${process.platform}-${process.arch}` (`publish.mjs:873-874`).
- `prepare` copies the built shim snapshot, writes the host platform package, then `stagePlatformDependencies(shimStage, platformArtifacts)` (`:577-579`).
- Default `qualifyArtifacts` runs `qualifyStagedMedia` then `verifyPlatformDependencies` before resume is written (`:601-605`).
- `main` then runs `consumerSmoke(staged.artifacts)` and throws on non-zero (`:881-883`) before `npm publish` / `--dry-run` (`:884-899`).

On this Darwin arm64 host the constructed name is `snapback2-darwin-arm64`, which the classifier accepts. Linux is dropped for a host-only publication. A Darwin-only publication does not require a linux tarball. On an undeclared host (`darwin-x64`, `win32-x64`, …) staging now throws at the classifier rather than publishing a two-word-suffix name the source does not declare.

`packages/snapback2/build.mjs:226` copies source `package.json` into the snapshot unchanged. Classification happens after that copy, in `stagePlatformDependencies`.

Development: `measure.mjs:200-202` calls `packDevelopmentConsumer`. That helper builds `snapback2-${process.platform}-${process.arch}` (`consumer-smoke.mjs:157`) and stages that single artifact (`:173`) with the same function production uses. It does not call `verifyPlatformDependencies`; the parent did not either. Development packing is the same selection, then `consumerSmoke` of the packed pair.

The CLI shim `packages/snapback2/bin/snapback2.mjs:6` still resolves `snapback2-${process.platform}-${process.arch}` at runtime. That is install-time binary lookup, not publication classification. Recognizing the name in the classifier does not make the host qualified.

## 5. Fixture and qualification scope

Preservation fixtures (`publish.test.mjs:35-52`, `:54-64`) prove JSON-level staging: plugin optionals survive, plugin names and `snapback2-darwin-x64` are refused as platforms, and selected platform maps plus `dependencies` / peer metadata match. They pack synthetic `package.json` trees. They do not install `snapback2-plugin` or `snapback2-plugin-tools`. Current source does not declare those packages; they are synthetic names for classification.

The exact-lock npm 11 consumer (`publish.test.mjs:83-133`) proves, on the host that ran it:

- Stage the host identity `snapback2-${process.platform}-${process.arch}` (Darwin arm64 in the recorded run).
- Pack shim + host + synthetic `react@19.1.1` and `typescript` with `tar`.
- Offline `npm install` of those tarballs, copy package/lock, `npm ci` with unchanged bytes, default peer/optional flags (no `--omit=optional`).
- Installed `snapback2`, host platform, and `react` versions match.

It does not prove:

- Plugin optionals through `npm pack` or `npm ci`.
- Linux-only or combined-platform *install* of os/cpu-constrained tarballs.
- Optional-install semantics for a non-host platform (the host tarball is a direct `file:` operand of the fixture consumer, so it is mandatory for that consumer).
- Unresolved extra optionals in a lock.
- Production cargo/media build, registry publish, or `packDevelopmentConsumer` end-to-end.
- Linux runtime qualification.

LLP 1002 §11 (`snapshot/llp/1002-dev-loop.spec.md:1006-1022`) now states the exact identities, that unrelated prefixed optionals including the two plugin names remain, that a recognized name is not qualification, and that the self-test lock fixture is packaging evidence separate from runtime/platform qualification. That matches the fixtures.

`packages/snapback2/README.md` still says the platform binary ships in `snapback2-<os>-<arch>`. Source currently names only darwin-arm64 and linux-x64.

## 6. Historical failures that this correction does not erase

These remain factual and independent of exact-identity classification. They are not treated as fixed or as regressions of this candidate.

Combined-platform mandatory-artifact install (r1 Astra `multiple-platform-install.mjs`): verifier accepted both packed identities and the shim map; `npm install` of both platform tarballs as install operands on Darwin arm64 failed `EBADPLATFORM` for `snapback2-linux-x64` (`executions/02-counterexample.stderr.log`, exit 1). Cause: tarball operands are mandatory, not optionalDependencies of the shim. Metadata selection of both platforms can still be valid while that install shape fails.

Unresolved synthetic optional (r1 Grok `npm-pack-staged-shim.mjs`): Darwin-only staging kept `unrelated: 1.2.3`; `npm pack` and producer `npm install` succeeded; `npm ci` failed `Missing: unrelated@ from lock file` (`executions/01-counterexample.stderr.log`, exit 1). npm 11 `validate-lockfile` requires an ideal-tree optional that was pruned without a version. Host-only without that extra optional then passed (`npm-pack-host-only-ci.mjs`, exit 0). The candidate consumer fixture does not reintroduce an unresolved optional.

Historical published `snapback2@0.0.15` still lists both platforms (`evidence/raw/registry/snapback2.json`). `snapback2-linux-x64@0.0.15` is registry 404 (`snapback2-linux-x64.json` is `"Not Found"`). Unchanged original app lock under npm 11 ci failed `Missing: snapback2-linux-x64@ from lock file` (`controls/01-app-npm11`); the same inputs under npm 10.9.8 installed (`controls/02-app-npm10`, 723 packages). Publication-consumer npm 11 ci failed `Missing: react@19.2.8` and `Missing: snapback2-linux-x64@` (`controls/03-consumer-npm11`). Those locks are historical evidence of the published dual-optional shim plus a missing linux artifact. They are not this candidate’s output. Darwin-only staging of a future publication is what stops linux from being required; this correction keeps that behavior while no longer deleting unrelated `snapback2-*` optionals.

Registry verification install of `snapback2@0.0.15` plus `snapback2-darwin-arm64@0.0.15` exited 0 (`registry-verification-install.json`). That is historical host install of the published pair, not Linux qualification and not this staging helper.

## 7. Other recorded checks

- `git diff --check`: exit 0, empty stdout/stderr.
- `ref-check --verbose`: exit 0, `ref-check: ok — 412 LLP docs, 7763 refs in 18024 files, 0 errors, 0 unchecked`.
- Product `publish --self-test`: exit 0; packaging tests 7/7 pass; `publish self-test ok; …`.

## Optional commands actually run

No executions. Source inspection plus the packet’s raw records resolved the classification, call paths, and fixture scope. Workload ceilings were not used. Historical counterexamples were not repeated.

## Findings

No actionable findings.

Unverified by design of this packet, not raised as defects: Linux runtime of a linux-x64 artifact; `packDevelopmentConsumer` / full `publish.mjs` production build on this candidate; npm 11 lock behavior when a preserved plugin optional cannot be resolved; os/cpu-constrained combined-platform tarball operands.
