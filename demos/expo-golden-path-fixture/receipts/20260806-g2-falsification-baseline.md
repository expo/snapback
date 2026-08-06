# G2 falsification checkpoint — frozen baseline

**Frozen:** 2026-08-06, before any G2 rebuild code
**Plan:** LLP 0176 §G2, “Falsification checkpoint”
**Original commit:** `c7a8b90312ac979830df6948023689af169166a3`
**Original:** Relay Room’s Snapback Expo conversation list plus message thread

This first section is the immutable pre-implementation contract. Results are
appended after the rebuild; the boundary, bar, and fact inventory below do not
change in response to the measured outcome.

## Original selection

Relay Room is the cleaner falsification target. Its two UI files are
Snapback-specific and put the low-level query, mutation, connection, outbox,
asset, and presence hooks beside the states they render. Tandem instead shares
881 lines of backend-neutral presentation and types between two products, then
projects Snapback through a separate 223-line adapter. Relay therefore makes
the before/after attribution clearer and is the harder comparison to game:
the original already has no manual subscription cleanup in its screens.

The frozen original files have these Git blob identities:

- `src/screens/inbox-screen.tsx`: `477a4bae31b5c3c0ca431455ede5b718abbd2ba6`
- `src/screens/chat-screen.tsx`: `b110db3677ba3161bb7574431264fe81c3f1ce20`
- `src/providers/relay-provider.tsx`: `b1c7ed02a07a77910c4d633df1672a05b71aef2a`
- `tests/offline-acceptance.mjs`: `e8f285390823a848bfba52ee8d5f9086af400b41`

The originals remain unmodified.

## Frozen count boundary and bar

The primary line-count boundary is the two hand-authored product screens:

- `demos/relay-room-bakeoff/snapback-expo/src/screens/inbox-screen.tsx`
- `demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx`

The rebuild boundary is the directly corresponding conversation-list and
message-thread screen files under `demos/expo-golden-path-fixture/`. Shared
visual helpers, root provider/route setup, tests, generated artifacts, and
backend schema/functions are outside both primary boundaries. Generated code
does **not** count. Declarative backend code, including `defineSurface`, also
does **not** count because the measure is specifically consumer-screen
shrinkage and the original backend declarations are likewise excluded. The
result will nevertheless report the surface declaration’s physical lines as
a secondary authoring-cost measure so moving code behind generation is not
hidden.

Physical lines are the frozen measure; blank lines, comments, imports, JSX,
and styles all count. The command and observed result were:

```sh
wc -l \
  demos/relay-room-bakeoff/snapback-expo/src/screens/inbox-screen.tsx \
  demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx
```

```text
142 demos/relay-room-bakeoff/snapback-expo/src/screens/inbox-screen.tsx
368 demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx
510 total
```

The hook/state-object measure is one per hook call site whose return value or
lifecycle the screens coordinate. There are **35 call sites across 14 distinct
hook APIs**. The reproducible commands are:

```sh
rg '^\s*(const .*?=\s*)?use[A-Z][A-Za-z0-9_]*(<.*>)?\(' \
  demos/relay-room-bakeoff/snapback-expo/src/screens/inbox-screen.tsx \
  demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx | wc -l

rg -o 'use[A-Z][A-Za-z0-9_]*(?=(<.*>)?\()' --pcre2 \
  demos/relay-room-bakeoff/snapback-expo/src/screens/inbox-screen.tsx \
  demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx \
  | sed 's/.*://' | sort -u | wc -l
```

Manual cleanup/subscription-lifecycle lines are **0**. Neither screen calls
`subscribe`, `unsubscribe`, or `dispose`, and neither returns an effect cleanup
or cancels a timer/frame/listener. This was checked with:

```sh
rg -n 'return \(\) =>|return \(\)=>|\.subscribe\(|unsubscribe|dispose\(|clearInterval|clearTimeout|cancelAnimationFrame|removeEventListener' \
  demos/relay-room-bakeoff/snapback-expo/src/screens/inbox-screen.tsx \
  demos/relay-room-bakeoff/snapback-expo/src/screens/chat-screen.tsx
```

The command produced no matches. Upload settlement does use two React effects,
but those coordinate task state rather than open or clean up a subscription;
they remain represented in the 35-hook measure.

**Frozen minimum reduction:** at least **26 physical lines (5.0%)**, so the
rebuild must contain **484 lines or fewer** in the corresponding two-screen
boundary. Five percent is an honest whole-screen bar because roughly half the
files are visual JSX/styles that `useSurface` should not erase. Twenty-six
lines is still larger than formatting noise and requires the API to remove
real orchestration rather than merely rename hooks.

## Frozen fact-preservation contract

“Renders” below means the user-visible screen reaches the fact, not merely that
the client retains it internally. Facts the original does not render (notably
query error diagnostics and unsupported typing state) are called out after the
inventory and are not silently credited to it.

### Retained data, connection, and settlement facts

1. **The inbox continues to render saved conversation rows and labels them as
   saved.** It derives rows from `conversations.data` and
   `memberships.data`, detects either query’s `freshness === 'retained'`, and
   renders “Showing saved conversations” while the same rows remain in the
   list (`inbox-screen.tsx:21-26`, `:68-76`, `:78-95`).
2. **Inbox transport state is independent of retained data.** `live` and
   `polling` count as online; every other connection state renders “Offline,”
   independently of the saved-data label (`inbox-screen.tsx:27`, `:68-72`).
3. **The thread continues to render retained messages and labels them “Saved
   history.”** It checks the message query’s freshness, renders
   `messages.data`, and gives retained freshness precedence over the transport
   label (`chat-screen.tsx:63`, `:173`, `:181-191`, `:195-214`).
4. **Thread transport state remains visible when rows are not retained.** The
   provider-wide connection hook drives the dot and “Live”/“Offline” text
   (`chat-screen.tsx:69`, `:181-184`).
5. **Queued mutation settlement remains visible.** A ready outbox with
   `pending > 0` renders “N queued” (`chat-screen.tsx:70`, `:185`).
6. **The retained path is a real cold-client failure mode, not an in-memory
   story.** The original acceptance starts online, reaches current rows,
   stops the server, creates a fresh client, and requires the same query to
   reach retained rows with an explicit retainability/store fact
   (`tests/offline-acceptance.mjs:55-71`, `:73-95`).

### Partial, pending, and error facts

7. **Inbox pending state is visible.** When conversations or memberships are
   pending and there are no rows, the empty state includes an activity
   indicator (`inbox-screen.tsx:96-101`).
8. **Thread pending state is visible.** An empty pending message query renders
   an activity indicator (`chat-screen.tsx:188-214`).
9. **Provider boot is visibly pending or failed.** Async preparation renders
   “Opening Relay Room…” while booting and “Relay Room couldn't start” plus
   the error detail after any preparation refusal
   (`relay-provider.tsx:45-68`, `:82-87`, `:96-102`).
10. **Text/reply mutation failure is visible.** Rejection becomes
    `composerError`, which is rendered above the composer
    (`chat-screen.tsx:88-103`, `:230`).
11. **Photo-library refusal is visible.** A denied device permission produces
    the explicit “Photo library access is required…” error
    (`chat-screen.tsx:106-112`, `:230`).
12. **Asset progress is visible as partial task state.** Creating, uploading,
    and finalizing are treated as busy; byte progress is rendered as
    “Preparing photo · N%” (`chat-screen.tsx:125-130`, `:173-177`,
    `:227-230`).
13. **Asset upload rejection/failure is visible.** `failed` and `rejected`
    task states render the task diagnostic or the fallback message
    (`chat-screen.tsx:152-157`, `:230`).
14. **Post-upload image-mutation failure is visible.** A failed attachment
    mutation clears the pending image and renders the rejection
    (`chat-screen.tsx:133-150`, `:230`).
15. **Reaction mutation failure is visible.** Add/remove rejection becomes the
    same rendered composer error (`chat-screen.tsx:159-170`, `:230`).

### Capability/refusal facts

16. **Generated/deployment capability mismatch refuses the app visibly.** The
    provider admits schema, functions, and the capability manifest together;
    any admission error becomes the detailed failed-boot UI
    (`relay-provider.tsx:15-18`, `:53-66`, `:82-87`).
17. **Asset-policy/capability refusal is distinct task evidence.** A
    `rejected` upload state is not treated as generic pending or success; its
    diagnostic is rendered (`chat-screen.tsx:152-157`, `:230`).
18. **Device media capability refusal is distinct from backend failure.** A
    denied photo-library grant is detected before upload and rendered with its
    own copy (`chat-screen.tsx:106-112`, `:230`).

The original does **not** render live-query error diagnostics for the inbox or
thread and does not render `useSnapbackPresence`'s `unsupported`/error state.
Those absences are not counted as preserved facts. The rebuild may improve on
them, but it cannot use an improvement to excuse losing any fact above.

## Frozen verdict rule

- Half 1 passes only at 484 counted lines or fewer under the frozen boundary.
- Half 2 passes only if every numbered fact above has a rebuild code cite and
  the offline/retained, partial/error, and capability-refusal modes are
  reproduced by automation where the fixture permits it, with any remaining
  manual repro stated explicitly.
- Overall PASS requires both halves. Either failure is the checkpoint’s
  successful design-defect finding and stops all G3 setup work.

## Results (append after rebuild)

Measured on 2026-08-06 after the baseline above was frozen. The frozen Relay
Room blobs still had the four identities recorded above after measurement.

### Half 1 — shrinkage: PASS

The rebuild boundary is:

- `src/screens/inbox-screen.tsx`
- `src/screens/chat-screen.tsx`

The same physical-line command, with only the frozen path substitution,
produced:

```sh
wc -l \
  demos/expo-golden-path-fixture/src/screens/inbox-screen.tsx \
  demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
```

```text
104 demos/expo-golden-path-fixture/src/screens/inbox-screen.tsx
235 demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
339 total
```

The rebuild is **171 lines smaller (33.5%)**, comfortably beyond the frozen
26-line/5.0% minimum and its 484-line ceiling.

The frozen hook commands report **23 call sites across 10 distinct hook
APIs**, down from 35 across 14. The cleanup command again produces no matches:
manual cleanup/subscription-lifecycle lines remain **0**, matching the already
clean original rather than claiming a fictitious improvement.

The excluded declarative `conversation` surface is 47 physical lines
(`snapback/functions.mjs:235-281`), measured with:

```sh
sed -n '235,281p' \
  demos/expo-golden-path-fixture/snapback/functions.mjs | wc -l
```

Including that secondary backend declaration would make the combined cost 386
lines, still 124 lines below the original screen-only count, but that is not
the frozen primary comparison.

### Half 2 — fact preservation: FAIL

The rebuild reaches and renders 17 of the 18 frozen facts. Code-path evidence
for the complete contract is:

| # | Rebuild reach/render evidence | Result |
| --- | --- | --- |
| 1 | Inbox derives rows from the three live-query projections, detects retained conversation/membership state, and renders the saved label without replacing the rows (`src/screens/inbox-screen.tsx:24-34`, `:56-77`). | Preserved |
| 2 | Provider-wide connection state independently drives “Live sync”/“Offline” (`src/screens/inbox-screen.tsx:27`, `:32`, `:56-59`). | Preserved |
| 3 | The thread reads `conversation.state.messages.freshness`, renders `conversation.data.messages`, and gives “Saved history” precedence (`src/screens/chat-screen.tsx:58-72`, `:139`, `:152`, `:157-176`). | Preserved in the projection; unreachable in the required cold-client mode described below |
| 4 | The low-level connection projection independently drives the thread dot and “Live”/“Offline” copy (`src/screens/chat-screen.tsx:63`, `:151-153`). | Preserved |
| 5 | The low-level outbox projection renders `N queued` (`src/screens/chat-screen.tsx:64`, `:153`). | Preserved |
| 6 | The real acceptance persists current message rows and an exact binding receipt, closes the client/store, stops the server, opens a fresh client/store, and directly reopens all three retained rows (`tests/g2-falsification.mjs:138-176`). `prepareReactBinding({ generatedManifest: app })` then rejects `TypeError: fetch failed` before a provider or surface exists (`:177-184`). | **Not preserved** |
| 7 | Inbox pending state with no rows renders an activity indicator (`src/screens/inbox-screen.tsx:33`, `:62-77`). | Preserved |
| 8 | Thread pending state with no rows renders an activity indicator (`src/screens/chat-screen.tsx:176`). | Preserved |
| 9 | The app-level provider fallback renders boot status plus diagnostic code/message for pending or failed preparation (`App.tsx:16-30`, `:44-48`). | Preserved |
| 10 | Text/reply rejection is caught into the rendered composer diagnostic (`src/screens/chat-screen.tsx:74-85`, `:182`). | Preserved |
| 11 | Denied media-library permission has distinct copy in the rendered composer diagnostic (`src/screens/chat-screen.tsx:88-94`, `:182`). | Preserved |
| 12 | Creating/uploading/finalizing are busy states and byte progress renders as “Preparing photo · N%” (`src/screens/chat-screen.tsx:101-106`, `:140-141`, `:181`). | Preserved |
| 13 | Rejected/failed upload task diagnostics become the rendered composer diagnostic (`src/screens/chat-screen.tsx:120-125`, `:182`). | Preserved |
| 14 | Post-upload `sendImage` rejection clears pending image state and renders its diagnostic (`src/screens/chat-screen.tsx:109-118`, `:182`). | Preserved |
| 15 | Add/remove reaction rejection becomes the same rendered diagnostic (`src/screens/chat-screen.tsx:127-136`, `:182`). | Preserved |
| 16 | Provider admission failures reach the detailed app fallback (`App.tsx:16-30`, `:44-48`); exact conversation-descriptor capability refusal is automated (`tests/g2-falsification.mjs:186-213`; `packages/snapback-expo/provider.test.mjs:248-276`). | Preserved |
| 17 | Asset-policy `rejected` remains distinct from progress/success and renders its task diagnostic (`src/screens/chat-screen.tsx:120-125`, `:182`). | Preserved |
| 18 | Device permission refusal occurs before upload and uses its own copy (`src/screens/chat-screen.tsx:88-94`, `:182`). | Preserved |

The headless React surface test additionally proves that, once a binding
exists, retained rows remain simultaneously available through compact `data`
and rich `state` with `freshness: retained`, `status: refreshing`, and
`connection: stale`; it also proves that a bound mutation refusal remains a
rejected promise (`packages/snapback-react/surface.test.mjs:334-363`). The
real-runtime test proves current data, a bound reaction, canonical subscription
sharing, the cold-boot refusal, and capability mismatch; it passes 5/5 because
the fourth check is explicitly a negative defect witness.

The fixture has no deterministic React Native picker/task fault injector.
The documented manual repro for the device-only branches is: deny Photos
permission and tap “Choose image” (fact 11/18); permit Photos and select a
large image on a throttled link to observe non-zero “Preparing photo” progress
(fact 12); select an image exceeding the declared 12 MB policy to observe the
task rejection diagnostic (fact 13/17); and interrupt the backend between
upload readiness and attachment mutation to observe the `sendImage` diagnostic
(fact 14). Text/reply/reaction rejection can likewise be injected at the
mutation transport and must appear at `composer-error` (facts 10/15). These
manual branches were not promoted to simulator claims because the mandatory
cold-client branch had already failed and the gate requires a halt.

#### Falsification cause

The data is not missing: the acceptance reopens both the exact persisted
binding receipt and the retained query store. The surface is unreachable.
Descriptor-mode preparation deliberately rethrows a connectivity error before
calling persisted-receipt adoption because the portable AppDescriptor omits
server-owned function interiors and the legacy receipt does not retain the
admitted deployment view (`packages/snapback-client/react-binding.mjs:560-568`).
Consequently the accepted `<SnapbackExpoProvider app={app}>`/`useSurface`
authoring path cannot construct a provider on a process-cold offline launch,
so it cannot render the original's saved history.

The supplied runtime reported commit `96df27ea3e7537e70f89f28a3b27713d5b6bb702`
against checkout `c7a8b90312ac979830df6948023689af169166a3` and was admitted only because
it was explicitly configured. The fixture's checkout-generated schema and
function artifacts were still the startup artifacts for the test. This
receipt therefore records the stamp mismatch and makes no exact-runtime-build
identity claim.

### Verdict

- **Half 1 (shrinkage): PASS** — 339 lines, a 171-line/33.5% reduction.
- **Half 2 (fact preservation): FAIL** — frozen fact 6, real cold-client
  retained rendering, is unreachable through descriptor-mode preparation.
- **Overall G2 falsification checkpoint: FAIL.** This is the gate's intended
  successful design-defect finding. Work stops here; no G3 setup or asset
  command was added. The defect is tracked in
  `issues/20260806-app-descriptor-use-surface-blocks-cold-retained-boot.md`.
