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
