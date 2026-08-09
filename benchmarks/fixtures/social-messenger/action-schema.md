# Social-messenger action-log grammar

Version: `0.1.0-p1`

This file freezes the human-readable grammar for the Clique fixture pack. The
machine-readable authority is [`action-schema.json`](./action-schema.json). A
replay adapter must implement every verb below; silently skipping a recognized
verb is nonconforming.

## Replay and settling

Each action line has this shape:

```text
<ISO8601> <actor> <verb> <args...>
```

The timestamp is an RFC 3339 UTC instant with whole-second precision, such as
`2026-01-01T00:00:00Z`. It is documentary. Replay order and the backend's server
arrival time determine ordering; adapters must not backdate records from the
fixture timestamp.

The adapter must submit one action and wait for an authoritative receipt before
it can proceed. Only authoritative success permits the next action; a terminal
failure ends replay and is reported. “Settled” means the app's own auth and
mutation path has accepted the write, not merely that a request was queued
locally. A checkpoint is reached only after the action immediately before its
marker has settled. Push emission is disabled for scale replay, while receipts
and feed behavior remain enabled.

The two non-action marker lines are exactly:

```text
# checkpoint 10%
# checkpoint 50%
```

On a marker, pause, verify the matching checkpoint sub-manifest, run the probe
set, and then continue. Blank lines are forbidden.

## Lexical rules

Arguments are separated by one or more ASCII spaces or tabs. IDs, enums, email
addresses, URLs, media paths, and mutation IDs are bare tokens. Free text,
passwords, captions, and emoji are JSON string literals in double quotes;
normal JSON escapes apply. There is no shell interpolation. A media list is one
bare comma-separated token with one to four PNG paths and no spaces.

Actors are fixture user IDs. A create verb's explicit ID is a client-generated,
stable idempotency key as well as the desired entity ID. `follow`, `like`,
`repost`, and `react` are set-state intents, never toggles. Their mutation IDs
make retry behavior observable and idempotent.

## Frozen verbs

### `register`

```text
register <email> "<password>"
```

The actor is the new user ID. Registration uses the application's real signup
path.

```text
2026-01-01T00:00:00Z alice register alice@example.com "Alice!Clique2026"
```

### `profile-set`

```text
profile-set "<displayName>" <handle> "<bio>" "<location>" <link> <avatarPng>
```

This is a complete replacement of the actor's five textual profile fields and
avatar reference.

```text
2026-01-01T00:00:01Z alice profile-set "Alice Alvarez" alice "Coffee and cameras." "Oakland, CA" https://example.com/alice media/avatar-alice.png
```

### `follow`

```text
follow <targetUserId> <set|clear> <mutationId>
```

`set` ensures the edge exists; `clear` ensures it does not.

```text
2026-01-01T00:00:02Z alice follow bob set mut-follow-alice-bob
```

### `post`

```text
post <postId> text "<text>"
post <postId> images "<text>" <pngPath[,pngPath...]>
post <postId> video "<text>" <mp4Path>
```

The text body may be `""`. Images accept one to four fixture PNGs. Video
accepts exactly `media/vid-01.mp4`. Images and video never mix.

```text
2026-01-01T00:00:03Z alice post sp0001 text "Coffee time https://example.com/cafe"
2026-01-01T00:00:04Z bob post sp0002 images "Two views" media/img-01.png,media/img-02.png
2026-01-01T00:00:05Z carol post sp0003 video "Five quiet seconds" media/vid-01.mp4
```

### `like`

```text
like <postId> <set|clear> <mutationId>
```

`set` ensures the actor likes the post; `clear` ensures they do not.

```text
2026-01-01T00:00:06Z bob like sp0001 set mut-like-bob-sp0001
```

### `repost`

```text
repost <postId> <set|clear> <mutationId>
```

`set` ensures the actor's repost exists; `clear` removes that actor's repost.

```text
2026-01-01T00:00:07Z carol repost sp0001 set mut-repost-carol-sp0001
```

### `reply`

```text
reply <replyId> <parentPostId> "<text>"
```

A reply is a post entity that references its direct parent. Replies do not
enter either feed.

```text
2026-01-01T00:00:08Z bob reply sr0001 sp0001 "Save me a cup."
```

### `dm-create`

```text
dm-create <conversationId> <otherUserId>
```

The actor is the first participant. Replaying a DM create for an existing pair
must resolve to that pair's single DM rather than create a duplicate.

```text
2026-01-01T00:00:09Z alice dm-create d-alice-bob bob
```

### `group-create`

```text
group-create <conversationId> <secondMemberUserId> "<name>" "<description>"
```

The actor is the creator/admin and first member. The named second member makes
the group valid at creation. Use `""` for no description.

```text
2026-01-01T00:00:10Z alice group-create g-starter bob "Weekend Plans" "Coffee and a walk."
```

### `member-add`

```text
member-add <conversationId> <memberUserId> <mutationId>
```

The actor must be a group admin. Replay ensures the membership exists.

```text
2026-01-01T00:00:11Z alice member-add g-starter carol mut-member-g-starter-carol
```

### `send`

```text
send <messageId> <conversationId> "<text>"
send <messageId> <conversationId> "<text>" quote=<messageId>
```

The optional `quote=` token points at an earlier message in the same
conversation. It is a quoted reply, not a thread.

```text
2026-01-01T00:00:12Z alice send sm0001 d-alice-bob "Are you nearby?"
2026-01-01T00:00:13Z bob send sm0002 d-alice-bob "Five minutes away." quote=sm0001
```

### `send-media`

```text
send-media <messageId> <conversationId> <image|video> <mediaPath> "<caption>" <normal|view-once>
```

Images use fixture PNGs; video uses the fixture MP4. Only images may be
`view-once`. Use `""` for no caption.

```text
2026-01-01T00:00:14Z alice send-media sm0003 d-alice-bob image media/img-03.png "Found it" normal
2026-01-01T00:00:15Z bob send-media sm0004 d-alice-bob image media/img-04.png "One look" view-once
```

### `react`

```text
react <messageId> "<emoji|none>" <mutationId>
```

Any emoji string sets or replaces the actor's one reaction. The exact quoted
string `"none"` clears it.

```text
2026-01-01T00:00:16Z carol react sm0001 "👍" mut-react-carol-sm0001
2026-01-01T00:00:17Z carol react sm0001 "none" mut-react-clear-carol-sm0001
```

## Adapter conformance

`sample-50.log` contains exactly 50 actions and covers every verb and every
post variant, both `send` forms, both media kinds, view-once, and set/clear
intents. Syntax validation is necessary but not sufficient: M6 conformance
requires replay through the app's own paths with a settle receipt for each
action and the resulting state matching those intents.
