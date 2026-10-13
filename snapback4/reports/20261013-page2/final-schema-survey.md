# PAGE2 final copied-schema survey after intrinsic-id planner repair

Surveyed commit: `24a644c511fc5a6888597af9335d894790eaeb97` (contains `d03a75c80e`).

The CLI was rebuilt only from the independent Snapback 4 workspace:

```sh
cd /home/ccheever/projects/sb4-w10-page2/snapback4
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo build -p snapback4
```

Current binary SHA-256: `ec6484404f92cedd91a6a3e38d2f161ee853c0b8d04589b309ccee56123d8cd4`.
Cached baseline binary SHA-256: `68618ea4b8b219930bc477630e2e735e51c3efcb51d4d0105e2d0aa920409b8e`.

The immutable odd-lane copy still has 50 `snapback/*.q` files. Its sorted relative-path/file-hash digest is `7a4725fa4895937190b6532280d8497ca9151ccfbb2fdbad6160885485af34ab`.

For each copied odd app:

```sh
(cd "$app" && /home/ccheever/projects/sb4-w10-page2/snapback4/target/debug/snapback4 check --json) > "$out/$name.json"
```

Artifact: `/tmp/sb4-page2-survey-current-final-r12a`; established sorted JSON digest `931dbc9cbc5312aa08d413b550785d538d0d3c7fb3b77aa7c4963e8f96dd8420`.
All 50 reports have `ok: true`.

Final odd-lane result remains **18 N_NEVER_COMPLETE notes in 11 schemas**, versus cached baseline **20 notes in 13 schemas**. No note was added. The removed notes are:

- `001-sourdough-starter-share` / `incomingRequests`
- `037-school-pickup-authorizations` / `myChildren`

The remaining 18 note identities are byte-for-byte unchanged from `/tmp/sb4-page2-survey-current-final-r6`:

- 013 `publicArchive`
- 033 `myPools`, `poolMembers`, `poolProposals`
- 039 `resultsFor`
- 041 `tasksFor`
- 059 `cleaningPhotos`, `siteCleanings`, `siteReadings`
- 079 `allSlots`, `visitNote`
- 085 `classInbox`
- 093 `logsForCrew`
- 095 `inspectionDisputes`
- 097 `boatDetail`
- 099 `acceptedOffer`, `currentOffer`, `offersFor`

Thus the reason accounting also remains 12 role-grant pages, 3 compound/non-equality or multi-branch pages, 2 hidden private-source parent-owner inversions, and 1 pure-membership page. The intrinsic-id planner repair does not newly clear one of those excluded shapes.

The named copied even-lane source digest remains `47a155c2fcd9bec46b7f7b7a005f3b2b12a78692addcddb8ddee5335add496cf`. Artifact `/tmp/sb4-page2-survey-even-current-r12a`, sorted JSON digest `5d12d8b462ecf78e506c0a0e3ea52a77ceec4f286a4539df61178c995907370d`: both reports have `ok: true`, and both remain at zero N_NEVER_COMPLETE notes:

- 002 `myHouseholds`: baseline 1 -> current 0
- 098 `myEstates`: baseline 1 -> current 0
