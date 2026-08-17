# Review charter — LLP 0240 slice C (D4 custom authorization, membership-visible search, D6 runtime inspection)

Adversarial review of the commit(s) on this branch vs base ce30ee99e
(semantic diff: /tmp/c-review.diff; full tree here). Context:
SLICE-C-CHARTER.md, SLICE-C-REPORT.md (claims — verify), LLP 0240 D2/D4/D6,
LLP 0011/0146/0172/0173/0234.

Priorities:
1. D4 honesty boundary: can any authored spelling obtain precise claims
   (sync:"reauthorize-on-change" or equivalents) without the refusal? Does
   coarse-global genuinely wake on EVERY relevant application/authorization
   change (find a change class that doesn't wake it)? Is the completeness
   warning suppressed anywhere it shouldn't be? Does the declaration clear
   uncomposed-read-surface warnings for exactly the proven claims?
2. Search: non-enumeration byte-identity on the search surface (member vs
   outsider vs absent scope); revocation stops new results; the compile-direct
   lowering consumes ONLY hashed profile fields (generation-closure guard
   honest — verify its enumerated files cover the new lowering path);
   interaction with roster.visibleFields (search must not leak invisible
   fields or rows).
3. D6 endpoint: admin-write authentication actually enforced pre-lookup;
   unauthenticated/public probes byte-identical BEFORE any authority read;
   response contains ids/enums/policy identities only (hunt for leaked row
   contents, principals of other members, or private metadata); the endpoint
   is not itself an enumeration oracle (absent profile/scope/principal all
   shaped identically for unauthorized callers).
4. The rbac search acceptance checks assert what the report claims.
5. General hunt over the delta, incl. diagnostics classification for new
   SNAPBACK_* codes and LLP text accuracy.
Output: READY or NOT READY; findings MATERIAL/MINOR, file:line, concrete
scenario. Terse.
