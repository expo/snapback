# Round 6 await audit

Compared the full SDK source against `origin/main` at `dc21eb085` with a
TypeScript AST census, not just the previously instrumented owners.
`source-await-delta.json` records each added/changed and removed expression.
`await-sites.json` records final exact IDs and lines; `await-preservation.json`
maps all 158 main sites and eight appended sites. All 158 existing recipe,
required/optional and absorbs classifications survive. Only existing site 27's
expression changes, to pass LV's captured prediction proof through apply.

The final census has **166 awaits: 49 required, 117 optional**. All have both
transient and persistent injected failures. The complete run passes **333/333**
(332 fault cases and the strict source-wide/census check). Every case reaches
its named await and injects a fault; every optional case posts all three healthy
IDs exactly once while the fault is present. Existing FIFO, one terminal event,
lookup/caller agreement, backoff, frozen-time no-spin and same-ID collection
assertions remain intact. No original owner, recipe, assertion or strength is
removed.

| Final site | Added/changed/moved operation | Class and injected boundary |
| --- | --- | --- |
| 27 | `syncRound: call(apply)` now passes `predictionFreeRevision` and `predictionTables` | Optional observation/apply relative to healthy outbox delivery; actual device call fails, both modes pass. Existing classification unchanged. |
| 158 | `syncRound: queued()` prediction footprint capture | Optional observation; actual queue read fails only in capture context. Dispatch's custody read remains required and independently covered. Both modes pass. |
| 159 | `MediaCache.read: call(state)` before home validation | Optional media API; actual device state read fails beside healthy FIFO. Both modes pass. |
| 160 | `readLocalAsset: media.read(id)` while offline | Optional independent media call; underlying state read fails. Both modes pass. |
| 161 | `readLocalAsset: fetchAsset(...)` with ordered grant callback | Optional independent download; fetch fails below fetchAsset's catch. Both modes pass, including absorbed errors. |
| 162 | `readLocalAsset: refused(...)` | Optional for this live persona's healthy delivery; the no-op refusal callback is explicitly rejected at its call boundary. Both modes pass. This does not permit sends with revoked credentials. |
| 163 | `readLocalAsset: media.read(id)` after transport failure | Optional ordinary-media fallback; transport fails to enter the branch, then its state read receives the transient/persistent injected fault. Both modes pass. |
| 164 | `readLocalAsset: media.invalidate(...)` with refusal/grant ordering | Optional cache housekeeping; manifest device write fails. Both modes pass. |
| 165 | Online `refresh: watch.fetch(...)`, deadline installation moved to accepted reconciliation | Optional observation; instrumented online query transport fails alongside real local device FIFO custody. Both modes pass. |

The four old `local.ts:asset` awaits move into sites 161–164. Offline asset
access additionally awaits its media read so ownership is applied after recovery
(site 160). The separate media state capture is site 159. These were outside the
old delivery-owner list; they are now explicit cases instead of being waived by
updating the source fingerprint. The online refresh expression changed in prior
LV work; it too is now exercised, not merely resealed.

The test-only source transformer appends these sites to preserve FU's numeric
identities. Its generic boundary seal still detects awaits outside known owners;
new sites still have no default classification. Six old resolve-only wait cases
keep their original upstream-failure treatment. The only new direct-rejection
case is the explicitly named no-op refusal callback, matching RG's existing
callback technique. New storage and network cases reject the underlying calls.

The media helper uses the real acquired wasm client's MediaCache and device
storage. Online refresh uses a separate instrumented online client while the
same acquired wasm client holds an unobserved success and two healthy tails.
Response scaffolding selects media/query branches only; all delivery custody,
receipt storage and settlement still run through the real device.

Initial checks: the unchanged 159-site merge matrix passed 319/319. Expanding
coverage first accidentally selected every online await; the strict census
rejected it (one failed census, 14 selected fault cases passed). Correcting the
owner predicate to `refresh` produced 15/15 added-site checks and then the full
333/333. That intermediate red is ours, preserved in `matrix-added.log.gz`.
