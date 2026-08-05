# LLP 0168 review — claude family

**Target:** `llp/0168-single-origin-dev-edge.rfc.md`
**Reviewed revision:** `0857e319ef32ffa5451441e98b2edca533b1f93f`
**Capsule sha256:** `0c8901f58388f0ed…`
**Runner:** claude -p --model claude-opus-5 (fresh process, cwd /tmp)
**Blindness:** structural — capsule-only, no repo access, sealed from the peer review until both landed

---

## Round 1 — 2026-08-04

## Correctness of the three load-bearing claims

All three check out against the included source, with one qualification.

- **(a) Web Locks / secure context** — correct. `navigator.locks` is `[SecureContext]`-gated, and `http://192.168.1.13:8090` is not a potentially-trustworthy origin, so `navigator.locks` is `undefined`. The measurement is consistent with the spec, not just with one browser.
- **(b) Both-required browser arm** — correct and precisely cited. `const hasWebLocks = typeof globalThis.navigator?.locks?.request === 'function'` gates the arm jointly with `hasIndexedDb`; a browser fails `navigator.product === 'ReactNative'` and `process.versions.node`, so it lands on the terminal `memoryFallback('no-durable-backend')`. The RFC's `reason` string is the one the client will actually report.
- **(c) Profile fallback** — correct as stated about `resolve_profile`: `_ if loopback => Dev`, `_ => Prod`. But see concern 1: this fact does not support the conclusion §Security envelope draws from it.

## Concerns

**1. [MATERIAL] §Security envelope + Goal 4 — the dev-auth gate is keyed to the wrong process, and the edge launders around it.**
`resolve_profile` takes `loopback` from *Snapback's* bind address. In the proposed topology the edge binds `0.0.0.0`/LAN and proxies to a Snapback server on `127.0.0.1`. Snapback then sees loopback connections, resolves `dev` with zero config, and `--allow-insecure-dev-auth` is never required — while the whole client-asserted-auth surface is reachable from the LAN. Goal 4's "inherited, not re-derived" is exactly backwards: the envelope cannot be inherited, because the reverse proxy destroys the signal it is derived from. The Validation requirement ("a non-loopback edge without both switches refuses") quietly assumes enforcement that the design says it doesn't build.
*Fix:* state that the edge re-applies the gate on **its own** listener — non-loopback edge bind requires `SNAPBACK_PROFILE=dev` *and* `--allow-insecure-dev-auth` even when the upstream is loopback — and decide how the server learns it is behind an exposing proxy (trusted-proxy declaration, or requiring the server to bind non-loopback too). Also state whether the edge forwards `X-Forwarded-For`/`Forwarded` and whether anything downstream trusts it.

**2. [MATERIAL] §Secure context is the load-bearing requirement + Open question 2 — the RFC names TLS as *the* load-bearing requirement and then defers whether it can be delivered.**
The RFC's own framing is that origin unification "alone leaves the store on memory," so the value of the proposal is contingent on the cert story. Q2's three answers are not interchangeable: a local CA is "the largest new surface"; self-signed requires per-device trust; delegating to a tunnel means the secure context comes from the alternative this RFC declines to pave, leaving the edge delivering only origin unification — which the rejected "CORS origin allowlist" also delivers at a fraction of the cost. Relatedly, Q3 asks the wrong question: it asks whether *Expo Go* accepts a private CA, but Expo Go is a declared non-goal ("needs neither axis"). The question that bounds this RFC is whether a **mobile browser** does — and on iOS that means installing a configuration profile *and* separately enabling it under Certificate Trust Settings, on every test device, which is the dominant UX cost of the motivating scenario.
*Fix:* decide the cert path in this RFC, with the per-device trust cost stated; or explicitly scope 0168 to origin unification + loudness and move TLS to a successor, in which case the CORS-allowlist alternative must be re-scored honestly.

**3. [MATERIAL] Goal 5 vs. Open question 6 — the proposal does not make the motivating failure loud on the path where it happened.**
The Warble defect occurred with *no edge in use*: a LAN URL handed over directly. The edge's startup diagnostic only fires when someone has already adopted the edge, and it prints on the developer's terminal, not on the phone showing the broken app. The only mechanism that covers the un-adopted path is Q6's client-side `isSecureContext === false && indexedDB present` detection — which the RFC itself calls "arguably the smallest useful fix in this whole RFC, and independently shippable," and then leaves as an open question. Goal 5 is therefore not met by the proposed design.
*Fix:* promote Q6 to a decision in this RFC (a distinct `reason`, e.g. `insecure-context-no-web-locks`, plus a one-time console warning), and make it a validation requirement. It is also the correct thing to ship first regardless of what happens to the edge.

**4. [MATERIAL] Goal 3 vs. Open question 4 — internal contradiction on the one asset the design is organized around.**
Goal 3 asserts "exactly one implementation of the relay policy," and §Why this is not a Vite question argues that allowlist drift is a *security* regression. Q4 then leaves open whether LLP 0030's plugin delegates or stays as-is — i.e. leaves open whether Goal 3 holds. Separately, the RFC never says what form the allowlist takes. The edge is Snapback-owned (Rust); 0030's plugin is Node/Vite. "Consumed as the authority" across two runtimes requires the allowlist to exist as a single machine-readable artifact, not as prose in a Draft RFC, and the RFC doesn't say it does.
*Fix:* resolve Q4 to "delegate" in this RFC (0030 is Draft and unshipped, which the RFC already notes is the argument), and specify the allowlist's single representation — where it lives, what emits it, and how any adapter obtains it (e.g. served off the readiness descriptor).

**5. [MATERIAL] §Alternatives considered — two cheaper paths that address the motivating scenario are absent, and one listed alternative is dismissed too strongly.**
Missing: (i) **device-side port forwarding** — `adb reverse tcp:8090 tcp:8090` (or Chrome DevTools port forwarding) makes the phone's own `http://localhost:8090` reach the dev machine, which *is* a secure context, with no certificate, no CA trust, and no new listener. This directly contradicts the dismissal of "tell developers to use `localhost`" as foreclosing phone testing — for Android browsers it does not. (ii) **Serving the exported static web build from the Snapback server** — `expo export -p web` plus static file serving gives one origin without reverse-proxying any bundler, and for "does the web build work on a phone" that is often the artifact you actually want to test. Neither replaces the edge for the second-machine/iOS case, but both change the cost/benefit of Q2 substantially.
*Fix:* add both, score them against the actual carriers (iOS Safari, Android Chrome, second-machine browser) rather than against bundlers, and say which carriers the edge is the *only* answer for.

**6. [DETAIL] §Security envelope — no Host/Origin validation requirement.**
Once the edge listens off-loopback, DNS rebinding lets an arbitrary page the developer visits reach it by name, and the single-origin design means the relay prefix is the only thing standing between that page and the app-data routes. *Fix:* require the edge to reject requests whose `Host` is not in a configured set (bind address, `localhost`, explicitly allowed hostnames), and to validate `Origin` on WebSocket upgrades.

**7. [DETAIL] §One core, thin adapters — bundler host/HMR configuration is unaddressed.**
Vite ≥5.4 rejects requests with unrecognized `Host` (`server.allowedHosts`), and HMR clients need `server.hmr.clientPort`/`protocol` when reached through an external TLS origin; Metro has analogous websocket-URL assumptions. "Point the bundler at it" is doing real work here. *Fix:* name this as part of what adapters configure, and add an HMR-survives-the-edge validation requirement.

**8. [DETAIL] §Motivation — the CORS claim is the only measured fact without a source citation.**
The secure-context claim cites `rqs-store-default.mjs`; "the dev server answers CORS for loopback origins only" cites nothing. It's plausible and the `curl` output supports it, but the reviewer can't confirm the rule (loopback-only vs. echo-configured-origin) or whether the edge's own origin would need registering. *Fix:* cite the header-emitting code path.

**9. [DETAIL] §Validation requirements — two gaps.**
The TLS case asserts `implementation: 'indexeddb'` but not `isSecureContext === true`, which is the property actually under test; and there is no case for an *untrusted* cert (click-through), where browser behavior differs from both the trusted and plaintext cases and is the likely reality of the self-signed option in Q2.

## What is good

The measurement discipline is the strongest part and should survive revision intact: the three load-bearing claims are each verifiable against cited source, and they hold. §Why the native carrier hid it is a genuinely useful piece of analysis — "the carrier most likely to be hand-tested is the one that can surface neither defect" is the sort of thing that prevents a class of future bugs, not just this one. The loud/silent distinction is the right organizing frame, and naming the exact `reason` string so diagnostic and client report are greppable together is a good concrete instinct.

The relationship to LLP 0030 is honest: the quoted deferral is verbatim and correctly scoped ("a reasonable future option for device/native workflows"), and 0168 genuinely takes up that branch rather than re-litigating it. Declining to restate or fork the allowlist is the right call — concern 4 is about making that stick, not about reversing it. The non-goals are unusually well chosen, particularly the explicit refusal to let TLS be read as making client-asserted auth trustworthy; concern 1 is that the design leaks around that boundary, not that the boundary is drawn wrong.

NOT READY

---

## Round 2 (delta) — 2026-08-04

**Reviewed revision:** `56ea200052f6a70c8d11e292423202c21c253375`
**Capsule sha256:** `35cb827d71620735…`
**Mode:** delta round — concerns classified IN-DELTA vs PRE-EXISTING

# Delta review: LLP 0168 round 2

## Verification of the load-bearing claims

All four check out against the included source:

- **(a)** Web Locks is `[SecureContext]`-gated; `http://<lan-ip>:<port>` is not a potentially-trustworthy origin, so `navigator.locks === undefined` is the expected result, and the measurement matches.
- **(b)** `resolveDefaultRqsStore` gates the browser arm on `hasIndexedDb && hasWebLocks`; with IndexedDB present and Web Locks absent, a browser falls past the RN arm (`navigator.product !== 'ReactNative'`) and the Node arm (`process.versions.node` absent) to the terminal `memoryFallback('no-durable-backend')`. Correct.
- **(c)** `resolve_profile` takes `loopback` from the server's own bind, admits exact `dev|demo|test` (and `prod`), fails closed to `Prod` on any other non-empty value, and defaults unset/empty to `Dev` on loopback. D1's central premise — the edge destroys the signal — is correct, and E2's correction of the earlier `SNAPBACK_PROFILE=dev` claim is right.
- **(d)** First-party storage, including IndexedDB, is keyed by origin (scheme, host, port). D3's marooning argument is correct.

---

## Concerns

### 1. `[IN-DELTA]` `[MATERIAL]` — D2 recommends the exact topology D1 was written to close, unguarded and on the public internet (§D2, §D1)

D1 correctly identifies that a front proxy makes `resolve_profile` see loopback, resolve `dev` with zero configuration, and never demand `--allow-insecure-dev-auth`. E1 then fixes this *for the Snapback-owned edge only*.

D2 in the same breath names "a TLS tunnel (`tailscale serve`, cloudflared, ngrok)" the **recommended zero-provisioning path** and says it "satisfies both axes today." A cloudflared or ngrok tunnel to a loopback Snapback server is a front proxy that D1's gate does not touch: no exposure opt-in, no approved profile, no `--allow-insecure-dev-auth`, and — since E9 scopes the access capability to "the edge" — no capability either. The tunnel also supplies a real certificate, so the secure context engages and everything works, which is precisely the "loud failure removed, silent exposure remains" shape the RFC rejects the CORS allowlist for. The blast radius is larger than the LAN case D1 fixed: client-asserted app-data write authority on a public hostname.

The revision therefore relocates the hole rather than closing it, and elevates the relocated version to a recommendation.

**Fix:** decide the gate as a property of the *server*, not of one optional front. Concretely: dev-auth acceptance must require an affirmative `--allow-insecure-dev-auth` whenever the server cannot itself establish that the request arrived directly over loopback — and it cannot, under any proxy. Then D1's E1 becomes a defense-in-depth layer on top rather than the only layer, and the tunnel path inherits the same gate. If that is too strong for v1, the tunnel recommendation must carry the same three requirements in normative text, and the tunnel case must appear in Validation requirements alongside the LAN-edge case.

### 2. `[IN-DELTA]` `[MATERIAL]` — there is no decided trust relationship between the edge and the server, and E3 forecloses the only substitute (§D1)

E1 puts the gate in the edge. E3 says the edge sets or strips `X-Forwarded-*` and "nothing downstream may treat them as authority." Both are individually right, and together they leave the upstream server with **no way to distinguish** "proxied by a Snapback edge that enforced E1" from "proxied by an arbitrary front that enforced nothing." That is what makes concern 1 unfixable inside the current decision set: the server's fail-closed behavior has nothing to key on.

Relatedly, E1 requires the edge to hold "an approved profile *and* `--allow-insecure-dev-auth`" while the upstream server requires neither. Under Q1's subcommand or separate-package options, that is a second, uncoupled implementation of a flag whose name implies one policy — a developer can satisfy the edge and not the server, or the reverse, with no error either way.

**Fix:** decide that the edge authenticates itself to the upstream server (loopback-minted shared secret in a Snapback-owned header, rotated per server start), and that the server accepts client-asserted identity only when the request is loopback-direct *or* bears a valid edge credential from a front that has asserted the gate. That makes E1 enforceable and makes an unknown front fail closed.

### 3. `[IN-DELTA]` `[MATERIAL]` — D2 + D3 + E5/E6, taken together, are infeasible for the motivating scenario (§D2, §D3)

D3 makes a stable advertised origin normative and E6 makes an unhonorable origin a refuse-to-start. D2 makes the certificate operator-supplied, and E5 binds cert SANs to the advertised origin. The RFC also records that the machine's LAN address changed twice during authoring.

If the advertised origin is an IP, an address change means: the cert's IP SAN is now wrong, so a new operator-supplied cert must be issued, and it must be re-trusted on **every device** — including the iOS two-step config-profile-plus-Certificate-Trust-Settings dance D2 honestly documents — and in the meantime E6 turns the dev loop off. That is not a v1 anyone will use for iOS Safari on a LAN, which is the residual scope Q2 says is the edge's entire remaining justification.

D3 makes stability normative without deciding the one mechanism that delivers it.

**Fix:** decide that the advertised origin MUST be a DNS name that survives address changes — mDNS `.local`, a tailnet name, or a hosts-file entry — never a bare IP. The cert is then issued once per name, trusted once per device, and an address change is invisible to both the origin and the store. Add a Validation requirement that the store survives a host address change, not only an edge restart.

### 4. `[IN-DELTA]` `[MATERIAL]` — E10 puts the allowlist authority on a runtime channel and never decides the unavailability behavior (§D5)

Round 1's complaint was that the allowlist existed only as prose. E10's answer — "a single machine-readable artifact… obtainable by any adapter (served off the readiness descriptor)" — trades one problem for two. A policy that must be in force before the first request is proxied, and that must be reviewable in version control and diffable in a PR, should not be primarily a runtime fetch. And E10/E11 do not say what a delegating adapter does when the fetch fails or returns a version it does not understand. For an allowlist, fail-open is a security regression, and unspecified means fail-open in practice.

**Fix:** decide the authority is a checked-in artifact in the Snapback repo, generated into both the Rust edge and the JS adapters at build time, with a version field; the readiness-descriptor endpoint is discovery/verification, not the source of truth. State explicitly that an adapter that cannot load or cannot understand the artifact refuses to proxy.

### 5. `[IN-DELTA]` `[MATERIAL]` — the gate's central predicate is named-but-not-stated (§D1, E1/E2)

E1 requires "an approved profile." E2 says the edge policy "names which of those it accepts rather than restating the server's" — and then the RFC never names them. `demo` and `test` both resolve to non-`Prod` profiles; whether either is an acceptable posture for a LAN-facing edge is a security decision, not an implementation detail, and it is the actual predicate of the gate D1 exists to install.

**Fix:** one line enumerating the accepted set (I would accept `dev` only for a non-loopback edge bind, and require `--allow-insecure-dev-auth` on top of it).

---

### 6. `[IN-DELTA]` `[DETAIL]` — E8's `Origin` check will reject the app bundle if implemented literally (§D4)

Top-level GET navigations carry no `Origin` header, and neither do many simple subresource requests. "Validate browser `Origin` on requests" as written admits a reject-on-mismatch-or-absent reading that breaks loading the app at all. Specify: reject when `Origin` is present and outside the allowed set; rely on E7's `Host` check for requests without one; require `Origin` on WebSocket upgrades, where browsers always send it.

### 7. `[IN-DELTA]` `[DETAIL]` — one of Q4's three capability forms is not implementable as stated (§Open questions Q4)

"A cookie set by a loopback bootstrap" cannot work directly: a page on `http://localhost:<port>` cannot set a cookie scoped to `https://<advertised-origin>`. The workable version is a capability-bearing URL on the edge origin that the edge exchanges for a `Secure`/`HttpOnly`/`SameSite` cookie on its own origin — worth saying, since it also answers "how does it survive a bundler's own routing" (it does, better than a path segment or query parameter, because subresource requests carry it automatically). Note also that a query parameter does not survive subresource loads and leaks via `Referer`.

### 8. `[IN-DELTA]` `[DETAIL]` — the `/*` branch's bundler dev surface is acknowledged but not decided (§D4 final bullet)

"E7–E9 apply to it" is the right instinct and an incomplete decision. Vite's `/@fs/` path and both bundlers' source-map serving expose project-wide filesystem reads to anyone who reaches the edge. Decide that the adapter configures the bundler's own `server.fs` strictness/allow-list, that non-app dev endpoints are not blanket-forwarded, and that source-map exposure through the edge is stated in the docs.

### 9. `[IN-DELTA]` `[DETAIL]` — Validation requirements never assert E9 (§Validation requirements)

The gate-in-the-breaking-topology case is a genuinely good addition, and it is the only new security assertion. There is no case for "a request without the access capability is rejected, including on a WebSocket upgrade" — the control E9 calls the difference between defensible and not. Add it.

### 10. `[IN-DELTA]` `[DETAIL]` — the Android port-forwarding alternative is under-caveated for the carrier where the bug was found (§Alternatives)

`adb reverse` and Chrome DevTools forwarding do make the device's `localhost` a secure context, and for Android this is correctly the first answer. But the *bundler* port must be forwarded too, and Metro must be told to advertise a `localhost` origin rather than the LAN IP, or the manifest and absolute asset URLs point back off-loopback and the secure context is lost. Since this is being promoted to "the documented first answer" for the exact Expo/Metro carrier that motivated the RFC, the caveat belongs in the text.

### 11. `[IN-DELTA]` `[DETAIL]` — E12 changes an observable field value (§D6)

`rqsStoreInfo.reason` moving from `no-durable-backend` to `insecure-context-no-web-locks` is a behavior change for anything asserting on the string. Trivial, but name it, since E12 is meant to ship first and independently.

---

## What is good

- **The D1 correction is the right diagnosis, precisely argued.** Naming `src/admin.rs:291`, stating that the profile derives from Snapback's own bind, and drawing the conclusion that a reverse proxy destroys the signal is exactly right — my concerns 1 and 2 are that E1 does not go far enough, not that the analysis is wrong.
- **D3 is the strongest decision in the document,** and E6's explicit distinction from LLP 0010's auto-port-selection ("correct there, wrong here") is the kind of reasoning that prevents a future reviewer from re-litigating it. The stop/restart validation requirement, rather than page-reload, follows correctly from origin partitioning.
- **D2's honesty about the iOS trust cost** — config profile *plus* separate Certificate Trust Settings, per device, out of band — is worth preserving verbatim. Most RFCs would have written "trust the cert" and moved on.
- **D6 is correct on the merits and correctly sequenced.** The argument that a startup-time diagnostic observes listener configuration rather than the browser's `isSecureContext`, and can be wrong behind a tunnel, is a real distinction most reviews would miss. E12 is small, independent, and should ship regardless.
- **Q2 is not incoherence — it is the honest shape.** An RFC that scopes itself down after review, names two cheaper alternatives that cover most of the ground, and asks whether the residue justifies the build, is behaving correctly. The one structural improvement: split D6 (E12/E13) into its own shippable LLP so the diagnostic does not die with a Q2 "no."
- The narrowing of the consequence claim to durable retention and replay, and the acknowledgment that a shared middleware core does not duplicate the allowlist (so the front-edge argument is narrower than originally claimed), both make the document more trustworthy than the version that overclaimed.

NOT READY

---

## Round 3 (delta, final) — 2026-08-04

**Reviewed revision:** `0cc2b73ced8253eb2a47ccf46bdb454e97192613`
**Capsule sha256:** `e4ca2bbb326ba9b1…`
**Mode:** delta round

## Correctness of the source claims

All four check out. (a) Web Locks is secure-context-only, so `navigator.locks` is `undefined` on `http://<lan-ip>`; (b) the ladder's browser arm gates on `hasIndexedDb && hasWebLocks` and otherwise falls through to the RN/Node arms and terminal `no-durable-backend`; (c) `resolve_profile` honors exact `dev|demo|test|prod`, fails closed to `Prod` on any other non-empty value, and only falls back to bind (`loopback → Dev`) when unset/empty — so E2's "`demo` and `test` resolve non-`Prod` server-side" is accurate and E2 is correctly framed as a new edge-side policy, not a restatement; (d) IndexedDB is origin-partitioned by scheme/host/port, so D3's "different, empty store, reported healthy" is right.

## Concerns

**1. [IN-DELTA] [MATERIAL] — D1/E3: the loopback-direct exemption is the third topology.**
E3 accepts client-asserted identity when the request is "loopback-direct **or** bears a valid edge credential," and claims that "an unknown front therefore fails closed." A tunnel client (`ngrok`, `cloudflared`, `tailscale funnel`) run against the Snapback server directly — no edge, nothing declared — connects *from loopback*. It is indistinguishable from loopback-direct, so it inherits `dev` and client-asserted identity with zero configuration. This is the same relocation the prior two rounds found, moved once more: the gate now keys on *declared* exposure, and an undeclared front is invisible by construction. The condition predates this RFC; the *claim* that E3 closes it is new and false.
**Fix:** state the residual honestly — no server-side signal distinguishes a loopback tunnel client from a local process, so E1 is a configuration-hygiene control over declared topologies, not a control over exposure. Then make the dangerous capability opt-in rather than inferred: require an explicit flag for client-asserted identity whenever the server is started at all, instead of deriving it from bind or from loopback-directness.

**2. [IN-DELTA] [MATERIAL] — D1/E3: the credential attests provenance, not policy compliance.**
A loopback-minted, loopback-presented credential proves only that the bearer could reach loopback. It carries no attestation that the bearer enforces E1/E2 or E9–E11. Any local process — a `caddy`/`nginx` the developer already runs, a second edge started with different flags, the "shared relay core embedded into each bundler" the RFC lists as a live alternative — can mint one and then front the LAN un-gated. So E3 does not make E1 enforceable; it makes E1 enforceable only against fronts that cannot reach loopback, which on a dev machine is nearly none.
**Fix:** move the gate to the mint. Have the front declare its advertised public origin and profile *at credential-mint time*; the server applies E1/E2 (`dev` only, `--allow-insecure-dev-auth`) and refuses to mint for a non-loopback declared exposure without the opt-in. That puts the switch in exactly one place regardless of how Q2 resolves, and dissolves the "second uncoupled implementation" worry Q2 records. Bind the credential to the declared origin so it is not transferable to a different front. Add a validation case for a credentialed-but-ungated front, not only the unknown one.

**3. [IN-DELTA] [MATERIAL] — D2/E6: the named hostname mechanisms don't cover the carriers E6 exists to serve, and the cheapest one is missing.**
E6 offers mDNS `.local`, a hosts entry, or a tunnel-supplied name. On the residual territory Q1 identifies — iOS Safari and second-machine browsers *without a tunnel* — a hosts entry is impossible on an unrooted phone, the tunnel name is excluded by assumption, and `.local` resolution is reliable on iOS/Bonjour but not in Chrome on Android. Missing entirely is the standard answer: a **real DNS name pointing at the private address**, which satisfies E6 *and* permits a publicly-trusted certificate via DNS-01 ACME — eliminating the per-device profile-install-plus-Certificate-Trust-Settings dance the RFC calls "the dominant UX cost of the motivating scenario." Since Q1 is framed as a cost judgment the author must make, an incomplete mechanism inventory distorts the input to that judgment in both directions.
**Fix:** add public-DNS-name + DNS-01 to D2 with its real costs (owned domain, DNS provider API, private IP in public DNS, network access at issuance/renewal), and restate E5's "operator-supplied certificate" as compatible with it. Re-derive Q1's residual against the corrected list.

**4. [PRE-EXISTING] [MATERIAL] — D4/E11 and Q4: the only control preventing an off-loopback dev server from being writable by the local network has no decided form.**
E11 is normative for v1, E9/E10 explicitly do not substitute for it, and its enforcement contract covers navigation, assets, HMR, relay HTTP, and upgrades — yet its shape is Open Question 4. The hard part is precisely the `/*` branch: the capability must survive URLs the bundler generates itself (absolute asset URLs, HMR `wss://`, source maps, Metro manifest URLs), which the edge cannot reliably rewrite.
**Fix:** decide it before go/no-go. The shape that survives bundler-generated URLs is a capability-bearing first navigation that sets an origin-scoped, `Secure`, `SameSite=Strict` cookie and redirects to a clean URL — this works for a phone that never touches loopback, and covers upgrades. Pair it with `Referrer-Policy: no-referrer` to satisfy E11's own no-leak clause, which a path-segment or query form cannot.

**5. [IN-DELTA] [DETAIL] — D5/E12–E13: version *skew* is unhandled.**
E13 covers unreadable and unknown-version artifacts. It does not cover the routine case: edge and adapter each compiled a *different, individually valid* version. The prior runtime-fetch design was skew-free by construction, so this is a real property traded away. "The readiness descriptor exposes it for discovery and verification" gestures at the fix but is not normative.
**Fix:** make it normative — the edge advertises its artifact version in the descriptor; an adapter whose compiled version differs refuses to proxy.

**6. [IN-DELTA] [DETAIL] — D1/E3: rotation has no re-acquisition protocol.**
"Rotated per server start" leaves the edge holding a stale credential across a server restart, with no stated behavior. Unspecified here means an implementer may accept old-and-new.
**Fix:** state that a stale credential is refused and the edge re-mints over loopback (re-passing the E1/E2 mint-time gate from concern 2); add a server-restart-with-edge-up case to validation, alongside D3's existing edge stop/restart.

**7. [PRE-EXISTING] [DETAIL] — E8 × Q2.**
Under Q2's favored option (a flag on `snapback start`), E8's "refuses to start" means the backend does not start because the edge's advertised port is taken. Say which process E8 governs, or scope the refusal to the edge.

**8. [IN-DELTA] [DETAIL] — Header and Decisions framing.**
The header says "round 2" on a round-3 revision, and its parenthetical now duplicates §What this document authorizes. More usefully: D1–D5 are presented as Decisions while the Summary says the edge is unauthorized. Mark D1–D5 conditional on Q1 so nobody implements from a decision that may never take effect.

**9. [IN-DELTA] [DETAIL] — E15 changes an observable string.** `reason` moving from `no-durable-backend` to `insecure-context-no-web-locks` is a contract change for anything matching on it. Note it in D6.

**On the two framing questions.** Does D1 close the hole? No — concerns 1 and 2 are the third and fourth relocations of the same root, and both follow from the fact that a declaration-based gate cannot see an undeclared front. Is the split-authorization coherent? Yes, and it is the document's best move: D6 is genuinely independent, addresses the path the defect actually took, and shipping it does not presume the edge. That is honest, not evasive — the labeling in concern 8 is the only thing that undercuts it.

## What is good

The root-cause naming — "bind address is not exposure" — is correct and is the right level of abstraction after two failed patches. The retraction of the "a tunnel satisfies both axes" claim is explicit and unhedged. E13's fail-closed default, and the reasoning that unspecified allowlist behavior is fail-open in practice, is right. The per-device trust cost is stated as the dominant cost rather than buried. The alternatives section argues *against* the RFC's own proposal in two places (port forwarding is "strictly better" for Android; the shared-relay-core entry concedes the allowlist argument was overclaimed), which is what makes Q1 a real question. And D6 is correctly identified as the part that covers the observed failure.

NOT READY
