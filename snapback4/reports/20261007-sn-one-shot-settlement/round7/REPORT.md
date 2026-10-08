# SN round 7 — canonical worker paths in assertions

Base: `5e3b114e8d`; work stayed on eb1000. Test-only correction; no production,
SDK, compiler, device, or settlement-contract changes. No push.

## Change and path audit

The failed-admission retry test now constructs its expected worker filename with
`join(realpathSync(f.dir), 'snapback/workers/push.mjs')`. It retains the exact
worker filename, wrapper filename, rejected `v23.0.0`, and retry-marker checks,
followed by the original repair, successful worker start, and unchanged schema
adoption count. No assertion or timeout was removed or relaxed.

The two paths intentionally have different forms. Development locates the
project from `std::env::current_dir()` (`main.rs`), then declared workers join
that root (`worker_declarations.rs`). The physical root therefore appears in
the diagnostic. `project::node()` constructs a `PathBuf` directly from
`SNAPBACK_NODE`; `DevWorker::start_source` prints it without canonicalizing it.
The wrapper expectation must keep the supplied spelling on both Linux and
macOS. LLP 3000.009 §5.3 and the effects guide retain the existing worker
supervision and repair contract; no governing design change is needed.

Audited all 13 test/tool files changed in round 6 ([candidate inventory](path-audit.txt)).
One other assertion compared a canonical product path with raw `f.dir`: the
fresh-store ledger exclusion. Its expected `.snapback4` prefix now also uses
`realpathSync(f.dir)`, preventing the negative comparison from passing merely
because the spellings differ. The namespace uniqueness and all other checks
remain. Existing worker cwd, project-dir, module, and snapshot comparisons
already use `realpathSync`. The other inspected paths are filesystem inputs
or HTTP routes, not comparisons against canonicalized product output.

## Reproduction and validation

A Linux `TMPDIR` symlink reproduces the macOS distinction without a macOS host.
Before the edit, the original case failed its unchanged 122,000 ms guard. Its
diagnostic named `…/real/…/snapback/workers/push.mjs` and
`…/alias/…/node-wrapper`, while the assertion expected `…/alias/…` for both.
[Failed control](symlink-before.log.gz), [owned path layout](path-control.txt).

- Normal temporary directory: **77/77 pass**, zero skips or failures
  ([log](worker-regressions.log.gz)).
- Symlinked temporary directory: **77/77 pass**, zero skips or failures
  ([log](worker-regressions-symlink.log.gz)). This includes the unchanged exact
  wrapper-path check and all ledger, runtime-path, repair and adoption controls.
- `./ref-check`: **531 LLP documents, 10,587 references; zero errors or unchecked**
  ([log](ref-check.log.gz)). `git diff --check` also passes.
The user's Apartment mini results for the six other round-6 files are supplied
evidence; this round does not claim a new macOS execution.

[Commands](commands.txt). Logs retain the failed control separately from the
passing qualification.
