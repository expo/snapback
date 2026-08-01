# Node session custody store and session lifecycle commands

**Status:** Superseded
**Impact:** 4
**Urgency:** 2
**Ease:** 2
**Confidence:** 3
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Node session custody store and session lifecycle commands” shows the issue materially affects a supported product or engineering path; it can wait behind current correctness blockers, while the repair crosses several runtime, host, protocol, or policy seams, with a clear design but unresolved dependencies.
**Severity:** P2
**Systems:** Auth, Client integration, Tooling
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §4, LLP 0057 (challenge-code secrecy), LLP 0059 §Client custody and `AuthCoordinator`, LLP 0056 (memberships), packages/snapback-contract/auth-coordinator.mjs
**Marker:** app-cli, sub-stage-b, auth

`AuthCoordinator` today has memory and IndexedDB custody storage only;
a process-per-command CLI loses its session on exit. Phase 1 adds a
**Node session custody store**: transactional, file-backed, keyed by
(target origin, app id, profile name), with the same
0600/atomic-replace/advisory-lock discipline as agent custody, holding
the session across invocations until `logout`. `--profile <name>`
allows two identities against one target (role testing). `login`
drives `authRequestCode`/`authExchange`; the exchange code is accepted
only through a hidden prompt, stdin, or a securely admitted file —
never literal argv or environment — and request/exchange redirects are
terminal. Address and code sentinels are redacted from logs,
diagnostics, and output. On capture-only local
providers it prints the challenge id and points at the operator-plane
retrieval instructions (the app CLI never implies it reads the
mailbox). `whoami` reports the principal source; no secret is echoed.

Final-revision delta: concurrent invocations under one session
profile inherit the coordinator's supersession protocol
(`CREDENTIAL_SUPERSEDED` → custody reload → one retry → family
alarm), but the current coordinator deliberately releases custody
ownership before network refresh. The implementation must choose and
document one coherent protocol: preserve concurrent refresh plus
CAS/supersession, with the loser observing the durable successor before
any family alarm; or add a separate bounded, crash-safe cross-process
refresh lease with fencing, expiry, and lock ordering. The ordinary
custody advisory lock must not be claimed to span network exchange, and
the LLP 0059 no-network-under-custody-lock rule stays intact unless
explicitly amended. The store implements the full POSIX file-safety
contract (0700 dirs, single-link 0600 files, symlink/ancestor refusal,
fsync, crash recovery); its bearer-persistence policy is deliberately
the opposite of agent custody's.

**Done when:**

- login/logout/whoami work process-per-command against a sessions-mode
  memory server; the session survives across invocations and dies on
  `logout`.
- Custody files are real 0600 non-symlink files under advisory lock;
  broader permissions or symlinks are refused (matching the agent
  custody discipline); concurrent invocations are safe.
- Two invocations spanning one refresh prove the selected refresh-race
  protocol: exactly one durable successor wins, the loser reloads it,
  and no family alarm fires while that successor is observable.
- Two `--profile` identities against one target hold distinct sessions
  and exercise an LLP 0056 role gate differently in a test.
- Session bearers appear only on their exact session-lifecycle routes
  and selected app-data requests, inserted by the engine parent — never
  in argv, env, logs, or output (planted-secret test).
- Login challenge codes and addresses pass the same planted-secret and
  no-second-hop redirect suite; no accepted code channel is argv or env.

## Triage note (2026-08-01 sweep) — likely superseded, pending program decision

The 2026-08-01 triage sweep found this ticket's premise re-decided:
the human-session path for non-browser protocol clients landed as
non-custodial bearer injection — createExternalSessionClient
(packages/snapback-client/index.mjs, @ref LLP 0096 §2), explicitly
mutually exclusive with coordinator/agent custody — and LLP 0096 pins
external session-bearer adoption and the trusted identity-broker seam
separately. The file-backed Node custody store this ticket designs was
never built. Recommended disposition: close as superseded when Charlie
rules on the app-cli program's shelving (see the sweep report); left
open only so the program decision is taken once, on the whole family.

## Superseded (2026-08-01, author decision)

Closed as superseded per Charlie's 2026-08-01 decision, on the
triage finding recorded below (2026-08-01 sweep note): the human-
session path for non-browser protocol clients was re-decided as
non-custodial bearer injection — createExternalSessionClient
(packages/snapback-client/index.mjs, @ref LLP 0096 §2), explicitly
mutually exclusive with coordinator/agent custody — and LLP 0096 pins
external session-bearer adoption and the trusted identity-broker seam.
The file-backed Node custody store this ticket designs was never built
and its premise no longer holds. If the shelved app-cli program is
recommissioned, session custody should be re-derived from LLP 0096,
not from this design.
