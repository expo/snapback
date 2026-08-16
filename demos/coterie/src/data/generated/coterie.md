# coterie data provider

Generated reference (declaration `4`, inputsHash `e55f0d450e11b583`, generatedAt: DETERMINISTIC).

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

- identity: descriptor `listChats` @ compatibility token `2`
- params: (none)
- result: list of `Chat` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listFeed`

- identity: descriptor `listFeed` @ compatibility token `2`
- params: `mode: string`
- result: list of `FeedItem` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listInsights`

- identity: descriptor `listInsights` @ compatibility token `2`
- params: (none)
- result: list of `InsightDay` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listMessages`

- identity: descriptor `listMessages` @ compatibility token `2`
- params: `chatId: string`
- result: list of `Message` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listProfiles`

- identity: descriptor `listProfiles` @ compatibility token `2`
- params: (none)
- result: list of `Profile` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listSession`

- identity: descriptor `listSession` @ compatibility token `2`
- params: (none)
- result: list of `Session` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `searchSocial`

- identity: descriptor `searchSocial` @ compatibility token `2`
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

- params: `displayName: string`, `bio: string`, `handle: string?`, `location: string?`, `link: string?`
- writes: `accounts`, `messages`, `posts`, `profiles`, `search`
- optimistic: no
- receipts: none

### `login`

- params: `email: string`, `password: string`
- writes: `messages`, `posts`, `profiles`, `sessionRevocations`, `sessions`
- optimistic: no
- receipts: none

### `logout`

- params: (none)
- writes: `sessionRevocations`, `sessions`
- optimistic: no
- receipts: none

### `sendMessage`

- params: `chatId: string`, `body: string`
- writes: `chats`, `messages`
- optimistic: no
- receipts: none

### `setAvatar`

- params: `avatarRef: string`
- writes: `posts`, `profiles`, `search`
- optimistic: no
- receipts: none

### `setChatAccent`

- params: `chatId: string`, `color: string`, `mutationId: string`
- writes: `chats`
- optimistic: no
- receipts: none

### `setDisappearing`

- params: `chatId: string`, `value: string`, `mutationId: string`
- writes: `chats`
- optimistic: no
- receipts: none

### `setFollow`

- params: `userId: string`, `following: boolean`, `mutationId: string`
- writes: `follows`, `posts`, `profiles`
- optimistic: no
- receipts: none

### `setLike`

- params: `postId: string`, `liked: boolean`, `mutationId: string`
- writes: `posts`
- optimistic: no
- receipts: none

### `signup`

- params: `email: string`, `password: string`, `handle: string`, `displayName: string`
- writes: `accounts`, `messages`, `posts`, `profiles`, `search`, `sessionRevocations`, `sessions`
- optimistic: no
- receipts: none

## Provider extensions

- `coterie.fixtureClock`: `"2026-01-01T00:01:30Z"`
- `coterie.fixtureProfile`: `"social-messenger-starter-pack"`
- `coterie.m1CompatibilityTokens`: `{"editProfile":"1","listProfiles":"2","listSession":"2","login":"1","logout":"1","setAvatar":"1","signup":"1"}`
- `coterie.surface`: `"shared Contract binding surface; provider lanes implement this declaration and report additional capabilities separately"`
