# Authenticated headless query started signed out can hang without settlement

**Status:** Open
**Opened:** 2026-08-20
**Systems:** Headless client, Auth, Queries, Settlement, Diagnostics
**Related:** LLP 0059; LLP 0095; LLP 0277 P16; LLP 0295; Diary 0099

## Problem

The Grok Coterie Familiar lane observed an authenticated `client.query`
started while signed out that never issued HTTP and did not settle with the
expected auth-required result. That made provider bootstrap indistinguishable
from a transport stall and prolonged M3 correction work.

## Requested repair

- Reproduce one-shot and live authenticated operations across signed-out,
  signing-in, signed-in, signing-out, and revoked states.
- Every one-shot operation must settle promptly with success or a classified
  auth/transition refusal; a live operation must project blocked/error with a
  transition owner.
- Add timeout-independent tests proving no operation remains pending merely
  because no transport request was admissible.

## Exit

Provider code can branch on a documented settlement state and never needs its
own timeout to detect signed-out admission.
