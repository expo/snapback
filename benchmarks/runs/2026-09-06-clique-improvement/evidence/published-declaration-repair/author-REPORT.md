# Ambient declaration repair — finite execution complete

**PASS for the authorized scope.** One normal JS package build, both registered
built-package consumers, and the affected helper-source Program passed on EPYC.
All eight workload labels ran exactly once; no runtime failure, retry, source
change, helper change or unrun stage remains.

Source commit `367d263b8f44fda994397d5f8bb8b8110951d021`, tree
`6d9c6d0457b11b2b8b2b5d99dfe401de15f1061d`, base
`ca6c082c3b0ad7a1160d0d4f8b21d93952494e32` remain frozen. The production change affects only the
ambient offline declaration copy; standalone exports/signatures are preserved.
The [source diff](source.diff) contains the repair, normal regression registration
and LLP1012 note. Execution introduced no additional commit or source edit.

| Bound label | Actual child PID | Seconds | Terminal |
|---|---:|---:|---|
| setup-01 | 276474 | 8.537 | exit 0, waited |
| package-build-01 | 276584 | 2.771 | exit 0, waited |
| snapshot-01 | 276913 | 0.165 | exit 0, waited |
| public-consumer-01 | 277071 | 1.217 | exit 0, waited |
| standalone-consumer-01 | 277203 | 1.167 | exit 0, waited |
| source-type-01 | 277313 | 2.070 | exit 0, waited |
| integrity-after-01 | 277756 | 5.778 | exit 0, waited |
| collect-01 | 277999 | 0.215 | exit 0, waited |

Every remote child stayed within 30 seconds. All 12 SSH/SCP transports exited 0
and were waited within 45 seconds; download took 24.436 seconds. Bootstrap
mkdir/upload/extract ran once each. [Execution ledger](execution-ledger.json)
and [closure receipts](execution-closure.json) retain exact argv/cwd, tool hashes,
start identities, deadlines, timing and fresh acknowledgments. The esbuild
service PID 276596 (startTicks 117849423) was adopted by the owned runner,
waited with exit 0, and confirmed absent; its
[spawn record](remote-evidence/results/package-build-01/descendants.jsonl) and
[waited terminal](remote-evidence/results/package-build-01/execution.json) are retained.
No known owned process remains. **Outer closure is supervisor-owned and not claimed.**

Both consumers used the actual new 153-leaf published-file package and
`skipLibCheck: false`. Their full unfiltered diagnostics are empty:
[public](remote-evidence/results/public-consumer-01/diagnostics.json),
[standalone](remote-evidence/results/standalone-consumer-01/diagnostics.json).
The public Program resolved 75 files (16 package declarations, 58 bound dependency
files, one exact consumer); standalone resolved 60 (one package declaration,
58 dependency files, one consumer). The source helper check resolved 171 files
and also had [zero diagnostics](remote-evidence/results/source-type-01/diagnostics.json).
Complete roots, options and file/hash manifests accompany each result.

The same Programs establish verdict `boolean`, sequence `number`, protocol `1`,
encoded envelope and error path `string`, with no any/error-any in inspected
bindings. Six public and five standalone `@ts-expect-error` directives were
consumed, including wrong number/boolean assignments and the IsAny-true control.
Root/standalone class/function compatibility passed. The standalone Program's
AST checks passed with all eleven emitted class/function `export declare`
modifiers retained; only the ambient copy omits `declare`. See
[precise type/resolution evidence](remote-evidence/results/public-consumer-01/types-and-resolution.json),
[standalone evidence](remote-evidence/results/standalone-consumer-01/types-and-resolution.json),
and [result summary](execution-summary.json).

Custody passed before and after: all 943 source leaves, all 24,010 dependency
leaves from the four authorized roots, unchanged confined links/current modes,
and the complete new package. The source mode correction succeeded during the
single setup: regular files normalized to Git permissions, Linux symlinks
verified as 0777. The earlier mismatch remains a **pre-execution discovery**,
not a replayed runtime failure. Historical dependency mode equality is not
claimed. See [integrity result](remote-evidence/integrity-after-result.json),
[package inventory](remote-evidence/candidate-package-before.json), and retained
donor/private before/after manifests. Source, helper, config and payload hashes
remain identical to the admitted packet.

Workload SHA256 `244e55f26bb38bddf85727fdadbbf0b6857de17d575c950346ed161ba5303051`;
payload `59c174e0d9b137831d88fd348380ceb913c5a36303a41130e5fd963d11a54e61`;
source archive `90ef1b1325d927b38baa8f5b6a0e81bd0f26ce62089904a6164289ac422b8ebb`.
The owned 230-entry results archive was downloaded and hash-verified as
`2577e0bf72b794f401f2278a58425b1ff76db5678ef258b4b98318e31aef7768`.
[Collection receipt](collection-receipt.json) records its custody. The collector's
own final record is preserved in its transport output and
[derived terminal receipt](collection-terminal-from-transport.json).

The immutable actual016 evidence retains Root's established eleven TS1038
errors ([historical pointers](baseline-pointers.json)); the new scoped consumers
now pass declaration checking. No historical baseline was rerun. Coverage is
limited to these exact public/standalone consumers and helper closure; it makes
no API-wide declaration-clean or release/publication claim. The separate
API-import repair and review lanes were untouched. No native/Rust, M5, server,
installation, registry, publication or broader suite ran.

Source and inputs remain frozen; [phase.json](phase.json) marks
`writerReleased: true`. Root owns the next disposition.
