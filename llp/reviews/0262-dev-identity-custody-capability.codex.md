# Reviews: LLP 0262 — Dev identity becomes a custody capability

## Round 1 — 2026-08-15 — codex family

**Runtime:** codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=xhigh -s read-only
**Target revision (sha256):** 7f1ca7cf4d4aef28407df4591c9baac93b7deea041a8bd5f6e652a5cc265d7ab
**Capsule:** git archive fa81cd856 minus llp/reviews/0262* (tar sha256 first-16 39f3385a0932fc02)
**Instructions (sha256 first-16):** 965e8344aca27f39
**Blindness:** structural
**Verdict: NOT READY**

### Verbatim review

1. **Serve-time browser injection destroys the custody proof**

   **Severity:** MATERIAL

   **Defective decision:** D2 treats an unauthenticated browser bootstrap as a controlled handoff. Once `sbdev_` is embedded in Vite/Metro-served code or configuration, any local, LAN, or tunnelled caller able to fetch that resource receives the bearer. The RFC would close a tunnel directly to Snapback, but not a tunnel or LAN path through the dev host. OQ1’s framing is defective because it assumes only launcher-selected clients become holders.

   **Evidence:** D1–D2 promise that only developer-launched clients receive the capability ([LLP 0262:109](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/llp/0262-dev-identity-custody-capability.rfc.md:109)). LLP 0168 instead requires an access capability covering first navigation, assets, relay HTTP, HMR, and upgrades ([LLP 0168:169](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/llp/0168-browser-carrier-dev-edge.research.md:169)). The current Vite virtual module explicitly contains no secrets or backend origin ([packages/snapback-vite/index.mjs:181](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-vite/index.mjs:181)), while non-loopback Vite exposure is permitted with a warning ([packages/snapback-vite/index.mjs:199](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-vite/index.mjs:199)). The relay has no client-authenticated bootstrap and forwards inbound headers ([packages/snapback-vite/proxy.mjs:110](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-vite/proxy.mjs:110)). LLP 0030 currently forbids Vite/browser exposure of custody sidecars ([LLP 0030:409](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/llp/0030-managed-snapback-vite-dev.rfc.md:409)).

   **Suggested disposition:** Keep the raw dev-identity bearer out of generally served code. Either design an authenticated first-navigation/redemption carrier satisfying LLP 0168, or narrow this RFC to custodial non-browser clients and leave browser/LAN/front delivery explicitly unresolved.

2. **The dedicated-header rule leaves WebSocket dev assertions ungated**

   **Severity:** MATERIAL

   **Defective decision:** D1 requires a header on each request asserting dev identity, but dev WebSocket frames assert identity in-band after a public connection handshake. Browser `WebSocket` cannot attach an arbitrary header. Implementing only D6’s HTTP acceptance chokepoint would leave a bypass; requiring the header literally would break browser live/ephemeral clients.

   **Evidence:** `/connection/open` is public in dev mode ([src/server.rs:9443](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/server.rs:9443)). Live operations combine a bound connection grant with `ClientAsserted` authority ([src/server.rs:18118](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/server.rs:18118)). Dev mode decodes the legacy socket DTO directly ([src/server.rs:30049](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/server.rs:30049)); its publish/delete/subscribe requests carry `auth` fields ([src/ephemeral.rs:1103](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/ephemeral.rs:1103), [src/ephemeral.rs:1217](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/ephemeral.rs:1217)). The browser client opens sockets with URL and subprotocols only ([packages/snapback-client/index.mjs:11134](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-client/index.mjs:11134)).

   **Suggested disposition:** Define a connection-bound proof: optionally present the dev capability on `/connection/open`, bind a verified witness into the resulting grant, and reject identity-bearing dev frames unless their connection carries that witness. Add the live-operation registry and reconnect/restart behavior to D6 and acceptance.

3. **D3 breaks the credential-free console approval bootstrap**

   **Severity:** MATERIAL

   **Defective decision:** D3 claims console flows remain unaffected while removing bare-loopback AdminRead. The console’s approval-request and approval-poll endpoints are deliberately AdminRead and deliberately send no credential. The served admin console is not a D2 recipient, so both calls would fail.

   **Evidence:** The routes are explicitly AdminRead because a browser may request and poll before terminal approval ([src/admin.rs:4248](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/admin.rs:4248)). `AdminClient` calls both with credential attachment disabled ([packages/snapback-admin-client/index.mjs:117](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-admin-client/index.mjs:117)). The alternative direct console mint requires the master token ([src/admin.rs:4990](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/admin.rs:4990)).

   **Suggested disposition:** Decide a separate, narrowly bounded bootstrap policy for approval request/poll, or design another console-onboarding credential. Do not solve this by injecting the raw dev capability into the server’s public admin page, which would recreate the tunnel exposure.

4. **The app-plane dev bearer is over-promoted to operator-wide AdminRead**

   **Severity:** MATERIAL

   **Defective decision:** D3 makes a credential distributed to ordinary app clients satisfy the complete AdminRead policy. That grants those clients raw schema-table scans, receipts, control metadata, and console-bootstrap operations, bypassing application authorization. It also creates a new privilege on a non-loopback dev bind, where tokenless admin reads currently return `Disabled`.

   **Evidence:** Current non-loopback reads require a valid admin credential ([src/admin.rs:3641](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/admin.rs:3641)). The dev AdminRead data endpoint performs an unrestricted schema-aware table scan ([src/admin.rs:5441](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/admin.rs:5441)). The route model deliberately keeps path policy and credential resolution independent, with AdminRead currently requiring `AdminCredential` ([src/server.rs:7468](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/server.rs:7468), [src/server.rs:7922](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/server.rs:7922)). LLP 0039 likewise treats app/browser and operator credentials as distinct authority classes ([LLP 0039:442](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/llp/0039-auth-vertical-slice.rfc.md:442)).

   **Suggested disposition:** Keep ordinary AdminRead on admin/console credentials, with explicit narrow exceptions for any public bootstrap routes. If some admin projection genuinely belongs to dev clients, define a separate scoped policy rather than changing `evaluate_access` wholesale.

5. **D2’s carrier matrix does not match the shipped Vite, Expo, or direct-start topologies**

   **Severity:** MATERIAL

   **Defective decision:** The rollout assumes the listed clients already possess a trustworthy injection path. Several do not, so stage-3 enforcement would either break supported workflows or force unsafe ad hoc carriage.

   **Evidence:** Vite `external` mode accepts only a URL and explicitly has no credential discovery ([packages/snapback-vite/lifecycle.mjs:437](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-vite/lifecycle.mjs:437)); the claimed existing origin injection is also factually false—the virtual module exposes only a relative base path and sanitized state. Packaged `snapback dev --expo` is a sessions-only, credential-free loopback rendezvous that returns an ordinary session ([packages/snapback-expo/README.md:45](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-expo/README.md:45), [packages/snapback-cli/expo-dev.mjs:1358](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-cli/expo-dev.mjs:1358)); physical iOS is expressly refused ([packages/snapback-cli/expo-dev.mjs:1226](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/packages/snapback-cli/expo-dev.mjs:1226)). Native `snapback start` makes `--ready-file` optional ([src/cli.rs:767](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/cli.rs:767)), so D1’s mandatory sibling does not always exist. Finally, the preserved origin gate accepts only loopback origins ([src/admin.rs:283](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/admin.rs:283)), so a LAN browser origin does not become viable merely by adding this capability.

   **Suggested disposition:** Replace D2 with a topology-specific matrix for managed, attach, external, raw start with/without a ready file, Expo simulator/Android, and physical iOS. Each row needs an actual bounded carrier or an explicit refusal. Preserve physical-iOS/LAN browser status as unsupported until a carrier is accepted.

6. **The baseline misstates both locality and admin-token minting**

   **Severity:** implementation-phase

   **Evidence:** The RFC repeatedly calls the inference a loopback “transport peer” inference, but `resolve_profile` uses the listener’s bind-derived `loopback` value, not the remote peer address ([src/admin.rs:322](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/admin.rs:322)). It also claims every served instance resolves or mints an admin token, while startup does so only when `loopback && admin_token.is_none()` ([src/cli.rs:8456](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/src/cli.rs:8456)). A tokenless non-loopback instance instead disables admin reads and writes.

   **Suggested disposition:** Replace “transport peer” with “listener/bind-derived profile,” and qualify token minting as applying to served loopback instances. The narrower conclusion—HTTP writes remain custody-gated or disabled—still holds.

7. **The rollout’s “startup warning on assertion” timing is impossible**

   **Severity:** implementation-phase

   **Evidence:** Stage 1 says to log “once, startup” when a later request asserts dev identity without the capability, and Stage 2 repeats the startup characterization ([LLP 0262:154](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r1-codex/llp/0262-dev-identity-custody-capability.rfc.md:154)).

   **Suggested disposition:** Specify either an unconditional startup warning or a request-time warning emitted once per boot on the first capability-less assertion. The latter can measure legacy use without logging identity or bearer data.

The strict per-boot, digest-only sidecar mechanism is feasible and consistent with the repository’s existing custody primitives, and declared `fronted` exposure is a sensible tightening input. The proposal is nevertheless not ready because its browser delivery turns custody back into reachability, its live transport has an ungated identity path, D3 breaks console onboarding and conflates app/admin authority, and the advertised injection matrix does not exist across the shipped clients.

VERDICT: NOT READY

## Round 2 (delta) — 2026-08-15 — codex family

**Target revision r2 (sha256 first-16):** 22ba760d2d28b9ce
**Capsule:** pristine r1 clone + r2 overlay (tar sha256 first-16 13b29623e5262d06)
**Instructions (sha256 first-16):** ca01a2ee53db1a00
**Blindness:** structural
**Verdict: NOT READY (4 MATERIAL in-delta, 1 MATERIAL pre-existing)**

### Verbatim review

1. Claim-link redemption is stranded by D3  
   **IN-DELTA · MATERIAL**  
   **Defective decision:** D3 preserves only approval-request and approval-poll as pre-credential `AdminRead` exceptions. `/_snapback/api/console/claim/exchange` is also intentionally `AdminRead`; it redeems a claim-body bearer into the caller’s first console credential. The global authorization gate runs before that handler, so requiring an admin token or existing console credential makes claim redemption impossible.  
   **Evidence:** [src/admin.rs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/src/admin.rs:4194), [src/server.rs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/src/server.rs:13360), [LLP 0017](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/llp/0017-admin-console-inspection-surface.rfc.md:584).  
   **Suggested disposition:** Give claim exchange an explicit claim-credential resolution/carve-out, amend LLP 0017, and test authorization ordering through successful first-credential redemption.

2. The database-sibling anchor does not exist for supported in-memory servers  
   **IN-DELTA · MATERIAL**  
   **Defective decision:** D1 selects `<db>.dev-identity` because the database anchor supposedly always exists, but `snapback start --memory` has no database path. The shared `_kit` defaults to `:memory:` and therefore cannot perform D2’s proposed database-sibling harvest. Raw interactive `start --memory` can also omit a ready file, leaving no specified carrier at all.  
   **Evidence:** [src/cli.rs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/src/cli.rs:8168), [demos/_kit/server-process.mjs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/demos/_kit/server-process.mjs:628), [RFC D1–D2](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/llp/0262-dev-identity-custody-capability.rfc.md:78).  
   **Suggested disposition:** Define an anchor matrix: database sibling for file-backed instances, a ready-file sibling for memory instances with readiness, and an explicit terminal/output-file carrier or typed refusal for memory instances without readiness.

3. The Expo carrier contradicts the no-bootstrap/no-browser exposure invariant  
   **IN-DELTA · MATERIAL**  
   **Defective decision:** D2 says the bearer never enters served bootstrap or browser-visible material, then sends it through Expo’s HTTP bootstrap exchange. That exchange serializes its payload to the client, and supervised Expo web—currently supported—fetches it from browser JavaScript. The implementation cannot satisfy both decisions.  
   **Evidence:** [packages/snapback-cli/expo-dev.mjs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/packages/snapback-cli/expo-dev.mjs:1004), [packages/snapback-expo/supervised-environment.mjs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/packages/snapback-expo/supervised-environment.mjs:306), [RFC D2](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/llp/0262-dev-identity-custody-capability.rfc.md:107).  
   **Suggested disposition:** Specify distinct native and web carriers. A native rendezvous exception may be documented under LLP 0181’s reachability model; Expo web needs relay-side stamping or an explicit, justified removal from support.

4. The Expo topology matrix silently omits shipped web and physical-Android paths  
   **IN-DELTA · MATERIAL**  
   **Defective decision:** “Simulator/emulator only, as today” is false. `snapback dev --expo` supports web, and its Android routing explicitly admits physical USB devices through per-serial `adb reverse`; only TCP/IP Android and physical iOS are refused. D5 therefore cannot claim every supported topology is witnessed, and enforcement would regress unlisted clients.  
   **Evidence:** [packages/snapback-cli/index.mjs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/packages/snapback-cli/index.mjs:3825), [packages/snapback-cli/expo-dev.mjs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/packages/snapback-cli/expo-dev.mjs:381), [LLP 0181](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/llp/0181-zero-configuration-expo.rfc.md:649).  
   **Suggested disposition:** Split the row into iOS simulator, Android emulator, Android physical USB, and web; retain separate refusals for physical iOS and Android TCP/IP/LAN. Assign a carrier and acceptance witness to each supported row, or make any support removal explicit with migration rationale.

5. Pre-authentication refusals disclose the server’s filesystem path  
   **PRE-EXISTING · MATERIAL**  
   **Defective decision:** The RFC requires the refusal remediation to name the exact sidecar path. At this gate the caller is unauthenticated, and ordinary `ApiError` serialization returns the complete diagnostic message and details. Thus callers arriving through the very front being closed can learn operator-only local path information.  
   **Evidence:** [RFC D1](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/llp/0262-dev-identity-custody-capability.rfc.md:78), [src/server/api_error.rs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/src/server/api_error.rs:1711), [src/diagnostic.rs](/private/tmp/claude-501/-Users-ccheever-projects-snapback/b7be81b8-4e2a-4c7d-ab91-c450c54d72e6/scratchpad/sr0262/capsule-r2-codex/src/diagnostic.rs:33).  
   **Suggested disposition:** Keep the network refusal generic and non-oracular. Emit the exact sidecar path only in local server logs or custody-holding CLI diagnostics.

Overall, the authority-installation gate, connection-grant witness, relay-side Vite stamping, D4 truth table, and topology-honest deputy residual are sound directions. The claim-exchange deadlock and incomplete/contradictory carrier model are implementation-blocking design defects, however, and the unauthenticated path disclosure needs correction.

VERDICT: NOT READY

## Round 3 (delta) — 2026-08-16 — codex family

**Runtime:** codex exec --skip-git-repo-check -m gpt-5.6-sol -c model_reasoning_effort=xhigh -s read-only
**Target revision r3 (sha256 first-16):** 48daf98cff73810b
**Capsule:** pristine r2 clone + r3 overlay (tar sha256 first-16 86ae6174bf6cd10b)
**Instructions (sha256 first-16):** 1683ed63a3f2455e
**Blindness:** structural
**Verdict: NOT READY** (1 MATERIAL in-delta, 1 MATERIAL pre-existing, 2 implementation-phase)

### Verbatim review

1. Native Expo “gated leg” lacks a bootstrap trust root — IN-DELTA; MATERIAL.

   Defective decision: “nonce/operator-token discipline” does not specify how the native app obtains a proof unavailable to Expo web or a tunneled HTTP caller. The existing operator-token route is supervisor-only; giving that token to the app would cross the admin/app-plane boundary. A nonce delivered through the existing public origin or bootstrap route would not prove custody.

   Evidence: `llp/0262-dev-identity-custody-capability.rfc.md` D2; `packages/snapback-cli/expo-dev.mjs` (`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN`, unauthenticated bootstrap GET, operator-token control route); `packages/snapback-expo/supervised-environment.mjs`; LLP 0181’s explicit statement that the live bootstrap channel lacks peer authentication.

   Suggested disposition: Specify a concrete, native-only one-shot transfer—bound to startup nonce and selected device/simulator, delivered through an OS/device launch channel unavailable to web—or refuse native dev identity until such a carrier is proven. Tests must demonstrate that Expo web and tunneled raw HTTP cannot redeem it.

2. Invalid `SNAPBACK_EXPOSURE` values have no fail-closed semantics — PRE-EXISTING; MATERIAL.

   Defective decision: D4 defines unset and `fronted`, while OQ4 discusses adding `direct`, but neither defines unknown, misspelled, case-varied, or empty values. Treating an invalid nonempty value as unset would restore bind-derived Dev—including provisioning eligibility—despite an attempted exposure declaration.

   Evidence: `llp/0262-dev-identity-custody-capability.rfc.md` D4 and OQ4; `src/admin.rs` (`resolve_profile` and `profile_resolution_fails_closed_on_unrecognized_values`) establishes the analogous security-sensitive configuration precedent.

   Suggested disposition: Define the final closed value set and require every other nonempty value either to fail startup or resolve to full Prod semantics. Explicitly define whether empty means unset and add typo/case tests.

3. Vite restart rereading cannot rely on connection-error refresh — IN-DELTA; implementation-phase.

   Evidence: `packages/snapback-vite/proxy.mjs` refreshes cached state only after selected connection errors; `packages/snapback-vite/lifecycle.mjs` rereads the ready descriptor during that refresh. A same-port backend restart may accept a request carrying the stale capability and return an authentication refusal without producing a connection error.

   Suggested disposition: Reread per forwarded request/upgrade or detect ready-instance nonce changes before forwarding. Test a same-port restart and avoid retrying mutations after an authenticated backend response.

4. “Credential-bootstrap AdminRead keeps its own proof” overstates approval-request — IN-DELTA; implementation-phase.

   Evidence: `src/admin.rs` shows approval-request is proofless and controlled by local posture, capacity, and rate limits; approval-poll carries a device code, and claim-exchange carries a claim code.

   Suggested disposition: Rephrase the invariant as “credential-bootstrap routes retain their route-specific admission,” explicitly distinguishing the proofless request route from the proof-bearing poll and exchange routes.

Overall, the source supports the main architecture: the current bind-derived profile, centralized served-authority construction, connection grants, admin-token anchor ladder, relay topology, and console credential path all make the proposal feasible. The r3 sidecar, admin-bootstrap, refusal, and browser-separation corrections are coherent, but the native Expo carrier still names a desired property rather than a custody mechanism, and exposure parsing remains security-ambiguous.

VERDICT: NOT READY
