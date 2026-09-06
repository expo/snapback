# Drain owner regression correction — blind review

**Verdict:** READY

**Candidate:** `df68f3cf9e1edbc6f6a490884b8469b28e8aab78`  
**Base:** `d5e1664496b7a1a2f8272dc136cddbea1c458046`  
**Delta:** `revision.patch` (SHA-256 `e1271a938fd8fdf88c447caba728ce5d1569357a8e403c80accf8e8b273f6e78`)  
**Scope:** three files only — owner resume test assertions, offline guide wording, canonical `test.sh` registration.

This is a test/docs/script correction against an unchanged owner producer. Product source, locks, compiler, and evaluator are untouched. No blocking findings.

---

## Limits (explicit)

- Blind source review of this frozen snapshot only. No peer or author review narratives were read.
- Source was not modified. Remotes, network, moving worktrees, unrelated LLP panels, and other reviews were not read.
- No subagents, no heavyweight builds, no broad test retries, no new server, no fabricated runtime execution.
- `factual-checks/` are author command/source receipts, not independent execution. They are cited only as receipts and checked for internal consistency with the source.
- Independent work in this review: reading owner producer/serializer and the three-file delta; hashing files, symlink payloads, and git trees; counting guide bytes; checking `test.sh` membership and timeout; checking LLP 1006/1012 and the later 52-note exercise.
- Original 10s client / real-owner internal deadlines were not changed by this delta. No independent owner or client process was launched.
- Full combined release qualification was not asked and was not performed.
- Source contains a known out-of-scope successor ordering issue under separate repair. It was not cleared and not reviewed anew.
- Author `sourceManifestSha256` `67963594e9bf71925deb5c522d5a09f8f26c45b1f2d35c4eca2cd858ca190cdf` is a receipt from another worktree encoding; it was not reproduced here. This snapshot's hash manifest was recomputed independently (932 leaves, 0 mismatches vs `snapshot-before.json`, symlink payloads included). See `review-evidence/source-hash-manifest.json`.

---

## Correspondence (independent)

`revision.patch` names exactly three paths:

1. `snapback2/crates/snapback2/tests/owner_cases/offline_resume.rs`
2. `snapback2/packages/snapback2/guide/offline.md`
3. `snapback2/scripts/test.sh`

Independent SHA-256 of those files matches `factual-checks/source-correspondence.json` candidate hashes and `snapshot-before.json`. Patch `index` new-blob prefixes match independent git blob SHA-1s (`5d5499395`, `7f36a7bdc`, `fcf6becac`). `test.sh` remains mode `100755`.

Protected trees/blobs recomputed with git object encoding; every supplied hash matches:

| Path | Git SHA-1 | Match |
|---|---|---|
| `snapback2/crates/snapback2/src` | `339f10a59a1218e3c48f38dc5fdbd1715f434e5e` | yes |
| `snapback2/crates/snapback2-core/src` | `111170a5cbda715ea9133a33ce9897c8ffa6bed2` | yes |
| `snapback2/packages/snapback2/src` | `fcf6384b15c3f274795521c068d5e69b808bd05e` | yes |
| `snapback2/packages/compiler` | `daeeab73f20fdb6acca94768c8d81d93be911bef` | yes |
| `snapback2/packages/evaluator` | `99cf85c15e05f8c0c1af84f500072dcf41a34654` | yes |
| `snapback2/corpus` | `aa014ff1a4f29b43544a508dc3f8700131297466` | yes |
| `snapback2/Cargo.lock` | `e1e401a5765cb77556c58726fad6ce2a67555d6b` | yes |
| `snapback2/bun.lock` | `470ab0e9ea7cfaabc255694c23f76b5fc9dde0c2` | yes |
| `snapback2/packages/snapback2/package.json` | `7fc62c14a3e050dd5d80a86a5cdb76aad295b084` | yes |
| `llp/1012-local-first-v1.spec.md` | `2d2e00dc44b892916a1f160d0c85e8754b0bc71b` | yes |
| `llp/1001-query-engine.spec.md` | `558656f51237673fed86ecd5eb39c26b1180dd36` | yes |
| `llp/1006-assets.rfc.md` | `fc9df82d0a111196b8b2bc69f06daec3f0939b33` | yes |

Product/source/lock/compiler/evaluator are therefore untouched by this delta. `drain-admission.test.ts` is not in the patch; its SHA-256 `5e56ab282d6f7e9a68a7ab53699338ecad57d878d090ea9372eb747a4dbb4d75` is unchanged.

### Symlink payloads (preserved)

Snapshot hashing uses the link-target bytes, not the follow. Both live links are `../shared` (9 bytes):

| Path | Target | SHA-256 of payload |
|---|---|---|
| `snapback2/packages/snapback2/templates/chat/expo/shared` | `../shared` | `9d5e33ea197579b6ce429383d6f99ca863399a1e6b4c95da240422f134c51f83` |
| `snapback2/packages/snapback2/templates/chat/react/shared` | `../shared` | `9d5e33ea197579b6ce429383d6f99ca863399a1e6b4c95da240422f134c51f83` |

These match `snapshot-before.json`. Live walk of `snapback2/`: 932 leaves, 0 mismatches.

---

## Owner producer / serializer vs new assertions

Admission and wire shape come from unchanged product code.

`writer_resume.rs` `unsupported_log(op, shape)` builds:

- code `E_OFFLINE_RESUME`, family `offline`, guide `offline`
- site `/api/resume.log`
- details `which=log`, `reason=unsupported-log`, `shape`, `op`
- rewrite `use an ascending delivery log (after c first N, N <= 50); subscribe normally at c: null for newest-first data; queued writes are kept`
- **no `cap`**

`log_page` calls `resumable_log_cursor` and maps `Err(shape)` to that refusal **before** `resume_log` / `execute_resume_query`. `Runtime::execute` is the increment of `status.executions`. A refused log therefore executes nothing.

`resumable_log_cursor` (`certificate/page.rs`) returns:

- `"descending"` when a returned page is not `Order::Asc`
- `"cursor-binding"` when a return is not a cursor-bound page (or mixed cursors)
- `"page-bound"` when certified take is missing or `> 50`

The three operations in the test still map onto those shapes:

| Label | Op | Program | Shape |
|---|---|---|---|
| last 50 | `messages.thread` | fixture `after c last 50` | `descending` |
| no page | `profiles.mine` | `return profiles[viewer]` | `cursor-binding` |
| first 60 | `messages.members` | appended `after c first 60` | `page-bound` |

`serve.rs` `refusal_status` maps every `E_OFFLINE_RESUME` to HTTP 413. `Refusal` serializes `code`/`site`/`rewrite` plus flattened details; missing `cap` stays absent (`body.get("cap").is_none()`), not JSON `null`. That is the defect the old `assert_eq!(body["cap"], 50)` hit: indexing a missing key yields `Null`.

LLP 1012 §8 documents `413 E_OFFLINE_RESUME { reason: "unsupported-log", which: "log", op, shape }` with no cap on that arm. Cap belongs only to `{ reason: "limit", which: "mounted", cap }`.

The new assertions require, for each of the three ops:

- HTTP 413
- `code == E_OFFLINE_RESUME`
- `which == log`
- `reason == unsupported-log`
- `op` equal to the requested operation
- `shape` equal to the producer string above
- `cap` absent
- `site == /api/resume.log`
- rewrite contains `ascending delivery log`, `after c first N`, `N <= 50`, `subscribe normally at c: null for newest-first data`, `queued writes are kept`
- `executions` unchanged

Those strings are all substrings of the actual owner rewrite. Recovery is meaningful: use an ascending `after c first N` with `N <= 50`, subscribe at `c: null` for newest-first, queued writes are kept.

Author receipt `owner-baseline-ready.log` failed at the old `cap == 50` on `"last 50"` with left `Null`. Author receipt `owner-fixed.log` reports the same exact test passing after the assertion change. Those are receipts; source correspondence already shows the producer never emitted `cap` on this path.

---

## Preserved later 52-note / large-envelope page exercise

`revision.patch` does not touch the later block in `offline_resume_log_is_the_ascending_page_measured_against_the_budget`. The file still:

- inserts 52 notes of 5,100 four-byte characters
- resumes `notes.log` (`after c first 50`)
- expects HTTP 200, 50-row page, 51-row pool/halo, envelope bytes `> RESUME_BYTE_CAP` (1 MiB), `more == 1`, empty `mounted`, and exactly one additional execution

That remains the large-envelope budget witness. Only the preceding unsupported-log assertions changed.

---

## Canonical `test.sh`

The package line still uses `--test-timeout=10000`. The only edit inserts existing `tests/drain-admission.test.ts` once, before `tests/offline-resume-tail.test.ts`. No previously listed file is removed; no other timeout or deadline changes. `bash -n` is an author receipt (`script-syntax.json`, exit 0).

`drain-admission.test.ts` is pre-existing client coverage (fake owner / structured refusal reduction). Registering it in the blocking list does not relabel a test-double as actual-owner evidence. Actual-owner coverage for this correction is the Rust owner test above.

---

## Unclaimed media wording and 4352-byte budget

Guide line:

> Unclaimed media can expire 24h after creation/latest release; grants/leases do not extend it.

Previously this said “Media can expire…”, which overclaimed. LLP 1006 §9 reclaims `locator IS NULL` rows after 86,400,000 ms from `max(created_at, released_at)`; claimed locators are not in that sweep; replay grants and client byte leases do not extend grace. `guide/operator.md` states the same rule for unclaimed uploads. Independent byte count of `offline.md` is **4342**, cap **4352** (`build.mjs` and `guide.rs`). Ten bytes of headroom.

---

## Findings

None blocking.

The delta is the right layer: tests and the compressed guide now describe the owner that already exists. No product change is required for this correction.

---

## Out of scope (recorded, not reviewed)

- Known successor ordering issue under separate repair: not cleared, not re-reviewed.
- Full combined release qualification: not asked.
- Author owner/client process receipts: not re-executed.

---

## READY
