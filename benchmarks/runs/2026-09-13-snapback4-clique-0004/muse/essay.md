# Essay: building Clique on Snapback 4

## Where I started

I built Clique — a social messenger with profiles, follows, feeds, DMs,
groups, media, reactions, receipts, digests, and offline queueing — cold, in
one lane, against `snapback4@0.2.6`, with no access to any prior
implementation. Everything below is grounded in that run: 8 milestones green
(M1–M6 plus M8 and a live milestone, 133 acceptance checks), a 36,809-action
deterministic scale replay verified against independent end-state probes, and
a run log of every correction loop with attributions. Where I compare against
systems I did not run in this lane (Convex, Supabase, earlier Snapbacks), I
say so; the Snapback side of each comparison is observed, the other side is
prior knowledge.

## What this backend is

Snapback 4's thesis is that the backend is a *compiled artifact*: you write
`schema.q` — tables, read rules, mutations, queries, jobs, schedules, and
effects in one small language — and `snapback4 check` either accepts it or
refuses with a code. The refusal is the product. Over this build the compiler
refused me for sync-proof failures, ambiguous quarries, hidden-row upsert
collisions, and malformed upserts, across roughly 6 schema-compile iterations
before the first green check and several more mid-build. Each refusal named a
rule (`E_SYNC`, `E_RULE`, `E_QUARRY_AMBIGUOUS`) and a site. I came to treat
`check` the way a Rust programmer treats `rustc`: the adversarial colleague
who is always right about the thing you didn't think through.

That is the core difference from Convex. In Convex you write TypeScript
functions and queries; the platform gives you reactivity, transactions, and
scheduling, and it trusts you to get authorization and consistency right —
you find out at runtime, in production, via a user seeing someone else's row.
Convex's answer is social: validators, code review, testing. Snapback 4's
answer is mechanical: the read rule (`read <- ...`) and the sync proof are
checked before the backend exists. Concretely, my `live` milestone work
(social tables visible to sync) failed acceptance 4 times on
"sync-blindness" — follows, likes, reposts, and replies that mutations wrote
but sync couldn't see — and every one of those was a schema-declared
visibility fact, fixed in the schema, re-proven by `check`, not a runtime
discovery. In Convex that class of bug is a misconfigured query function that
passes all your tests because your tests sign in as the wrong user. The
compile-time proof doesn't eliminate the bug — I still wrote it four times —
but it moves the argument from "did QA catch it" to "the compiler lists it."

Supabase sits at the opposite pole: Postgres with Row Level Security. RLS is
expressive — arbitrary SQL predicates — and that expressiveness is the trap.
An RLS policy is a string in a migration; it composes badly, fails open in
surprising ways (a missing policy on a new table is public-by-default
depending on setup), and can only be tested by probing. Snapback's quarry
language is far less expressive than SQL — I hit `E_QUARRY_AMBIGUOUS` and had
to reshape two queries to say what I meant more simply — but the read rules
compose with the sync engine by construction: if it compiles, every device
sees exactly what the rule allows, including offline. I traded SQL's power
for a closed world where visibility is total and checkable. For a social app
whose hardest bugs are all "who can see what," that trade was worth it. For
an analytics workload it would not be.

## Where it reduced friction

Three things were genuinely faster than the alternatives I know.

First, **idempotency as a language feature**. `insert ... if absent`,
set-state verbs, and client-generated ids meant my replay adapter — 36k
actions driving the real auth+mutation path — could retry anything under a
fresh wire id without fear of double-apply. When my own early failures
poisoned wire ids (the server replays recorded failures *by wire id*, which
cost me a debugging session), the fix was a nonce, not a redesign. In
Supabase, exactly-once replay is a stored-procedure-and-unique-constraint
project; in Convex, you'd build the dedupe table yourself. Here it fell out
of the mutation model.

Second, **jobs, schedules, and effects in the schema**. The celebrity fan-out
(270 followers × 60 posts), the per-minute fan-out job, the digest scheduler,
and the `notify` effect with its worker seam all live next to the tables they
serve. There is no separate queue system to provision, no cron to configure,
no webhook table to migrate. The push seam being a schema-level effect with a
`replayMode` flag I could pin during scale replay — receipts and feeds
normal, notifications suppressed — is the kind of testing seam that in other
stacks requires a feature-flag service and a prayer.

Third, **the generated contract**. `snapback/generated/api.ts` gave the Expo
client exact row types for 34 tables; the custom-client demo and the web UI
never once disagreed with the backend about a field name. This is table
stakes for Convex (generated types from function definitions) and genuinely
good there too, but it is notably absent in Supabase, where the client holds
its own TypeScript mirror of the schema and drift is a lifestyle.

## Where it added friction

The compiler giveth and the compiler nitpicks. The hidden-row upsert
collision rule — 8 iterations, my longest single correction loop — refused an
upsert pattern that was obviously correct to me and took a diagnostic plus a
README re-read to understand: I was fighting a rule about storage internals
leaking through the language. The digest upsert had to become public-read
counters, a redesign forced by a constraint I still believe is incidental
rather than essential. A mature Convex or Supabase flow would never have
stopped me here — which cuts both ways, since "never stops you" is also how
you ship the visibility bug.

The quarry language is small, and small languages make you small-minded in
patches: two of my feed fixes (unfollow/unrepost purge with retracts, 3
iterations; digest double-bump, 1 iteration) were really about expressing
"remove exactly these derived rows" in a language that prefers to derive, not
delete. Postgres would have taken a `DELETE ... WHERE`. I don't miss SQL
often, but retractions are where I missed it.

Operationally, the dev loop has rough edges the others have sanded down: auth
rate limits that required backoff harnesses in every script I wrote (signup
storms during seeding are *load, not waste*, per the brief — but the limiter
doesn't know that), no `setsid`-style process story on macOS for managed
servers, and a `data` admin command that bypasses read rules (useful, and
slightly alarming — it's the one place the proof doesn't look).

## Earlier Snapbacks, from inside the repo

I was forbidden from inspecting earlier generations, so this is strictly what
the lane's own documents record: the choreography specs describe a P1 that
specified `simctl` mechanics without freezing an app-side receipt protocol
("ceremonial evidence"), and a P2 that re-scoped native proof into separately
recorded artifacts rather than promoting them into web green. That history is
visible in the tooling I used: `choreography.mjs` accepts external simulator
statuses with `requiredForGreen:false`, and the receipts schema versions
itself (`0.3.8-m8`). The pattern is a platform learning, generation over
generation, to separate *web-authoring signal* from *native proof* instead of
letting one block the other. My run honored that split: web green in-lane,
simulator artifacts recorded separately (an iOS Hermes bundle export; the
interactive offline proof remains a gap, honestly logged). If there is a
single sentence for how Snapback 4 differs from its ancestors, it is this:
the proof moved into the compiler, and what couldn't move into the compiler
was explicitly decoupled rather than faked.

## How it changed the shape of the work

The milestone order (M1 profiles/auth → M2 social → M3 messaging → M4
refinement → M5 settings → live sync → M6 offline → M8 digests) plus the
replay-first contract inverted my normal build order. I wrote almost no UI
until the wire path was green; the "client" for most of the build was a
headless adapter, and the Expo app — pending marks, asset cache, conversation
view — was a second implementation of read paths the adapter had already
proven. That felt backwards for about a day and then felt correct: every UI
bug I fixed thereafter (the `onPick` reactor prop, the `likeCount`
sync-blindness, the offline queue pending marks) was a *presentation* bug,
because the data path underneath was already settled. In a Convex or
Supabase build I would have grown UI and backend together and debugged them
together, which is faster until it isn't — the failures are entangled and
every fix needs both halves re-verified.

The deepest change is attitudinal, and the run log shows it: my correction
loops are labeled `agent-error`, `ambiguous`, or `environment`, and the
schema-driven ones converged in 1–4 iterations while the environment ones
(ffmpeg's missing x265 dylib, simulator absence) lingered. When the backend
is a proof, your mistakes get shorter; what remains is the world — broken
host libraries, missing devices, rate limits. I spent the last fifth of this
build fighting the machine, not the model. That is, I think, the honest
advertisement for this backend: it disposes of an entire class of
self-inflicted wounds efficiently, and bills you only for reality.
