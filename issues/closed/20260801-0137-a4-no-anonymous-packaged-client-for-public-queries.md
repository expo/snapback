# A4 sweep: the packaged client cannot make anonymous public-query requests outside a browser

**Opened:** 2026-08-01
**Systems:** Client integration, Auth
**Related:** LLP 0137 (A4 arm), demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f6-no-anonymous-packaged-client-for-public-queries.json

A sessions server serves `auth:'public'` queries to an anonymous request
carrying only `x-snapback-auth-client-protocol: 1` — but the packaged
SnapbackClient cannot be constructed to send that request from node:
without options it sends no offer (server refuses
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`), and `{authClientProtocol: 1}`
without a bearer throws "authClientProtocol v1 requires browser, agent,
or explicit external-bearer custody". The anonymous public event preview
(the Partiful page, A4-02) is unreachable from any headless consumer —
suites, SSR, and prerender paths must hand-roll fetch.

Fix shape: an explicit anonymous custody mode (e.g.
`custody:'anonymous-public'`) that sends the offer with no credential and
is accepted only for public-auth operations, documented beside the
public-query declaration. Witness: node client reads a public query on a
sessions server and is refused on any protected operation.

---

**RESOLVED 2026-08-01 (fix-wave α1).** `new SnapbackClient(baseUrl,
{ custody: 'anonymous-public' })` sends the auth-client protocol offer
with no credential, skips the credential handshake, and is mutually
exclusive with browser/agent/bearer custody; auth-required operations
receive the server's ordinary anonymous refusal. Typed in index.d.mts;
proven in app-data.test.mjs (offer header sent, no authorization
header, public query served, exclusivity refusals).
