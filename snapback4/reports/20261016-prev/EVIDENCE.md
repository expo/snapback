# PREV wave-13 copied-lane preview evidence

Final implementation: `20aee130b3`. Read-only originals: `~/sb4-loop/wave13/apps/`. Each private deployment copy preserves relative release symlinks; a read-only SQLite backup supplies a coherent store. Rollback selects release 1. Deploy previews first select v1 privately, then preview saved v2 with explicit restoration. The baseline executable is the 0.4.29 build retained before narration edits.

| Lane | Rollback WARNINGs before → after | Deploy WARNINGs before → after |
|---|---:|---:|
| 006 | 13 → 6 | 9 → 2 |
| 014 | 16 → 7 | 7 → 1 |
| 016 | 11 → 5 | 7 → 1 |
| 020 | 44 → 20 | 5 → 5 |
| 084 | 21 → 14 | 5 → 2 |

Counts alone are not the acceptance criterion. User-effect warnings replace repetitive per-operation dormancy warnings; real domain, predicate, refusal, missing-operation and safety changes remain. H9 separately proves zero warnings when consulted inputs stay unchanged.

## Lane 006

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addMap.require; old: body/0: require exists admins[viewer] else NOT_ADMIN 'Only tournament admins manage the map pool.' | new: body/0: require exists admins[viewer] else NOT_ADMIN 'Only tournament admins manage the map pool.'
```

After (verbatim):

```text
  WARNING matches changed: 16 guards unproved across addNote, addTeammate, captainNotes.read, restartVeto, roster.delete, roster.insert, skipExpiredTurn, veto; verify their refusal cases before selecting release 1
```

## Lane 014

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addLeg.require; old: body/0: require exists roles[viewer, role = 'captain'] else NOT_CAPTAIN | new: body/0: require exists roles[viewer, role = 'captain'] else NOT_CAPTAIN
```

After (verbatim):

```text
  WARNING queries/counts legsList, nextExchange read legs: active table population 36 → 35, 1 active row leaves; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)
  WARNING release 1's safety dependencies on legs: `assignLeg`, `logHandoff`, `logSplit` cannot see 1 dormant legs row (sample ids [01M51TG026BKN4AFJQYPFK9NMM]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)
```

## Lane 016

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addCell.require; old: body/0: require exists leads[viewer] else NOT_LEAD; body/2 with wall = (murals[mural]) ! else NOT_FOUND: require (not wall.opened) else WALL_OPEN | new: body/0: require exists leads[viewer] else NOT_LEAD; body/2 with wall = (murals[mural]) ! else NOT_FOUND: require (not wall.opened) else WALL_OPEN
```

After (verbatim):

```text
  WARNING cells changed: 13 guards unproved across claimCell, openWall, photos.insert, photos.read, photos.update, reviewCell, submitCell; verify their refusal cases before selecting release 1
```

## Lane 020

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) closeRound.require; old: body/1 with q = (questions[question]) ! else NOT_FOUND: require (q.asker = viewer) else NOT_MANAGER 'Only the asker closes rounds.' | new: body/1 with q = (questions[question]) ! else NOT_FOUND: require (q.asker = viewer) else NOT_MANAGER 'Only the asker closes rounds.'
```

After (verbatim):

```text
  WARNING queries/counts attributed, board, myEstimate, summary read estimates: active table population 4 → 1, 3 active rows leave; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)
  WARNING dependent estimates: 3 active rows go dormant with parent tables questions; preserve these linked records in a bridge or accept their absence in release 1
  WARNING release 1's safety dependencies on estimates: `closeQuestion`, `submitEstimate` cannot see 3 dormant estimates rows (sample ids [01M51T7STHPECQ8SFR3R63NK2D, 01M51T7STRMPKJH07PA9VA8YB2, 01M51T7T2FBAJ1TRW7JTZE5A32]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)
```

## Lane 084

Before (`rollback --to 1 --check`, verbatim):

```text
  WARNING release 1 changes (guard dependencies changed; implication unproved) addBusiness.require; old: body/0: require (openMinute < closeMinute) else BAD_HOURS 'Closing time must be after opening time.'; body/1: require ((exists residents[viewer]) or (exists moderators[viewer])) else NOT_RESIDENT | new: body/0: require (openMinute < closeMinute) else BAD_HOURS 'Closing time must be after opening time.'; body/1: require ((exists residents[viewer]) or (exists moderators[viewer])) else NOT_RESIDENT
```

After (verbatim):

```text
  WARNING queries/counts directory, listing read businesses: active table population 3 → 2, 1 active row leaves; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)
  WARNING release 1's safety dependencies on businesses: `claimBusiness`, `editBusiness`, `issueCode`, `reviewProposal` cannot see 1 dormant businesses row (sample ids [01M51VJJXN8339A1QRVPYQ8XHR]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)
```
