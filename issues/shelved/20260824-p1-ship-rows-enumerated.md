# The 9 P1-SHIP rows, enumerated — and a correction: the P2/P3/P4 rows never were

Status: open
Date: 2026-08-24
Systems: snapback-auth, snapback-engine, snapback-server
Related: issues/20260824-liveness-factory-triage-and-count-correction.md,
  issues/shelved/20260824-authority-minting-factory-inventory.md,
  issues/shelved/20260824-entitlement-predicates-for-the-live-sites.md

## Correction: I published bucket counts without the rows

`issues/20260824-liveness-factory-triage-and-count-correction.md` publishes four aggregate counts
(9 / 68 / 17 / 40) and states in the same document that counts must be tied to enumerated rows. It
does not list the rows. A follow-up analysis asked to group the 68 P2 rows correctly **refused**,
on the grounds that the P2 row set does not exist anywhere in the repository and that inventing a
partition would reproduce the very error the document warns about.

That refusal is correct. Checking the source triage output confirms it enumerated only the P1 rows
in detail; P2, P3 and P4 were reported as counts. **So the 68 / 17 / 40 figures are unverified
aggregates with no row-level backing, and should not be cited as an enumeration until the buckets
are re-derived and landed with their row IDs.** Only the P1 set below is enumerated.

This is the same failure mode twice in one day, from me: a count that reads as an enumeration.

## Provenance caveat

The factory inventory describes code at `8ded451f8`; main has since advanced. The analysis reports
at least one high-value family is already factually stale. Re-derive before acting on any row whose
surrounding code has changed — the inventory carries a re-derivation section for exactly this.

## The 9 P1-SHIP rows (enumerated, with predicate and existing helper)

Safe to patch without a policy decision: an obviously correct predicate exists, an existing tested
helper expresses it, and no legitimate cross-principal use was found for any of them.

| Rank | Row | Predicate / existing helper |
|---:|---|---|
| 1 | **F190** | `Session` + source `AgentGrantManagement` + `authority.user_id == user_id`; `require_grant_session` derives exactly that user. **Already fixed** — see below. |
| 2 | **F191** | Same owner predicate; `actor_id` is only a selector within grants whose effective user is the authenticated user, not another owner. **Already fixed** — see below. |
| 3 | **F188** | `authority.user_id == user_id` + `authority.session_id == session_id` + source `AgentGrantManagement`; `require_grant_session` expresses the tuple. |
| 4 | **F172** | Same exact user/session predicate for OAuth approval; the tested OAuth route derives both via `require_grant_session` (`oauth.rs:506`). |
| 5 | **F173** | `authority.user_id == consenting_user_id`; the request must remain the storage-verified request belonging to that same user. |
| 6 | **F183** | Exact inviter session + source `AgentGrantManagement` + `authority.user_id == user_id` + the existing step-up binding (`agent_invitation_step_up_binding`). |
| 7 | **F185** | `Session` + source `AgentGrantManagement` + exact user equality; helper `require_pairing_code_mint_authority` (`engine.rs:5819`). |
| 8 | **F053** | `(session_id, expected_generation)` must equal the exact resolved session tuple; `PreparedConnectionAct::authenticated_use_key`. |
| 9 | **F171** | `authority.user_id == consenting_user_id` + source `AgentGrantManagement`; the OAuth GET route already uses `require_grant_session`. |

## Two are already done

F190 and F191 are the single and bulk grant-revocation planners fixed in `a5d66e941` +
`23db84b46`, which removed the independent `user_id` parameter and derived it from the admitted
authority. That fix landed with 14 killed mutations including comparison-operator mutations in both
kernel queries.

**7 P1 rows remain**, and they cluster: F172/F173/F171 are OAuth consent, F183/F185 are
invitation/pairing, F188 is grant approval, F053 is session authenticated-use. The OAuth cluster is
the natural next batch — three rows, one route family, one existing helper.

## Note on F185

F185's named helper is `require_pairing_code_mint_authority`. That helper was just refactored: it
now layers its expected-user check on top of the neutral
`require_agent_grant_management_session` (`engine.rs:5847`). Use the neutral helper plus the
explicit user comparison rather than reintroducing the coupling a review blocked.
