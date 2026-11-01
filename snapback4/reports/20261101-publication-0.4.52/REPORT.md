# Snapback 4 0.4.52 publication — PUB052

All four packages were published to npm and independently verified: each package's version and latest tag are 0.4.52, and each downloaded registry tarball is byte-identical to the qualified staged artifact. Both hosts passed the staged and registry foreground SSH smoke (10/10 each).

Publication source: `107a413c296cd73e9701bc43ebdd4c6b86ca95bd`. The source was frozen after the release commit was pushed; no later gate winners were included. The release ships GUIDE1 bounded complete guide reads and reading history, `check --quick`, and the Quarry editor grammar. All package/crate versions and generated editor stamps were advanced together; the real grammar generator and editor census ran.

| Package | Registry version/latest | Qualified and registry SHA256 |
|---|---|---|
| `snapback4` | `0.4.52` | `079d2596a110b6e2f03f33cbb9a326363977e3b042507c30f67a789c988bd58b` |
| `snapback4-expo` | `0.4.52` | `c28d8367706413594eec8eedf7a057339164286f72931faf7cfe9d69b2ed58a4` |
| `snapback4-darwin-arm64` | `0.4.52` | `0f0124fda2f7b6c847d9a27cac6f37207a9b57d05b10b690cdc7d333840ef1c2` |
| `snapback4-linux-x64` | `0.4.52` | `a47c5f0290d36da6e60a97e891a6b1820383a1787f0c1cff3ae8dd8355e4fbef` |

## Qualification and provenance

- Mac native Release build and offline/restart witness passed. Expo preparation checked all 28 packaged files against the native-qualified payload. The Mac-prepared client/Expo tarballs were transferred to Linux with matching SHA256.
- Linux official qualification passed on those bytes: source suite zero failures (1,207 Rust executions plus doctests, fixture 9/9, ordinary client files 482/482, models 89/89), packed frontend 12/12, starter 6/6, Ubuntu/Alpine and ELF proofs. The official Linux receipt validator passed on both hosts.
- Mac pre-Darwin passed 49/49. The single tolerant dry run passed on AC with a valid watchdog environment: source suite zero failures (1,207 Rust executions plus doctests, fixture 9/9, ordinary client files 482/482, models 89/89), fresh npm refresh 6/6 before and after, Darwin production/signing and installed-consumer proofs passed.
- Fresh stock web/Expo starter audits passed with zero findings/warnings on both hosts before the long qualification and immediately before finish. An additional pre-dry audit repeat also passed.
- Both-host staged foreground SSH smokes passed 10/10 before finish. Guarded finish completed all eight steps: durable-stage resume, registry CLI, Expo pack/manifest/native-byte checks, publish, readability wait and registry Expo proof.
- Both hosts freshly downloaded registry tarballs and independently matched all four SHA256 values. Both-host registry foreground SSH smokes passed 10/10. [Strict registry verification](linux/verify-registry.out) returned raw exit 0 and `verify ok=1`, including all four version/latest values and byte comparisons.

## Release-check repairs and retained reds

The initial affected run exposed a historical test assertion that required the progressive-startup announcement to remain the newest changelog entry. A test-only main fix retained that assertion against its historical entry, passed 3/3 in isolation and affected verification, and was pushed/cherry-picked into release lineage. A real-timer deadline failure passed unchanged 6/6 in isolation; the required full rerun was performed. The changelog CLI-owner tests also exposed ambiguous wording: the final entry names the grammar verb and explicitly spells `guide --full`.

All raw failing receipts/logs are retained under `release-evidence/archive-*`. No failed receipt was rewritten. The full rerun's unaffected 31 steps passed. The final source changed only the explicit guide prefix; the official affected API then reran the final documentation scope and the exact complete original client set (487 ordinary files plus two model files), all 12 steps passing. The effective 32-step result was accepted only after validating source/blob identity, the one-line delta, command scope, file counts and original failures. See [effective qualification](release-evidence/release-effective-qualification.json), [final-scope receipt](release-evidence/release-final-scope-result.json), and the captured validation/lineage evidence. Native and all publication qualification then ran from the exact final frozen source above.

A copied-kit audit scratch directory caused an early evaluator output-exists refusal; it was archived and the active kit restricted to code inputs. This was setup recovery, before qualification/upload. No runtime fix or dependency-audit red was waived.

## Records

This records commit adds the two publication metric rows and two native witness rows, the Mac/Expo/Linux reports, receipts, kit, audits, smoke/registry evidence, source bundles and repair lineage. Large source-suite logs are gzip-compressed. Tarballs, videos and dependency caches are excluded from Git; the original artifacts remain in the external publication records/stage. The append-only [Linux STATUS](linux/STATUS.md) preserves the decisions and UTC chronology. The complete external record remains at `/home/ccheever/sb4-pub-0452-records/STATUS.md`.

The records commit is verified after landing with the affected selector against its actual parent, plus inventories and ref-check; the external final STATUS and workstream report record that resulting commit and receipt, avoiding a self-referential commit hash here.
