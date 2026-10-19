# Fifty-shape survey

Surveyed all 50 wave-17 change requests and each corresponding Snapback final schema and available migration/bridge files. The executable core fixture runs every scalar shape through adoption, rollback and forward; it is a shape test, not a claim to run all 50 full applications. Five complete copied apps are measured separately. Security policy implementation remains SEC3-owned; release selection/restoration remains REL5-owned.

| Lane | App | Existing migration code | Declarative historical patch |
|---|---|---|---|
| 001 | ferry-deck-manifest | job backfillVehicleClasses() | `{vehicleClass: 'commercial' if weight > 3500 else 'van' if length >= 500 else 'car'}` |
| 002 | orchard-spray-reentry | mutation backfillRate(application | `{amount:rate, unit:'qt/acre'}` |
| 003 | specimen-courier-chain | No named migration in final schema/bridge | `{priority: 'routine'}` |
| 004 | fly-rail-cue-locks | mutation migrateCueStatuses() | `{status:'complete' if status = 'done' else status}` |
| 005 | kiln-firing-queue | mutation backfillPiece(piece; mutation backfillFiring(firing | `{firingType:'bisque' if startsWith(cone, '0') else 'glaze'}` |
| 006 | dive-boat-buddy-log | job migrateNames() | `{firstName:beforeLast(name, ' '), lastName:afterLast(name, ' ')}` |
| 007 | farrier-hoof-rota | job migrateCycles() | `{cycleWeeks: 6}` |
| 008 | sublet-key-escrow | job migrateKeyStatuses(); schedule migrateLegacyKeys every 1m | `{status:'key overdue' if status = 'flagged' else status}` |
| 009 | choir-part-tracks | job migrateProgress() | `{progress:'learned' if learned else 'not started'}` |
| 010 | allotment-water-turns | No named migration in final schema/bridge | `{plot:plot}` |
| 011 | freezer-rack-ledger | No named migration in final schema/bridge | `{hazard: 'BSL-1'}` |
| 012 | court-interpreter-slots | job migratePartySides() | `{petitioner:trim(before(partyNames, ' v. ')), respondent:trim(after(partyNames, ' v. '))}` |
| 013 | hackathon-rubric-judging | No named migration in final schema/bridge | `{track: 'general'}` |
| 014 | ice-rink-resurface-slots | job migratePublicSkating() | `{kind:'public session' if kind = 'public skating' else kind}` |
| 015 | foster-pet-handoffs | No named migration in final schema/bridge | `{kind:'adoption' if recipientRole = 'adopter' else 'foster placement' if senderRole = 'shelter' and recipientRole = 'foster' else 'return to shelter' if senderRole = 'foster' and recipientRole = 'shelter' else 'intake'}` |
| 016 | coworking-locker-leases | job migrateLeaseOutcomes() | `{status:('evicted' if reason != null else 'lapsed') if status = 'ended' else status}` |
| 017 | trial-symptom-diary | No named migration in final schema/bridge | `{enteredBy: 'participant'}` |
| 018 | film-dailies-notes | job migrateNoteRanges() | `{start:timeCode, end:timeCode}` |
| 019 | apiary-hive-inspections | No named migration in final schema/bridge | `{treatment: 'none'}` |
| 020 | tow-yard-release | job backfillHolds() | `{kind: 'evidence'}` |
| 021 | moot-court-scoring | No named migration in final schema/bridge | `{side: 'petitioner'}` |
| 022 | glacier-rope-teams | No named migration in final schema/bridge | `{status:'cancelled for weather' if status = 'cancelled' else status}` |
| 023 | brew-comp-blind-flights | No named migration in final schema/bridge | `{bottleCount: 2}` |
| 024 | cycle-count-tasks | mutation backfillCountedBy(task | `{assignedCounter:counter, countedBy:counter if completed else null}` |
| 025 | cemetery-plot-deeds | No named migration in final schema/bridge | `{kind: 'casket'}` |
| 026 | dorm-noise-reports | No named migration in final schema/bridge | `{kind:'written'}` |
| 027 | podcast-guest-releases | mutation backfillReleaseShow(release | `{scope: 'audio only'}` |
| 028 | tool-library-deposits | No named migration in final schema/bridge | `{suspension:'overdue' if suspended else null}` |
| 029 | fire-lookout-shifts | job migrateConfidence() | `{confidence:'confirmed' if crossReferenced else 'possible'}` |
| 030 | harvest-bin-tickets | No named migration in final schema/bridge | `{gross:weight, tare:0, net:weight}` |
| 031 | piano-tuning-route | No named migration in final schema/bridge | `{pianoType: 'upright'}` |
| 032 | scrim-vod-reviews | No named migration in final schema/bridge | `{visibility:'staff only' if privateToStaff else 'team'}` |
| 033 | compounding-dual-check | No named migration in final schema/bridge | `{sterile: false}` |
| 034 | marina-liveaboard-slips | No named migration in final schema/bridge | `{slipClass:'liveaboard' if liveaboard else 'standard'}` |
| 035 | archive-reading-requests | No named migration in final schema/bridge | `{purpose: 'other'}` |
| 036 | robotics-parts-ledger | job backfillPrices(periodStart; schedule backfillDaily every 1d at 01 | `{unitPrice:price, quantity:1, total:price * 1}` |
| 037 | bus-roster-changes | job migrateReasons() | `{reason: 'other'}` |
| 038 | hotel-lost-property | job migrateLocations() | `{locationType:'guest room' if allDigits(location) else 'public area', location:location}` |
| 039 | glossary-term-reviews | No named migration in final schema/bridge | `{register: 'neutral'}` |
| 040 | route-setting-rotation | No named migration in final schema/bridge | `{discipline:'boulder' if startsWith(grade, 'V') else 'rope', grade:grade}` |
| 041 | community-fridge-restocks | No named migration in final schema/bridge | `{category:'perishable' if useBy != null else 'shelf-stable'}` |
| 042 | sterile-tray-tracking | No named migration in final schema/bridge | `{status:('recalled' if recalled else 'expired') if status = 'unusable' else status}` |
| 043 | wedding-vendor-timeline | No named migration in final schema/bridge | `{category: 'other'}` |
| 044 | ham-net-checkins | job backfillRoutinePrecedence(); schedule backfillEveryMinute every 1m | `{precedence:'routine' if traffic != null else null, text:traffic}` |
| 045 | instrument-loan-bank | No named migration in final schema/bridge | `{grade: 'good'}` |
| 046 | greenhouse-climate-alarms | job migrateNightRanges() | `{dayMinTemp:minTemp, dayMaxTemp:maxTemp, nightMinTemp:minTemp, nightMaxTemp:maxTemp, dayMinHumidity:minHumidity, dayMaxHumidity:maxHumidity, nightMinHumidity:minHumidity, nightMaxHumidity:maxHumidity}` |
| 047 | mural-wall-permits | No named migration in final schema/bridge | `{medium: 'paint'}` |
| 048 | boiler-room-rounds | No named migration in final schema/bridge | `{low:0, high:limit}` |
| 049 | cheese-cave-wheels | No named migration in final schema/bridge | `{milkType: 'cow'}` |
| 050 | ambulance-crew-checkout | No named migration in final schema/bridge | `{status:'checkout pending' if status = 'out of service' else status}` |

Lane 009’s sparse singer/piece pairs continue to use the ordinary absent-row → `not started` query fallback; no migration materializes a Cartesian product. Lane 015’s party classification uses captured roles or unique member lookups; `unique_lookup_uses_historical_rows_and_rechecks_changed_lookup_values` exercises the actual lookup rather than only its scalar fixture. Lane 029’s confidence uses a cross-tower, time-window existence predicate; `cross_reference_existence_is_evaluated_before_any_table_output_changes` exercises the full predicate. Required future inputs and writes are ordinary schema/mutation changes alongside the historical patch.

Five-copy timing compares both workflows using the same current binary and independently cloned v1 production data, excluding preparation, assertions, and declarative preview. This measures command execution, not agent authoring time. Original database/WAL bytes are copied before SQLite opens the private snapshot; original stores are never opened by SQLite or modified.
