# Drain integration review

Target: `680b68716dd876823348a94fb8915ac7384305e7`. Root read both complete reports and the additive Grok follow-up.

Astra requests changes: the existing real-owner unsupported-log test still asserts absent `cap: 50` and obsolete recovery prose. The actual unchanged owner test now reproduces that assertion failure; the repair is in progress and must preserve all three refusals plus the 52-note budget case. Add the existing drain-admission test to the canonical runner. No repaired-candidate approval is claimed here.

Grok's original source-only cap32 finding is preserved verbatim. Its same-session follow-up withdraws the finding: production `resumeRequest` clamps and slices to32 before serializing, so the asserted >32 request is unreachable through this client. Root independently checked that call path and accepts the withdrawal. No product change is warranted by this finding. Grok performed no product tests.

Root verified all950 snapshot leaves, hashing the five symlink payloads rather than their targets. All matched; the review's apparent LLP/directory differences were a hashing-method issue, not source drift. The original review and terminal records remain intact.

Independent evidence scopes remain separate. Original declaration-export, twin-file and browser setup failures are not converted to passes by later selections. Inherited successor defects remain under repair; this review does not qualify the combined release, installed package or full Clique benchmark. Convex/Supabase baselines remain reused.

Full verbatim reports and process/model identities are retained beside this file and bound by `manifest.json`. Links inside copied reports refer to the original external review evidence paths; the complete execution material remains under `/Users/ccheever/clique-improvement/reviews/drain-local-integration-r1/`.

## Correction closure

The correction is now committed as `df68f3cf9e1edbc6f6a490884b8469b28e8aab78` and pushed to `origin/s2/clique-drain-owner-regression`. It changes exactly three files and no runtime product source. Actual unchanged owner execution fails at missing cap versus50; the corrected complete owner test passes all three refusals and unchanged52-note/large-envelope tail. The unchanged three-test client file also passes at its original10s limit. Full implementation/source/terminal receipts are retained here.

Both fresh independent native reviews are **READY**, with no in-scope findings: Astra gpt-6-astra/xhigh and Grok4.6/xhigh. Root read the complete reports and independently verified all961 source/factual snapshot leaves in each. Both reviewers performed source/patch/tree/hash checks; neither reran the actual owner/client tests. Their approval closes the three-file correction, not the inherited successor issue or a combined release. Original failure and withdrawn-finding reports above remain verbatim.

The next combined candidate includes the separate ordering repair and currentmain; its affected integration checks and ordering reviews remain pending. No npm or full Clique clearance follows from this closure.
