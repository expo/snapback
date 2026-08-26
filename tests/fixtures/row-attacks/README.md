# Row attack fixtures

This directory is the checked-in successor to the executed audit at
`~/lanes/m16/target/audits/landed-row-recheck/`. Each `src/attacks/fNNN.rs`
file is one dependent-crate attack. Its single `// @attack` statement contains
the hostile composition, so a compile-time CLOSED observation counts only when
rustc places a primary diagnostic on that statement. Runtime refusal is
reported by the same expression as a machine-readable CLOSED observation.

`attacks.v1.json` is the row-state ledger. `expected: "OPEN"` means the hostile
composition is known to succeed; this is a matching, trustworthy result rather
than a red test. `expected: "CLOSED"` means the expression must refuse. Run the
standing corpus from the repository root:

```sh
node scripts/run-row-attacks.mjs
```

The runner is deliberately not wired into a blocking proof gate. It prints one
row per feature cell and distinguishes a CLOSED→OPEN regression/false claim
from an OPEN→CLOSED discovery caused by another lane.

The production-shaped cell disables dependency defaults and enables only
`snapback-engine/engine-owner`. That engine feature is mandatory: a literally
featureless `snapback-engine` fails inside `host_ops.rs` before a dependent
attack can compile. Here, “no features” therefore means no optional or
`test-support` features beyond the required production owner feature.

The additive cell enables `test-support` across auth, engine, kernel, sync, and
types to expose feature-unified dependent routes.

The `services-remainder-tests` cell enables exactly
`snapback-services/remainder-tests`, with every fixture dependency's defaults
disabled. This cell is distinct because Cargo feature unification can expose
services-only producers that neither production nor the five-crate additive
cell sees.

The `additive-services-remainder-tests` cell enables both feature sets. F313
also declares the invariant `kernel-push-fixture` mount in every cell so its
setup can construct the surviving confined fixture before the marked raw-SQL
expression; that mount is evidence plumbing, not part of the cell label.

`src/bin/negative_routes.rs` preserves the audit's fifteen carrier-route
probes (`Default`, `From`/`Into`, serde, and `builder()`). They are auxiliary
evidence, not substitutes for the nine producer attacks.

## Recorded before/after transition

The corpus first ran at merge-base `18bcaf3b2` with all nine semantic rows OPEN
in both feature cells and all fifteen carrier-only routes CLOSED in both cells.
After rebasing the same instrument onto `0be248038` (which contains the resolved
authority producer binding from `ac20e30a6`), eight rows moved OPEN to CLOSED in
both cells. F170 alone remained OPEN in both cells. Round 5 then bound both
engine registration producers to the target engine's admission graph, closing
the foreign-lease route in both cells. The widened F170 witness also executes
the second-handle kernel producer for the same integration-and-credential
effect, so F170 honestly remains OPEN in both cells pending the
resource-versus-handle work. F053 remains the deliberate OPEN negative control;
the carrier-only control is unchanged at fifteen of fifteen routes CLOSED in
each cell.
