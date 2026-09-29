# AV round-1 context

Engineering Snapback 4. The original lane prompt remains binding. First action:
`git fetch origin && git merge origin/main`. The sole conflict was the
append-only journal; both AV round-0 and incoming DX round-1 entries were kept.
Merge commit: b0e693b3153143320edd2189a738399f7fb7fec9; incoming main:
b7d05baff661db08bb99250d80b1090a8ed99346. No push or publication.

Applied `llp-orient` from the existing lane-wk skill copy because this lane's
submodule-backed link remains uninitialized. Read the Snapback 4 command sheet,
NOT-DOING, journal tail, governing root/design brief and repository rules.
The media/assets alias card and client manual establish the authoring surface.

Governing documents are in current/, not the unrelated Snapback 1 foundation:

- LLP 3000 §7 and #http-overload-diagnostics: current home-rule authorization,
  indistinguishable missing/hidden assets, admission 503 guidance, no ambiguous
  upload or one-view replay.
- LLP 3000.008.002.000 §6: handle ownership, explicit one-view open above transient
  lists, account and home-row revocation. Updated here with the retry decision.
- LLP 3000.019 §3.5 and LLP 3000.007 §8: confirmed download receipts, current
  store/cell/generation, no once retention. A complete ranged body must retain
  under exactly these checks; partial bytes remain ineligible.
- LLP 3000.013 §6/§13: store/principal/client lifetime fences.

No new grant, cache key, one-view counter, server endpoint, contract.ts field or
wasm code. Existing Range refusal before one-view consumption provides a safe
retry boundary even against the published 0.4.8 server. Retryable errors do not
mean authorization denials are retryable. Every new attempt reauthorizes at the
server; explicit refusals stop the call.

Review: Astra's Activity regression, StrictMode initial-fetch duplication,
transient-failure hypothesis and reverse-completion gap are addressed. Grok completed with READY WITH CHANGES. Its failed/hung-fetch findings,
precise client/sign-out ownership wording and independently unmounted hooks
are covered. Its suggested ambiguous once retry was not adopted: the task and
governing one-view contract require a non-consuming retry boundary. Original grader transport attribution remains unknown despite
reproduction of the failure mechanism. Hand-off: none for implementation;
open d-02 ticket retains the original-state attribution question.
