# Sol repair review — 2026-09-16

Reviewer: gpt-5.6-sol, xhigh, fresh independent read-only session.
Received report below; trailing whitespace normalized. Follow-up adjudication and
qualification are in [the review index](3000-complete-code-review-20260916.md).

# Independent repair review

Reviewed commit: `f6b514c35ec4cffc7fe102a51e583fcfba28f636`
Parent: `5da486875`

Verdict: **MATERIAL FINDINGS REMAIN**

## Findings

1. **[P1] `--resume` can be blocked by unrelated current-source failures before it inspects or requalifies the staged tarballs** — `snapback4/scripts/publish.mjs:31-37`, `snapback4/scripts/publish.mjs:51-70`

   The script always runs the current checkout's `scripts/test.sh` before calling `loadStage()`. After the platform package has published and the client publish has failed, a later `--resume` is supposed to converge the exact retained pair. If the checkout has since changed without a version bump, or its current suite is temporarily red, `--resume` exits at line 36 without checking the durable receipt, running the installed-consumer proof over the retained bytes, or publishing the missing client tarball. The source suite does not qualify those retained tarballs, and this can leave a partially published version incomplete until unrelated source work is repaired. It also delays the ordinary existing-stage refusal until after an irrelevant suite run.

   Remedy: load and validate the stage, and reject an ordinary invocation against an existing stage, before running the source suite. Run `scripts/test.sh` only on the new-stage/build path. On `--resume`, validate the receipt and tarball integrities, repeat the installed-consumer/signature proof for those exact tarballs, then converge registry state.

2. **[P1] The public `Persistence` contract still permits alternate stores that orphan recovery can never discover** — `snapback4/packages/snapback4/src/web.ts:25-36`, `snapback4/packages/snapback4/src/web.ts:66-68`, `snapback4/packages/snapback4/src/web.ts:313-325`

   `claim` is now required and may return a provider-scoped alternate name, but `others` and `remove` remain optional, and no rule requires an alternate name to start with `${name}:tab-`. `adoptOrphans` immediately returns when either optional method is absent and otherwise enumerates only that hard-coded prefix. A type-correct custom provider can therefore grant an exclusive alternate to a second tab, persist an admitted or journaled write there, release it on close, and then have the next primary open skip the store forever. This contradicts the documented promise that closed-tab writes are adopted and makes the ownership repair incomplete for the custom-persistence surface it now requires.

   Remedy: make orphan enumeration/removal part of the required ownership contract whenever alternates are allowed, and let the provider enumerate alternates for the logical store rather than inferring them from a built-in suffix. Alternatively, reject alternate claims from providers without those capabilities and require a documented, validated alternate-name namespace. Add a custom-provider regression whose alternate name is not `${name}:tab-*` and whose closed-tab outbox is adopted exactly once.

## Review scope and method

Read-only delta review of the 23 changed files, with Snapback 4 agent rules, LLP 3000, LLP 3000.005, LLP 3000.007's relevant ownership sections, and the current client/operations documentation. Per instruction, I did not run builds or tests, mutate the repository, use remote commands, or read any other review artifact.
