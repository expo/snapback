# Reachability follow-up — Finding 1 cap:32 retry

**Final disposition: READY**

Finding 1 from the original report is **withdrawn as a publicly reachable product defect**. It is not reclassified as defensive-contract CHANGES_REQUIRED.

The original `review-evidence/REVIEW.md` is preserved verbatim (sha256 `354c1d0e012180248a6e2267c7d03cf1d36c58c2489acd62326e41cbf236bdd3`, 17810 bytes). This file is additive. Product sources were not edited. No peer-review contents were used. No tests were run (this snapshot still has no `dist` / `node_modules` / `target`).

---

## Question

Root’s counterexample: `OfflineRuntime.resumeRequest` (`src/offline.ts` 669–694) clamps `cap` to 32 and `candidates.slice(0, cap)` **before** building `request.mounted`; `performOfflineResume` also requires `next.cap < request.mounted.length`. Do `>32` live subscriptions produce `>32` `request.mounted`, and is the original cap:32 / `cap < 32` mismatch a public drain defect?

## Call graph (production)

Every public resume flight is:

1. `Client.initializeOffline` / `Client.online` (`goOnline`) / drain grant `resume()` / `me()`  
   → `Client.performResume` (`client.ts` 1080)  
   → `resumeOffline` (1135)  
   → `performOfflineResume` (`client-offline.ts` 346)
2. `performOfflineResume` builds the body **only** via  
   `options.runtime.resumeRequest([...options.mounted.values()], adjustment)`  
   (lines 365 and 396 after the no-facts seed query).
3. The POST is `JSON.stringify(request)` of that object (line 415). Nothing appends to `request.mounted` after `resumeRequest` returns.
4. `performOfflineResume` is imported only by `client.ts`. It is **not** a `packages/snapback2/src/index.ts` export. Apps cannot pass a homemade mounted array through the public client.

`this.mounted` can grow with live `subscribe` (guide: 256 per SSE connection; `real-owner.test.ts` mounts 60 `messages.thread` subscriptions). Drain entries are stored too (`createOfflineDrain` line 252) but are filtered out of resume candidates (`!query.drain`).

## Why `request.mounted.length` cannot exceed 32

`resumeRequest` return paths:

| Path | `mounted` |
|---|---|
| no partition / no facts | `undefined` (no POST) |
| facts present but coverage not current | `mounted: []` |
| coverage flips stale after reads | `mounted: []` |
| normal | `answers` from `candidates.slice(0, cap)` |

`cap = Math.max(0, Math.min(32, Number.isSafeInteger(adjustment.cap) ? adjustment.cap : 32))`.

First flight uses default `adjustment = {}` → `cap = 32` → at most 32 candidates, then only those with a string validator. Recursive retry passes `resumeAdjustment`’s `cap`, which is already `< 32`.

Therefore production `JSON.stringify(request).mounted.length <= 32` even with 60 or 256 live subscriptions. Owner `if request.mounted.len() > MAX_MOUNTED` (`writer_resume.rs` 111–121, `cap: 32`) is **not entered** by this client.

The second conjunct in the original finding, `next.cap < request.mounted.length`, independently forbids a retry of owner `cap: 32` against a request that already has `mounted.length <= 32` (`32 < n` is false for all `n <= 32`). So even if `resumeAdjustment` accepted `cap === 32`, the retry would still not run on this client.

## What does produce owner `cap: 32` 413

`crates/snapback2/tests/owner_cases/offline_resume.rs` 193–222 POSTs `MOUNTED_CAP + 1` raw JSON via `resume_body(...)`, not `createClient`. That is owner-API coverage of the wire check. It is not the public client runtime. This follow-up does not treat that harness POST as a public client defect (and does not replace `resumeRequest` to manufacture `>32`).

The JS test “E_OFFLINE_RESUME adjusts only structured mounted limits…” (`offline-store.test.ts`) **replaces `fetch`**, returning `{ reason: "limit", which: "mounted", cap: 0 }`. Production `resumeRequest` still built that test’s bodies. `cap: 0` satisfies `cap < 32` and `0 < request.mounted.length`. That is a synthetic owner double, not the owner’s only production limit (`cap: 32`), and not a `>32` request.

Production owner has no other `reason: "limit"` / `which: "mounted"` arm. The 1 MiB bound is HTTP 200 + `more`, not this 413.

## Classification

| Label | Applies? |
|---|---|
| Publicly reachable drain defect | **No.** Production client never sends `mounted.length > 32`; production owner never 413s this client with `cap: 32`; retry of `cap: 32` is also blocked by `next.cap < request.mounted.length`. |
| Defensive contract coverage worth CHANGES_REQUIRED | **No.** Handling owner `cap: 32` would be a no-op retry for this already-sliced client. A predicate hole on an unreachable 413 is not a user-visible drain regression and is not retained as a required fix. |
| Withdrawn | **Yes**, as a public product finding. |

Silent truncation of resume candidates to 32 (overflow stay on SSE and reconnect as ordinary live queries) is the client-side dual of owner `mounted ≤ 32`. It predates this composition’s retry rewrite (`revision.patch` already had `slice(0, cap)` on main). It is not a substitute CHANGES_REQUIRED drain finding.

No other independently supported public drain defect was added in this follow-up.

## Evidence scope

- Source-only call graph on this immutable snapshot.
- No Cargo, package build, owner, browser, or `node --test`.
- No moving worktrees, no network, no original-report edits, no product byte changes.
- Product hash drift vs `snapshot-before.json` remains only the three pre-existing `llp/current/*` symlink materializations recorded in `review-evidence/hash-check.json`.
- Original failures in `factual-checks/` remain author receipts; they were not re-run and not reclassified.

## Explicit close

Original report: **CHANGES_REQUIRED** (verbatim).  
This follow-up: Finding 1 **withdrawn**; **READY** for drain composition as reviewed. Root owns disposition.
