Prepared the Root-authorized r3 metadata correction only. Both closed reports, actual terminal identities and the closed-pair disposition were fully consumed before edits; [closed-review-consumption.json](closed-review-consumption.json) records their exact hashes. Astra's introduced finding controls: direct-child reaping does not prove closure of descendant log writers. Grok's observed single-child READY does not refute that condition. No re-triage or descendant execution occurred.

[helper-vs-r2.diff](helper-vs-r2.diff) removes `logComplete` entirely and adds two comments: `actualProcessWaitCompleted` describes only the directly owned Popen child; `logSha256` is a receipt-time snapshot. AST comparison confirms the only executable helper change is removal of that assignment. Waits, deadlines, signals, identity checks, argv, first-failure handling, unknown state and running-marker behavior are unchanged. [helper.diff](helper.diff) is the complete delta against the original, byte-identical parent.

[regression-vs-r2.diff](regression-vs-r2.diff) adds one common absence assertion for existing terminal/running records across the same six controls and removes the two old completeness checks. Timeout124/actual0,-9,null, direct-child wait/reap, no-signal identity, immutable receipt and group assertions remain. Python3.9 kqueue try/finally ordering is exact. Runner and controlled child remain byte-identical. Bounds remain six15s cases/100s loop, release30/90s and2s cleanup.

[Path/binding delta](path-bindings-vs-r2.diff), [request](request.json), [workload](workload.json) and [input correspondence](unchanged-inputs.json) bind the r3-owned future output. Earlier `*-vs-r1.diff` copies are unchanged historical r2 evidence. [r2-evidence.json](r2-evidence.json) pins the existing six-pass results, actual Root tool16623 exit0 and separate author closure; these are not r3 results. R1's `__enter__` failure and original017 evidence remain exact. Original017 install still timed out, its actual npm exit is unknown, and CI was unrun.

Static AST/JSON/byte checks passed. The initial combined review read truncated Grok output; its complete report was read separately before edits, with that narrow preparation error retained. No helper/regression import or execution, controlled child, npm, network, build or publication occurred.

**Execution hold:** Root must read/admit the exact frozen [manifest](input-manifest.json) before a separately approved six-case run. The existing [execution prompt](regression-prompt.md) and workload provide the unchanged finite launcher shape; no approval or execution output was created here.

Final source hashes:

- Parent: `2c21f71603cef8d81f34456f5fda0268c81de2a15ba989af62e29f428967f45c`
- Candidate: `b66c1e0e7eddb99d6a17a3902a0d3fb116f35618c47068d16b8d97a87438fa0a`
- Regression: `8e0d1d9b430924eb3b08e48ede643d3ba47e98ff2db489914b4818220061fb6a`
- Runner: `15906044f28378e9efd6cea8ffd057534028c09d4fd5c43a084c23da7ba4abab`

Writer released in `phase.json`, which pins the final manifest/report. The same Astra/xhigh author UUID is recorded separately from closed reviewers. Actual native/outer closure belongs to the launcher/supervisor after this turn returns.
