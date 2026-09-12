# Clique seed wrapper

Node 24, built-ins only; no install or network. Run from the repository root:

```sh
node snapback4/fixtures/clique.mjs build
node snapback4/fixtures/clique.mjs build --log starter --out snapback4/fixtures/out/starter
node snapback4/fixtures/clique.mjs build --log sample --scale 2
node snapback4/fixtures/clique.mjs stats --log scale
node --test snapback4/fixtures/
```

`--log` defaults to `scale` (scale.log alone). `starter` replays m1, m2, m3
in that order; `sample` replays sample-50.log. `build` overwrites the eleven
`TABLE.jsonl` files in `--out` (default: this directory's gitignored `out/`).
Other destination files remain untouched. Rows sort by ID with fixed field order
and LF endings. Empty tables produce empty files.

Every row has `id` and `at` (epoch milliseconds from the log timestamp).
Replay follows file order, including when timestamps restart between logs.
Foreign keys and principals retain fixture IDs. Explicit entity IDs are
verbatim; profiles share their user's ID. Active edges use the mutation ID
that established them; reactions use the latest replacement's mutation ID.
Implicit initial memberships have no log ID: use `conversationId:userId`.
Explicit member-add rows use their mutation ID. Repeated sets keep existing rows;
clears remove them. Exact retries do nothing. DM pairs and aliases resolve to the first ID.

| Table | Fields besides `id, at` |
|---|---|
| users | email (fixture passwords are parsed but not emitted) |
| profiles | displayName, handle, bio, location, link, avatar |
| follows | userId, targetUserId |
| posts / replies | authorId, postType, text, media (path array), parentPostId |
| likes / reposts | userId, postId (may identify a reply) |
| reactions | userId, messageId, emoji |
| conversations | kind (`group`/`dm`), creatorId, name, description |
| memberships | conversationId, userId, role (`admin`/`member`) |
| messages | conversationId, senderId, messageType, text, media, caption, viewOnce, quoteId |

Posts exclude replies; replies use postType `reply`. Absent parent, quote,
media, caption, text (on media sends), and DM name/description are `null`.
Message media is `{path, byteSize}` from the referenced file's stat; paths
are relative to `benchmarks/fixtures/social-messenger/`. No media bytes are read
or copied. Profiles' avatars and posts' media also retain those relative paths.
`--scale N` is build-only: a positive integer selecting the first N distinct
registrations in the selected log sequence. Drop other users and their actions,
edges to excluded users, and creates whose required user or entity is excluded.
A group survives if its creator and second member survive; later outsider
memberships are dropped. Drop sends in removed conversations, replies/likes/
reposts on removed posts, reactions on removed messages, and quotes of removed
messages (transitively). Retained users' other group messages survive. No text
is rewritten; media references survive unchanged. N above the user count keeps all.

`stats` always verifies the full, unscaled combined manifest before reporting
the selected log: every `expectedState` and `namedSpotEntities` leaf, both
`checkpoints` in full (including prefix hashes/positions), and every log's
`artifacts` fields. It also checks the starter manifest's state/spots/artifacts
and combined schema/generator version against VERSION. Generator provenance
(source hash, seed, PRNG, clock policy) and descriptive stateBase are not replay
facts; generate.mjs is never loaded. Mismatches exit 1 with field/expected/actual.
