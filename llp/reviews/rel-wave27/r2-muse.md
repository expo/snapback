muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=0ad1f55a-881b-4443-a29d-448e3b891574]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
MATERIAL — §21 still carries safety/custody gaps.

Findings:

1. Refill lacks atomicity. §21 Extraction para 2 requires live ledger home and byte match, but never places verify plus transfer inside the same adoption under command lock and CAS. A home freed between check and move would resurrect released bytes. Require atomic verify-plus-transfer in adoption, with joint rollback.

2. Rename plus on-delete change is unsafe bundling. §21 permits reference rename to change deletion policy with only disclosure and one-to-one testing. A restrict-to-cascade change makes an old delete destroy children through the default current-source view. One-to-one does not prove cascade budgeting. Separate rename from policy change, or pause with `E_OP` and explicit acknowledgment, and test one-to-many.

3. Write/freeze gate is ambiguous and unsound. §21 Registration: “against both the active source and latest ordinary source” does not state AND. An OR reading lets an old selection erase the boundary. “Known object patches that omit a field are not writes” is undefined. Require AND with stricter wins, and define known as syntactic literal with no spread, computed keys, or dynamic bases; otherwise treat as write.

4. Freeze closure is missing. §20.2 follows transitive bindings and expanded helpers with unknown-refuse. §21 freeze clarification does not. A freeze depending on hidden rows via helper would be missed. Apply the same transitive and helper expansion to freezes.

5. Payload and alpha rules are ambiguous. The closed subset rule never states direction, so a broader child could leak. The alpha claim that same-spelled argument/local/shape slots are safe when unchanged assumes disjoint namespaces, contradicting §20 capture avoidance. State child-subset-of-source direction, and require capture check or prove disjointness.

6. Proof and equal-deploy collapse hide changes. The starter requires v1-write ids but excludes their values, so silent value drift passes. Equal forward deploy collapsing a view to ordinary never states hiding-reason comparison. Require value equality or enumerated field coverage, and require private desired-set plus digest and hiding comparison before collapse.

