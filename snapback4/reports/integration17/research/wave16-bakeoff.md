# Bakeoff wave 16 — Snapback 4 (0.4.31) vs hosted Convex: analysis

2026-10-18. 50 paired ideas, 100 lanes. Each pair used the same model (20 Muse, 30 Codex; no model mismatches) and the same frontend (23 React, 27 Expo).

- **Inputs:** `apps/*`, `runner.out`/`runner.log`, the harness in `~/sb4-loop/bakeoff/`, and `aggregate-bakeoff.mjs 16`.
- **Reproductions:**
  - Copies are under `~/sb4-loop/wave16-repro/` (`sb/` for Snapback, `cx/` for Convex, `q5/` for the red lanes).
  - Every Snapback finding was re-run on ports 26800–26849, with `probe:serve` restarted from a copy.
  - Convex repros were re-run against the still-live hosted deployments, through each lane's own scripts.
  - No lane directory was modified.
  - No Convex project was created or deleted.
  - No credentials are quoted.
- **Data left on the wave-17 Convex deployments.** The re-runs pushed no code, but they did leave data behind:
  - each repro recreated its own test rows, including text or non-image `_storage` uploads (011, 024, 028, 030, 036, 042, 048) and one more sailing and booking in 001;
  - the live check for role-on-signup created 13 `qa-selfrole-*@example.com` / `qa-chief@example.com` accounts, nine of them with **privileged roles**, in 004, 015, 019, 020, 027, 030, 042, 045 and 048. The lanes have no public path to remove them.

  Wave 17 reuses these projects, so its operator should clear or account for them. The 048 `storage id … not found` round from the original probe expires on its own after about 20:00 UTC (§5).

---

## 0. Bottom line

**The one metric Convex "won" is a harness artifact.**
- **All 32 `probe:serve` deaths** (21 Snapback, 11 Convex) were caused by Muse builder agents in *other* lanes. They stopped "their own" probe server with name-based kills (`pkill -f "probe-serve[.]mjs"`, `pgrep -f probe-serve`, a `/proc` cmdline scan). Those kills hit every lane whose probe server was named `scripts/probe-serve.mjs` and that was being probed at that moment.
- **Why Snapback lost more:** Snapback lanes finish faster (median 14 vs 15 min; 29–13 pairs). So more of them were already in their probe window while the slower Muse Convex lanes were still self-testing, and killing.
- **The other headline artifact:** "source edited during probe" (22 vs 4) is also an artifact. The probe reviewer ran `npm install <client>` in `probe/` before creating a `package.json` there. npm then walked up and rewrote the lane's root `package.json`: `snapback4 "0.4.31"` became `"^0.4.31"`. Snapback lanes were pinned with `--save-exact`; Convex lanes mostly already had `^`, so for them nothing changed.

**With the kills removed:**
- Every Snapback lane printed a valid multi-user `probe:serve`.
- On the lenient reading, all four proofs are green for Snapback 50/50 vs Convex 48/50.
- **On the strict reading, Convex still wins** (10 pairs vs 2, p≈0.04), but for a reason that *is* Snapback's. 10 of 20 Muse Snapback lanes ran `probe:serve` on `snapback4 dev`, which the brief forbids. `dev` keeps unauthenticated `/seed`, `/dev/clock` and `/dev/reset` endpoints and persona headers open on loopback. They did it because provisioning roles for real password users under `serve` has no single documented recipe.
- That gap is also the most-voted "fix first" item in the Snapback REPORTs (20 of 50).

**On security:**
- Raw findings after re-running: Snapback ≈10 high / 23 medium / 2 low, 34 of 35 reproduced, in 17 lanes. Convex 22 high / 30 medium / 11 low (§3). The harness's "confirmed" numbers undercount both sides, because repros were re-run only if the original server survived.
- **Every Snapback high is the builder's mis-encoding or omission inside a correctly enforced rule language.** None is a platform bypass. The platform-attributable Snapback findings are all medium or low (whitespace-only text passes `text 2..80`; an existence oracle).
- **Convex's highs include whole classes Snapback structurally cannot have:**
  - public storage URLs for private files;
  - self-assigned roles at signup;
  - signed-out privileged writes through hand-rolled auth;
  - un-owned storage IDs and unchecked upload types;
  - `Date.now()` inside cached live queries.
- `snapback4 check` was silent on every Snapback high. The dominant pattern, *a grant row outlives a role change*, is detectable statically.

Snapback is faster (pairs 29–13), has less friction (34–15), less backend code (42–8) and better ratings (9–2, p≈0.07).

---

## 1. Why 21 Snapback lanes "failed" `probe:serve`

**Metric definition** (`aggregate-bakeoff.mjs:46`). It is green only if `serve.ready && serve.aliveAtEnd !== false`, and at least 2 users per role are listed.
- 49 of 50 Snapback lanes printed a valid line with at least 2 users for every role.
- The 21 failures are 20 lanes with `aliveAtEnd:false` plus one, 042, whose server was killed before it printed (`exited (null)`, i.e. by a signal).

**How each death was established.**
1. For every failing lane, I found the backend log written during the probe window. Each contains `SNAPBACK4_SIGNAL verb=… reason=SIGTERM`.
2. I converted each to an absolute time, as probe start plus file mtime.
3. I matched those times to commands in the builders' Muse logs (`.agent.ndjson`; the time is the UUIDv7 `task_id`).

| kill time (UTC) | killer lane (all Muse) | command | Snapback lanes killed | Convex lanes killed |
|---|---|---|---|---|
| 16:39:06 | 024-convex | `pkill -f "probe-serve[.]mjs"` | 003, 005, 009, 010, 018, 023 | — |
| 16:41:41 | 011-convex | `pkill -f "probe-serve[.]mjs"` | 024 (009/010 already dead) | 010, 023 |
| 16:58:44–48 | 030-convex, 026-convex | `pkill -f "probe-serve.mj[s]"`; `pkill -f "probe-serve.mjs"` | 006, 011, 014, 015, 027, 036 | 002, 020 |
| 17:01:37 | 026-convex | `node -e` loop over `/proc/*/cmdline`, SIGTERM to every `scripts/probe-serve.mjs` ("stopping own probe pid" ×7+) | 013, 034, 035, 038 | (002) |
| 17:10:31–36 | 044-snapback | `pkill -f "scripts/probe-serve.mjs"`; `pkill -f "probe-serve[.]mjs"` | 040, 041 | 030, 034, 036, 040, 041 |
| 17:13:04 | 044-convex | `kill $(pgrep -f "probe-se""rve")` | 042 (before printing), 044 (its own twin) | 027, 042 |

**The correlation is exact.**
- 32 of 32 dead serves had a matching kill inside their probe window, against their script name.
- Not one lane survived a matching kill. The one exception is 032-snapback, whose probe ended at 16:58:45.8, the same second as the 16:58:44 kill.
- Lanes whose script was `scripts/probe.mjs` survived up to 7 kill events each (001-convex, 022-convex, 022-snapback).
- **Script names by side:**
  - Snapback: 35 of 50 used `probe-serve.mjs` (20 Muse, 15 Codex).
  - Convex: 24 of 50 used it (19 Muse, 5 Codex). The other 25 Codex-Convex lanes picked `probe.mjs`.
- **Reproduce:** `node ~/sb4-loop/wave16-repro/probe-kills/overlap.mjs` (the correlation), `killers2.mjs` (the kill timeline) and `verb.mjs` (dev vs serve under `probe:serve`).

**Classification of the 21.**

| class | lanes | count |
|---|---|---:|
| Harness/brief issue: cross-lane name-based kill while the lane was being probed | 003, 005, 006, 009, 010, 011, 013, 014, 015, 018, 023, 024, 027, 034, 035, 036, 038, 040, 041, 042, 044 | **21** |
| Snapback product friction that kept serve down or short of users | — | **0** |
| Agent omission that kept serve down or short of users | — | **0** |

**What else the deaths broke.**
- **Confirmation.** The probe re-runs repros only if the server is still alive (`probe.mjs:135`). So 12 Snapback and 28 Convex findings were never "confirmed"; 046 F1 and 001-convex F2 additionally outran the 3-minute re-run. All of them reproduce now (§3).
- **Coverage.** Probe agents in killed lanes stopped early. The Snapback median was 4.4 min in killed lanes, against 6.4 in surviving ones. Live-update checks in 003, 005, 009, 010, 027, 035, 036, 038, 040, 041 and 044 went unrun ("ECONNREFUSED").
- **The builders themselves.** 019-snapback: "Same-named probe scripts from many builders; PID must be verified by cwd". 041-snapback: "Background probe-serve died silently once its launcher script exited" (12 min). 048-snapback: "detached probe tree got external SIGTERM" (15 min). 034-convex's own self-check failed at 17:01:49, just after the 17:01:37 scan. Snapback logged about 90 min of "my probe server died" friction across 10 lanes.

**The real Snapback finding inside Q1: dev mode under `probe:serve`.**
- 10 lanes ran `probe:serve` on `snapback4 dev`, via `startDev` from `snapback4/proof` (backend log `SNAPBACK4_READY verb=dev`; `/auth/config` reports `development:true`): 002, 011, 019, 021, 027, 034, 040, 041, 044, 045. All are Muse lanes; that is half of Muse's Snapback lanes. No Codex lane did it.
- `dev` keeps these open, unauthenticated, on loopback (CLIENT-AND-OPERATIONS.md:3411):
  - `/seed` (system-principal upsert of any row);
  - `/dev/reset`, `/dev/clock/advance` and `/dev/jobs/*`;
  - `x-snapback-persona`. Even in password-only apps it accepts *undeclared* persona names (friction 001, 050; `crates/snapback4/src/serve_identity.rs:19-40`).
- On copies of 019 and 045, `GET /dev/status`, `POST /dev/clock/advance` and persona impersonation all worked with no credentials.
- The probes kept to the supplied credentials, so no finding depended on dev mode. But the brief's rule ("must not rely on" a mode with "seeding or admin endpoints open to anyone") was broken, and the harness never checked.
- **Why they did it:** to provision roles. Under `serve`, the only path is an `insert <- viewer = 'service:ops'` table plus `snapback4 token --service ops --release <dir>`. That path is documented only in SERVER.md:209-221 (an operator-token paragraph aimed at provider adoption) and across `guide services`. 045: "setup (role seeding) uses the dev seed door". Codex lanes found the service-token path; Muse lanes reached for `startDev` and `/seed`, or a "first caller claims head" bootstrap mutation (027 `bootstrapProducer`, 040 `bootstrapHead`).
- **Related trap:** `startDev()` silently adds `--memory` (`packages/snapback4/src/proof.ts:56`), so `snapback4 token --service` cannot mint against it (friction cluster "service token vs memory dev host", 12 lanes; #1 for 7 REPORTs: 019, 022, 031, 035, 037, 046, 049).

**What a real builder wants for staging** (this closes the remaining gap with Convex). Convex has no dev mode that relaxes auth: its hosted dev deployment *is* the production shape.

1. **`snapback4 serve --seed-users <file|role=n,…>` for test releases.** It creates N password accounts per role on a deployment flagged `test`, writes roles through a declared provisioning mutation as `service:operator`, and prints `{role:[{email,password,token,principal}]}` with chosen lifetimes on a private fd or file. It refuses on a release not flagged `test`. This is the `probe:serve` contract as a product feature.
2. **A documented, CI-tested recipe, "Staging with real users"**, in `CLIENT-AND-OPERATIONS.md` next to `#### Seed accounts headlessly (Node)` (line 2481). It should cover:
   - `deploy` → `serve` → `token --service operator --release` → `signup`/`login` per user → operator `provision` mutation → a long-lived session JSON;
   - a `startServe`-based `scripts/staging.mjs` template.

   Today the pieces are spread across SERVER.md:209, CLIENT-AND-OPERATIONS.md:2481-2511 and `guide services`.
3. **`snapback4/proof`:**
   - `startServe()` should return `{url, operatorToken()}`;
   - add a `seedAccounts(url, {roles, provision: api.op})` helper;
   - `startDev()` should stop silently forcing `--memory`, or `token --service` should work against a memory dev host (`proof.ts:56`).
4. **Close the dev doors when the schema says `use identity password` and declares no personas.** Persona headers should refuse an undeclared name (`serve_identity.rs:19-40`). Have `check` print a note that `dev` exposes `/seed` and `/dev/*` and must not face users.
5. **A first-admin and role-provisioning recipe** in `guide rules` (`crates/snapback4-lang/src/guide/rule_recipes.md`, next to "Enrolment into hidden things", line 741): invite codes, operator grants, and *no* open "claim the head role" mutation. This is the most-voted "fix first" ask: 13 + 7 REPORT votes. It also prevents 021 F1 (§3).

---

## 2. "Source edited during probe" is a measurement artifact

The tamper check (`lib.mjs:43` `sourceDigest`) hashes code files plus `package.json`. It skips `generated/` and `_generated/` (`lib.mjs:8`), so `serve` or `dev` regenerating `snapback/generated/*` or `api.ts` is **not** counted.
- `snapback/generated/residency.json` *was* rewritten during the probe in 014 and 028, with byte-identical content.

**Which files changed:**

| side | lanes | file | change |
|---|---|---|---|
| Snapback | 21 | `package.json` | `snapback4: "0.4.31"` → `"^0.4.31"` (e.g. 009, 025); 002 gained `undici: "^8.11.2"` |
| Snapback | 1 (023) | `.runs/probe-…/releases/1/snapback/schema.q` | the lane's own `probe:serve` deploys a release into `.runs/` inside the lane; runtime output, not source |
| Convex | 4 (009, 013, 038, 040) | `package.json` | `convex: "^1.47.0"` → `"1.47.0"` (reviewer used `--save-exact`); 013 `"^1.23.0"` → `"1.47.0"` |

**023, the one lane that is not a `package.json` change, is checked.** Its own `probe:serve` (`scripts/support.mjs:32`) deploys a release into `.runs/probe-<runId>/`, and the new `releases/1/snapback/schema.q` is byte-identical to the lane's `snapback/schema.q`. It is runtime output, not an edit. **All 26 flagged lanes are therefore artifacts:** 25 are `package.json` spec rewrites and 1 is a runtime directory. The coordinator notes `probe.mjs` is already fixed for future waves.

**Mechanism.**
- The reviewer's first command was `npm install [--save-exact] snapback4@0.4.31` (or `convex`) in `probe/`, before any `probe/package.json` existed. npm's prefix walks up to the nearest ancestor `package.json`, which is the lane root. So it rewrote the lane's `package.json` and `package-lock.json` and installed into the lane's `node_modules`.
- Every tampered lane's `probe/.agent.ndjson` shows an `npm install` run from `probe/` before `probe/package.json` existed. The reviewer usually noticed and retried with `--prefix probe`.
- **The asymmetry** comes from the brief's `--save-exact` pin, which applies only to Snapback (`backends/snapback.md`). A plain install writes `^`. Convex lanes already had `^` unless the reviewer itself used `--save-exact`.
- No reviewer edited app source; the snapshot was read-only, and digests outside `package.json` are unchanged.

**Harness fixes:**
- Write `probe/package.json` (`{"private":true,"type":"module"}`) before the reviewer starts (`probe.mjs` after line 82), and say so in `brief-probe.md`.
- `chmod -R a-w` the lane itself for the duration of the probe.
- Report dependency-spec changes separately from source changes.
- Add `.runs`, `.deploy*` and `deployment` to the digest's skip list (`lib.mjs:8`).

---

## 3. Security

### 3.1 Method and corrected counts

**Every finding on both sides was re-run.**
- **Snapback:** each lane was copied to `wave16-repro/sb/`, `npm ci`'d, and its pre-probe `package.json` restored. Its own `probe:serve` was restarted on ports 26800–26839, and each repro was run against a fresh `serve.json`. Three copies needed path or port patches: 001, 021 and 041 hard-coded the original lane path; 001 also hard-coded its ports.
  - **34 of 35 reproduced.** 046 F1 waits a real 10-minute deadline, so it was inspected from source instead.
- **Convex:** the repros were re-run against the live hosted deployments with the original credentials, which were all still valid. No code was pushed.
  - **63 of 63 reproduced.** 001 F2 needs a natural 31-minute wait, so the harness's 3-minute re-run could never have confirmed it; it was run to completion here.

| | Snapback | Convex |
|---|---|---|
| harness "confirmed" h/m/l | 5 / 15 / 2 | 12 / 12 / 10 |
| reported h/m/l (all re-run and reproduced) | 10 / 23 / 2 | 22 / 30 / 11 |
| class a (rules mis-encoded) / b (never encoded) / c (platform defect or footgun) / d (false positive or judgment call) | 24 / 2 / 4 / 5 | 30 / 1 / 32 / 0 |
| highs that are real at that severity after triage | 6 (019 F1, 020 F1, 021 F1, 045 F1, 048 F2, 015 F2) | ≈20 of 22, plus the unreported role-on-signup holes below |
| lanes with a real high | 6 (015, 019, 020, 021, 045, 048) | 15 (002, 004, 013, 015, 019, 020, 024, 027, 028, 030, 036, 041, 042, 045, 048) |
| platform-attributable (c) highs | **0** | **13** |
| lanes with a real high, by model (Muse / Codex) | 6 / 0 | 14 / 1 (028) |

**Highs the probe missed on Convex.**
- In 9 more Muse Convex lanes (004, 015, 019, 020, 027, 030, 042, 045, 048), a fresh public signup or `registerProfile` call accepts a privileged `role`. This was confirmed live on each.
- That makes **12 of 20 Muse Convex lanes** where anyone can become a privileged role. The probe reported it in only three (013, 024, 041).
- Five of the nine had complete probes (004, 015, 019, 045, 048), so the miss is the probe's judgment, not truncation.
- Those lanes already have other highs, so the lane count is unchanged, but the per-finding total is undercounted.

**Paired, with the real-high lane as the outcome:**
- Convex-only: 10 pairs. Snapback-only: 1 pair (021). Both: 5.
- Two-sided sign test p ≈ 0.012, **Convex worse.**
- Within Codex pairs: Snapback 0 lanes with a high, Convex 1.

**Severity calibration** (both sides):
- Snapback: 015 F4/F5 need the privileged coordinator, so they are really medium; 006 F1 and 015 F1 are judgment calls (d).
- Convex: storage-URL highs need the URL in hand, so medium is fair; most "non-image accepted as photo" mediums are really low.

### 3.2 Snapback findings, high first

| lane | id | sev | class | root cause | Snapback change |
|---|---|---|---|---|---|
| 019 | F1 | H | a | Demoted inspector keeps `routes` rows; rules check route membership, never the current role. | S1: grant-outlives-role lint and recipe |
| 048 | F2 | H | a | Contractor changed to manager keeps `assignments` grants (reading and photo access). | S1 |
| 020 | F1 | H | a | `liftHold` lets the manager lift a hold; the spec says the liaison only. | none needed in the platform (spec mis-encoding); layer (a) would catch it |
| 021 | F1 | H | a | Any signed-in user's `createTournament` inserts them into `directors`, and `exists directors[viewer]` is global. | S3: extend N_VACUOUS_RULE; first-admin recipe |
| 045 | F1 | H | a | The `repairNotes` read rule names luthier (schema.q:71). The Convex twin has the identical finding, so the spec is ambiguous. | none |
| 015 | F2 | H | b | `placeWithFoster` moves care with no handoff record. The Convex twin has the same finding (015 F6). | none |
| 015 | F4 / F5 | H→M | a | `recordHandoff` lets the coordinator name a vet or non-applicant as a party, who then reads the pet. | S2: argument-into-grant-column lint |
| 006 | F1 | H→d | d | Crew read past trips' rosters; the spec doesn't forbid history. | — |
| 015 | F1 | H→d | d | A former foster reads the handoff they were party to. | — |
| 015 | F3 | M | a | `recordHandoff` accepts from = to. | S2 |
| 020 | F2 | M | a | Intake accepts any handle as owner; the owner rule then exposes the vehicle. | S2 |
| 040 | F1 | M | a | `r.setter = viewer` is trusted after demotion. | S1 |
| 048 | F3 / F4 | M | a | `shiftMembers` still grants reads and `logReading` after a role change. | S1 |
| 002, 011, 020 F3, 045 F2/F3 | — | M | a | Required photo declared `image ?` or `[image] <=4 ?`. | S4: required-evidence recipe and note |
| 003 | F1 / F2 | M | **c** | A whitespace-only signature or reason passes `text 2..80` / `text 5..500`. | S5: non-blank minimum (`validate.rs:131`) |
| 049 | F1 | M | **c** | Same, for a decision reason. | S5 |
| 020 F5, 043 F2 | — | M | a | Deadline enforced only by a sweep job; the mutations never compare `now`. | S6 |
| 046 | F1 | M→d | d | Escalation arrives within the 1-minute sweep; it is late by seconds. | S6 at most |
| 006 F2, 043 F1 | — | M | a | `read <- exists roles[viewer]` / `read <- allow` on tables with private fields. | S7: broad-read listing |
| 004 | F1 | M | a | `setCurrentShow` never clears the previous show (several current at once). | uniqueness invariant |
| 021 | F2 | M | a | `updateBrief` takes the tournament as an argument, so the caller picks the deadline. | — |
| 048 | F1 | M | a | `completeRound` checks `readingsCount > 0`, not every gauge. | — |
| 041 | F1 | M | b | No perishable concept at all. | — |
| 020 | F4 | M→d | d | A manager deciding a claim (the spec names the clerk) is a judgment call. | — |
| 001 | F1 | L | **c** | `bookings[id] ! else NOT_FOUND`, then `require … else FORBIDDEN`, reveals existence. | S8 |
| 004 | F2 | L→d | d | The mutation result returns the author's own row. | — |

`snapback4 check` gave no relevant note on 001, 015, 019, 021, 043, 045 or 048.

### 3.3 Convex findings: patterns and classification

All 63 findings are real; none is class d (015 F2 is borderline). In the path column, **D** is a direct function call, **L** a list or aggregate, **X** an existence side channel, **S** a storage URL or upload, **E** an error message, **Sub** a subscription or cached live query, and **R** a mutation return value.

| pattern | findings | class | path | example lanes |
|---|---:|---|---|---|
| `ctx.storage.getUrl` gives an unauthenticated URL for a private file | 7 (all H) | c | S | 004, 020, 028, 030, 041, 042, 048 |
| Storage IDs carry no owner: attach someone else's ID and get its URL | 3 (H) | c | S | 002 F3, 019 F1, 036 F1 |
| `v.id("_storage")` with no content-type check: non-images accepted as photos | 11 (M/L) | c | S | 003, 011, 024, 028, 030, 031, 033, 036, 042, 045, 048 |
| Privileged `role` taken from the caller at signup or `registerProfile` (3 reported, 9 more found) | 3 + 9 (H) | c | D | 013, 024, 041; plus 004, 015, 019, 020, 027, 030, 042, 045, 048 |
| `Date.now()` inside queries: cached live results never flip at the deadline | 6 (M) | c | Sub | 001 F2, 034, 040, 041, 042, 045 |
| Public `asOf` argument added "so tests can exercise time" (Convex has no test clock) | 2 (M) | c | D | 036 F2, 041 F5 |
| Load-then-authorize: error text or existence oracle | 10 (L) | a | E / X | 001, 018 ×2, 032, 039, 048, 050, … |
| Wrong projections or private fields in lists | ~8 (H/M) | a | D + L | 015 F1/F3, 045 F1, 048 F4 |
| State-machine, custody and time rules mis-encoded | ~10 (H/M) | a / b | D | 002 F1, 015 F4/F5/F6, 027 F1, 042 F1, … |
| Required photo declared `v.optional` | 2 | a | D | 002 F2, 041 F1 |
| Mutation return value leaks another user's ID | 1 (L) | a | R | 024 F2 |

**Hand-rolled auth.** Six Muse lanes rolled their own (011, 013, 015, 019, 024, 042); all except 011 also accept `role` at signup.

**Codex vs Muse on Convex.** Codex lanes chose `@convex-dev/auth`, internal-only role assignment and authenticated `storage.get` HTTP actions (18 of 30), and produced one high (028, `getUrl`). 12 of 20 Muse lanes used `getUrl`.

### 3.4 How the outcomes compare, and why

**On paper, Snapback's ~10 highs vs Convex's ~22 understates the difference.** The difference is in *kind*.

**Convex.**
- About half of its findings (32 of 63), and 13 of its highs, come from paths where Convex hands the author a primitive that is open by default:
  - public `getUrl` URLs;
  - un-owned storage IDs;
  - unchecked upload types;
  - public mutations that take `role`;
  - `Date.now()` in cached queries.
- Every public `query` and `mutation` is its own access-control surface, written in imperative TypeScript.
- The author has to remember, in every function, an ownership check on every storage ID, a content-type check, never taking a role from the caller, and never reading the clock in a query.
- The weaker model forgot most of these (Muse: 14 of 20 lanes with a high).

**Snapback.**
- The same classes are closed by construction:
  - read and insert rules are declared per table, so a roles table's `insert <- viewer = 'service:operator'` cannot be bypassed by a signup;
  - `image <=N` columns reject non-images;
  - assets are served under the same row privacy as the row that references them;
  - time rules read the server's `now`, and the dev clock removes the need for public test hooks.
- No Snapback high is platform-attributable. Its four (c) findings are medium or low: whitespace-only text and one existence oracle.

**What both backends share** is classes (a) and (b): the author encodes the spec's rule wrongly or not at all. On these, Snapback is only as good as the rules written. The 045 luthier finding and the 015 custody findings appear on both twins.

**Snapback's distinctive weakness** is *derived grants*. Authority sits in a membership or assignment row that a later role change doesn't revoke (019, 048 ×3, 040). The language enforces exactly what was written, and `check` is silent. Because the rules are declarative, this is statically detectable (S1).

### 3.5 Mapping onto the "zero security holes" layers

The layers:
- **(a)** declared spec-level invariants that `check` proves over every exposure path, or refutes with a counterexample;
- **(b)** a per-role exposure report;
- **(c)** generated adversarial tests run in `test`.

| Snapback finding | (a) invariant | (b) exposure report | (c) adversarial tests | path needing special care in (a) |
|---|---|---|---|---|
| 019 F1, 048 F2/F3/F4, 040 F1 (grant outlives role) | **yes**, if the invariant names the *current* role ("inspections readable only by current inspectors on the route"). The counterexample is a reachable state: grant row present, role changed. | partly: it shows "readable via `routes[viewer]`", and a reviewer must notice that role is absent | yes, if generation includes role-change sequences (demote, then read and write) | **state history and reachability**: the invariant must hold over reachable states after any sequence of writes, not one snapshot |
| 020 F1 (manager lifts hold) | yes (write-authority invariant: "only liaison may lift") | **yes**: `liftHold` writable by manager is plainly listed | yes | — |
| 021 F1 (self-bootstrap director) | yes ("directors are appointed only by operator") | **yes**: `directors` insertable by any signed-in user via `createTournament` | yes | **transitive authority**: an insert in one mutation grants global reads elsewhere |
| 045 F1 (luthier reads notes) | yes | **yes**: the most direct case | yes | — |
| 015 F3/F4/F5, 020 F2 (argument into grant column) | yes (the relation invariant "a handoff's parties are the current foster and an approved adopter") | yes, if the report includes *who can write the columns that grant reads* | yes (fuzz principal arguments with other roles) | **indirect grants**: exposure through writable grant columns |
| 015 F2, 041 F1 (never encoded) | yes, *only because* a declared invariant would be unprovable (no field or transition exists). This is the main argument for stating invariants in spec terms. | no | no (nothing to generate from) | — |
| 002, 011, 020 F3, 045 F2/F3 (required photo optional) | yes, as a row invariant ("every checkout has a condition photo") | no (integrity, not exposure) | yes (omit optional fields) | **uploads**: the invariant must cover asset-typed columns |
| 003, 049 (whitespace text) | only if the invariant says "non-blank"; better fixed by the platform default (S5) | no | yes (whitespace fuzz on text arguments) | — |
| 020 F5, 043 F2, 046 F1 (sweep-only deadlines) | yes, if invariants are temporal ("after day 30 no release succeeds") | no | yes (advance the clock *between* sweep ticks) | **timing**: sweep lag; invariants must be stated against `now`, not job state |
| 004 F1 (several current shows) | yes (uniqueness invariant) | no | yes | — |
| 021 F2 (caller picks the deadline) | yes (the counterexample binds the argument to another row) | partly | yes | argument and row binding |
| 048 F1 (incomplete round) | yes, but needs an **aggregate** invariant (count of readings = gauges) | no | yes | **aggregates and counts** |
| 006 F2, 043 F1 (broad reads) | yes | **yes**: "table T, columns …, readable by every signed-in principal" | yes | — |
| 001 F1 (existence oracle) | only if (a) treats **refusal codes** as an exposure path (NOT_FOUND vs FORBIDDEN) | yes, if the report lists "existence revealed via …" | yes (compare refusals for absent vs hidden IDs) | **error messages and existence side channels** |
| 004 F2 (mutation return, d) | (a) must include **mutation return values** as an exposure path; here it was the caller's own row | yes | — | mutation results |

**Coverage.** Of the 30 non-(d) Snapback findings:
- layer (a) catches all of them, given invariants in spec terms;
- (b) catches 6 outright (020 F1, 021 F1, 045 F1, 006 F2, 043 F1, 001 F1), and about 10 more if it reports derived grants and the writers of grant columns;
- (c) catches 28 (all except the two never-encoded rules, 015 F2 and 041 F1).

**Paths (a) must model explicitly:**
- reachable-state history (role changes);
- aggregate and count invariants;
- refusal codes and existence;
- time and sweep lag;
- asset-typed columns;
- mutation return values.

No Snapback finding came through sync or live updates, or through asset download. The probes tested both: live updates on both sides, and asset download on Snapback.

**Would anything comparable be possible on Convex? Not structurally.**
- There is no declarative policy to prove over. Authorization is arbitrary TypeScript in each function, and `ctx.db` and `ctx.storage` can be reached from anywhere.
- Layer (a) would need whole-program verification of TypeScript. Layer (b) can only be approximated dynamically, by calling every public function as every role.
- Convex's largest finding classes sit *outside* any function's code:
  - `getUrl` URLs are served by the platform with no auth;
  - storage IDs are global capabilities;
  - upload content types are unchecked.

  So even a perfect per-function analyser would miss 21 of the 63 findings, 10 of them high, unless the platform itself modelled storage exposure.
- What Convex could do is closer to layer (c) plus lints:
  - `convex-test`-generated role × function call matrices;
  - lint rules for public functions without `ctx.auth`;
  - `role`-typed arguments on public mutations;
  - `getUrl` on private tables;
  - `Date.now()` in queries.
- Snapback can do all three layers because rules, row privacy, asset privacy and time are already part of the schema that `check` binds (`crates/snapback4-lang/src/bind/auth_lints.rs:33` is where layer-(a)/(b) notes would live).

---

## 4. Where the time and friction went

`minutes_lost` are self-estimates. Muse's estimates run 4–5× Codex's per entry (5.8–7.8 vs 1.4 min), so compare minutes within a model. Wall and agent time are clock time.

**Time.** Snapback's speed advantage holds within each model.

| backend × model | n | wall median (range) | friction min median / sum | backend-attributable* median / sum |
|---|---:|---|---|---|
| Snapback, Codex | 30 | 12 (8–19) | 8 / 244 | 5 / 144 |
| Convex, Codex | 30 | 14 (8–21) | 10 / 315 | 7 / 214 |
| Snapback, Muse | 20 | 17 (9–34) | 21 / 530 | 11 / 306 |
| Convex, Muse | 20 | 21 (13–79) | **46.5** / 962 | 27.5 / 663 |

\*Backend-attributable means the `backend-defect`, `docs-gap`, `confusing-diagnostic`, `missing-feature` and `ergonomics` kinds. It excludes `agent-error` and `environment`. Totals: **Snapback 446 min vs Convex 877 min.** Agent-error minutes are similar (246 vs 317).

Pairs (Snapback better / Convex better / tie):
- Muse: wall 12/2/6, friction 14/6/0.
- Codex: wall 17/11/2, friction 20/9/1.

**Where Snapback's minutes went** (by area):
- Testing: 185 min over 39 lanes. This is mostly proof and acceptance work — Playwright selectors, the dev clock, and service tokens against a memory dev host.
- Frontend: 97.
- Authorization rules: 79. These are `check` completeness and read-probe advisories: N_NEVER_COMPLETE, role-branched and cascade caps.
- Client: 57. `matchRead`, the read union and hook shapes.
- Auth: 56.
- Time semantics: 40. `hour(t)` is epoch-hours (026 "needed hour(now)%24"); clock-advance caps; clock jumps expire sessions.

**Where Convex's minutes went:**
- Testing: 270.
- **Auth: 205 over 34 lanes.**
- **Codegen and types: 145 over 39 lanes.** `auth.config.ts` and the convex tsconfig fail the CLI's own typecheck in 34 lanes; action↔internal circular inference; ESM `api.js` imports from Node.
- CLI: 112. `convex env set` misparses PEM values that start with `-----`, and echoes a secret on a parse error (036).
- Frontend: 106.
- Uploads: 46.

**Why Muse on Convex had a median of 46.5 friction minutes.** Four things stack up.

1. **Muse did the Convex Auth setup by hand and broke it.** Codex lanes logged almost none of this.

   | incident | Muse | Codex |
   |---|---|---|
   | JWT key, env and secrets setup | 11 entries / 85 min / 7 lanes | 1 / 1 / 1 |
   | signIn race, `expectAuth`, Node sign-in, identity | 17 / 177 / 12 | 9 / 16 / 8 |
   | `auth.config.ts` typecheck | 14 / 96 / 12 | — |

   Examples:
   - 002 "Skipped Convex Auth key bootstrap; sign-in failed with missing JWT_PRIVATE_KEY" (12 min).
   - 030 "Rotated JWT_PRIVATE_KEY without updating JWKS; opaque OIDC verify errors".
   - 027 "ConvexReactClient expectAuth:true deadlocks password sign-in with zero diagnostics" (30 min, backend-defect).
   - 020 "Password signIn resolves before auth token is usable for next mutation".
   - 027 "No documented Node (non-React) sign-in flow for Convex Auth Password" (20 min).
   - 045 "identity.subject is not the users table id" (15 min).
   - 027 and 034: docs.convex.dev/auth/* 404s; the Convex Auth docs live at labs.convex.dev.
   - 020 and 030: the docs pin `@auth/core@0.41.1`, but `@convex-dev/auth@0.0.90` requires `^0.37.0`.
2. **Driving Convex from plain Node** for acceptance and `probe:serve`: 9 entries / 71 min.
   - 027 "Generated convex/_generated/api.js not importable from plain Node scripts".
   - 013 "Circular type inference when actions call internal.* helpers".
3. **Process hygiene:** 13 entries / 138 min / 13 lanes.
   - Orphaned vite processes behind an `npx` wrapper (015, 25 min; 002).
   - pkill self-kills (013, 024, 026, 030). These are the same habits that killed other lanes' probes.
4. **Expo web and Playwright with an open realtime socket:** 019 "waitUntil networkidle never fires with Convex realtime connection open" (15 min).

Hand-rolling auth (six lanes) avoided item 1 but moved the cost into security (§3). Muse-Convex's long tail — 019 at 79 min, 015 at 68, 021 at 54, 045 at 50 — is the same set of lanes.

**Praised and cursed (verbatim)**

*Snapback, praise:*
- 004 "N_PROBE_ONLY_READ caught a genuine auth hole (role-less users reading current-show cues) before deploy. That single note was worth more than every other verification step."
- 036 "check rewrites, guide cards, and the `snapback4/proof` kit carried the whole task."
- 020 "`check` diagnostics, `why`, the roles recipe, `/dev/jobs` triggering, deploy+serve+token flow — worked as documented."
- 038 "Keep the sectioned guides and proof lifecycle helpers: they made this unusually quick to get right."

*Snapback, curses:*
- 034 "right now every builder invents it separately — with a real risk of shipping an open bootstrap mutation" (first admin and roles).
- 048 "a password-only app still has an impersonation door in development".
- 045 "a correct behavior looks exactly like store corruption or cross-talk" (session rotation: "unknown to this store").
- 026 "the current naming makes the wrong version look right" (`hour(t)`).
- 001 "Quarry imposed more learning than TypeScript-based Convex func[tions]".

*Convex, praise:*
- 011 "Keep `convex dev --once` exactly as is — fastest backend bootstrap I've used."
- 015 "Fast deploys, plain-TypeScript auth rules instead of policy DSL, and script-friendly function calls".
- 022 "Transactional rope eligibility checks, durable scheduling and automatic reactive query invalidation fit this app exceptionally well."

*Convex, curses:*
- 004 "a copy-pasted setup file failing `convex dev` is the worst first impression".
- 034 "the very first deploy of the recommended auth setup fails out of the box".
- 027 "It cost the most time and produced no diagnostic output at all" (`expectAuth`).
- 024 "the OAuth/cookie flow is browser-shaped and hard to drive from scripts".

**Both sides' top "fix first" ask is the same:** a production-shaped password plus role-provisioning recipe. Snapback REPORTs name it 20 times (13 as first-admin or roles, 7 as service tokens against dev); Convex REPORTs name it 13 times. It is not specific to either backend. Convex lanes also ask for private file serving.

---

## 5. The two red Convex lanes

**036-convex-robotics-parts-ledger: the agent's fault; deterministic; not Convex.**
- Every harness `npm run acceptance` run exited 1 in 0 s with `missing EXPO_PUBLIC_CONVEX_URL`. That covers the first verify and both reverify runs.
- Cause: `scripts/acceptance.mjs:8-12` reads the variable but never loads `.env.local`, which its `frontend-proof.mjs:16` and `probe-serve.mjs:17` both do.
- The agent only ever ran `set -a; . ./.env.local; …; node scripts/acceptance.mjs`, so REPORT.md's "`npm run acceptance` → 79 passed … run twice" is false as written.
- Re-run from a copy: plain `npm run acceptance` exits 1. With `.env.local` sourced it exits 0 twice (79 passed).
- Convex's only part is ergonomic: the CLI writes `.env.local`, which plain Node doesn't load. 15 entries in 13 Convex lanes, 34 min; 0 on Snapback.

**048-convex-boiler-room-rounds: the agent's non-idempotent proof, then pollution the probe left on the shared hosted deployment; not Convex.**
- **First verify.** The second `frontend:proof` timed out waiting for `history-` with `152.10`. The app allows one round per shift per hour, so the second run found "already exists", opened `round-` `.first()` and looked for a new gauge value. It depends on time of day; reverify's frontend runs passed twice.
- **Reverify.** Acceptance failed in both runs: `storage id kg26… not found at convex/rounds.ts:108`.
  - The probe reviewer had reused one photo ID across three readings (`probe/NOTES.md:52`). The app allowed it, and `deleteRound` (`rounds.ts:105-108`) cascades `ctx.storage.delete` three times on the same ID. That left an undeletable round in the 17:00 UTC hour slot.
  - Acceptance's `purge()` (`scripts/acceptance.mjs:75-82`) deletes all rounds from the last two hours, so it throws.
  - This was reproduced at 18:09 UTC and clears on its own about two hours later.
- **The asymmetry:** on Convex, verify, probe and reverify all share one persistent hosted dev deployment. Snapback lanes mostly start fresh stores, so a probe cannot poison a Snapback reverify.

---

## 6. Fairness audit of the harness

**Briefs and backend sections: neutral in text, with four real tilts.**

1. **90-minute credential rule** (favours Snapback).
   - Snapback password sessions default to 7 days, so the rule cost nothing.
   - Convex Auth JWTs default to about 1 h. 41 Convex lanes overrode `jwt.durationMs` or session lifetimes; token-lifetime friction was Convex 16 entries / 13 lanes / 60 min against Snapback 7 / 6 / 45.
   - Six Muse Convex lanes abandoned Convex Auth for hand-rolled password auth (011 bcryptjs, 013 scrypt, 015 PBKDF2, 019 SHA-256, 024 SHA-256, 042 bcrypt). 042, 013 and 024 cite `probe:serve` scriptability or credential lifetime. Those lanes carry many of Convex's highs (§3).
   - The downside on Snapback is small: four lanes' test clock jumps expired 7-day sessions (009, 042, 045, 049).
2. **`--save-exact` on Snapback only** produced the 22 vs 4 tamper artifact (§2).
3. **Time rules "without real waiting, by whatever means the backend offers"** (favours Snapback in practice).
   - Snapback has a built-in dev clock (`/dev/clock/advance`, `run --now`); about 37 lanes used it.
   - Convex lanes used backdating through internal or admin mutations (about 28) or `convex-test` with fake timers (13), which runs locally and not against the live backend.
   - The dev clock is also what pulled 10 Muse Snapback lanes into `dev` for `probe:serve`.
4. **Expo install line** names `snapback4-expo@<v>`; Convex gets "plus any packages its docs recommend". This is necessary; the mild advantage goes to Snapback.

**What is not a tilt:**
- **Docs.** Convex lanes read docs.convex.dev; there were 788 web fetch/search references and 2 one-minute fetch failures (046, 047). Snapback lanes read the docs shipped in the package (0 web references). This is an honest product difference, not a harness one.
- **Local servers.** Snapback had to run local servers on its own ports; port friction was negligible (1 entry vs 2).

**Hosted network and rate limits on Convex: none of substance.**
- No 429s, rate limits, ECONNRESET, deployment limits or push-latency entries in any Convex friction log or verify output.
- Preflight: Professional plan, 300 deployments allowed, 14 existing, 50 needed.
- The only runner retry was one provider error (050-convex, 17:14:19).
- The Convex "timeouts" were Playwright `networkidle` against the open realtime socket (019, 021; 15 min each).

**Local registry (verdaccio at 127.0.0.1:4873): minor, and on both sides.**
- "Silent while the mirror filled": Snapback 001, 003, 012, 017, 018 (0–3 min each); Convex 003, 005 (3–4 min).
- Snapback Expo companion modules were unpinned and resolved to the next SDK: 008, 009, 037 (about 8 min).
- Convex had `@auth/core` peer conflicts from the version the docs pin: 020, 027, 030 (16 min).
- No missing tarballs; `snapback4-linux-x64` resolved everywhere.

**Model quota.** All 18 Muse fallbacks happened at 16:25:23 as 9 whole pairs, each moving to the Meta key on both sides (attempt 1 is a 0-minute quota hit). This is symmetric; there are no model mismatches.

**Probe capability: equal where the server stayed up.**
- Convex reviewers held real `ConvexClient` WebSocket subscriptions (`onUpdate`).
- Snapback reviewers used the SDK observe feed and the `/changes` long-poll (invalidation, then an authorized refetch). Both sides tested live updates in nearly every lane whose server survived.
- API discovery is comparable: Convex `POST /api/query|mutation {path,args}` from `_generated/api`; Snapback `POST /q|m/<op>` from `generated/api.ts`.
- Probe minutes in surviving lanes: median 6.2 Convex, 6.4 Snapback.
- What was *not* equal is how many probes were truncated: 21 Snapback vs 11 Convex.

**Harness changes before the next bakeoff** (in order of impact):

1. **Probe in a separate phase.** Today `run-bakeoff.mjs:267-281` starts a lane's probe right after its verify, while up to 49 builders are still working. Move probing to after the queue drains, or give each lane its own PID namespace or Unix user. This alone removes all 32 serve deaths. The brief's "never kill by name" (`brief-bakeoff.md:36`) is unenforced.
2. **Make `probe:serve` failures attributable.**
   - Launch it through a harness-unique wrapper path (`probe/.serve-<nonce>.sh`) so name patterns don't match.
   - Record exit signal and time (`probe.mjs:60` keeps only `code ?? 1`).
   - Restart once and extend the reviewer's deadline if it dies.
   - Always start a fresh `probe:serve` before re-running repros (`probe.mjs:135`), so confirmation does not depend on the first serve surviving.
3. **Split the metric** in `aggregate-bakeoff.mjs:46`: never-up or under-staffed is a lane result; killed externally is a harness error.
4. **Enforce "no relaxed dev mode".** After `probe:serve` prints, have the harness check `GET /auth/config` (`development:true`) and probe `/seed` and `/dev/status` on Snapback. On Convex, check for public `seed`/`reset`/`test*` functions. Score violations as red. Under that rule, all four proofs are green for 40/50 Snapback lanes this wave.
5. **Write `probe/package.json` before the reviewer starts**, and read-only-mount the lane during the probe (§2). Ignore `.runs/` and similar runtime directories in the digest.
6. **Isolate hosted state.** Reverify reds *before* probing, or give the probe a separate Convex deployment, so probe fixtures cannot poison later verifies (048).
7. **Drop the 90-minute credential rule.** Let `probe:serve` hand out `{email,password}` and have the probe sign in and refresh itself. This removes a Snapback-favouring requirement and the incentive to hand-roll Convex auth.
8. **Pin both backends the same way** (exact or caret).
9. **Run each proof once, verbatim, before marking the agent done**, and feed failures back. That would have caught 036's false REPORT.
10. **Report minutes within model.** Muse's self-estimates run 4–5× Codex's per entry (5.8–7.8 vs 1.4 min per entry).

---

## 7. Prioritized Snapback fix list

**Score** = lanes × minutes × (#1 votes + 1), as in the farm's `patterns.md`.
- Inputs: clusters of Snapback `friction.jsonl` entries and the first-ranked "fix first" item of each REPORT.md.
- Security-only items are scored as findings prevented, and slotted in by severity.
- **Gap** marks items that close a measured gap with Convex.
- Code pointers are into `~/projects/snapback-sb4loop/snapback4`.

### 7a. Friction-ranked list (score = lanes × minutes × (#1 votes + 1))

Clusters come from regexes over the friction summaries, so lane and minute counts are approximate (±10%). A "#1 vote" is the first-ranked item in a lane's REPORT.md.

| rank | fix | lanes | min | #1 votes | score | gap? | pointers |
|---:|---|---:|---:|---:|---:|---|---|
| 1 | **Make the completeness and read-probe advisories triageable.** Covers N_NEVER_COMPLETE/N_CONDITIONAL_COMPLETE, role-branched caps and cascade caps. Say which pin, index or rewrite settles each note, and give a "this is fine because…" acknowledgement path. | 30 | 106 | 7 (005, 017, 024, 028, 029, 039, 042) | 25,440 | no (Snapback-only cost) | `crates/snapback4-lang/src/bind/mod.rs:908`, `bind/pin_rewrite.rs:1`, `guide/codes.rs:349` |
| 2 | **Staging with real users under `serve`.** Ship a `snapback4 serve --seed-users` style helper for `test` releases, a CI-tested "staging with real users" recipe (deploy → serve → operator token → signup/login → provision → long-lived sessions), and `startServe()` returning an operator token. Fix `startDev()` silently forcing `--memory` so `token --service` works against it. Add a first-admin and role-provisioning recipe that has no open "claim head" mutation. *This merges the "service token vs memory dev host" cluster (12 lanes, 27 min, 7 votes) with "password first-admin recipe" (4 lanes, 12 min, 13 votes).* | 15 | 39 | 20 | 12,285 | **yes**: this is why 10 Muse lanes served `dev` under `probe:serve` (§1); it is Convex's #3 ask too | `packages/snapback4/src/proof.ts:56`, `:63`; `CLIENT-AND-OPERATIONS.md:2481-2511`; `SERVER.md:209-221`; `crates/snapback4/src/serve_token.rs:146`; `guide/rule_recipes.md:741` |
| 3 | **Clock and time semantics.** `hour(t)` is epoch-hours; rename it or add `hourOfDay`. Remove the clock-advance caps. Clock jumps should not expire the test sessions. Add compound durations. | 17 | 58 | 3 (006, 026, 043) | 3,944 | no | `crates/snapback4-lang/src/parser.rs:705`, `guide/time.md:68` and `:146` |
| 4 | **`matchRead` and read-union ergonomics.** Make null-row dispatch to `otherwise` explicit; `otherwiseAll` should not be required; document `PageHook` and `observe` as an external store. | 17 | 54 | 2 (002, 021) | 2,754 | no | `packages/snapback4/src/contract.ts:490-556` |
| 5 | **Serve process lifecycle on shared hosts.** The binary outlives a killed npm wrapper (004). Add an `--exit-with-parent` / supervisor-PID watch on bare `serve` and `dev`, matching what `snapback4/proof` passes via `SNAPBACK4_SUPERVISOR_PID` (`proof.ts:24`). *Most of this cluster's minutes are the harness kills.* | 13 | 105 | 1 (020) | 2,730 | no | `packages/snapback4/src/proof.ts:24`, `proof-guard.ts:1-7` (the stdin-EOF keeper) |
| 6 | **Name the refusing clause in E_RULE.** Distinguish hidden from absent, and an authored code from NOT_FOUND. | 8 | 54 | 2 (011, 041) | 1,296 | no | `crates/snapback4-core/src/engine/refusal_trace.rs:91`, `engine/actions.rs:129` |
| 7 | **Assets.** Add an image-versioning recipe, clarify file vs image, fix the Expo web picker, and expose upload on `app.online`. | 13 | 46 | 1 (030) | 1,196 | no | `guide/rule_recipes.md:333` ("Versioned media") |
| 8 | **Close dev doors for password-only apps.** Refuse undeclared persona names and drop the persona/witness plumbing from password starters. Add a `check` note that `dev` exposes `/seed` and `/dev/*`. | 10 | 17 | 5 (001, 016, 025, 048, 050) | 1,020 | **yes**: a strict no-dev-mode `probe:serve` rule fails 10 lanes | `crates/snapback4/src/serve_identity.rs:19-40`; `CLIENT-AND-OPERATIONS.md:3411` |
| 9 | **Pin Expo companions in `init --expo`/`upgrade`.** Also fix the named vs default `App` export and the RN `accessibilityRole="status"` that RN rejects. | 12 | 32 | 1 (008) | 768 | no | `packages/snapback4-expo/package.json`; `README.md:21` |
| 10 | **Document the `/seed` and raw wire envelopes** (the array shape, `{id,args}`). | 8 | 20 | 1 (013) | 320 | no | `CLIENT-AND-OPERATIONS.md:3045-3057`, `:3262` |

Agent-side Playwright selector mistakes (25 lanes, 89 min, 0 votes) are not a Snapback fix.

### 7b. Security-ranked list

Weighted findings prevented: high = 3, medium = 2, low = 1, over the reproduced Snapback findings in §3. No item is backend-specific friction. All of them widen Snapback's structural lead rather than close a gap.

| rank | fix | findings prevented | weight | pointers |
|---:|---|---|---:|---|
| S1 | **Grant-outlives-role lint plus a "role change revokes derived grants" recipe.** Fire it when a rule admits through `exists G[…viewer]` or `.col = viewer`, G's writers require a role, and the reading rule does not re-check that role. | 019 F1 (high), 048 F2 (high), 048 F3/F4, 040 F1 | 12 | `crates/snapback4-lang/src/bind/auth_lints.rs:33` (`notes`); `guide/rule_recipes.md:257`, `rule_recipes_wave13.md:66` |
| S2 | **Argument-into-grant-column lint.** Fire it when a column that a read rule trusts as `.col = viewer` is written straight from a mutation argument, with no `require` on that principal's role or relationship. | 015 F3/F4/F5 (two rated high, really medium), 020 F2 | 8–10 | beside `vacuous_inserts`, `auth_lints.rs:179` |
| S3 | **Self-bootstrapped global authority.** Extend N_VACUOUS_RULE to `created X[…]` where X's insert is open to every signed-in caller. Pair it with the first-admin recipe in 7a #2. | 021 F1 (high) | 3 | `guide/codes.rs:169`, `auth_lints.rs:179` |
| S4 | **Required evidence.** The docs teach `image ?` everywhere; add a required-photo recipe (non-optional `image`, `[image] 1..N`) and a `check` note when a mutation writes an optional media column it never requires. | 002, 011, 020 F3, 045 F2/F3 (all medium) | 10 | `packages/snapback4/README.md:48`; `guide/rule_recipes.md:355`, `:813`; `FOLLOWING-ADOPTION.md:138`, `:195`; `[image] 1..N` minimum enforced at `crates/snapback4-core/src/engine/validate.rs:110` |
| S5 | **Whitespace-only text should not satisfy `text min..max`.** Count non-whitespace characters toward the minimum, or add `format nonblank`. This is a platform default and the only (c)-class fix. | 003 F1/F2, 049 F1 | 6 | `crates/snapback4-core/src/engine/validate.rs:131-135` |
| S6 | **Sweep-only deadline note.** Fire it when a `job` flips status on a `now` comparison but the mutations gated on that status never compare `now`. | 020 F5, 043 F2, (046 F1) | 4–6 | `guide/time.md:95` and `:142`, `guide/recipes.md:284` |
| S7 | **List broad reads in the `check` output.** Cover `read <- allow` and `exists roles[viewer]` on tables with private fields, requiring a stated reason as `public '…'` already does. This is the exposure report of layer (b). | 043 F1, 006 F2 | 4 | `auth_lints.rs:33`; `bind/private_scans.rs` |
| S8 | **Existence-oracle note.** Fire it when a lookup's absent code differs from its denied code (`! else NOT_FOUND` then `require … else FORBIDDEN`). | 001 F1 (low) | 1 | `auth_lints.rs:297` (`hidden_lookups`) |

### 7c. Top 8, merged

1. Staging with real users under `serve` and first-admin provisioning (7a #2). **Closes the gap.**
2. Grant-outlives-role lint and recipe (S1).
3. Completeness-advisory triage (7a #1).
4. Close dev doors for password-only apps (7a #8). **Closes the gap.**
5. Argument-into-grant-column lint, plus the self-bootstrap extension of N_VACUOUS_RULE (S2 + S3).
6. Required-evidence recipe and note, plus non-blank text minimums (S4 + S5).
7. Clock and time semantics (7a #3), including the sweep-only deadline note (S6).
8. The `check` exposure listing of broad reads (S7). This is the seed of the layer (b) exposure report.
