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


Round 2 reviewed frozen commit 952e6f3f85. Muse returned READY. Fresh Codex
returned NOT READY: a pool-wide producer edge could suppress independent
client files when a wasm producer failed. Fixed by recording dependencies per
file, filtering blocked consumers at execution, and running the runnable
subset through the unchanged existing process-custody runner. A partially
blocked pool can never claim PASS, even if its runnable files pass. Explicit
mixed-pool fixtures verify CLI-only/product-free files run after wasm failure,
while the wasm consumer is reported BLOCKED and later independent steps run.
Fixture-wrapper files are now discovered and receive the same per-file
custody; historical snapshots include their source directory. Client source
movement also conservatively selects diagnostics/inventory checks.


Round 3 reviewed frozen commit bb5649e4b5. Muse returned READY. Fresh Codex
confirmed the per-file pool fix, then found documentation-shaped shared
fixtures could bypass broad ownership and the CI setup step could fail-fast
before verification. Fixed: explicit shared-input classification precedes
restricted documentation owners (including unknown Markdown paths); added
fixtures. CI now guards each independent setup attempt, continues verification
through continue-on-error, and retains a failed setup as a failing final job
step. An invariant fixture checks that setup failures remain guarded and the
retained verdict follows verification. Unresolved/computed imports now also
conservatively require rebuilding client dist, with a dedicated fixture.
The coordinator explicitly pre-approved extra review rounds, so a fourth
frozen review follows these two bounded corrections.


Round 4 reviewed the frozen e98f65af52 delta and full selector/workflow/amendment
context. Both fresh Codex and Muse returned READY. Codex requested only a
nonblocking wording clarification: keep-going provisioning is scoped to
independent setup commands inside the Snapback 4 preparation step, not every
legacy workflow step. Applied that clarification without changing behavior.
These static reviews do not establish deferred historical execution or paired
runtime evidence. Final receipt/evidence custody is in the external FAST report.
