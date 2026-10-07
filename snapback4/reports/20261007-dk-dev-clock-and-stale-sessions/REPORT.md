# DK — dev clock and stale-session explanations

Date: 2026-10-07. Base: `46803201b499` (`origin/main` after the required fetch/merge).
Branch: `sb4-intent/dk-dev-clock-and-stale-sessions`.
Work stayed in the supplied lane on the local machine; no SSH, other worktree
edits, publication or push. The initial dependency command ran from the repo
root; rerunning Bun and the supplied checker from `snapback4/` printed `deps-ok`.

## Result

- Dev startup emits one `N_CLOCK_STORE_AHEAD` note when retained row stamps lead
  its clock by more than 5,000 ms. It names the largest lead, affected tables,
  a fresh store per offset test, and restarting with the same `--clock-offset`.
- `doctor` adds two clock lines: current offset from wall time and the same
  store-ahead fact (or an explicit quiet result). Persisted hosts are discovered;
  `--url` inspects disposable hosts. With no host, comparison is explicitly
  against wall time. The temporary-store inspection uses a detached reader.
- `clock advance` retains its single JSON output line and adds cumulative
  `offsetMs` and a `message` saying the offset lasts until restart. Existing data
  adds the isolated-test hint. A failed maintenance drain still reports its
  applied advance and offset; the CLI warns that time remains advanced.
- `guide jobs` gives the executable recipe: `dev --fresh --port 4401`, configure
  the suite's client URL as `http://127.0.0.1:4401`, `clock advance … --port 4401`,
  `doctor --url http://127.0.0.1:4401`, then stop that disposable server. The
  existing `--fresh` flag supplies a private temporary store, so no new flag
  was necessary. New stores require newly issued sessions.
- The SDK retains the server's terminal `E_AUTH` refusal across online/local
  cleanup, later calls, app custody fences and both app online variants. An
  internal WeakMap passes the explanation without exposing credentials or a
  new Client member. Ordinary signed-out clients still say “sign in”.

`check --store` deliberately remains a schema-adoption check. It has no running
clock selector; checking wall time there would warn during intentional offset
sessions. Startup and doctor have the context to make the comparison meaningful.

## Session reasons and public-server privacy

Dev distinguishes unknown-to-this-store tokens, expired tokens, and tokens
signed out, revoked or replaced by refresh. Unknown-token text names a replaced
store/another instance as a possibility and says to sign in again and discard
saved tokens from an earlier store. Expiry mentions the server/dev clock.

Session deletion normally destroys the distinction between unknown and retired.
After accepted dev opening, SQLite deletion triggers retain the latest 4,096
retired-token **digests and expiry deadlines**, including lazily created read
sessions. There are no plaintext tokens or principal identifiers in this history.
It survives dev restart, never grants authority and is not synced to a device.
Expiry takes precedence after the recorded deadline; evicted/pre-instrumentation
evidence can only be described as unknown. Failed diagnostic reads fall back to
the generic refusal without changing the authority decision.

Serve removes that diagnostic history/triggers after accepted opening and always
uses **“this session is not live; sign in again”** for these three causes. No cause,
store identity or token information is added to the response. Distinguishing issued
from unknown tokens would create an unnecessary token-membership oracle on a public
server. The existing `E_AUTH` code, `auth` family and `message` field suffice;
there is no new wire/type field. SDK declarations were regenerated and typechecked;
built/generated artifacts remain uncommitted per repository policy.

## Detection limits

The store scan uses retained minted row-ID times and declared time fields matching
recorded future commit times. Future appointment/expiry values alone do not trigger
it. It reads one SQLite snapshot, streams row images, and retains a set proportional
to future commit history. Imported arbitrary IDs/times without matching commits
can escape it; deliberately future-minted IDs meet its stated condition. The note
is evidence and repair advice, never a claim to repair or validate all timestamps.

No device interpreter, wasm engine, catalog format, runtime ceiling or wasm budget
was changed. A local wasm build was needed because the fresh checkout lacked the
SDK's generated artifact. The standard build measured **2,135,336 raw / 645,448 gzip
bytes**, below the inherited **645,607 B** cap by **159 B**. `wasm-budget.test.mjs`
passes. That inherited margin is below 500 B: no macOS margin is claimed or budget
raised by this server/SDK-only lane. The new identity module is gated behind the
core's SQLite feature and is absent from the web build.

## Verification

Passed:

- Required fetch/merge, workspace frozen Bun install, SDK dependency check (`deps-ok`).
- SDK build/declaration generation and full package typecheck.
- New SDK reason suite: **30 tests**; validated dev/serve wire fixtures across online, local,
  app-online and app-device arms; subsequent query/signal/action calls; ordinary
  signed-out controls; an actual bearer issued by another store; saved local startup.
- App online/local/arm regressions plus reason suite: **80 tests**.
- Session-security, publication/authority, read-only custody/rotation and wasm
  budget regressions: **67 tests**.
- Core identity unit tests: **6**; identity/read-session/bound-session integration
  tests: **17**. Dev history is bounded, digest-only and removed for serve.
- Server affected unit tests: **191 passed, 4 ignored**. New HTTP assertions cover
  full/read tokens, unknown/expired/revoked/refreshed causes, dev/serve wording,
  query/schema/change-poll/refresh doors and no-bearer controls.
- Clock, replay and dev-refusal integration files: **64 tests**. Covers actual
  startup output, normal persistent rows (including future appointments/expiry),
  future writes with both minted and fixed IDs, matching-offset restarts, doctor
  with/without a host, cumulative CLI/endpoint output and fresh-store isolation.
- Clock tolerance/maximum/table-list unit regression: **1 test**.
- Guide checks: **113 tests**; definition/recovery pins include the new note.
- Root `./ref-check`: **531 LLP documents, 10,538 refs, zero errors/unchecked**.
  (An initial invocation from `snapback4/` was invalid; rerun from the repo root.)

- Online/session/terminal/schema/transport regression files: **51 tests**.
- App session model: **52 tests**, including **5,000 online and 5,000 local**
  seeded three-runtime sequences at normal counts (about 246 seconds total).
- `git diff --check` passed.

The broad CLI unit suite is **not claimed green**. Its final source-stable run
with four test threads passed 329, ignored four and failed one untouched witness
test: `witness_orphan_reconciliation_requires_all_leases_and_preserves_changed_identity`
at `verbs/witness/publication.rs:542`, reporting `E_WITNESS_ARTIFACT: retention lock
busy`. That exact test passed in isolation immediately afterward. Earlier broad
runs encountered similar witness lease/retention races. One attempted serial run
was invalidated by recompiling its executable while subprocess tests were still
spawning `current_exe()`; its 16 missing-executable failures are not product evidence.
No witness/release/process-ownership implementation was changed and no baseline
comparison or full-suite-green claim is made. Affected-scope results above passed.

## Governing documents

Updated LLP 3000.007 §20.2 (refused-session custody/privacy) and §20.12 (clock
visibility/isolated tests), including its Revised line; the jobs, personas,
services and codes cards; published client/operations documentation; and JOURNAL.
LLP 3000.033 §1.3's refusal/opening and read-session authority guarantees remain
unchanged: diagnostics are installed only after backend opening succeeds.
