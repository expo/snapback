# Fixture wrapper lane report

Completed inside `snapback4/fixtures/`; no commits and no changes to inputs,
the contract, crates, benchmarks, or the shared journal. Node built-ins only.

Verified using Node **v24.18.0**, available locally at
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node`.
The ambient `node` is v25.9.0, so the commands below select Node 24 explicitly.

Exact scale stats command:

```sh
/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node snapback4/fixtures/clique.mjs stats --log scale
```

Exact stdout (exit 0):

```text
log: scale
users: 1000
profiles: 1000
follows: 5909
posts: 48200
likes: 5000
reposts: 1000
replies: 2000
reactions: 2000
conversations: 1000
memberships: 2048
messages: 100000
u0001.memberships: 1000
u0500.follows: 500
text-sends: 99090
media-sends: 910
largest-conversation: g0001 (10000 messages)
manifest: PASS (combined + starter states, all spots, 10%/50% checkpoints, all log artifacts)
```

Test command:

```sh
PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:$PATH node --test snapback4/fixtures/
```

Result: **PASS**, exit 0; 9 tests, 9 passed, 0 failed, 0 cancelled,
0 skipped, 0 todo; duration 4968.976125 ms. Coverage includes all final and
checkpoint manifest facts, two byte-identical full CLI builds, reference
integrity, all 50 sample actions, scale filtering, grammar refusal, retries,
DM pair identity, transitive quote drops, and a deliberately corrupted replay
that makes the stats command exit 1 naming the differing profile field.
Temporary outputs were removed. `package.json` supplies a directory entry
point because Node 24 does not recursively discover tests from this explicit
directory argument without one; it declares no dependencies.

Grammar and representation interpretations (paths below are relative to
`benchmarks/fixtures/social-messenger/`):

- **Authority and lexical validation:** `action-schema.md:5–8,43–52` makes
  action-schema.json authoritative. The parser reads its types, argument
  variants, quoting, lengths, image-list bounds, optional quote prefix and
  media constraints directly. String lengths count Unicode code points;
  JSON escapes are decoded, never interpolated. Blank or unknown marker lines
  fail (`action-schema.md:31–39`). Whole-second UTC timestamps are validated
  with calendar round-tripping (`action-schema.md:18–21`).
- **Ordering and time:** `action-schema.md:18–29` describes live adapter
  receipts and forbids backdating server writes. This is an offline seed
  projection: the task explicitly requires log time in `at`. Actions apply
  synchronously in file order; there is no server, receipt, probe, or auth
  capability claim. Timestamps never sort replay or provide wall-clock input.
- **IDs and retry identity:** `action-schema.md:49–52` makes explicit create
  IDs stable keys. They are preserved. Mutation IDs establish edge row IDs;
  same-actor mutation retries are ignored, conflicting retry payloads fail.
  `generate.mjs:641–645,661–670,749–752` models edges by actor and target, so
  repeated sets preserve the existing edge and clears delete it. A reaction
  replacement updates its emoji, mutation ID and timestamp; a clear removes
  it (`action-schema.md:215–226`).
- **Users and profiles:** `action-schema.md:56–76` supplies the actor as the
  user ID and profile replacement semantics. Users emit email, not the parsed
  signup password; this matches the reducer's user projection
  (`generate.mjs:625–637`). Profile IDs equal user IDs. Profile replacement
  takes the latest action's `at` and all six supplied fields.
- **Posts and replies:** `action-schema.md:94–108,135–145` and
  `generate.mjs:647–685` supply media arrays, direct parents, and reply post
  entities. The requested separate `replies` table contains those entities;
  `posts` contains top-level posts only. Likes/reposts and reply parents may
  reference either table. Manifest `posts` counts both; `topLevelPosts` counts
  the exported posts table. Empty media arrays and null parents follow the
  reference reducer. Explicit entity creates cannot silently overwrite rows.
- **DM identity:** `action-schema.md:154–155` requires one DM per pair even
  though `generate.mjs:688–695` assumes unique fixture creates. The first
  conversation ID wins; later create IDs become aliases when resolving
  subsequent conversation foreign keys. The frozen logs need no aliases.
- **Conversations and memberships:** `action-schema.md:167–180` names the
  initial two members and creator/admin. Conversations record `kind` and
  `creatorId`; DM members have role `member`. No initial membership ID exists
  in the grammar or `generate.mjs:688–709`, so those IDs are collision-free
  `conversationId:userId` composites (colon is forbidden in fixture IDs).
  Later member-add uses its mutation ID and adds only absent memberships.
  Member-add requires a group admin and creates require two distinct users.
- **Messages and media:** `action-schema.md:186–213` and
  `generate.mjs:712–745` govern text, caption, media kind, quote, and view-once.
  Text sends have null media/caption; media sends have null text/quote.
  Only earlier retained messages in the same conversation may be quoted.
  Message media replaces the reducer's path string with `{path, byteSize}`,
  using stat metadata from that path; it never reads or embeds media bytes.
  Profile/post media stay path references. The image/video extension and
  video/view-once prohibitions come directly from JSON schema constraints.
  Sender/reactor membership is enforced as an additional messaging-state
  precondition; the reference reducer only checks target existence.
- **Scale selection:** the grammar has no subset operation. It is defined
  as a second replay of retained actions after validating each action against
  the full state. Users are selected by distinct registration order, not ID
  spelling (`action-schema.md:62`). Missing retained references drop actions,
  including quote chains, while the full replay still rejects invalid input
  (`generate.mjs:616–620,674,713–716`). Groups can retain fewer members when
  later member-add targets are excluded; creation still requires both initial
  members. N greater than the registration count preserves the full output.
- **Combined versus scale facts:** `generate.mjs:977–1022,1034–1058` builds
  the manifest by replaying starter before scale. Stats verifies that combined
  state and both checkpoint snapshots, including prefix hash/line/action
  positions, then reports the requested log alone. Thus scale text sends are
  99,105 combined minus 15 starter = 99,090; media sends are 910 minus 0.
  It verifies every state and named-entity leaf using the mappings in
  `generate.mjs:778–919`; inactive/disappearing settings remain zero because
  the grammar has no such action (`generate.mjs:842`). Artifact hashes and
  counts follow `generate.mjs:936–944,1009–1017,1038–1053`. Generator source
  hash, seed, PRNG, clock policy and descriptive stateBase are provenance,
  not replay-state assertions; generate.mjs is not a runtime dependency.
- **Serialization:** the fixture grammar defines actions, not table layout.
  Output is final active state, sorted by ID using code-unit order, with fixed
  object field order and LF-terminated JSON Lines. Largest-conversation ties
  use the same ID order. Empty tables are empty files. Checkpoint markers and
  cleared edges are never seed rows.

LLP orientation: this scope is governed by LLP 3000 §3 (frozen fixture), §4
(Snapback 4 fence), and §5 (week-1 wrapper). No existing wrapper references
needed repair; no new design LLP or shared journal edit was made in this lane.
The README and this report preserve local choices for the lane owner.
