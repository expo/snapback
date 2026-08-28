# visibility-governance pre-push gate misreports a missing predecessor object as a G1 provenance failure

- **Date:** 2026-08-26
- **Status:** Resolved
- **Area:** `scripts/check-visibility-governance.mjs` (pre-push admission), `packages/snapback-codegen/visibility-governance.mjs` (`validateG1ClosureIntroduction`)
- **Related:** LLP 0234 (visibility governance), `.githooks/pre-push`

## Symptom

A `git push origin HEAD:main` from a branch whose tree carries the same
`visibility-governance-g1-closure.json` bytes as `origin/main` was refused
three times with:

```text
fatal: not a tree object
[visibility-governance] REFUSED SNAPBACK_TABLE_VISIBILITY_POLICY_PROVENANCE_INVALID: G1 migration closure receipt does not bind the governed predecessor
```

GitHub's `refs/heads/main` had advanced (`ed8300f90` → `81c339134`, an
issues-only backstop commit) but the local object store had not fetched it
yet. The hook receives the advertised remote sha, `artifactAtRevision` fails
to read the receipt at that sha (`git show <missing>:path` → "not a tree
object"), the receipt is therefore classified as *introduced* by the push,
and `validateG1ClosureIntroduction` compares the receipt's `predecessorOid`
(`3c060a6b…`, the real G1 predecessor) against the unknown advertised sha.

Reproduction: `printf 'HEAD <tip> refs/heads/main <sha-not-in-local-store>\n' | node scripts/check-visibility-governance.mjs pre-push --root .` after a
plain `git fetch`; the same stream with a fetched predecessor is `ALLOWED`.

## Why it matters

The refusal names a provenance violation that did not occur, on every push
that races an unfetched main advance — which on this repository is the
ordinary case. The landing loop's "push failed → fetch → rebase → retry"
recovered only once the fetch actually delivered the new tip; the diagnosis
cost a landing cycle.

## Proposed fix

- When the advertised predecessor is not a readable commit locally, refuse
  with a distinct code (e.g. `SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PREDECESSOR_UNAVAILABLE`)
  and a message that says to fetch and rebase; never fall through to the
  introduction path.
- Do not classify an artifact as "introduced" when the before-side read
  failed for a reason other than "path absent in an existing tree".
- Fail-first test: pre-push stream whose before-oid is syntactically valid
  but absent from the object store.

## Resolution

Resolved on 2026-08-28. Revision artifact reads now distinguish an absent path
in a readable tree from an unreadable revision, and snapshot comparison refuses
an unavailable advertised predecessor with
`SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PREDECESSOR_UNAVAILABLE` plus fetch/rebase
guidance before any G1-introduction classification. The regression uses a
depth-one clone to prove the missing-predecessor refusal, preserves the all-zero
new-ref behavior, fetches the predecessor, and proves the same pre-push stream
is then allowed.
