# BN round 5 context

Applied llp-orient read-only before editing. Read rounds 0–4 prompts and reports,
the Snapback 4 fence, NOT-DOING, journal, rules/RULES.md, the live bounds and
witness acquisition guidance, and the referenced sections below.

Scope: the private Node transport and acquisition witness attempt recorder,
existing witness/transport tests, LLP 3000.030 §14, report and one journal entry.

- LLP 3000#1 and #4 (current, not foundation): Snapback 4 fence and periphery
  ownership; no engine, storage, contract or other candidate edits.
- LLP 3000#http-overload-diagnostics (current): preserve KA's one fresh retry,
  eligibility and original request snapshot. Host fetch instrumentation runs;
  no process-wide dispatcher replacement.
- LLP 3000.030#14 (current): every attempt and partial failure remains visible;
  any transport failure invalidates the proof even if recovered. Command-owned
  diagnostics only; no remote prose, codes, timing metadata or bearer echoes.
- LLP 2000.000#7.2: acquisition and retained-partition semantics are unchanged.

Rationale: the wrapper sees only the final response/error of a transport call.
A private third-argument onRetry callback reports KA's actual retry decision,
without guessing from errors or adding a global witness observer. The witness
retains the initial failed sample, latches the failure and starts a separate
sample immediately before that retry. Round 3's single-attempt transport ignores
the private argument and retains its original recording path under the control.

Doc update: extend the existing §14 with the callback boundary and fixed receipt
cause. The bounds guide already requires no failed attempts, so no authoring
form or guide claim changes. Existing refs remain applicable; hand-off: none.
Risk/limit: Linux protocol/subprocess checks and headless browser checks do not
qualify iOS simulator, physical device or heavy-account timing. Full suite is
explicitly excluded this round, including with the small shared transport edit.
