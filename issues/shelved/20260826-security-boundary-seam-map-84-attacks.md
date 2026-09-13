# Authorization denominator and security-boundary seam map

**Status:** Open
**Date:** 2026-08-26
**Systems:** security-boundary fixtures, row attacks, authorization seams
**Related:** LLP 0284, LLP 0303,
`issues/shelved/20260826-nine-compiling-security-boundary-attacks-are-reachable.md`

## Result

The 84-attack security-boundary population contains 77 product-effect attacks
and seven witnesses that legitimately have no row. After adding F319–F321,
**zero product-effect attacks still need a new row identity**:

| Disposition | Attacks |
| --- | ---: |
| Already covered by a pre-existing row | 74 |
| Newly rowed here (F319–F321) | 3 |
| Legitimately no row | 7 |
| Still needs a new row | **0** |
| **Total** | **84** |

This does not mean the machine join is complete. The advertised baseline has
13 attacks carrying `row`/`rows`; F319–F321 raise that to 16. Of the remaining
68 attacks, 61 are product witnesses whose existing mapping still needs to be
backfilled into `attacks.v1.json`, while seven are the no-row witnesses below.
The new-row gap is zero; the metadata-backfill gap is 61.

## Snapshot reconciliation: 77 versus 84

The exact fetched and rebased `origin/main` used by this lane was
`94760a651a1843ecaa79512686e57a75d754878a`. It contains 77 registered attacks
and none of the advertised F313–F318 declarations. The advertised 84/13 state
is the exact union of that 77-entry base with these seven concurrent row-owned
attacks and the six F313–F318 declarations:

| Concurrent attack | Existing row |
| --- | --- |
| `cross-session-publication-authority` | F097 |
| `cross-session-handler-claims` | F122 |
| `record-effect-approver-without-authority` | F129 |
| `publish-scope-retirement-without-commit` | F082 |
| `poison-scope-retirement-ceiling` | F082 |
| `f145-prepare-asset-callbacks-authority` | F145 |
| `f272-supply-ticket-and-effect` | F272 |

Those seven declarations plus the five pending-effect declarations and the raw
SQL declaration F318 account for all 13 advertised `row`/`rows` fields. The
classification below uses that union, but this lane does not copy concurrent
fixture changes into the older rebased tree.

## Classification of all 84 attacks

`Existing` means the attack is another spelling, producer, consumer, or
composition of an already-owned effect. It must receive that existing row in a
future metadata-backfill landing; it must not receive another numeric identity.
`Added` means this lane created the missing identity and executed its effect.
`None` is limited to the feature-off negative control and LLP 0284 §6.3's six
retired-spelling witnesses, which that specification explicitly says “are not
coverage.”

| # | Attack | Disposition | Row / reason |
| ---: | --- | --- | --- |
| 1 | `claim-kernel-commit-authority` | Existing | F231 |
| 2 | `claim-via-auth-reexport` | Existing | F231, alternate re-export route |
| 3 | `claim-via-engine-reexport` | Existing | F231, alternate re-export route |
| 4 | `register-oauth-via-raw-engine-database` | Existing | F170, including its executed second-handle route |
| 5 | `admit-system-push` | Existing | F223 producer + F256 durable reservation sink |
| 6 | `admit-protected-record-erasure` | **Added** | **F319** |
| 7 | `admit-pending-effect-creation` | Existing | F313–F317 pending-effect family; use the concurrent operation-specific join |
| 8 | `admit-pending-effect-approval` | Existing | F313–F317 pending-effect family; use the concurrent operation-specific join |
| 9 | `admit-pending-effect-denial` | Existing | F313–F317 pending-effect family; use the concurrent operation-specific join |
| 10 | `admit-pending-effect-settlement` | Existing | F313–F317 pending-effect family; use the concurrent operation-specific join |
| 11 | `admit-pending-effect-refusal` | Existing | F313–F317 pending-effect family; use the concurrent operation-specific join |
| 12 | `clone-kernel-commit-authority` | Existing | F231, carrier-linearity spelling |
| 13 | `auth-commit-reservation-factory` | Existing | F240 reservation effect |
| 14 | `auth-commit-prepared-factory` | Existing | F247 prepared-commit effect |
| 15 | `service-interlock-factory` | Existing | F115 + F227, with F117 as the kernel sibling |
| 16 | `forge-service-terminal-receipt` | Existing | F115 terminal-preparation carrier family |
| 17 | `clone-service-terminal-plan` | Existing | F112 terminal-gate effect |
| 18 | `drop-service-terminal-gate` | Existing | F112 terminal-gate effect |
| 19 | `split-expired-service-terminal` | Existing | F112 terminal-gate effect |
| 20 | `forge-service-authority-deadline-terminal` | Existing | F112 terminal-subject effect |
| 21 | `substitute-service-publication` | Existing | F113 + F175 publication/authority join |
| 22 | `synthetic-resolved-service-authority` | Existing | C006 + F113 + F175 publication/authority join |
| 23 | `arbitrary-service-terminal-plan` | Existing | F112 terminal-plan effect |
| 24 | `supply-service-terminal-subject` | Existing | F112 terminal-subject effect |
| 25 | `forge-service-authority-witness` | Existing | C006 |
| 26 | `register-service-authority-witness` | Existing | F113, consuming C006 |
| 27 | `services-rusqlite-reexport` | Existing | F318 |
| 28 | `services-rusqlite-reexport-default` | **None** | Feature-off negative control for F318 |
| 29 | `forge-erasure-authority` | **None** | LLP 0284 §6.3 retired-spelling witness |
| 30 | `forge-push-system` | **None** | LLP 0284 §6.3 retired-spelling witness |
| 31 | `fake-authorization-interlock` | **None** | LLP 0284 §6.3 retired-spelling witness |
| 32 | `fake-sender-proof-store` | **None** | LLP 0284 §6.3 sealed-trait witness |
| 33 | `raw-pending-effect-transition` | **None** | LLP 0284 §6.3 retired-spelling witness |
| 34 | `obtain-writable-sql-handle` | **None** | LLP 0284 §6.3 retired-spelling witness |
| 35 | `default-kernel-commit-authority` | Existing | F231, construction spelling |
| 36 | `deserialize-kernel-commit-authority` | Existing | F231, construction spelling |
| 37 | `construct-push-storage-authority` | Existing | F223 + F256 carrier spelling |
| 38 | `kernel-test-support-for-test-factory` | Existing | F240 + F247 test-support factory spelling |
| 39 | `kernel-test-support-join-authority` | Existing | F231 test-support producer spelling |
| 40 | `recording-interlock-bind` | Existing | F115 + F227/F117 test-support sibling |
| 41 | `obtain-promotion-contention-reservation` | **Added** | **F320** |
| 42 | `obtain-ask-spend-reservation` | Existing | F258 common durable sink; F257/F259 wrappers and C014 carrier are the same effect |
| 43 | `forge-membership-writer-admin` | **Added** | **F321** |
| 44 | `reserve-authorization-via-sync` | Existing | F161 wrapper → F240 reservation sink |
| 45 | `clone-authorization-participant` | Existing | F228 participant carrier |
| 46 | `default-authorization-participant` | Existing | F228 participant carrier |
| 47 | `construct-authorization-participant` | Existing | F228 participant carrier |
| 48 | `name-prepared-authorization-commit` | Existing | F247 prepared-commit carrier |
| 49 | `default-authorization-cancellation` | Existing | F245 |
| 50 | `construct-authorization-outcome` | Existing | F247 commit-outcome carrier family |
| 51 | `construct-authorization-view` | Existing | F230 producer + F249 constructor |
| 52 | `shared-serving-database-unmediated-insert` | Existing | F231 owner-root reachability spelling |
| 53 | `shared-serving-database-deref-unmediated-insert` | Existing | F231 owner-root reachability spelling |
| 54 | `obtain-admitted-projection-snapshot` | Existing | F094 producer spelling |
| 55 | `rebuild-session-projection-from-raw-source` | Existing | F094 |
| 56 | `supply-agent-registration-mode` | Existing | F182 registration composition |
| 57 | `compose-agent-registration-partials` | Existing | F182 registration composition |
| 58 | `clone-secret-read-operator` | Existing | F297/F298 operator/registry mint family |
| 59 | `mint-secret-read-lease-from-registry` | Existing | F297 |
| 60 | `c009-literal-invalidation-connection` | Existing | C009 |
| 61 | `c009-clone-invalidation-connection` | Existing | C009 |
| 62 | `c009-deserialize-invalidation-connection` | Existing | C009 |
| 63 | `c009-build-invalidation-admission` | Existing | C009 |
| 64 | `c009-alternate-generation-reservation` | Existing | C009 |
| 65 | `construct-resolved-app-authority-from-parts` | Existing | C005 |
| 66 | `join-and-carry-resolved-app-authority` | Existing | C005 producer + F143 join |
| 67 | `supply-obligation-authorization` | Existing | F084 obligation-expectation family |
| 68 | `replace-obligation-expectation` | Existing | F084 obligation-expectation family |
| 69 | `forge-live-invalidation-issuer` | Existing | F075, consuming caller-constructible C008 |
| 70 | `clone-live-invalidation-issuer` | Existing | F075 carrier-linearity spelling |
| 71 | `reuse-live-invalidation-issuer` | Existing | F075 carrier-linearity spelling |
| 72 | `sign-scope-retirement-directly` | Existing | F082 |
| 73 | `cross-engine-recorded-mutation-authority` | Existing | F279 |
| 74 | `independent-authority-stream-descriptor` | Existing | F149 |
| 75 | `resolved-only-authority-descriptor` | Existing | F150 |
| 76 | `generation-recorded-mutation-authority` | Existing | F280 |
| 77 | `wire-descriptor-trust` | Existing | C012 carrier → F279 sink |
| 78 | `cross-session-publication-authority` | Existing | F097 |
| 79 | `cross-session-handler-claims` | Existing | F122 |
| 80 | `record-effect-approver-without-authority` | Existing | F129 |
| 81 | `publish-scope-retirement-without-commit` | Existing | F082 |
| 82 | `poison-scope-retirement-ceiling` | Existing | F082 |
| 83 | `f145-prepare-asset-callbacks-authority` | Existing | F145 |
| 84 | `f272-supply-ticket-and-effect` | Existing | F272 |

## New-row execution evidence

All three new rows compile and execute in both corpus feature cells. Because
they are OPEN, there is no rustc failure line or `E` code to report and the
ledger carries no `expectedCode`.

| Row | `@attack` line | Production observation | Additive-test-support observation |
| --- | ---: | --- | --- |
| F319 | `src/attacks/f319.rs:53` | OPEN — durable target absent, delete version 2, caller-selected principal retained as authority | Same |
| F320 | `src/attacks/f320.rs:12` | OPEN — caller-selected reservation activated; interval 1000 ms, max commit 500 ms | Same |
| F321 | `src/attacks/f321.rs:66` | OPEN — direct `MembershipWriter::Admin` plan committed and typed membership projection read back the durable admin row for `victim-principal` | Same |

The first F321 readback attempt used the generic point-read surface and was
refused with `SNAPBACK_MEMBERSHIP_READ_PRIVATE` *after the commit*. That was not
counted as closure: the final witness uses the membership-aware projection and
observes the durable row. No new row is recorded CLOSED, so LLP 0303's required
alternate-composition evidence for a closure claim is not triggered.

## Follow-up

Backfill the 61 existing-row joins into the security-boundary JSON after the
concurrent 84/13 union lands. This is mechanical metadata work but must be
staged with corresponding row-corpus coverage because
`validateRowAttackInventory` rejects a security row absent from the executable
row ledger. Do not create new row identities during that backfill.
