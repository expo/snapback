# Diary 0056 — Warble, a local-first microblog on Snapback + Expo

**Demo:** `demos/warble`
**Surfaces:** Expo (iOS / Android / web) on `@expo/snapback-client` +
`@expo/snapback-react`
**Date:** 2026-08-04
**Brief:** build a Twitter-shaped app that uses as much of the built
local-first/offline machinery as actually exists, and record what the
experience was like.

---

## 2026-08-04 — build

### What I was aiming at

A microblog is a good stress test for local-first claims because it has the
two shapes that usually break: an append-heavy public feed (should survive
offline trivially) and a per-viewer toggle with a denormalized counter (the
thing that double-counts if you get it wrong). I wanted both to work with the
network off.

### The one design decision that determined everything else

Cold retention on the JS arm is **per-query and opt-in by declaration**. A
Snapback app gets zero offline retention until a live query declares
`auth: 'public'` + `authorityIndependent: true`, from which the server derives
`rqsEligible` and mints a resume token. That much the guide says clearly and
`guide/sync/offline-and-retention.md` is genuinely good on it.

What the guide does *not* say, and what cost me the most thinking time, is how
that interacts with the like button. The optimistic-toggle recipe
(`guide/recipes/optimistic-toggle.md`) is emphatic that the viewer's `liked`
fact must live in the query result, not component state:

> If `liked` is not in the query result, there is nothing authoritative to
> reconcile against, and component state is the only place left to put it —
> which is exactly the anti-pattern.

But `authorityIndependent: true` is the trusted declaration that *the complete
result is identical for every caller*. Those two requirements look flatly
contradictory: a per-viewer field cannot be in an authority-independent query.
Taken at face value, you can have the offline timeline or the like button, not
both.

The escape hatch is real but undocumented, and I only found it by reading the
predicate in `packages/snapback-codegen/index.mjs:352`:

```js
|| (plan.filters ?? []).some((filter) => serializedValueUsesAuthorityOrAmbientInput(filter.value))
```

`serializedValueUsesAuthorityOrAmbientInput` walks `Field`/`Binary`/`Unary`/
`If`/`Concat`/`Call`/`Record` and returns `false` for everything else —
including `Arg`. So a query filtered by `eq('userHandle', arg('handle'))` is
authority-independent, while the semantically identical
`eq('userHandle', authUserId())` is not. **Viewer scoping by argument retains;
viewer scoping by authority does not.**

That let me split the problem: `timeline` carries `likeCount`, `myLikes(handle)`
carries the viewer's like rows, both are `rqsEligible`, both cold-retain, and
the client derives `liked = likeSet.has(post._id)`. The heart survives a cold
boot with the server down.

**This is a real finding and it should be in the guide.** The offline page
teaches the opt-in and the toggle recipe teaches the viewer-fact rule, and
nothing connects them. An author who follows both pages honestly will conclude
the combination is impossible and reach for component state — the exact
anti-pattern the recipe warns about. Filed as a guide gap.

The cost of the workaround is honest and worth stating: argument-keyed viewer
scoping means the *server does not enforce* that you only read your own likes.
For a public like set that is fine. For anything private it would be wrong, and
the correct answer there is the lease-backed `retainable: true` path on the
Contract arm, not this trick.

**And then the workaround broke the toggle recipe at runtime.** Charlie caught
this in the running app before I did: every like tap rendered

```
SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED: value did not satisfy the generated
result contract
```

The cause is the direct consequence of the split above.
`projectRecordFields(id, { liked, likeCount })` — the exact call the recipe
teaches — spreads both fields into the timeline row (`{ ...row, ...intended }`).
But `liked` is not a column on `posts`; that is the whole point of having split
it into `myLikes`. The projected row violates the generated result contract and
the layer is refused.

The only correct projection is `{ likeCount }` alone, and the consequence is
that the count moves instantly while the heart fills only when `myLikes`
delivers — flipping it optimistically would mean appending a row to that query,
an optimistic *create*, which the recipe itself says has no paved path yet.

So the two pages don't just read as contradictory, they *are* incompatible in
their taught form: satisfying the retention page's opt-in makes the toggle
recipe's own snippet throw. Worth emphasizing that the platform caught it
properly — the result contract refused a malformed optimistic row before any
network work, which is the machinery behaving exactly as designed. The failure
was loud, specific, and pointed straight at the cause. I still shipped it
broken for a few minutes because I never clicked the button; the acceptance
suite covers the *mutations*, not the React projection over them.

### Denormalization is not a modeling choice here, it's a constraint

`rqsEligible` requires `summary.mode === 'singleTable'`. So the retainable
timeline cannot join to `profiles` for the author's display name — it has to be
denormalized onto every post. That is a defensible design for a feed, but it's
worth being explicit that the platform *forces* it rather than merely allowing
it. Any field you want visible offline must be flattened into the one table the
query reads.

### What went well

**Codegen fails closed with real diagnostics.** My first `likePost` used
`mutationPlan(...)` for a multi-step plan; codegen refused with
`likePost: unsupported mutation step __mutationPlan` and wrote nothing. It
turns out `plan:` takes a plain array and `mutationPlan()` belongs to
`defineWriteWithActivity`. The failure was instant and specific, and crucially
it left the previous serveable graph intact. Compare Convex, where an equivalent
mistake usually surfaces at call time.

**The declarative mutation IR is more capable than I expected.** I assumed
"insert a like row and increment a denormalized counter atomically" would need
a JS handler, which would have silently cost me offline replay — *plan presence
is the replayability predicate*, so a `defineJsMutation` is not replayable. But
`get` + `letBind` + `add`/`sub` + `patch` express it fine:

```js
plan: [
  get('posts', arg('postId'), 'post', { elseError: 'POST_NOT_FOUND' }),
  insert('likes', { postId: arg('postId'), userHandle: arg('userHandle') }),
  patch('posts', arg('postId'), {
    likeCount: add(field(bindingRef('post'), 'likeCount'), lit(1)),
  }),
],
```

So liking works offline, queues durably, and replays in order. That is a
genuinely strong result and I did not expect to get it.

**The result-contract nudge is well-judged.** Codegen doesn't fail when you
omit `result:` — it emits a `degraded` line naming the exact file, line, column
and the fix. Warning-not-error is the right severity, and the message is
actionable enough that fixing three of them took one edit.

**Acceptance testing is the best part of the platform.** The harness
(`demos/_kit/harness.mjs`) with `expectedChecks` guards against vacuous passes,
and `demos/public-dashboard/tests/acceptance/offline-local-first.mjs` is close
to a copy-paste template for "prove your app is actually offline-capable."
I adapted it in one pass and it caught nothing wrong, which is itself the
point: I could *prove* the local-first claims rather than assert them. The run
is 6/6, and the assertion I care about most is:

```
assertEqual(liked.likeCount, 1, 'replayed like incremented exactly once (no double-apply)');
```

### What was hard, surprising, or bad

**The headline feature does not actually work on the browser arm, and I only
found out by testing it.** This is the most important thing in this diary, and
it started as a docs complaint that turned into a real defect.

The two guide pages contradict each other. `guide/clients/react-expo.md` says
`prepareReactBinding` needs the server reachable and therefore "hook-path
rendering cannot start offline." `guide/clients/react.md` — reviewed one day
later — documents a persisted binding receipt that makes exactly that work, and
`packages/snapback-client/react-binding.mjs:456` implements it
(`source = 'persisted-receipt'`). I assumed the Expo page was simply stale and
wrote the ticket that way.

Then I tested it, because claiming offline works without booting the app
offline would have been exactly the kind of assertion this platform's honesty
machinery exists to prevent. Warm run against a live backend in headless
Chrome: renders, connection `live`. Stop the backend, reload the same browser
profile: **`COULDN'T START WARBLE / Failed to fetch`**, with
`{"implementation":"indexeddb","durable":true}` printed right underneath.

Dumping IndexedDB from that profile explains it:

```json
{"store":"entries",   "keys":["myLikes {handle:ada}","profiles {}","timeline {}"]}
{"store":"outbox",    "keys":[]}
{"store":"storeMeta", "keys":["state"]}
```

The retained rows are all there. The binding receipt — written to the `outbox`
store at `rqs-store.mjs:544` — was never committed. So `prepareReactBinding`
has nothing to adopt, throws, and the provider is never constructed. The app
sits on top of its own perfectly good retained data and refuses to boot.

The probable mechanism: `persistBindingReceipt` is fire-and-forget
(`void Promise.resolve(...).catch(() => {})`) and the IndexedDB commit refuses
with `if (!this.isWriter()) return false;`. `prepareReactBinding` runs at the
very start of boot, plausibly before Web Locks writer election settles, so the
receipt commit returns `false` into a discarded promise. Query rows written
later succeed because the lock is held by then. That fits the evidence exactly,
though I did not instrument `isWriter()` to confirm it.

Two lessons worth keeping:

1. **The failure is invisible by construction.** The commit result is dropped,
   nothing logs, and the only symptom appears at the exact moment the user is
   offline. For a platform whose entire pitch is refuse-with-clarity, a
   silently discarded `false` on the flagship path is the wrong default.
2. **`durable: true` is not the same as "offline will work."** The store fact
   was honest and still told me nothing about whether the app could boot.

Filed with full evidence and a repro:
`issues/20260804-guide-gap-react-expo-offline-cold-boot.md`. It lands inside
the already-tracked GAP in
`issues/20260801-guide-gap-js-arm-browser-indexeddb-proof.md`, which warns that
browser/IndexedDB React behavior is not certified by the Node receipt. That
warning was correct, and this is what it looks like in practice.

**Correction to the above, found by searching `issues/` instead of trusting my
own novelty.** The React cold-offline gap was *already tracked and closed* —
`issues/closed/20260801-0137-reverify-react-cold-boot-binding-requires-server.md`
describes exactly this and specifies the fix shape that shipped as
`source: 'persisted-receipt'`. So my ticket is not a discovery, it is an
incomplete-fix report: the fix does not hold on the browser/IndexedDB carrier,
which is precisely the carrier that closed ticket's own witness ("a fresh
node/jsdom process") never covered. I rewrote the ticket to say so. Worth
remembering in a repo with this much prior art: check `issues/closed/` before
claiming anything is new.

**The device found a third thing I could not reproduce.** On a physical iPhone
the app showed `Live` in the header, a retained frame, and
`Retention: SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` on a query that provably *is*
eligible — plus the correct downstream `SNAPBACK_REACT_OPTIMISTIC_STORE_MISSING`
refusal, because an optimistic layer needs a *current* authoritative store.

I chased the obvious explanation (LLP 0090 D3 withholds the resume token when
the outbox is non-empty) and **disproved it**: on the Node carrier an
offline-seeded handle with a queued intent reports `resume: null` but still
`retainable: true, code: null`. A withheld token does not produce that code.
Clean subscribe, pending-outbox subscribe, offline-seeded, and post-reconnect
all report `retainable: true`. Web doesn't show it either. So it is RN-specific
and I could not reproduce it without the device.

My first guess was the "permanent public-query blanking" half of
`issues/closed/20260801-0137-a1expo-f7-rn-connection-cycles.md`. So I made the
app print the whole fact set next to any retention refusal — a bare code told me
almost nothing — and asked for another screenshot.

**That one change turned a shrug into a real narrowing, and killed my theory.**
The device came back with:

```
SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
freshness=current  connection=live  status=ready
outbox=0/0  store=file
```

Every supporting fact is *healthy*. Not stuck retained. Not cycling. Empty
queue. The Expo file store registered and resolved. The retained frame in the
first screenshot was incidental — the actual defect is narrower and stranger: a
perfectly live, current, ready client is simply refused retention.

That let me rule things out instead of speculating:

| carrier | provider | retention |
| --- | --- | --- |
| Node headless (4 scenarios) | — | `retainable: true` |
| Web / IndexedDB | React provider | `retainable: true` |
| iOS / Expo Go / file store | React provider | **`NOT_RQS_ELIGIBLE`** |

Ruled out: outbox withholding (`0/0`, and separately disproved on Node), a
degraded store (`file`), f7 blanking/cycling (`live`+`current`+`ready`), and
"the provider doesn't ask" — `preparedPersistResume` resolves to `true` on both
React carriers (`snapback-react/index.mjs:285`). Same server, same query, same
provider, and only the RN carrier is refused.

I stopped there rather than keep reading client source. The one asymmetry I'd
instrument next: the Expo file store honestly reports `durable: false`
(`native-files-no-power-loss-cut`) where IndexedDB reports `true`. If anything
in the resume path gates on durability, that produces exactly this split — and
would mean the carrier's honest power-loss caveat silently disables retention
wholesale, contradicting the react-expo page's claim that the registered file
arm enables cold-boot retained render. I did not confirm such a gate exists,
and I've said so in the ticket rather than dressing a hunch as a finding.

**Then a third capture arrived and I had to withdraw part of that.**

```
SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE
freshness=retained  connection=live  status=refreshing
outbox=0/0  store=file
```

So the device shows *two* states, both `NOT_RQS_ELIGIBLE`, both with an empty
outbox and a working file store:

| capture | freshness | status | connection |
| --- | --- | --- | --- |
| 2 | `current` | `ready` | `live` |
| 3 | `retained` | `refreshing` | `live` |

Capture 3 is a query that **never settles** — retained rows holding
`refreshing` on a live connection, with the authoritative answer never landing.
That also fully explains the `OPTIMISTIC_STORE_MISSING` beside it: the
optimistic layer needs a *current* authoritative store, and this one never
becomes current.

**I had to walk back "f7 is ruled out."** I'd concluded that from capture 2
being healthy — one sample. A non-settling retainable public query is squarely
in the f7 symptom family even without a visible 2s cycle. The ticket now carries
that as an explicit withdrawal rather than a quiet edit, because a wrong
"ruled out" in a ticket is worse than no ticket: it steers the next person away
from the right harness.

**The deduction I'm most pleased with, though, came from reading the client's
own write gate.** Retained rows can only exist if the client *previously held a
server-minted resume token* — persistence requires both:

```js
if (!held || authorizationFence || authorizationFaulted) return;
if (handle.freshness !== 'current') return;
```

So the phone got a token, went current, and persisted. And now reports
`NOT_RQS_ELIGIBLE`. That reframes the whole bug: it is **not** "RN is never
eligible," it is "**RN loses eligibility across subscribe attempts**." Same
query, same carrier, different answer at different times. Much sharper, and it
came from three screenshots plus one gate in the source rather than from
guessing.

Suspected trigger, untested: the react-expo page notes the React provider "has
no app-lifecycle seam of its own" and that RN WebSockets can emit `error`
without a follow-up `close`. A background/foreground cycle — which a manual
device session does constantly, including every time you take a screenshot and
switch apps — that reconnects the socket to `live` without re-establishing the
snapshot-with-subscribe would produce capture 3 exactly.

Confidence 2 → 4 across the three captures. **The lesson is about
instrumentation, not this bug:** the first screenshot cost an hour of wrong
theories; the fix was rendering five more facts next to the error, and it
converted every subsequent screenshot into real evidence. In a platform this
committed to honest state, *showing* the state is cheap and the payoff is
enormous. I should have built that line before shipping to the device.

**Then Charlie ran the lifecycle test and that hypothesis died too.** Two
captures across an explicit background → foreground cycle both came back
`freshness=current connection=live status=ready`. The `retained`/`refreshing`
state was transient and self-healing — not the defect. What survives every
capture is `NOT_RQS_ELIGIBLE`, regardless of freshness.

**So I built the local reproduction instead of theorising further.** The RN
ladder branch keys on `navigator.product === 'ReactNative'`, and the client
package ships `fake-expo-file-system.mjs` for exactly this purpose — so the
real ladder can be driven down its real RN branch from Node. It reproduces the
device's store precisely:

```
storeInfo  {"implementation":"file","durable":false,
            "reason":"native-files-no-power-loss-cut"}
retention  {"retainable":true,"code":null,"resume":"token"}
```

Identical store facts to the device, opposite retention result. **Durability
disproved.** The honest `durable: false` power-loss caveat does not gate resume
minting — which is a relief, because the alternative would have meant the
carrier's own honesty was silently disabling its headline feature.

That leaves a disproof table rather than an answer:

| hypothesis | verdict |
| --- | --- |
| non-empty outbox withholds the token | disproved (device `0/0`; Node counter-example) |
| background/foreground breaks it | disproved (two device captures) |
| `durable: false` gates resume | disproved (local RN-branch repro) |
| provider doesn't request resume | disproved (`preparedPersistResume === true`) |
| f7 blanking/cycling | not established |

Bounded to: **web + provider = retainable, RN + provider = not**, same server,
query, declaration, store class, and `persistResume`. What's left is the RN
runtime itself (Hermes has no WebCrypto, so digests take the pure-JS SHA-256
fallback and process-local labels take time+sequence) or something the
provider's registry does that the headless path doesn't. The decisive next step
is capturing the actual subscribe response on device: does the server decline to
mint, or does the client decline to keep it? Nothing I ran distinguishes those.

**Then I stopped hypothesising and read the wire.** Five dead hypotheses is a
signal that the question is wrong, not that the next guess will be better. The
question worth answering was binary and observable: *does the server mint a
token for RN, or not?* Everything else was downstream of that.

So I wrote a transparent TCP tee (`demos/warble/scripts/wire-tee.mjs`, ~90
lines, decodes masked client→server WebSocket frames because a raw grep misses
them), pointed both carriers at it, and compared:

```
WEB   (HeadlessChrome)   timeline resume_present=True
PHONE (Expo Go / Darwin) timeline resume_present=True
```

Identical requests too — same 389-byte body, same connection-token header,
differing only in `User-Agent` and the browser-only `Origin`/`Referer`.

**The server mints the token for RN. The client throws it away.** And the
device, reloaded through the tee, still reported `NOT_RQS_ELIGIBLE` in that
same session — so it is not stale state. The socket carries only ping/pong, so
there is no later re-subscribe whose token-less response could overwrite a good
classification. The one captured subscribe carried the token; the classification
still refused.

That flipped the ticket from "why won't the server mint for RN" (which had
consumed every previous update) to "the RN client drops a token it demonstrably
received," at confidence 5, with a byte-level repro.

**The lesson, and it is the biggest one in this diary:** I spent hours
generating and killing hypotheses about a system whose actual behavior I could
have observed directly in twenty minutes. Five disproofs felt like progress and
were mostly a substitute for looking. When a question is "which of two
components is wrong," the answer is usually on the wire between them, and a
proxy is cheap. I should have written the tee immediately after the *first*
contradiction between carriers.

**What I'd keep from the rest of the sequence:** four hypotheses, four
disproofs, and a bounded search — real progress, but progress that cost far
more than the measurement would have. The single highest-leverage
thing I did was not any of the reasoning; it was rendering five extra facts next
to an error message so that each screenshot became an experiment. The second was
discovering that the client ships a fake filesystem specifically so its RN
branch can be exercised off-device — that turned a "needs a phone" question into
a 40-second local run.

The second lesson is mine to keep: **I twice concluded from one sample.** First
"react-expo.md is just stale" (wrong — the fix exists but doesn't hold), then
"f7 is ruled out" (wrong — the next capture contradicted it). Both times the
correction came from more data, not more reasoning. For intermittent behavior,
one green sample is not evidence of absence.

**And one UI bug that was entirely mine:** the banner read "Offline — showing
saved posts" whenever `freshness === 'retained'`, while the header
simultaneously read "Live". Those are independent axes, and react.md says so
plainly — a retained frame on a live connection is a legitimate transient state.
I had conflated them, producing a screen that visibly contradicted itself. Now
it distinguishes "Showing saved posts — catching up…" from genuine offline.
Ironic failure mode for an app whose whole subject is rendering connection
facts honestly: the platform gave me two accurate facts and my UI merged them
into a false one.

**What DOES work offline, proven:** the headless client path. The acceptance
suite stops the server, constructs a fresh client, and renders both the
timeline and the viewer's like set from disk, queues a post and a like, and
replays them in order exactly once — 6/6. So the retention and replay machinery
is real; it is the React boot seam on the browser carrier that drops the thread.

**Identity has an awkward hole in dev mode.** The React provider owns identity
custody and deliberately exposes no per-call `userId` — correctly, per
`react.md`'s anti-pattern list. But dev auth *is* client-asserted identity, so
a dev-mode persona switcher has nowhere to put the acting user. I had to drop
`authUserId()` from `createPost` and pass `authorHandle` as an argument, which
means the client asserts authorship. That's acceptable for a demo and I've said
so in the code, but the honest summary is: **dev mode and the packaged React
provider don't compose for multi-persona apps.** The existing native demo
(`demos/partiful-matrix/native/react-expo`) sidesteps this by using the
checkpoint-era `useSnapbackQuery({ provider, name, args, userId })` bridge —
which `react.md` explicitly lists as an anti-pattern. So the one shipped Expo
example demonstrates the deprecated form.

**`registerExpoFileSystemRqsFiles` takes the web build down to a white
screen.** The guide's snippet shows it at the app root, unguarded:

```ts
registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
```

On web that throws at module scope — `expo-file-system is not supported on
web`, then `TypeError: this.validatePath is not a function` from
`new Directory(...)` inside `defaultDirectory`. Because it is module-scope, it
takes down the entire app: `#root` stays empty, no error boundary catches it,
and the page is blank with the failure only in the console. For a package whose
whole selling point is universal code, the paved snippet breaking one of the
three platforms is a sharp edge. The fix is a one-line `Platform.OS !== 'web'`
guard — and it costs nothing, because the persistence ladder already prefers
browser IndexedDB over registered native files, so the registration is inert on
web anyway. The guide page should carry the guard in the snippet.

**Expo module version numbering cost me a real detour.** I wrote
`expo-file-system: ~19.0.16` in package.json — a plausible-looking version that
resolves and installs cleanly. But SDK 57's expo-file-system is versioned
`57.0.1`, and 19.0.23's `File` has `move()` where the Snapback adapter calls
`moveSync(destination, { overwrite })` (`rqs-store-expo.mjs:134`). I briefly
believed I had found a platform bug. What makes this worth recording is the
*failure mode*: I caught it only because TypeScript flagged the structural
mismatch. In plain JS, or with `skipLibCheck` swallowing it, `rename()` — the
store's publication cut — would have thrown `moveSync is not a function` at
runtime, and the app would have looked completely fine while silently having no
durable persistence at all. `npx expo install` picks the right version; hand-
writing the constraint is the trap.

**Package linking is a papercut.** `@expo/snapback-react` declares a dependency
on `@expo/snapback-contract@0.1.0`, which does not resolve from the registry.
A fresh `bun install` fails with `No version matching "0.1.0" found`. The fix
is an `overrides` block pointing at the local path — which `partiful-matrix`
already carries, so this is known-and-worked-around rather than known-and-fixed.
Any new app hits it immediately.

**Exposing the backend to a phone needs two switches, and I only guessed one.**
A phone on the LAN cannot reach a loopback listener, so the dev server binds
`0.0.0.0`. `--allow-insecure-dev-auth` looked like the whole answer; it is not.
Booting still refused with:

```
SNAPBACK_AUTH_TRANSPORT_INSECURE: dev auth on a non-loopback listener requires
the explicit non-production override
```

The reason is in `resolve_profile` (`src/admin.rs:291`): with `SNAPBACK_PROFILE`
unset, the profile falls back to the **bind address** — `dev` on loopback,
`prod` on a real interface — and the prod profile refuses dev auth regardless
of the flag. So a LAN dev server needs `SNAPBACK_PROFILE=dev` *and*
`--allow-insecure-dev-auth`.

I want to be clear that this is good design, not a papercut: the dangerous
configuration (client-asserted identity reachable from the network) requires two
deliberate, differently-named acts, and the default for "someone bound this to a
real interface" is the paranoid one. Any typo in `SNAPBACK_PROFILE` also
fails closed to `prod` rather than silently granting capability. The only thing
I'd want is for the refusal message to name `SNAPBACK_PROFILE` — it says
"explicit non-production override," which reads like the flag I had already
passed.

**The runtime binary trap cost a cycle.** The prebuilt `target/debug/snapback`
was stamped from a different commit than the checkout, and the link probe timed
out after 90s (`SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT`) before refusing to reuse
it. The diagnostic did include the exact override
(`SNAPBACK_SERVER_BINARY=...`), which is good failure design, but for a
JS-only demo change having to think about Rust binary provenance at all is
friction. The subsequent "IDENTITY MISMATCH ... booting anyway because this
binary was explicitly configured" message is exactly the right honesty
posture.

### How I verified things, and where that failed me

Worth recording separately, because two of the three bugs Charlie found were
bugs my verification *should* have caught and didn't.

**What my acceptance suite covers:** the mutations and the retention/replay
machinery, at the client layer. Six checks, all green, and they were green the
entire time the app was visibly broken. That is not a criticism of the suite —
it is the correct scope for a headless acceptance test — but it meant the
green checkmark told me nothing about whether the product worked.

**What nothing covered:** the React projection over those mutations. The
optimistic layer is installed and validated in the React provider, so a broken
`projectRecordFields` call cannot fail a headless test. I shipped a like button
that threw on every tap, and I only learned it from a screenshot. The fix was
one line; the gap was that I never clicked the button.

**The headless-browser check I built after the fact was itself wrong twice.**
First it dispatched synthetic `MouseEvent`s via `Runtime.evaluate` — React
Native Web's `Pressable` ignores those, so the click silently did nothing and
looked like a pass. Switching to real CDP `Input.dispatchMouseEvent` fixed that.
Then it still did nothing, because my selector matched a 650px-wide *container*
whose `innerText` was `"♡\n0"` rather than the 54px `<button>` inside it — so I
was clicking empty space beside the target. Enumerating `[role="button"]` and
using its bounding box fixed it. Both failures were **silent passes**, which is
the worst shape for a test to fail in.

The lesson I'd carry to the next demo: for a UI whose whole subject is
connection state, a smoke test that asserts "the app rendered some text" is
nearly worthless. The assertions that would have caught real bugs are *drive
the control, then assert against the server*. That's what finally proved the
like worked (`myLikes` went `[seed_post_2]` → `[seed_post_4, seed_post_2]`,
`likeCount: 1`).

### Working with the toolchain

**Delegating the UI to codex was a wash on this task.** Per the standing
instruction I wrote a precise brief (the constraint set — rqsEligible, the
optimistic rules, offline honesty) and dispatched `codex exec gpt-5.6-sol` at
`xhigh`. It ran ~10 minutes with zero intermediate output — I had piped it to
`tail`, so nothing surfaced until exit, which made "is it working or wedged?"
unanswerable. I wrote a parallel implementation rather than idle, then killed
codex at the ~9 minute mark; it had in fact flushed its files moments before.

The result: two complete implementations of the same screen. Codex's was
larger and more thorough (error states, `likesReady` gating, better empty
states), so I kept it and deleted mine, then ported one correctness fix from
mine. But its code had eight type errors — invalid `fontWeight: '650'/'750'/'850'`
values, and named type imports from a module whose tsconfig path pointed at
`api.mjs` so TS never found `api.d.ts`. All mechanical, all caught by
`tsc --noEmit`.

Net: it produced good UI structure and cost a reconciliation step plus a
duplicate implementation. The brief was the valuable artifact — writing down the
constraints precisely was most of the thinking, and it's what made *both*
implementations correct on the hard parts. If I did it again I'd stream the
output and not write a parallel version.

**Something reverted my edits, twice, and it shipped a bug.** Edits I applied
with a `python` heredoc to `App.tsx`, `post-card.tsx`, and `warble-screen.tsx`
were silently reverted — imports came back reordered, suggesting a formatter or
a late writer. Two changes were lost: the `Platform.OS !== 'web'` guard (so the
web build stayed white-screened after I believed I'd fixed it) and the
`surface` prop threading. I'd verified the first with `grep` immediately after
writing and seen it present; it was gone later.

Both stuck once I used the `Edit` tool and read the file back afterward. The
lesson is blunt: in this repo, verify an edit *persisted* rather than that it
*applied*, and prefer the structured edit path over shell rewrites.

### Compared to React + Convex

- **Offline is a real platform feature here, not an add-on.** Convex's cold
  boot with the backend down yields an empty shell; Warble renders its last
  timeline and the viewer's likes. That difference is the whole pitch and it
  survives contact.
- **The honesty machinery has no Convex analogue and I came to like it.**
  `freshness: 'retained'` never being relabeled `current`, `retention.code`
  naming *why* a query refuses to retain, `pendingIntentsAtSeed` on the handle,
  `rqsStoreInfo.durable: false` on the Expo carrier with the reason
  `native-files-no-power-loss-cut` — none of this is decoration. Every one of
  them is a fact I needed to render a truthful UI.
- **The cost is declaration weight.** Convex: write a query, it's live. Snapback:
  decide auth class, decide authority independence, satisfy a single-table
  plan, keep mutations in the IR tier, and *then* you get retention. The
  ceremony buys something real, but "it just works" it is not.
- **Codegen-time refusal beats runtime discovery.** Every mistake I made was
  caught at generation with a file/line, not in the app.

### Guide notes

Followed `guide/index.md` → capability index → the offline, react, react-expo,
contract-adapter, mutations, and optimistic-toggle pages. The corpus is
genuinely well-organized and the `source=` transclusion means the code samples
are trustworthy. Two concrete gaps, both filed or noted above:

1. Nothing connects the `authorityIndependent` retention opt-in to the
   optimistic-toggle viewer-fact requirement. The `arg()`-vs-`authUserId()`
   distinction that resolves it is invisible outside the codegen source.
2. `react-expo.md` is stale on offline cold boot — though the deeper problem is
   that `react.md`'s replacement claim does not hold on the browser carrier.
3. The `registerExpoFileSystemRqsFiles` snippet needs its `Platform.OS` guard;
   as written it white-screens the web build.

### Evidence ledger

Separating what I proved from what I believe, because this repo's culture is
right that those are different things.

**Proven, with receipts:**

| Claim | Evidence |
| --- | --- |
| Timeline + viewer's like set are both `rqsEligible` and cold-retain | `tests/acceptance/offline-local-first.mjs` 6/6 — `retainable: true` + server-minted resume tokens |
| A fresh client renders both from disk with the server stopped | same suite, check 3 (`freshness: 'retained'`, `connection: 'stale'`) |
| Offline compose + like queue durably, in order | check 4 (`['createPost','likePost']`, monotonic sequences) |
| Retained frames stay pre-intent while writes pend | check 5 (`pendingIntentsAtSeed: 2`, rows unchanged) |
| Reconnect replays exactly once, counter correct | check 6 (`likeCount: 1`, not 2) |
| Like/unlike round-trip in the real app | CDP-driven click; server `myLikes` toggled both directions |
| App renders on web, iOS, Android | all three bundle 200; headless render asserts seeded rows |
| Web app boots and shows `Live` | headless render check |

| Web is retainable under the React provider | diagnostic renders whenever `retainable !== true`; line absent on web |
| RN is NOT retainable under the same provider | device capture: `NOT_RQS_ELIGIBLE` with `freshness=current connection=live status=ready outbox=0/0 store=file` |

**Believed but NOT proven:**

- That store durability (`durable: false` on the Expo file arm vs `true` on
  IndexedDB) is what gates resume minting. It is the one asymmetry left after
  ruling out the outbox, the store's presence, connection cycling, and the
  provider's `persistResume`. I did not confirm such a gate exists in the code.
- That this is an f7 regression. **Open.** I briefly called it disproved on one
  healthy sample; the third capture (a non-settling query) put it back in play.
  Running the archived f7 harness at HEAD is the honest next step.

| The server mints a resume token for the RN carrier | wire capture, both carriers `resume_present=True` on identical requests |
| The RN client discards a token it received | same-session device capture reporting `NOT_RQS_ELIGIBLE`, no WS re-subscribe in the trace |

**Proven by deduction (not by instrumentation):**

- The RN carrier *did* hold a resume token at some point — retained rows cannot
  be persisted without one plus `freshness === 'current'`. So eligibility is
  inconsistent across subscribe attempts rather than statically false.
- That writer-election timing is why the binding receipt is never committed.
  The *absence* of the receipt is confirmed by an IndexedDB dump; the
  mechanism is a hypothesis I did not instrument.
- That the offline queue is restart-durable on the device. The guide says the
  registered file arm gives this; I verified the store resolves, not that a
  killed-and-relaunched app replays.

**Explicitly not attempted:** hosted targets (the local-first claims are
local-target-only by construction), sessions-mode auth, and any iOS/Android
release-build evidence — everything native here ran through Expo Go against a
LAN dev server.

## 2026-08-15 — loopback-safe launcher default

The historical phone run above used a LAN bind, but LAN delivery to a physical
iOS device is an **unsupported workaround**, not a supported Snapback carrier.
The Warble launcher now binds `127.0.0.1` by default. Opting into the workaround
requires `WARBLE_HOST=0.0.0.0` and prints the consequence that, with dev auth,
anyone on the network can assert any identity. The simulator, Android USB, and
hosted release targets remain the supported paths while the physical-iOS
carrier decision stays open.
