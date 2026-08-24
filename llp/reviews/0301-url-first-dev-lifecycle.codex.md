# LLP 0301 + 0302 (Spec cluster) reviews — codex family

## Cluster round 1 — 2026-08-24

- Targets: 0301(b) sha256 35006796426c5ff9933c11442f2d672e671c64ac39790cf94002367da57dc90c ; 0302(b) sha256 646d37728824322b1494897190b6c4023e2e722860e1a2d5d790438a008b4340 (landed 466807e3b)
- Lockstep cluster; capsule refine-specs/capsule-r1 (both specs + 0300 + 0299); hashes in run journal
- Received: complete response; verbatim body follows

1. **MATERIAL — 0302 §1, §5, §8.1 — generated-kind gating does not actually close the release path.** The shared template imports `generated/declared-dev.mjs`, yet release codegen omits that file. Thus normal release builds fail instead of retaining unchanged release admission. Incremental dev→release generation may also leave a stale file, and the exported capability is a forgeable object authenticated only by public deployment identity. Concrete change: generate a stable module in both modes; the development variant contains the `declared-dev` arm while the release variant excludes it and uses target-tuple admission. Atomically replace generated output and test dirty incremental transitions. Expo, Vite, and unbundled Node release fixtures must all build successfully with the URL environment variable and `url` argument present while proving `declared-dev` is unreachable.

2. **MATERIAL — 0301 §1 + 0302 §3 — restart detection has no safe signal path.** 0301 carries `startupNonce` only in the identity response and mentions the supervised bootstrap, which the URL path does not use. 0302 expects nonce changes on ordinary responses/streams, but 0301 never requires those transports to carry it. Learning a new nonce from a response after a credentialed request is too late. Fetch-based HTTP also exposes no dependable connection-reconnect event, so a client may remain “verified” after replacement. Concrete change: normatively define episodes per actual transport. Every newly opened persistent transport must complete identity discovery before application traffic; a stateless HTTP transport must treat each independent request/connection as a new episode or use an explicit credential-free preflight channel. Add `Cache-Control: no-store`, client-side cache bypass, and redirect refusal. Test backend replacement under connection pooling and reconnect races.

3. **MATERIAL — 0301 §1 — `startupNonce` contradicts the RFC’s identity-and-posture-only ruling.** It is server-incarnation/correlation data, not deployment identity or admission posture. Calling the four-field shape “nothing more” does not resolve that contradiction. Concrete change: remove `startupNonce` from the fact and base cadence on transport lifecycle. Retaining it would require changing the settled RFC rather than merely implementing it.

4. **MATERIAL — 0301 §2–§3, §8.3 — receipt posture is wrong for explicit plain runs and attach behavior is unspecified.** “Plain runs write `loopback-any`” contradicts §2 whenever origins were explicitly declared; such runs must record `explicit-list`. Moreover, an attach cannot change the already-running server by setting an environment variable. Reader-before-writer sequencing and unknown-field tolerance do not define what old and new readers do with a `loopback-any` receipt containing an empty `clientOrigins`. Concrete change: specify the exact writer matrix and attach compatibility:

   - Plain without declarations: `loopback-any`, empty `clientOrigins`.
   - Plain with declarations: `explicit-list`, complete union.
   - Supervised: `explicit-list`, exact merged origins.
   - Missing field: legacy `explicit-list`.

   Require attach to compare the requested and recorded admission contracts and refuse or deliberately restart on mismatch. Enumerate expected outcomes—not merely parser success—for all four old/new combinations.

5. **MATERIAL — 0302 §4, §7, §8.4 — rendezvous precedence is internally inconsistent and contradicts RFC precedence.** Section 4 says a completed rendezvous wins and the URL is not consulted; §7 and acceptance require refusing when both live origins disagree. Establishing that conflict necessarily consults the URL, and refusal means rendezvous did not win. Concrete change: follow LLP 0300 literally: a present rendezvous selects supervised binding and ignores the URL; a configured but failed rendezvous refuses without URL fallback; only absence selects `declared-dev`. Remove `SNAPBACK_APP_BINDING_SOURCE_CONFLICT`, or obtain an RFC amendment before retaining conflict refusal.

6. **MATERIAL — 0302 §6, §9 — a recorded Spec-phase obligation is deferred out of the Specs.** LLP 0300 explicitly records opt-in signed discovery as Spec-phase work. Filing an unspecified future issue is not ownership or a design. Concrete change: specify the opt-in protocol, fingerprint delivery channel, key custody, downgrade behavior, rotation, diagnostics, and acceptance here, or reference a concrete sibling Spec that must be ready as part of this implementation set.

7. **MATERIAL — 0301 §5, §8.5 — the dev-session contract cannot yet be implemented or audited for disk safety.** The default target when `--ready-file` is absent, ambiguity among running backends, stale-receipt verification, omitted-email semantics, JSON shape, and exact mint refusals are unspecified. More importantly, “ready-file descriptor + managed admin token” does not say how a separate process obtains the admin capability without putting it in the ready file, environment, or another disk artifact. Concrete change: define target-resolution precedence, receipt/app/incarnation verification, email semantics, stdout/stderr and JSON schemas, and the exact existing secure-store or authenticated-IPC seam supplying the admin capability. Add inspection of ready files, project files, environment snapshots, and temporary files for credential material.

8. **MATERIAL — 0301 §1 + 0302 §1–§3 — the shared wire identity is not an exact interoperable contract.** `deployment: { "…": ... }` and “equals” leave Rust and JavaScript implementers free to choose different fields, normalization, and equality—including erroneous JavaScript reference equality. The same ambiguity affects `provenance.generation`. Concrete change: name or reproduce the exact versioned `DeploymentIdentity` schema, required/optional fields, serialization, semantic comparator, unknown-version behavior, and mismatch diagnostic fields. Both wire matching and generation-provenance matching must use that comparator.

9. **MATERIAL — 0302 §2 — the RFC’s URL-canonicalization Spec obligation remains unresolved.** “Mirrors `--external-client-origin`” is insufficient because this validator adds `10.0.2.2`, runs in JavaScript, and must distinguish literal hosts from parser-normalized aliases. Root slash handling, default ports, trailing-dot hosts, alternate IPv4 spellings, case, and IPv6 serialization are not ruled. Concrete change: define one normative algorithm plus shared accepted/refused vectors, then run those vectors against the CLI/server and all three client consumers.

10. **MATERIAL — SET, both §8 acceptance sections — the batteries do not jointly cover all nine RFC rows.** Missing or incomplete coverage includes: row 3’s end-to-end SSH/devcontainer forward; row 5’s successful Expo/Vite/headless release matrix; row 8’s backend-data preservation and ordinary re-sign-in; and row 9’s inability to obtain another principal’s bearer or exceed new-principal authority. Concrete change: add a nine-row traceability table assigning every assertion to an executable battery and fill these cases.

11. **MATERIAL — 0301 §6/§9 + 0302 §5/§9 — documentation and amendment obligations are orphaned.** LLP 0300 requires the guide to teach URL-first first, explain bundler restart and native port pinning, demote supervised mode to an appendix, and add amendment notes to LLP 0181/0223. The targets own only limited template/migration prose and explicitly exclude other guide work. Concrete change: assign these deliverables to 0301 with named files/topics and acceptance checks; 0299’s own amendment is already present.

12. **MINOR — 0301 §4 — marker-block writer mechanics permit stale duplicate values.** If one of the three managed keys already exists outside the block, adding another copy has parser-order-dependent behavior and can defeat refresh-on-rebind. Duplicate/malformed marker blocks, interruption, and concurrent writers are also unspecified. Concrete change: refuse external duplicates with a typed diagnostic or define an explicit migration policy; require one well-formed block and atomic replacement preserving unrelated bytes and file mode.

13. **MINOR — 0301 §2 — the posture environment variable’s trust boundary is asserted rather than defined.** Users can supply process environment, missing values have no rule, and “fails closed to explicit-list semantics” conflicts with “startup refusal.” Concrete change: state that the local process launcher is a trusted operator boundary, `runDev` overwrites rather than inherits this backend-child-only variable, direct/missing/invalid values abort startup, and inconsistent posture/list pairs are refused. This makes the boundary sound without treating the variable as an authentication mechanism.

Dimension status: **FAITHFULNESS — MATERIAL findings; IMPLEMENTABILITY — MATERIAL findings; CROSS-SPEC CONSISTENCY — MATERIAL findings; SAFETY — MATERIAL findings.** No dimension is clean at MATERIAL severity.

0301: NOT READY  
0302: NOT READY  
SET: NOT READY
## Cluster round 2 (delta) — 2026-08-24

- Targets: 0301(c)+0302(c) at bda23afc7; capsule + hashes in run journal
- Received: complete response; verbatim body follows

1. **MATERIAL — IN-DELTA — LLP 0301 §2b.** The canonicalizer applies a fixed loopback hostname set to CLI declarations, contradicting LLP 0300 P2/Acceptance 3, which permits explicitly declared non-loopback client origins. Separate syntactic origin canonicalization from host-policy admission: explicit lists may contain canonical HTTP(S) origins; `loopback-any` and `declared-dev` retain their fixed host sets. Add a positive tunnel-origin vector.

2. **MATERIAL — IN-DELTA — LLP 0301 §3.** `old-CLI/new-plain-receipt = refuses` is not implementable as specified. A legacy CLI that ignores `admissionPosture` cannot execute the new posture comparison, and `clientOrigins: []` does not guarantee its existing verifier refuses. Either use an encoding/version that legacy readers already reject, or permit legacy attachment with an explicit safety analysis. Also state an actual success/refusal outcome for `new-CLI/old-receipt`, not merely its interpretation as `explicit-list`.

3. **MATERIAL — IN-DELTA — LLP 0301 §9.** Signed discovery is not yet a viable protocol. A fingerprint alone cannot verify Ed25519 without the public key, and a static signature over `deployment + admissionPosture` is replayable by a replacement listener. Fully specify key carriage, fingerprint and signature encodings, freshness, and binding to the ensuing transport—or explicitly defer the protocol’s normative design to a future Spec instead of freezing §9 as designed.

4. **MATERIAL — IN-DELTA — LLP 0302 §3.** The request/response residual violates LLP 0300’s settled standing gate. Without a standing stream, a successful same-port replacement produces none of the listed episode starts; therefore potentially every later call—not merely one—can reach the replacement without re-verification. The single-user-host authenticity tradeoff does not cover accidental wrong-generation mix-ups. Require request/response consumers to verify before every operation, or define every unmonitored transport use as a new episode.

5. **MINOR — IN-DELTA — LLP 0302 §§1, 4.** The literal precedence table says absent rendezvous plus `url` always selects `declared-dev`, while §1 says release artifacts ignore `url`. Qualify the table as applying only when the generated capability is present, or add capability availability as a table dimension.

6. **MATERIAL — IN-DELTA — LLP 0301 §§3–4, 7 and LLP 0302 §§1, 3, 7.** Several newly typed refusal branches have no pinned diagnostic code: attach-contract mismatch, writer structural conflicts, malformed identity facts, unbranded candidates, and generation-provenance mismatch. Before the normative surface freezes, add a matrix assigning each branch an exact new or explicitly reused code.

No MATERIAL findings: PRE-EXISTING surface in either target; identity caching/redirect rules, spawn-owned posture validation, dev-session contract, traceability, structural generation gating, and rendezvous-wins resolution.

0301: NOT READY
0302: NOT READY
SET: NOT READY
## Cluster round 3 (post-freeze punch-list) — 2026-08-24

- Targets: 0301(d)+0302(d) at afb51ced0; own-family punch list; hashes in run journal
- Received: complete response; verbatim body follows

#1: DISPOSITION ERROR — 0301 §2b still calls the fixed-host rejection vectors “shared” and requires every consumer to reject `attacker.dev` and `192.168.1.10`, contradicting explicit-list syntax that admits any canonical HTTP(S) origin. Split syntax vectors from fixed-set host-policy vectors.

#2: VERIFIED

#3: VERIFIED

#4: VERIFIED

#5: VERIFIED

#6: VERIFIED

Diff-soundness findings:

MATERIAL — 0301 §8.3: acceptance still references “four CLI×receipt cells,” while revision d establishes six rows. Change it to require all six §3 outcomes.

MATERIAL — 0302 §3: narrowing un-verification from every non-2xx response to only 5xx is unsound. A replacement or wrong listener can return 4xx, leaving the client verified for subsequent calls. Restore non-2xx un-verification or provide an equivalently fail-closed classification.

MATERIAL — 0302 §7: the diagnostics inventory says the only new client code is `SNAPBACK_APP_BINDING_URL_INVALID`, contradicting revision d and 0301 §7a, which also introduce `SNAPBACK_APP_IDENTITY_FACT_INVALID` and `SNAPBACK_APP_BINDING_DECLARED_DEV_REFUSED`. Update the inventory and new/reused classifications.

Obligations to record:

RECORD-AS-OBLIGATION — Define “top-level operation” for stream-less clients, including nested/concurrent operations, and add an executable per-operation preflight battery.

0301: NOT READY
0302: NOT READY
SET: NOT READY