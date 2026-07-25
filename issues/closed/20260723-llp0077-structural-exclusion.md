# Structural bearer exclusion for the hosted browser client

**Status:** Closed (2026-07-24)
**Severity:** P1
**Systems:** Auth, Browser client, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0077 §Browser custody + defect 8, LLP 0060 (structural-exclusion prerequisite), packages/snapback-client/hosted-browser.mjs (extends SnapbackClient), packages/snapback-client/index.mjs (writable transport fields, mutable senderConstrained), issues/20260723-llp0077-senderauth-program.md
**Marker:** llp-0077, sender-auth, client, structural

**Resolution (2026-07-24, re-landed on main):** the hosted artifact
(`packages/snapback-client/hosted-browser.mjs`) is a frozen non-inheriting
composition facade. `hosted-browser.test.mjs` proves the generic client is
absent from its prototype graph and that bearer options/setters, direct
field writes, and prototype mutation refuse; non-HTTPS origins are excluded.

Closes LLP 0077 ledger **defect 8**. `HostedBrowserSnapbackClient extends
SnapbackClient`, so the generic bearer-accepting constructor is reachable via
the prototype chain, and inherited transport fields plus the mutable
`senderConstrained` flag are writable — the structural exclusion LLP 0060
requires is not structural. LLP 0060 makes structural exclusion (not a usage
convention) a hosted prerequisite.

**Done when:**

- The hosted entrypoint is a non-inheriting façade (or the sender posture is
  intrinsic to v3 custody) with private/frozen transport and authority state and
  no reachable bearer constructor.
- Sentinels cover exports, constructor options, `setBearerToken`, prototype-graph
  reachability, and direct field mutation — all proving no direct-bearer path.
- LLP 0077's defect 8 row moves to closed; the checkpoint's structural-exclusion
  language becomes a positive claim.
