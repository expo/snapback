# LLP 0301 + 0302 (Spec cluster) reviews — grok family

## Cluster round 1 — 2026-08-24

- Targets: 0301(b) sha256 35006796426c5ff9933c11442f2d672e671c64ac39790cf94002367da57dc90c ; 0302(b) sha256 646d37728824322b1494897190b6c4023e2e722860e1a2d5d790438a008b4340 (landed 466807e3b)
- Lockstep cluster; capsule refine-specs/capsule-r1 (both specs + 0300 + 0299); hashes in run journal
- Received: complete response; verbatim body follows

The 0302 spec is truncated in the prompt. I’ll read the offloaded full request so the review covers both specs completely, without running any shell commands.The two Specs divide 0300 along the right seam (0301 owns the wire/CLI/lifecycle half; 0302 owns the client half), but several Spec-owned rulings are either internally inconsistent, unwired at the 0301↔0302 boundary, or silently at odds with a settled 0300 obligation. Those block READY.

## Findings

1. **MATERIAL — 0301 §1 + 0302 §3 — `startupNonce` is neither specified as a safe fact field nor delivered on a path that can implement 0302’s restart rule.**  
   0300 (OQ2 / migration step 2) binds the discovery fact to **identity + admission posture ONLY**. 0301 adds `startupNonce` as a fourth top-level field and justifies it with “already client-visible via the bootstrap exchange.” That justification is the **supervised** channel; the URL path has no bootstrap. 0302 then treats nonce change on **“any response/stream”** as an episode start, but 0301 never puts the nonce on ordinary responses — only on `GET /_snapback/api/app/identity`. A nonce observed on a later response is also **too late** for 0300 acceptance 4 (“no credentialed request was sent before the refusal”).  
   **Change:** Pick one and write it on both sides. Either (a) drop `startupNonce` from the fact and define episode starts as first use **and any transport failure/end before retry**, or (b) keep a process nonce, explicitly amend the fact as identity+posture+process-nonce (not a secret; not ports/tokens/leases), and specify a signal that fires **before** the next non-identity call (e.g. disconnect of a named standing transport, not “nonce on the credentialed response”). Delete the bootstrap sentence.

2. **MATERIAL — 0302 §3 (needs a 0301 §1 sentence) — the episode machine cannot be implemented the same way by two clients.**  
   Triggers are “first use, transport reconnect, or observed `startupNonce` change.” “Transport” is unnamed (fetch? websocket? SSE?). Nothing says a failed non-identity call **un-verifies the episode before any retry**. Headless/HTTP has no reconnect. Combined with (1), origin-reassignment (0300 row 4 / 0302 §8.2) is a wish, not a contract.  
   **Change:** Name the transport(s). State: any transport error, drop, or non-2xx on a non-identity call closes the verified episode; the next permitted call is the identity GET; retries of the failed call are forbidden until match. If Snapback clients always hold a standing stream, say so and make that stream’s drop the reconnect trigger. If headless is request/response only, require a pre-call identity probe on that consumer — do not leave it implicit.

3. **MATERIAL — 0301 §1 — identity GET is cacheable by default, which defeats mix-up detection.**  
   Unauthenticated GET with no `Cache-Control` can be served from a browser (or proxy) cache after kill-and-replace on the same origin. The gate then “matches” the **old** deployment and sends signup/credentials to the **new** process.  
   **Change:** 0301: `Cache-Control: no-store` (and do not ETag-match across process lifetimes). 0302: identity fetch is cache-busted / `cache: 'no-store'`. Add this to 0302 §8.2.

4. **MATERIAL — 0302 §1 + §5 + §8.1 — generated-kind gating as written either breaks release builds or leaves 0300 acceptance 5 open.**  
   Release generation **omits** `generated/declared-dev.mjs`. §5 then requires **application-owned** source (the same `App` that production builds) to import that module and pass the capability with `url`. Consequences: Metro/Vite/Node resolve-fail the production artifact (release admission is **not** “behaviorally unchanged”), or authors wrap the import in `NODE_ENV`/mode branches (the mechanism 0300 P1 forbade as the authorization boundary). Separately, behavior when `url` is set and the capability is **absent** — the actual acceptance-5 case — is unspecified. `admitAppBindingV1` still grows a `declared-dev` arm; `provenance.generation` is the app’s own public identity, so a forged candidate is not structurally prevented by omitting a file.  
   **Change:** Application source never imports an omitted file. Wire `declared-dev` **inside** the always-emitted generated module that already differs by dev-vs-release generation mode (release module does not export/construct that source). Templates pass **only** `url`. Specify provider rules: capability absent → do not construct `declared-dev`, ignore `url` for that source, run existing release/hosted/supervised admission. `admitAppBindingV1` refuses `source: 'declared-dev'` unless the candidate carries a module-private brand the generated dev module mints (generation identity alone is not a brand). Acceptance 5 must run a **successful** production build with `url` set.

5. **MATERIAL — 0302 §4 vs §7 vs §8.4 — rendezvous precedence is three different rules, one of which contradicts 0300 P1.**  
   0300 P1: when the supervised rendezvous is **present**, it **wins** over the declared URL (stale URL → connect refusal, not a hang). 0302 §4: present = supervisor origin **that completes its exchange**; then `declared-dev` is **not consulted**; also “no fallback from a failing rendezvous to a URL.” §7/`SOURCE_CONFLICT`: both live and disagreeing origins → **refuse**, not win. §8.4 asserts both “supervised selected even with `url` set” and “conflict diagnostic when both live with different origins.” Completing-exchange vs installed-but-dead vs both-live-and-disagree will be implemented three ways. Conflict-on-disagree is a silent override of settled “wins.”  
   **Change:** One table, both docs. Recommended (faithful to 0300): rendezvous **completes** → supervised binding, `url` ignored (diagnostic names supervised and that `url` was ignored), never `SOURCE_CONFLICT`. Rendezvous **configured but exchange fails** → do not fall through to `url` in the same boot (typed supervised failure). Rendezvous **absent** → `declared-dev` if `url` is set. Drop `SOURCE_CONFLICT` or confine it to a case 0300 actually left open — do not refuse a completed rendezvous because `url` also exists.

6. **MATERIAL — 0301 §2 — `SNAPBACK_DEV_ADMISSION_POSTURE` trust boundary is implied, not specified.**  
   The server treats an env var as the privilege bit that opens loopback CORS. “Set only by `runDev`, never documented for hand use” is not a boundary: leftover/hand-set `loopback-any` opens P2’s accepted signup exposure; leftover `explicit-list` with an empty list closes the canonical path. Unrecognized → `explicit-list` is fail-closed for **typos**, not for a valid forged value. Split-brain with the accompanying origin list is undefined (`loopback-any` + a non-empty `SNAPBACK_DEV_AUTH_ORIGINS`, etc.).  
   **Change:** State: `runDev` **constructs** the child env and **always overwrites** this var (never pass-through). `loopback-any` iff this spawn has no explicit origin declarations; otherwise `explicit-list` + the union allowlist. Server may trust the var because it is spawn-owned, not because it is secret. Hand-setting is unsupported and equivalent to replacing `runDev`. Define the four (posture × list) pairs.

7. **MATERIAL — 0301 §3 — reader rule is only half of P2.**  
   Missing `admissionPosture` → `explicit-list` is the new-reader/old-receipt cell. The new-receipt/plain cell is `admissionPosture: "loopback-any"` with **empty** `clientOrigins`. Nothing says a new reader must **not** treat empty `clientOrigins` as “admit nobody.” An old CLI that keys off `clientOrigins` and ignores unknown fields is the dangerous old-CLI/new-plain-receipt cell; “tolerate unknown fields” does not imply attach succeeds.  
   **Change:** Tabulate all four CLI×receipt cells with expected attach outcome. Explicit reader rule: `loopback-any` means any literal-loopback Origin; `clientOrigins` is then declarations-only (may be empty), never the allowlist.

8. **MATERIAL — 0301 §1 + 0302 headless — Origin-less identity GET is unspecified.**  
   CORS “follows the same admission as the rest of the dev surface.” Headless Node (0300 row 7) often sends **no** `Origin`. If `dev_body_origin_refused` refuses Origin-less under `loopback-any`, the gate can never match. If it allows Origin-less, that must be stated so the server and client halves agree (and so loopback-any does not accidentally become credential-less CSRF from non-browser callers beyond what 0300 accepted for **browser** origins).  
   **Change:** 0301: Origin-less requests on the dev surface are admitted or refused by a named existing rule; identity GET uses that same rule. 0302: headless identity GET’s headers (Origin present or not). Put one Origin-less case in 0301 §8.2 and 0302 §8.5.

9. **MINOR — 0301 §2 — named seam may not match the matcher you specified.**  
   `canonical_loopback_http_origin` is appointed as the **single** matcher while the rule admits scheme `http` **and** `https`. The seam’s name is HTTP-only.  
   **Change:** Confirm that function already accepts `https` and any port with no DNS, or name the function you will actually extend; do not pretend a new https rule is already the old helper.

10. **MINOR — 0301 §1 vs 0302 §3 — wire contract is not fully shared vocabulary.**  
    Path, GET, and unauthenticated match. 0302 never requires `formatVersion === "snapback.app-identity.v1"`, never reads `admissionPosture` (despite the summary claiming it consumes it), and folds prod’s `SNAPBACK_APP_IDENTITY_UNAVAILABLE` into “typed refusal.”  
    **Change:** 0302 malformed-fact = wrong/missing `formatVersion`, missing/invalid `deployment` or `admissionPosture`, missing `startupNonce` if finding 1 keeps it. Prod 404 + that code is an ordinary connect refusal by **code name**. If the client does not use `admissionPosture`, say “echoed, ignored.”

11. **MINOR — 0301 §4 + 0302 §8.5 — Android emulator vs writer.**  
    Writer refreshes `EXPO_PUBLIC_SNAPBACK_URL` to the backend origin (`127.0.0.1`). 0302’s Expo Android case is `10.0.2.2` as “one env var.” Templates turn the writer on. 0300 P3 already says Android is the printed variant **manually** or supervised — the batteries must not pretend `.env.local` is that var.  
    **Change:** 0301 start packets: Android emulator pastes `androidEmulatorUrl`, not the writer block. 0302 §8.5: same. Optionally write a commented Android line inside the marker block; do not silently overwrite a `10.0.2.2` value with `127.0.0.1` without saying so.

12. **MINOR — 0301 §4 — printed URL vs “backend origin” written.**  
    Print is always `http://127.0.0.1:<port>`; writer is “the backend origin.”  
    **Change:** Writer bytes equal the printed `SNAPBACK_URL` (same scheme/host/port). Specify marker-comment strings.

13. **MINOR — 0301 §5 — plain-profile mint seam is assumed.**  
    `snapback auth dev-session` “uses the existing supervised-mint machinery (ready-file descriptor + managed admin token)” against a **plain** backend. If plain ready files do not already carry that token, this is either a new on-disk credential (against 0300’s “no token or session material is written to disk by anything this RFC adds”) or a command that cannot work.  
    **Change:** Name the descriptor plain `runDev` already writes. If none, do not add an admin token to disk; specify the mint authenticates some other existing lifecycle secret. Keep stdout-only.

14. **MINOR — set — 0300 P5 / migration step 4 documentary amendments are unowned.**  
    Dated 0299 notes (canonical-path banner, §5 merge scoped to supervised, §7 receipt split, §2 bearer restatement) and 0181/0223 amendment notes are in neither Spec. 0301 implements the behavioral path-split but disclaims guide beyond named texts.  
    **Change:** 0301 out-of-scope becomes an explicit work item list, or add a short “Documentary amendments” section that owns those notes. Not runtime-blocking if called out.

15. **MINOR — set — joint batteries miss 0300 row 3’s port-forward cell and row 9’s non-theft cell.**  
    0301 §8.2 covers rebinding + tunnel-only replace; 0302 §8.5 covers two principals; 0301 §8.6 covers second-origin **signup**. Neither requires “SSH/devcontainer port-forward works unchanged” nor “cannot obtain another principal’s bearer / cannot exceed new-principal authority.”  
    **Change:** 0301 §8.2: one forwarded-loopback URL case. 0301 §8.6: cross-origin cannot read the first origin’s bearer (existing custody; one assertion).

16. **MINOR — 0301 §6 — `--client` / `--client-command` preservation (0300 P3) is unowned.**  
    **Change:** One sentence in 0301 §6 or §9: remains a non-allocating child launcher, not the template shape.

17. **MINOR — 0302 §6 / 0301 §9 — signed discovery is a recorded **Spec-phase** obligation, deferred by both to an implementation ticket.**  
    Acceptable only as a named punt.  
    **Change:** Keep the issue filename and constraint; add “not required for these Specs to go READY” so it is not an orphan that looks like a silent drop.

18. **NIT — 0301 §4 — `--json` field names mix `SNAPBACK_URL` and `androidEmulatorUrl`.** Pick one convention.

19. **NIT — 0301 §2 — state Host `10.0.2.2` is emulator NAT to a loopback listener and is **not** an Origin-allowlist entry, so implementers do not “align” 0301’s host list to 0302’s URL host list.

20. **NIT — 0301 §7 / 0302 §7 — new codes are not classified against the s5_d10 table 0301 itself requires.**

## Dimensions

- **Faithfulness:** MATERIAL findings 1, 4, 5 (and 14/17 as MINOR orphans). 0301 otherwise maps P2–P4, path-split, writer, dev-session, and template flip. 0302 otherwise maps declared-dev hosts, standing gate intent, library-reads-no-env, and per-bundler one-liners.
- **Implementability:** MATERIAL findings 2, 3, 4, 6, 7, 8. Named seams (`dev_body_origin_refused`, `expoBackendDevAuthEnvironment`, `admitAppBindingV1`, codegen modes, ready-file mint) are the right ones; several contracts those seams must keep are missing.
- **Cross-spec consistency:** MATERIAL findings 1–3, 5, 8, 10. Shared path string and identity-mismatch code match; nonce delivery, Origin-less, and rendezvous outcome do not. Joint batteries cover 0300 rows 1–2 and 4–8 in outline; row 3 port-forward and row 9 theft are gaps (15).
- **Safety:** MATERIAL findings 3, 4, 6. Writer keys and `dev-session` stdout-only honor no-credential-on-disk **as far as specified** (13 is the residual). `startupNonce` is not a credential but **is** more than identity+posture and is not justified. Generated-kind **does not** currently close the release path on Expo, Vite, and headless together.

## Verdicts

0301: NOT READY  
0302: NOT READY  
SET: NOT READY

## Cluster round 2 (delta) — 2026-08-24

- Targets: 0301(c)+0302(c) at bda23afc7; capsule + hashes in run journal
- Received: complete response; verbatim body follows

The prompt was truncated; I’ll read the offloaded full request so the review covers both specs and diffs, then classify findings without any other tools.The prompt file continues past the 0302 diff; I’ll read the remaining governing RFC text next.The delta’s thirteen resolutions are mostly sound and implementable. One mixed-version attach cell is still internally contradictory; that is the only MATERIAL. Everything else is either clean or a non-blocking clarification the implementation phase can carry.

---

**1. MATERIAL / IN-DELTA / LLP 0301 §3 (attach contract, old-CLI × new-plain cell)**

The four mixed-version outcomes are specified, but the refuse mechanism for **old-CLI / new-plain (`loopback-any`)** cannot be the mechanism the paragraph names.

- **old-CLI / new-supervised** succeeds because the field is additive and the verifier’s unknown-field posture ignores it; attach is the **old** origin-list comparison.
- **old-CLI / new-plain** is required to **refuse**, yet the text says “the unknown-field tolerance applies to parsing, and **the recorded-contract comparison above** is what refuses.” “Above” is the **new** posture+declarations comparison. An already-shipped old CLI does not run that comparison.
- The same unknown-field ignore that lets old-CLI / new-supervised succeed will also ignore `admissionPosture: "loopback-any"`. After that, the old CLI only sees `clientOrigins: []`. If its requested list is also empty, the old comparison **matches** and attach **succeeds** — the opposite of the cell.

The distinguishing old-CLI-visible signal cannot be “a posture it does not know”; that field is unknown in **both** new-receipt cells.

**Concrete change:** Derive this cell only from behavior the old CLI already has. Pin requested-vs-recorded **origin lists** (e.g. old CLI requests a non-empty explicit/default list; new-plain writes `clientOrigins: []` → mismatch → refuse). Delete the claim that the new posture-aware comparison runs on the old CLI. If a true old CLI would accept `clientOrigins: []`, **change the cell** (success with degraded allowlist semantics, or a breaking receipt signal old validation actually rejects). Do not freeze a SHALL that only the new CLI could implement.

---

**2. MINOR / IN-DELTA / LLP 0302 §4 + §1 (source-selection axes)**

The three-row table is a correct literal of rendezvous-vs-`url`. It does not mention the release / capability-absent axis. Read alone, row 3 (“absent rendezvous + `url` → `declared-dev`”) contradicts §1 (release variant must not select `declared-dev`).

**Concrete change:** One preamble sentence: §4 applies only when the generated variant provides the capability; §1 capability-absent takes precedence and `url` is not a source selector. Do not add `SOURCE_CONFLICT` back.

---

**3. MINOR / IN-DELTA / LLP 0302 §1 (release variant export surface)**

“Always the same module path” + “application source imports nothing that can be absent” + “does not export or construct that source at all” can be read as a missing named export (load/build throw). Acceptance 1 requires release builds with `url` set to **succeed**.

**Concrete change:** State that the release variant is import-stable at that path (stub / sentinel / no constructor) and that the generated app surface is replaced in the same atomic step as the variant, so importers never fail to resolve.

---

**4. MINOR / IN-DELTA / LLP 0302 §1 (brand check)**

A brand that is only an unexported closure in the generated module is not observable by library `admitAppBindingV1`. The intended property is unforgeability from public API.

**Concrete change:** Call it a library-internal stamp (Symbol / WeakMap) applied only by a mint the generated module calls; `admitAppBindingV1` checks that stamp; public `DeploymentIdentity` is checked separately and is not the stamp. Keep “no public constructor from raw application data.”

---

**5. MINOR / IN-DELTA / LLP 0301 §3 (new-CLI / old-receipt attach)**

The fourth cell states the **reader** rule (`explicit-list`) but not the **attach** success/fail that composition implies: new CLI with no declarations requests `loopback-any`; recorded legacy is `explicit-list` → mismatch → refuse (restart). New CLI with matching explicit declarations succeeds.

**Concrete change:** Add those two attach outcomes so the four cells are all attach outcomes, not a mix of attach and parse.

---

**6. MINOR / IN-DELTA / LLP 0302 §4 (“configured” / “absent”)**

Revision (b) named the signals (`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` / injected global). (c) replaced that with “configured” / “absent.”

**Concrete change:** Restore those existing signals so the three rows are executable without tribal knowledge. Keep the three outcomes.

---

**7. SUGGESTION / IN-DELTA / LLP 0302 §3 (episode start (c))**

“Any … non-2xx on a non-identity call” un-verifies on application 4xx (400/401/429), not only transport/process replacement. Fail-closed and implementable; noisier than mix-up detection needs.

**Concrete change (optional):** Limit (c) to transport failure, stream drop, and 5xx, or explicitly accept 4xx as un-verify. Do not reopen the stated idle-swap residual.

---

**8. SUGGESTION / IN-DELTA / LLP 0301 §4 (writer insert vs refuse)**

“Exactly one well-formed block required” plus refuse-rather-than-guess can be misread as refusing a first write (zero blocks).

**Concrete change:** Missing file or zero snapback blocks → insert; refuse is for duplicate/malformed blocks, managed keys outside the block, and a manually uncommented Android line.

---

**9. SUGGESTION / IN-DELTA / LLP 0301 §2 vs §2b**

§2 still says hostname **exactly** `localhost` / `127.0.0.1` / `[::1]`. §2b admits `127.1` via WHATWG parse. Acceptance 2 already requires the shared vectors, so this will not survive tests, but §2 should say “after §2b canonicalization.”

---

**10. SUGGESTION / IN-DELTA / LLP 0301 §4 (dropped `--expo` URL print)**

(b) printed the backend origin line on both profiles. (c) prints only for plain-profile ready/attach/rebind. Supervised does not need `SNAPBACK_URL`; confirm the drop is intentional.

---

**11. SUGGESTION / IN-DELTA / LLP 0301 §4 / attach diagnostics**

Writer and attach-mismatch refusals are “typed diagnostics” with no code tokens. Identity/posture/dev-session codes are named.

**Concrete change:** Name them or explicitly reuse an existing CLI code, in the same s5_d10 landing as §7.

---

## Clean dimensions (no MATERIAL findings)

| Delta | Verdict |
| --- | --- |
| (1) `startupNonce` removed; identity+posture only; `no-store` / no validators; client cache-bypass + redirect refusal | Sound. Mix-up detection is transport + cache-bust, not a nonce. |
| (2) Episode machine on the standing live-query stream; signup/login forbidden pre-match; idle-swap residual stated and accepted | Sound and implementable. Residual matches the single-user-host argument. |
| (3) Always-emitted module; brand; capability-absent; atomic dirty transition | Direction is correct and matches LLP 0300 row 5. Minors 2–4 only. |
| (4) Three-row rendezvous-wins table; `SOURCE_CONFLICT` dropped | Sound. Completing rendezvous must not refuse because `url` exists. Minor 2/6 only. |
| (5) Writer matrix, `loopback-any` reader rule (`clientOrigins` never the allowlist), attach mismatch, reader-before-writer | Matrix, reader rule, and **new-CLI** attach comparison are sound. MATERIAL is only the old-CLI / new-plain **mechanism**. |
| (6) `SNAPBACK_DEV_ADMISSION_POSTURE` spawn-owned; `runDev` always overwrites; invalid pairs refuse startup | Sound. Replaces silent fail-closed-to-`explicit-list`. |
| (7) `dev-session` target, existing managed admin token, no new disk credential, stdout schemas, disk-sweep | Sound. |
| (8) `DeploymentIdentity` = existing readiness serialization; field-wise equality after JSON parse; unknown version malformed | Sound at spec altitude (existing type is the schema). |
| (9) One WHATWG algorithm + shared vectors; `127.1` in; `localhost.` out; Origin-less admitted under both postures | Sound. Conformance set is the pin across Rust/JS. |
| (10) Single marker block, atomic replace, outside-duplicate refuse, commented Android line, byte-equality, camelCase JSON | Sound. Suggestions 8/10/11 only. |
| (11) Nine-row traceability, including forwarded-loopback, release success, row 8 data preservation, row 9 custody | Sound. Every LLP 0300 row names an executable battery. |
| (12) Documentary deliverables own guide / 0181 / 0223 / start packets / `--client` | Sound. `--client` is not the template shape. |
| (13) Signed discovery designed in 0301 §9; excluded from this implementation set; 0302 §6 names the punt | Sound. Additive `identitySignature` later will not break this set’s malformed-fact list. |

LLP 0300 decisions are treated as settled (path split, rendezvous-wins, release-must-succeed-with-`url`, no new disk credential, signed discovery not in this set).

---

0301: NOT READY
0302: READY
SET: NOT READY
