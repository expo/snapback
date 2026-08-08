# guide-gap: sessions-mode non-session clients need authClientProtocol + custody together

**Status:** Closed (2026-08-08)
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** Guide, Auth, Client packages
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

Constructing an admin/inspection (non-session) client against a
sessions-mode server requires BOTH `authClientProtocol: 1` and
`custody: 'anonymous-public'`; two measurement lanes discovered the pair by
iteration (one refusal names each half, neither names both). State the
combination in guide/auth/sessions-and-principals.md's client-construction
section, and consider having `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`
name the complete option set.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.
- **Resolved 2026-08-08:** guide/auth/sessions-and-principals.md ("Read public
  data anonymously") now states the complete pair with a transcluded snippet
  witnessed by packages/snapback-client/app-data.test.mjs (a non-session
  inspection client whose admin token rides alongside anonymous-public
  custody), and the `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` missing-offer
  refusal in src/server.rs now names both `authClientProtocol: 1` and
  `custody: 'anonymous-public'` after the header repair. Rust message change
  verified by the touched src/server.rs protocol-gate tests on the Linux
  release box; JS test verified locally.
