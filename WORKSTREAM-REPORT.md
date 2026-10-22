# DX6 workstream report — wave-22 fixes for 0.4.38

Worktree: /home/ccheever/projects/sb4-b22-dx6; branch: sb4-b22-dx6.
Base: 4a85340d11; pre-existing 280fbc9774 and 4a85340d11 retained.
Package version remains **0.4.37**. User-facing changes are under **0.4.38**
in snapback4/packages/snapback4/CHANGELOG.md, exposed by guide changes.
Local commits only: no push or publication.
Final functional source: `0bf50ac18696a2414dd836968ccda17607f0a45c`;
subsequent commits contain review records and verification evidence.

## Gate regressions (#5)

- Seeded accounts include their actual session kind. Legacy partial online
  session literals use bearer-only transport without inventing local authority
  or refresh metadata; local/device sessions remain strict. E_SESSION names
  every invalid/missing field and the one-line token-only repair.
  Commit: 2f3dfec2d5.
- Upgrade advice applies to actual transitions crossing its introduction
  threshold and affected scripts. Fresh init is quiet; nonterminal delivery
  is acknowledged. Commit: 3a97ce8a8d.
- Future stores refuse before SQL inspection, name a newer Snapback and return
  a nonzero SQL exit. Commit: d216820a9b.
- Clock result valueOf preserves numeric arithmetic and Date use.
  Commit: 406f5af67a.
- Packed upgrades run unchanged wave-21 lane 025 acceptance and lane 002
  prod:serve on isolated upgraded copies with their schema baselines.
  Commit: 51c5d98c1f.

Focused tests passed: session/upgrade/read-only tests, future-format/SQL native
tests, six old-CLI upgrade modes, unchanged lane 025 acceptance **80/80**, and
lane 002 production readiness with **8 users**. Credentials stayed in child
memory and were never printed. Final fresh-pack results are recorded below.

## Staging clock (#6)

- Held boundaries refuse E_CLOCK_HELD before effects; allowHeld explicitly
  accepts them. advance(...,{drain:false}) pauses all maintenance so a mutation
  reaches its own deadline check. drain() resumes at the same time. Failed
  maintenance remains paused. CLI offers the equivalent controls.
- Staging jumps transactionally preserve remaining live full/read session,
  read-cap and mint-receipt lifetime. Dead, revoked and expired credentials do
  not revive. Worker leases retain established behavior. sessions:"expire"
  explicitly tests expiry; dev retains expiry and production refuses controls.
  Commit: 81fe32fe24.
- SDK timing reconciliation precedes client clock listeners. Restored read-only
  credentials recover only through an authenticated staging timing probe.
  Clocks are isolated and old-token replies cannot restore authority.
  Commit: 5eb80d8797.
- Preservation uses effective disclosure-clock delta above the persisted floor.
  Commit: d11f762263.
- Shared worker-clock transaction and identity authority-snapshot seams keep
  the transaction-path ratchet intact, with no allowlist/census increase.
  Commit: 70e50d228d.
- Integration, executable qualification and guide text: 406f5af67a,
  4de255840f. Independent daily-hold test expectation: 6f111ceda3.

Passed: SQLite preservation **5**, actual PostgreSQL preservation **2** (private
socket-only PostgreSQL 16.15 cluster removed afterward), SDK timing/related
tests **100**, server custody **39 + 1 expected skip**, maintenance/effective
floor **13**, final clock **45/45**, shared-seam identity **30**, transaction
ratchet **3** (11 files/48 sites; identity decreased, no new opener).
Packed regression covers a 22-day jump, retained/restored read clients, device
reopen, numeric coercion, mutation-before-sweep, CLI pause/drain, explicit expiry
and no-effect held refusal.

## Frontend and proof kit (#8)

Both starter lists use SDK ReadState and distinguish partial empty answers.
Password web clients omit witness registration/persona plumbing; guest clients retain persona
proof compatibility. Exact historical templates adapt; edited source remains
application-owned.

Browser drivers install the same immutable public observer before application
scripts. The first selected App is locked; same-App generated API enrichment
is allowed; a different explicit App refuses. The observer is a same-origin
test facility, not an authentication or confidentiality boundary.

Text matching handles composed visible RN/web text, wrapping labels, open
shadow roots and slots. Hidden/editor values are excluded; strict ambiguity
and explicit matching modes remain. Freshness uses that same visible text
after locator chaining. Caller-owned browsers use the installed Playwright
peer or withBrowser.

Commits: babf5cf562, 129911f3a5, 37aa4103ed, 420c986470.
Passed: frontend/proof **126/126**, native witness **13/13** including generated
password UI without registration, shared-driver contract **12/12**, missing-peer
help, historical starter custody **8/8**. Packed starter qualification also
runs the generated password UI.

Non-whitespace frontend characters measured on copied wave-22 lanes:

| Lane | Before | After | Delta |
| --- | ---: | ---: | ---: |
| 001 stained-glass-restorations | 13,459 | 13,123 | -336 |
| 037 orthotic-casting-orders | 12,580 | 12,226 | -354 |
| 040 excavator-rental-returns | 18,874 | 18,520 | -354 |

All authored frontend files were counted. This measures witness removal rather
than a domain-UI retrofit. Original hashes stayed identical; copies were removed.
Details: snapback4/reports/20261022-dx6/frontend.md.

## Design review and ownership

Amendment: llp/3000.000.000.001-staging-with-real-users.rfc.md §11.
The security-invariants LLP has a one-line compatibility pointer. SEC7 owns
security advice/recipes; DX6 makes no security-hole-free claim for that lane.

Fresh independent Muse and Codex reviews used the exact requested commands.
Round 1 drove timing reconciliation, the trusted same-origin observer model
and fail-paused drain behavior. Both round 2 reviews returned **READY** on the
same frozen proposal, SHA-256
eacbb1d8c059ee8422c4aa950216d0fc2f8b79e3958b957ee1e43901e93bba03.
Verbatim artifacts, frozen proposals, briefs and provenance: llp/reviews/dx6/.
Design readiness is separate from test qualification.

Additional integrated reviews found three implementation gaps: final streaming
heartbeats omitted credential timing, clock publication preceded durable local
credential saves, and clipped descendant text could manufacture visible labels.
Commits 291b4ec653, 2b38769779 and 6df0baa8b2 repair these with regressions.
The next fresh Muse review was READY; Codex identified App preparation persisting
a clock before its staged credential was actually committed. Commit 18327ed997
defers prepared clock persistence through App's real commit boundary, including
close/detach; all four new crash/commit regressions pass and fail against the
previous packed implementation. Broader full-count App model checks then exposed
response-capture cleanup races governed by the existing LLP 3000.013 cutoff;
the repair is committed as 3383a06262. The full model passes **60/60**, including
both **5,000-history** tiers (online 98.069 seconds, local 172.006 seconds).
Expanded App/HTTP/close tests pass **223/223**; three selected-SDK cutoff tests
pass and the actual-device negative control fails without the admission fix.
Commit 51b19b0d0c runs those three cases against installed SDK/platform artifacts.

Round 4 Muse returned READY; Codex found an ordinary already-processed current
schedule window incorrectly classified as a held future boundary, obstructing
zero-time drain recovery. Commit efcbc21344 repairs it, aligns heldUntil/catch-up with saved boundaries,
accounts for unchanged raw time in refusal repairs and raw/effective-floor
differences in accepted reports. The native/guide group passes **202/202**;
the real-server consumer and refs pass. Both fresh round 5 reviews returned
**READY** on source efcbc21344665a0720f3afaf1fc216dc81aa8027 and proposal hash
d6aebe547c3a3c9f1e4f0d7e783cc44a9295d25dd74531795af4344e3dbfb104.
Commit 02409d2266 aligns startup guidance too (clock **45**, store **7**, ratchets
**10** passed). Online clocks are volatile; the amendment accurately distinguishes
existing asynchronous credential listeners from device-clock durability.

The final broader client run then passed **363**, skipped the expected old-binary
case, and caught **1** stale-auth regression: retaining a superseded bearer's
E_AUTH incorrectly changed a durable pending write into failure after sign-out.
That candidate qualifier was cancelled safely before creating consumer scratch;
the independent Rust run continued untouched. Commit 0bf50ac18696a2414dd836968ccda17607f0a45c
repairs the rotation fence with a monotonic refusal floor checked at capture and
delivery. Plain sign-out does not invalidate its own known refusal; intermediate
retiring-bearer actions stay obsolete, while an adopted successor remains valid
during delayed persistence. Focused security **26/26**, expanded App/HTTP/close/
security **329/329**, and the cutoff predicate pass. The new local regression
fails against the rejected packed candidate. The packed hook now executes the
entire session-security file using the installed SDK. Fresh R6 proposal SHA-256:
94921e914251509fb831b2264420f2455a6c2c677514d896c23f01f0b2616fae.
Both fresh R6 reviewers returned **READY**, with no remaining material findings
on that exact committed source/proposal. Raw artifacts and provenance are saved.
Final models pass **60/60**: online **5,000** histories in **97.859 s**, local
**5,000** in **164.125 s** (total **265.691 s**). Final 23-file client run passes
**383**, fails **0**, skips **1** expected historical-binary case (**384** total).
Fresh packed qualification passed the installed DX6 proof and all six old-CLI
upgrade modes, including wave-21 025 (**80 checks**) and 002 (**8 users**).
The broader consumer run then stopped at an npm shared-cache ENOENT while
installing @types/react-dom for a production starter. The retry passed with
the same tarballs/source using a private temporary npm cache; the interrupted
run is retained as infrastructure evidence. Final Mac verification remains
blocked by host reachability.

## Verification

Setup passed: frozen product install, native CLI, wasm (**734,907** gzip bytes
within **735,407** budget) and TypeScript build. Every shell invocation has a
timeout. Every Cargo invocation inherits all three required low-disk flags.

- Affected clients after timing/text repairs: **21 files; 317 tests; 316 passed, 0 failed,
  1 expected skip** (verified historical 0.4.13 downgrade binary unavailable).
- Root frozen install, hoist and generated artifacts passed with repository
  pinned Bun 1.3.12 after initial Bun 1.4.2 setup lacked root acorn resolution.
  Root product and dependency sources were unchanged.
- Root inventories passed: 365 package tests, 35 scripts, 31 demos,
  487 publication leaves, 162 guide pages and 1,937 snippets.
- Root guide: **22 passed, 0 failed, 0 skipped, 0 missing preconditions**;
  121 existing advisories remain advisory.
- Final ref-check: **564 LLPs, 12,312 refs, 0 errors, 0 unchecked**.
- Product docs budget: **319/320** README lines; self-containment **1/1**.
  Evidence and scoped LLP audit: snapback4/reports/20261022-dx6/root-checks.json.
- Full workspace Rust: **450 target scopes** (444 unit/integration, 6 doc
  libraries), **7,318 passed, 0 unresolved failed, 47 ignored**. Counts replace
  initial repaired cases and avoid counting focused reruns twice. This covers
  all seven workspace crates, exceeding the five requested.
- Fresh client/Expo pack from **0bf50ac186** passed installed qualify-linux
  **--consumer-only**, exit **0**, including **Ubuntu 24.04 and Alpine**,
  all six starter variants, adapted historical templates, all generated
  frontend proofs, production, security-policy, migrations and staging.
  Source and tarball identities stayed fixed through qualification.
  The full scripts/test.sh was expressly prohibited; consumer.json records
  suite not-run and **publicationQualified:false**, not a publication receipt.
- The installed DX6 hook passes the clock/session, numeric, composed-text,
  invocation/credential-cutoff and future-SQL regressions. All six old-CLI
  modes and requested actual wave-21 scripts pass: **025 80 checks**, **002
  8 users**. Supplementary packed qualification executes the literal guide
  CLI **22d --no-drain**, zero-time drain and helper **8d sessions:expire**.
- Final affected clients: **23 files, 384 tests, 383 passed, 0 failed,
  1 expected skip**. Full online/local models: **60/60**, **5,000 histories
  each**. Expanded group **329/329** overlaps these checks; counts are not summed.
- Final Mac: **106/106** confirmed `check` tests; remaining tests and remote
  cleanup unverified because the assigned host is unreachable (see below).
- Compact final evidence: snapback4/reports/20261022-dx6/verification.json,
  linux-consumer.json, packed-dx6-proof.json, packed-dx5-proof.json and
  cargo-workspace-completion.json.

The full workspace run reached its one-hour outer timeout during the device
unread-range target; remaining targets were resumed without repeating
completed scopes. Four initial failing targets (clock, committer ratchet,
historical starter and store-port ratchet) were repaired and passed targeted
reruns; no assertions/ratchet were weakened. The costly unchanged residency
case ran once in the full suite; redundant focused execution was interrupted
and retried with only that unchanged residency scope excluded. The remaining
full workspace run exposed stale guide budget/diagnostic/public-ReadState assertions; 3c39e40780
repairs them with no limit increase, all **16 executable fences unchanged**, and
the complete guide target passes **127/127**. A second bounded run stopped during
sim union; its two unfinished exhaustive cases passed on resume, followed by all
remaining targets/docs. Both timeout-owned process groups exited and exact-PID
scratch was cleaned. No full scripts/test.sh invocation was used.

## Decisions and limits

- Published old quiet CLIs capture migration stderr and cannot retroactively
  print it. Tests document that boundary rather than add process inspection.
  Ordinary old upgrades/new quiet helper deliver advice; original scripts work.
- Upgrade tests use a local metadata-only 0.4.38 alias of current tarballs so
  old CLIs observe a transition. Source versions/publication state do not change.
- Completed local tests own and clean their scratch/copies. Cargo outputs
  were cleaned after verification, reclaiming **30.2 GiB**. Final consumer
  installs/private cache were removed after qualification; compact evidence and
  fresh tarballs are retained. Mac cleanup cannot be confirmed while offline.
- No original evidence lane, sibling worktree, ~/projects/snapback,
  publication MacBook or credential file was changed. Mac work stays in
  ~/sb4-ws-dx6 on the assigned Mac Studio.


## Mac verification and remaining gap

The assigned Mac Studio accepted the final functional source archive; all
**6,105** manifest entries match source 0bf50ac186. Its final-source `check`
target passed **106/106**, then SSH disconnected during the clock target.
Earlier **165** native tests passed before the final repairs; those are not
claimed as final-source clock/init evidence.

The remaining final-source clock/init, maintenance, clock-store, ratchet and
23-file client results are unverified. At least **70** bounded SSH attempts,
longer IPv4/IPv6 attempts and same-node Tailscale checks could not recover the
connection. The peer reports offline. No other Mac was used.

The 20-minute root launch loop exited 255. A supervised resume controller has
an atomic ownership lock, a 5,400-second watchdog, source-manifest checks and
per-command process keepers; it records durable remote results. No status was
received, so a launch after a lost connection response and its remote cleanup
remain uncertain. No duplicate or inferred-process kill was performed. Recovery
inputs remain in ignored snapback4/reports/20261022-dx6/mac/; inspect only
~/sb4-ws-dx6/.dx6-r6-resume.lock, its recorded PID, resume status/log and exact
owned process identity before resuming or cleanup. The maintenance filter was
corrected to serve::maintenance::tests so a zero-test run cannot count as 14.

All DX6 item fixes are implemented; this assigned-host verification/cleanup gap
is the remaining deferral. All local monitoring and launch loops have ended;
no new remote job will be started after handoff. Final source and packed Linux
results are recorded separately.
