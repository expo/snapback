# snapback2@0.0.19 builtin-named table acceptance witness

Host: `Charlies-MacBook-Pro-2.local` (`arm64`), Node `v24.18.0`, npm `11.10.0`.
Install: public `https://registry.npmjs.org/`, exact `snapback2@0.0.19`, cache `/Users/ccheever/snapback2-release-019/fresh-registry-cache`, no source override.
Installed pair: `snapback2@0.0.19` + `snapback2-darwin-arm64@0.0.19`.

The shared matrix declares tables named `words`, `tokens`, `range`, `min`, `max`, `count`, `divmod`, and `share`, seeds each with `{ value: 7 }`, and compiles successfully with 8 operations. Runtime used only `127.0.0.1:53145`, after an empty listener check. Owner PID 55364 was recorded, stopped through its project owner, and confirmed absent; the port was confirmed free afterward.

| table | table read | matching builtin result | status |
|---|---:|---|---|
| words | 7 | no public `words()` builtin in direct Quarry | table read PASS; call REFUSED as documented |
| tokens | 7 | `["alice","bob"]` | PASS |
| range | 7 | `[1,2,3]` for `range(1,4)` | PASS |
| min | 7 | `7` for `min(7,10)` | PASS |
| max | 7 | `10` for `max(7,10)` | PASS |
| count | 7 | `3` for `count(range(1,4))` | PASS |
| divmod | 7 | `{ quotient: 2, remainder: 1, sink: "lexicographic-id" }` | PASS |
| share | 7 | `7` for one recipient | PASS |

The separate `words-call` fixture retains the same valid `words` table read and adds `words('Alpha beta')`. `snapback2 check --project words-call --json` exits 1 with:

```json
{"code":"E_QUARRY_UNSUPPORTED","family":"quarry","message":"words() in direct Quarry is not part of the Snapback 2 platform","site":"snapback/words-call.q:3:60","rewrite":"-- use an engine-maintained wordPrefixes index","guide":"quarry/refusals"}
```

This is a call-site platform refusal, not a table-name collision. No `E_OPAQUE`, duplicate identifier, generated-code property error, or table declaration refusal occurred.

Installed documentation evidence is retained in `installed-guide-grammar.txt`, `installed-guide-quarry.txt`, `installed-guide-builtins.txt`, and `installed-guide-builtin-lines.txt`. The installed Quarry guide states that `count`, `range`, `min`, `max`, `divmod`, and `share` are builtins, documents `tokens(text)`, and explicitly says there is no public `words()` value function.

Two setup-only harness mistakes are retained separately in `harness-notes.txt`; neither changed a repository, ran a product suite, or produced acceptance evidence.

## Committed evidence subset

This folder retains the exact fixture source, successful compile/read outputs,
retired-call refusal, registry install provenance and the failed harness-call
output. `commands.txt` and `write-fixtures.mjs.txt` preserve the reproduction
code as evidence text; restore their original filenames to replay it in a fresh
scratch directory. The complete 110-file raw evidence set, including installed
guide captures, remains at the remote evidence root. The failed scalar-loop
output is named `harness-operation-loop.output.json` here; its original name
and cause are recorded in `harness-notes.txt`.
