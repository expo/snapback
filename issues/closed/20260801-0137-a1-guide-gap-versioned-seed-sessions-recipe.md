# A1 sweep guide-gap: versioned-seed reset on a sessions app needs an undocumented custody + mode recipe

**Opened:** 2026-08-01
**Systems:** Guide, Client integration
**Related:** LLP 0137 (A1 arm), LLP 0109, guide/backend/versioned-seeds.md, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f9-versioned-seed-sessions-custody-recipe.json

Three undocumented discoveries were needed to run
`resetInstallVersionedSeed` against a sessions-mode app: (1) an
adminToken-only client cannot offer the auth-client protocol — the admin
client must also carry a session bearer
(`createExternalSessionClient(url, { bearerToken, adminToken })`); (2) the
seed methods default `requestedMode` to dev, refusing sessions apps with
`SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` until `requestedMode: 'sessions'` is
passed on every call; (3) the active `expectedDataVersionStream` comes from
`preview.current.dataVersionStream`. Once known, the loop is excellent and
avoids the A2-f7 raw-reset wedge entirely (next `snapback dev` accepted the
database).

Fix shape: a sessions-mode reset snippet in the versioned-seeds or acceptance
page; ideally default `requestedMode` from the active app mode.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** guide/backend/versioned-seeds.md §"Run the loop against a sessions-mode app" documents all three discoveries: the bearer+adminToken client construction, the explicit `requestedMode: 'sessions'` (with why the default refuses), and `preview.current.dataVersionStream` as the expected stream, plus the reset/identity consequence.
