# Paired source density cross-check

This uses exactly the files in attribution.json, excluding recipe, smoke and config files on both sides. Trimmed characters remove line-edge whitespace; structural-only lines contain braces, parentheses, brackets, commas or semicolons and no other text. Neither is a functionality or complexity metric. They show why remaining physical LOC cannot all be assigned to API overhead or extra features. In particular, longer source with fewer characters has a lower physical line density; closing-line layout contributes to that difference. The main table deliberately labels its remainder app/format rather than inventing extra functionality.

| Pair | App/client LOC SB / CX | Trimmed characters SB / CX | Structural-only lines SB / CX |
|---|---:|---:|---:|
| 001 ferry-deck-manifest | 73 / 30 | 26016 / 27575 | 7 / 0 |
| 002 orchard-spray-reentry | 346 / 436 | 14856 / 15766 | 29 / 43 |
| 003 specimen-courier-chain | 47 / 78 | 23115 / 23641 | 4 / 6 |
| 004 fly-rail-cue-locks | 220 / 864 | 13865 / 18687 | 12 / 119 |
| 005 kiln-firing-queue | 81 / 56 | 22347 / 35019 | 10 / 3 |
| 006 dive-boat-buddy-log | 48 / 43 | 17933 / 18034 | 6 / 2 |
| 007 farrier-hoof-rota | 67 / 30 | 22796 / 29805 | 6 / 0 |
| 008 sublet-key-escrow | 171 / 45 | 24698 / 15732 | 19 / 2 |
| 009 choir-part-tracks | 87 / 28 | 18123 / 14024 | 13 / 0 |
| 010 allotment-water-turns | 50 / 55 | 11881 / 15055 | 2 / 4 |
| 011 freezer-rack-ledger | 191 / 492 | 10715 / 15085 | 17 / 69 |
| 012 court-interpreter-slots | 107 / 40 | 41438 / 15981 | 11 / 2 |
| 013 hackathon-rubric-judging | 299 / 705 | 16631 / 19972 | 29 / 83 |
| 014 ice-rink-resurface-slots | 115 / 39 | 19482 / 13703 | 17 / 1 |
| 015 foster-pet-handoffs | 531 / 868 | 24079 / 19974 | 44 / 94 |
| 016 coworking-locker-leases | 60 / 66 | 25655 / 16578 | 8 / 7 |
| 017 trial-symptom-diary | 74 / 41 | 20967 / 14919 | 8 / 2 |
| 018 film-dailies-notes | 61 / 63 | 26182 / 27108 | 7 / 6 |
| 019 apiary-hive-inspections | 250 / 560 | 11958 / 19897 | 22 / 69 |
| 020 tow-yard-release | 352 / 475 | 16187 / 9640 | 28 / 63 |
| 021 moot-court-scoring | 402 / 823 | 18093 / 17704 | 30 / 100 |
| 022 glacier-rope-teams | 93 / 86 | 21121 / 20165 | 11 / 11 |
| 023 brew-comp-blind-flights | 69 / 63 | 25746 / 26781 | 7 / 6 |
| 024 cycle-count-tasks | 239 / 598 | 10778 / 12302 | 16 / 61 |
| 025 cemetery-plot-deeds | 59 / 60 | 29145 / 26133 | 6 / 5 |
| 026 dorm-noise-reports | 164 / 348 | 9047 / 10173 | 16 / 48 |
| 027 podcast-guest-releases | 475 / 618 | 16265 / 17366 | 74 / 76 |
| 028 tool-library-deposits | 61 / 55 | 24312 / 29455 | 6 / 3 |
| 029 fire-lookout-shifts | 52 / 39 | 17495 / 16530 | 2 / 2 |
| 030 harvest-bin-tickets | 411 / 581 | 18992 / 18319 | 31 / 75 |
| 031 piano-tuning-route | 215 / 93 | 28704 / 19111 | 23 / 15 |
| 032 scrim-vod-reviews | 117 / 61 | 17520 / 18245 | 10 / 5 |
| 033 compounding-dual-check | 69 / 56 | 18251 / 15768 | 9 / 6 |
| 034 marina-liveaboard-slips | 632 / 593 | 16043 / 13647 | 81 / 68 |
| 035 archive-reading-requests | 38 / 69 | 13230 / 17493 | 3 / 6 |
| 036 robotics-parts-ledger | 234 / 496 | 10884 / 12400 | 24 / 62 |
| 037 bus-roster-changes | 92 / 1014 | 17287 / 20899 | 10 / 121 |
| 038 hotel-lost-property | 228 / 76 | 24773 / 19814 | 24 / 7 |
| 039 glossary-term-reviews | 124 / 44 | 23940 / 17673 | 15 / 4 |
| 040 route-setting-rotation | 387 / 420 | 16140 / 11837 | 55 / 46 |
| 041 community-fridge-restocks | 320 / 556 | 17460 / 12926 | 21 / 73 |
| 042 sterile-tray-tracking | 272 / 1240 | 14611 / 28100 | 28 / 150 |
| 043 wedding-vendor-timeline | 59 / 53 | 26995 / 22381 | 4 / 4 |
| 044 ham-net-checkins | 178 / 366 | 10712 / 13291 | 14 / 44 |
| 045 instrument-loan-bank | 358 / 633 | 16173 / 14413 | 26 / 86 |
| 046 greenhouse-climate-alarms | 80 / 48 | 16164 / 18732 | 10 / 8 |
| 047 mural-wall-permits | 64 / 47 | 30787 / 29954 | 8 / 4 |
| 048 boiler-room-rounds | 466 / 728 | 20558 / 16069 | 34 / 80 |
| 049 cheese-cave-wheels | 83 / 48 | 26471 / 20981 | 7 / 5 |
| 050 ambulance-crew-checkout | 90 / 61 | 23361 / 19252 | 9 / 4 |
