# Digest emission cost probe — 2026-09-12

Evidence for LLP 1025 §5 and LLP 1025.000 §6. Read-only certification
(`check --cost --json`) of three project variants derived from the retained
`compact-final` project in
`../2026-09-12-snapback2-1023-release-0029/digest-distinct-probe/`, using the
same published 0.0.29 darwin-arm64 binary, compiler shim and Node 24.18.0 that
probe records. No owner was started; no benchmark lane was touched.

    export SNAPBACK2_COMPILER=<0.0.29 publish dir>/shim/dist/compiler.mjs
    export SNAPBACK2_NODE=/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node
    (cd <variant> && <0.0.29 publish dir>/snapback2-darwin-arm64/bin/snapback2 check --project . --cost --json)

| variant | change | `periodDigestSweep` | closure | heap |
| --- | --- | --- | ---: | ---: |
| `baseline` | the retained compact-final: 1,000 memberships, 500 follows, maintain keyed by membership | refused | 8,691,704 | 9,922,698 |
| `owner-only-maintain` | baseline with that maintain `read <- deny` | refused, identical | 8,691,704 | 9,922,698 |
| `recipient-maintain` | `periodChats` existence table + two recipient-level count maintains; the digest reads two counters instead of 1,000 | admitted | 1,848,418 | 2,733,253 |

`recipient-maintain.patch` is the exact delta from `baseline`. Each
`<variant>.check.json.gz` is the complete `--json` output; `summary.json`
extracts the three digest programs' certificates and hashes every source
file. Binary SHA-256 `e0e3dae8793317662cd5cb07c51747b1da01553a84c84cb8879da3fafc8a34d8`.
