# Social-messenger P1 coordination contract

Shared pins for the P1 scaffolding lanes (LLP 0201 D7 P1). Every P1
artifact conforms to this file; the brief
(`benchmarks/briefs/social-messenger.md`) is the authority wherever
this file is silent.

## Layout

- `benchmarks/tools/social-messenger/ui/` — presentational UI kit
- `benchmarks/tools/social-messenger/choreography/` — two-client +
  simulator choreography harness
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

## Test IDs (kit implements exactly these; extras allowed; choreography consumes only these)

Scheme `sm-<area>-<element>`:
`sm-auth-email`, `sm-auth-password`, `sm-auth-submit`,
`sm-feed-tab-following`, `sm-feed-tab-global`, `sm-feed-item`,
`sm-post-like`, `sm-post-repost`, `sm-post-reply`,
`sm-compose-input`, `sm-compose-submit`,
`sm-profile-follow`, `sm-profile-edit`, `sm-profile-save`,
`sm-chats-item`, `sm-convo-input`, `sm-convo-send`,
`sm-convo-bubble`, `sm-convo-typing`, `sm-convo-receipt`,
`sm-convo-reaction`, `sm-convo-quote`,
`sm-chatsettings-color`, `sm-chatsettings-background`,
`sm-search-input`, `sm-search-result`,
`sm-poll-option`, `sm-poll-tally`.

## Versioning

Each subdirectory carries a `VERSION` file (`0.1.0-p1`); the P3
freeze bumps to `1.0.0` and pins hashes in the brief.
