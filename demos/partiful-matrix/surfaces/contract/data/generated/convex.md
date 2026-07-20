# convex data provider

Generated reference (declaration `partitime-provider-v1`, inputsHash `29fc921cf137af79`, generatedAt: DETERMINISTIC).

## Capabilities

- `branchableFixtures`: false
- `cancellation`: false
- `deduplication`: true
- `forceStates`: false
- `headlessBoot`: true
- `initialSnapshot`: true
- `localReplica`: false
- `optimistic`: false
- `pollingCadenceMs`: null
- `push`: true
- `rowSyncState`: false
- `serverRunnableQueries`: true
- `transactions`: true

## Partition policy

- minting: `per-instance-default`
- rotation triggers: `authorization-change`, `provider-reconfiguration`

## Queries

### `eventDetails`

- identity: descriptor `eventDetails` @ compatibility token `1`
- params: `eventId: string`
- result: list of `EventRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `eventWall`

- identity: descriptor `eventWall` @ compatibility token `1`
- params: `eventId: string`
- result: list of `PostRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `guestList`

- identity: descriptor `guestList` @ compatibility token `1`
- params: `eventId: string`
- result: list of `RsvpRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

### `listEvents`

- identity: descriptor `listEvents` @ compatibility token `1`
- params: (none)
- result: list of `EventRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: none
- errors: (none)

## Mutations

### `createEvent`

- params: `accent: string`, `description: string`, `emoji: string`, `hostName: string`, `location: string`, `startsAt: number`, `title: string`
- writes: `events`, `rsvps`
- optimistic: no
- receipts: none

### `postMessage`

- params: `authorName: string`, `eventId: string`, `message: string`
- writes: `posts`
- optimistic: no
- receipts: none

### `rsvp`

- params: `eventId: string`, `guestName: string`, `status: string`
- writes: `rsvps`
- optimistic: no
- receipts: none

## Provider extensions

- `convex.deployment`: `{"name":"partitime-production-shape"}`
- `convex.functions`: `{"schemaVersion":"partitime-provider-v1"}`
