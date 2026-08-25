
## Resolution (2026-08-24, S1 fix round)

LLP 0058 makes the session bearer header canonical and rejects body `auth`
under sessions, so the server side was the drifted one:
`MutationAcknowledgementRequest.auth` is now `#[serde(default)]`
(wire-optional; legacy dev body authority still admitted; the shared
authority gate still rejects body auth presence under sessions), @ref'd to
LLP 0058. Served regression
`sessions_bearer_can_acknowledge_without_legacy_body_auth_and_drop_retention`
proves mint → explicit-id mutation → header-authenticated acknowledge →
2xx with one removed settlement. The replay helper's minted custody
completes its acknowledge flush in sessions mode (replay suite 22/22).
Recorded normatively as LLP 0307.000 r4 item 11.
