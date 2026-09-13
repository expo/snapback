# Snapback 4 security remediation — 2026-09-13

**Record author:** Codex (implementation and review synthesis; not an independent reviewer).
**Scope:** S01–S12 from the [original Grok review](./3000-security-review-20260913.md), plus findings introduced by the intervening native-device, web-device, search, services, and effects integrations.
**Related:** [LLP 3000 §7](../3000-snapback4.explainer.md#7-decisions-during-execution), [implementation journal](../../snapback4/JOURNAL.md).
**Implementation:** `7bd93d820` through `8d8c1b7c170183d6a54d7a37af8b34596410160d`, followed by the plain audience-index selection correction `90152c6f2`.

## Disposition

All twelve original tickets are closed with their individual resolution and
acceptance evidence linked from the original review. The HTTP host now admits
local development origins explicitly, defaults deployed HTTP to loopback,
authenticates the catalog and change feed, and bounds connections, deadlines,
password work, and uploads. Password hashing and upload disk writes run outside
the engine mutex. Hidden constraint conflicts have only the generic write
refusal. Catch-up does not replay deleted, expired, replaced, or currently
unreadable images. Private files use owner-only permissions, minted IDs use
cryptographic entropy, audience grants are checked, and asset views and media
dimensions are bounded.

These decisions are documented in LLP 3000 and the client/identity guide cards.
The ticket resolutions preserve the limits: TLS terminates at a proxy; generic
write refusal is not formal noninterference; delivered history refers to an
already held device copy; private logs are not securely erased; non-Unix private
storage fails closed pending owner ACL support; media checks inspect headers.

## Additional findings resolved during integration

- Unsupported HTTP versions could retain writer ownership while trying to send
  an error; refusal now precedes ownership. Interim 100 Continue and the final
  response have separate write budgets.
- Exhausted peers could fill the email limiter with fresh keys; denied peers no
  longer allocate new secondary keys.
- Authentication followed body buffering; protected uploads, operations,
  service routes, and deployed seed now refuse before reading an untrusted
  body. Error responses close without draining it.
- A grant probe could use a writable decoy table or bind viewer in the wrong
  recipient position. The validator now requires the actual audience table,
  plain index, matching group, and recipient. Created-group grants require the
  referenced primary key.
- A native watcher reacquired an engine lock it already held. It now reuses the
  guard; a live edit/watch probe passed.
- The unified web device could revert to predictable IDs after its initial
  supplied IDs. All device minting now uses the secure core path and Web Crypto.
- A failed browser persistence save could lose an already drained deletion.
  The web adapter retains and retries the exact pending batch before advancing
  the device or freeing it.
- Search dictionary discovery disclosed existence through completeness and
  scope-cap errors. It now establishes rule opacity and authorizes a uniform
  scope before discovering words.
- Whole-row index selectors could treat a words index's scalar projection as
  its physical key. Sync/audience, cap, expiry, rule probes, complete-group
  admission, and device leave walks now require plain indexes.
- Effects could be settled after lease expiry or by an earlier attempt sharing
  the same worker identity. Settlement requires a live lease and its attempt.
- A worker with multiple handlers could claim unrelated effects. The SDK sends
  its bounded handler list and the engine filters the atomic claim accordingly.

## Reviews actually received

The fresh, non-author Codex reviewer `/root/final_correctness_review` reviewed
successive integrated candidates read-only. Earlier findings above were fixed
by the implementation owner. Its final verdict at
`8d8c1b7c170183d6a54d7a37af8b34596410160d` was:

> No material finding remains in the reviewed security remediation and integration.

It confirmed all four search/worker findings from `a59a566da` were resolved.
One nonblocking omission selected a words index before a valid plain audience
group index and rejected an otherwise valid schema. `90152c6f2` corrects that
selector and adds the counterexample to the existing regression.

A separate Grok 4.6 xhigh CLI review received the source and fixes, with tools,
subagents, and web search disabled. Its completed follow-up at `734c069e1`
returned **No material finding remains** for six specific items: early body
authentication, Continue deadlines, first-open sidecar permissions, audience
grant shape, web ID entropy, and browser persistence, plus service admission.
The alleged sidecar creation window was rejected after inspecting the bundled
SQLite Unix VFS: WAL/journal and SHM creation inherit the database mode, and the
database is pre-created as 0600. This verdict did not cover the later four
search/worker findings.

Review outputs and exact prompt inputs are retained in the local run directory
`.llp/ship-runs/sb4-security-20260913/`. Planning-only CLI attempts were not
counted as reviews. One separate review session was stopped by automatic review
policy after reporting a valid finding; it supplied no clean verdict.

## Executed validation

At `8d8c1b7c170183d6a54d7a37af8b34596410160d`, an isolated Linux worktree ran:

- `cargo test --workspace --no-fail-fast --quiet`: PASS.
- `bash scripts/build-wasm.sh`: PASS.
- `bash scripts/test.sh`: PASS, **0 failures in 45 seconds**, including all
  **71 client tests**, the actual-server worker test, socket regressions,
  compiler/guide fixtures, and both device stores.
- `git diff --exit-code` after the checks: PASS.

The final affected regression
`cargo test -p snapback4-sim --test security words_indexes_cannot_select_sync_rows_caps_or_expiry --quiet`
passed at `90152c6f2`. Earlier candidates also passed complete Linux suites;
the final result above includes the newly integrated search and effects tests.
Local package build/typecheck and five real-wasm failed-persistence regressions
passed. No live DNS-rebinding browser, production TLS, Windows ACL, physical
phone, or production deployment qualification is claimed by this record.
