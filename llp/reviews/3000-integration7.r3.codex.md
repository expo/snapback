# Integration 7 round 3 — codex

**Reviewer:** fresh Codex GPT-6.1 Sol
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** 74895a66f0dd64efda0bdd077474b7fe496e9877
**Delta:** e759005d33..74895a66f0 (final fixtures/guide/version/metrology)
**Provenance:** fresh codex exec -m gpt-6.1-sol -c model_reasoning_effort=high --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -o review-r3-codex.final - < review-r3-brief.txt. Mutually blind; response below verbatim. Source readiness is separate from execution qualification. Raw transcript sha256 3730cd5177fb2b7a642ad73085d956627ed7920fe3bbde51afb8fee149194238, retained compressed in integration evidence.

---

READY — source delta `e759005d33..74895a66f0`, bound to **74895a66f0dd64efda0bdd077474b7fe496e9877**.

No material source findings.

- The tab-close barrier establishes LLP 3000.013.000 §4.5’s exact precondition: the captured owner’s lock disappears from both held and pending locks before reopening. It never releases the lock itself; a persistent lock still fails the bounded wait. Live-peer exclusion, recovered-ID and single-execution assertions remain ([test:381](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/online-journal-browser.test.mjs:381)).
- All eight version files consistently carry `0.4.25`. Actual-engine expectations derive from the manifest; mocked/legacy versions and protocol floor `0.4.24` appropriately remain. Both byte controls still change `0.4.25` to `0.4.23`, with identity refusal before store claims ([test:64](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/device-version.test.mjs:64)).
- Following fixture repairs fill both insert arms and establish group existence. The optimized membership envelope retains speculative withholding, custody checks and suppression of server replacement.
- Guide compression preserves behavior and budgets; the first-account test executes `init --adapt`. The bounded serializer allowance remains restricted to Value/ObjectFields.
- Final metrology is consistent: **698,886 = 698,386 + 500**. Since measured clean `5a4779e48a`, only the two metrology files changed within Snapback 4.

Minor documentation drift: [LLP 3000.036:1869](/home/ccheever/projects/snapback-sb4loop/llp/3000.036-what-the-app-farm-asks-of-the-rule-language.rfc.md:1869) still describes `filteredEvents` as exercising partial-table withholding; its updated envelope now reflects membership discovery before the owned scan. Nonblocking.

Execution evidence remains separate: the bumped five-crate Rust command and Mac full publication stages are pending per your brief. I did not run qualification; four changed JS files passed syntax checks. This verdict asserts source readiness, not publication acceptance or completed qualification.