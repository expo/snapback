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

**Progress (2026-08-01): the eligibility descriptor is landed; the
credentialed lanes remain.**

This ticket's own authority line orders the work — residue #2 pins the
descriptor *before* credentialed lanes — and that half is now done:

- `AppCliTargetFactsV1` is a Rust-owned structured descriptor on the
  capability manifest (principal classes, `servesEnvelopes`,
  `acceptsGenerationAssertions`, optional `perGrantTokenCap`), deliberately
  NOT a ninth entry in the closed `TargetCapabilityId` string set — §4 needs
  facts a boolean cannot carry, and the engine must read the per-grant cap
  rather than hardcode LLP 0055's constant.
- It is served on `/inspect` and **echoed by sessions discovery** as
  `appCliDescriptor`, so the engine reads eligibility credential-free before
  selecting any principal (§4: the engine "never infers any of this from a
  URL" — true only because the fact exists).
- Local declares (`anonymous`, `dev`, `session`; `agent` deliberately absent
  until its lane exists). Remote-service, workerd-conformance, and Cloudflare
  **withhold** — the drift gate caught an inherited claim and the withholds
  are now explicit, matching §4's matrix (remote service is admissible only
  "once it advertises"; hosted is out of phase 1).
- Engine consumption: `targetDescriptor`, `targetAdmitsPrincipal`,
  `refuseUnadmittedPrincipal`, and `PRINCIPAL_CLASSES`, with
  `SNAPBACK_APP_CLI_PRINCIPAL_UNSUPPORTED` frozen at exit 2 (usage — no
  credential was presented, so it is not an auth refusal). A
  capability-absent target admits `anonymous` only.
- Evidence: four checks in `tests/acceptance/app-cli-settlement-goldens.mjs`
  against the live binary (descriptor served and echoed; classes stated;
  unadmitted principal refuses before any credential is presented;
  capability-absent admits anonymous only). Dated LLP 0058 amendment carries
  the contract.

**Remaining in this ticket** (the lanes themselves, unblocked by the above):
anonymous default with explicit `--principal` selection and the `auto` probe's
conflict-refusal/invalid-never-fallback rules; the dev-assertion lane behind
its dev-only flag; human sessions over LLP 0096's non-custodial bearer path;
the agent lane (loopback-only condition, pairing with the code never on argv,
credential-by-reference profile, per-invocation short-TTL mint with the
release primitive, and the cross-process admission bound keyed by (target,
app, grant)); the LLP 0055 dated amendment those last items require; and the
§7 dev-auth cells plus credentialed-lane acceptance families.
