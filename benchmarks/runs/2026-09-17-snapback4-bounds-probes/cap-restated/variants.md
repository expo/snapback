# Cap-restatement and completeness probes (compile-only, snapback4 0.2.27)

Base schema: rooms / members (`cap 100 by roomId`, `cap 1000 by principal`) / messages, all `online only`.

| Variant | Source | `snapback4 check` on 0.2.27 |
|---|---|---|
| C1 capped group, bound restated | `return members[roomId] first 100 by byRoomPrincipal` | ok, no note |
| C2 capped group, no bound | `return members[roomId] by byRoomPrincipal` | **E_QUARRY_TYPE** "supplied (roomId) has the wrong number of keys" — parsed as a point read; the schema's `cap 100 by roomId` is not consulted |
| C3 capped group, bound < cap, no cursor | `return members[roomId] first 20 by byRoomPrincipal` | N_NO_CURSOR |
| C4 mutation loop, no bound | `for m in members[roomId] by byRoomPrincipal:` | **E_QUARRY_TYPE** (same) |
| C5 mutation loop, bound restated | `for m in members[roomId] first 100 by byRoomPrincipal:` | ok ("the literal page bound must cover the schema cap" is the rule that forces 100 to be restated) |
| G6 merge lane source with no bound | `[m.roomId] for m in members[viewer] by byPrincipalRoom` | **E_QUARRY_SYNTAX** "a merge for lane requires a bounded range read" — although `cap 1000 by principal` bounds it |
| G7 filter with inner matching top-1 | `members[viewer] after c first 20 by byPrincipalRoom where count(messages[.roomId] matching q last 1 by byRoomWords) > 0 { roomId }` | ok, no note (see ../grouped-defect for its runtime completeness) |
| G1 `where exists (messages[.roomId] matching q …)` | | **E_QUARRY_SYNTAX** "exists requires an indexed read t[key]" |

## Second batch (same binary), run before the wave-B rulings

| Variant | Source | `snapback4 check` on 0.2.27 |
|---|---|---|
| Q1 query loop over an uncapped prefix, bound stated | `for m in members[viewer] first 1000 by byPrincipalRoom:` | ok |
| Q2 same, no bound | `for m in members[viewer] by byPrincipalRoom:` | **E_QUARRY_TYPE** "supplied (viewer: principal) has the wrong number of keys"; rewrite asks for the full key, never mentions `first N` |
| Q3 whole-group read, `cap 50000 by readerId` | `return inbox[viewer] first 50000 by byReaderTime` | ok + `N_NO_CURSOR` ("a table `cap N by column` can replace a cursor for a single plain group page that … covers N within the examined ceiling; this page still needs continuation") |
| X1 `exists` over a plain prefix | `return exists messages[roomId]` | **E_QUARRY_UNKNOWN** "messages has no unique index over 1 column matching this key"; **rewrite: `unique byColumn: <column>`** — wrong for "does this room have any message" |
| X2 same, index named | `return exists (messages[roomId] by byRoomTime)` | E_QUARRY_TYPE (wrong number of keys) |
| X3 today's only spelling | `return count(messages[roomId] first 1 by byRoomTime) > 0` | ok |
| BY1 page read with no `by` | `return members[viewer] after c first 50` | ok — index inferred (`members.byPrincipalRoom`) |
| BY2 lane source with no `by` | `[m.roomId] for m in members[viewer] first 1000` | ok — index inferred |
| BY3 page read with no `by`, roomId prefix | `return members[roomId] first 100` | ok — `members.byRoomPrincipal` |
