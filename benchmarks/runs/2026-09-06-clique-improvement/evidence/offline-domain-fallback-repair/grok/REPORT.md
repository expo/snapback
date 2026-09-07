# Independent review: search-twin domain fallback (0ecd vs 82c43)

**Correctness / ownership: READY**

**Size: FAIL (inherited, binds BASE 82c43, not measured on 0ecd)**

No author, prior, or peer report was supplied or read. No subagents. No packet/source or peer-directory writes. No new probe: source inspection did not produce a counterexample unsettled by the frozen evidence.

Native requested and used: grok-4.6 / xhigh.

## Scope (exact)

Review is limited to the two-path canonical-domain fallback repair:

- source `0ecd6015a7a1f0c291a224baef37f832b6b3154a`
- base `82c43ca456022682670941494dd828e099fca3d8`
- parent hasher behavior `23a0` (probe `before/` arm only)

Tracked blobs replaced: exactly

- `snapback2/packages/evaluator/src/certificate-identity.ts`
- `snapback2/packages/evaluator/src/test.ts`

Packet `source/` vs `before/` under `packages/evaluator/src` differ only on those two files. Native `LoopDomain` is static reference, not a change. Hasher behavior is not admission, certified execution, or an authorization bypass.

## Repair

Base 82c43:

```198:198:packet/before/snapback2/packages/evaluator/src/certificate-identity.ts
function normalizeDomain(domain: any): any { return node(domain, DOMAIN, unchanged); }
```

`node` tags once, then `Object.hasOwn` dispatches known constructors, else `unchanged(value)` returns the original container. `tagged()` uses `Object.keys` and therefore treats a singleton string/array as kind `"0"`. `canonicalProgramJson` then emitted the raw string/array instead of a tagged object.

Parent 23a0 (`packet/evidence/after-probe/before/certificate-identity.ts` 275–289) tagged once and always rebuilt `{ [kind]: data }`, with known Page/DerivedArray/Recurse/LiteralRange/ArgList constructors and opaque unknown payload (no deep-sort).

0ecd restores only that domain wrapping:

```198:202:packet/source/snapback2/packages/evaluator/src/certificate-identity.ts
function normalizeDomain(domain: any): any {
  const [kind, data] = tagged(domain);
  // Unknown domains retain the tag wrapper and opaque payload, including one-key strings/arrays.
  return { [kind]: Object.hasOwn(DOMAIN, kind) ? DOMAIN[kind](data) : data };
}
```

`test.ts` 1024–1060 adds five fixed parent oracles (synthetic For programs; not native IR admission).

## Materiality

| Obligation | Result | Why |
|---|---|---|
| Wrap singleton string/array unknown domains as `{[kind]:data}` | Introduced restore | `"x"` → `{"0":"x"}`; `[{Literal:"Null"}]` → `{"0":{...}}`. Matches parent 23a0, not base 82c43. |
| Opaque unknown object payload insertion order | Unchanged vs parent and base | `{FutureDomain:{z:1,a:2}}` is not deep-sorted. `unknownPayload` / `deepSorted` are not used. |
| Known constructor serde order | Unchanged | `Object.hasOwn(DOMAIN, kind)` then `DOMAIN[kind](data)`. Reversed `LiteralRange` input becomes `start` then `end_exclusive`. |
| One tagged read / refusal | Met | Single `tagged(domain)`. Does not call `node` (which would re-tag if the unknown handler tagged again). |
| Own / prototype dispatch | Met | Same `Object.hasOwn` as `node`. Inherited names are not executed as constructors. |
| expressions / statements / `tagged` / `node` | Unchanged | Diff is `normalizeDomain` plus tests. Statement inherited-name refusal and expression `unchanged` fallback remain. |
| No retained input cache | Unchanged | No cache. Existing construction-order test at `test.ts` 1002–1021 still requires a fresh stringify. |
| Empty-object refusal | Unchanged | `tagged({})` still throws `Error` (`constructor === Error`, `name === "Error"`, `code === undefined`, message `E_TRACE_SUBSET: malformed externally tagged IR`). |
| Valid-program hashes | Unchanged on evidence | Native/compiler `LoopDomain` is the five tagged object variants already in `DOMAIN`. Evaluator corpus `plan_hash` checks still pass. |
| No new IR / no broader strictness | Met | Malformed containers still hash; they are not admitted native variants. Domain does not gain the statement inherited-name `pick` refusal. |

Parent 23a0 used `switch` plus `{ [kind]: data }` in the default arm after `pick` for LiteralRange/ArgList. 0ecd’s `DOMAIN` structs are the same field orders (`Page` → `normalizeScan`; DerivedArray/Recurse/LiteralRange/ArgList → `struct`/`pick`). Unknown still wraps the raw payload, not a sorted copy.

`decodeHeldProgram` (`held-program.ts` 33) and `evaluateCase` (`evaluator.ts` 79) consume `canonicalProgramJson` unchanged. A valid tagged domain still hashes as before this patch. A singleton string/array domain now hashes as parent 23a0, which is the stated hasher obligation.

These synthetic containers are not accepted native `LoopDomain` values. Native enum (`packet/native/source/snapback2/crates/snapback2-core/src/ir.rs` 171–188) remains Page / LiteralRange / ArgList / DerivedArray / Recurse, serde externally tagged.

## Introduced versus inherited

Introduced by 0ecd:

- Domain unknown fallback rebuilds `{[kind]:data}` instead of returning the original container.
- Five parent oracles in `test.ts`.

Inherited, not cleared by READY:

- Size FAIL on BASE 82c43: gzip 75815 / minified 230321, ceiling 66000, target 64000, overage 9815. `final-measure.json` exit 1. Not remeasured on 0ecd. No size pass, waiver, or new-byte claim.
- Whole native ir-contract v2 versus runtime v5 mismatch, including identical `systemPrincipalId` and explicit runner/corpus v5 constants. Checker `26c9` SHA `2f3cd93ccbff5902465f2514e61d8cf6fedf76228ad8e7abafe02ed5f1959175` is scoped `check --ir --json` only, not integration qualification.
- `tagged()` still accepts singleton strings/arrays as kind `"0"` because `Object.keys` says so. That is preexisting hasher shape, restored wrapping, not new IR.
- Caps, movement, resident, new-size, public package, current-main, native owner, compiler, phone: not in scope.

## Evidence read (not re-executed)

Original 1490 B probe (SHA `1132b7fa195098e8c1aebbd6c803e31c44dec1130b2d8220d4efad54544a9e1f`), identical in original-probe and after-probe:

- Original failure: local Bun 1.3.12 SHA `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18`, PID 79616, 0.053627 s / 10 s, stdout SHA `7972c9e206d57a285d6bc2c61e8f93381b636a7123e045498e938bfd2578682f`. Two unequal (string, array), three equal (unknown object, known LiteralRange, empty-object refusal).
- After repair: same probe, PID 11359, 0.092389 s / 10 s, stdout SHA `e8add0bd2d6ab9515a3fb90eabec06f4f942e07f1a894d8d00e531183524f4e2`. `comparison.json`: 5/5 full parent/repair result equal and fixed-oracle equal. String and array `originalCandidateEqual: false` (the bug). Other three already equal on 82c43.

Four-module arms (identity/hash/errors/types) hash-bind:

- parent 23a0 identity `f80407e5c2e289c24ac09fde2e0252c015e543c6722d33d995f178e3531a5eb0`
- base 82c43 identity `3c116313a4c14ace66792f9b59b9b1e30152166d788e7133c4c26a871e61507e` (= packet `before/` and original-probe `source/`)
- repaired 0ecd identity `b0bfde1824b83958c344388861c99e1ad5eba90534ec16a1a5cd31e1a37d09d0` (= packet `source/`, executed-source, after-probe `source/`)
- hash/errors/types identical across arms: `470e2f79…` / `a2dc2e8e…` / `afc6bc7f…`

Evaluator receipt (read only): Bun `src/test.ts`, PID 3921619, 6.679725 s / 120 s outer, no internal deadline, log line `canonical domain fallback: 5 fixed parent controls passed`, then `{"cases":225,"passed":225,"serverOnly":24,"failed":0}`. Unicode foundation 20,034 normalization rows / 1512 C-S folds inside that entry. Checker-use `testEntrySha` `8b362090015e90fbe96c04ccd516dff594a9109ff46a913697053390b283f504` matches packet `source` `test.ts`.

Oracle bytes/hashes in `test.ts` match original-probe parent outputs exactly:

- string json/hash `4e23a065bf3cf1b09c95458a5f319a2b8c265a098b4750b9810f5f4734c5ced1`
- array json/hash `8ad7c1e0b4535e081aefea7e037e7bedac52426ba718c9302843201785e5a024`
- unknown object `f3e0897658024bebf843b123af77a1b62e00be99e7d114110ed488a3f2f95789`
- known LiteralRange `a0393d0c8857f06be4b7825b7ac2ff960bff48aa1afa3b84c9cd2f5a598487c2`

Governing docs read for identity/custody context only: `source/AGENTS.md`, `source/snapback2/AGENTS.md`, `rules/{RULES,NOT-DOING}.md`, LLP 1000, LLP 1001 §10, LLP 1012 hasher comment in `certificate-identity.ts`, Snapback2 offline/live-query guides, contracts clock/extent/slot rules. Session packet constraints override stale older docs. No new IR or size work was taken from them.

## Checks actually run versus merely read

Ran:

- SHA-256 of packet `manifest.json` → `bee6b4e20068c523161bd6aac27a04999f168cca7adb3d0b8e6a43e4a242e7f9` (matches requested bind).
- SHA-256 of `direct-delta.patch` → `ca92a2b585ad3b30a6cd34b8e369e21218a4c9d5c4fb1b44c426b06807c5ca29` (matches `freeze.json` `ownedDiffSha`).
- SHA-256 of identity/test/probe/stdout copies listed above; `source-manifest.json` → `bb6217f9fc7c6f1a564b06bb76830bf29fe2e155d5eeb4141a9ac92d2204fce3` (matches freeze `sourceManifestSha`).
- Local `bun` 1.3.12 SHA `39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18` (matches probe runtime; not used to execute product tests).
- Byte compare of `packet/source` vs `packet/before` evaluator `src`: only the two named files differ.

Did not run: full evaluator, package build, caps, movement, resident, size, install, remote, native, browser, or any new diagnostic probe.

## Hash bind

| Artifact | SHA256 |
|---|---|
| packet/manifest.json | bee6b4e20068c523161bd6aac27a04999f168cca7adb3d0b8e6a43e4a242e7f9 |
| packet/context.md | 8ddb048e0608dcd30b12e574fcde15735cd7a67fe523f6d40c3e25e6d6635fea |
| packet/direct-delta.patch | ca92a2b585ad3b30a6cd34b8e369e21218a4c9d5c4fb1b44c426b06807c5ca29 |
| packet/direct-delta-paths.txt | 7660045ac3a570deae1eba5925311212dfe944df82b3818fdd1f004507deaf59 |
| evidence/source-manifest.json | bb6217f9fc7c6f1a564b06bb76830bf29fe2e155d5eeb4141a9ac92d2204fce3 |
| probe.ts (both arms, 1490 B) | 1132b7fa195098e8c1aebbd6c803e31c44dec1130b2d8220d4efad54544a9e1f |
| original-probe/stdout.json | 7972c9e206d57a285d6bc2c61e8f93381b636a7123e045498e938bfd2578682f |
| after-probe/stdout.json | e8add0bd2d6ab9515a3fb90eabec06f4f942e07f1a894d8d00e531183524f4e2 |
| 0ecd certificate-identity.ts | b0bfde1824b83958c344388861c99e1ad5eba90534ec16a1a5cd31e1a37d09d0 |
| 0ecd test.ts | 8b362090015e90fbe96c04ccd516dff594a9109ff46a913697053390b283f504 |
| 82c43 certificate-identity.ts | 3c116313a4c14ace66792f9b59b9b1e30152166d788e7133c4c26a871e61507e |
| parent 23a0 certificate-identity.ts | f80407e5c2e289c24ac09fde2e0252c015e543c6722d33d995f178e3531a5eb0 |

No new probe source/output exists. READY does not qualify publication, current-main, native, compiler, phone, or resident.
