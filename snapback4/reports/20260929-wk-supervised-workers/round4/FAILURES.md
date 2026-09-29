# WK round 4 failure ledger

## Required full suite

Exact summary: `== 2 failure(s) in 1358 s`, exit 1. Failed stages: `cargo test`
and `client tests`. Cargo lifecycle: 20 passed / 1 failed. Client: 4,820 tests,
4,792 passed, 18 failed, 10 skipped, 0 cancelled. Final client models: 79/79 pass.
Every other stage passed. Full evidence: test-sh.log.gz; no full rerun.

Every full-run failure is listed below and classified **ours**, inherited from
our round-3 snapshot change. No baseline or environmental test failure is
assigned. Snapshot module URLs now address a private copy; fixture output paths
were corrected to the owned project/output directory, with assertions and
timeouts preserved. The runtime repair copies checked project imports through
pinned directory descriptors, refusing linked source. It reuses the checker's
existing graph. All final scoped checks pass.

| Test | Classification and cause | Passing repair evidence |
| --- | --- | --- |
| `a_signal_still_cleans_up_the_application_worker` | **Ours**, round-3 private snapshot moved fixture readiness/cleanup files addressed by module URL. | lifecycle-final.log.gz: 1/1 (dev and serve) |
| HMAC sees exact non-UTF8 bytes; unsigned/wrong duplicates cannot admit or collect before or after success | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| verifier exceptions and non-boolean results remain unavailable without durable admission | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| canonical fixture payment: signed duplicates, out-of-order revisions and durable backlog acknowledgements | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| a pending 503 is followed by a same-body retry collecting the settled response once | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| an explicit 5xx Response retries the same invocation without duplicating its mutation | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| actual worker crashes replay a completed step or reconcile uncertain provider acceptance | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| bounded invalid responses are terminal; only application GiveUp acknowledges, never infrastructure or ParkStep | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| session routes isolate identical bodies by principal and admitting session family | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| logout while a session route waits revokes its context before any later write or response | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| disconnect after admission does not undo route work or force a new invocation | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| actual non-loopback peers reach declared routes, but not dev personas or old worker/core doors | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| raw body and header bounds refuse before verification or private work admission | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| 32 idle actions and 129 service routes still verify and complete the last route | **Ours**, round-3 snapshot moved route readiness/observation files addressed by module URL. | routes-server-fixed.log.gz: all 13 routes pass |
| dev watches checked imports and configs outside snapback and keeps the last good worker through failed checks | **Ours**, round-3 automatic snapshot omitted checked src/provider.ts, so the generated server could not start. | server-qualified.log.gz: 9/9; affected-final.log.gz includes 2 new import-custody cases |
| scheduled generated action runs under its declared service seat | **Ours**, round-3 snapshot moved server observation files addressed by module URL. | server-qualified.log.gz: 9/9 |
| cancellation and admitting-session revocation abort an in-flight context before later writes | **Ours**, round-3 snapshot moved server observation files addressed by module URL. | server-qualified.log.gz: 9/9 |
| actual worker crashes distinguish the pre-provider cut, reconcile only authoritative missing, replay completed steps and preserve old modes | **Ours**, round-3 snapshot moved server observation files addressed by module URL. | server-qualified.log.gz: 9/9 |
| parked action operator disposition records known provider acceptance without resuming original work | **Ours**, round-3 snapshot moved server observation files addressed by module URL. | server-qualified.log.gz: 9/9 |

## Expected detecting controls — ours, inherited lane defects

`red-controls.log.gz`: 4 pass / 7 fail on the round-3 implementation:

- `two processes retain a completed receipt across a real busy COMMIT`:
  completed transaction rolled back on SQLite's actual busy result.
- `serve private worker snapshot resolves schema-local packages`: module absent.
- `serve private worker snapshot resolves schema-local packages before project packages`:
  loaded the project value instead of the schema value.
- `dev credentialed worker receives only the explicit runtime environment` and
  its `serve` counterpart: the parent preload marker executed.
- `dev ledger initialization stops the child and doctor reports ledger-unavailable`
  and its `serve` counterpart: doctor never reached that state; child stayed alive.

`fixed-controls.log.gz` passes all 11 corresponding tests. This initial control
includes the two dev package controls, FULL-setting check and abort-waiter check
that already passed on the old implementation.

`commit-before-final.log.gz`: both ordinary and post-provider cancellation
variants fail on an unmodified round-3 ledger copied into /tmp. Traces show A
performs, COMMIT is busy, A reports storage failure, B performs and commits.
`commit-fixed.log.gz`: both repaired variants and the abort-waiter control pass,
with one action, two original receipts and replay after both processes exit.

`mutant-full.log.gz`: removing only `PRAGMA synchronous = FULL` fails the actual
connection durability assertion (0 instead of 2).
`mutant-abort.log.gz`: removing only the run-path `signal.throwIfAborted()` fails
because the cancelled waiter executes its handler after lock release.
`mutant-rotation.log.gz`: removing the failed-retirement revision CAS fails
`serve_rotation_fences_a_valid_credential_while_retirement_is_locked`.
The Rust source was restored in a finally block; `rotation-final.log.gz` passes
both named and conventional paths. JS controls used disposable TS copies only.

## Test-authoring and command setup errors — ours

- `commit-before.log.gz`: ordinary case correctly reproduced two actions; the
  first cancellation variant instead sent IPC after the old child had exited,
  causing ERR_IPC_CHANNEL_CLOSED and a handled-rejection warning. Added a send
  callback and gated B's provider return until the read unlock. Both final
  controls fail for the intended ledger reason in commit-before-final.log.gz.
- Three edit attempts used a repository-relative path from the snapback4 working
  directory and raised FileNotFoundError; none changed a file. The first was an
  unnecessary rotation-test split (the unchanged test covers both paths); the
  second left the lifecycle fixture unchanged for the ensuing targeted run,
  which reproduced its original failure in lifecycle-fixed.log.gz. The actual
  repair passed in lifecycle-final.log.gz. The third was a documentation edit,
  subsequently applied successfully and checked by the whole guide.
- `build-imports.log.gz`: a cargo build ran from the repository root instead of
  snapback4 and failed on Snapback 1's uninitialized Ibex dependency. **Ours,
  wrong working directory**, not an environmental Snapback 4 failure. The
  corrected build-imports-fixed.log.gz and build-final.log.gz pass.
- `routes-server-fixed.log.gz`: all 13 repaired routes passed, but an overbroad
  fixture edit changed the test module's own URL-to-path expression, causing
  ERR_INVALID_URL before server tests loaded. Restored that expression; the
  entire server file passes 9/9 in server-qualified.log.gz. This is an **ours**
  test-authoring failure, separate from the original full-suite failures.
- `snapshot-unit-final.log.gz`: a filter named worker_declarations selected zero
  tests (208 filtered). Exit 0 is not counted as test qualification; the real
  process affected tests and server-watch case cover the new helper.
- `docs-budget.log.gz` records an incorrect script name, check-docs-budget.mjs,
  and MODULE_NOT_FOUND. The real scripts/docs-budget.mjs passed in the required
  full run. No product or budget change was needed.
- Some read-only file searches and a multi-file tail used nonexistent paths or
  an invalid tail option. Corrected reads supplied the evidence; these were not
  product-check failures.

The final five-file affected set passes 114/114; the whole guide passes 98/98.
peer-fence-before.log.gz detects the missing peer fence on the saved round-3
binary (1 expected failure). The single full run's 1,358 seconds misses the
standing 60-second target, an inherited baseline budget miss. No timeout or
ceiling was raised. No unexpected environmental failure is assigned.

## Preserved review formatting — baseline artifact

The staged whitespace check flags the original Astra review's two-space
Markdown line break at review-astra.md:17. The review is retained byte for
byte to match its recorded hash; no product or authored-text whitespace error
was reported. The committed-diff check excluding that verbatim review passes.
