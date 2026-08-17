# Qualified release pickup: shipped SecureStore custody adapter (post-0.1.22)

**Opened:** 2026-08-15 (familiar native-custody landing)

This landing adds npm-facing surface on top of the 0.1.22 cut: the
`@expo/snapback-contract/auth-custody-secure-store` subpath
(`createSecureStoreAuthCustodyStorage`, the first-party native session
custody adapter the familiar guide previously told authors to hand-roll),
with the `guide/backend/familiar-profile.md` custody section rewritten to
consume it. Per the LLP 0041 rapid-publication posture,
landed-but-unpublished surface is a liability: the next qualified release
ceremony should pick this up, and the guide's unreleased fence on the
subpath sweeps when `guide/published-closure.json` advances past 0.1.22.

Design record: LLP 0059 amendment of 2026-08-15 (ordinary bearer custody
only; sender-constrained records refuse typed; in-process ownership with
null `broadcastChannelFactory`/`hintStorage` on native).

Close when a qualified release newer than 0.1.22 publishes the subpath and
the guide fence sweep lands.

## Resolution — 2026-08-17

Discharged by the 0.1.24 qualified publication (thirteen-package closure from
`f8cbf3d253b59d747572ec166750efc208709686`, including the custody package's
first publish and the post-0.1.23 client/expo/codegen surface). See LLP 0041
§0.1.24.
