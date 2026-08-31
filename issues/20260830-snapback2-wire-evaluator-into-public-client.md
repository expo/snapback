# Snapback2: wire the evaluator into the public web client

**Status:** Open
**Systems:** snapback2, client, evaluator, receipts
**Severity:** P2
**Author:** Codex gpt-5.6-sol
**Date:** 2026-08-30
**Related:** LLP 1001 §10; LLP 1002 §9; LLP 0329.018 F1

## Problem

The standalone TypeScript evaluator is conformant with the Rust engine across
the 103-case frozen corpus, including the accounts/RBAC transition and
constraint cases. The published `snapback2/client` surface does not import or
execute it, and the current wire does not yet deliver the certified program
and receipt custody a local evaluation would require. LLP 1002 previously
described the target arm assignment as though this wiring already existed.

The server remains authoritative and the current client is honestly
server-backed, so this is not a server authorization bypass. It is a missing
client prediction/coverage capability and must not be represented as shipped.

## Done when

- The public web client receives a generation-bound certified program and the
  rows, ranges, absences, and verdicts required by the evaluator without
  inventing a second authority protocol.
- The web/Expo arm invokes `snapback2-evaluator`; the Contract-native arm uses
  `snapback2-core`, and no third evaluator locus is introduced.
- Successor, authentication-generation, receipt replacement, and reconnect
  fences prevent predecessor evaluation from publishing into current state.
- Package and acceptance tests demonstrate complete, partial, capped, denied,
  and corruption outcomes against the authoritative server.
- LLP 1002 §9 and the public guide describe the implemented custody path and
  measured bundle cost.
