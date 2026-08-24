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
