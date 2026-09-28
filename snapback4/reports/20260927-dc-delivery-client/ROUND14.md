# DC round 14 — retain delivery manifests through facade refusal

2026-09-28, `sb4-intent/dc-delivery-client`. Fetched and merged `origin/main`
first in `5eac262f2`. The only conflicts were two journal hunks; both sides
are retained. Both parent journals remain ordered subsequences of the merged
journal (`round14/merge-audit.json`). Read the prior lane prompts, reports,
DC journal entries and Astra's complete round-13 review. Grok had no verdict
at startup or the subsequent check; did not wait for it.

## Findings and files

Paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `packages/snapback4/src/read-approval.ts` | Medium: refusal preserves the pending manifest associated with the raw answer. A later, newly checked peer can approve and collect that same identity. All shared approval generation increments and older-check fences remain unchanged. |
| `packages/snapback4/src/delivery-acceptance.ts` | Removes the now-unused internal `discardDelivery` function. Existing identity, expiry, incarnation and current-answer checks, including the predicate passed through conditional persistence, are unchanged. |
| `packages/snapback4/test/delivery-approval.test.mjs` | Five new cases: recovery after real session-store failure on online and wasm local fallback, refusal after recovery on both tiers, and the delayed local collection identity fence. |
| `packages/snapback4/test/helpers/delivery-app-fixture.mjs` | Optional test hook holds a collection before calling the real wasm conditional commit, outside the device chain so another read can complete. The actual client, shared approval, queue, CAS and persistence still execute. |
| `reports/20260927-dc-delivery-client/ROUND14.md`, `round14/`, `JOURNAL.md` | This report, durable qualification and negative-control evidence, and one appended journal entry. |

Refusal ends an authority check, not the lifetime of the raw answer's pending
manifest. A newly checked peer may approve it later. A superseded, withdrawn,
expired or obsolete-incarnation candidate still cannot collect because the
existing current/identity predicate rejects it, at approval and at every
conditional write. The pending map remains weakly keyed by answer identity;
successful approval consumes its callback once. No alternate approval machine,
queue policy, public API, wire field, dependency, version or meter change.

No new Quarry form. Existing facade calls continue to work:

```ts
const first = app.client.observe(api.fallback, {});
// After a temporary session-store failure is repaired, keep first open:
const peer = app.client.observe(api.fallback, {});
```

Both facades can now expose the original approved answer 41 after just one
raw query, collecting its original manifest once. Its report still carries
`args: {conversation: "c", from: 41, through: 41}`, the binding fingerprint
and store identity. A peer whose new check refuses leaves both facades denied,
with no collection, persisted debt or report.

## Regression discrimination

The recovery cases fail on the merged round-13 implementation: both facades
show 41, but the bounded assertion waiting for its report times out. The
other three new cases pass there. Removing the refusal-time deletion makes
all 29 facade cases pass, including the 24 round-13 cases.

Each recovery case keeps the first facade open, fails actual session-store
reads at raw publication, observes `E_CLIENT`, restores storage, then opens
a peer. Both the original refusal and the pending new authority check stay
silent past the delivery debounce. A new successful check exposes the same
raw identity to both facades, collects exactly once and reports exactly 41;
the local case also verifies persisted reported coverage. A new false check
leaves that identity never approved and therefore never collected or reported.
All four cases assert exactly one raw query.

The Low witness holds collection after 41 is approved, before its conditional
commit. A background answer replaces its raw identity with 43 while the same
watch, credentials, client incarnation and reset version remain. Releasing
the old write leaves no persisted debt or report. Only after approving 43
does its own manifest commit and report. This exercises the real wasm host,
not a stub that decides whether a write should be allowed.

`round14/mutate.mjs` uses in-memory module-load hooks; source and built files
are never edited by the negative controls:

| Control | Result |
| --- | --- |
| Exact reviewer mutation `collect(valid)` → `collect(current)` | The new delayed-commit case fails at `superseded 41 writes no debt`; actual persisted state contains reported `[41,41]`. |
| Collect at raw acceptance, bypassing guarded deferral | Both new never-approved cases fail the no-collection assertion. |
| Original round-13 runtime, before the fix | Both recovery cases fail at `recovered manifest report`. |

These failures are **ours, expected negative controls**: two pre-fix failures,
one delayed-identity mutation failure and two early-acceptance mutation failures.
There were no accidental fixture, build or final qualification failures.

## Qualification

Node 24.13.1 / Bun 1.3.14 through existing worktree-local links; Rust 1.97.0,
eight Cargo jobs, incremental and dev/test debug information disabled, fd limit
65,536. Frozen Bun install changed no dependencies. Built the package and
rebuilt the CLI to include merged main before the combined affected run.
No tool installation, push or publication.

| Check | Result |
| --- | --- |
| Delivery, queue, refusal, CAS, activation, presence, browser, prediction routing and source census | 435 passed, zero failed/skipped |
| Facade delivery approval, standalone | 29 passed, zero failed/skipped |
| Approval lifecycle/model/oracle, `SNAPBACK4_APPROVAL_MODEL_SEEDS=240` | 874 passed, zero failed/skipped |
| React and keep-authority React | 51 passed, zero failed/skipped |
| Whole guide | 92 passed, zero failed/ignored |
| Package build/typecheck, CLI build, whitespace and changed-source caps | Pass |
| Root reference audit | 521 LLPs, 9,744 references, zero errors/unchecked |

The combined run includes all five new tests and ordinary unguarded acceptance,
device publication, CAS, crash/outbox and Chromium transaction witnesses.
It uses `--test-concurrency=1`; no test assertions, deadlines or thresholds
were changed. Logs retain the existing unused-trait Cargo warning and React
act warnings; neither caused a test failure. No environmental failures were
observed in this round.

Wasm was remeasured, not rebuilt: **2,019,815 B raw / 585,193 B gzip**, SHA-256
`fcb6e9a265f5c317efc6592eadd81cc439b9cf3a0d7310b2ebf6ef7de9286dd1`.
It is byte-identical to round 13. Core/device/Cargo inputs are unchanged from
that round, and this fix changes client TypeScript and tests only. Gzip uses
the build script's named-file `gzip -9 -c` convention. The unchanged budget
is **586,193 B**, leaving **1,000 B**. Runtime meters are unchanged.

**Did not run `scripts/test.sh`**, as instructed; the supervisor owns the
round-13 landing suite. No new full-suite result is claimed. The earlier
completed round-13 result remains historical, exit 1:

```text
== 1 failure(s) in 1707 s
   client tests
```

That failure is **baseline**, confirmed by Astra: the process receipts/history
test's post-leave `sync()` can join a sync begun before leave. The controlled
reproduction and issue remain in round 13 and
`issues/20260927-snapback4-ordinary-history-sync-join-race.md` at repository
root. This round neither reruns that full suite nor changes that raw-sync path.

## Context, scope and reproduction

Scoped `llp-orient` used the existing
`/home/ccheever/sb4-intent/lane-a5/vendor/llp/skills/llp-orient/SKILL.md`
because this worktree's link is uninitialized. Governing documents are LLP
3000 section 4 (fence/budgets), LLP 3000.022 sections 3–4 (collection,
acceptance and conditional persistence) and LLP 3000.023 sections 3.4/3.6
(deadlines and shared approval), in the Snapback 4 current working set.
Read the corresponding receipts and client-operations guidance. The explicit
round-14 ruling clarifies that a refusal must not prevent a later valid
approval of the same answer. No new design decision or design document;
hand-off: none.

No deviation from the brief or new open product problem. The existing
unsupported-host limit remains: a custom/process/Expo host without
`deliveryCommit` omits supplementary fallback-manifest debt. Reproduce with
the existing CAS test matching `without conditional commit`; ordinary device
publication still persists debt with its rows. Existing baseline fixture
races from earlier reports are not claimed fixed by these passing checks.
No new native/browser-crash or comparative-performance claim.

From `snapback4/`, with the pinned tools on PATH:

```sh
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
cargo build -p snapback4
node --test --test-concurrency=1 packages/snapback4/test/delivery*.test.mjs packages/snapback4/test/presence*.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/wasm-codec-census.test.mjs
SNAPBACK4_APPROVAL_MODEL_SEEDS=240 node --test packages/snapback4/test/approval-*.test.mjs
node --test packages/snapback4/test/react.test.mjs packages/snapback4/test/keep-authority-react.test.mjs
cargo test -p snapback4-lang --test guide
(cd .. && ./ref-check --verbose)
DELIVERY_MUTATION=identity node --import ./reports/20260927-dc-delivery-client/round14/mutate.mjs --test --test-name-pattern='delayed collection commit' packages/snapback4/test/delivery-approval.test.mjs
DELIVERY_MUTATION=early node --import ./reports/20260927-dc-delivery-client/round14/mutate.mjs --test --test-name-pattern='new peer can refuse' packages/snapback4/test/delivery-approval.test.mjs
```

The final two commands intentionally fail. Raw logs remain under
`target/lane-dc-round14/`; durable compressed logs, measurements, source hashes
and verification totals are in `round14/` beside this report.
