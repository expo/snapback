# Repository scripts

Use this directory through the entry points below. Most other files are gate
implementations owned by the canonical proof inventory and are not general
setup commands. Gate cadence and dependency selection come from
`local-proof-selection-policy.v1.json` (LLP 0175 D1/D2).

## Entry points

| Situation | Entry-point script |
|---|---|
| Refresh vendored LLP skills and agent links | `scripts/sync-agent-skills` |
| Prepare or diagnose the native runtime | `scripts/bootstrap-ibex-runtime`; read-only diagnosis: `scripts/ibex-doctor` |
| Run the canonical repository proof | `scripts/verify-local-proof` |
| Check guide-only changes quickly | `node scripts/check-guide.mjs` |
| Validate metadata-declared demos/tests/publication leaves | `node scripts/check-inventories.mjs` |
| Set up or reset a demo backend explicitly | `scripts/demo-setup <demo>` |
| Prove the All Aboard registry cold-clone path | `scripts/cold-clone-check.sh` |
| Inspect or run frozen-record drift gates | `node scripts/drift-prone-gates.mjs backstop [--gate ID]` |
| Report a complete-battery artifact without changing tickets | `node scripts/drift-prone-gates.mjs battery-report --results target/proof/local-proof-results.jsonl` |
| Project complete-battery root failures into durable tickets | `node scripts/drift-prone-gates.mjs battery --results target/proof/local-proof-results.jsonl --run-id ID` |
| Install, inspect, or remove the macOS drift schedule | `scripts/install-drift-backstop-schedule [--status\|--uninstall]` |
| Install, inspect, or remove the macOS complete-battery schedule | `scripts/install-local-proof-backstop-schedule [--status\|--uninstall]` |

## Gate internals

| Internal | Role in the proof |
|---|---|
| `local-proof-selection-policy.v1.json` + `select-local-proof.mjs` | Checked path-to-cadence map, prerequisite closure, and exact selection receipts |
| `lib/proof-runner.sh` + `check-local-proof-gates.mjs` | Stable gate IDs, dependency-aware execution, progress, JSONL results, and inventory validation |
| `check-generated-artifacts` | Regenerates codegen and checks committed review/projection drift |
| `check-generated-types` | Compiles generated declarations with the locked TypeScript install |
| `check-demo-surfaces` | Rejects destructive backend operations in demo UI source |
| `drift-prone-gates.mjs` | Runs the policy's frozen-record registry for pre-push or scheduled backstop use |
| Other `check-*`, `verify-*`, and test dispatchers | Canonical gate implementations; invoke directly only when a gate diagnostic names one |

## Verification

`scripts/verify-local-proof --affected REV` runs the fast/affected closure for
changes since `REV`; `--complete` runs the scheduled/on-demand inventory; and
`--gate ID` re-runs one gate plus its prerequisites. `--keep-going` or
`SNAPBACK_PROOF_KEEP_GOING=1` continues independent gates after a root failure.

Gate results are v2 JSONL at `target/proof/local-proof-results.jsonl`; complete
runs retain a normalized `failureSignature` on root `FAIL` records so the
battery projector can distinguish failures of the same gate. Set
`SNAPBACK_PROOF_RESULTS` to choose another path. Selection receipts are JSON
and can be reopened with `--selection-receipt FILE`.

GitHub's scheduled/on-demand workflow uses `battery-report` and never mutates
filesystem tickets in its throwaway checkout. The six-hour local
`com.snapback.local-proof-backstop` schedule runs the same complete inventory,
projects signature tickets, commits their open/closed/streak state, and pushes
that durable state to `main`.

Set `CHROME_BIN` for browser gates, `SNAPBACK_IBEX_CHECKOUT` to reuse a prepared
Ibex checkout, and `SNAPBACK_EXACT_ROOT` when an Exact source checkout is the
required authority. Run each shell entry point with `--help` before automation.
