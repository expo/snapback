# @snapback-bench/social-ui

Presentational UI kit for the **social-messenger** canonical
benchmark (app name: **Clique**). Version: see [`VERSION`](./VERSION)
(`0.3.3-m8`; the P3 freeze bumps to `1.0.0` and pins hashes in the
brief). Governing design: LLP 0201 D6
(`llp/0201-social-messenger-canonical-benchmark.plan.md`);
coordination pins: `benchmarks/tools/social-messenger/CONTRACT.md`;
product truth: `benchmarks/briefs/social-messenger.md`.

## What this is

React Native + TypeScript components, built against bare RN
primitives, for every pinned Clique screen — so benchmark lanes spend
their wall clock on the backend, not on pixels, and so grader
automation finds identical test IDs in every lane. The kit is a
**symmetric aid** disclosed under LLP 0197 rule 10 and is frozen with
the brief at P3.

Components: `MessageBubble`, `ChatListRow`, `Composer`, `FeedCard`,
`Avatar`, `ProfileForm`, `ReactionPicker`, `TypingIndicator`,
`ReceiptTicks`, `QuotedReply`, `PollCompose`, `PollDisplay`,
`FeedTabs`, `SearchBar`, `ChatSettingsForm`, `AuthForm`,
`InsightsSummary`, `InsightsBarList`, `TrendingRow`, `TrendingEmpty` —
plus the design tokens in `src/tokens.ts` (spacing, radii, type scale,
palette, and the pinned 8 chat accent colors: indigo, teal, coral,
amber, violet, emerald, rose, slate). Screen composition notes:
[`screens.md`](./screens.md). Neutrality posture and the pre-freeze
cross-backend review notes: [`NEUTRALITY.md`](./NEUTRALITY.md).

## What this is not

- **Not a data layer.** No fetching, no subscriptions, no context
  providers, no storage, no navigation. Zero runtime dependencies
  beyond `react` and `react-native` (peer dependencies).
- **Not an app shell.** No screens, routers, or lists — lanes own
  Expo Router wiring, virtualized lists, pagination, and state.
- **Not a validator.** Length caps on inputs are affordances;
  every rule the brief pins (handle uniqueness, edit windows,
  permissions) is enforced by the lane's backend and surfaces here
  through plain props (`errorText`, `canEdit`, `disabled`).

## The no-data-assumptions rule

Prop shapes are deliberately naive — a `messages`-style array of
scalars, an `onSend(text)` callback — and must stay that way. No
cursors, subscription objects, async iterators, promise-returning
callbacks, or client handles may be added, because any of those would
favor one backend architecture over another (reactive vs
fetch-shaped). The full posture, per component, is in
[`NEUTRALITY.md`](./NEUTRALITY.md). Changes to any prop shape are a
kit version change and re-open the neutrality review.

## Usage

Lanes vendor or path-import the kit and wire data around it:

```tsx
import { Composer, MessageBubble, TypingIndicator } from '@snapback-bench/social-ui';

// Data from wherever the lane's backend puts it — live query, fetch,
// offline store. The kit only sees plain values.
<MessageBubble
  isMine={false}
  senderName="Bob"
  showSender
  text="on my way"
  timestamp="12:04"
  reactions={[{ emoji: '👍', count: 2, mine: true }]}
  onPressReactionChip={(emoji) => clearOrSetReaction(emoji)}
/>
<TypingIndicator visible={someoneTyping} names={typingNames} />
<Composer
  variant="message"
  value={draft}
  onChangeText={setDraft}
  onSend={(text) => sendMessage(text)}
/>
```

Every interactive/observable kit element carries its exact component-level
contract testID from `CONTRACT.md` (scheme `sm-<area>-<element>`). Lane shells
own the route- and message-action IDs that require application state or
navigation. Choreography consumes only the shared contract set.

### React Native Web semantics

The kit emits literal web ARIA alongside its native accessibility props:
stable values use `aria-valuetext`, tabs use `aria-selected`, and toggle-like
buttons use `aria-pressed`. Rendered kit images also expose their existing
public source URI as `data-source-uri` on the contracted observable node. Apps
do not need app-owned `aria-*` or DOM shims for these kit surfaces.

React Native does not derive a video thumbnail. Web consumers must provide
`videoPosterUri` for every `FeedCard` with `videoUri`, and must pass a poster or
thumbnail as `MessageBubble.mediaUri` when `mediaKind="video"`. Without it the
kit deliberately renders only the existing neutral placeholder and play glyph.

## Tests

```
cd benchmarks/tools/social-messenger/ui
npm install
npm test
```

The suite checks contract-ID defaults, semantic observability tokens, and
typechecks the package. `react`,
`react-native`, and `@types/react` are devDependencies for typechecking only;
at runtime they are peers supplied by the lane's app.

## Versioning

`VERSION`, `package.json`, and the brief's pinned kit version move together.
`0.3.3-m8` preserves the native accessibility contract while adding the
literal RN-Web ARIA and `data-source-uri` bridge verified by a headless
Chromium consumer journey. It also makes the existing web video-poster
obligation explicit. `0.3.2-m8` adds structural media, actor identity, semantic receipt,
membership, profile-layout, and poll-state vocabulary for the coordinated
instrument-observability bump. `0.3.1-m8` migrates the pressable quoted excerpt to
`sm-convo-quote-preview`, reserving `sm-convo-quote` for the lane-owned
per-message Reply action. `0.3.0-m8` added the M8 Insights and Trending
surfaces; `0.2.0-p2` added the accessible state consumed by the hardened
choreography. The P3 freeze bumps to `1.0.0` after the cross-backend neutrality review and
pilot shakedown, and the frozen hash is recorded in the brief. Post-freeze
changes require a version bump and re-disclosure per LLP 0197.
