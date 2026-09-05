# Panel synthesis: LLP 1016 — The administrative plane

**Type:** Review synthesis (orchestrator's; not a review)
**Date:** 2026-09-05
**Panel:** codex `gpt-6-astra` (xhigh requested; effort not exposed by the model), Muse Spark (`muse-spark`, ultra), grok-4.6 (xhigh requested; the model self-reported high). Round 1 mutually blind on `1016-administrative-plane.panel.brief.md`; round 2 a cross-read of all three reviews plus the orchestrator's verification notes, on `1016-administrative-plane.panel.brief-r2.md`.
**Reviewed:** `llp/1016-administrative-plane.rfc.md` at `6d3d09c6f`.
**Orchestrator:** Claude Fable 5.1 — the session that authored LLP 1016; it did not vote. Every `path:line` below was checked against the tree at `6d3d09c6f` before this synthesis was written.
**Related:** `1016-administrative-plane.{astra,muse,grok}.md` (round 1 and round 2, verbatim), LLP 1016, LLP 1015 (one finding here is for it), LLP 1001 §4, LLP 1012 §5, LLP 0329.014.004 §6.

## 1. The author's question, answered

**Are the panelists happy with this RFC, or should the design go in a
different direction?**

Three of three: **the direction is right and the RFC is not ready.** No
panelist chose `DIFFERENT DIRECTION`; each was asked to argue for one and
each argued against every alternative on the record:

- *An unbounded operator mode* (Quarry or SQL without the certificate,
  behind a fence): all three refused it. It spends the property that makes
  constraints, invalidation, and receipts trustworthy (`certificate.rs:20-40`,
  "no write path exists outside the language"), and grok's line is the
  memorable one: it "is cheaper only until the first admin `DELETE` against
  a live query."
- *A product boundary* (host cron, an external worker through named
  mutations): all three refused it as Snapback 1's hosted-lifecycle shape
  (LLP 1014 §3.3, the seventeen refusing verbs), and astra and grok both
  noted it would put the benchmark's own M5 expiry and M8 digest outside
  the product.
- *A smaller RFC*: **this is what all three want**, and they converged on
  the same kernel independently: resumable chunked jobs, row-triggered
  timers, and narrowing admission; with the derived erasure program and
  the `enqueue` continuation deferred or reshaped.

What all three named as the thing to keep: the transaction/task split as
the actual answer to the 2026-09-05 paragraph; one language and no admin
DSL, raw write path, jobs framework, or cron service; the cursor committed
with the chunk; park on refusal, cancel at a boundary, a job that does not
claim to be a transaction; `check` before `run`, `--plan` then `--dry-run`
then `--wait`, typed exits, ledgered operator actions; `merge` at read
versus per-recipient durable rows; the honest non-claim on GDPR.

## 2. What every panelist found, verified

**U1. D2's authority proof is neither sound nor complete as worded, and it
proves the wrong half.** Three of three. The rule algebra is `Public |
Allow | Deny | Eq | Ne | And | Or | Not | Exists | Created` over `Field |
OldField | NextField | Viewer | Literal` (`snapback2-core/src/schema.rs`),
and `system` lowers to `Eq(Viewer, Literal(Id(systemPrincipalId)))`
(`packages/compiler/src/lower/schema.ts:364-365`). "Has a `system`
disjunct" admits `system and exists …` (runtime `E_RULE`) and refuses `not
deny`. Astra's sharper half: **reads are rule-filtered for the system
principal too** — the orchestrator found no system-read exemption anywhere
in `engine/runner.rs`, `runner_ops.rs`, `visibility.rs`, or
`certificate_policy.rs`; `is_system` (`engine/mod.rs:559`) only chooses the
commit kind. A uniformly-false hoisted rule halts the scan as exhausted and
empty (`runner.rs:1099`). So a job granted *write* authority on `messages`
still scans **zero** rows through `read <- exists memberships[.conversationId,
viewer]` (`templates/chat/snapback/schema.q:68`) and finishes green having
touched nothing. The design RFC already says system programs compute "under
system visibility" (LLP 0329.014.004 §5); the engine does not implement it,
and `then` mutations run under the rules today (LLP 1003 §2).

*The remedy splits* (§4 D1 below). *A cross-RFC consequence*: LLP 1015 D10
("`data --env production` … act[s] as the reserved system principal") also
assumes system reads are total. On the engine as it stands, an `admin`
token reading production would see nothing on any membership-gated table.
That is a finding for LLP 1015, recorded here.

**U2. D6's derived erasure cannot run on the template it uses as its
example, and the three words do not derive the closure they claim.** Three
of three. `profiles` has `unique byPrincipal: principal` and `immutable
principal` (`schema.q:3-17`); `memberships` and `follows` have unique
composite indexes over `principal`. `Immutable` fires on every update and
`Unique` on every non-delete (`runner_ops.rs:455-467`), and engine-owned
writes are exempt from rules but never from constraints (`runner_ops.rs:295-297`),
which D6 itself restates. Scrubbing `profiles.principal` to `erased` is
therefore refused by `immutable`, and the second erased user on any unique
principal index collides. Beyond that, all three listed what the derivation
does not see: `ref` columns are ids, not `principal` columns; ids inside
`json` and `[type]` columns; maintained aggregates over scrubbed rows;
`_grants` and replay custody tables (`store.rs:219`); `_outbox` rows have
no principal field (`store.rs:182`); login recreates a session from
surviving credentials (`identity.rs:212`) so fencing sessions first does
not stop recreation. Astra adds the device half: a scrubbed row that is
*hidden* to a departed recipient is never observed (a hidden point read
ships no candidate evidence, `runner.rs:966`), so `delivered-history`
keeps the old content — D6's "a departed recipient keeps a scrubbed shell"
is false; and deleting the delivery row can remove the path that would
have obtained the absence. All three prefer the same reshaping: **an
authored erasure job with a `check`-verified coverage list**, per-subject
tombstones rather than one collision-prone `erased` identity, an
"erasing" state committed first that disables authentication, and
refuse-until-covered. Muse and astra: never delete from `_commits`; the
ledger is trimmed to 10,000 anyway (`engine/mod.rs:1381-1385`) and deleting
it removes what `trace` attributes.

**U3. D8's continuation is not needed by the bars and changes message
semantics.** Three of three. The template refuses a fifty-first member
through a maintained count (`groups.q:16`, `GROUP_FULL`); M3 is "2–50
members" (`social-messenger.md:489`); the celebrity fixture is a
read-side decision the brief names as such (`:140-147`), and LLP 1010 A5's
`merge` is the paved form. The runtime half of the RFC's "silent fifty" is
real — a mutation commits regardless of a `Limit` stop (`engine/mod.rs:708`)
— but the template cannot reach it. Astra and grok both listed what a
deferred fan-out has to answer that the RFC does not: membership removed or
re-added mid-run, unsend before delivery, delivery time stamped per chunk,
ordering across sends. Grok's B1 adds the starvation half: on one writer
thread with "only when idle", a busy group never delivers. All three:
**defer `enqueue`; do not rewrite `send`**; keep the concept with its reopen
condition.

**U4. D1/D3's driver is right in shape and under-specified in four places.**
(a) The `_jobs` cursor update in the chunk transaction is an engine write
the certificate must carry, like `Emit`'s `_outbox` write
(`runner_ops.rs:363-374`); D1 claims "every chunk is an ordinary program"
and "exactly-once" at once (muse B3, grok minor). (b) The cursor is stable
only on an index over immutable columns: an ordinary update reindexes the
row (`runner_ops.rs:126`), so another mutation can move an unvisited row
behind the cursor; `byId` is the only always-stable choice (astra B2). (c)
A stage that inserts into its own chunk table never exhausts, and the
design RFC's kind was defined over *sealed inputs* with a `commitSeq`
watermark (LLP 0329.014.004 §6; grok M3). (d) Program identity is not
generation identity (`registry.rs:93`, hash from the schema), so a
successor that changes the job's body but not the schema passes D3's
compatibility test and resumes a mixed task (astra B2): bind the executable
digest, stage identity, and arguments; park on any change. Also unanimous:
"client actions first, only when idle" is starvation, not fairness
(`writer.rs:439-480` has an empty idle arm; `after_commit` reruns every
invalidated live query before returning, `writer.rs:1097-1133`), so the
latency unit is the write plus the reruns, the default chunk should start
at 50–100, and the policy should be bounded interleaving.

**U5. D5's narrowing is implementable but is not a `check`-time diagnostic.**
Three of three. `Optional(T) ≠ T` is `Drop::TypeChange` (`successor.rs:164-168`),
refused as destructive (`:196-198`) before the required-column walk (`:214-228`);
a new branch is needed across the admission paths. And project `check` is
static — `compile_once` opens no store (`snapback2/src/check.rs:393`) — so
`E_SUCCESSOR_NARROWING` can only be raised where the successor is applied
(the owner on `dev` watch, `deploy`), not by `check`. §3's transcript is
wrong on that point. Grok's M9 is the important corollary: **successors
already rebuild maintains over every source row** (`successor.rs:648-672`),
and the brief's M7 "backfilled field … message count" (`social-messenger.md:688-692`)
is that path, so M7 is not a job customer and the RFC should say so before
an agent writes a fill job that fights a maintain.

**U6. D7's row-triggered timer is right; job targets are not "one commit".**
Three of three on the shape (the writer already runs idle sweeps on
`recv_timeout`; `/control/clock` exists, `control.rs:154`). Firing a job can
only *enqueue* it (a job is many commits), so v1 targets are mutations, or
the RFC says "enqueue". Astra: define installation and backfill of a new
schedule, changed and deleted declarations, re-arm, same-`at` reuse, and
failed-timer recovery — a permanently settled rejection would leave expired
content served. On `every` the panel **splits three ways** (§4 D3).

**U7. D9's `--dry-run` on a snapshot is not isolated as written.** Astra;
verified. Owner startup spawns the effects runner (`owner.rs:218`) and the
asset sweep runs on the writer (`writer_assets.rs:57`); blob reclamation
reaches files shared with forks (`asset_gc.rs:16-22`). A rehearsal over a
copied store needs a rehearsal runtime: no outbound effects, no timers, no
sweeps, no shared-blob mutation, a pinned clock.

**U8. `--as system` cannot be a persona flag.** Grok and astra; verified.
`Actor::new` rejects the reserved id (`identity.rs:69-71`, `E_AUTH_RESERVED`)
and `Context::system` is private (`engine/mod.rs:57-71`). D4 needs a
purpose-specific entry point, like `execute_then`, and (astra) ad hoc
executable content must be persisted — a `source_hash` cannot resume a job
whose file is gone. `execute_adhoc` certifies with the `Checker` alone and
skips `Generation::certify`'s effect-target validation (`registry.rs:762`
vs `:405`).

**U9. The surface and the trade.** Three of three: no sixteenth verb; the
`fork` CLI adapter deletion is right (LLP 1007 §7 ruled it; ~13 lines,
`verbs.rs:242-254`) and LLP 1015 D1's route table must be amended in the
same lane — **but it does not pay for J0–J4**. The counterweight the panel
actually offers is cutting D8 and the derived D6 from v1. Grok: `--cancel`
and `--resume` are "a verb pretending to be flags." Muse: the `persona
create` redundancy should be cited precisely before anyone pays with it.

**U10. Minor, all verified.** §10 says four lanes and lists five; D9 says
"one flag" and adds six; D3 resumes parked jobs while §6.8 promises resume
after cancel; D11 says `deploy` tokens see "neither" while LLP 1015 D6
makes `deploy` a superset of `read`; the 4 MiB closure ceiling is omitted
from §0; `trace timer:<id>` has no route; `E_JOB_GENERATION` versus D3's
automatic re-certification needs one rule; `_commits.kind` widening is a
store-format change; LLP 1002's title still says "thirteen verbs"
(pre-existing); Clique Pay has settle and no close of books and should not
be cited as a job customer (the brief, not the RFC, did).

## 3. Findings one panelist made that the orchestrator verified and accepts

- **The brief's M8 digest requires schedule-driven emission with no
  connected client** (`social-messenger.md:757-760`, verbatim: "emission is
  driven by the schedule alone … lazy read-triggered evaluation cannot
  satisfy it"). Grok. This is the evidence the RFC's §9.1 lacked: `every`,
  or a persisted re-armed row, is what the bar needs; an external trigger
  is not fulfilment.
- **`or system` on a table rule is a confused-deputy grant.** Grok. Once
  `deliveries.insert` (`schema.q:87`, `exists memberships[.conversationId,
  viewer]`) gains `or system`, every system writer — every job, schedule,
  `then`, and operator — may insert arbitrary delivery rows. Astra adds
  that transition rules `(old, next)` encode policy that an appended
  disjunct erases.
- **Grok's alternative authority model: declared jobs are engine-authorized
  like seed and maintains** (`registry.rs:803-808`, `execute_seed`; the
  declaration is the grant; constraints bind; ad hoc stays under rules).
  Astra dissents ("do not turn arbitrary jobs into seed-authorized
  writers"). See §4 D1.
- **Zero-grace asset release does not reclaim a recent upload**: grace is
  measured from `max(created_at, released_at)` (`assets_ledger.rs:355`),
  and forks retain blobs (`asset_gc.rs:22`). Astra. Immediate reclamation
  needs an explicit operation.
- **Muse's engineWrites accounting**: the design RFC's `propagate` row
  already carries `engineWrites` in the certificate (LLP 0329.014.004 §2.2
  row E) for exactly this reason.

## 4. Where the panel splits (author decisions, refined by the panel)

- **D1 — the authority model for declared jobs.** *Grok*: engine-authorized
  by declaration (the job's name is the grant), constraints bind, reads
  total; drop the structural proof and the `or system` rewrite. *Astra and
  muse*: keep the tables' rules, make the proof a conservative three-valued
  evaluation (proven / unknown / refused), and add **system visibility for
  reads** (astra) — which is an engine change either way. The orchestrator's
  reading: U1's read half forces a "system visibility" concept into the
  engine regardless; given that, grok's model is smaller (no proof, no
  rewrite that grants every system writer) and matches the design RFC's
  "sealed operation authority" (§2.1 L: scoped system reads whose only
  disclosure is declared writes). Astra's concern is met if only *declared*
  jobs and schedule targets get it, and ad hoc programs stay rule-bound
  under the operator token. **Recommendation: grok's model for declared
  jobs, schedules, and `then`; rules for ad hoc.** The author rules.
- **D2 — erasure.** Unanimous on authored-plus-coverage; split only on
  whether the three words survive as the coverage vocabulary (muse: yes, as
  declarations, not a derivation source) or only `keep 'reason'` remains
  (astra, grok). **Recommendation: keep `erase <- keep 'reason'` as the one
  declaration; the coverage check lists every principal-bearing table the
  authored job does not write.**
- **D3 — `every`.** *Grok*: ship it; M8 has no other honest form. *Astra*:
  defer; recurrence is a persisted next-digest row re-armed by its target.
  *Muse*: `at` only in v1, revisit with M8 evidence. The verified brief text
  (§3) makes the orchestrator side with grok on substance and astra on
  spelling: **a persisted system-owned row re-armed by its firing is the
  mechanism; `every` is the one-line sugar over it**. Whether the sugar is
  inside the "cron" line is the author's; the mechanism is not.
- **D4 — hosted ad hoc programs.** *Grok*: no (remote code execution under
  an admin token). *Muse*: yes with a size cap, off MCP. *Astra*: yes with
  full admission and durable custody of the executable. Two to one for
  yes-with-conditions; the author rules.
- **D5 — chunk pacing.** Unanimous on no operator flag; split on default
  (grok 100, astra 50–100 with a fixed time-share policy, muse an unfitted
  cap knob). **Recommendation: 100, time-shared, measured.**

## 5. The nine author decisions of LLP 1016 §9, as the panel recommends

| § | Decision | astra | muse | grok |
| --- | --- | --- | --- | --- |
| 9.1 | `every` | defer; persisted row re-armed | no in v1; `at` only | ship it (M8) |
| 9.2 | 16th verb | no; keep `persona` | no; flags on `run` | no; drop `persona create` anyway |
| 9.3 | concurrency | one chunk, fair interleave, no flag | one at a time, clients first, unfitted cap | one operator job; no `--pace` |
| 9.4 | erasure default | refuse until covered; no template gate | refuse until declared | refuse until declared; authored job |
| 9.5 | `_commits` | never delete; redact with sequence kept | never delete | document; do not scrub |
| 9.6 | hosted ad hoc | yes, admin, TLS, full admission, custody | yes, size-capped, off MCP | no; local only |
| 9.7 | sequencing | after the bar; no premature erase gate | J0 early yes | J0 early; J3 `at` when M5 in scope |
| 9.8 | trade | `fork` adapter, amend 1015; not enough | `fork` adapter with 1015 amendment | `fork` adapter + `persona create`; cut D8 and derived D6 |
| 9.9 | rename | no; add/fill/drop | no | no |

## 6. Round 2 — the discussion

Each panelist read the other two reviews and the verification notes of §2
and answered the author's question again. **Three of three: NOT READY,
unchanged; the direction is right; commission a thinner RFC of the same
driver.** Nobody moved toward a different direction; two panelists moved
toward each other on the evidence.

### 6.1 What the discussion settled (now unanimous)

1. **Cut D8.** Delete public `enqueue`, the `send` rewrite, and §0's claim
   that fan-out past fifty is a bar gap. Muse withdrew its round-1 "thinnest
   J1 rewrites `send`" on grok's evidence (`groups.q:16`, `social-messenger.md:489`).
   Continuations return only for a sealed-recipient, unbounded fan-out with
   named completion and ordering rules, when a brief asks. Revocation never
   defers (the design RFC's `propagate` row is for that).
2. **Cut derived erasure.** No derived job, no `erase by`, no single
   `erased` login identity, no automatic device-propagation claim, no
   erasure-driven `_commits` edits. Muse abandoned per-subject tombstones
   after astra showed they still change an immutable column (`schema.q:13`,
   `runner_ops.rs:455`). The three differ only on what replaces it: astra
   defers a generic erasure contract entirely (subject selection, identity
   fencing, system-held data, external effects, and residue each need
   semantics first); grok cuts J2 until a brief asks; muse keeps an
   authored job plus a coverage check. All three: refuse-until-declared if
   it exists; `_commits` keeps its normal 10,000-row trim and the residue is
   documented.
3. **The cursor and timer bookkeeping are certified engine writes** in the
   chunk's or firing's transaction, accounted like `Emit`'s `_outbox` write
   (`runner_ops.rs:363-374`) — `engineWrites: [_jobs]` (and `_timers`) on the
   certificate. Grok raised its own round-1 "minor" to blocking for D1's
   exactly-once sentence.
4. **The sweep is `byId` over a captured upper key, reading current values,**
   with concurrent inserts defined, self-populating scans refused, and no
   "sealed input" claim — a `commitSeq` watermark cannot reconstruct
   stage-start rows from `rows(table_name, row_id, data)` (`store.rs:148`);
   grok conceded that its watermark bounds the key interval only. Bind the
   executable digest, stage identity, and arguments; park on any semantic
   change (`registry.rs:93-104`: program identity is not schema identity).
   Persist ad hoc executable content.
5. **Fairness is a specified drain, not "when idle" and not an operator
   knob.** Grok: after `try_recv` is empty, fire ≤ 64 timers then one
   operator chunk, even under load. Astra: reserve a background turn after a
   bounded number of client turns, rotate runnable jobs, check clients
   between timer targets. Muse dropped its second cap knob. Examples at
   `first 100`; measure complete writer turns including `after_commit`
   reruns (`writer.rs:1097-1133`) and client p95/p99 before anyone writes 500.
6. **Narrowing is a successor-admission change, not a `check` diagnostic.**
   Three admission paths change (`successor.rs:164, 214`; `check.rs:393`
   opens no store). Astra's round-2 point stands against both others: J0 is
   therefore not "check-only".
7. **`--dry-run` needs a rehearsal runtime**: a copied store under ordinary
   owner startup runs effects, timers, and the asset sweep against shared
   blobs (`owner.rs:218`, `writer_assets.rs:57`, `asset_gc.rs:16`). Grok and
   muse both adopted astra's finding.
8. **Server-side recurrence ships in v1.** Astra changed its mind on grok's
   argument: M8's per-user digest is server-driven and restart-idempotent
   (`social-messenger.md:752-760`), and forcing every app to bootstrap and
   re-arm its own timer row spends more surface than one duration
   declaration. Muse moved from "`at` only" to "minimal recurrence
   semantics in v1". The mechanism is unanimous: a system-owned timer row
   re-armed by its firing, with occurrence identity, coalescing of missed
   periods, and succession defined. The **word** is where the last split
   sits (§6.2).
9. **The operator seat is a purpose-specific engine entry point** (`Actor::new`
   rejects the reserved id, `identity.rs:69`); ad hoc `--file` must match
   declared admission (`Generation::certify`'s effect-target validation,
   `registry.rs:405`), be bounded in size, and stay off MCP.
10. **Corrections to the RFC's own claims**: M7's count is a successor
    maintain rebuild (`successor.rs:648-672`); the silent fifty is real in
    the runtime and unreachable in the template; `deploy` tokens inherit
    `read` (LLP 1015 D6); §10 lists five lanes; D9 adds six flags; D3 versus
    §6.8 on cancel/resume; the `fork` CLI adapter goes and LLP 1015 D1 is
    amended, but that deletion does not pay for the plane.

### 6.2 What is still split, for the author

| Question | astra | muse | grok | Orchestrator's note |
| --- | --- | --- | --- | --- |
| **Authority for declared jobs** | table rules + conservative three-valued `Viewer := system` covering reads and writes; unknown refuses; no `or system` rewrite | same as astra | engine-authorized by declaration (the seed pattern, `registry.rs:803`); constraints bind; ad hoc stays rule-bound | The read half is the crux: under table rules a fill through a membership-gated read sees zero rows (`runner.rs:1099`), so astra's model needs *system read visibility* as a new engine concept anyway, and its "unknown refuses" would refuse every `exists`-gated table. Grok's model is smaller and matches the design RFC's sealed operation authority (§2.1 L). Astra's dissent — transition rules encode policy (`schema.q:48`) — is real for *user* intents and weak for an operator's declared job. **Recommendation: grok's model for declared jobs and schedule targets; rules for ad hoc.** |
| **The word `every`** | ship `every <duration>`; no calendar sugar | minimal recurrence semantics; the word is the author's cron-line reading | ship `every` | Mechanism unanimous. **Recommendation: `every <duration>`, no time-of-day syntax; the "cron" line forbids a service, not a duration.** |
| **Schedule targets** | mutations *and* jobs, via internal atomic enqueue (the digest is a scheduled sweep) | mutations only in v1 | mutations only in v1 | Astra is right that the digest is a sweep over users, which is a job; **recommendation: a schedule may target a declared job; firing enqueues it atomically; no public `enqueue` statement.** |
| **Hosted ad hoc programs** | yes: admin, TLS, full admission, durable source, off MCP | yes: same, size-capped | no: local `--file` only | 2–1. LLP 1015 D10 already admits operator mutations hosted under `admin`. **Recommendation: yes, under astra's conditions.** |
| **J0 before the loop bar** | no: not check-only, and M7 removes the urgency | yes | yes (narrowing only) | Astra's factual point is verified (§6.1.6). **Recommendation: nothing before the bar.** |
| **Erasure's replacement** | defer a generic contract entirely | authored job + coverage check | cut J2 until a brief asks | **Recommendation: astra's — one paragraph in the RFC naming the five semantics an erasure contract needs, no kind, no lane.** |

### 6.3 The kernel the panel would commission

Stated by all three in nearly the same words, and recorded here as the
proposal's next shape:

- **`job` / `chunk`** as a chunked mutation: cursor and progress committed
  with the body and certified as engine writes; `byId` sweep over a captured
  upper key; executable digest and stage identity bound; park on change;
  cancel at a boundary; terminal cancel versus resumable park stated once.
- **Narrowing admission** `T? → T` at successor application, with the fill
  job pasted by the refusal; add/fill/drop; no rename.
- **`schedule … on table at .col`** as a row-triggered timer on the writer's
  own clock, fire-and-settle in one commit, mutation or declared-job
  targets, occurrence identity and re-arm rules written; **`every
  <duration>`** on a system-owned row.
- **`run --file / --wait / --plan / --dry-run`** with a rehearsal runtime,
  `trace <job>`, a purpose-specific system entry, no new verb.
- **Deleted from v1:** public `enqueue` and D8; derived erasure and its
  words; `_commits` edits; job SSE (`--wait` can poll); calendar sugar; the
  `fork` CLI adapter (executing LLP 1007 §7; LLP 1015 D1 amended).
- **First demonstrations:** a crash-resumable fill during live chat traffic,
  measured with the reruns; expiry firing with both clients closed.

### 6.4 A finding for LLP 1015

LLP 1015 D10 makes `data`, `why`, and `run --env production` act as the
reserved system principal. The engine filters reads for that principal
like any other (§2 U1); until "system visibility" exists, an `admin` token
reading production sees nothing on a membership-gated table. Whichever
authority model the author picks above should be the one LLP 1015 D10
inherits.

## 7. Proposed next step

Revise LLP 1016 to §6.3's shape as revision (a) once the author rules on
the six splits in §6.2, and keep it `Draft`. The panel does not need to sit
again on the unanimous cuts; a short blind READY check from two families
on revision (a) is proportionate. Nothing in this synthesis changes any
status; the author decides.

**Record (2026-09-05, later the same day):** the author instructed the orchestrator to write revision (a) using its own judgement rather than catering to every point. Revision (a) is the current text of `llp/1016-administrative-plane.rfc.md`; its §12 lists what it took from this record and where it decided against a majority (the authority model, schedule job targets, nothing before the loop bar). The proposed next step in §7 stands: a short blind READY check from two families on revision (a).
