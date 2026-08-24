# LLP 0300 reviews — grok family

## Round 1 — 2026-08-24

- Target: llp/0300-snapback-is-a-url.rfc.md @ revision (b), sha256 854450c675e9e244122ae5825f3e9fdf95c9c21159a7136d61e6c4d2383e0a31
- Capsule: refine-0300/capsule-r1 (RFC + LLP 0299 + 2 referenced tickets), dirhash 711dcf18afb18c675ab130f06273bb78c171a5c727940d5fe6889259c855b338
- Reviewer: grok-4.6 @ xhigh (headless, full terminal ban in prompt, capsule inline)
- Blindness: structural (capsule contains no llp/reviews/*, no run journal); fresh session
- Received: complete response; verbatim body follows

```
(verbatim)
```

# LLP 0300 review (round 1) — Grok family, adversarial

URL-first as the **canonical** development binding is the right inversion: the remaining cost after LLP 0299 is supervisor ownership of the bundler plus a pre-admitted binding that makes that ownership mandatory. The Convex/Supabase comparison is good for that claim and incomplete for the threat model. The RFC is **not** internally consistent on devices/LAN vs loopback-only listeners, and it overclaims the safety equivalence of connect-time discovery.

---

## Decision quality

**No MATERIAL findings in decision quality.**

1. **MINOR — Summary, Background, Alternatives; Convex/Supabase comparison.**  
   What is wrong: The comparison is honest on the coupling that actually hurts (`npx convex dev` / `supabase start` never spawn, proxy, or enumerate the bundler; one env var is the whole client contract). It elides differences that change how far the analogy may be pushed: Convex/Supabase URLs name a **service** (hosted multi-tenant, or a local stack that is a replica of one); Snapback’s URL names a **local single-tenant binary** whose generated `app` identity must match that process. CORS `*` on a hosted API with a published anon key is not the same control as loopback-open CORS on a machine-local database. Several cited costs are also **already LLP 0299’s bug (3)** — restart-verb port drift, Clique M1 36-minute split-the-stack — not costs of pre-admission. Metro IPv6 wedge, HMR-through-proxy, `lsof` enumeration, process-kill witnesses, ambient mint, and binding vocabulary **are** costs of (2)+(3) and are enough.  
   Concrete change: Narrow the analogy to “local `convex dev` / `supabase start`”: one env var, backend never owns the bundler. Move 0299-fixed port instability to “prerequisite already landed,” and rest the inversion on supervisor-as-bundler-parent plus refuse-raw-URL. State explicitly that Snapback still has a generated-identity mix-up problem those products do not.

2. **MINOR — Summary, Tradeoffs; “2.7k lines stop being load-bearing.”**  
   What is wrong: P5 keeps the supervisor’s code, batteries, and Android polish. Demotion does not delete that surface; it stops making every Expo app pay it. Treating line count as recovered cost oversells the inversion.  
   Concrete change: Gain column should read that those lines **stop being on the canonical path and stop teaching agents the rendezvous**, not that they stop existing.

---

## Safety

3. **MATERIAL — P1, Security analysis (“Wrong-generation backend”).**  
   What is wrong: Issuance and connect-time discovery are **not** the same invariant at a later time. Issuance: the client never had a channel to a backend until a live supervisor attested the binding. Discovery: the client **opens a channel to the configured URL** and asks **that URL** who it is. Three defects follow.  
   (a) The RFC never requires that the identity fetch is unauthenticated and that **no bearer, session, or mint** is sent until match. Without that gate, a stale/wrong URL (other local app on the stable port, leftover process) receives credentials the issuance path never presented.  
   (b) Verification against the generated `app` export is **mix-up detection**, not authenticity. That identity already lives in generated files and the JS bundle; a hostile loopback server can echo it and pass. Supervisor rendezvous/attestation was a different (stronger, local-IPC) bar.  
   (c) “Same safety property the supervised binding provides” is therefore false, and it is a decision, not a Spec detail.  
   Concrete change: In P1, add a fail-closed gate: identity GET carries no credentials; **zero** other client calls until match; mismatch → existing `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` naming both identities; any other failure → ordinary connect refusal, not a binding. In Security analysis, replace “same invariant, later detection” with: **wrong-generation/wrong-app mix-up stays fail-closed; backend authenticity in dev is “the URL the operator configured,” not supervisor attestation; production/runtime URL override stays closed.** Spec sequences the calls; the RFC must state the gate.

4. **MATERIAL — P1, OQ2, Security analysis.**  
   What is wrong: P1 says the client fetches “the operational-readiness surface.” OQ2 leaves “reuse as-is” as a live option while also requiring the surface to be **unauthenticated**. Readiness receipts are lifecycle/custody-adjacent. An unauthenticated loopback GET that returns them is a new leak issuance never allowed (IPC to the supervised client). “The Spec decides” cannot choose a leaky reuse; that is an RFC safety ruling hiding as an open question.  
   Concrete change: Strike reuse-as-is. RFC requirement: unauthenticated, identity + admission posture only; **no** receipts, tokens, ports-of-others, or lease/reaper state. OQ2 may only choose path/shape (`/_snapback/identity` vs a reduced projection of readiness).

5. **MINOR — Security analysis (“Hostile local page”), P2.**  
   What is wrong: The write-up only refutes **credential theft** (correct: no cookies, CORS cannot steal a bearer the page does not hold) and then calls the allowlist “defense-in-depth for this non-attack.” The allowlist **did** close a browser-only attack: JS on another loopback origin cannot preflight JSON calls to unauthenticated APIs (signup, identity, any unauthenticated POST) and read the responses. `curl` from the same machine always could; a malicious or XSS’d local page could not. Loopback-open CORS opens that browser channel. Production is unchanged; the analysis is still incomplete.  
   Concrete change: Record an accepted tradeoff: any loopback origin may call and read the **unauthenticated** dev surface; session theft stays closed; `SNAPBACK_DEV_AUTH_ORIGINS` remains narrowing. Define “loopback origin” as **literal** `localhost` / `127.0.0.1` / `[::1]` (plus port), not “DNS that resolves to loopback,” so rebinding (`attacker.com` → `127.0.0.1`) is not admitted.

6. **MINOR — P3, Security analysis (“nothing new is written to disk”).**  
   What is wrong: `.env.local` is a disk write. It is not a token, but the sentence is broader than the Token-custody bullet.  
   Concrete change: Scope the claim: **no new token/custody artifact on disk**; optional `.env.local` may hold only the URL (non-secret, gitignored). Forbid writing the P4 capability into `.env.local` in this RFC.

---

## Coherence

7. **MATERIAL — P1 admission rule, P5, OQ3, Tradeoffs “weird setups”, Acceptance 3.**  
   What is wrong: Four load-bearing statements do not compose, and OQ3 is not a Spec-sized leftover:  
   - Canonical path is URL-first for React/Expo.  
   - P1 already **admits** “explicitly private host class” URLs (and OQ3 is only “see also”).  
   - P5 **freezes** loopback-only listeners.  
   - Gains table: tunnels, devcontainers, **remote VMs**, devices work “by construction.”  
   A private-host `SNAPBACK_URL` (`192.168.x.x`, LAN device, remote VM NIC) fails at TCP if the backend still binds loopback. `10.0.2.2` / `host.docker.internal` are **aliases to host loopback**, not that class. Acceptance 3 tests client-origin tunnels (`SNAPBACK_DEV_AUTH_ORIGINS`) and port-forwards — not a device reaching a LAN-bound API. The Spec cannot both obey P5 and fulfill P1/OQ3/device-canonical without an RFC posture ruling. Parking it in OQ3 is a hidden decision.  
   Concrete change: Close OQ3 in this RFC, one of:  
   **(A) Recommended.** Canonical URL path = web, iOS sim, Android emulator (`10.0.2.2` print), SSH/devcontainer port-forward, client-origin tunnels via existing narrowing. Physical devices and non-loopback binds stay **supervised** (adb reverse / whatever P5 already owns). Delete P1’s “explicitly private host class” as a general admission rule; list the alias/forward exceptions. Strike “remote VMs / devices by construction.”  
   **(B)** Bound `--lan` (or equivalent) as an explicit listen-address exception, with a threat note (LAN-reachable unauthenticated surface), and **amend P5** (“loopback-only by default; `--lan` is the documented exception”). Do not leave both P1 private-host admission and P5 unchanged.

8. **MINOR — P3 vs OQ1.**  
   What is wrong: P3 already rules `.env.local` “explicit flag or template opt-in, not silently.” OQ1 reopens “by default in templates or only on opt-in,” which is the same decision.  
   Concrete change: Keep P3. Shrink OQ1 to **names and precedence** of the env vars. If templates ship a committed `.env.example` plus gitignored `.env.local` writer, say that in P3 as the template opt-in.

9. **MINOR — Migration step 2 vs P2 vs Acceptance 5–6.**  
   What is wrong: P2’s default `loopback-any` is a **behavior and receipt-schema change**, not additive no-ops. Receipts that recorded exact origins become a posture enum. Calling this “nothing existing breaks” fights Acceptance 6 (`--expo` battery unchanged) unless `--expo` still injects `SNAPBACK_DEV_AUTH_ORIGINS` and batteries assert posture, not bytes of the old origin list. Acceptance 5’s “byte-identical” release admission is also stronger than the proposal (new pruned source will not be byte-identical bundles).  
   Concrete change: Migration 2: `--expo` remains pin-compatible (supervisor still may set exact origins); **plain/URL default** becomes `loopback-any`. Acceptance 5: **behavioral** identity of release admission (no `declared-dev` in production; target-tuple rule unchanged), not byte-identical artifacts. Acceptance 6: `--expo` battery still passes; receipt assertions updated to posture.

10. **MINOR — P4 vs Acceptance 1.**  
    What is wrong: P4 removes ambient mint; Acceptance 1 wants a “working authenticated app” from two terminals and **one** pasted env var. Either the agent signs up through the template UI (then “one env var” is true and “authenticated” means “can complete signup”), or `snapback dev` prints a second capability (then Acceptance 1 is wrong, and auto-consuming that capability would reintroduce one-mint-many-tabs). “By construction” only holds if the template does **not** install that capability as the app session.  
    Concrete change: Acceptance 1: cold two-process bring-up, one URL, **logged-out** app, then ordinary signup. Treat the printed P4 capability as an optional operator tool, not template auto-login. Acceptance 2 already tests the real P4 property — keep it.

---

## Feasibility

**No MATERIAL findings in feasibility.**

11. **MINOR — P1, P3; bundler env.**  
    What is wrong: `EXPO_PUBLIC_*` / `VITE_*` inlining at bundler start is correctly implied, but two operational facts are underspecified for a claim that “M1 = start backend, read URL, start bundler”: (1) Metro/Vite will not see a `.env.local` write after they have started — order is backend **then** bundler, or restart. (2) A **single** `EXPO_PUBLIC_SNAPBACK_URL` cannot be `127.0.0.1` (web, iOS sim) and `10.0.2.2` (Android emulator) at once without adb reverse, which P5 just moved off the canonical path. Printing variants is not a configuration. This is how self-hosted backends work; the RFC should not pretend one pasted value serves every Expo target.  
    Concrete change: P3: document bring-up order; canonical template value is `http://127.0.0.1:<port>`; Android emulator is either manual `10.0.2.2` **or** supervised/adb-reverse convenience. Spec picks env names and the prune predicate (`__DEV__` vs `NODE_ENV`, read **inside** the pruned module so DCE can drop `EXPO_PUBLIC_*` inlining). Those last items are Spec work, not RFC blockers.

12. **NIT — P1 “http(s) origin” canonicalization.**  
    Trailing slash, `localhost` vs `127.0.0.1` as **backend URL** (distinct from CORS origin), IPv6 brackets: defer to the Spec, mirroring `--external-client-origin`. Do not block.

13. **NIT — related/migration “LLP 0299 in flight.”**  
    Provided 0299 text is **Implemented**. Step 1 is “already landed,” not a gate. Documentary.

---

Named for the Spec, **not** RFC blockers: discovery path and JSON shape (within finding 4’s constraints); exact env precedence; CORS matcher implementation; whether `--external-client-origin` deprecates (OQ4); whether new features may land on `--expo` (OQ5).

---

NOT READY

## Round 2 — delta round — 2026-08-24

- Target: llp/0300-snapback-is-a-url.rfc.md @ revision (c), landed a95cdc859, sha256 e68ef18932fa4a85e5dc68b1d9c5dd65b6c31897b8012637e2033af4ea1935a8
- Capsule: refine-0300/capsule-r2 (revision c + b→c unified diff + LLP 0299 + 2 tickets), dirhash 27bae16f5faf136b423bd475877ffceace2ceec49cf7a8412b1fb3a202976687
- Delta round: instructions enumerated the b→c delta and required IN-DELTA vs PRE-EXISTING classification
- Blindness: structural; fresh session
- Received: complete response; verbatim body follows

The prompt is truncated, so I’ll read the offloaded full request first and then review only that text.## Dimension verdicts

1. Credential-free discovery / accepted-regression: **no MATERIAL findings** (decision sound; supporting lemma is overstated).
2. Entry-point / artifact gating: **no MATERIAL findings**.
3. Bundler env reads in application-owned source: **no MATERIAL findings**.
4. Scope ruling: **MATERIAL** (P1 host allowlist does not match the ruling, and one listed “alias” does not terminate on loopback).
5. Receipt compatibility posture: **no MATERIAL findings**.
6. Causal matrix / comparisons / middle alternative: **no MATERIAL findings**.
7. Mint / disk claims: **no MATERIAL findings**.
8. Literal-loopback origin matching / list-replaces-default: **no MATERIAL findings**.
9. Acceptance / OQs: **no MATERIAL findings**.

No PRE-EXISTING findings. No PRE-EXISTING MATERIAL findings.

---

## Findings

1. **MATERIAL, IN-DELTA, P1 admission rules (conflicts with P5 + Scope ruling).**  
   P1 admits `host.docker.internal` and “SSH/devcontainer port-forwards” as a single **host-loopback alias** class with `10.0.2.2`, claiming they “terminate at the host’s loopback listener.” That class is false as stated and wider than the scope ruling. `10.0.2.2` (Android emulator) is a real host-loopback alias. An SSH/devcontainer **port-forward** is not a hostname; the client URL stays `http://127.0.0.1:<port>` (already admitted as literal loopback). `host.docker.internal` resolves to the host’s docker-gateway / host IP, not `127.0.0.1`. With P5’s unchanged loopback-only listeners, that URL does not reach the backend, and the string allowlist admits a host that targets a **non-loopback** host interface.  
   **Change:** Make P1’s admitted hosts match the scope ruling: literal loopback (`127.0.0.1` / `localhost` / `[::1]`) plus `10.0.2.2` only. Describe SSH/devcontainer as a **topology** that still uses `127.0.0.1`. Drop `host.docker.internal` unless this RFC adds an explicit host-side loopback forward and treats that as a separate, analyzed path.

2. **MINOR, IN-DELTA, P1 “honest classification” / Tradeoffs / Security.**  
   Accepting mix-up detection instead of server authentication is sound (same posture as local Convex/Supabase; same-UID authenticity is not a control). The warrant “the attacker it admits **gains nothing** because a same-UID port-racer can already read `.snapback/`” is not true under this revision’s own P4: the canonical path no longer puts the app session in the store, so an impersonating listener can still collect **in-flight** bearer tokens from ordinary signup. Same-UID already implies debugger/ptrace/filesystem on the client; that is the real lemma.  
   **Change:** Keep the decision. Replace the store-read “gains nothing” sentence with: same-UID is already local compromise of the client; remaining localhost impersonation is the accepted URL-trust of comparable stacks. Apply the same recast to the middle alternative’s “same theater” line.

3. **MINOR, IN-DELTA, P1 vs causal matrix.**  
   P1 runs the gate “on **first use**”; the matrix and Summary require identity verified **at connect** / before any authenticated call. Under LLP 0299 stable ports, a still-running client can keep sending credentials after a different app/generation takes the same port.  
   **Change:** State a standing prefix: no credentialed call without a successful match for the backend currently at that URL (reconnect / generation change included). Cadence details may go to Spec.

4. **MINOR, IN-DELTA, P1 opening sentence vs “Production gating is structural.”**  
   Lead-in still says “in **development builds**, the provider accepts…”, which is the NODE_ENV framing this revision rejected.  
   **Change:** “From the dev-only entry point / generated artifact kind, the provider accepts… Release artifacts cannot select it, regardless of `NODE_ENV`.”

5. **MINOR, IN-DELTA, Acceptance 5 (weaker than the gating claim).**  
   Structural gating exists to survive a URL being **present**. Revision b tested a production build that contains `SNAPBACK_URL`; revision c dropped that and only names a misleading `NODE_ENV`. Templates still pass `url={process.env…}` from application source.  
   **Change:** Acceptance 5 must include: production Expo, production Vite, and unbundled headless with the URL env/prop set still cannot select `declared-dev`; target-tuple admission unchanged.

6. **MINOR, IN-DELTA, P2 explicit-list-replaces-default.**  
   Replace-not-union is the right narrowing rule, but the paved tunnel-client path then requires restating loopback or localhost dies when the operator sets `SNAPBACK_DEV_AUTH_ORIGINS` to a tunnel origin alone.  
   **Change:** One sentence: the explicit list is the full allowlist; include literal loopback origins if they must remain admitted.

7. **MINOR, IN-DELTA, OQ1.**  
   After delta (3) the library does not read env; “prop > env” is leftover library-precedence. Precedence lives in application-owned source.  
   **Change:** OQ1 = template env **names** only. Drop library-level prop/env precedence, or state that the library has a single `url` argument.

8. **NIT, IN-DELTA, Open questions “Spec obligations” vs P1 gating.**  
   “Prune predicate mechanics per bundler” reads as DCE, which P1 says is not the authorization boundary.  
   **Change:** “Dev-entry / generated-kind exclusion per bundler (resolution or codegen, not DCE).”

---

## Decisions (not defective)

- **Accepted regression:** mix-up detection, fail-closed, not server authentication; supervised issuance retained; signed discovery opt-in with the codegen/store constraint recorded. Keep it; fix finding 2’s lemma only.
- **Entry-point / generated-artifact gating, including unbundled headless:** correct inversion of NODE_ENV/DCE. Spec chooses entry vs generated kind; both are valid if release cannot select `declared-dev`.
- **Scope ruling (former OQ3):** canonical = web, iOS sim, Android emulator via `10.0.2.2`, port-forwards, tunnel **client** origins via narrowing; physical devices and non-loopback **listeners** supervised; no private-host class; public-tunneled **backend** out of scope. Sound once P1’s host list matches (finding 1).
- **Application-owned env read, P2 literal origins (no DNS-to-loopback), list-replaces-default, receipt dual-path compatibility, causal matrix, middle alternative, mint/disk narrowing, logged-out acceptance:** sound.

## Spec-phase (do not block)

Receipt posture encoding and old/new attach parse behavior; URL canonicalization (`localhost` vs `127.0.0.1`, `[::1]` brackets, `http` vs `https`); discovery path/shape (OQ2); production Provider behavior when `url` is passed; re-verify cadence; per-bundler exclusion of the dev artifact; whether an explicit origin list must restate loopback (finding 6 is the RFC sentence; mechanics stay Spec).

NOT READY
