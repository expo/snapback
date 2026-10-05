# Social-messenger coordination contract

Shared pins for the P1 scaffolding and P2 hardening lanes (LLP 0201 D7). Every
artifact conforms to this file; the brief
(`benchmarks/briefs/social-messenger.md`) is the authority wherever
this file is silent.

## Layout

- `benchmarks/tools/social-messenger/ui/` — presentational UI kit
- `benchmarks/tools/social-messenger/choreography/` — two-client +
  simulator choreography harness
- `benchmarks/tools/social-messenger/metering/` — harness-native per-turn
  builder-session-tree adapters, receipt-attested every-attempt terminal
  joiner, tree-reconciled cap watchdog, and downstream charging validator
- `benchmarks/tools/social-messenger/grader/` — grader prompt, report
  schema, calibration plan, probe machinery
- `benchmarks/fixtures/social-messenger/` — personas, media, action
  logs, generator, manifests, configs
- `benchmarks/schema/social-messenger/` — assertion manifest,
  applicability manifest, run-record extension and composed record policy

## Determinism

PRNG: mulberry32, seed `20260808`. Log timestamps start
`2026-01-01T00:00:00Z`, advancing deterministically (never wall
clock). Generated files carry their generator version and a sha256 of
their content in the adjacent manifest.

## Personas and named fixtures

- Starter personas: `alice bob carol dave erin frank grace henry`,
  email `<name>@example.com`, passwords in
  `fixtures/social-messenger/personas.json`.
- Scale users: `u0001`–`u1000`, email `<id>@example.com`.
- Named O5 fixtures (checked exactly, pre-probe): probe user
  **u0500** (500 follows, member of 100 conversations); 5-follow
  comparison user **u0005**; busy group **g0001** (50 members
  including u0500, 10,000 messages).

## Action-schema verbs (log lines use exactly these)

`register`, `profile-set`, `follow`, `post` (text | images | video),
`like`, `repost`, `reply`, `dm-create`, `group-create`, `member-add`,
`send` (text; `quote=<msgId>` optional), `send-media`, `react`.
One action per line:
`<ISO8601> <actor> <verb> <args…>` — args space-separated,
quoted strings for text. The fixture lane freezes the exact grammar in
`fixtures/social-messenger/action-schema.md`; all lanes defer to it.

## Test IDs (shared authoring surfaces; extras allowed; choreography consumes only these)

The P1 kit owns the component-level subset. Lane shells implement route- and
message-action IDs that require application state or navigation; P2 added those
IDs so the hardened choreography can remain backend-neutral.

Scheme `sm-<area>-<element>`:
`sm-auth-email`, `sm-auth-password`, `sm-auth-submit`,
`sm-settings-logout`,
`sm-feed-tab-following`, `sm-feed-tab-global`, `sm-feed-item`,
`sm-feed-author`, `sm-feed-author-avatar`, `sm-feed-media`,
`sm-post-like`, `sm-post-repost`, `sm-post-reply`,
`sm-compose-input`, `sm-compose-submit`, `sm-compose-file`,
`sm-compose-attach`, `sm-compose-attachment`, `sm-compose-attachment-media`,
`sm-profile-follow`, `sm-profile-edit`, `sm-profile-save`, `sm-profile`,
`sm-profile-heading`, `sm-profile-nav-feed`,
`sm-profile-field-displayname`, `sm-profile-field-bio`,
`sm-chats-item`, `sm-chats-unread`, `sm-convo-input`, `sm-convo-send`,
`sm-convo-bubble`, `sm-convo-typing`, `sm-convo-receipt`,
`sm-convo-sender-avatar`,
`sm-convo-reaction`, `sm-convo-reaction-chip`, `sm-convo-react`,
`sm-convo-quote`, `sm-convo-quote-preview`, `sm-convo-file`,
`sm-convo-attach`, `sm-convo-media`,
`sm-convo-edit`, `sm-convo-delete`, `sm-convo-tombstone`,
`sm-convo-settings`, `sm-convo-viewonce-toggle`, `sm-convo-viewonce`,
`sm-convo-error`, `sm-media-viewer-image`, `sm-media-viewer-video`,
`sm-media-viewer-close`, `sm-chatsettings-color`,
`sm-chatsettings-background`, `sm-chatsettings-background-preview`,
`sm-chatsettings-disappearing`, `sm-chatsettings-member`,
`sm-chatsettings-member-add`, `sm-chatsettings-member-candidate`,
`sm-chatsettings-member-promote`, `sm-chatsettings-member-remove`,
`sm-chatsettings-leave`, `sm-search-input`, `sm-search-result`,
`sm-search-offline`,
`sm-poll-option`, `sm-poll-tally`, `sm-poll-total`.

`sm-chats-item` exposes an exact stable `accessibilityValue.text` such as
`dm:bob` or `group:design-gang`; choreography must not identify a direct chat
from its display text.

Identity values are lowercase fixture handles. `sm-feed-author-avatar` and,
when the lane mounts it, `sm-convo-sender-avatar` expose the author/sender
handle. The shared `MessageBubble` mounts the sender-avatar node only for
`!isMine && showSender`; the default 1:1 layout leaves `showSender` false.
Receipt values are
exactly `pending`, `sent`, `delivered`, or `read`. Member rows expose
`<handle>:member` or `<handle>:admin`; candidates expose `<handle>`. Poll
options expose their stable option id and tally/total nodes expose decimal
counts. These values, not visible copy or glyphs, are the choreography API.
`sm-feed-repost-attribution` exposes the reposting actor handle through the
same accessible value channel.
`sm-feed-media` exposes `image` or `video`; video is a contracted poster/play
surface because the pure React Native kit intentionally does not own a player.

### M8 UI-kit additions

`sm-feed-tab-trending`,
`sm-insights-summary`, `sm-insights-total-posts`,
`sm-insights-total-likes-received`,
`sm-insights-total-reposts-received`,
`sm-insights-total-replies-received`,
`sm-insights-total-followers`, `sm-insights-total-following`,
`sm-insights-bar-list`, `sm-insights-day-row`,
`sm-insights-day-posts-bar`, `sm-insights-day-likes-bar`,
`sm-trending-row`, `sm-trending-rank`, `sm-trending-empty`.

`sm-chats-unread` (the chat-list unread indicator, present in
`ChatListRow` since P1) is registered above because M8's cross-device
read-state choreography observes it; it was previously an
unregistered internal ID.

The six `sm-insights-total-*` IDs identify the lifetime stat tiles.
`sm-insights-day-row` and its two bar IDs repeat once per trailing UTC day.
Each `sm-trending-row` composes the existing `sm-feed-item` and post-action
IDs; ranks use `sm-trending-rank`. An empty 24-hour window renders
`sm-trending-empty` instead of rows.

The P2 choreography hardening also freezes these accessible-state semantics:

- `sm-profile` contains the visible display name and bio.
- Each `sm-chatsettings-color` has a stable `data-value` (or accessible label)
  and exposes selection via `aria-pressed=true`, `data-selected=true`, or a
  checked input.
- `sm-chatsettings-background` is a file input or opens a file chooser;
  `sm-chatsettings-background-preview` contains the synchronized rendered
  image and changes `src`, state, or style when the background changes.
- Every `sm-chatsettings-disappearing` option exposes its value through
  `data-value`, a native form value, or accessible value text. The values are
  `off`, `24h`, and `7d` (the fixture's shortened-window profile changes
  duration, not the option values).
- `sm-convo-file` is an optional app-shell-owned web file input;
  `sm-convo-attach` is the cross-platform kit-owned file-chooser trigger and
  is sufficient when it opens a chooser. `sm-convo-media` contains the real
  rendered `img` or `video`.
- `sm-compose-file` is the optional app-shell-owned web post-composer file
  input. The React Native kit intentionally cannot own an HTML input and
  instead mounts `sm-compose-attach`, which is sufficient when it opens a
  chooser. Each `sm-compose-attachment` exposes `image` or
  `video` as its semantic value. A video attachment keeps the picked video in
  `ComposerAttachment.uri`, requires a still-image
  `ComposerAttachment.posterUri`, and renders that poster at
  `sm-compose-attachment-media`; video bytes are never passed to the kit's
  `Image`. `sm-feed-media` contains the real rendered image or video observed
  by the other client.
- `sm-feed-author-avatar` and any rendered `sm-convo-sender-avatar` expose the
  stable actor identity as accessible value text. The latter is conditional
  on the chosen bubble layout; absence on a default 1:1 bubble is not a
  product failure. Display-name text and image glyphs are not identity
  evidence.
- `sm-convo-receipt` exposes exactly `pending`, `sent`, `delivered`, or `read`
  as accessible value text. Group messages expose the already-aggregated
  slowest-recipient state through the same token.
- Each `sm-chatsettings-member` exposes `<actor-id>:<member|admin>` as its
  accessible value. Candidate/add/promote/remove/leave controls use the
  registered IDs above; the lane remains responsible for server authority.
- Every profile view exposes `sm-profile-heading` and
  `sm-profile-nav-feed`. The first is the display-name heading independent of
  component order; the second returns to a surface containing feed tabs.
- Every `sm-poll-option` exposes its stable option ID as accessible value,
  selected/busy state as semantic accessibility state, and a child
  `sm-poll-tally` whose accessible value is the decimal count.
- `sm-convo-react`, `sm-convo-edit`, and `sm-convo-delete` are the message
  actions; reaction choices use `sm-convo-reaction`, and visible aggregate
  chips use `sm-convo-reaction-chip`.
- `sm-convo-quote` is the per-message Reply action;
  `sm-convo-quote-preview` is the separately pressable quoted excerpt that
  reveals its source message.
- View-once uses `sm-convo-viewonce-toggle`, `sm-convo-viewonce`, the media
  viewer IDs, exact `unopened`/`opened` accessible values, and
  `sm-convo-error` for server refusal.

For React Native Web, kit-owned stable values are emitted literally as
`aria-valuetext`; tab selection as `aria-selected`; and button-like selection
as `aria-pressed`. Kit-owned rendered image sources are repeated as
`data-source-uri` on the contracted observable node because RN Web may render
the image bytes through a CSS-background descendant. This is a renderer bridge
for existing public kit props, not an additional lane data contract. A web
video post must supply `FeedCard.videoPosterUri`; a video message must supply a
poster or thumbnail through `MessageBubble.mediaUri`; and a picked composer
video must supply `ComposerAttachment.posterUri` while retaining the submitted
video itself in `ComposerAttachment.uri`.

## Versioning

The choreography subdirectory is `0.3.8-m8` and the UI kit is
`0.3.3-m8`. The coordinated `0.3.3-m8` instrument migration required
suite-status and setup-identity linkage before
startup and adds the hash-linked D0.6 run-record observations while retaining
the W2 native-usage channel and extension version; the meter additionally
hash-verifies typed observation and suite-status sidecars. The earlier patch series separates
the per-message Reply action from the quoted-excerpt jump selector. UI
`0.3.2-m8` adds the media, actor, receipt, membership, profile-layout, and M7
poll semantic vocabulary without adding data-layer assumptions. The
choreography's P2 hardening
history is retained in its README. Choreography `0.3.4-m8` was the material
typing-boundary correction: it stamps M3 boundary v2 in assertion metadata,
receipts, and run records; retained `0.3.3-m8` observations remain v1 and are
not comparable or aggregatable with v2. It also separates required live DM
delivery from conditional avatar identity, makes removed-member cutoff wait
for an ordered progress witness, and assigns distinct actor/option vote pairs
across all M7 retry attempts. Other P1 artifacts remain at their existing
pre-freeze versions. Choreography `0.3.7-m8` carries those semantics plus the
LLP 0317 N7 fixture repair and binds the complete executable evidence stack to
the repaired frozen root; retained `0.3.4-m8` records stay historical.
Choreography `0.3.8-m8` coordinates UI `0.3.3-m8`'s RN-Web semantic bridge;
retained `0.3.7-m8` evidence keeps the pre-bridge renderer contract.
The P3 freeze bumps the complete instrument to `1.0.0` and pins hashes in the
brief.

## Native v1 overlay — new series only

This versioned copy, the adjacent UI kit/helper, driver and schemas form
`social-messenger@0.4.0-native.1`, protocol `clique-native/1`. The preceding
0.3.8 web vocabulary is inherited; its files and existing packets stay frozen.
This overlay takes precedence for native behavior and is not admitted to scored
use until the two-app/two-backend pilot and negative controls qualify.

`sm-nav-chats`, `sm-nav-search`, `sm-nav-back` perform ordinary navigation without
replacing the client/store. Bubble `accessibilityValue.text` is the exact opaque
message ID; search results expose the corresponding message ID, never a display
name or adapter-normalized key. Preserve `sm-chats-item` = `dm:bob` and receipt
values `pending|sent|delivered|read`. Repeated selectors are scoped to a message
container whose children remain independently accessible. `accessible={false}`
on that container is deliberate; inspect the Release tree to establish exposure.

The supplied helper is an Expo module, with no backend imports. Launch arguments
`--clique-run <UUID>` select `Documents/clique-native/<UUID>/native-observations.jsonl`;
no caller-controlled filesystem path is accepted. Every protocol relaunch must
explicitly supply the same argument; ordinary launches never recover activation
from preferences. Each activated process starts a fresh process nonce and sequence,
and preserves the installation/store. The journal is capped at 10,000 events or
4 MiB across launches for a run. Overflow writes a sticky `overflow.json` marker,
stops appending, and makes the measurement unmeasured.
Without a protocol launch the helper is inert; a missing native module is also
inert on the web. Do not derive operation IDs or product state from observer
configuration. Wire `useCommittedScreen` to rendered/viewable rows, `mediaCallbacks` to actual
native image callbacks, and `observe` to auth restoration, send transitions and
search navigation. `operationId` and provenance may be null. Never persist
credentials, signed URLs, raw media bytes or verdicts in observation payloads.

The fixture, observations, run manifest and assertion-envelope schemas are in
`schemas/`. A fixture seed command reads `{protocol,runId,origin,bundleId}` on
stdin and writes only the descriptor JSON. A read-only oracle command reads
`{protocol,runId,origin,conversationId,queuedBodies}` and writes
`{principal,origin,conversationId,complete,rows:[{messageId,body,orderKey,receiptState}]}`.
It creates a fresh Bob session, exhausts ordinary pagination, preserves every
occurrence and uses the backend's authoritative ordering tuple. It does not sort
by compose intent, deduplicate, inspect Alice's outbox or return success flags.
Adapter argv/cwd, origin and persistent data directory belong to operator config.

Bob's browser shell exposes its current principal and opaque conversation ID
as `data-principal` and `data-conversation` on the opened conversation container.
These are ordinary rendered state, not a harness callback; its message rows use
the same IDs and exact values. This makes wrong-conversation navigation observable
without backend-specific driver code. Authentication always uses the real form.

Round-1 identity refinements: the native conversation container exposes
`sm-conversation` with its opaque conversation ID as accessible value. It keeps
bubble descendants accessible. Each message's dedicated body descendant exposes
`sm-convo-body`; timestamps, reactions and other metadata are outside it. Bob
reads that descendant, while native history checks require the exact body inside
the identified bubble. Search requires both this destination tree and a fresh
committed conversation screen after tapping the result.

Settled write events bind client intent (ordinal, optional operation ID and body
hash) to the resulting server message ID, which may differ from its pending ID.
The final native read ticks and authoritative read states for both messages must
agree within 60 seconds. M6 receipt credit (`m6-a05`) is deferred until then.
`QUALIFIED.json` in the grader's trusted instrument distribution pins the runner
binary alongside the source commit, source inventory and Python driver hash.
It is a post-build qualification record, excluded from its own source inventory;
it must never be loaded from the evidence directory being validated.


Round-4 evidence refinements: `viewOnce.sha256` identifies the opened fixture
bytes. The prime crop derives from `sm-media-viewer-image` in `prime-once.json`
and must match the fixture at the unchanged mean absolute channel error <20/255.
The cold pixel record carries exactly that frame, but stale detection searches
every placement of its aspect-fit image content over the entire screenshot.
Prime letterboxing is excluded, and no cold viewer frame or border is required.
The screen is reduced to at most 480 pixels wide with BOX resampling. Templates
span 0.25–1.25 times the opened content size in 0.01 increments. Below a 0.99
match, refine the best width and height independently by up to four 1% steps
(at least one pixel per step), then by one pixel, to tolerate scale rounding
and modest aspect changes from equal-pixel insets. Channel-centered normalized
correlation >=0.90 counts as stale, including brightness/contrast shifts.
A spatially constant crop uses minimum RMS error <20 across the base scales
because its correlation is undefined. The screenshot dimensions must agree.
This is bounded image matching; arbitrary distortion, rotation and heavy
occlusion are outside the automated detector. Full video review remains required.

A timestamped reopen attempt binds either a disabled native `opened` control or
a fresh denied/consumed event. Poll native state and refusal within ten seconds
of the attempt, retrying only `viewonce-refusal-missing`. Visible viewer nodes
or detected stale pixels are terminal, sticky `m6-a04` failures; retain that
capture and its pixel record, even if a later render would be clean. Otherwise
retain the successful refusal capture. No view-once `load` is allowed
anywhere in the cold process, before the attempt or after reconnection included.
The reopen sequence cutoff establishes freshness of refusal only. The driver
keeps the load guard active from cold launch through its final event collection
after process termination.

Search first matches the conversation, locates the history row (scrolling when
needed), and retains only a validated destination under `cold-search.json` with
its capture time. A hittable history row in the post-scroll tree satisfies the
scroll; `conversation_valid` still requires a fresh post-tap committed screen.
Bob polls expected conversation, principal and exact bodies for up to ten seconds.
M8's restart tree must follow verified process absence and relaunch and precede
reconnection. That process's latest committed conversation screen at capture
must corroborate both ordered pending rows, identities and body hashes.
Each read assertion requires native read ticks, the latest committed read screen
and authoritative server receipts within the 60-second receipt window, including
the final native snapshot. The latest committed screen may predate the window;
the native snapshot and server sample measure that its read state still agrees.
Duplicate samples themselves must span five seconds.

Exported validation independently decodes every actual H.264 sample, including
the first and last, and checks track, codec and duration. Movie/edit endpoints
must lie within encoded sample presentation intervals from STTS/CTTS; extending
movie and media duration labels cannot extend that coverage. AVFoundation on
macOS or FFmpeg on other hosts supplies decoding; unavailable decoding leaves
the run unmeasured. The manifest cannot substitute its own decode claim.
Sample timing, sample-size-table count and actual decoded frame count must agree.
After assertion/failure snapshots, the driver terminates the app before stopping
the recorder so a static UI wait has a real terminal frame. This transition is
outside the measured assertions and is separately timestamped.

On macOS, compressed samples are read in decode order and passed individually
to VideoToolbox with synchronous decoding. Distinct encoded samples may share
a presentation timestamp; presentation-order reader output can coalesce them
and cannot establish the encoded count. Empty edit-boundary markers are skipped;
every encoded sample still requires its own decoded image.
