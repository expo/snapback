# FAST review dispositions

Initial review sessions observed a mutable workspace; their verdicts are not
claimed to bind the final cut. Both are preserved verbatim with provenance.

- Root full-receipt filtering: fixed; complete and FAIL_CLOSED_FULL select the broad workspace even with no Snapback 4 paths. Regression fixture added.
- Incomplete broad suite: fixed; fixture wrappers, chat check, chat/Expo typechecks and release guards included, alongside Rust/client pools.
- Bare workspace imports: fixed; resolving a dist export requires the client build. Unresolved workspace exports also conservatively rebuild it.
- Executable docs: fixed; product docs select compiled guide tests and the discovered markdown-consuming client pool, including readme-examples.
- Committed-mode mutation: fixed; newly dirty tracked or untracked paths invalidate completion. The guarantee is intra-run; semantic unchanged integration retains LLP 0232 reuse.
- Producer failure: fixed; dependent commands record BLOCKED; independent commands still run.
- CI tool prerequisites: fixed in the root workflow, including wasm target, lock-matched bindgen, twiggy, brotli and pinned Lean. Independent browser requirement declared.
- Required features, no-owned-runner fallback, diagnostics/inventory movement and wasm measurement: added explicit fixtures.
- Lean locks/toolchain and difftest source: broadened / short semantic oracle selected.
- Receipt custody: clarified; target is transient. CI uploads receipts; local reports archive them before target cleanup.
- Mixed fences / base / red verdict: clarified union, explicit triple-dot diff, operator base choice, scheduled oracle and originating range. The selector never automatically excuses reds.
- Selector-only changes must run product battery: declined. This known tooling owner runs selector and root integration fixtures plus independent reviews; the product battery does not test an omitted path mapping. This follows the user-directed affected-only workstream and retains fail-broad for unknown/shared inputs.
- Known-red count: raw log has 21 failing Rust tests in six targets plus the client failure, despite inherited prose saying 19. Tests and FAST report cite the raw log and explicitly disclose the discrepancy; historical qualification records are preserved.
- Generated check scope: the requested root generated-artifact checker does not own Snapback 4 outputs. Keep it as an explicitly named root check; selected product prerequisites rebuild CLI/wasm/client artifacts and guide tests exercise the emitter. No claim that the root checker owns Snapback 4 generation.
- Historical execution/timing: unestablished, not represented by selection fixtures. Common workstream rules forbid the full runs required for the requested paired full-suite comparison. Final report records this scope conflict and the replay outcomes.
