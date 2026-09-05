# Panel: LLP 1016 — The administrative plane (grok-4.6)

**Reviewed:** `llp/1016-administrative-plane.rfc.md` as landed at `6d3d09c6f`, in a read-only capsule exported from that commit (`~/projects/snapback-1016-panel/capsule-grok`), with the engine, owner, compiler, evaluator, templates, the design RFCs it extends, the control-plane RFC beside it, the briefs, and the rules.
**Family:** grok-4.6 (xAI)
**Provider/runtime:** Grok Build CLI 1.0.13, headless (`grok -p <prompt> -m grok-4.6 --reasoning-effort xhigh --output-format plain --disable-web-search --permission-mode auto --max-turns 200`); the model's own provenance line self-reports "grok-4.6 (high)" — the CLI was passed `xhigh`; which effort was served could not be verified from this side.
**Date:** 2026-09-05
**Redacted:** No — the panelist read the in-repo documents and sources directly in its own capsule; no content left the local machine beyond the model serving the CLI.
**Method:** Round 1, mutually blind, on the identical brief preserved at `llp/reviews/1016-administrative-plane.panel.brief.md`. The panelist wrote the file below to the requested output path itself; it is reproduced verbatim. The orchestrating session authored LLP 1016 and is not a reviewer; it verified the engine claims below against the tree before the synthesis (`1016-administrative-plane.panel.synthesis.md`).

---

## Round 1 review (verbatim)

Reviewer: grok-4.6 (high) · Date: 2026-09-05 · Method: blind round-1, read-only capsule at 6d3d09c6f

# LLP 1016 review — administrative plane

## 1. Verdict

**NOT READY**

The thesis is the right one: ceilings bound a transaction, not a task, so the plane is a driver over certified chunks and there is no write path outside Quarry. An unbounded operator mode, or pushing bulk work to host cron, would spend the property `0329.014.004` §4 paid for ("no write path exists outside the language") and re-create Snapback 1's hosted-lifecycle shape. I am not happy with this RFC as written. It packages four different products onto one serial `_jobs` queue, ships a derived erasure program that cannot run against the chat template it uses as its example, and claims a static authority proof the rule language does not support. Fix those and a thinner RFC in this same direction is worth building.

## 2. Blocking findings

**B1. User-path fan-out on the one operator queue regresses chat under load.**

> "The writer thread (LLP 1002 §5) runs a chunk only when no client action is waiting on its channel; between chunks it drains pending client actions first." (D3)
> "`enqueue deliver { conversationId, messageId: row.id }`" (D8)

The writer is one thread over an `mpsc` channel; the idle arm is empty (`writer.rs:463–475`). Client work is `Action::Execute` on that same thread (`writer.rs:499`). After every commit the writer reruns every invalidated live query before it returns (`writer.rs:1097–1133`). Today's `send` writes every delivery in the mutation (`templates/chat/snapback/deliveries.q:13–14`, `messages.q:19–20`) and `memberAdd` refuses the 51st member (`groups.q:16`). D8 splits that into one inline row plus a job. Under a busy group, the channel is never empty, so `deliver` never runs: members other than the sender wait until idle. That is a product regression relative to the template, and it is the opposite of "none silent" (LLP 0329.016 P4). Resolve: do not `enqueue` from `send` while groups are capped at 50; or give continuations a lane the operator fill cannot starve (one continuation chunk per N client actions, never "only when idle"). Do not put operator backfills and request-path fan-out on one `one job at a time` queue.

**B2. Derived erasure as specified cannot execute on the chat schema.**

> "points every principal column naming the erased principal at the reserved **`erased`** principal"
> "exempt from the tables' user rules — the declaration *is* the authorization — and never from constraints."
> "`erase <- delete` for tables whose read rule is `<col> = viewer`; `erase <- scrub { … }` naming the optional columns for the rest." (D6)

`profiles` is `public`, so the pasted rewrite is scrub. It also has `unique byPrincipal: principal` and `immutable principal` (`schema.q:3–17`). Scrub writes `principal = erased`. Immutable fires on update (`runner_ops.rs:455–464`). Unique fires on every non-delete (`runner_ops.rs:466–467`). The second erased user is `E_CONSTRAINT` on `byPrincipal`. Memberships are `unique byConversationPrincipal: conversationId, principal` and `immutable … principal` (`schema.q:30–38`): two scrubbed members of one conversation collide. Follows likewise (`schema.q:108`). The engine already exempts maintain writes from rules but *not* from unique/immutable (`runner_ops.rs:295–297`); D6 repeats that sentence and then requires a write those constraints refuse. Resolve: `check` refuses `scrub` of an immutable principal column and of a unique index that would collapse to `erased`; paste `delete` (or a per-row tombstone that is not the reserved principal) for those tables. Do not ship a rewrite the template cannot run.

**B3. D2's structural `system` test is neither sound nor the same model D6 uses.**

> "the compiler can evaluate each site's rule for the system principal structurally — `system` admits it, `allow` admits it, a rule with no `system` disjunct does not"
> "A job that would be `E_RULE` at chunk 400 is red at `check`." (D2)

The rule algebra is `allow`, `deny`, `public`, `system`, `exists`, `created`, `and`/`or`/`not`, `(old, next)` (`guide/quarry.md:73–77`; `schema.rs:109–136`). A syntactic "has a `system` disjunct" accepts `system and exists memberships[.id, viewer]` and `system and not allow`, which runtime will `E_RULE`. It refuses `created` (insert-only; runtime-true for a new row) and `public`/`allow` on read sites the RFC does not mention. The D2 rewrite is `or system` on the write site. Adding that for `fillAvatars` also admits every other system writer: operator `run --file`, other jobs, schedules, `then` (`1003` §2; `engine/mod.rs:436–441`). `deliveries.insert` is `exists memberships[.conversationId, viewer]` (`schema.q:87`); the rewrite that unblocks `job deliver` lets an admin insert arbitrary delivery rows. D6 then exempts erasure from those same rules. Three authority models for one plane. Resolve: declared jobs are engine-authorized like seed/maintains (`registry.rs:803–808`, `runner_ops.rs:295–297`) — the job name is the grant, constraints still bind. Ad hoc `--file` stays under the tables' rules as `system`. Prove D2 by SAT on the rule with `viewer = system` and unknown fields fail-closed, or drop the "red at check" claim for anything but `allow`/`public`/`system`/`deny`.

## 3. Material findings

**M1. Hat 4 conflates a silent mutation with an honest capped query.** `followingFeed` "admits at most 50 follow rows" and "reports `capped` when that domain hits its limit" (`guide/quarry.md:146–149`). `send`'s `for … first 50` is a mutation: `Stmt::For` iterates `domain()` and commits (`runner.rs:246–266`); mutation states are only `Committed | Rejected` (`1001` §3). The fifty-first *member* is already refused by `GROUP_FULL` (`groups.q:16`; M3 is "2–50 members", `social-messenger.md:489`). The fifty-first *follow* is a read-side merge bound, which `enqueue` does not fix. M8's celebrity is 900 followers and the brief itself says the cost is "whether a lane fans out on write or filters at read time" (`social-messenger.md:142–146`). That is LLP 1010 A5 / `0329.014.004` §4 ("maintain when fan-in is bounded, compute at read when fan-out is unbounded"), not D8.

**M2. Narrowing is not implementable in `successor.rs` as it stands.** `Optional(T)` ≠ `T` is `Drop::TypeChange` (`successor.rs:164–168, 31–36`), and type change "drop[s] the column's values" (`1001` §4). Required-column admission only fires for a newly non-optional column (`successor.rs:214–228`) *after* a non-empty plan has already been refused as destructive (`successor.rs:196–198`). D5 needs a new branch: `Optional(T) → T` is not a `TypeChange`; walk stored rows for `Null`; admit or `E_SUCCESSOR_NARROWING`. The walk exists (`validate_stored_rows`); the admission does not.

**M3. D1 dropped the sealed-input watermark the job kind was defined with.** `0329.014.004` §6: "chunked, resumable, generation-fenced bulk work over sealed inputs (a commitSeq watermark)". D1's visiting rule is live: inserts after the cursor are visited. A stage that `insert`s into its own chunk table never exhausts. Generalize `E_JOB_CURSOR_WRITE` to refuse inserts into the chunk table, and keep a start-of-stage `commitSeq` (or high-water key) as the design RFC specified.

**M4. `schedule` target = job is not "fire and settle in one commit".** D7: "for each runs the target as `system` … in one transaction that also deletes the timer row". A job is many commits (D1). If the target is a job, the fire commit can only *enqueue* it. Say that, or restrict targets to mutations (recommended for v1). `every` on the same kind is a periodic timer, not a cron *service*; it is what M8's digest actually needs ("emission is driven by the schedule alone — it requires no connected client", `social-messenger.md:757–760`). External CLI trigger is Snapback 1's hosted-lifecycle shape (`1014` §3.3). Prefer `every`; it is not the NOT-DOING line.

**M5. Erasure residues the RFC does not name.** Unique/`erased` (B2). `ref` columns to principal-bearing tables: D6 says they count as "naming a principal", but a `ref profiles` is an id, not a `principal` column — the sweep will not rewrite it unless specified. Ids inside `json` / `[type]` columns: no walk. Maintains: a `count` over a deleted row applies its delta (`1001` §2); a `count` over a *scrubbed* row that still exists does not. Forks/snapshots: D6 lists them; it does not say that zero-grace asset release (`1006` §9 `released_at`; D6 "zero grace") deletes blobs a snapshot still names (`1006` fork-aware reclaim exists so `reset` would not). `_commits` trim is last 10,000 (`engine/mod.rs:1381–1384`); scrubbing them is mostly theatre. `delivered-history` keeps hidden rows, not absent ones (`1012` §5 rules 1 vs 4) — the RFC gets this right. Prefer an authored `job erasePrincipal` with `check` verifying each principal-bearing table is written, over a derived engine program.

**M6. `--as system` cannot be a persona flag.** `Actor::new` rejects the reserved id (`identity.rs:69–71`). `Context::system` is private to seed/`then` (`engine/mod.rs:57–71`; `1001` §6). D4 needs a new purpose-specific entry point, like `execute_then`. Hosted `POST /control/run` of arbitrary `.q` as system is remote code execution under an `admin` token; keep it off MCP (D11 is right) and off hosted v1 (§9.6: veto). Local `--file` is the repair console.

**M7. Default chunk 500 plus live reruns will miss the 2× budget before a `--pace` flag exists.** One chunk is one writer turn plus `after_commit` reruns (`writer.rs:1097–1133`). A 500-row `profiles` fill invalidates every live profile/feed. §8's 25 ms is the SQLite write, not the turn. Author-declared `first N` should be the only knob; start the examples at 100, measure, add `--pace` only if 2× fails (§9.3 is right to defer the flag, wrong to imply 500 is free).

**M8. Surface that does not pay.** `enqueue`, derived `erase`/`erased`/`erase by`, `every` if M8 is not in scope, six `run` flags of which `--cancel`/`--resume` are a verb pretending to be flags, SSE job events, hosted ad hoc. The `fork` CLI adapter is 20 lines (`verbs.rs:242–254` → `POST /control/fork` at `control.rs:93`). Deleting it executes LLP 1007 §7 and is correct, but it is not a counterweight for this RFC. LLP 1015 D1 still lists `/control/fork` as a *dev* route (refused in `serve`); keep the route, drop the verb, amend 1015's table. Better pay: do not build D8 or derived D6 in v1.

**M9. Successor maintain rebuild is already an unbounded transaction.** Adding `maintain messageCounts` rebuilds the target from all source rows in the successor transaction (`successor.rs:651–671`; `1001` §4). M7's "backfilled field: every conversation gains a message count" (`social-messenger.md:688–692`) is that path, not a job. The RFC should say so, or M7 will be used to justify jobs it does not need.

## 4. Minor findings

- D3 "OCC" on a chunk is vacuous: one writer (`store.rs:100` `EXCLUSIVE`; `1001` deferred "OCC across multiple writers"). Offline twin OCC against a job write is real (`1012` §7) and unmentioned.
- `WriteKind` has no `Enqueue` (`certificate.rs:135–141`); adding it is the `Emit` shape (`1001` §8) and is fine, but the RFC writes as if the variant exists.
- `_commits.kind` today is `"mutation" | "system" | "seed"` (`1001` §2); widening it is a store-format break, which this fence allows, but say so.
- `guide/quarry.md` §Refused rewrite for `schedule` is already "caller-invoked mutation" (`parser.ts:71`); D7 replaces it. Good.
- "exactly-once per chunk" (D1) is true only if the `_jobs` cursor update is engine-owned in the same SQLite transaction as the body, like `_outbox` on `Emit` (`1001` §8). Programs cannot write `_` tables (`1001` §1). Spell the engine write.
- Clique Pay (`benchmarks/briefs/clique-pay.md`) has no close-of-books and no payouts; it is a wallet/split fixture. Do not cite it as a job customer.

## 5. Answers to the thirteen questions

**1. Direction.** Driver over certified chunks, no path outside the language. Unbounded operator mode costs the §4 property that makes constraints trustworthy and is cheaper only until the first admin `DELETE` against a live query. Product boundary (host cron, external worker) is Snapback 1's 17 refusing lifecycle verbs (`1014` §3.3). Smaller RFC: yes — jobs + narrowing + row-triggered `schedule`; not enqueue; not derived erasure. I abandon this direction if a raw SQL/`data set` path appears, or if jobs skip constraints.

**2. The four hats.** At the bars: **schedule is real** (M5 "both clients closed at expiry, the server refuses", `social-messenger.md:596–599`; today's `purgeExpired` cannot, `1012` §3). **Backfill is real for optional→required and for non-maintain columns**; M7 counts are successor maintain rebuild (M9). **Fan-out past 50 is not required** by M3 (cap 50) or by M8 celebrity (read-side merge). **GDPR erasure is not in M1–M8** (blocking/reporting is out of scope, `social-messenger.md:101`). Missing from the list and already designed elsewhere: export (`1015` D14), impersonation (`1015` D10: production is system, never a persona), `sent_unknown` requeue (`1003` §2), index rebuild (successor). Seeding production is `reset` and should stay refused hosted.

**3. D1.** Cursor as a full key tuple matches LLP 1011 B1 / `1001` §3 (opaque, total index, `after` is key-order). Visiting rule is an honest non-transaction. Partial fill: optional column stays optional, `check` still sees it — acceptable. Partial erasure: other users observe a half-deleted principal — not acceptable without a visibility fence for the whole sweep. Partial fan-out: some members have the row, some do not — acceptable only if the product names it; chat will misread it as "didn't send". Watermark: M3.

**4. D2.** Not sound, not complete: B3. Running jobs under table rules is the wrong call; seed/maintain exemption for *declared* jobs is the existing pattern and the simpler one. `or system` is a confused-deputy grant.

**5. D5.** Not as `successor.rs` stands (M2). Add / fill / drop is the honest v1 path; a `migrate` block is a second language inside the successor and is not "straight to the ideal" until a brief's rename count is measured. No rename in v1 (§9.9).

**6. D6.** Three words are attractive and insufficient (B2, M5). Derived-by-the-engine will always lag the schema (json, refs, maintains, snapshots). An authored job plus a coverage check (`E_ERASE_UNDECLARED` listing unwritten tables) is the same agent experience with no engine special case. Refuse-until-declared is right; default-delete is silent loss. The loop bar's template should ship without clauses and without a derived job.

**7. D7.** The owner already ticks: session sweep / asset sweep on `recv_timeout` (`writer.rs:439–476`), effects runner every 1 s (`effects.rs:346`). Timers belong on the writer, ≤64 per tick, fire-and-settle as `then` does (`1003` §2). `/control/clock` already exists (`control.rs:154`; `writer.rs:713–737`). Targets: mutations only in v1. `every`: ship it (M4); it is one duration, not a crontab. Missed firings fire once at start: right.

**8. D8.** Twin `Enqueue` as `Emit` (consume one `new_ids` entry, no-op) is the right parity (`evaluator/src/runner.ts:166–171`; `1001` §8). Observable ten commits is honest. Relative to `merge`: D8 is for per-recipient rows; feeds stay A5. Relative to `propagate` (`0329.014.004` §2.2 E): `propagate` is same-commit engine fan-out for a revoke that a job *must not defer*. Send may defer; revoke may not. Do not use `enqueue` for revoke. The silent fifty on `send` is real in the runtime (mutation commits) and currently unreachable because of `GROUP_FULL`. Do not change `send` until the cap lifts.

**9. D3.** The writer admits a driver without a second thread: on `Timeout` and after `try_recv` drains, fire ≤64 timers then one chunk. A 500-row chunk can starve sends for one turn plus live reruns (M7). `first N` is the only knob.

**10. D4/D10/D11.** No sixteenth verb. Flags on `run` for `--file/--wait/--plan/--dry-run` yes; `--cancel/--resume` are a stretch — a subcommand `run cancel` is still `run`. `--as system` is the operator seat and needs a new engine entry (M6). Footgun: `run messages.send --as system` after D2's rewrite. Hosted ad hoc: no. MCP read-only: yes. Would not add `job` and would not delete `persona` for it; `persona create` is already redundant with create-on-first-use (`1002` §4) and is the better deletion.

**11. Agent-friendliness.** First administrative thing in M1–M8 is M5 disappearing messages, then M8 digest, then M7 if they add a required non-maintain column. M5 is paved by D7 (column + `schedule` + `purgeMessage`); today's recipe is a gap the RFC closes. M8 digest is paved only if `every` ships; otherwise the agent leaves the product. M7 counts: not paved by jobs, already paved by successor rebuild — the RFC should say that or the agent will write a fill job that fights the maintain. Erasure's refusal/rewrite is good *if* the paste runs (B2). `--plan/--dry-run/--wait`/receipt are the right three.

**12. Surface.** Delete from this RFC: `enqueue`, derived erasure, `erase by`, `erased` as a login principal (a tombstone id is enough), hosted ad hoc, job SSE, `--pace`. Keep: `job`/`chunk`, narrowing, `schedule … at`, `run --file/--wait/--plan/--dry-run`, `trace <job>`, `--as system` as a new entry point. Fork CLI deletion is right and small; also delete `persona create`. Do not pretend either pays for J0–J4.

**13. Console.** Later, on the same routes (1015 D13). An agent-first posture does not need a human view of the erasure map sooner than `guide app` and `run erase` printing it. Smallest human view if forced: `dev --status` already gaining `jobs`/`timers` (D9) plus `trace`. No browser.

## 6. Strengths

Do not lose these in a revision:

- The transaction/task split. It is the actual answer to the 2026-09-05 paragraph.
- One language, no admin DSL, no raw write path, no jobs framework, no cron service.
- Cursor committed with the chunk (no crash window). Park on `Rejected`; cancel is a boundary; a job does not claim to be a transaction.
- `check` before `run`, pasteable rewrites, `--plan` then `--dry-run` then `--wait`, typed exits, ledgered operator actions.
- Generation fencing of durable jobs (D3) applying `1001` §4 to the one new durable intent.
- Twin stays small: jobs/timers/erasure never run on it; `Enqueue` is `Emit`.
- Sequencing J0 as check-only is the one lane that may precede the loop bar without lying.
- Honest non-claim on GDPR (pages, WAL, unreconnected devices).

## 7. Open questions for the author

Needed rulings, with a recommendation:

- **§9.1 `every`:** ship it. M8 digest has no other honest form.
- **§9.2 sixteenth verb:** no. Do not pay with `persona`.
- **§9.3 concurrency:** one *operator* job at a time; if `enqueue` exists at all, continuations interleave with client actions. No `--pace` until measured.
- **§9.4 erasure default:** refuse-until-declared. Do not derive the job; require an authored one.
- **§9.5 `_commits` residue:** document; do not scrub. The table is already trimmed to 10,000.
- **§9.6 hosted ad hoc:** no. Local `--file` only.
- **§9.7 sequencing:** J0 may precede the bar. J1 after. J3 `schedule at` when M5 is in scope. J2/J4/enqueue after a brief asks.
- **§9.8 doing-list trade:** (a) drop the `fork` CLI adapter, keep `/control/fork` as a dev route, amend 1015 D1; also drop `persona create`. Not enough — cut D8 and derived D6.
- **§9.9 rename:** no rename in v1.

Also rule: **jobs engine-authorized vs `or system`.** Recommend engine-authorized declared jobs (B3).

## 8. If I owned J1

Ship only the operator driver: `job`/`chunk` grammar, `_jobs`, cursor-in-the-same-transaction, one job at a time behind client actions, `E_JOB_CURSOR_INDEX` / `E_JOB_CURSOR_WRITE` (including insert-into-self), generation pause, `run --file/--wait/--plan/--dry-run` of a *declared* job as a new system entry point, `trace <job>`, the `job` recipe as a fill of an optional column. No `enqueue`. No `or system` rewrite — declared jobs are engine-owned writes, constraints bind. Pair it with J0's narrowing so the pasted fill job is a program the owner can run. Measure one 100-row chunk against live chat sends before calling 500 the example.

---

## Round 2 response (2026-09-05, cross-read; verbatim)

**Method:** the same runner and capsule, on `1016-administrative-plane.panel.brief-r2.md` (the orchestrator's verification notes plus all three round-1 reviews). The panelist wrote the file to the requested output path itself; reproduced verbatim.

Reviewer: grok-4.6 · Date: 2026-09-05 · Method: round-2 cross-read, read-only capsule at 6d3d09c6f

# Verdict: NOT READY

Unchanged from round 1. The thesis is still right — a driver over certified chunks, no write path outside Quarry — and I would not trade it for unbounded SQL or host cron. This RFC is the wrong packaging of that thesis: four hats on one serial `_jobs` queue, a derived erasure program the chat template cannot execute, an `or system` grant that is a confused deputy, and a `send` rewrite the bar does not ask for. Commission a smaller RFC of the same driver. Kinds: `job` and `schedule` only. Surface: `job`/`chunk` grammar, narrowing, `schedule … at` plus `every`, `run --file/--wait/--plan/--dry-run`, `trace <job>`, a purpose-specific system entry. Cost in guarantees: no GDPR closure, no 5k-member delivery, no remote ad hoc, no claim that `check` excludes later data-dependent `E_RULE`. What it buys: a pasteable fill that actually visits rows, disappearing messages that fire with both clients closed, a digest that does not leave the product, and the transaction/task split intact.

## Agreements

- Agree with both: driver over chunks; no admin DSL, no raw write path, no jobs framework, no cron service.
- Agree with both (and the orchestrator): D2's "has a `system` disjunct" is neither sound nor complete; three-valued `Viewer := system` over `RuleExpr` is well-posed (`packages/compiler/src/lower/schema.ts:364-365`, `snapback2-core/src/schema.rs:~269-350`, `certificate_policy.rs`).
- Agree with both: scrub-to-one-`erased` is refused by `immutable` and collides on `unique` (`templates/chat/snapback/schema.q:11-13,35-38`; `engine/runner_ops.rs:455-467`).
- Agree with Muse B1's remaining leg, now that the trim is verified (`engine/mod.rs:1381-1385`): never delete `_commits`; deleting them deletes what `trace` attributes.
- Agree with Muse B3: the `_jobs` cursor is an engine write; account it like `Emit` (`runner_ops.rs:363-374`). I had this as minor; it is blocking for D1's exactly-once sentence.
- Agree with both: chunk cost is the write plus `after_commit` live reruns (`snapback2/src/writer.rs:1097-1133`); "only when idle" starves under load (`writer.rs:439-480`).
- Agree with both: narrowing is a new successor branch, not the existing required-column walk (`successor.rs:164-168,196-198`).
- Agree with astra (orchestrator-confirmed): M7's message count is successor maintain rebuild (`successor.rs:648-672`), not a job customer. Muse's "M7 forces backfill" is wrong for that brief row.
- Agree with astra: the silent fifty is real in the mutation machine (`engine/mod.rs:708`) and unreachable in the template (`templates/chat/snapback/groups.q:16`); §0 overstates the hat.
- Agree with astra: `--as system` cannot be a persona (`identity.rs:69-71`; `engine/mod.rs:57-71`).
- Agree with both: no sixteenth verb; drop the `fork` CLI adapter (`verbs.rs:242-254`), keep `POST /control/fork`, amend 1015 D1.
- Agree with astra on dry-run: a snapshot copy (`store.rs:805-809`) plus ordinary owner startup (`owner.rs:218`) is not rehearsal isolation; I missed this in round 1.
- Agree with astra: D3 must bind `program_hash`, not schema `hash()` (`registry.rs:93-104`); table-and-index survival is not task identity.
- Agree with both: refuse-until-declared if erasure exists; console later; J0 (narrowing) may precede the loop bar.

## Disagreements

**Muse's J1 includes `enqueue` and a rewritten `send`, measured on a 5,000-member group.** That workload is not in the bar. M3 is "2–50 members" (`benchmarks/briefs/social-messenger.md:489`); `memberAdd` refuses 51 (`groups.q:16`). The celebrity fixture is 900 followers and the brief names the cost as write-fan-out versus read-time filter (`social-messenger.md:140-147`); the paved form is `merge` (LLP 1010 A5). D8 puts `deliver` on the one operator queue whose idle arm is empty (`writer.rs:463-475`). Under a busy group the channel is never empty, so members other than the sender wait — a product regression relative to today's inline `send`. Astra's "keep bounded chat sends" is the right call. `enqueue` as a primitive without a customer does not pay for itself. Delete D8.

**Astra (and Muse) keep declared jobs under table rules with a conservative proof.** Astra's own B1 is why that fails: a uniformly denied scan reports exhausted empty (`engine/runner.rs:1099-1102`). `memberships` and `messages` read `exists memberships[…]` (`schema.q:39,68`). The reserved principal holds no membership (`identity.rs:69-71`; LLP 1001 §4), so a fill under those rules visits zero rows. Three-valued admission of *writes* does not make *scans* visible. Covering "scan visibility" is engine-authorized reads. Then `or system` on `deliveries.insert` (`schema.q:87`) admits every other system writer — operator `--file`, other jobs, `then`. That is the confused deputy. Seed is already the other model: engine entry, rules exempt, constraints bind (`registry.rs:803-808`; `runner_ops.rs:295-297`). Use it for *declared* jobs: the job name is the grant, generation-fenced, body visible at `check`. Ad hoc `--file` stays under three-valued `Viewer := system`, fail-closed on `Exists`/`Created`. Muse calls this weaker; weaker-and-honest is the point.

**`every`.** Astra defers to a re-armed `at` row; Muse gates on the author's reading of the cron line. I still ship `every`. The orchestrator settled the need: M8 "requires no connected client and no client interaction, so lazy read-triggered evaluation cannot satisfy it" (`social-messenger.md:757-760`). The RFC's §9.1 fallback (host CLI trigger) puts the bar outside the product — Snapback 1's hosted-lifecycle shape (LLP 1014 §3.3). `every` is one duration on the kind `NOT-DOING.md` already allows, not a crontab service. If the author vetoes the word, this RFC must still specify engine re-arm of `at` on a system-owned row. Do not leave M8 to cron.

**Hosted ad hoc.** Astra and Muse say yes under `admin`/TLS. I still veto. `POST /control/run` of arbitrary `.q` as `system` is remote code execution under one token. Local `--file` is the repair console; declared jobs are the durable executable. Astra's "source_hash cannot recover a missing file" is an argument to persist *declared* jobs and to re-read `--file` from disk, not to store remote program text. The primary user is an agent with the CLI.

**Muse's per-subject tombstone as a way to keep derived D6.** `erased:<id>` fixes the unique collision and not json, `ref`, maintains, `then`-written rows, or fork-held blobs. Derivation will lag the schema. An authored job plus `E_ERASE_UNDECLARED` listing unwritten tables is the same agent paste without an engine special case. Prefer cutting J2 until a brief asks.

**Muse's unfitted second pacing knob.** No. Specify the drain instead: after `try_recv` is empty, fire ≤64 timers then one operator chunk, even if the channel will fill again. Author-declared `first N`, examples at 100, measure including reruns (`writer.rs:1097-1133`). `--pace` stays deferred.

**Astra's "ordinary updates reindex changed rows" as a general cursor hole (`runner_ops.rs:126-131`).** Insufficient against a `byId` stage: `id` does not move. The RFC already refuses writing the chunk index (`E_JOB_CURSOR_WRITE`). The real hole is a chunk over a unique index whose key columns a concurrent client can change. Require those key columns immutable for the stage, or a start-of-stage watermark as `0329.014.004` §6 specified. I already wanted the watermark and insert-into-self refusal; astra's program-identity point I adopt (above).

## Changes ranked

1. **D2.** Declared jobs are engine-authorized (seed pattern); drop the `or system` rewrite; ad hoc `--file` uses three-valued `Viewer := system`, fail-closed on `Exists`/`Created`; stop promising `check` excludes later `E_RULE`. Pick engine-auth over astra's table-rules because of `runner.rs:1099` and `schema.q:87`.
2. **§0 / D8.** Delete `enqueue` and the `send` rewrite. Pick delete over Muse's 5k-member J1 because the bar caps groups at 50 (`groups.q:16`; `social-messenger.md:489`).
3. **D6 / §10 J2.** Do not derive an erasure job; cut J2 from v1. If the author keeps the hat, authored job + coverage check + refuse-until-declared; no single `erased` identity. Pick authored over Muse's tombstones because json/refs/maintains still escape.
4. **D1.** Put `engineWrites: [_jobs]` (and `_timers` settle for D7) on the chunk certificate, `Emit` accounting. Pick this over weakening to at-least-once.
5. **D1 / D3.** Bind `program_hash` and stage identity/args/digest; park on change; chunk-index keys immutable or start-of-stage watermark; refuse insert into the chunk table.
6. **D3.** Drain clients, then ≤64 timers then one operator chunk even under load; one operator job at a time; examples at `first 100`; no `--pace`. Pick specified drain over Muse's second knob.
7. **D5 / J0.** New `Optional(T) → T` branch; walk stored nulls; static `check` ≠ store preflight. J0 is narrowing only (no erasure map if J2 is cut).
8. **D7.** v1 targets are mutations; ship `every` (or engine-rearm of `at` on a system-owned row — not host cron); write the re-arm rule.
9. **D4.** Purpose-specific system entry, not a persona; local `--file` only; `--dry-run` is a rehearsal runtime (no effects, no shared blob GC, pinned clock).
10. **§9.5 / D6 residue.** Never delete `_commits`; document the 10,000-row trim (`engine/mod.rs:1381-1385`).
11. **§0 / D5.** State that successor maintain rebuild already backfills M7 counts (`successor.rs:648-672`).
12. **D11 / §9.8.** Drop `fork` CLI; keep the dev route; amend 1015 D1; MCP stays read-only.

## Deletions

`enqueue`, D8, the `send` rewrite, `WriteKind::Enqueue` from this RFC, job SSE, `--pace`. Derived erasure, `erase by`, reserved `erased` as a login principal, `_commits` deletion, zero-grace release as specified. Hosted ad hoc and J4. The `or system` admission story. Clique Pay as a job customer. §0's claim that fan-out past 50 is a bar gap. J0's erasure map and `E_ERASE_*` if J2 is cut. `--cancel`/`--resume` as flags pretending to be verbs.

Keep: `job`/`chunk`, `_jobs` cursor-in-transaction, narrowing, `schedule … at`, `every`, `run --file/--wait/--plan/--dry-run`, `trace <job>`, purpose-specific system entry, generation fencing, the non-transaction disclaimer, honest GDPR non-claim.

## The nine decisions

1. **§9.1 `every`:** ship it. Split: grok ship / astra defer to re-arm / Muse gate on the cron line.
2. **§9.2 sixteenth verb:** no. Unanimous.
3. **§9.3 concurrency:** one operator job; drain then one chunk; no `--pace`. Split: Muse wants a second unfitted cap; grok and astra do not.
4. **§9.4 erasure default:** refuse-until-declared; do not derive; omit J2 from v1. Unanimous on refuse-until; split on derive vs authored vs omit (I omit).
5. **§9.5 `_commits`:** document residue, never delete. Unanimous against the RFC's recommended scrub.
6. **§9.6 hosted ad hoc:** no; local `--file` only. Split: astra and Muse yes under `admin`/TLS; grok no.
7. **§9.7 sequencing:** J0 narrowing may precede the bar; J1 declared jobs after; J3 `schedule at` + `every` when M5/M8 are in scope; J2/J4/enqueue not this RFC. Split: Muse's J1 includes `send`; I do not.
8. **§9.8 trade:** (a) drop the `fork` adapter, keep the route, amend 1015 D1 — necessary and not sufficient; also cut D8 and derived D6. (b) `persona create` is a nice small deletion, not this RFC's pay. Unanimous on (a) as a deletion; split on whether it pays for the plane.
9. **§9.9 rename:** no in v1. Unanimous.

Also rule, because D2 is otherwise unimplementable: **declared jobs are engine-authorized; ad hoc is under table rules as `system`.** Split: grok engine-auth / astra and Muse table-rules with conservative proof.

## To the author

You asked if we are happy with this RFC or want a different direction. Happy with the property (ceilings bound a transaction); not happy with this document. Do not commission J1 from a text that still contains `enqueue`, `or system`, and a derived `erased` scrub the template cannot run. Rewrite 1016 as the small driver: one declared fill job that actually visits rows, narrowing so the paste is a successor, a timer that fires with the clients closed, `every` so the digest does not leave the product. Measure a 100-row chunk against live sends, including the reruns, before anyone writes 500. Leave GDPR and 5,000-member groups for a brief that names them.
