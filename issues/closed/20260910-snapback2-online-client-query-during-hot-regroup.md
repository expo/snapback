# snapback2: an online client's query during a hot maintain regroup refuses `E_OFFLINE_STATE`

**Filed:** 2026-09-10 (lane `succ`, LLP 1020 A3/A8.2)
**Area:** `snapback2/packages/snapback2/src` (the twin's delivery commit), not the owner

## Observation

Under load (compiler gates and owner tests running beside the package test), a
client that stayed **online** while the owner installed a regrouping successor
(`maintain counts: by sender → by recipient`, `packages/snapback2/tests/real-owner-successor.test.ts`,
"positional reads compile after a regroup …") answered its next
`client.query(api.ops.count, { who })` with:

```
{"state":"refused","code":"E_OFFLINE_STATE","family":"offline",
 "message":"E_SCHEMA: missing index components counts.bySender",
 "guide":"offline","site":"client.query.commit",
 "rewrite":"retry this local operation; preserve queued writes and inspect the reported state error if it repeats"}
```

The same test passes when run alone (2/2), and deterministically once the client
goes `offline()` before the install and `online()` after it (LLP 1012's reset
path), which is what the test now does.

## Why it matters

LLP 1012 revision (h) says a delivery under another generation or schema "is not
held and supersedes the coverage, so offline reads are `hydrating` until the next
resume's reset". Here the twin instead tried to commit the new generation's
answer against the held predecessor schema (whose `counts` index is `bySender`)
and refused the read. A builder's app that is open during a day-two regroup sees
a refusal rather than a hydrating read.

## To reproduce

Remove the `client.offline()` line the test now carries and run the package
test file beside `scripts/test.sh`'s Rust half; the refusal appears within a few
runs. A deterministic reproduction needs a hook between the successor
installation and the client's next live frame.

## 2026-09-10 (orchestrator, landing `succ`)

The `offline()` → install → `online()` form races too: on the EPYC verification host
the same test refused 2 of 4 runs with `E_SCHEMA: missing index components counts.byId`
thrown from the twin's `applyCoverage → setRow` during `client.online()` — the resume
applied the successor's delivery against the held predecessor schema before the reset
dropped it. The test now opens a fresh client after the install and no longer claims the
reset path; both the online and the resume forms are this ticket's to prove, with a hook
between the installation and the next live frame or resume.

## Disposition — 2026-09-11

**Priority:** P1. **State:** keep open; not reproduced in the bounded current-main
run. On `15c134d056`, an actual owner plus the same durable file-carrier client
was held across `by sender` → `by recipient`. Three online and three resume
attempts all returned correct successor answers (`alice=0`, `bob=1`) without
`E_OFFLINE_STATE`/`E_SCHEMA`. A mounted observer converged to complete,
server-sourced, live zero. Wrapper PID 3271477; real Node file carrier. A
32-thread-load control also did not reproduce. One resume observer remained
twin/stale at the three-second edge although its one-shot query was correct;
that is not the reported refusal and is not closure.

Repeat with the existing test while retaining the original `client` and `bob`
store across `install(...)`: mount `subscribe(client, api.ops.count,
{who:"dev:alice"}, observer)` before installation, and for resume call
`offline()` before and `online()` after installation. Do not execute the
`client.close()`/`bob-after` replacement block. Then run:

```sh
cd snapback2
node --test --test-name-pattern="positional reads compile after a regroup" \
  packages/snapback2/tests/real-owner-successor.test.ts
```

Closure needs a deterministic barrier between installation and both the next
live frame and resume commit, with predecessor-schema, superseded/hydrating,
and correct successor-answer controls.

## Resolved — 2026-09-10

The retained-client form is restored in
`packages/snapback2/tests/real-owner-successor.test.ts`. Its transport witness
holds real owner responses after the owner has produced them and before the
client consumes them, without pausing or changing owner behavior:

- the online client has a mounted predecessor subscription while the next
  successor live frame and its one-shot successor query answer are held;
- the query returns the correct successor zero, while the mismatched envelope
  marks predecessor coverage superseded instead of entering its old `bySender`
  index;
- the public offline projection is `hydrating` while the owner's
  `E_OFFLINE_RESET` response is held, then the mounted subscription converges
  to the successor's complete zero;
- a second retained client goes offline before installation. Its predecessor
  resume is held at `E_OFFLINE_RESET`, and its fresh mounted successor answer
  is held while the program has advanced but coverage is still atomically
  superseded/hydrating. Releasing it completes resume and returns the correct
  successor answers (`alice=0`, `bob=1`).

Both paths assert that no `E_SCHEMA` or `E_OFFLINE_STATE` terminal reaches the
mounted observer. The barrier is implemented only in the private package-test
entry; no production API or fallback was added.

The complete successor-file run made the old failure deterministic once more:
`E_SCHEMA: missing index components counts.byId`. The remaining production
race was `/api/program` adoption committing the successor schema before the
following coverage reset, which briefly asked `CarrierIndex` to index
predecessor maintained rows under the successor grouping. `OfflineRuntime.program`
now persists the new program, bounds, schema, predecessor-coverage withdrawal,
and durable successor marker in one carrier swap. It deliberately retains the
predecessor facts for the next `/api/resume`, so the owner still supplies the
protocol's `E_OFFLINE_RESET`; that response advances facts and the bounded
rebuild installs fresh successor coverage. Outbox and delivery custody retain
the existing reset semantics (LLP 1012 §8 coverage-reset amendment).

The file and IndexedDB tests named `successor program custody withdraws
predecessor coverage in the same swap` inspect that exact atomic swap and its
predecessor-request/successor-marker split.

Focused verification:

```sh
cd snapback2
npm run build
node --test --test-timeout=120000 \
  --test-name-pattern='positional reads compile after a regroup' \
  packages/snapback2/tests/real-owner-successor.test.ts
```

Result: 1 passed, 0 failed, including online/live and offline/resume barriers.
The two carrier-level atomic-swap regressions also pass.
