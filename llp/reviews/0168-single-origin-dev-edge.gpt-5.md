# LLP 0168 review — gpt-5 family

**Target:** `llp/0168-single-origin-dev-edge.rfc.md`
**Reviewed revision:** `0857e319ef32ffa5451441e98b2edca533b1f93f`
**Capsule sha256:** `0c8901f58388f0ed…`
**Runner:** codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only
**Blindness:** structural — capsule-only, no repo access, sealed from the peer review until both landed

---

## Round 1 — 2026-08-04

The factual chain is sound: Web Locks is secure-context-only, ordinary HTTP LAN origins are not trustworthy origins, the store requires both IndexedDB and Web Locks, and an ordinary browser then reaches the memory fallback. The narrow profile claim is also correct: unset or empty on a non-loopback bind resolves to `Prod`; recognized explicit values win, while typos still fail closed. The relationship to LLP 0030 is honest—the quoted alternative was explicitly deferred there.

The workspace is read-only, so I could not persist this review under `llp/reviews/`.

## Concerns

1. [MATERIAL] **§Security envelope and Open question 1 incorrectly describe the existing auth gate as inherited.** If the edge binds a LAN interface but proxies to a Snapback server bound to loopback, `resolve_profile` sees the backend’s loopback bind and defaults to `Dev`; the backend’s transport fence likewise sees only its loopback listener. Nothing shown automatically applies that gate to the edge. Fix: make the edge independently evaluate its browser-facing bind and require the exposure opt-in, approved profile, and insecure-dev-auth override regardless of upstream topology or TLS. Test the separate-edge/loopback-backend case explicitly. Also clarify that requiring exactly `SNAPBACK_PROFILE=dev` is a new edge policy; `resolve_profile` itself recognizes `demo` and `test` too.

2. [MATERIAL] **§Secure context and Validation omit a stable public-origin contract.** IndexedDB is partitioned by scheme, host, and port. A trusted TLS edge on a newly selected port or changed LAN address after restart gives the browser a different store, silently marooning the supposedly durable state. Certificate naming and trust also depend on that hostname. Fix: require a stable advertised browser origin, define collision behavior, bind certificate SANs to it, and validate retention across a complete edge stop/restart—not only a page reload.

3. [MATERIAL] **§Secure context leaves certificate trust—the feature’s load-bearing feasibility question—undecided.** Local CA installation on every browser device, user-supplied certificates, and a public tunnel have substantially different security and usability properties. “TLS when configured” is not yet an implementable paved path. Fix: choose one supported path, or narrow this RFC to an explicit interface such as supplied certificate/key plus advertised HTTPS origin and defer automatic provisioning without claiming the packaged loop is solved.

4. [MATERIAL] **§Security envelope specifies route authority but no browser-origin or Host boundary.** The allowlist protects system routes; it intentionally forwards app-data writes under client-asserted dev identity. A reverse proxy that accepts arbitrary `Host` or WebSocket `Origin` values risks DNS-rebinding or drive-by access, and `WebSocket` does not enforce same-origin policy for the server. The `/*` branch also exposes the bundler’s development surface. Fix: normatively validate Host and browser Origin—including upgrades—sanitize forwarding headers, retain restrictive CORS behavior, and state whether any LAN peer is deliberately granted app-data authority or whether the edge needs an unguessable access capability.

5. [MATERIAL] **§Fail loud does not actually guarantee loud degradation.** A startup process observes listener configuration, not the browser’s `isSecureContext` or Web Locks exposure; it can also be behind a TLS tunnel while locally serving HTTP. Meanwhile rendering `rqsStoreInfo` is only a SHOULD. Fix: settle Open question 6 affirmatively with a specific client-side dev diagnostic such as `web-locks-require-secure-context`, and give the edge an advertised-public-origin input for accurate startup diagnostics.

6. [DETAIL] **§Alternatives omits a shared relay core embedded into each bundler.** Vite and Metro adapters need not duplicate the allowlist: both could consume one Snapback-owned middleware/policy package while leaving each bundler as the public listener. The selected front-edge design may still be better because bundler middleware, TLS, and upgrade APIs differ, but the RFC should compare that real alternative rather than equating multiple adapters with duplicated policy.

7. [DETAIL] **Validation does not cover the bundler-facing half of the proxy sufficiently.** Add HMR over `wss`, redirects, absolute asset URLs, source maps, and Expo/Metro manifest URLs. These are common reverse-proxy compatibility failures but do not invalidate the architecture.

8. [DETAIL] **§Motivation overstates the consequence as making “every local-first claim” false.** The demonstrated loss is durable retention and replay across reload/crash; online behavior and possibly same-session offline behavior remain. Narrowing the sentence will preserve the strong, correctly measured claim.

## What is good

The central measurement and persistence-ladder diagnosis are correct. Reusing one Snapback-owned relay policy is the right security instinct, and a carrier-agnostic front edge with thin adapters is a coherent response to the branch LLP 0030 explicitly deferred. The RFC also correctly separates TLS from authentication and includes strong route-parity, streaming, WebSocket, and cross-carrier validation goals.

NOT READY

---

## Round 2 (delta) — 2026-08-04

**Reviewed revision:** `56ea200052f6a70c8d11e292423202c21c253375`
**Capsule sha256:** `35cb827d71620735…`
**Mode:** delta round — concerns classified IN-DELTA vs PRE-EXISTING

1. `[IN-DELTA] [MATERIAL]` — **D1 / Goals / Validation requirements:** D1 closes the direct LAN-edge→loopback-server hole, but repeats the same inference failure one layer outward. A TLS tunnel or reverse proxy can expose a loopback-bound edge while E1 sees only the edge’s loopback bind and requires no opt-in. D2 explicitly recommends this topology. Fix: derive the gate from effective exposure, including the advertised public origin and any fronting-proxy mode. Any non-loopback advertised origin must require the explicit profile and insecure-dev-auth acknowledgment, even when the edge socket is loopback-bound. Add that topology to validation.

2. `[IN-DELTA] [MATERIAL]` — **D2 / Alternatives considered / Open question 2:** “A TLS tunnel … satisfies both axes today” is false without additional composition. TLS supplies the secure context, but a tunnel to Metro or another bundler does not put Snapback routes on the same origin or make their CORS policy accept the tunnel origin. It satisfies both axes only if it fronts the proposed edge, an existing bundler relay, or equivalent path-based composition. Fix the recommendation and re-evaluate Q2’s claimed residual scope accordingly.

3. `[IN-DELTA] [MATERIAL]` — **D1 E2:** The security-critical “approved profile” set remains undefined. E2 says the edge policy names which of `dev`, `demo`, and `test` it accepts, but the RFC never names them. Fix: enumerate the accepted profiles, require an explicit profile whenever effective exposure is non-loopback, and specify fail-closed behavior for absent, `prod`, and unknown values.

4. `[IN-DELTA] [MATERIAL]` — **Open question 2 / Summary:** It is coherent—and commendably honest—to question whether the edge is worth building. It nevertheless leaves the RFC’s central authorization undecided, so the RFC is not ready for acceptance as an edge proposal. Fix: decide the go/no-go after correcting the tunnel comparison, or split D6 into an independently actionable change and recast the remaining document as Research until the edge is authorized.

5. `[IN-DELTA] [DETAIL]` — **D4 E9 / Open question 4 / Validation requirements:** An unguessable capability is not security theater for the stated threat: if uniformly enforced, it prevents arbitrary LAN peers and non-browser clients from acquiring app-data and bundler authority. The RFC should still define its enforcement contract before implementation: cover initial navigation, assets, HMR, relay HTTP, and WebSocket upgrades; reject missing and incorrect capabilities; prevent token logging/referrer leakage; and test those failures. Host and `Origin` checks do not replace these tests.

6. `[IN-DELTA] [DETAIL]` — **D3 E5:** Certificate SANs cover the advertised hostname or IP, not the full scheme/host/port origin. Fix the wording to say the certificate must cover the advertised host; the listener configuration separately fixes HTTPS and the port.

7. `[IN-DELTA] [DETAIL]` — **Alternatives considered, device-side port forwarding:** The shown single `adb reverse` forwards only the bundler port. It does not itself make Snapback reachable or compose the two services. Fix: state whether a second forwarding rule, a bundler relay, or direct LAN access to Snapback is required, including the resulting CORS and exposure-gate requirements.

## What is good

The four supplied load-bearing facts are used correctly: Web Locks require a secure context; the browser store arm requires both IndexedDB and Web Locks; the server profile derives from its own bind and fails unknown values closed to `prod`; and a stable scheme/host/port is necessary for retaining the same IndexedDB origin. D3’s refuse-on-origin-drift behavior is strong, D6 is a well-targeted independently shippable diagnostic, and D4’s combined Host, `Origin`, capability, and forwarded-header posture is directionally sound. No material regression was found in the carried-forward text.

NOT READY

---

## Round 3 (delta, final) — 2026-08-04

**Reviewed revision:** `0cc2b73ced8253eb2a47ccf46bdb454e97192613`
**Capsule sha256:** `e4ca2bbb326ba9b1…`
**Mode:** delta round

1. **[IN-DELTA] [MATERIAL] — D1/E3, unknown fronts.** “Loopback-direct” is not distinguishable from a local proxy connection. A public tunnel can front the loopback Snapback server directly; its upstream connection appears loopback, satisfying E3’s first branch without an edge credential. Forwarded-header stripping cannot fix this.  
   **Fix:** Require a credential for every network request using client-asserted identity, including loopback requests, or explicitly abandon the claim that unknown local fronts fail closed. Add the direct-tunnel-to-server topology to validation.

2. **[IN-DELTA] [MATERIAL] — D1/E3 and Q2, credential bootstrap.** “Loopback-minted” does not authenticate the edge: if minting or retrieval is available merely to loopback callers, an arbitrary local proxy can obtain the credential. Rotation also lacks a restart contract—after the server rotates, the edge needs a trusted reacquisition path and must deny traffic meanwhile. Q2 leaves the process relationship that determines this mechanism undecided.  
   **Fix:** Decide the trust channel now: preferably same-process/in-memory, otherwise an inherited pipe or protected local IPC with an explicit local-process threat model. Specify restart, readiness, stale-credential, and logging behavior.

3. **[IN-DELTA] [MATERIAL] — Open question Q1 versus D2.** Q1 subtracts “a tunnel” from the edge’s territory, contradicting D2’s correct statement that a tunnel to the bundler satisfies only the secure-context axis. If the tunnel fronts the edge, it is circular as an alternative to building the edge; if it fronts an unspecified equivalent relay, that relay is itself uncosted work. The go/no-go is therefore framed using coverage that does not presently exist.  
   **Fix:** Name and validate the exact no-edge tunnel topology, including route composition, TLS, CORS, upgrades, and auth—or remove tunnels from the claimed reduction in scope.

4. **[PRE-EXISTING] [DETAIL] — D4/E11 and Q4.** The access capability is load-bearing, but its carrier remains undecided. Query/path capabilities conflict with the no-`Referer`/no-log-leak requirement; a cookie bootstrap needs a concrete remote-device flow and HMR/WebSocket behavior. The E11 decision itself is sound and feasible, so this is implementation detail, but it must be resolved before an edge go decision becomes implementable.  
   **Fix:** Select a v1 mechanism and specify bootstrap, clean-URL redirection, cookie attributes where applicable, redaction, rotation, and bundler/HMR handling.

5. **[IN-DELTA] [DETAIL] — D5/E12–E13.** A checked-in artifact removes source-list drift but not cross-release or interpreter drift. A Rust edge and JS adapter can carry different known artifact versions or canonicalize encoded paths differently while both consider themselves valid.  
   **Fix:** Require a runtime artifact digest/version match before the first proxy request, plus generated canonicalization and adversarial-path test vectors shared by both implementations.

6. **[PRE-EXISTING] [DETAIL] — D3/E7–E8.** “The edge binds to” the advertised origin does not describe the required tunnel-fronted topology, where public host/port and the loopback listener differ.  
   **Fix:** Separate the stable browser origin from the upstream listener contract and define what a fronted edge can actually verify before declaring readiness.

What is good: the four source-derived technical claims are correct; E2 accurately narrows the edge policy beyond `resolve_profile`; the hostname requirement is a sound v1 choice; D6 is precise, independently useful, and matches the store ladder; and D5 moves in the right fail-closed direction. The authorization split is honest and coherent for a document remaining in Review—it is not evasive—but it does not make the edge ready for authorization.

The review was not appended to `llp/reviews/` because this session’s workspace is read-only.

NOT READY
