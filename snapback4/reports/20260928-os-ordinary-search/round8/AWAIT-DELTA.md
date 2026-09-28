# Exact await delta: round 7 against RG round 6

RG's manifest has 140 sites; the untouched round-7 census has 141.
`census-before.json` contains the literal old manifest and round-7 census.
`source-await-delta.json` compares all await expressions in the four changed
source files, including owners outside RG's delivery list. `delivery-site-mapping.json`
checks that all 140 original classifications, recipes and absorbs values survive.

Two existing expressions change (their case indices stay 9 and 12):

| Index | RG line → OS line | Before | After | Classification |
| --- | --- | --- | --- | --- |
| 9 | local.ts 535 → 537 | postForCaller(..., captured callback) | postForCaller(..., captured callback, decode) | Required: shared mutation transport/unknown response; retain custody and retry the same ID after recovery. |
| 12 | local.ts 558 → 559 | witnessRestore(json.store_id, json.head ?? json.seq, capture) | searchReplyIdentity(capture, json, generation, witnessRestore) | Optional: query-only restore/identity bookkeeping, inside sendPost's existing catch. |

One new await is inside the existing delivery file/owner scope:
`request-wait.ts:postForCaller:decode(response)#1`, line 18, new index 116.
It is optional to delivery: only searchPost supplies this decoder; mutation
POSTs keep response.json(). Its exception is handled by sendPost; transient
and persistent queryDecode cases retain all delivery assertions.

The original `request-wait.ts:postForCaller:response.json()#1` stays on line 18
and required. Its index changes 116 → 117. Every later existing index 117–139
also moves by +1. None of their expressions changes. The listed clock, restore,
native, sync and hold sites are therefore displaced recipes, not newly added
awaits or newly broken production guards.

There are 11 additional awaits outside RG's delivery owners: two in local-query.ts,
and nine in new local-search.ts. The identity witness is a relocation of the
former inline witness call behind the new helper, not additional delivery work.
Their literal identities and optional fault cases are recorded separately.

## Expanded search coverage

The final census is **156**, adding all nine local-search awaits and all six
local-query.route awaits. Four of the latter existed before OS; covering the
whole owner avoids a special expression filter. All 15 are optional to delivery
and have transient/persistent cases. No search await is excluded or waived.
The original iterator and fallback media rows now move 138 → 154 and 139 → 155.
[SEARCH-SITES.md](./SEARCH-SITES.md) gives their literal IDs and reasons.

## Every moved or changed delivery site

Unchanged identities and locations (68 entries) are omitted from this text table
but remain in the complete JSON mapping. A changed numeric case index does not
mean its source line or expression changed. The final search scope expansion
adds another 15 positions before the original iterator/media appendix.

| Old → final index | File / owner | Old → new line | Change | Class / recipe |
| --- | --- | --- | --- | --- |
| 0 → 0 | `local.ts:read` | 171 → 172 | moved | required / ordinary |
| 1 → 1 | `local.ts:lookup` | 172 → 173 | moved | required / lookup |
| 2 → 2 | `local.ts:save` | 174 → 175 | moved | required / ordinary |
| 3 → 3 | `local.ts:refreshAcquired` | 243 → 244 | moved | optional / ordinary |
| 4 → 4 | `local.ts:captureStore` | 309 → 310 | moved | optional / probe |
| 5 → 5 | `local.ts:call` | 316 → 317 | moved | optional / pending |
| 6 → 6 | `local.ts:call` | 344 → 345 | moved | required / postcommit |
| 7 → 7 | `local.ts:call` | 348 → 349 | moved | optional / media |
| 8 → 8 | `local.ts:sendPost` | 532 → 534 | moved | optional / query |
| 9 → 9 | `local.ts:sendPost` | 535 → 537 | expression | required / ordinary |
| 10 → 10 | `local.ts:sendPost` | 540 → 542 | moved | optional / hold |
| 11 → 11 | `local.ts:sendPost` | 548 → 549 | moved | required / auth |
| 12 → 12 | `local.ts:sendPost` | 558 → 559 | expression | optional / query |
| 13 → 13 | `local.ts:syncRound` | 587 → 589 | moved | optional / pending |
| 14 → 14 | `local.ts:syncRound` | 588 → 590 | moved | optional / ordinary |
| 15 → 15 | `local.ts:syncRound` | 606 → 608 | moved | optional / ordinary |
| 16 → 16 | `local.ts:syncRound` | 621 → 623 | moved | optional / ordinary |
| 17 → 17 | `local.ts:syncRound` | 623 → 625 | moved | optional / ordinary |
| 18 → 18 | `local.ts:syncRound` | 648 → 650 | moved | optional / auth |
| 19 → 19 | `local.ts:syncRound` | 660 → 662 | moved | optional / ordinary |
| 20 → 20 | `local.ts:syncRound` | 675 → 677 | moved | optional / reset |
| 21 → 21 | `local.ts:syncRound` | 680 → 682 | moved | optional / reset |
| 22 → 22 | `local.ts:syncRound` | 697 → 699 | moved | optional / adoption |
| 23 → 23 | `local.ts:syncRound` | 699 → 701 | moved | optional / adoption |
| 24 → 24 | `local.ts:syncRound` | 707 → 709 | moved | optional / adoption |
| 25 → 25 | `local.ts:syncRound` | 708 → 710 | moved | optional / adoption |
| 26 → 26 | `local.ts:syncRound` | 710 → 712 | moved | optional / auth |
| 27 → 27 | `local.ts:syncRound` | 728 → 730 | moved | optional / auth |
| 28 → 28 | `local.ts:syncRound` | 735 → 737 | moved | optional / ordinary |
| 29 → 29 | `local.ts:syncRound` | 744 → 746 | moved | optional / ordinary |
| 30 → 30 | `local.ts:syncRound` | 766 → 768 | moved | optional / ordinary |
| 31 → 31 | `local.ts:syncRound` | 769 → 771 | moved | optional / ordinary |
| 32 → 32 | `local.ts:probe` | 795 → 797 | moved | optional / probe |
| 33 → 33 | `local.ts:probe` | 797 → 799 | moved | optional / probe |
| 34 → 34 | `local.ts:probe` | 799 → 801 | moved | optional / probe |
| 35 → 35 | `local.ts:probe` | 801 → 803 | moved | optional / probe |
| 36 → 36 | `local.ts:probe` | 804 → 806 | moved | optional / probe |
| 37 → 37 | `local.ts:waitForChange` | 814 → 816 | moved | optional / follow |
| 38 → 38 | `local.ts:waitForChange` | 815 → 817 | moved | optional / follow |
| 39 → 39 | `local.ts:waitForChange` | 818 → 820 | moved | optional / follow |
| 40 → 40 | `local.ts:waitForChange` | 823 → 825 | moved | optional / follow |
| 41 → 41 | `local.ts:waitForChange` | 825 → 827 | moved | optional / follow |
| 42 → 42 | `local.ts:waitForChange` | 828 → 830 | moved | optional / follow |
| 43 → 43 | `local.ts:waitForChange` | 835 → 837 | moved | optional / follow |
| 44 → 44 | `local.ts:waitForChange` | 850 → 852 | moved | optional / follow |
| 45 → 45 | `local.ts:follow` | 859 → 861 | moved | optional / follow |
| 46 → 46 | `local.ts:follow` | 862 → 864 | moved | optional / follow |
| 47 → 47 | `local.ts:follow` | 867 → 869 | moved | optional / follow |
| 116 → 117 | `request-wait.ts:postForCaller` | 18 → 18 | moved | required / ordinary |
| 117 → 118 | `local-sync.ts:legacyInput` | 50 → 50 | moved | optional / legacy |
| 118 → 119 | `local-sync.ts:syncTransport` | 67 → 67 | moved | optional / ordinary |
| 119 → 120 | `local-sync.ts:syncTransport` | 68 → 68 | moved | optional / legacy |
| 120 → 121 | `local-sync.ts:syncTransport` | 69 → 69 | moved | optional / legacy |
| 121 → 122 | `device-restore.ts:restoreWitness` | 57 → 57 | moved | optional / probe |
| 122 → 123 | `local-backend.ts:loadBackend` | 11 → 11 | moved | optional / adoption |
| 123 → 124 | `local-backend.ts:loadBackend` | 13 → 13 | moved | optional / adoption |
| 124 → 125 | `local-native.ts:installNativeAttempt` | 16 → 16 | moved | optional / adoption |
| 125 → 126 | `local-native.ts:installNativeAttempt` | 28 → 28 | moved | optional / native |
| 126 → 127 | `local-native.ts:installNativeAttempt` | 41 → 41 | moved | optional / native |
| 127 → 128 | `local-native.ts:installNativeAttempt` | 43 → 43 | moved | optional / native |
| 128 → 129 | `local-native.ts:installNativeAttempt` | 46 → 46 | moved | optional / native |
| 129 → 130 | `pending-writes.ts:revision` | 50 → 50 | moved | optional / hold |
| 130 → 131 | `pending-writes.ts:record` | 57 → 57 | moved | optional / hold |
| 131 → 132 | `pending-writes.ts:record` | 60 → 60 | moved | optional / hold |
| 132 → 133 | `clock.ts:wrapped` | 89 → 89 | moved | required / ordinary |
| 133 → 134 | `clock.ts:save` | 135 → 135 | moved | optional / clock |
| 134 → 135 | `changes.ts:changeFeed` | 52 → 52 | moved | optional / follow |
| 135 → 136 | `changes.ts:changeFeed` | 61 → 61 | moved | optional / follow |
| 136 → 137 | `changes.ts:changeFeed` | 70 → 70 | moved | optional / follow |
| 137 → 138 | `changes.ts:changeFeed` | 74 → 74 | moved | optional / follow |
| 138 → 154 | `local.ts:flushOnce` | 1098 → 1098 | moved | required / ordinary |
| 139 → 155 | `local-assets.ts:remove` | 48 → 48 | moved | optional / media |
