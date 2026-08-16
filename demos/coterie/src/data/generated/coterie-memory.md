# coterie-memory data provider

Generated reference (declaration `1`, inputsHash `b99d16d677cfe8b0`, generatedAt: DETERMINISTIC).

## Capabilities

- `branchableFixtures`: false
- `cancellation`: false
- `deduplication`: false
- `forceStates`: false
- `headlessBoot`: true
- `initialSnapshot`: true
- `localReplica`: false
- `optimistic`: false
- `pollingCadenceMs`: null
- `push`: true
- `rowSyncState`: false
- `serverRunnableQueries`: false
- `transactions`: false

## Partition policy

- minting: `per-instance-default`
- rotation triggers: 

## Queries

### `listChats`

- identity: descriptor `listChats` @ compatibility token `1`
- params: (none)
- result: list of `Chat` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listFeed`

- identity: descriptor `listFeed` @ compatibility token `1`
- params: `mode: string`
- result: list of `FeedItem` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listInsights`

- identity: descriptor `listInsights` @ compatibility token `1`
- params: (none)
- result: list of `InsightDay` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listMessages`

- identity: descriptor `listMessages` @ compatibility token `1`
- params: `chatId: string`
- result: list of `Message` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listPollOptions`

- identity: descriptor `listPollOptions` @ compatibility token `1`
- params: `postId: string`
- result: list of `PollOption` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listProfiles`

- identity: descriptor `listProfiles` @ compatibility token `1`
- params: (none)
- result: list of `Profile` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listSession`

- identity: descriptor `listSession` @ compatibility token `1`
- params: (none)
- result: list of `Session` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listTrending`

- identity: descriptor `listTrending` @ compatibility token `1`
- params: (none)
- result: list of `TrendingTopic` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `searchSocial`

- identity: descriptor `searchSocial` @ compatibility token `1`
- params: `query: string`
- result: list of `SearchResult` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

## Mutations

### `createPost`

- params: `body: string`
- writes: `posts`
- optimistic: no
- receipts: none

### `editProfile`

- params: `displayName: string`, `bio: string`
- writes: `profiles`
- optimistic: no
- receipts: none

### `login`

- params: `email: string`, `password: string`
- writes: `sessions`
- optimistic: no
- receipts: none

### `logout`

- params: (none)
- writes: `sessions`
- optimistic: no
- receipts: none

### `sendMessage`

- params: `chatId: string`, `body: string`
- writes: `chats`, `messages`
- optimistic: no
- receipts: none

### `toggleFollow`

- params: `userId: string`
- writes: `profiles`
- optimistic: no
- receipts: none

### `toggleLike`

- params: `postId: string`
- writes: `posts`
- optimistic: no
- receipts: none

### `votePoll`

- params: `postId: string`, `optionId: string`
- writes: `pollOptions`
- optimistic: no
- receipts: none

## Provider extensions

- `coterie.fixtureProfile`: `"clique-feature-parity"`
- `coterie.persistence`: `"process-memory-only"`
