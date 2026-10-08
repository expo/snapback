# BT scope and assertion audit

Base: `6b8ff187bbb1f6eb231db4105d1727580d95d0aa` on
`sb4-intent/bt-bounded-following-time`. All work uses this worktree on eb1000
(the OS hostname is `expose-builder-pixel`). No fleet dispatch, other worktree
access, product edits, push or publication.

## Governing context (llp-orient)

- LLP 3000 is the Snapback 4 root; LLP 2000.000 is its design brief. Both are
  linked in `llp/current/`. Snapback 1–3 gates/bootstrap do not apply.
- LLP 3000.023 §11, also in `current/`, specifies the existing four-round,
  30-second one-shot budget, event-driven custody wait, offline refusal,
  prediction exception and observation requirement after acknowledgement.
- LLP 3000.016 §2.2 and §5 specify Following routing, speculative withholding,
  original-cursor fallback and real-device controls. Existing test references
  still apply. The client card's routing text in
  `packages/snapback4/CLIENT-AND-OPERATIONS.md` was read alongside the LLPs.
- LLP 3000 §7, “Publication suite under contention,” requires state barriers
  and preservation of outcomes. The helper observes a real custody boundary;
  no small delay is used to infer readiness.
- SN round 8's report, Node Following fixture and admission/receipt mutation
  loader supply the control pattern. No new policy or LLP is needed; report
  and append-only journal are the documentation updates. Hand-off: none.

## What is preserved

All 39 bounded-following cases and all 20 timeout declarations remain. Every
existing assertion other than an online held-custody `E_QUERY_RETRY` expectation
is retained, including raw device provenance, query request counts, blocked
fallback, offline refusals, transport failures, predicted metadata, meter cuts,
nonpredictable intent, native guest loading, original cursor, old cards and final
rows. The two deadline-control refusal assertions are unchanged. Offline arms
of mixed loops are separated and require `E_OFFLINE` explicitly.

The online held-custody expectations are replaced by a direct observation of
the property they represented: the particular Promise has reached the actual
custody wait and has not settled. It is then released and that same Promise's
final answer is checked. New final-answer assertions are additional to existing
post-observation queries. The old three concurrent groups retain all their
members. Offline checks precede the online held reads in two groups so link
loss does not end those promises before write observation. The profile case
likewise preserves its offline checks before starting the online held read.

The static/helper, wide prediction, online-only repost, inbox and native guest
cases each start an independent fresh read after a successful unobserved receipt.
Both the original and new reads must still be pending before apply is released.
A successful receipt is never substituted for observation.

The scalar-cut case on each tier keeps its full real 30-second wait and original
`E_QUERY_RETRY` assertion, plus a monotonic duration assertion. It retains raw
`loading/unknown/complete/tables` checks and the no-server-request assertion.
No production timer or retry constant is changed or intercepted.

`helpers/custody-read.mjs` wraps `QueryCustody.wait`, calls the original method
with the original receiver/arguments and returns the original promise. Node's
`AsyncLocalStorage` associates notification with the exact query invocation,
including concurrent calls of the same operation. It cannot confuse an old
call's wakeup with a fresh before-apply call. The test mock restores the method.
The assertion races entry against settlement so bypassing custody fails rather
than hanging at a notification that will never happen. Rejection also counts
as settlement. This changes no evaluator result, custody predicate or wakeup.

## Other files checked

The audit searched all client `.mjs` files for `E_QUERY_RETRY` and inspected their
surrounding hold, link, request and timer logic, plus the existing Following
fixtures and all `one-shot*` tests. The following table records the disposition;
reading a file is not a claim to have run its entire suite.

| File(s), under `packages/snapback4/test/` | Disposition |
| --- | --- |
| `retained-history.test.mjs` | Convert two online speculative-event reads on each real device. Preserve offline memory behavior, per-operation no-request checks, raw retained/speculative components and engine placeholders. Release both writes and check the held final event/history results. |
| `following-routing.test.mjs` | Convert the pending composed re-observation case. Keep exact pre-release observation/request counts. The fixture releases its queue via normal sync and supplies an observed local answer; the original call must return it without another server request. Other scenarios are unchanged. |
| `client-lifecycle.test.mjs` | Convert the two population-growth replay cases. Remove the global 30-second-to-one-second timer override. Keep device refusal census, minted/post IDs, write state and final rows, and require the held one-shot itself to return both authoritative rows. |
| `follow-window.test.mjs`, report-owned Node/adoption fixtures | Already use the desired admission/receipt in-flight pattern after SN round 8. Read for the method; unchanged. |
| `one-shot.test.mjs`, `one-shot-bounds`, `one-shot-dependencies`, `one-shot-review`, `one-shot-review-races`, `one-shot-commit-evidence`, `one-shot-model`, `one-shot-generation`, `one-shot-discovery-auth`, `one-shot-prediction-replay`, `one-shot-sync-overlap` | Contract regressions: retain explicit real/fired deadline, four-round, terminal-precedence, dependency and race controls. Rerun the complete set. |
| `prediction-routing.test.mjs` | Direct evaluator tests do not run the one-shot timer. Four SDK controls deliberately leave a partition reset/unpublished or a native guest permanently uninstalled. They do spend 30 seconds with custody, but have no healthy release path as written; leave their refusal/no-evaluator/no-server controls intact. A focused run measures these. |
| `store-reset-review.test.mjs` | The network-queue/store-replacement case is also measured in the focused audit. It tests refusal across replacement with sync unable to advance, rather than normal write observation. Leave that independent reset/exhaustion control intact; offline reset reads are immediate. |
| `keep-clock.test.mjs` | Exact-deadline/rollback cases deliberately park recovery through exhaustion, then verify an expired body cannot return after rollback. Preserve the deadline control. |
| `retained-search-order.test.mjs`, `review-probes.test.mjs`, `identity-review.test.mjs`, `ordinary-search.test.mjs`, `online-store-order.test.mjs` | Cursor audience/store/generation changes or stale server cuts exhaust publication rounds, not held write custody. Keep original refusal/request/backoff assertions. |
| `page-ready.test.mjs`, `page-authority.test.mjs`, `in-chat-search.test.mjs`, `expired-server-watch.test.mjs`, `delivery-clients.test.mjs` | Loading server outcomes, meter/expiry or stale-cut publication controls. No removable dependent-write hold. |
| `readauth.test.mjs`, `store-reset.test.mjs`, speculative-component arm of `retained-history.test.mjs` | Offline or transport-failed reads; they refuse without the online custody timer. |
| `ordinary-search-oracle.test.mjs` | Modeled withdrawal assertions, not a held-write timing fixture. |
| `fixtures/page-observation.mjs` | Fixture's settled/withdrawn classifier accepts the refusal as a state; it does not hold a write awaiting the timer. |

The remaining reset/guest and expired-body deadlines are explicitly outside this
conversion, rather than silently counted as optimized. No claim is made that
every 30-second wait in the client suite has been removed.
