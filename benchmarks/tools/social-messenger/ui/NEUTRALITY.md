# Neutrality posture — @snapback-bench/social-ui

The kit's job is to remove pixel-pushing from the benchmark's wall
clock **without smuggling in a data-architecture worldview** (LLP 0201
D6): hooks-shaped interfaces favor reactive backends (Convex,
Snapback); fetch/promise-shaped interfaces favor Supabase-style
backends. This file records the kit's neutrality posture per
component, in the form LLP 0201 D6 requires publishing with the kit
version, and is where the pre-freeze cross-backend idiom review's
findings land.

## Design rules (apply to every component)

1. **Plain values in, callbacks out.** Props are strings, numbers,
   booleans, URIs, and plain arrays. No component accepts a
   subscription object, query handle, cursor, async iterator,
   promise, observable, or client instance.
2. **No hooks that subscribe, no context providers.** The only hook
   usage in the kit is a local `Animated` pulse in TypingIndicator —
   pure animation, no external state.
3. **Snapshot semantics.** Every prop is a snapshot the caller
   re-renders with. Whether the snapshot came from a live query
   (Snapback/Convex), a fetch + client cache (Supabase), or an
   offline store is invisible to the kit.
4. **No loading/pagination protocol.** Components render exactly what
   they are handed. Lists (feed, chats, conversation) are rendered by
   the lane's own list/virtualization; the kit provides row/card
   components only, so no `onEndReached`/cursor idiom is baked in.
   (SearchBar's optional results rendering takes a flat, complete
   array for the same reason.)
5. **Pre-formatted display strings.** Timestamps arrive as display
   strings, not epoch/Date/server-format values — no assumption about
   any backend's time representation.
6. **Toggles report presses, not state transitions.** Like, repost,
   follow, reaction, and poll-vote affordances emit "the user pressed
   this" (`onPressLike`, `onVote(index)`, …). The brief's idempotent
   set-state intent ruling is implemented in the lane's data layer;
   the kit takes the current state (`liked`, `mine`) and never
   flips anything itself.
7. **Errors are strings.** Server-side rejections (duplicate handle,
   non-admin rename) surface via `errorText` props, favoring neither
   thrown-promise nor result-object error idioms.

## Per-component review notes

| Component | Neutrality-sensitive surface | Posture |
|---|---|---|
| **MessageBubble** | message shape | Flat scalar props (`text`, `mediaUri`, `edited`, `deleted`, `receipt`, `reactions[]` as `{emoji, count, mine}`), not a message object from any SDK. No id prop at all — identity/keying stays in the lane's list. Reactive: pass live-query row fields. Fetch: pass fetched rows. Equal. |
| **ChatListRow** | previews, unread, typing | `preview` is a pre-formatted string (no last-message object), `unreadCount` a number, `typing` a boolean — computable from a live query, a poll, or a channel event identically. |
| **Composer** | send path | `value`/`onChangeText` controlled input + `onSend(text)`. No optimistic-insert affordance, no mutation handle, no promise return — fire-and-forget callback works for mutation calls and POSTs alike. |
| **FeedCard** | counts and toggle state | `likeCount`/`liked` etc. are plain snapshots; live count updates are just re-renders. No cursor/page props (see rule 4). Link taps emit the URL (`onPressLink`) rather than importing Linking — keeps navigation/platform imports out. |
| **Avatar** | asset delivery | Takes a resolved `uri` string. Whether that is a Supabase signed URL, a Convex storage URL, or a Snapback asset route is the lane's business; the kit never fetches or authorizes. |
| **ProfileForm** | form state, validation | Controlled values + `onChange(patch)`; save emits values. Uniqueness (handle/email) errors arrive as `errorText` — server-enforced on every backend, surfaced identically. Modes are a discriminated union, not a data-loading state machine. |
| **ReactionPicker** | reaction semantics | Emits the pressed emoji only. Replace/remove logic (M4) is data-layer; a reactive backend can settle it server-side, a fetch backend can round-trip — the kit can't tell. |
| **TypingIndicator** | ephemeral state | A `visible` boolean + optional names. Deliberately the strongest neutrality case: presence via WebSocket channel (Supabase Realtime), ephemeral doc (Convex/Snapback), or polling all reduce to one boolean. Timing windows (2 s appear / 5 s expire) are the lane's. |
| **ReceiptTicks** | receipt model | A single monotonic enum `sent → delivered → read` plus a `pending` flag for offline queues. Aggregation over group recipient sets (membership-at-send-time) happens in the lane; the kit renders the already-aggregated state. |
| **QuotedReply** | message linkage | `senderName` + pre-truncated `excerpt` + `onPress`. No message-id pointer prop, so no assumption about id shape or how "jump to original" is resolved. |
| **PollCompose** | poll creation | Controlled question/options arrays; submit emits `(question, options)`. No poll-message schema implied. |
| **PollDisplay** | live tallies, votes | Options are `{label, count, mine}` snapshots; `onVote(index)` reports the tap. Live tallies are re-renders; offline vote queuing is invisible to the kit. |
| **FeedTabs** | feed read-models | Three static tabs + `onChange`. Nothing about how Following or Trending is computed (fan-out, query-time join, materialized view, aggregate query) leaks into the UI. |
| **SearchBar** | search backend | Input + optional flat results with pre-computed `groupLabel` strings. Matching semantics (word-prefix, NFC), scoping, ordering, pagination, and the online/offline split are entirely the lane's; server search and local-store search feed the identical prop shape. |
| **ChatSettingsForm** | permissions, sync | `canEdit` is a display flag only — the brief requires server-side enforcement, and the kit's docs say so. Accent selection emits the picked `{name, value}`; syncing it to members is the lane's. The 8 accents are fixed token data, identical for every lane. |
| **AuthForm** | auth flow | Email/password strings + `onSubmit(email, password)`. No session, token, or provider concept; built-in auth (Snapback/Supabase/Convex auth) and hand-rolled KDF flows drive it identically. |
| **tokens** | — | Plain frozen constants; no theming context. |

## Known asymmetries considered and accepted

- **Snapshot props mildly resemble "current state" rendering**, which
  is how both reactive live queries *and* fetched state render in
  React; a fetch-shaped lane re-renders on setState after a fetch, a
  reactive lane on subscription push. Neither writes adapter code the
  other doesn't.
- **No promise-returning callbacks** (e.g. `onSend` returning a
  Promise for built-in spinners) — deliberately omitted, since it
  would privilege RPC-flavored APIs; in-flight display state is a
  plain `sending`/`submitting` boolean prop instead.
- The kit ships **row components, not list screens**, so neither
  cursor pagination (Supabase-idiomatic) nor reactive windowed
  queries (Convex/Snapback-idiomatic) gets free scaffolding.

## Cross-backend idiom review (pre-P3 freeze)

Per LLP 0201 D6, the kit is reviewed against each tier-1 backend's
idioms (Snapback, Convex, Supabase) **before the P3 freeze**, and the
per-backend review notes land in this file next to the table above.
Status: **pending — P1 authoring posture only.** This document
records the author-side posture; the per-backend review passes (one
reviewer hat per backend, checking that wiring each backend to these
props requires no adapter layer the others don't) have not run yet.
Findings, prop-shape changes they force, and the reviewer verdicts
must be appended here before the kit version freezes at P3.

## M8 component neutrality addition

`InsightsSummary` takes only `{label, value}` totals,
`InsightsBarList` takes only `{dayLabel, posts, likesReceived}` day
snapshots, and `TrendingRow` composes an unchanged `FeedCardProps`
snapshot with a numeric rank. The kit cannot tell whether totals and
buckets are maintained counters/read models or computed aggregates,
nor how the top-10 list was produced.

- **Snapback:** a live query, ordinary query, or server-computed read
  model maps directly to the plain values; no Snapback handle enters
  the components.
- **Convex:** reactive query results map to the same values; the kit
  requires no hook or subscription-shaped prop.
- **Supabase:** a fetch, view, or RPC result maps to the same values;
  the kit requires no promise, response, or pagination-shaped prop.
