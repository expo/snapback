# EA round 5 failure ledger

## Intentional detecting controls — ours, expected failures

- `negative-baseline.log` (exit 1): on the merged round-4 production source,
  both `browser transaction rejects backend replacement after synchronous
  capture` variants (wasm and Worker) failed to return E_ADMISSION_STORE;
  `FIFO wait behind identity I/O consumes the identity budget` left the second
  caller pending at 15 seconds. Both independent-generation tests passed,
  since generation forwarding already existed. Total: 2 pass, 3 fail.
- `negative-deadline.log` (exit 1): only the generated identity-wait module
  was replaced with transpiled merged round-4 source. Both FIFO deadline
  controls failed: the no-admission 15-second deadline and the remaining budget
  across two ordinary admissions separated by identity checks. Total: 0 pass,
  2 fail. The generated module was restored in a finally block.
- `mutant-expected_generation.log` (exit 1): removing only generation forwarding
  from both browser adapters fails both independent-generation transaction
  tests at the expected public-refusal assertion. Total: 0 pass, 2 fail.
- `mutant-expected_backend.log` (exit 1): removing only backend forwarding
  from both adapters fails both backend-adoption transaction tests at the
  expected public-refusal assertion. Total: 0 pass, 2 fail. Each adapter mutation
  was restored in a finally block before positive checks.

- `grok-negative-initial.log` and `grok-negative.log` (exit 1): the production
  nativeInstaller refreshes a restored backend with its missing server descriptor
  while IdentityWait is held at its final read. The descriptor-only case returns
  E_ADMISSION_STORE instead of admitting the original ID (ours, inherited from
  round 4). Schema/program replacement controls pass. Each run: 2 pass, 1 fail;
  the second uses a valid program-name change for the replacement control.
- `grok-mutant-backend-key.log` (exit 1): in an isolated module with native-only
  enrichment repaired, deleting the JS backend-comparison clause fails both
  schema/program replacement controls. Total: 1 pass, 2 fail. The temporary
  tests/modules never modify the running full suite's source or build inputs.

These are deliberate controls, not failures of the final implementation. Each
negative assertion checks an externally visible result, not source text.

## Development command corrections — ours

Two edit commands used a doubled `snapback4/` prefix while already in that
working directory. They failed before changing a file. The first attempted
focused invocation therefore selected no new tests; its result is not evidence.
The corrected baseline log was subsequently recorded with all five intended
cases. The extra mixed-queue test was likewise added after correcting its path,
then executed in `fixes-focused.log` (12/12).

The staged all-file whitespace check reported trailing diagnostic spacer lines
in Node's raw negative-control logs and a final blank line in the raw Cargo
guide log. This is ours (evidence formatting), not a product/test failure.
Those raw outputs are preserved verbatim. The source and authored-document
whitespace check passes with only the raw `.log` files excluded.

## Final checks

The one complete suite run passed, exit 0:
`== 0 failure(s) in 1232 s`. All 202 earlier affected tests, the 321-case
matrix, the 99-case guide, build, typecheck and reference check passed.
No full-run or positive-test failure is classified as ours, baseline or
environmental. Only the intentional negative controls above are red.
The final Grok comparator repair was applied after the full run; its final
positive checks pass: 83/83 final identity/online/ID tests (including all 48
identity cases), 321/321 delivery matrix, package build and typecheck. Results
are recorded in REPORT.md and their named logs.
