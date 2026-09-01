# Panel: the state of Snapback 2 — Round-2 cross-examination brief

**Type:** Review input
**Date:** 2026-09-01
**Panel:** codex gpt-5.6-sol (ultra), grok-4.6 (xhigh)
**Related:** LLP 1007, `llp/reviews/1007-snapback2-state.panel.{codex,grok}.md`

Preserved verbatim so the panel verdicts can be read against what was actually
asked. The framing, the candidate lists, and the adjudication in the round-2
brief are the orchestrator's and were not neutral prompts.

---

# Round 2 — cross-examination

You wrote a panel document. The other panelist (a different model family)
wrote theirs blind. Both are attached. Read the other one.

You agree on the headline, and strongly: Quarry is directionally right, the
"default + fully-supported compatibility surface" ruling is the Snapback 1
two-profile mistake, and — decisively — **the flip is not implemented**.
Neither of you had to argue for that; you both went and checked. The
orchestrator independently confirms it: `quarry` appears nowhere in
`snapback2/crates/`, `init.rs` accepts only `todos|chat` over `schema.ts`,
`scripts/test.sh` never invokes quarryc, and there is no `guide/quarry.md`.
That is settled. **Do not re-argue it.**

You disagree on four things. Answer only these, plus the last question.
Short. No preamble, no restating your own document.

---

## D1 — the bar's actual scope (the orchestrator has adjudicated this one)

grok wrote: assets are *not* on the bar; don't implement LLP 1006 until
Clique-without-media is green. Effects *are* needed, for M3 notifications.

sol wrote: the canonical brief requires avatars, 1–4 images, one video, and
an Expo client; effects serve post-bar I/O and should be deleted.

**Adjudication — sol is right on the facts, and grok is wrong in both
directions.** `benchmarks/briefs/social-messenger.md:397` (M1) requires an
avatar image; `:428-430` (M2) requires "images (1–4 fixture images); video
(exactly 1)"; `:19-22` makes the client Expo for iOS/Android/web with a
per-milestone iOS Hermes bundle. And `:96-102` puts "email sending, SMS,
… real APNs/FCM delivery" out of scope **everywhere** — so M1–M3 needs no
external I/O at all, and grok's "Clique M3 notifications need effects" is
wrong too.

The live finding is what this does to `rules/NOT-DOING.md`. Line 9 restates
the bar as "accounts, feed, realtime chat" — a paraphrase that drops avatars,
images, video, and Expo, i.e. precisely the capabilities whose absence fails
it. The file called "the most valuable file in the repository" understates its
own acceptance bar, and NOT-DOING then lists media as not-being-built while
LLP 1006 sits in Draft.

**Both of you: given that, what is the right move?** Concretely — does
NOT-DOING.md's bar line get corrected to match the brief (making assets and
Expo required work, which is a lot), or does the *bar* get formally reduced to
the paraphrase (a smaller, honest first target, with the brief as the later
one)? Pick one and say why. This is the highest-stakes question in the round
and it is genuinely open; the author will decide it, so give them the real
trade, not a hedge.

## D2 — effects / Ibex 2

sol: delete the crate, the outbox, `emit`, and Hermes (rank 5). Post-bar
external I/O, a second runtime, and it evaluates effect source at job time
(`ibex.rs:304-331`), which contradicts RULES.md's "nothing compiled at runtime."

grok: keep. The only JS seam; default build links none; deleting it puts JS
back in the data plane or I/O in mutations.

grok — your stated reason (M3 notifications) is now falsified. Does your
answer change? sol — the outbox is a *transactional* durable-job primitive
that a scheduled daily digest and push both eventually need; is "delete" or
"keep, unwired and unpublished" the cheaper option, given that re-adding a
transactional outbox later is not a small change?

## D3 — the client IR evaluator twin

sol: delete `packages/evaluator` and the Rust `ClientStore` replay (rank 6).
Not in the public exports; nothing in the shipped client path.

grok: keep. It is the corpus twin in `scripts/test.sh:10` and the proof that
the IR is one language; 7.8 KB; it is the web arm when offline arrives.

This is a real disagreement about what the corpus is *for*. Settle it: is a
second independent implementation of the IR a load-bearing correctness
instrument, or is it a second thing that must agree before either can change?

## D4 — the 40 `random-*` corpus cases

sol: delete — five deterministic samples of eight fixed templates, each
embedding the full schema; generated projections are committed against
NOT-DOING.md.

grok: keep — they catch interpreter drift between Rust and the twin; cheap.

Note this collapses into D3: if the twin goes, the random cases have no second
implementation to disagree with. Say whether your D4 answer is conditional on
your D3 answer.

Also, for both: `corpus/` is 2.8 MB of committed generated JSON, of which
`manifest.json` alone is 826 KB, in a repo whose NOT-DOING.md bans committed
generated code. Is that a defensible exception (a cross-implementation
conformance fixture genuinely needs pinned bytes) that should simply be
*written down*, or is it the rule being broken?

## D5 — one thing you got wrong

Name the strongest point in the other document that you missed or got wrong,
and say plainly that you were wrong. If there genuinely isn't one, name the
weakest claim in the other document instead and say why it doesn't hold. One
paragraph. Do not do both.

---

Write to the output path given in your prompt. Cite `path:line`. Be brief —
this round should be a fifth the length of your first document.
