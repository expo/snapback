Prepared the narrow r2 harness derivative only. [regression-vs-r1.diff](regression-vs-r1.diff) replaces the unsupported Python 3.9 `kqueue` context manager with explicit creation and `try/finally queue.close()`. Registration, FIFO release, NOTE_EXIT observation and assertions retain their exact order. [path-bindings-vs-r1.diff](path-bindings-vs-r1.diff) records owned path substitutions and refreshed request hashes.

Parent and candidate helpers, runner and controlled child are byte-identical to r1. All six cases, 15-second case bounds, 100-second loop, release 30/90-second deadlines and 2-second cleanup remain unchanged. Original evidence pointers still identify r1/original017. [unchanged-inputs.json](unchanged-inputs.json) gives the exact correspondence; [input-manifest.json](input-manifest.json) freezes this packet.

The r1 failure remains preserved in [r1-failure.json](r1-failure.json) and seven exact snapshots. Root reported actual tool 97172 exit 1. First case PID 85724 actually exited 1 at `regression.py:97`, `AttributeError: __enter__`, before NOTE_EXIT; its controller actually reaped its harmless child with return 0. Five other cases were unrun. This establishes no helper behavior or review verdict. Original017 install actual exit remains unknown; no retry or retroactive qualification is claimed.

Static preparation passed the single regression AST parse and exact byte/JSON correspondence checks. No regression module was imported, no controlled child was spawned, and no regression was executed. There were no preparation errors. Existing r1 bytes, approval and execution remain unchanged.

Exact input hashes:

- Parent: `2c21f71603cef8d81f34456f5fda0268c81de2a15ba989af62e29f428967f45c`
- Candidate: `c10d60e9dc8617f73f0c8e343abb450a0e81e6bfc4f9b8e8df69a9eab813ae9f`
- r2 regression: `0c5ff342fd73cf88b26d858e0fb0f9dfa27d5c56fc04cb6fbb6801261c455fad`
- Runner: `15906044f28378e9efd6cea8ffd057534028c09d4fd5c43a084c23da7ba4abab`
- r1 approved manifest: `401f6c6a2e51aa51baf52e24649fa7f2cda79411722604a7f37893f2da4fd1c1`

After separate Root admission, the unchanged launcher shape is:

```sh
cd /Users/ccheever/clique-improvement/revisions/default-install-timeout-race-repair-r2
/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9 -I -B /Users/ccheever/clique-improvement/revisions/default-install-timeout-race-repair-r2/run-regressions.py --execute-root-approved
```

The [request](request.json), [workload](workload.json) and unchanged [execution prompt](regression-prompt.md) bind that future command. **Execution hold:** Root must admit the final exact packet with a new approval pinning its manifest; no execution approval was copied or created. No new review, npm, network, publication, native or benchmark work is included.

Writer released in `phase.json`. Current author UUID remains `01a07d78-1edd-76d1-8fe6-c68ba63decd1`; actual native/outer closure belongs to the launcher/supervisor after this turn returns.
