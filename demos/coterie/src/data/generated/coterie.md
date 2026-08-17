# coterie data provider

Generated reference (declaration `8`, inputsHash `e0be7bf6f9f5bc27`, generatedAt: DETERMINISTIC).

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

- identity: descriptor `listChats` @ compatibility token `3`
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

- identity: descriptor `listMessages` @ compatibility token `4`
- params: `chatId: string`
- result: list of `Message` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: `ChatMembershipRequiredError` (chat_membership_required), `ChatNotFoundError` (chat_not_found)

### `listProfilePosts`

- identity: descriptor `listProfilePosts` @ compatibility token `1`
- params: `userId: string`
- result: list of `ProfilePost` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: `ProfileNotFoundError` (profile_not_found)

### `listProfiles`

- identity: descriptor `listProfiles` @ compatibility token `3`
- params: (none)
- result: list of `Profile` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listProviderClaims`

- identity: descriptor `listProviderClaims` @ compatibility token `1`
- params: (none)
- result: list of `ProviderClaim` (excess fields: project)
- liveness: mode `snapshot`, push no, initial snapshot yes
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

### `observeTyping`

- identity: descriptor `observeTyping` @ compatibility token `1`
- params: `chatId: string`
- result: list of `TypingParticipant` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: `ChatMembershipRequiredError` (chat_membership_required), `ChatNotFoundError` (chat_not_found)

### `searchSocial`

- identity: descriptor `searchSocial` @ compatibility token `2`
- params: `query: string`
- result: list of `SearchResult` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

## Mutations

### `addMember`

- params: `chatId: string`, `userId: string`
- writes: `chatMemberships`, `chats`
- optimistic: no
- receipts: none

### `createGroup`

- params: `name: string`, `description: string?`, `memberIds: array`
- writes: `chatMemberships`, `chats`
- optimistic: no
- receipts: none

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

### `leaveChat`

- params: `chatId: string`
- writes: `chatMemberships`, `chats`, `ephemeralTyping`, `messageReceipts`, `messages`
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

### `markReceipt`

- params: `chatId: string`, `state: string`
- writes: `chats`, `messageReceipts`
- optimistic: no
- receipts: none

### `openDm`

- params: `userId: string`
- writes: `chatMemberships`, `chats`
- optimistic: no
- receipts: none

### `promoteAdmin`

- params: `chatId: string`, `userId: string`
- writes: `chatMemberships`, `chats`
- optimistic: no
- receipts: none

### `removeMember`

- params: `chatId: string`, `userId: string`
- writes: `chatMemberships`, `chats`, `ephemeralTyping`, `messageReceipts`, `messages`
- optimistic: no
- receipts: none

### `sendMessage`

- params: `chatId: string`, `body: string`, `quotedMessageId: string?`
- writes: `chats`, `ephemeralTyping`, `messageReceipts`, `messages`
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

### `setMessageReaction`

- params: `chatId: string`, `messageId: string`, `emoji: string`, `reacted: boolean`, `mutationId: string`
- writes: `messages`
- optimistic: no
- receipts: none

### `setRepost`

- params: `postId: string`, `reposted: boolean`, `mutationId: string`
- writes: `reposts`
- optimistic: no
- receipts: none

### `setTyping`

- params: `chatId: string`, `active: boolean`
- writes: `ephemeralTyping`
- optimistic: no
- receipts: none

### `signup`

- params: `email: string`, `password: string`, `handle: string`, `displayName: string`
- writes: `accounts`, `messages`, `profiles`, `search`, `sessionRevocations`, `sessions`
- optimistic: no
- receipts: none

## Provider extensions

- `coterie.ephemeralOperations`: `{"typing":{"collection":"ephemeralTyping","durability":"ephemeral","exactBinding":"live-query-plus-mutation bridge until ProviderNativeDeclaration generates first-class ephemeral descriptors","history":false,"observe":"observeTyping","offlineRetention":false,"set":"setTyping","ttlMs":5000,"visibilityTargetMs":2000}}`
- `coterie.fixtureClock`: `"2026-01-01T00:01:30Z"`
- `coterie.fixtureProfile`: `"social-messenger-starter-pack"`
- `coterie.m1CompatibilityTokens`: `{"editProfile":"1","listProfiles":"3","listSession":"2","login":"1","logout":"1","setAvatar":"2","signup":"2"}`
- `coterie.m2CompatibilityTokens`: `{"createPost":"1","listFeed":"3","listProfilePosts":"1","listProfiles":"3","listThread":"1","setFollow":"1","setLike":"1","setRepost":"2"}`
- `coterie.m3CompatibilityTokens`: `{"addMember":"1","createGroup":"1","leaveChat":"1","listChats":"3","listMessages":"4","markReceipt":"1","observeTyping":"1","openDm":"1","promoteAdmin":"1","removeMember":"1","sendMessage":"4","setTyping":"1"}`
- `coterie.m4CompatibilityTokens`: `{"setMessageReaction":"2"}`
- `coterie.m5CompatibilityTokens`: `{"searchSocial":"2","setChatAccent":"1","setDisappearing":"1"}`
- `coterie.receiptSemantics`: `{"departure":"leavers and removed members drop from the aggregate requirement","groupAggregate":"slowest state among required send-time recipients","mark":"markReceipt","scope":"all send-time recipient rows for the active viewer in the chat","states":["sent","delivered","read"],"transition":"monotonic-only"}`
- `coterie.surface`: `"shared Contract binding surface; provider lanes implement this declaration and report additional capabilities separately"`
