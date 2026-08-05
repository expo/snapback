# LLP 0168 + 0169 cluster review — gpt-5 family

**Targets:** `llp/0168-browser-carrier-dev-edge.research.md`, `llp/0169-insecure-context-store-diagnostic.spec.md`
**Reviewed revisions:** 0168 `dc5d70a1…`, 0169 `ec5ae251…`
**Capsule sha256:** `a59f0999dbbd3954…`
**Runner:** codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only
**Independence:** **SELF-REVIEW — this family authored both documents.** Launched with an explicit adversarial-self-review instruction. Reduced weight; see the run journal.

---

## Round 1 (lockstep cluster) — 2026-08-04

1. [MATERIAL] [0168] — Section: “The LLP 0030 policy-sharing contract.” The prior authoring choice was mistaken: this is normative design inside a Research document. It selects generated-artifact bytes, canonicalization vectors, digest negotiation, refusal behavior, and a required LLP 0030 amendment. It also blurs authority with Active LLP 0031, whose registered route collection is already the server route-classification source. Fix: retain only the research constraint that consumers must not maintain divergent admission policy; move the exact artifact and handshake design into the successor RFC or an explicit LLP 0030/0031 amendment.

2. [MATERIAL] [0168] — Section: “Go/no-go gate for a successor RFC.” The gate is internally unsatisfiable. It requires an implemented policy artifact, an access-capability proof, an exact integrated-topology compatibility proof, and security tests before an RFC may be opened, while the concluding sentence prohibits that implementation work. This either deadlocks the investigation or encourages an unreviewed security-sensitive prototype. Fix: split it into an RFC-opening gate—demand evidence, threat model, candidate topology/auth designs, and a bounded prototype plan—and a later implementation/acceptance gate containing items 3–7.

3. [MATERIAL] [0168] — Section: “A browser access capability is necessary but not yet designed.” The candidate cookie is incorrectly described as “origin-scoped.” Cookies are not port-scoped; even `__Host-` cookies ignore the port component, so a bearer cookie can reach another HTTPS service on the same hostname. The current wording can feed an unsafe successor design. [The current HTTP cookie draft states this limitation explicitly.](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/22/) Fix: call it a host-only cookie, require a `__Host-` name with `Secure; HttpOnly; Path=/; SameSite=Strict` and no `Domain`, and require a dedicated-hostname or sibling-port leakage proof.

4. [MATERIAL] [0169] — Section: “S3. Development warning.” The build-mode predicate is contradictory. `__DEV__ === true` or `NODE_ENV === 'development'` positively identifies development, but an “explicitly production build” must not warn without defining that predicate or precedence. For example, `__DEV__ === true` with `NODE_ENV === 'production'` satisfies both rules. Fix: define a complete precedence/truth table—including `__DEV__ === false`, `NODE_ENV === 'production'`, and both conflicting combinations—and add those cases to acceptance.

5. [DETAIL] [0169] — Section: “Acceptance,” item 9. Two clients imported through one module instance prove module-level deduplication, not the normative “once per JavaScript realm” rule. Two bundled or duplicated package instances in one realm can each maintain their own flag. Fix: either narrow S3 to once per loaded package instance or add a duplicate-module-copy test and require a realm-shared sentinel.

What is good: the factual chain is sound. Web Locks is marked `[SecureContext]`; the trustworthy-origin algorithm admits HTTPS, loopback IPs, and conforming `localhost`, not ordinary LAN HTTP. IndexedDB databases belong to storage keys, while tuple origins distinguish scheme, host, and port. [Web Locks](https://w3c.github.io/web-locks/), [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/#potentially-trustworthy-origin), [IndexedDB](https://w3c.github.io/IndexedDB/#database-construct), [HTML origins](https://html.spec.whatwg.org/multipage/browsers.html#origins).

The supplied [store ladder](/Users/ccheever/projects/snapback/packages/snapback-client/rqs-store-default.mjs:110), [profile resolver](/Users/ccheever/projects/snapback/src/admin.rs:279), and [receipt](/Users/ccheever/projects/snapback/demos/warble/evidence/insecure-context-origin-comparison.json:1) support the documents’ corresponding claims. The Research/Spec split is correct in principle: 0168 honestly refuses to authorize the edge, while 0169’s S1 predicate and fallback behavior stand alone and deliberately avoid misdiagnosing missing IndexedDB, unknown `isSecureContext`, secure-context browser-support gaps, React Native, Node, and explicit store choices. No substantive pair-level coupling contradiction was found.

0168: NOT READY

0169: NOT READY

SET: NOT READY

---

## Round 2 (delta) — 2026-08-04

**Reviewed revisions:** 0168 `5fc28d78…`, 0169 `50bb6302…`
**Capsule sha256:** `fcc9d965b613a149…`

1. `[IN-DELTA] [MATERIAL] [0168]` — **The two-axis comparison: “Mitigation available today.”** “Set `SNAPBACK_PROFILE` explicitly” is not a mitigation: explicit `dev`, `demo`, and `test` all permit provisioning; only `prod` fails closed. This could give someone tunnelling the server false confidence. Fix: say direct tunnelling is unsupported; for a controlled experiment require `SNAPBACK_PROFILE=prod`, explain that functionality may consequently refuse, and clarify that profile selection alone does not approve public exposure. Correct the filed issue likewise.

2. `[IN-DELTA] [MATERIAL] [0169]` — **S3 and Acceptance 9–10.** Removing the build-mode gate fixes Vite, but the sink/record contract remains underspecified. The package currently has only the wire-specific `onWireVersionDiagnostic` and `wireVersionDiagnostics`; S3 names neither a new constructor option nor a record location, diagnostic type, or the relationship between realm-wide deduplication and per-client records. Acceptance item 10 therefore has no concrete public API to test. Fix: specify and type the sink option, diagnostic shape, record surface, exception behavior, and whether deduplication covers delivery only or recording as well.

3. `[PRE-EXISTING] [DETAIL] [0169]` — **S3 warning facts.** Trusted HTTPS or loopback is not by itself sufficient when the document has an insecure ancestor, and HTTPS cannot restore Web Locks in a browser that does not implement them. Fix: say “a top-level trusted HTTPS or standard loopback origin satisfies the secure-context requirement; Web Locks support is still required.” The ancestry qualification follows the [Secure Contexts model](https://w3c.github.io/webappsec-secure-contexts/).

4. `[PRE-EXISTING] [DETAIL] [0169]` — **Acceptance: browser carrier.** Requiring a non-loopback origin could encourage binding a development server to the LAN. Fix: prescribe a loopback-only test listener reached through a non-trustworthy test hostname mapped to loopback, or require an isolated interface and explicit teardown.

What is good: the receipt statements are now consistent with the retained JSON and source. The A/B gate is genuinely openable: A requires only evidence and paper design, while the fenced post-opening spike can produce B evidence. The LLP 0030 section now stays within Research authority by constraining a successor and requiring the owning LLP to be amended before acceptance, without changing current route policy. The cookie boundary correction is accurate. Ungated S3 reporting is correct for Vite and Metro web, while terminal placement after the React Native and Node arms preserves Metro native behavior; Vite’s documented build-mode surface is [`import.meta.env`](https://vite.dev/guide/env-and-mode), and Web Locks is explicitly `[SecureContext]` in the [Web Locks specification](https://w3c.github.io/web-locks/). No material coupling contradiction was found.

0168: NOT READY  
0169: NOT READY  
SET: NOT READY

---

## Round 3 (delta, final) — 2026-08-04

**Reviewed revisions:** 0168 `411c3288…`, 0169 `cc838a30…`
**Capsule sha256:** `60860245f8197b72…`

Process note: because this session authored the base text, LLP 0005 should not count this as independent-review provenance. The technical assessment below is nevertheless adversarial.

1. `[IN-DELTA] [MATERIAL] [0168]` — **How B-evidence may be produced / Reachability fence.** The fence permits any non-`dev` profile, but `demo` and `test` also permit provisioning. It therefore authorizes precisely the unsafe reachable configuration the preceding mitigation warns against. Require the resolved profile to be `Prod` before opening any off-loopback reachability, preferably with a runtime assertion. Positive tests that cannot operate under `Prod` must use an isolated harness with no off-host reachability and explicit credentials—not `demo` or `test`.

2. `[IN-DELTA] [MATERIAL] [0169]` — **S3 and Acceptance 9–10.** The opening normative sentence requires the diagnostic to be reported exactly once per realm through record/sink/warn, while the new contract requires records and sinks once per client. Acceptance item 9 likewise says two clients produce “exactly one report.” Those are incompatible observable cardinalities. Rewrite this as three separate rules: every matching client records once; every supplied per-client sink receives once; only the default `console.warn` is realm-deduplicated. State whether a sink-only client consumes the console-warning budget—preferably it does not—and test unsunk/unsunk, sunk/sunk, and sunk-then-unsunk clients explicitly.

3. `[IN-DELTA] [DETAIL] [0168]` — **Mitigation available today.** The advice is directionally safe, but “`prod` is the only value that fails closed” is literally false: every unknown non-empty value also resolves to `Prod`. Say “the only recognized profile.” Also replace “grants the destructive/provisioning capability to whoever reaches the public URL” with a precise statement that `Dev` permits the profile half of those operations; the cited resolver does not establish sufficient authority, and current `admin.rs` documents the independent `AdminWrite` gate.

4. `[IN-DELTA] [DETAIL] [0168]` — **Distribution fence.** “Not merged to the default branch (or merged … behind a flag)” is not the claimed no-merge fence. Remove the parenthetical, or explicitly describe this as a default-off merge policy and require deletion from the default branch when the spike expires.

What is good: the unsupported-tunnelling warning and exact `prod` recommendation are safe to follow despite the precision issues above. The RFC prerequisite, owner, duration, and delete-on-expiry rules materially improve the spike boundary. In 0169, the predicate follows the source ladder correctly, the listener constraint avoids teaching real LAN binds, and the new API shape, per-client record, sink suppression, and throwing-sink behavior are almost complete. The platform claims also hold: Web Locks is secure-context restricted, loopback/`localhost` are potentially trustworthy, and an insecure ancestor defeats an embedded trustworthy origin. [Web Locks specification](https://w3c.github.io/web-locks/#api), [Secure Contexts specification](https://w3c.github.io/webappsec-secure-contexts/#potentially-trustworthy-origin). I found no material coupling contradiction or regression outside the concerns above.

0168: NOT READY
0169: NOT READY
SET: NOT READY
