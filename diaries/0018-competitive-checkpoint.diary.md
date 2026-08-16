# Diary 0018: Convex competitive checkpoint

**Application:** owner-private AI chat checkpoint
**Started:** 2026-07-22
**Systems:** Snapback, React/Expo, Cloudflare, Convex comparator
**Related:** LLP 0074, LLP 0075, LLP 0076

## 2026-07-22 — protocol, packages, doctor, and first streamed-action slice

### What felt good

- The existing generated owner-pattern helpers made the conversation surface
  concise without hiding visibility: CRUD, unique lookup, and keyset paging all
  retain one explicit owner declaration and generate server-side filters and
  transactional guards.
- The action architecture already had the important late-effect machinery.
  Adding response streaming could reuse the detached worker, app-generation
  fence, service external-effect cut, nested mutation path, watchdog, and live
  fan-out instead of inventing a parallel execution model.
- The package publication staging code already separated source names from
  public registry aliases. Once the live `@snapback/cli` collision was found,
  the `@ccheever/snapback-*` preset produced a coherent seven-package closure.

### What felt bad or surprising

- `snapback doctor` had only proved that the binary could print help. The first
  real vertical run immediately found a macOS `/var` versus `/private/var`
  target-fencing bug, validating LLP 0074's insistence on a disposable runtime,
  bundle, query, mutation, and live-subscription check.
- A publication dry-run was not enough to test npm alias resolution. The cold
  install initially tried to fetch unpublished aliases from npm even though all
  tarballs were present. The proof needed a disposable loopback registry that
  served the exact staged names and manifests.
- Ibex's ordinary fetch buffers the response body. Snapback therefore needed a
  host-owned pull cursor rather than superficial client-side token reveal. The
  first implementation is intentionally a small reader subset, not a claim of
  complete Web Streams support.

### Snapback compared with React + Convex/Supabase

Convex already gives an action a browser-like streamed response and makes
hosted deployment the default path. Snapback required new runtime work before
the same AI pattern was expressible. In return, Snapback's existing action to
nested-mutation split made every progress update an ordinary authoritative
commit with the same authorization, receipts, and live-query behavior as the
rest of the app. Supabase can stream from an Edge Function, but coordinating
idempotent durable progress, cancellation state, and database subscriptions is
more application-authored.

The current result is still checkpoint work, not a competitive win: public npm
publication, the complete hosted control-plane profile, production identity,
the React/Expo fixture, and the two-arm timed rerun remain open.

## 2026-07-22 — React/Expo checkpoint and the second stream target

### What felt good

- The same generated function references now feed `useSnapbackQuery`, ordinary
  mutations, and actions directly. The checkpoint app no longer has a parallel
  handwritten string-name layer just to enter React.
- One component typechecked and exported through both Expo web and the iOS
  Hermes bundle. Connection and reply-settlement state stayed visible in the
  UI, and polling fallback stayed disabled.
- The bounded reader ported cleanly to the Cloudflare coordinator once the
  shared context bootstrap normalized synchronous Ibex calls and asynchronous
  Workerd service-binding calls. The deployed-engine regression now exercises
  an ordinary authored action, 16 KiB pulls, the 1 MiB refusal, and idempotent
  cancellation rather than testing coordinator helpers in isolation.

### What felt bad or surprising

- Metro cannot safely consume arbitrary source files outside its watched app
  root. A deterministic esbuild prebundle of the real client, React adapter,
  and generated API was necessary. This is acceptable as generated build
  output, but a published-package install will be appreciably cleaner.
- `ctx.fetchStream` initially assumed the Ibex host call was synchronous. The
  same source compiled for Workerd, but `streamOpen` was a Promise and failed at
  runtime. The portability witness was valuable precisely because syntax and
  the local acceptance could not expose that shape mismatch.
- Cloudflare remains a narrow adapter, not the frozen hosted profile. It has no
  production actor identity for the owner-private fixture, generic generated
  HostPlan execution, backup/restore drill, or complete deploy-control receipt.
  Treating the new stream boundary as gate-1 closure would be misleading.

### Snapback compared with React + Convex/Supabase

The React code is now close to the Convex shape: generated references enter
hooks and mutation calls directly, and streamed progress arrives through native
push. Convex still has the materially shorter hosted path because the identity,
deployment, logs, and data lifecycle are one supported product surface.
Supabase similarly supplies a managed public origin and production identity,
though more of the durable stream-progress protocol remains application code.

The remaining checkpoint blockers are external public-package publication and
a hosted target that satisfies the frozen owner-private profile without
target-specific semantic substitutions. The Cloudflare hypothesis should be
recorded as reprioritized unless those missing profile facts are implemented;
the local and Cloudflare stream witnesses remain useful capability progress.

## 2026-07-22 — immutable release boundary

### What felt good

- The generated artifact set was already a coherent release input. The new
  command could verify schema/function/capability agreement and retain the
  exact generated closure without inventing a second compiler pipeline.
- Making the release activation-ineligible by construction turned LLP 0072's
  missing hosted work into machine facts. The checkpoint release names the
  adapter, runtime, TLS, logs, inspection, rollback, backup/restore, migration,
  probe, signing, provenance, and SBOM gaps instead of producing an optimistic
  “build succeeded” deployment claim.
- The packaged CLI test caught dirty-source, forbidden dotenv input, immutable
  reuse, and post-build tampering in a small external Git fixture. The same
  builder retained 59 backend/web/meta components for the competitive app.

### What felt bad or surprising

- Canonical source paths on macOS mattered again: `/var` and `/private/var`
  initially made an in-project web tree look like an escape. Release input
  fencing now canonicalizes existing directories before containment checks.
- A default `.snapback/releases` store would have marked its own second build
  dirty if generated output were treated as source. The source identity now
  excludes only the exact declared output tree and separately refuses any
  overlap between that tree and backend/web inputs.
- The first CLI result accidentally exposed the verifier's schema version
  rather than the build command's result version. Executing the real checkpoint
  command, not just inspecting the manifest, caught the envelope bug.

### Snapback compared with React + Convex/Supabase

Convex and Supabase still win the ordinary hosted transition because build,
provider identity, public origin, logs, and data lifecycle are integrated
services. Snapback now has a stronger locally inspectable handoff artifact: its
source posture, generated contract, target requirements, every shipped byte,
and every missing control-plane proof share one content identity. That is a
useful portability and trust advantage only after an adapter completes the
drills; today it is honest groundwork rather than deployment parity.

## 2026-07-22 — exact target registration and deploy planning

### What felt good

- Treating a provider adapter as a digest-pinned executable with one closed
  stdin/stdout exchange made the authority boundary unusually easy to test. A
  fixture proved that target data never appeared in argv, an ambient npm token
  was scrubbed, and a successful process still failed when it named the wrong
  provider account.
- Exact project, target, environment, deployment, database, stream, profile,
  origin, activation generation, and release identities now survive from an
  owner-only descriptor into one content-addressed plan. Repeating the same
  read-only operation reused identical bytes instead of inventing a new plan.
- Building the apply command as a refusal boundary first made the current state
  legible: a confirmation token cannot waive GAPs, expiry, or stale provider
  state, and no mutating adapter method exists to call accidentally.

### What felt bad or surprising

- The target-neutral release still describes the local capability profile, so
  there is no honest `trusted-single-tenant-app-complete.v1` release to feed the
  selected adapter. The planner correctly refuses a profile substitution; the
  release augmentation/evidence step is now the immediate architectural gap.
- macOS temporary paths again exposed the distinction between an absolute path
  and a canonical path (`/var` versus `/private/var`). Requiring canonical
  driver paths is the safer contract, but fixture setup must resolve them.
- A driver can truthfully inspect identity without possessing the much larger
  upload, backup, migration, activation, health, rollback, log, and restore
  protocol. Keeping apply hard-blocked avoids turning that partial adapter into
  a deployment claim, but it also makes clear how much of the hosted product is
  still provider work rather than CLI polish.

### Snapback compared with React + Convex/Supabase

Convex and Supabase hide most target identity and activation machinery behind
their service control planes. Snapback's explicit descriptor and plan expose
more reviewable provider and data authority than either ordinary workflow, and
cross-account read-back is a strong safety property. It is not yet competitive
for first-hour deployment: the user still needs a concrete provider adapter,
external credential and state stores, and executable lifecycle receipts before
one URL exists.

## 2026-07-22 — lifecycle protocol, interruption resume, and rollback

### What felt good

- Once the plan carried an ordered lifecycle, the adapter boundary stayed
  small: one closed stdin request and one digest-bound stdout response per
  step. Adding upload, inactive provision, compatibility preflight, backup,
  staging, activation, served-path verification, rollback, and lease release
  did not widen argv or environment authority.
- Writing the journal after every successful adapter response made restart
  behavior concrete. The harness interrupts after compatibility preflight,
  starts a second apply attempt with the same operation id, receives four
  idempotent replays, and completes the remaining steps without a second
  activation.
- The served-path failure fixture activates, refuses verification, rolls back
  to the previous release, releases its lease, and leaves a hash-chained failure
  receipt. The backup manifest is independently content-addressed, owner-only,
  and requires explicit application-secret and control-credential exclusions.

### What felt bad or surprising

- The adapter can execute a complete normalized train while the ordinary
  release remains correctly ineligible. This exposed the next missing layer:
  a hosted capability/prepared-release authority that supplies runtime,
  signature, provenance, SBOM, migration, probe, auth, TLS, log, inspection,
  rollback-drill, and restore-drill evidence without deleting GAPs by hand.
- Remote evidence needs to be a protocol fact, not a property inferred from a
  provider-looking name. The lifecycle response now carries `remoteEvidence`,
  and production requires a verified remote-provider attestation on every
  step. The fixture is allowed to run only through an unexported harness token
  and its receipt retains a blocking non-remote GAP.
- Automatic rollback itself has failure modes. The journal and returned error
  retain a rollback failure code and final receipt, but a concrete provider
  must still prove lease expiry, process death, network ambiguity, and restart
  behavior remotely.

### Snapback compared with React + Convex/Supabase

The explicit plan/journal/receipt chain is more reviewable than the usual
hosted CLI progress stream, especially around ambiguous interruption and
rollback. Convex and Supabase still own the decisive advantage: their control
planes already produce real provider authority and a working URL. Snapback's
deterministic proof is now useful protocol evidence, but deliberately not a
hosted-deployment result.

## 2026-07-22 — qualification and prepared-release authority

- A generic `activationEligible` callback was too much authority: tests needed
  it for the deterministic lifecycle, but production code could not be allowed
  to treat the same injection as hosted proof. Production now requires two
  content-addressed Rust-owned artifacts instead: a target-specific adapter
  qualification and a release-specific preparation manifest.
- Enumerating the qualification claims exposed the real remaining product
  surface cleanly—TLS/auth, logs/inspection, rollback, destructive restore,
  interruption, scans, and cost/capacity. Enumerating prepared-release evidence
  did the same for runtime/server bytes, signing, SBOM/provenance,
  compatibility generations, migrations, probes, and config.
- The verifier deliberately requires the exact complete target profile in the
  base release. Since codegen cannot emit that profile yet, even syntactically
  perfect evidence files cannot make an ordinary local-profile release
  eligible. That friction is useful: it prevents the adapter layer from
  laundering local semantics into the hosted claim.

## 2026-07-22 — rollback, destructive restore, logs, and inspection

### What felt good

- Separating code-only rollback from restore made the data contract much
  clearer. Rollback consumes a prepared compatible release and switches only
  code/traffic; restore consumes an immutable backup, remains inactive, and
  cannot serve until a second plan and confirmation.
- The replacement sentinel turned “nonempty destination” from a vague operator
  judgment into a stale-plan fence. The restore harness proves an empty preview
  destination, effect fencing, component/application verification, a retained
  paused receipt, fresh activation inspection, and a second generation change.
- A separate adapter query protocol kept logs and privileged inspection out of
  public target inspection. Closed scalar log payloads made private body,
  credential, query-argument, and result classes rejectable before they reach a
  terminal or retained receipt.

### What felt bad or surprising

- A backup manifest alone is not enough for recovery: source and destination
  descriptors, destination emptiness/replacement proof, worker-effect fencing,
  application sentinel, log health, and a separately acknowledged activation
  are all independent authorities. The CLI surface grew because hiding those
  steps would erase real destructive boundaries.
- The deterministic adapter can now mimic the entire normalized recovery train,
  which makes the evidence distinction even more important. Production paths
  still reject every fixture query or lifecycle response at
  `remoteEvidence: false`; no remote object was restored and no public URL was
  tested.
- Hosted auth remains orthogonal and larger than target registration. The
  complete profile still needs sender-constrained browser credentials plus a
  target-authenticated admission and live-health producer; none of the new
  lifecycle receipts can substitute for those mechanisms.

### Snapback compared with React + Convex/Supabase

Convex and Supabase offer much shorter recovery and log workflows because their
managed control planes already own provider identity. Snapback's current
surface is more explicit and reviewable around data rewind, stale destinations,
effect fencing, and log redaction, but it is not yet easier: until a concrete
adapter produces remote attestations, users receive protocol machinery rather
than a hosted recovery product.

## 2026-07-22 — standalone backup and mandatory control audit

### What felt good

- Giving backup its own plan made “take a recovery point now” a first-class
  operation instead of an accidental side effect of deploy. The same
  target/generation/lease machinery applied cleanly, and the plan can now prove
  the requested retention class was not substituted by the adapter.
- The deterministic drill verifies a useful non-change invariant: backup
  creation returns a read-back-attested manifest while active release and
  activation generation stay exactly fixed.
- Modeling audit events in Rust kept the retained payload closed. A full-chain
  verifier made predecessor loss, filename substitution, unsafe permissions,
  and content changes concrete failures instead of best-effort logging.

### What felt bad or surprising

- Mandatory audit is cross-cutting. Once backup writes were protected, deploy,
  rollback, restore, activation, log/inspection, and verification paths all had
  to use the same lane or the safety claim would be misleading.
- A local hash chain is useful but not independent. The operator owns both the
  control action and the files, so calling it tamper-proof would overstate the
  evidence. The complete provider profile still needs external retention or
  checkpoint authority.
- Fail-closed behavior needs an operator recovery story. The current exclusive
  append lock deliberately refuses privileged work if left behind; a concrete
  adapter must add coded inspection and reviewed recovery without creating a
  “delete the audit lock/history” escape hatch.

### Snapback compared with React + Convex/Supabase

Managed platforms make backup and audit look much smaller because provider
identity, durable intake, and retention live behind their service boundary.
Snapback now exposes a more reviewable local plan and chain, but it remains more
operationally demanding and has no remote durability claim until the selected
single-instance adapter runs these same contracts against a real provider.

## 2026-07-22 — hosted-auth qualification stops accepting labels

- The generic `hostedAuth` qualification claim was too coarse. A remote-looking
  evidence URI said nothing about sender-constrained browser custody,
  admission freshness, operator-origin isolation, handler compatibility, or
  live limiter/invalidation authority.
- Embedding an executed drill receipt made those independent gates visible and
  kept the qualification honest. The support digest includes the exact browser
  artifact and direct-bearer seam, while live health must name the same
  admission epoch.
- This deliberately made the next gap sharper rather than smaller: the fixture
  can validate the closed shape, but Snapback still needs the actual
  sender-constrained client/runtime and provider-authenticated producer before
  a real adapter can mint the receipt.

## 2026-07-22 — sender-proof core

- A live WebCrypto-to-Rust vector was more useful than parallel unit fixtures:
  it immediately proves that browser `subtle.sign` and Ring agree on the
  64-byte ES256 signature representation and exact protocol bytes.
- Keeping the proof builder out of package exports matters. Exporting a helper
  that accepts an arbitrary bearer would recreate the direct-bearer seam the
  hosted admission is supposed to exclude.
- A separate family-binding table lets local bearer-v1 rows remain untouched
  and makes v1-to-v2 migration deletion-only. The replay table is durable and
  bounded, but its SQLite authority is honest only for the selected
  single-process profile.
- The protocol is not review-complete. This authoring session cannot count as
  an independent LLP reviewer, so no review artifact or positive capability
  was manufactured.

## 2026-07-22 — atomic sender nonce authority

- Making nonce retirement a separate write from replay consumption would have
  left an avoidable crash/race seam. The single-instance profile can use one
  SQLite immediate transaction to consume the proof id, retire the exact
  admission/family nonce generation, and install its successor.
- The nonce table is created only by the authenticated hosted-preflight path,
  alongside replay and family binding. Request verification still has no DDL
  authority, and missing tables fail closed.
- Bounded nonce and replay capacity are product behavior, not tuning trivia.
  The tests prove stale generation refusal, replay rollback without nonce
  rotation, expiry pruning, and unavailable-before-preflight behavior.
- This is still protocol-core evidence. There is no HTTP challenge header,
  IndexedDB coordinator integration, or public-origin drill yet, so it would
  be misleading to count this as hosted auth progress visible to an app.
- Composing token-family lookup, challenge issuance, proof verification, and
  atomic consume/rotate into one redacted pre-body function exposed the next
  exact seam cleanly: serving middleware still needs provider-authenticated
  canonical URI/admission facts before it may call this function. Accepting a
  caller-supplied forwarded URI there would undo the proof binding.

## 2026-07-22 — IndexedDB key custody proof

- Browser IndexedDB really does structured-clone a non-extractable P-256
  private `CryptoKey`. Reopening the database and signing a proof with the
  restored handle worked in the same executable test.
- Checking only `extractable: false` would be weak: the record also imports the
  exact stored public JWK, signs a fixed local self-check with the private
  handle, verifies it with that public key, and recomputes the RFC 7638
  thumbprint before returning custody.
- IndexedDB transactions cannot remain active across asynchronous WebCrypto
  validation. The storage path therefore validates the complete proposed row
  before opening its write transaction, then rechecks the exact custody
  revision inside the transaction before CAS. The first test run caught this
  browser transaction-lifetime constraint immediately.
- A separate sender side record initially looked simple, but it created an
  authority-transition crash gap: bearer clearing and key installation could
  disagree after recovery. Folding sender state into closed `AuthCustodyV3`
  made the existing transition intent and barrier the sole state machine.
- The conformance test now crashes after publishing a v3 clearing record,
  recovers that exact pending bearer/key in a new coordinator, rotates bearer
  and nonce behind both revision and sender-generation fences, and proves
  logout removes the key and downgrades to anonymous v2.

## 2026-07-22 — Real pre-body HTTP challenge

- The registered route gate already had the exact cut we needed: managed
  admission is acquired before the body guard, JSON peek, and session
  projection. Installing sender admission there avoided another middleware
  ordering system.
- Nonce rotation made ordinary early returns subtle. A proof can be consumed
  successfully and then fail on JSON shape, policy, or handler preparation.
  A shared one-write response-header cell now carries the installed successor
  through every return path instead of asking dozens of branches to remember
  it.
- A body whose `poll_frame` panics is useful executable evidence: both the
  missing-proof challenge and duplicate-proof refusal complete without
  touching attacker-controlled bytes.
- Canonical public origin is now a target-authenticated value. The proof target
  ignores query and never consults `Forwarded`, `X-Forwarded-*`, or `Host`.
  The production adapter still cannot construct that authority, so the test is
  protocol integration evidence rather than hosted readiness.

## 2026-07-22 — Sender-constrained browser train and WebSocket

- Issuance needed a distinct proof payload rather than pretending the
  not-yet-issued bearer existed. Binding the verified key, issuance proof id,
  session family, and initial nonce inside the provider's existing SQLite
  transaction kept credential publication behind one atomic cut.
- The coordinator resume barrier exposed a useful subtlety: the transport
  participant may legitimately rotate a same-authority nonce while publication
  remains closed. Later participants and the final durable confirmation adopt
  only that locally witnessed exact revision; an unobserved peer write still
  fails.
- Exercising an ordinary query after login caught more than an issuance-only
  test could. Each forced session projection and resource request advances the
  same custody generation, and a simulated lost-response challenge advances it
  once before the single retry. Refresh then replaces bearer and nonce in one
  compare-and-rotate write.
- Browser WebSockets cannot set `DPoP` and cannot read the 101 response headers.
  The upgrade therefore carries the compact proof in a dedicated subprotocol,
  while the negotiated application protocol remains `snapback.v1`. The server
  binds the connection grant to the family thumbprint and admission epoch
  captured by protected connection-open, then verifies a fresh proof over the
  grant token before switching protocols.
- A real bound-server test now runs request-code, exchange, authenticated
  session, refresh, protected connection-open, and WebSocket upgrade. The
  successor nonce on the 101 is intentionally not assumed readable by browser
  code: reconnect first forces protected session projection and uses the
  bounded nonce-challenge recovery path.
- This closes the local composition gap, not the hosted claim. A concrete
  adapter must still authenticate the origin/admission facts and pass the
  negative, pressure, review, and remote drill corpus.

## 2026-07-24 — Candidate metric and statistics instruments

- I implemented one raw, ordered event ledger as the source of elapsed time,
  command counts, agent usage, interventions, retries, skips, failures, and
  credential repairs. Deriving all reported metrics from that ledger is much
  easier to audit than allowing each runner to report precomputed totals.
- Decimal-string monotonic nanoseconds preserve exact event boundaries across
  JSON and JavaScript. Strict sequence and timestamp checks also make clock
  regressions, duplicate milestones, and incomplete commands fail before they
  can affect a score.
- The statistics candidate fixes median and nearest-rank p95 behavior and uses
  deterministic independent-arm bootstrap resampling. Independent resampling
  matters because alternated execution order does not make the two products
  paired observations.
- The awkward part was authority, not code: these choices can change the
  checkpoint outcome, so implementing and digest-locking them cannot silently
  resolve LLP 0075's preregistration prerequisites. The lock is explicitly
  candidate and unratified; no timed sample is authorized by this work.
- Compared with a typical Convex-versus-Snapback demo, this adds measurement
  ceremony but applies it symmetrically. It improves confidence in the eventual
  comparison rather than the Snapback product score.
- Translating the prose into a complete gate matrix made one earlier miss
  impossible to repeat: cross-user delete is now its own required gate for
  both arms. Provider-native lifecycle mechanisms remain admissible, but every
  arm still needs a retained witness for the same required fact; an absent row
  is a failure and `not-applicable` is forbidden unless prospectively listed.
- The capsule verifier separates mechanism from decision. It can now prove
  exact prompt, scaffold, harness, package, machine, network, provider,
  credential-precondition, agent, and documentation bytes and refuse an
  unratified envelope. It cannot choose those facts, so the code is correctly
  recorded as a verifier contract rather than a completed run capsule.
- The scoring engine closes the arithmetic discretion without pretending to
  close the judgment discretion. Margins, zero floors, confidence totals, and
  outcome precedence are executable; the anchor prose remains absent because
  this implementation session has already seen one arm's evidence and is not
  eligible to author pre-evidence anchors.
- This did not expose a Snapback Guide gap. It is checkpoint-instrument design,
  while the hosted adapter, provider credentials, public npm publication, run
  capsule, gate matrix, and rubric anchors remain separate open prerequisites.

## 2026-07-24 — Shared hosted-auth admission before proof

### What felt good

- The trusted-single-instance topology made SQLite a legitimate shared
  limiter authority instead of a test substitute. One immediate transaction
  could advance global, source, subject, source-by-subject, and family buckets
  together, including on denial, using the same durable failure boundary as
  the sender replay authority.
- Wiring the listener's peer address into requests removed a hidden
  process-only assumption. Served tests can now demonstrate that two sources
  converge on one subject bucket and that anonymous connection opens still
  consume global/source capacity.
- Putting challenge/exchange JSON inspection in the policy gate caught a real
  omission: without that explicit route set, those public provider routes
  reached the handler without exposing their normalized subject to D3.

### What felt bad or surprising

- “Before proof” spans more routes than the sender-proof function itself.
  Challenge request and exchange, anonymous connection open, malformed bearer
  attempts, and sender-bound grant use each need the same admission authority
  even though only some carry a session proof.
- Denial accounting needs a finite debt cap. Charge-on-denial is necessary to
  stop an exhausted subject from becoming a free spray lane, but unbounded
  future theoretical-arrival timestamps would let an attacker grow integer
  state forever.
- The implementation is intentionally topology-scoped. SQLite satisfies the
  contract only while the container/VM is the one serialized serving
  instance; carrying this code into a multi-replica adapter would not make its
  limiter shared.

### Snapback compared with React + Convex/Supabase

Convex and Supabase hide most abuse-control topology behind their managed
edges. Snapback now has a more inspectable, target-attested admission policy
for the selected single-instance profile, including exact rates, bursts,
retention, capacity, and epoch. That explicitness is useful for portability
and audit, but it adds adapter work and remains behind managed products until
the complete hosted drill and public package path are operational.

## 2026-07-24 — Grant-wide sender proof and browser flight serialization

- Generating the grant-route matrix from the server registry was materially
  better than maintaining a hand-written representative list. It found and
  now guards all ten HTTP grant routes plus the browser WebSocket carrier
  against missing, malformed, wrong-token, replayed, and unavailable-authority
  proofs before any request body is polled.
- The client had to treat the connection grant as the credential actually
  being exercised. Removing the unrelated session `Authorization` header and
  hashing the grant token into `ath` made the transport match the server's
  carrier-neutral rule instead of relying on a WebSocket-only special case.
- Cross-tab serialization needed a namespace separate from custody ownership.
  Holding the custody lease over the network would deadlock the successor
  nonce compare-and-swap; a distinct Web Lock or renewed/fenced lease lets the
  network callback commit custody while still allowing only one proof flight.
- Browser WebSocket 101 headers remain intentionally unobservable. Holding the
  flight through open/error/pre-open close or the freshness budget, then
  challenge-resynchronizing the next HTTP request, is simpler and safer than
  guessing that the locally held nonce survived the upgrade.
- A successful response without a successor nonce cannot honestly be reported
  as an ordinary failure: the effect may already have committed. The hosted
  client now exposes a typed, non-retryable indeterminate outcome and the test
  proves a mutation is applied exactly once before normal recovery.
- This closes three LLP 0077 implementation defects, but it does not complete
  the hosted profile. The versioned grant schema, rollback-resistant sender
  epoch, logout-lost-response recovery, adapter qualification, public npm
  publication, and LLP 0075 prerequisites remain open.

## 2026-07-24 — Reproducing the complete local streaming witness

- Re-running the real six-case acceptance slice was more valuable than trusting
  the green unit suites. It exposed a worktree regression where the harness had
  lost served-target derivation and the cross-user delete refusal even though
  the status artifact still claimed both.
- Restoring those checks made the instrument self-auditing again: the receipt
  derives `local-dev-sqlite-ibex` from `/inspect`, pins the served capability
  manifest digest, and records list, lookup, pagination, update, and delete
  denial for the second principal. After rebasing onto LLP 0065's accepted
  existence-secrecy behavior, the mutation witness also had to assert the
  public `SNAPBACK_ROW_NOT_FOUND` collapse rather than the older internal
  `SNAPBACK_ROW_NOT_VISIBLE` code.
- The current runtime passed the full streamed path: sixteen chunks produced
  eight distinct authoritative native-push progress commits; cancellation
  admitted no late patch; idempotent start retry reused the same assistant;
  idle input settled `timed_out`; and an unkeyed POST transport loss remained
  `ambiguous`.
- Compared with a typical React plus Convex demo, the explicit receipt and
  transport attribution add ceremony, but they also prevent a rendered token
  animation from masquerading as backend streaming evidence.
- This closes the local reproduction defect only for the current uncommitted
  tree. It does not publish packages, qualify a remote adapter, ratify protocol
  v0.4, or authorize the timed comparison.

## 2026-07-24 — Clean-checkout package and surface closure

- The first draft-PR surface build exposed an important source-versus-release
  distinction: repository manifests still need `workspace:*` so demos can
  bundle package source in a clean checkout, while publication staging rewrites
  those edges to exact release versions inside the immutable tarballs. The
  shared required-surface gate now performs one frozen root-workspace install
  before applying each surface's independent frozen Exact registry lock, and
  the older All Aboard cold-clone lane performs the same workspace preparation
  before its direct surface build.
- The cold-install proof then found that the upstream effect-ceiling module was
  imported by codegen but absent from its explicit package file closure.
  Adding it to `files` made the package match the production import graph.
- Adding the Linux workflow also required extending the repository's closed CI
  inventory and reviewed action counts. The lane itself passed on its first
  complete run; the broader proof correctly refused the unreviewed workflow
  until that meta-gate named and inspected it.
- The canonical proof had one more clean-runner ordering dependency: its Exact
  compiler type test ran before the required-surface gate installed the
  surface's frozen registry tree. Moving that test immediately after the
  shared install/build gate removed the accidental reliance on a developer's
  existing `node_modules`.
- This was a useful advantage over checking only an application already inside
  the monorepo: the required-surface lane caught source resolution, and the
  external tarball install independently caught release closure.

## 2026-07-25 — Maintained projection (conversation cards)

Added the first `defineMaintainedProjection` use: `conversation-cards` joins
each owner's conversations (left) to the public `models` dimension into a
`conversationCards` output table, maintained inside every source mutation's
commit.

What felt good: the authoring surface is the relational-query shape plus four
honest declarations (output table, output key, reverse index, fan-out), and
every refusal I hit during authoring (missing reverse index, undisclosed shared
fan-out) named the rule and the fix. The acceptance check needed no polling or
flushing—the card is simply there in the same commit as
`createConversation`, and `registerModel` fanned out to it synchronously; that
is a materially better experience than eventual-consistency materialized views
(Convex components or a Supabase trigger+view pair), where the test has to wait
or retry.

Friction: the output table must be declared by hand in the schema with fields
matching the projection leaves—codegen validates the match but cannot yet
derive the table; and `defineMutation` takes `plan:` (a single step or array),
not `steps:`. The error surfaced as a sandbox strict-JSON refusal rather than a
spec-shape message, which cost a bisection. Filed nothing: the ticket already
tracks surface polish.

## 2026-08-03 — Exact vector search on the independent Fly carrier

### What felt good

- The same ignored release-mode test executable that qualified the local
  SQLite adapter traveled into the Linux image without repository files at
  runtime. One exact invocation re-ran the four semantic acceptance checks,
  filled the D=1,536 partition to 43,690 vectors, proved the next-insert bound,
  and emitted a closed JSON receipt. That made the remote run a genuine adapter
  qualification rather than a hand-timed query.
- The product/source boundary stayed inspectable. The image label, staged
  source revision, server/test/runtime checksums, Hermes provenance, concrete
  Fly Machine identity, temporary VM shape, and semantic nonclaims are all
  independent facts. The result could say “local SQLite exact scan inside a
  Linux container/VM” without pretending Fly became a hosted vector target.
- The 12 GiB acceptance ceiling left useful headroom while the observed Linux
  peak was 1.93 GiB. The ordinary 512 MiB service shape could be restored as
  soon as the qualification finished; no production sizing claim leaked from
  the temporary test shape.

### What felt bad or surprising

- The runbook's paved Hermes-release download did not exist for the current
  vendored identity. The old ignored artifact was stale enough to fail the
  provenance check, which is the right failure, but rebuilding the exact patch
  stack consumed most of the carrier work. The gap is now tracked in
  `issues/20260803-linux-hermes-release-carrier-gap.md`.
- Fly's default Depot builder was killed while optimizing the Snapback release
  library. Building the exact release on a high-memory Linux host and letting a
  tiny Dockerfile verify and assemble the closure worked, but it adds a second
  carrier path that needs automation.
- Fly preserved the existing encrypted volume on the Machine, but the app
  config did not name its mount. The first deploy correctly refused to proceed
  non-interactively. Adding the recorded `caddy_storage` → `/data/caddy` mount
  made the replacement explicit and prevented a qualification-only deploy from
  discarding certificate custody.
- The receipt was printed before the Machine resize-back restarted the VM, but
  its `/tmp` copy did not survive that restart. The attached test output was
  complete and retained byte-for-byte; a future harness should copy receipts to
  a durable path or retrieve them before any resize.

### Snapback compared with Convex or Supabase vector search

Supabase/pgvector and hosted vector products make provisioning and index
acceleration easier, while this exact local profile pays visibly for a full
scan: the filled shared-CPU query took 4.953 seconds. Snapback's advantage in
this slice is contract precision rather than raw speed. Distance arithmetic,
conversion witnesses, authorization partitions, mutation atomicity, work
counters, corpus ceilings, and ANN/hosted nonclaims are all executable and
portable. That is unusually strong evidence for local-first behavior, but it
also makes the v1 boundary clear: an ANN successor or hosted target needs its
own capability and qualification instead of quietly replacing this result.

## 2026-08-16 — owner stamping and a declared opaque ceiling

The Phase 1a pass removed application-authored owner ids from message inserts;
the host now stamps that slice. Five module mutations also had to state their
existing closed conservative write ceiling because their patch shapes cannot
be enumerated statically. That declaration grants nothing—the runtime owner
checks remain authoritative—but it makes the uncertainty reviewable instead
of pretending codegen saw exact sites. The remaining public model write is
projected as migration-pending and carries no capability claim.
