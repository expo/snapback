# Lane SL context pack

Scope: the Rust targets, client files and seeded models scheduled by
`scripts/test.sh`; host contention and executable startup, round 0.

Governing decisions:

- [LLP 3000: publication suite on small hosts](../../../llp/3000-snapback4.explainer.md#publication-suite-on-small-hosts): the publication pool derives from available CPUs.
- [LLP 3000: decisions during execution](../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution): one Rust implementation; guide examples are executable tests.
- [LLP 3000.019 §3.4](../../../llp/3000.019-what-the-builder-still-wrote.rfc.md#34-p8-residency-you-can-see-and-a-cli-that-does-not-fight-the-dev-server): database ownership precedes SQLite access.
- [LLP 3000.003](../../../llp/3000.003-one-semantics-and-credible-verification.research.md#verification-hosts): actual lifecycle/adapter witnesses matter; this Draft Research is rationale, not a new gate.
- [LLP 3000.028 §3.3](../../../llp/3000.028-one-query-online-or-offline.rfc.md#33-one-body-per-search-scope-and-two-platform-plans): combined live keyset continuation, identity/membership/link fences and stable-row correctness; read with the compiled `guide/search.rs` card before diagnosing the reopen defect.
- [LLP 3000.015 §2.1](../../../llp/3000.015-shared-baseline-for-snapback5.spec.md#21-first-membership-and-developer-refusal-detail): counted console lines, fixed windows and acknowledged shutdown; read with compiled `guide/refusals.rs` before preparing the stderr-framing correction.
- [LLP 3000: HTTP overload diagnostics](../../../llp/3000-snapback4.explainer.md#http-overload-diagnostics): the host diagnostic queue is bounded and asynchronous. The compiled refusals guide defines process events as individual lines; `lifecycle.rs` writes exit records directly. A fixture must parse the named record independently of the other writer's scheduling.
- [LLP 3000.007 §20.4](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#204-a-queued-web-write-survives-navigation-s29) and §18.2: pre-identity calls have no durable custody, pin backend identity and refuse an incompatible replacement publicly. Read the current client/writes/E_ADMISSION guide cards and EA round-3/round-6 reports before investigating the unchanged Worker incarnation test in heavy attempt 8; the earlier durable pre-identity design is superseded.
- `rules/RULES.md`: every failure reported; only owned processes reaped; journal append-only through the Snapback 4 command sheet.

The user's commission explicitly preserves assertions, seeds and counts,
requires the no-load/moderate/heavy/slow-start matrix, three heavy passes,
one slow-start pass, the whole guide and a final unconfined suite. It authorizes
the experiment harness in this report directory, a journal entry and local
commit; it forbids push/publication and execution work on the black M5.

Risks: short end-to-end budgets can fail before reaching the intended test
state; a wait may expose a product race, so its cause must be distinguished
before adjustment. Linux cannot execute the macOS-only simulator driver CLI
cases. Fake simctl evidence is never native simulator qualification.

Likely doc update: preserve contention methodology and hang-budget policy in
the existing root LLP, append the journal, and retain failures and controls
with the full-suite evidence. Hand-off: none; this is the commissioned test fix.
