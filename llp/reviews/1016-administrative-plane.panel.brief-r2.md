# Panel: LLP 1016 — Round-2 brief (identical for every panelist)

**Type:** Review input
**Date:** 2026-09-05
**Panel:** the three round-1 panelists, same runners and capsules
**Related:** LLP 1016, `1016-administrative-plane.panel.brief.md`, `1016-administrative-plane.{astra,muse,grok}.md`, `1016-administrative-plane.panel.synthesis.md`

Preserved verbatim as handed to every panelist (each prompt prepended only `REPO`, `OUT`, and the output instruction). The three round-1 reviews it embeds are the same texts preserved in the per-family artifacts and are omitted here to avoid duplication; the head and the orchestrator's verification notes follow.

---

# Panel: LLP 1016, the administrative plane — Round-2 brief: the discussion

You are one of the three round-1 panelists (codex gpt-6-astra, Muse,
grok-4.6). Round 1 was mutually blind. This round is the discussion: you
now have the other two reviews, verbatim, and the orchestrator's
verification notes on the engine claims all three made. Same tree, same
rules: `REPO` is the read-only export at `6d3d09c6f`; cite `path:line` for
engine claims; say "I could not verify" when true; write only to `OUT`. The
author's priorities still govern: simplicity, elegance, speed, ease,
ergonomics first; the primary user is an AI agent building an app; surface
must pay for itself; deleting is first-class; go straight to the ideal.

The author's question is unchanged and is the only thing this round must
answer: **are you happy with this RFC, or should the design go in a
different direction?**

## What you must do

1. **Read the other two reviews** (below) and the verification notes.
2. **Where you agree with another panelist, say so in one line** and do not
   restate the argument.
3. **Where you disagree, argue it** — with evidence from the tree, not
   restatement. If another panelist's finding changes your mind, say so and
   say what changed it. If it does not, say why their evidence is
   insufficient.
4. **Converge on the direction.** Each of you gave a verdict in round 1.
   State your final verdict — `READY`, `READY WITH EDITS`, `NOT READY`, or
   `DIFFERENT DIRECTION` — and, if it differs from round 1, what moved it.
   If you say `DIFFERENT DIRECTION`, the direction must be concrete enough
   to write a replacement RFC from: the kinds, the surface, what it costs
   in guarantees, and what it buys.
5. **Name the changes the RFC must take** to be READY, as a numbered list
   ranked by importance, each one line with the section it changes. Where
   the three of you proposed different fixes for one finding, pick one and
   say why.
6. **Name what should be deleted** from the RFC — anything that does not
   pay for itself.
7. **The nine author decisions (§9)**: one line each, your final
   recommendation, noting where the panel splits.

## Your output

A single Markdown file to `OUT`, at most about 2,000 words, in this order:
final verdict and one paragraph on the direction; agreements (one line
each); disagreements argued; the ranked change list; deletions; the nine
decisions; one closing paragraph addressed to the author. Do not pad. Do
not restate round 1.

---

## Orchestrator's verification notes (read before responding)

The orchestrator checked every engine claim in the round-1 reviews against the tree at `6d3d09c6f`. Treat these as settled facts for round 2; where a review's claim was wrong, the correction is here.

### Verified true

- **The `_commits` ledger is trimmed** to the last 10,000 rows, in the engine, on every commit (`snapback2/crates/snapback2-core/src/engine/mod.rs:1381-1385`), not in `store.rs`. Muse's "could not verify a trim" is resolved: the RFC's claim was correct. Its B1 point stands on its other leg — deleting from the ledger removes what `trace` attributes.
- **`system` in a rule lowers to `Eq(Viewer, Literal(Id(systemPrincipalId)))`** (`packages/compiler/src/lower/schema.ts:364-365`); `RuleExpr` is `Public | Allow | Deny | Eq | Ne | And | Or | Not | Exists | Created` and `RuleTerm` is `Field | OldField | NextField | Viewer | Literal` (`snapback2-core/src/schema.rs:~269-350`). The reserved principal cannot be an application actor (`identity.rs:69-71`, `E_AUTH_RESERVED`); seed and caller values may not carry it (LLP 1001 §4). So a static authority test is well-posed as a three-valued evaluation with `Viewer := system`: `Eq(Viewer, Literal(system))` is true, `Eq(Field, Viewer)` is false (no stored field can hold the reserved id), `Allow`/`Public` true, `Deny` false, `Exists`/`Created` unknown, `Not`/`And`/`Or` Kleene. Both Muse M1 and grok B3 are right that the RFC's "has a `system` disjunct" wording is neither sound nor complete; the precedent for static rule evaluation already exists in `certificate_policy.rs` (uniformity hoisting).
- **A mutation commits regardless of a `Limit`-stopped page**: the mutation state is `Committed { seq }` unconditionally (`engine/mod.rs:708`); `Capped` is computed only for queries (`mod.rs:1243-1270`). The "silent fifty" is real in the runtime. **But** the chat template caps groups at 50 members through a maintained count (`templates/chat/snapback/groups.q:16`, `require #memberCounts[conversationId] < 50 else GROUP_FULL`), and the brief's M3 is "2–50 members" (`benchmarks/briefs/social-messenger.md:489`), so the fifty-first member is unreachable in the template. Grok M1 is right; the RFC's §0 row overstates the hat.
- **The writer is one loop** with an empty idle arm (`snapback2/src/writer.rs:439-480`: `recv_timeout` → handle one request, `Timeout => {}`), already running idle-time sweeps for assets and sessions there; after every commit it reruns every invalidated live query before returning (`writer.rs:1097-1133`, `after_commit` → `rerun_live`). Grok B1/M7 and Muse M3 stand: a chunk's cost is the write plus the reruns, and "only when idle" starves a continuation under load.
- **Constraints bind engine writes.** Maintained-target writes bypass user rules but never constraints or unique indexes (`engine/runner_ops.rs:295-297`); `Immutable` fires on update and `Unique` on every non-delete (`runner_ops.rs:455-467`). `profiles` has `unique byPrincipal: principal` and `immutable principal` (`templates/chat/snapback/schema.q:3-17`); `memberships` has `unique byConversationPrincipal` and `immutable … principal`. Grok B2 and Muse B2 are confirmed: D6's scrub-to-`erased` is refused on `profiles` by `immutable` and collides on `unique` for the second erased user on any such table.
- **Narrowing is not admitted today**: `Optional(T) ≠ T` is `Drop::TypeChange` (`successor.rs:164-168`), refused as destructive (`:196-198`); the required-column walk (`:214-228`) runs after. Grok M2 is right that D5 needs a new branch; the row walk it needs exists (`validate_stored_rows`).
- **Successors already rebuild maintains over all rows in the successor transaction** (`successor.rs:648-672`, `projected_backfill_rows`). The brief's M7 "backfilled field: every conversation gains a message count … backfilled over all existing conversations and maintained forward" (`social-messenger.md:688-692`) is that path. Grok M9 is right: M7's count is not a job customer.
- **The brief's M8 digest requires periodic server-side work**: "emission is driven by the schedule alone — it requires no connected client and no client interaction, so lazy read-triggered evaluation cannot satisfy it" (`social-messenger.md:757-760`). Grok M4 is right that `every` (or an equivalent) is what M8 needs; the RFC's §9.1 fallback (an external trigger) would put the bar's work outside the product.
- **The celebrity fixture is 900 followers** and the brief names the cost as "whether a lane fans out on write or filters at read time" (`social-messenger.md:140-147`); the paved read-side form is `merge` (LLP 1010 A5).
- **Seed is an engine entry point** (`registry.rs:803-808` → `execute_seed`), exempt from rules, bound by constraints — the pattern grok B3 proposes for declared jobs.
- **The twin's `Emit` consumes one id** (`packages/evaluator/src/runner.ts:167-171`); `WriteKind` has no `Enqueue` today (`certificate.rs:135-141`). `Emit` pushes an `EmitRecord` and bumps the `_outbox` write (`runner_ops.rs:363-374`). Muse B3 is right that a cursor write in the chunk transaction is an engine write the certificate must carry; the `Emit` accounting is the template.
- **`Context::system` is private** (`engine/mod.rs:57-71`) and `Actor::new` rejects the reserved id (`identity.rs:69-71`); `--as system` cannot be a persona. Grok M6 is right that D4 needs a purpose-specific entry point, like `execute_then`.
- **`_commits.kind`** is `"mutation" | "system" | "seed"` today (LLP 1001 §2); widening it is a store-format change the fence allows.
- **LLP 1002's title still says "thirteen verbs"** (`llp/1002-dev-loop.spec.md:1`) while its text says fifteen; pre-existing.
- **Clique Pay has settle and no close of books** (`benchmarks/briefs/clique-pay.md:19-53`); the brief, not the RFC, named it as a job customer.
- **LLP 1015 D1 lists `POST /control/fork` as a dev route refused in `serve`** (`llp/1015-control-plane.rfc.md:139`); the `fork` CLI adapter is ~13 lines (`verbs.rs:242-254`) over `POST /control/fork` (`control.rs:93`).
- **`/control/clock` exists** (`control.rs:154`); the effects runner wakes on emitted commits and a one-second timer (`snapback2/src/effects.rs:1-3`; LLP 1003 §4).

### Not verified, or verified against a review

- Muse's "I found the table and the reset delete but no trim" — see the first bullet; the trim is in the engine.
- Grok's claim that `deliveries.insert` is `exists memberships[.conversationId, viewer]` is verified (`schema.q:87`); its consequence — that an `or system` rewrite there lets any system writer insert arbitrary delivery rows — is a design argument the orchestrator accepts.
- Neither review ran anything; nothing in the RFC has running code behind it.
