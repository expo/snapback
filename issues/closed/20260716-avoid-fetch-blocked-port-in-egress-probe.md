# Avoid a Fetch-blocked port in the egress capability probe

**Status:** Closed
**Severity:** P1
**Systems:** Actions, Egress, All Aboard acceptance, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0036
**Marker:** build-integrity, egress, regression

The All Aboard egress probe used loopback port 9 to obtain an expected rejected
network promise without contacting an external service. Port 9 is on the Fetch
Standard's blocked-port list, so the pinned runtime rejects `Request`
construction synchronously. The acceptance test then mistakes that platform
URL refusal for evidence that the action did not receive callable `fetch`.

**Done when:**

- The probe uses an ordinary loopback port while continuing to inspect only
  whether `fetch` returns a promise.
- It never awaits the request or depends on a listener or external network.
- The egress-enabled action reports `available`, while query and default-off
  action paths still prove the capability deny stub throws synchronously.
- Generated probe artifacts and the canonical proof are current.

## Resolution

Closed 2026-07-16. Both probe handlers now share a loopback URL on ordinary
high port 65534. The returned promise is immediately given success and failure
handlers but is not awaited, preserving the no-external-network acceptance
shape while avoiding Fetch's blocked-port preflight.
