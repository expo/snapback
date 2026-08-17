# Auth-invalidation default lane — round 2 fix report

Date: 2026-08-16

## Outcome

All accepted Review 1 and Review 2 findings were implemented in the library-level default lane.

- The outbox persists distinct authority and queue generations. Enqueue, operation-identity preparation, foreground dispatch, replay, settlement, ACK collection, and discard are compare-and-commit fenced; transport and terminal local disposition share the root-installation dispatch order.
- Quarantine/error roots suspend late admissions and release them only after exact proof. Delete roots immediately redact existing and late-admitted replay/rerecord payloads into explicit discard-only tombstones.
- Authority transitions atomically advance an idempotently keyed authority generation, retire predecessor roots/tokens, and reconcile every predecessor record state before successor publication. Same-transition peer replay reuses one generation; older and interleaved transitions cannot overwrite newer custody.
- Reader contexts use exact-root/proof visibility, not a generic suspended bit. IndexedDB readers have a narrow authorization writer path; same-process file readers defer through the lock holder. Reader and writer transport/root work shares one dispatch gate, including transition and reconciliation work.
- Optimistic-create custody is hidden and suspended for quarantine/error, remains hidden through asynchronous proof rebase (including proof arriving while the view opens), and releases only after that rebase. Delete, denial, and authority replacement force-close it.
- The terminal-live-refusal classifier includes `SNAPBACK_EPHEMERAL_AUTHORITY_UNSUPPORTED` and `SNAPBACK_EPHEMERAL_EXPIRY_UNSUPPORTED`; its exhaustive JS test reads the authoritative Rust registry in `src/server/api_error.rs`.
- LLP 0043 records the 2026-08-16 author ruling and the two-generation, exact-dispatch, delete-redaction, ACK, and authority-transition obligations.

## Finding disposition

1. Review 1 / queue suspension across enqueue, foreground, replay, settlement, and discard: fixed with two-generation CAS fences, shared dispatch serialization, active-root refusal, late-enqueue suspension, exact terminal disposition, and immediate delete redaction. Foreground, late-enqueue, preparation, transport, settlement, ACK, and discard races are covered.
2. Review 1 / roots crossing authority transitions: fixed with atomic authority-generation advance in memory, IndexedDB, and file carriers; transition key/epoch idempotency; predecessor root/token retirement; and generation-bound custody reconciliation before successor observation.
3. Review 1 / optimistic-create quarantine destruction: fixed. Quarantine/error suspends; exact proof asynchronously rebases then releases; delete/denial/authority loss closes. Tests cover predecessor frames, immediate post-proof blanking, delayed view opening, and final rebased release.
4. Review 1 / incomplete terminal classifier and mirrored test: fixed with both ephemeral unsupported codes and registry-driven exhaustive coverage while instance-change/409/503/transport neighbors remain retryable.
5. Review 2 / non-writer root loss and no-ACK fault: fixed. Readers write through or defer to the writer, accept only the exact visible root/proof/retirement, blank without a store fault while deferred, and never ACK before exact shared persistence. Multi-context tests place the live query in the reader and the drain lock in the writer.
6. Review 2 minor / ineffective quarantine rematerialization lock: fixed with a non-empty predecessor `live_replace` and an assertion that the exact blank remains.

The independent follow-up loop also closed generation-CAS gaps in operation identity and discard, active-root ACK/discard collection, delete tombstone custody, queue-disabled and capability-degraded foreground dispatch, same-transition peer replay, file-reader dispatch ordering, post-dispatch authority reconciliation, and optimistic-create proof/open ordering.

No requested fix was rejected or materially deviated from.

## VERIFY (verbatim)

- snapback-client package.test.mjs
- authorization-invalidation
- outbox-* suites
- subscribe-retry
- rqs-store suites (memory/file/default)
- tsc fixtures
- snapback-react full suite incl. optimistic
- node --check on changed files

## Verification results

All requested checks passed.

```text
cd packages/snapback-client && SNAPBACK_CLIENT_RQS_DIR=<writable-temp> npm test
PASS — complete package pretest/test command, including package.test.mjs, authorization invalidation, every outbox/RQS suite, subscribe retry, and client TypeScript fixtures

cd packages/snapback-client && node authorization-invalidation.test.mjs
PASS — 6 tests

cd packages/snapback-client && node outbox-custody.test.mjs && node outbox-drain.test.mjs && node outbox-quarantine.test.mjs && node outbox-store.test.mjs
PASS — 17 + 20 + 4 + 77 tests

cd packages/snapback-client && node subscribe-retry.test.mjs
PASS — 3 tests; classifier exhausts the authoritative server registry

cd packages/snapback-client && node rqs-store.test.mjs && node rqs-store-file.test.mjs && node rqs-store-v3.test.mjs && node rqs-resume-memory.test.mjs
PASS — 16 + 19 + 9 + 20 tests across default IndexedDB, file, v3, and memory

cd packages/snapback-client && ../../node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler exact-reference-types.fixture.ts push-registry-types.fixture.ts auth-identity-types.fixture.ts app-client-types.fixture.ts
PASS — exit 0 (also included in full package test)

cd packages/snapback-react && npm test
PASS — complete package pretest/test command, including optimistic.test.mjs, optimistic-create.test.mjs, and React TypeScript fixtures

git diff --name-only -- '*.mjs' | while IFS= read -r changed_file; do node --check "$changed_file" || exit; done
PASS — exit 0 for every changed JavaScript module/test
```

Additional affected checks:

```text
cd packages/snapback-contract && node query-authorization.test.mjs
PASS — authorization-fence conformance, including side-effect-free retirement preview

cd packages/snapback-contract && ../../node_modules/.bin/tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler query-authorization.d.mts
PASS — runtime/declaration retirement-preview surface compiles

./ref-check --verbose
PASS — 275 LLP docs, 6344 refs in 13910 files, 0 errors, 0 unchecked

rustfmt --edition 2024 --check src/server/api_error.rs
PASS — exit 0

git diff --check
PASS — exit 0
```

## Review closure

Two independent reviewers iterated over the exact fix delta until their review
queues ran dry. The queue/custody reviewer returned `VERDICT: READY` after a
171-test focused pass plus a final 25-test auth/file/sender rerun, syntax checks,
and diff validation. The client/React surface reviewer found the final code and
tests dry after the two-phase authenticated-retirement correction and its
reader-tab regression, then identified one declaration-parity omission for the
new preview methods. That declaration was added and compiled; this report's
count and closure bookkeeping were also corrected before the final exact-diff
recheck.
