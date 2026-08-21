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
  token adapters, milestone joiner, and cap watchdog
- `benchmarks/tools/social-messenger/grader/` — grader prompt, report
  schema, calibration plan, probe machinery
- `benchmarks/fixtures/social-messenger/` — personas, media, action
  logs, generator, manifests, configs
- `benchmarks/schema/social-messenger/` — assertion manifest,
  applicability manifest, run-record extension

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
`sm-post-like`, `sm-post-repost`, `sm-post-reply`,
`sm-compose-input`, `sm-compose-submit`,
`sm-profile-follow`, `sm-profile-edit`, `sm-profile-save`, `sm-profile`,
`sm-profile-field-displayname`, `sm-profile-field-bio`,
`sm-chats-item`, `sm-chats-unread`, `sm-convo-input`, `sm-convo-send`,
`sm-convo-bubble`, `sm-convo-typing`, `sm-convo-receipt`,
`sm-convo-reaction`, `sm-convo-reaction-chip`, `sm-convo-react`,
`sm-convo-quote`, `sm-convo-quote-preview`, `sm-convo-file`,
`sm-convo-attach`, `sm-convo-media`,
`sm-convo-edit`, `sm-convo-delete`, `sm-convo-tombstone`,
`sm-convo-settings`, `sm-convo-viewonce-toggle`, `sm-convo-viewonce`,
`sm-convo-error`, `sm-media-viewer-image`, `sm-media-viewer-video`,
`sm-media-viewer-close`, `sm-chatsettings-color`,
`sm-chatsettings-background`, `sm-chatsettings-background-preview`,
`sm-chatsettings-disappearing`, `sm-search-input`, `sm-search-result`,
`sm-search-offline`,
`sm-poll-option`, `sm-poll-tally`.

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
- `sm-convo-file` is a file input; `sm-convo-attach` is the file-chooser
  fallback. `sm-convo-media` contains the real rendered `img` or `video`.
- `sm-convo-react`, `sm-convo-edit`, and `sm-convo-delete` are the message
  actions; reaction choices use `sm-convo-reaction`, and visible aggregate
  chips use `sm-convo-reaction-chip`.
- `sm-convo-quote` is the per-message Reply action;
  `sm-convo-quote-preview` is the separately pressable quoted excerpt that
  reveals its source message.
- View-once uses `sm-convo-viewonce-toggle`, `sm-convo-viewonce`, the media
  viewer IDs, and a consumed/denied accessible state or `sm-convo-error`.

## Versioning

The choreography subdirectory is `0.3.2-m8` and the UI kit is `0.3.1-m8`; the
patch series separates
the per-message Reply action from the quoted-excerpt jump selector, including
migration of the kit's quoted-excerpt default. The choreography's P2 hardening
history is retained in its README. Other P1 artifacts remain at their existing
pre-freeze versions.
The P3 freeze bumps the complete instrument to `1.0.0` and pins hashes in the
brief.
