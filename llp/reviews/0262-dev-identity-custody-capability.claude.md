# Reviews: LLP 0262 — Dev identity becomes a custody capability

## Round 1 — 2026-08-15 — claude family

**Reviewer:** fresh blind general-purpose agent (Claude Fable 5 harness), capsule cwd
**Target revision (sha256):** 7f1ca7cf4d4aef28407df4591c9baac93b7deea041a8bd5f6e652a5cc265d7ab
**Capsule:** git archive fa81cd856 minus llp/reviews/0262* (tar sha256 first-16 39f3385a0932fc02)
**Instructions (sha256 first-16):** 965e8344aca27f39
**Blindness:** structural
**Verdict: NOT READY**

### Verbatim review

All claim sites are now verified. Here is the review.

---

# Review: LLP 0262 — Dev identity becomes a custody capability (r1)

## Verification summary

The document's factual claims were checked against the snapshot and are substantially accurate:

- `resolve_profile` derives `dev` from a loopback bind with `SNAPBACK_PROFILE` unset (`src/admin.rs:330-340`), and the dev-mode body dev-user selector is accepted with no credential for callers that omit `Origin` (`src/server.rs:13007-13023`) — the uncredentialed-assertion exposure is real.
- `evaluate_access` allows reads on bare loopback (`src/admin.rs:3641-3670`); the tokenless-loopback write branch is embedded-router-only because the serve path resolves/mints a `0600` token on every loopback bind (`src/admin.rs:2337-2415`, `src/cli.rs:8467-8488`). The `loopback` fed to it is the **bind** posture, so tunnelled requests pass as loopback — confirmed.
- The impersonation capability precedent is as described: per-boot, `sbic_`, startup-nonce-associated, owner-only ready-file sidecar, constant-time digest comparison (`src/admin_impersonation.rs`), minted beside `src/cli.rs:8505-8519`; the rehearsal sidecar prod-presence startup refusal exists (`src/cli.rs:8356-8371`). `secure_file`/`owner_only_file` hardening (O_NOFOLLOW, strict 0600) confirmed (`src/secure_file.rs:22,104,151`).
- The demo kit harvests the impersonation sidecar (`demos/_kit/server-process.mjs`, `captureImpersonationCapability`), console mint requires `loopback && Local` (`src/admin.rs:5238-5257`), direction 1 landed in `guide/auth/targets.md:40-52`, `auth.mintSession`/`function.run` are AdminWrite operations (`src/server.rs:18838-18854`), LLP 0060 D1's fence limit and LLP 0168's "needs a focused RFC" conclusion are quoted accurately, and the tunnelled-loopback ticket's 2026-08-15 survey matches the RFC's motivation section.

One claim the code contradicts, and it is load-bearing — see concern 2.

## Concerns

**1. Serve-time bootstrap injection redistributes the capability over the very channel the RFC claims to close — MATERIAL.**
Defective decision: D2's first row has the dev host "inject the capability into the served client bootstrap," i.e. hand the raw custody credential to **any HTTP caller who can fetch the bootstrap**. The RFC's own motivation names the demand behind tunnelling as "reaching a phone" — and reaching a phone with a web client means tunnelling the client-serving port (the Vite dev host, the packaged dev host's client arm, or the server-served supervised Expo bootstrap exchange `/_snapback/expo/v1/bootstrap`, `packages/snapback-expo/supervised-environment.mjs:8-18`). In every such topology the tunnel stranger fetches the bootstrap first and receives the capability, then asserts identities freely — the Summary's claim ("a caller reaching the server through a tunnel does not have the machine's filesystem and gets a typed refusal") and D1's claim ("removes the *uncredentialed* assertion path — a tunnel or LAN stranger who was not handed the capability by the developer's own launcher") are both false in these topologies, because the launcher hands the capability to strangers automatically. LLP 0168 itself flags the tunnelled-Vite-relay composition (`llp/0168-browser-carrier-dev-edge.research.md:92`), and neither the dev host nor the server can detect the front. OQ1 does not cover this: OQ1 is about the capability *legitimately* handed to the developer's own phone on a wide bind, not about serve-time distribution to arbitrary callers. Custody proofs work in the four shipped precedents precisely because distribution is out-of-band of the attacked channel (filesystem, spawn env); serving one over HTTP breaks that property. Disposition: add an explicit channel/topology analysis; scope the safety claim honestly (the proof holds only for tunnels of channels that do not serve client bootstrap), and redesign the browser path so the raw capability never enters HTTP-served content (e.g., relay-side header attach with its own limits stated), or accept and document the residual.

**2. The Vite-row premise "the same way it already injects the origin" is contradicted by the code and by LLP 0030's fence — MATERIAL.**
Defective decision: the feasibility of the primary injection path rests on a precedent that does not exist. The Vite plugin's virtual module deliberately ships **only a relative base path and sanitized state**, with the governing invariant: "no private loopback URL, admin token, token-file path, or command line may reach browser-visible module code; the browser client uses the relative base path, never the backend origin" (`packages/snapback-vite/index.mjs:181-197`, `@ref LLP 0030#generated-app-facts`). So (a) the dev host does *not* already inject the origin into browser bootstrap — the design explicitly refuses to; and (b) injecting a `0600`-custody credential into browser-visible bootstrap contravenes the same governing fence (the admin-token exclusion is the exact class), which the RFC neither acknowledges nor proposes to amend. An origin-injection precedent does exist for Expo (`__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__`), but not for the row that cites LLP 0030. Disposition: correct the premise; if browser-visible credential injection is intended, amend LLP 0030's fence deliberately and defend the change; otherwise redesign the browser path.

**3. D3 grants the widely-distributed dev-identity capability admin-read authority without justification — MATERIAL.**
Defective decision (decision quality/safety): D3 makes reads accept "the admin token **or the dev-identity capability**." By D1's own framing the capability deliberately travels to every client the developer's tooling starts — browsers and LAN phones included — while every constituency that legitimately needs admin reads (CLI, dev host, `_kit`, harness) has filesystem custody and can present the token (and the console's derived credential is already accepted ahead of `evaluate_access` in `authorize_for_mode`, `src/admin.rs:3858-3871`, so console flows don't need this either). The coupling means any leak of the client-held capability — including via concern 1's serve-time distribution, devtools, or request logs — discloses the whole admin inspection surface that D3 exists to protect, and it hands every phone client admin-read authority it has no use for. The narrower option (token/console-credential-only reads) was available and is not argued against. Disposition: drop the capability from the read gate, or explicitly justify the coupling and its blast radius in the RFC.

**4. D6 chokepoint counts have drifted — implementation-phase.**
`validate_plaintext_auth_transport` has three non-test call sites (`src/admin.rs:3245`, `src/cli.rs:694`, `src/server.rs:10506`), not two; `require_operation_profile` has 20 call sites, not 22; "~14 acceptance tests" understates current `captureImpersonationCapability` usage (~35 demo files). The structural claims (few chokepoints, single `permits_dev_body_origin` caller at `src/server.rs:13015`, mint beside `src/cli.rs:8506`) hold. Refresh the counts.

**5. Browser WebSocket carrier unaddressed — implementation-phase.**
Browsers cannot set custom headers on WebSocket upgrades. If any dev-identity assertion travels on the live-socket path rather than exclusively on HTTP requests (e.g., `connection/open` before socket attach), D1's "dedicated header" carrier is infeasible from browser clients. The chokepoint list should state where the assertion is established and confirm the header carrier suffices, or name the WS-side carrier.

**6. Per-boot rotation and stale-sidecar operational edges — implementation-phase.**
Per-boot rotation invalidates "printed origin config" for phone clients on every server restart (workable where a live bootstrap exchange exists; a papercut for printed config), and the D1 prod-presence startup refusal (mirroring rehearsal) means a crashed dev boot's leftover sidecar wedges a subsequent prod/`fronted` boot until removed. Specify cleanup and the remediation message.

**7. D4 wording admits two readings — implementation-phase.**
"Refuses to mint the dev-identity capability's *loopback conveniences*" plus "the bind-derived profile **default** flips to `prod` semantics" can be read as (a) `fronted` changes only the unset-profile default, with explicit `SNAPBACK_PROFILE=dev` still minting, or (b) `fronted` kills dev identity outright — and reading (b) collides with "dev identity requires the capability (already true after D1)" and with D1's prod-presence refusal. Reading (a) is coherent and evidently intended ("the operator must select capabilities explicitly"); one clarifying sentence resolves it.

**8. D3's rollout staging unspecified — implementation-phase.**
D5's three stages are written for the dev-identity capability. Dropping the bare-loopback read allowance is its own breaking change for tokenless local read tooling; state whether D3 rides the same stages.

## Overall assessment

The problem diagnosis is verified and precise; the survey claims match the source almost everywhere, and the choice of custody over transport inference is the right primitive with five shipped precedents behind it. D1's server-side mechanics, the typed refusals, and the staged rollout are sound. The document's weakness is concentrated in the client-distribution half: D2's serve-time browser injection rests on a factually wrong precedent, conflicts with LLP 0030's browser-facts fence, and — most importantly — re-serves the credential over exactly the channels a developer tunnels to reach a phone, which is the RFC's own motivating scenario; the safety claims are correspondingly overbroad, and D3 amplifies the blast radius by giving that same widely-distributed credential admin-read authority. These are fixable with a topology-scoped safety claim, a redesigned (or honestly-caveated) browser path reconciled with LLP 0030, and a narrowed or justified D3 — but as written they are defective decisions, not polish.

VERDICT: NOT READY
