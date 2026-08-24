# LLP 0300 reviews — codex family

## Round 1 — 2026-08-24

- Target: llp/0300-snapback-is-a-url.rfc.md @ revision (b), sha256 854450c675e9e244122ae5825f3e9fdf95c9c21159a7136d61e6c4d2383e0a31
- Capsule: refine-0300/capsule-r1 (RFC + LLP 0299 + 2 referenced tickets), dirhash 711dcf18afb18c675ab130f06273bb78c171a5c727940d5fe6889259c855b338
- Reviewer: codex gpt-5.6-sol @ xhigh (read-only sandbox, --skip-git-repo-check, cwd = capsule)
- Blindness: structural (capsule contains no llp/reviews/*, no run journal); fresh session
- Received: complete response; verbatim body follows

```
(verbatim)
```

1. **MATERIAL — DECISION QUALITY — Summary, Background, Alternatives.**  
   **What is wrong:** The evidence supports “Snapback must stop owning the bundler” and probably supports URL-first configuration, but it does not establish that unauthenticated connect-time discovery should replace pre-admission. Several costs are misattributed: random origins were LLP 0299’s now-fixed port-allocation bug; restart drift is lifecycle reconciliation and can leave a URL-configured client equally stale; the shared principal is the ambient mint; and Metro/proxy/CI failures follow from bundler ownership, not logically from pre-admitted binding. The omitted middle alternative is a caller-owned bundler receiving a signed/pre-admitted binding without supervisor ownership of Metro. The comparison is directionally useful but overstated: Convex now has a local subprocess backend, so it is a fair local comparator, while Supabase local is a local Docker stack—but Supabase clients require both a project URL and a publishable key, not “one URL alone.” [Convex local deployments](https://docs.convex.dev/cli/local-deployments), [Supabase local CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), [Supabase client configuration](https://supabase.com/docs/guides/getting-started/tutorials/with-refine).  
   **Concrete change:** Add a causal matrix mapping each recorded failure to P1–P4, remove LLP-0299-fixed and mint-specific defects from the evidence for P1, correct the comparisons, and explicitly compare URL plus authenticated discovery against caller-owned bundler plus a pre-admitted/signed binding. The RFC may still choose URL-first, but must justify that security-relevant part independently.

2. **MATERIAL — SAFETY — P1 and Security analysis (“Wrong-generation backend”).**  
   **What is wrong:** Equality with an identity returned by the contacted server is discovery, not verification. The generated identity is client-visible and therefore not secret; a hostile process that captures the stable loopback port can return the expected identity and receive the bearer token on the next request. The current receipt-verified supervisor would refuse that foreign listener, so “same safety property” is false. Boot-time versus connect-time is not the important distinction; authenticated versus self-asserted identity is.  
   **Concrete change:** Require proof of possession before any credential-bearing request—for example, a nonce signed by a deployment key whose public fingerprint is in generated target facts, or an equivalently authenticated receipt bound to the canonical origin and generation. If Snapback cannot provide such proof, retain trusted issuance for credentialed clients or explicitly accept and analyze the local-backend-impersonation regression. OQ2 may choose the endpoint shape, but it may not choose whether identity is authenticated.

3. **MATERIAL — SAFETY / FEASIBILITY — P1 production pruning, P5, Acceptance 5.**  
   **What is wrong:** `process.env.NODE_ENV !== "production"` plus hoped-for tree shaking is not a cross-client production admission boundary. Headless Node can read `SNAPBACK_URL` at runtime and may not be bundled at all. Vite distinguishes mode from `NODE_ENV` and permits a build with `NODE_ENV=development`; Expo has its own forced-build behavior. Thus “build-time only,” “pruned entirely,” and “no runtime override in production” do not follow from the proposed mechanism. [Vite environment semantics](https://vite.dev/guide/env-and-mode), [Expo environment semantics](https://docs.expo.dev/guides/environment-variables/).  
   **Concrete change:** Gate `declared-dev` using a generated, fail-closed artifact kind or separate dev-only entry point, with release target facts authoritative regardless of runtime environment. Treat dead-code elimination as bundle hygiene, not authorization. Extend acceptance to production Expo, Vite, unbundled headless Node, misleading `NODE_ENV`/mode combinations, and inspection that release artifacts cannot select the declared-dev source.

4. **MATERIAL — FEASIBILITY — P1 and OQ1.**  
   **What is wrong:** Having `@expo/snapback-expo` itself read `process.env.EXPO_PUBLIC_SNAPBACK_URL` is technically invalid under Expo’s documented transform: public variables must be statically referenced, and code inside `node_modules` is not transformed. Vite uses `import.meta.env.VITE_*`, while headless Node uses actual `process.env`; one library-side mechanism cannot transparently implement all three conventions. [Expo explicitly excludes `node_modules` from public-variable inlining](https://docs.expo.dev/guides/environment-variables/).  
   **Concrete change:** Put bundler-specific reads in application-owned/generated source and pass the resulting URL into the provider, or define platform-specific adapter entry points with demonstrated transforms. Preserve the one-variable user experience, but correct the ownership boundary in P1 and add cold-template acceptance for each supported bundler.

5. **MATERIAL — COHERENCE / SAFETY — P1, P3, P5, OQ3, Tradeoffs, Acceptance 3.**  
   **What is wrong:** The reachability policy contradicts the claimed scope. P1 rejects public backend hosts, yet a backend tunnel normally has a public HTTPS hostname. `SNAPBACK_DEV_AUTH_ORIGINS` admits the frontend’s browser origin; it does not make that tunneled backend URL admissible. A physical device cannot reach a host listener that remains loopback-only, and merely printing a LAN IP does not change that. One Expo `.env.local` value also cannot simultaneously mean host loopback for web/iOS and `10.0.2.2` for Android. OQ3 therefore hides a load-bearing scope and listener-security decision that the Spec cannot make alone.  
   **Concrete change:** Decide in this RFC whether canonical URL-first supports physical devices and public tunnels. Either admit explicit public HTTPS backend URLs with authenticated discovery while keeping the server loopback-bound behind an operator tunnel, define a secure opt-in LAN listener posture, or explicitly make physical-device development a supervised-path exception. Then define how a platform-specific Expo URL is selected and add separate web, iOS, Android-emulator, physical-device, devcontainer, and tunnel acceptance cases.

6. **MATERIAL — COHERENCE — P2, P5, Migration 2, Acceptance 6.**  
   **What is wrong:** Replacing exact admitted origins in the receipt with a `loopback-any` posture is not additive. LLP 0299 says the `snapback.application-ready.v1` format is receipt-verified across attach; changing its semantics conflicts with “receipt-verified lifecycle verbs unchanged,” “nothing existing breaks,” and an unchanged supervisor battery. Mixed old/new CLI, server, and persisted receipt behavior is undefined.  
   **Concrete change:** Choose an RFC-level compatibility posture: an additive representation old readers safely reject or understand, a versioned receipt with an explicit compatibility window, or a coordinated incompatible cut. Specify reader-before-writer migration and acceptance for attaching across the supported old/new combinations. Exact field encoding remains Spec-phase material.

7. **MINOR — SAFETY — P2 and Security analysis (“Hostile local page”).**  
   **What is wrong:** Loopback-open CORS is reasonable under the stated bearer-only/no-cookie model, but `SNAPBACK_DEV_AUTH_ORIGINS` is described both as narrowing and as admitting additional tunnel origins. Those are different set operations. The categorical claim that a hostile page “cannot use the user’s credentials” also overstates what CORS proves; the defensible claim is that CORS grants neither possession of an existing bearer nor authorization.  
   **Concrete change:** State that an explicit list replaces the default posture—or define another unambiguous operation—and narrow the security claim. The follow-on Spec should test loopback aliases, deceptive hostnames, explicit replacement, tunnel admission, missing bearer rejection, and forbidden origins.

8. **MINOR — COHERENCE / SAFETY — P3, P4, Security analysis, Acceptance 1–2.**  
   **What is wrong:** “The URL path mints nothing ambiently” conflicts with `snapback dev` printing a dev sign-in capability by default. It is also unclear whether that capability is reusable, shared-principal, or safe in captured CLI logs. Separately, “nothing new is written to disk” contradicts the proposed `.env.local` write, even if the URL is non-secret. Acceptance 2 proves two explicit signups can differ but does not prove the canonical path starts with no ambient authority.  
   **Concrete change:** Decide whether `snapback dev` mints a capability by default; preferably print instructions and mint only on explicit request. State that no credential is written to `.env.local` or any public bundler variable, describe the capability’s sharing posture, and test that declared-dev boot has no authenticated principal before explicit sign-in. Change the disk claim to “no token or session material is written.”

NOT READY
## Round 2 — delta round — 2026-08-24

- Target: llp/0300-snapback-is-a-url.rfc.md @ revision (c), landed a95cdc859, sha256 e68ef18932fa4a85e5dc68b1d9c5dd65b6c31897b8012637e2033af4ea1935a8
- Capsule: refine-0300/capsule-r2 (revision c + b→c unified diff + LLP 0299 + 2 tickets), dirhash 27bae16f5faf136b423bd475877ffceace2ceec49cf7a8412b1fb3a202976687
- Delta round: instructions enumerated the b→c delta and required IN-DELTA vs PRE-EXISTING classification
- Blindness: structural; fresh session
- Received: complete response; verbatim body follows

1. **MATERIAL · IN-DELTA · P1 “honest classification,” Tradeoffs, Alternatives.** The accepted-regression argument covers only same-UID attackers, but another UID in the same network namespace can also claim an unprivileged loopback port—particularly relevant to the newly admitted SSH/shared-host scenarios. Such an attacker cannot necessarily read `.snapback/`, yet can echo the client-visible identity and receive subsequent credentials; even a same-UID listener may capture plaintext credentials unavailable from the store. Replace “gains nothing” with an explicit threat model: either limit URL-first to trusted single-user namespaces and direct shared/multi-user environments to supervised/authenticated discovery, or require signed discovery there. Update the gains table and the dismissal of the middle alternative accordingly.

2. **MATERIAL · IN-DELTA · P1 discovery gate, causal matrix, Acceptance.** “On first use … performs one” exchange conflicts with “re-verifies identity at connect.” If a valid backend disappears and another backend takes the origin, cached approval could send a bearer before rediscovery, violating the stated mix-up guarantee. Require discovery for every new binding/connect episode, including reconnect after transport loss, before credentialed traffic. Add acceptance that verifies a correct initial connection followed by origin reassignment to a wrong backend.

3. **MINOR · IN-DELTA · P5 Scope ruling.** The RFC preserves loopback-only listeners but says non-loopback backend listeners “remain supervised-path territory,” while immediately admitting LAN listening needs another RFC. Those listeners are currently out of scope, not supervised. Likewise, “physical devices” overstates the named fallback: only Android `adb reverse` is established. State the exact supported supervised physical-device transports; classify all remaining physical-device and non-loopback-listener cases as out of scope.

4. **NIT · IN-DELTA · P1 URL admission / Scope ruling.** SSH and devcontainer port-forwards are topologies, not URL host aliases. Describe them as producing a literal-loopback URL; reserve the host allowlist for concrete literals and explicitly named aliases such as `10.0.2.2` and `host.docker.internal`.

5. **NIT · IN-DELTA · Open questions / Spec obligations.** “Prune predicate mechanics per bundler” risks reintroducing tree-shaking as the boundary after P1 correctly rejects that model. Rename the obligation to structural entry-point/generated-artifact selection and release refusal mechanics; list pruning separately as bundle hygiene.

The structural production gate, application-owned bundler reads, compatibility posture, and causal decomposition are sound at RFC altitude. Exact packaging, receipt encoding, and canonicalization remain appropriately Spec-phase details.

**IN-DELTA:** MATERIAL findings #1–2.  
**PRE-EXISTING:** no MATERIAL findings.  
**Scope-ruling dimension:** no MATERIAL findings.  
**Entry-point-gating dimension:** no MATERIAL findings.

NOT READY