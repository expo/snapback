# Public-immutable and signed URLs are not pasteable in sessions mode

**Status:** OPEN — found building demos/party-wall (diary 0041 finding 7)

Sessions-mode servers refuse every request without
`x-snapback-auth-client-protocol: 1`, including `GET /assets/public/…`
and signed-URL redemptions. Both profiles' product story is bearer/cache
pasteability — `<img src>`, CDN pull, share-link-in-an-email — none of
which can send a custom header. The W2b profile semantics are right; the
transport admission in front of them defeats their purpose.

Likely fix: exempt the anonymous asset delivery lanes (public alias +
valid signed token) from the auth-client protocol requirement — they
carry no session authority to negotiate. Needs the 0058/0096 owners'
eyes; LLP 0044's delivery sections should then record the admission rule.
Also related: a browser-safe sessions sign-in story for demos (Party
Wall reads the dev mailbox with an admin token in a Vite env — fine
locally, not a story).

---

**RESOLVED 2026-08-01** (author-approved 2026-07-31: "your rec seems
reasonable"). The two URL-authority serve lanes are exempt from the
sessions-mode auth-client protocol-offer requirement via the closed
`pasteable_delivery_route` predicate (structural properties AND the
explicit path pair) in `session_online_protocol_refusal`; issuance,
strict delivery, and every other asset route keep the discipline.
Recorded as the LLP 0044 §Delivery profiles dated note and the LLP 0031
asset-family dated addition; proven by the Rust unit test
(`pasteable_delivery_lanes_skip_the_sessions_protocol_offer`) and
conformance Vector 11 (headerless plain GET serves on both lanes over a
real sessions server; strict headerless keeps refusing). Residual,
deliberately out of this ticket's scope: the browser-safe sessions
sign-in story for demos (Party Wall reads the dev mailbox with an admin
token) — a demo-tooling concern the diary records.
