# coterie data provider

Generated reference (declaration `6`, inputsHash `2b035e0c69068f02`, generatedAt: DETERMINISTIC).

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

- identity: descriptor `listFeed` @ compatibility token `3`
- params: `mode: string`, `cursor: string?`
- result: list of `FeedItem` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: `FeedCursorInvalidError` (feed_cursor_invalid), `FeedModeInvalidError` (feed_mode_invalid)

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

### `listProfilePosts`

- identity: descriptor `listProfilePosts` @ compatibility token `1`
- params: `userId: string`
- result: list of `ProfilePost` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: `ProfileNotFoundError` (profile_not_found)

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

### `listThread`

- identity: descriptor `listThread` @ compatibility token `1`
- params: `parentId: string`
- result: list of `ThreadPost` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: `ParentPostNotFoundError` (parent_post_not_found)

### `searchSocial`

- identity: descriptor `searchSocial` @ compatibility token `2`
- params: `query: string`
- result: list of `SearchResult` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

## Mutations

### `createPost`

- params: `body: string`, `imageRefs: array`, `videoRefs: array`, `parentId: string?`
- writes: `posts`
- optimistic: no
- receipts: none

### `editProfile`

- params: `displayName: string`, `bio: string`, `handle: string?`, `location: string?`, `link: string?`
- writes: `accounts`, `messages`, `profiles`, `search`
- optimistic: no
- receipts: none

### `login`

- params: `email: string`, `password: string`
- writes: `messages`, `profiles`, `sessionRevocations`, `sessions`
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
- writes: `chats`, `profiles`, `search`
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
- writes: `follows`, `profiles`
- optimistic: no
- receipts: none

### `setLike`

- params: `postId: string`, `liked: boolean`, `mutationId: string`
- writes: `likes`
- optimistic: no
- receipts: none

### `setRepost`

- params: `postId: string`, `reposted: boolean`, `mutationId: string`
- writes: `reposts`
- optimistic: no
- receipts: none

### `signup`

- params: `email: string`, `password: string`, `handle: string`, `displayName: string`
- writes: `accounts`, `messages`, `profiles`, `search`, `sessionRevocations`, `sessions`
- optimistic: no
- receipts: none

## Provider extensions

- `coterie.fixtureClock`: `"2026-01-01T00:01:30Z"`
- `coterie.fixtureProfile`: `"social-messenger-starter-pack"`
- `coterie.m1CompatibilityTokens`: `{"editProfile":"1","listProfiles":"2","listSession":"2","login":"1","logout":"1","setAvatar":"2","signup":"2"}`
- `coterie.m2CompatibilityTokens`: `{"createPost":"1","listFeed":"3","listProfilePosts":"1","listProfiles":"2","listThread":"1","setFollow":"1","setLike":"1","setRepost":"2"}`
- `coterie.surface`: `"shared Contract binding surface; provider lanes implement this declaration and report additional capabilities separately"`
