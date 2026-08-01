# A1 sweep design question: any pending outbox intent blanks the retained render on offline relaunch

**Opened:** 2026-08-01
**Systems:** Sync, Client integration
**Related:** LLP 0137 (A1 arm), LLP 0090 (D3 outbox rule), LLP 0043, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f6-pending-outbox-blanks-retained-render.json

Observed on the packaged closure: the same public sites query that cold-boots
retained (freshness 'retained', rows rendered) throws the raw connectivity
error on an offline relaunch once two intents are queued — LLP 0090 D3
("a relaunch with pending intent renders nothing ahead of the full resync").
For the field-notebook shape this is nearly a product contradiction: the act
of capturing offline is exactly what disables the retained render on the next
boot. Firebase and InstantDB both render cached rows plus queued local writes
together after an offline relaunch (frozen Diary 0027).

Ask: a designed presentation for relaunch-with-pending-intent (retained rows
marked retained plus an explicit unsettled-intent fact — still no fabricated
overlay), or a documented mutual-exclusion statement in the offline page so
builders can design around it. The honesty invariant behind D3 must not
regress either way.
