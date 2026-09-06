# Drain integration review

Target: `680b68716dd876823348a94fb8915ac7384305e7`. Root read both complete reports and the additive Grok follow-up.

Astra requests changes: the existing real-owner unsupported-log test still asserts absent `cap: 50` and obsolete recovery prose. The actual unchanged owner test now reproduces that assertion failure; the repair is in progress and must preserve all three refusals plus the 52-note budget case. Add the existing drain-admission test to the canonical runner. No repaired-candidate approval is claimed here.

Grok's original source-only cap32 finding is preserved verbatim. Its same-session follow-up withdraws the finding: production `resumeRequest` clamps and slices to32 before serializing, so the asserted >32 request is unreachable through this client. Root independently checked that call path and accepts the withdrawal. No product change is warranted by this finding. Grok performed no product tests.

Root verified all950 snapshot leaves, hashing the five symlink payloads rather than their targets. All matched; the review's apparent LLP/directory differences were a hashing-method issue, not source drift. The original review and terminal records remain intact.

Independent evidence scopes remain separate. Original declaration-export, twin-file and browser setup failures are not converted to passes by later selections. Inherited successor defects remain under repair; this review does not qualify the combined release, installed package or full Clique benchmark. Convex/Supabase baselines remain reused.

Full verbatim reports and process/model identities are retained beside this file and bound by `manifest.json`. Links inside copied reports refer to the original external review evidence paths; the complete execution material remains under `/Users/ccheever/clique-improvement/reviews/drain-local-integration-r1/`.
