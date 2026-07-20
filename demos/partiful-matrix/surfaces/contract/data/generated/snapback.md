# snapback data provider

Generated reference (declaration `partitime-provider-v1`, inputsHash `5e96f75eae7192af`, generatedAt: DETERMINISTIC).

## Capabilities

- `branchableFixtures`: true
- `cancellation`: true
- `deduplication`: true
- `forceStates`: true
- `headlessBoot`: true
- `initialSnapshot`: true
- `localReplica`: true
- `optimistic`: true
- `pollingCadenceMs`: null
- `push`: true
- `rowSyncState`: true
- `serverRunnableQueries`: true
- `transactions`: true

## Partition policy

- minting: `declared`
- rotation triggers: `authorization-change`, `provider-reconfiguration`

## Queries

### `eventDetails`

- identity: descriptor `eventDetails` @ compatibility token `1`
- params: `eventId: string`
- result: list of `EventRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: promised
- errors: (none)

### `eventWall`

- identity: descriptor `eventWall` @ compatibility token `1`
- params: `eventId: string`
- result: list of `PostRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: promised
- errors: (none)

### `guestList`

- identity: descriptor `guestList` @ compatibility token `1`
- params: `eventId: string`
- result: list of `RsvpRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: promised
- errors: (none)

### `listEvents`

- identity: descriptor `listEvents` @ compatibility token `1`
- params: (none)
- result: list of `EventRow` (excess fields: project)
- liveness: mode `live`, push yes, initial snapshot yes
- receipts: promised
- errors: (none)

## Mutations

### `createEvent`

- params: `accent: string`, `description: string`, `emoji: string`, `hostName: string`, `location: string`, `startsAt: number`, `title: string`
- writes: `events`, `rsvps`
- optimistic: yes
- receipts: promised

### `postMessage`

- params: `authorName: string`, `eventId: string`, `message: string`
- writes: `posts`
- optimistic: yes
- receipts: promised

### `rsvp`

- params: `eventId: string`, `guestName: string`, `status: string`
- writes: `rsvps`
- optimistic: yes
- receipts: promised

## Provider extensions

- `snapback.replica`: `{"path":".snapback/partitime.db"}`
- `snapback.schema`: `{"database":"partitime","version":"partitime-provider-v1"}`
