# 0062-05: credentialed lanes and the eligibility descriptor

**Status:** OPEN. **Authority:** LLP 0062 §4 (auth projection, never
silently promoted; the phase-1 matrix), residue #2 (stage-(a)
capability-absent bootstrap; descriptor pinned before credentialed
lanes — LLP 0058 amendment, ENG-25409), #7 (challenge-code custody/
redaction, LLP 0055 amendment ENG-25408); LLP 0096
`createExternalSessionClient` (human sessions are NON-custodial — the
old session-custody-store is superseded, do not resurrect it).

The eligibility descriptor + `/inspect` emission; anonymous default
with explicit `--as` selection; dev-assertion behind the dev-only
flag; human sessions via the non-custodial bearer path; agent
pairing/scoped-grant surface (LLP 0055) with the custody/redaction
contract for challenge codes; POSIX-only refusals per §6.

Done when: the §7 dev-auth cells + credentialed-lane acceptance
families pass and the descriptor is served, versioned, and consumed.
