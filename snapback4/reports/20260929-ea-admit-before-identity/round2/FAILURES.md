# Round 2 failure ledger

The full suite was invoked once. Its exact summary is recorded in REPORT.md.
All failures below are classified **ours**, including verification interference
from updating artifacts while responding to Grok during the full run. No
failure is assigned to baseline or environment without evidence. A later pass
is reported separately; it does not rewrite the full-suite result.

## Full-suite Rust failure

**Ours:** `snapback4-lang::guide` →
`familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`:
`18300 -> 12824: less than 30% reduction`. The first compiled full-suite guide
included excess admission text after the AG merge. Final condensed text passes
99/99 (`guide-complete-final.log`). The existing word budget is unchanged.

## Full-suite client categories

- **NATIVE-META (ours):** the initial new native read verb broke fake/wrapped
  devices (E_OP, unexpected-call, or boolean parsed as a deferred array).
  Replaced it with native transactional handling of the existing metadata verb.
- **BUILD-OVERLAP (ours):** canonical wasm rebuild briefly removed the generated
  file while tests opened it (four ENOENTs), and late native openers using the
  already-imported old JS encountered the rebuilt native dispatch. No permanent
  build or device failure is claimed. Final artifacts are stable for rechecks.
- **RETIREMENT-BARRIER (ours):** four fixtures held the second admission before
  the first dispatch could take its new claim. Explicitly order first POST,
  then held second save; preserve all durable-retirement assertions.
- **AWAIT-SEAL (ours):** the full client stage read the boundary seal before it
  was updated for the new online claim awaits. Final classification and fault
  recipes pass all 323 cases, including the added close-custody reads.
- **REACT-PEER (ours):** fixture required two simultaneous successful retries
  for one ID. It now asserts one successful retry plus both terminal hooks.
- **RESTORE-SCOPE (ours):** initially exposed ordinary restored pending entries.
  Restricted the visibility exception to deferred custody; both original
  wasm/process hiding regressions pass unchanged.
- **NATIVE-LIFECYCLE (ours):** extra custody reads exposed delayed-sync and
  close-after-correlation races. Reserve explicit sync immediately and recover
  close outcomes from durable custody. Existing assertions remain unchanged.
- **FOLLOW-UP (ours, conservative attribution):** browser timing failure retained
  verbatim below and rechecked; do not relabel an unproved cause environmental.

The full client stage reports **4813 tests, 4556 pass, 246 fail, 1 cancelled,
10 skipped**. The detailed reporter lists 244 individual entries below. Its
three additional aggregate outcomes are React hooks and reference-app lifetimes,
oversized indivisible commit replaces deferred effects on wasm and SQLite,
and round 9-12 client head observations and startup installation. These are
ours too and are covered by the original detail log plus nested rechecks.

## Every individually reported client failure

| Test/location | Classification and cause |
| --- | --- |
| wasm: ordinary search loading classification<br>`answers-stay-review.test.mjs:193:98` | ours — BUILD-OVERLAP |
| wasm: ordinary search denied classification<br>`answers-stay-review.test.mjs:193:98` | ours — BUILD-OVERLAP |
| online app reopens after replacement; replacement accepts session: true<br>`app-store-replacement.test.mjs:14:39` | ours — RETIREMENT-BARRIER |
| online app reopens after replacement; replacement accepts session: false<br>`app-store-replacement.test.mjs:14:39` | ours — RETIREMENT-BARRIER |
| replacement waits for durable retirement of admitted writes; persistence fails: false<br>`app-store-replacement.test.mjs:96:35` | ours — RETIREMENT-BARRIER |
| replacement waits for durable retirement of admitted writes; persistence fails: true<br>`app-store-replacement.test.mjs:96:35` | ours — RETIREMENT-BARRIER |
| event slots wasm: owned-event fallback waits for the source prediction<br>`bounded-following.test.mjs:122:3` | ours — NATIVE-META |
| event slots wasm: rejected owned events cannot make a speculative scan publishable<br>`bounded-following.test.mjs:172:3` | ours — NATIVE-META |
| bounded Following wasm: unrelated held reads cannot validate speculative refusals or empty pages<br>`bounded-following.test.mjs:204:3` | ours — NATIVE-META |
| bounded Following wasm: unknown conditions preserve static and helper dependencies<br>`bounded-following.test.mjs:274:3` | ours — NATIVE-META |
| bounded Following wasm: a scalar cut before the feed keeps its possible reads fenced<br>`bounded-following.test.mjs:329:3` | ours — NATIVE-META |
| bounded Following wasm: a known branch wins over static server routing<br>`bounded-following.test.mjs:352:3` | ours — NATIVE-META |
| bounded Following wasm: a speculative profile withholds while a non-speculative page keeps predicted rows<br>`bounded-following.test.mjs:383:3` | ours — NATIVE-META |
| bounded Following wasm: a late card miss and oversized withheld output still use fallback<br>`bounded-following.test.mjs:437:3` | ours — NATIVE-META |
| bounded Following wasm: untaken online-only card branches remain answerable when held<br>`bounded-following.test.mjs:474:3` | ours — NATIVE-META |
| bounded Following wasm: composed reads withhold the entire answer across the prediction fence<br>`bounded-following.test.mjs:497:3` | ours — NATIVE-META |
| bounded Following wasm: exact offline pages, original-cursor fallback and quiet authors<br>`bounded-following.test.mjs:522:3` | ours — NATIVE-META |
| bounded Following wasm: a predicted post fences fallback until observation<br>`bounded-following.test.mjs:557:3` | ours — NATIVE-META |
| bounded Following wasm: online-only cards withhold offline<br>`bounded-following.test.mjs:584:3` | ours — NATIVE-META |
| bounded Following wasm: repost prediction needs a held original<br>`bounded-following.test.mjs:596:3` | ours — NATIVE-META |
| bounded Following wasm: held cards and transport failures stay withheld<br>`bounded-following.test.mjs:608:3` | ours — NATIVE-META |
| bounded Following wasm: online-only repost cards use the prediction fence before server routing<br>`bounded-following.test.mjs:621:3` | ours — NATIVE-META |
| bounded Following wasm: a response racing prediction admission is invalidated<br>`bounded-following.test.mjs:644:3` | ours — NATIVE-META |
| bounded Following wasm: repost horizon misses withhold but full-source nulls remain data<br>`bounded-following.test.mjs:656:3` | ours — NATIVE-META |
| bounded Following wasm: inbox floors use all routing branches and preserve meter prefixes<br>`bounded-following.test.mjs:666:3` | ours — NATIVE-META |
| local pending writes emit once with the kept device identity<br>`client-lifecycle.test.mjs:152:60` | ours — NATIVE-META |
| local pending writes emit once with their original binding ahead of a newer device identity<br>`client-lifecycle.test.mjs:152:60` | ours — NATIVE-META |
| local reconnect requires the authenticated GET /probe contract<br>`client-lifecycle.test.mjs:187:1` | ours — NATIVE-META |
| local startup releases a device when initialization after the protocol probe fails<br>`client-lifecycle.test.mjs:227:1` | ours — NATIVE-META |
| local sync shrinks response-bound pages at one cursor and exposes an indivisible refusal<br>`client-lifecycle.test.mjs:238:1` | ours — NATIVE-META |
| local observations skip idle polls and rerun after a committed page<br>`client-lifecycle.test.mjs:267:1` | ours — NATIVE-META |
| local generation adoption reruns observations whose dependencies changed<br>`client-lifecycle.test.mjs:303:1` | ours — NATIVE-META |
| closing a pending watch prevents its response from scheduling expiry or rerunning dirty work<br>`client-lifecycle.test.mjs:348:1` | ours — NATIVE-META |
| local auth invalidation notifies viewer listeners before session deletion can fail<br>`client-lifecycle.test.mjs:418:1` | ours — NATIVE-META |
| local observations rerun when the device-reported visible lifetime expires<br>`client-lifecycle.test.mjs:450:1` | ours — NATIVE-META |
| a refused device adopt keeps the previous backend active in JavaScript<br>`client-lifecycle.test.mjs:490:1` | ours — NATIVE-META |
| a failed native replacement falls back without a stale local answer and is retried<br>`client-lifecycle.test.mjs:520:1` | ours — NATIVE-META |
| every local prediction invalidates observations, including unrelated tables<br>`client-lifecycle.test.mjs:574:1` | ours — NATIVE-META |
| wasm: population growth cannot mint new IDs during prediction replay<br>`client-lifecycle.test.mjs:1083:3` | ours — NATIVE-META |
| wasm: retry without observers, online-only routing and denied-watch recovery<br>`client-lifecycle.test.mjs:1134:3` | ours — NATIVE-META |
| native: sync before a delayed write reply does not apply an increment twice<br>`client-lifecycle.test.mjs:993:5` | ours — NATIVE-LIFECYCLE |
| native: sync before a lost write reply does not apply an increment twice<br>`client-lifecycle.test.mjs:993:5` | ours — NATIVE-LIFECYCLE |
| wasm: close waits for an applying acknowledgment and aborts sync<br>`client-lifecycle.test.mjs:1323:3` | ours — NATIVE-META |
| W13b fallback boundary: cursorless<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: meter<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: words<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: missing fact<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: presence<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: offline missing fact<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: held<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: retained<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W13b fallback boundary: pending predictable write<br>`client-lifecycle.test.mjs:1374:4` | ours — NATIVE-META |
| W6d web: reopen deduplicates the queued caller id before prediction<br>`client-seams.test.mjs:351:26` | ours — BUILD-OVERLAP |
| W6d native: caller id retries share pending writes and retained receipts<br>`client-seams.test.mjs:230:3` | ours — BUILD-OVERLAP |
| W8a web held horizon stays local online, including observe<br>`client-seams.test.mjs:981:39` | ours — NATIVE-META |
| composed watch wasm: revocation fences pre-revocation server fields<br>`composed-authority.test.mjs:68:3` | ours — NATIVE-META |
| composed query wasm: revocation fences pre-revocation server fields<br>`composed-authority.test.mjs:68:3` | ours — NATIVE-META |
| composed query return wasm: revocation fences pre-revocation server fields<br>`composed-authority.test.mjs:68:3` | ours — NATIVE-META |
| every delivery await is explicitly classified<br>`delivery-fault-matrix.test.mjs:42:1` | ours — AWAIT-SEAL |
| expiry retry chained permits wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| expiry retry populated watch wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| expiry retry server pagination wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| expiry retry server pagination watch wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| expiry retry remembered branch wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| expiry retry remembered branch watch wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| expiry retry remembered branch timer watch wasm<br>`expiry-retry-watch.test.mjs:75:3` | ours — NATIVE-META |
| Following becomes withheld on composed re-observation: server<br>`following-routing.test.mjs:8:3` | ours — NATIVE-META |
| Following becomes withheld on composed re-observation: offline<br>`following-routing.test.mjs:8:3` | ours — NATIVE-META |
| Following becomes withheld on composed re-observation: pending<br>`following-routing.test.mjs:8:3` | ours — NATIVE-META |
| Following becomes withheld on composed re-observation: transport recovered<br>`following-routing.test.mjs:8:3` | ours — NATIVE-META |
| wasm acquisition boundary: public timeline<br>`horizon-boundary.test.mjs:42:36` | ours — NATIVE-META |
| wasm acquisition boundary: conversation ordinal<br>`horizon-boundary.test.mjs:42:36` | ours — NATIVE-META |
| createApp keep=true property: process, seed 23, 50ms authority<br>`keep-app-model.test.mjs:33:3` | ours — BUILD-OVERLAP |
| createApp keep=true property: process, seed 44, 50ms authority<br>`keep-app-model.test.mjs:33:3` | ours — BUILD-OVERLAP |
| createApp keep=true property: process, seed 445, 50ms authority<br>`keep-app-model.test.mjs:33:3` | ours — BUILD-OVERLAP |
| createApp keep=true: useQuery and usePage preserve inputs through 20 replacements, loaded cursors and removal<br>`keep-authority-react.test.mjs:11:39` | ours — FOLLOW-UP |
| local sign-out completes with logout stalled and a fresh store cannot reopen the old account<br>`local-signout.test.mjs:64:1` | ours — NATIVE-META |
| sign-out revokes a delayed refresh request without adopting it<br>`local-signout.test.mjs:81:3` | ours — NATIVE-META |
| sign-out revokes a delayed refresh request ignoring abort without adopting it<br>`local-signout.test.mjs:81:3` | ours — NATIVE-META |
| sign-out revokes a delayed refresh body ignoring abort without adopting it<br>`local-signout.test.mjs:81:3` | ours — NATIVE-META |
| sign-out completes locally when refresh never returns<br>`local-signout.test.mjs:134:1` | ours — NATIVE-META |
| sign-out retains an already-resolved rotation until its adoption microtask<br>`local-signout.test.mjs:146:1` | ours — NATIVE-META |
| sign-out deletes after an already-started persistent refresh write, never before it<br>`local-signout.test.mjs:181:1` | ours — NATIVE-META |
| a failed credential deletion rejects sign-out and can be retried<br>`local-signout.test.mjs:198:1` | ours — NATIVE-META |
| media cleanup cannot postpone durable credential deletion<br>`local-signout.test.mjs:209:1` | ours — NATIVE-META |
| ordinary close detaches an unread rotation and retires its later successor<br>`local-signout.test.mjs:221:1` | ours — NATIVE-META |
| column activation: wasm, server watch<br>`maintained-column-adoption.test.mjs:33:3` | ours — NATIVE-META |
| column activation: wasm, device watch<br>`maintained-column-adoption.test.mjs:33:3` | ours — NATIVE-META |
| README client card members are functions on both tiers, except device-only sync<br>`online-session.test.mjs:34:1` | ours — NATIVE-META |
| wasm: comparative history preserves stored fields, edits and view-once assets<br>`ordinary-history.test.mjs:70:3` | ours — NATIVE-META |
| wasm: comparative DM before acquisition, HTTP decorations, and unpredicted offline send<br>`ordinary-history.test.mjs:131:3` | ours — NATIVE-META |
| wasm: app screen and history after leave, remount and offline/online reopen<br>`ordinary-history.test.mjs:200:3` | ours — NATIVE-META |
| wasm: receipts screen and history after leave, remount and offline/online reopen<br>`ordinary-history.test.mjs:200:3` | ours — NATIVE-META |
| wasm: receipts screen and history after leave, remount and offline/online reopen (older sync held across leave)<br>`ordinary-history.test.mjs:200:3` | ours — NATIVE-META |
| wasm: comparative screen and history after leave, remount and offline/online reopen<br>`ordinary-history.test.mjs:200:3` | ours — NATIVE-META |
| ordinary search full last 86 overlaps process<br>`ordinary-search-oracle.test.mjs:393:5` | ours — NATIVE-META |
| ordinary search full last 100 overlaps process<br>`ordinary-search-oracle.test.mjs:393:5` | ours — NATIVE-META |
| expired current replacement keeps retained history process<br>`ordinary-search-oracle.test.mjs:398:5` | ours — NATIVE-META |
| native client reset with an unobserved prediction<br>`prediction-routing.test.mjs:218:37` | ours — NATIVE-META |
| native client reset with an unobserved prediction held<br>`prediction-routing.test.mjs:218:37` | ours — NATIVE-META |
| native client install failure with an unobserved prediction<br>`prediction-routing.test.mjs:218:37` | ours — NATIVE-META |
| native client install failure with an unobserved prediction held<br>`prediction-routing.test.mjs:218:37` | ours — NATIVE-META |
| rule 1: sign-out during local cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: sign-out during dispatch cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: sign-out during transport cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: sign-out during delivery cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: sign-out during publication cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: close during local cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: close during dispatch cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: close during transport cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: close during delivery cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| rule 1: close during publication cannot publish private data<br>`query-publication-session.test.mjs:8:3` | ours — NATIVE-META |
| two online owners notify both pending-write hooks when the shared journal settles once<br>`react.test.mjs:153:15` | ours — REACT-PEER |
| wasm: retained nested rows follow source parents on reordered pages<br>`read-through-provenance.test.mjs:114:38` | ours — NATIVE-META |
| wasm: retained nested rows follow source parents on shifted pages<br>`read-through-provenance.test.mjs:114:38` | ours — NATIVE-META |
| wasm: composed tables sharing an ID keep independent retained rows<br>`read-through-provenance.test.mjs:136:3` | ours — NATIVE-META |
| wasm: projections without id replace a retained copy using its source envelope<br>`read-through-provenance.test.mjs:147:3` | ours — NATIVE-META |
| wasm: an identityless object merges its identified child rows<br>`read-through-provenance.test.mjs:164:3` | ours — NATIVE-META |
| wasm: an unidentified sibling preserves paired parents and drops an unpaired current row<br>`read-through-provenance.test.mjs:180:3` | ours — NATIVE-META |
| wasm: an anonymous nested page appends only retained history after a partial rejoin<br>`read-through-provenance.test.mjs:200:3` | ours — NATIVE-META |
| wasm: an in-place edit under an anonymous nested page replaces its retained copy<br>`read-through-provenance.test.mjs:219:3` | ours — NATIVE-META |
| wasm: Clique capture partitions and answers equal the flattened program<br>`read-through.test.mjs:8:39` | ours — NATIVE-META |
| wasm: an unheld parent falls back without losing retained rows<br>`read-through.test.mjs:70:39` | ours — NATIVE-META |
| wasm: four-level capture, covered prediction and inherited expiry<br>`read-through.test.mjs:115:39` | ours — NATIVE-META |
| wasm: retained children do not terminally refuse a reused parent delete<br>`read-through.test.mjs:159:39` | ours — NATIVE-META |
| wasm: an expired unswept matching child queues its parent delete<br>`read-through.test.mjs:197:39` | ours — NATIVE-META |
| wasm<br>`repair-b-overflow.test.mjs:127:36` | ours — NATIVE-META |
| private commits rerun the published image without adopting the staged identity<br>`repair-b-round7.test.mjs:28:1` | ours — NATIVE-META |
| ordinary publication keeps stream mode through false snapshot mode and an interrupted round<br>`repair-b-round7.test.mjs:84:1` | ours — NATIVE-META |
| change polling takes published native progress after another owner advances<br>`repair-b-round7.test.mjs:115:1` | ours — NATIVE-META |
| publication notifies watches even when its following state read fails; retry uses durable progress<br>`repair-b-round8.test.mjs:4:1` | ours — NATIVE-META |
| wasm: first-install-overlap head 15, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: first-install-overlap head 19, snapshot true<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: first-install-healthy head 20, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: fresh head 25, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: startup-generation head 15, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: startup-generation head 19, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: startup-generation head 19, snapshot true<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: startup-generation-native head 15, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: startup-generation-native head 19, snapshot true<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: healthy-generation head 20, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: replacement-generation head 15, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| wasm: offline-generation head 0, snapshot false<br>`repair-b-round9.test.mjs:86:13` | ours — NATIVE-META |
| catch-up requests adopt the device transfer cursor<br>`repair-b.test.mjs:118:1` | ours — NATIVE-META |
| interrupted snapshot catch-up resumes its durable mode<br>`repair-b.test.mjs:166:1` | ours — NATIVE-META |
| generation adoption compares published identity during private acquisition<br>`repair-b.test.mjs:227:1` | ours — NATIVE-META |
| provenance wasm: wrapped presence recovers false, shaped rows without ids stay partial<br>`residency.test.mjs:260:3` | ours — NATIVE-META |
| W14A horizon-free matching wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| W14A positive existence wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| R5 history wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| R1a empty search wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| R1a mixed reads wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| R2 mixed result wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| R2 sync during reply wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ authoritative bound wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ speculative component wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ speculative events wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ expiry local left wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ expiry local watch left wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ local permit wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ local permit watch wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ local branch wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ local branch watch wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ local page wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ ineligible wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ points wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ delete current wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ revoke current wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ rejoin wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ held change wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ close wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ sign-out wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ transport wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ adoption wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ reset wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ rotation wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ prediction wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ expiry left wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ expiry held wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ interrupted snapshot wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| MQ retained snapshot wasm: retained history and independent held coverage<br>`retained-history.test.mjs:119:749` | ours — NATIVE-META |
| schema startup 503/E_STORE/true: keeps saved session connected<br>`schema-session.test.mjs:15:3` | ours — NATIVE-META |
| schema startup 503/E_AUTH/true: keeps saved session connected<br>`schema-session.test.mjs:15:3` | ours — NATIVE-META |
| schema startup 403/E_STORE/false: keeps saved session connected<br>`schema-session.test.mjs:15:3` | ours — NATIVE-META |
| schema startup 200/E_STORE/true: keeps saved session connected<br>`schema-session.test.mjs:15:3` | ours — NATIVE-META |
| fallback: a deadline behind the issued floor does not loop server refetches<br>`server-clock-regressions.test.mjs:77:59` | ours — NATIVE-META |
| composition: a deadline behind the issued floor does not loop server refetches<br>`server-clock-regressions.test.mjs:77:59` | ours — NATIVE-META |
| syncedAt, device since and remembered server since remain wall time under +25h skew<br>`server-clock-regressions.test.mjs:96:1` | ours — NATIVE-META |
| held device publication enforces the 16.7ms frame bound with controlled scheduling<br>`server-clock-regressions.test.mjs:119:1` | ours — NATIVE-META |
| a one-millisecond recovered floor crossing republishes a held deadline immediately<br>`server-clock-regressions.test.mjs:134:1` | ours — NATIVE-META |
| composition publishes at both deadlines, device first<br>`server-clock-regressions.test.mjs:151:45` | ours — NATIVE-META |
| composition publishes at both deadlines, server first<br>`server-clock-regressions.test.mjs:151:45` | ours — NATIVE-META |
| offline upgrades omit ambiguous round-zero syncedAt until a wall-time resync<br>`server-clock-regressions.test.mjs:173:1` | ours — NATIVE-META |
| an offline reopen clamps versioned freshness saved before a wall rollback<br>`server-clock-regressions.test.mjs:189:1` | ours — NATIVE-META |
| freshness is clamped at publication after wall time rolls back<br>`server-clock-regressions.test.mjs:197:1` | ours — NATIVE-META |
| remembered wakeup retains data until its own server deadline (null, early=false)<br>`server-clock-regressions.test.mjs:245:95` | ours — NATIVE-META |
| remembered wakeup retains data until its own server deadline (null, early=true)<br>`server-clock-regressions.test.mjs:245:95` | ours — NATIVE-META |
| remembered wakeup retains data until its own server deadline (300, early=false)<br>`server-clock-regressions.test.mjs:245:95` | ours — NATIVE-META |
| remembered wakeup retains data until its own server deadline (600, early=false)<br>`server-clock-regressions.test.mjs:245:95` | ours — NATIVE-META |
| composed data with no server deadline still withdraws at its local row deadline<br>`server-clock-regressions.test.mjs:300:1` | ours — NATIVE-META |
| the local client rotates near expiry and keeps every protected request on the current bearer<br>`session-security.test.mjs:53:1` | ours — NATIVE-META |
| a stale-token mutation refusal remains durable and retries after rotation<br>`session-security.test.mjs:152:1` | ours — NATIVE-META |
| an online-only watch retries a stale-token refusal after rotation<br>`session-security.test.mjs:238:1` | ours — NATIVE-META |
| a current-token sign-out cannot reclassify a stale write refusal<br>`session-security.test.mjs:307:1` | ours — NATIVE-META |
| R4: wasm a same-identity head below acquisition halts as a restore<br>`store-reset-reconnect.test.mjs:224:41` | ours — RESTORE-SCOPE |
| R4: process a same-identity head below acquisition halts as a restore<br>`store-reset-reconnect.test.mjs:224:41` | ours — RESTORE-SCOPE |
| ten explicit calls during one round share exactly one follow-up<br>`sync-after-call.test.mjs:52:1` | ours — NATIVE-META |
| a call during the follow-up waits for its own newer round<br>`sync-after-call.test.mjs:68:1` | ours — NATIVE-META |
| a wake-driven round is not doubled<br>`sync-after-call.test.mjs:79:1` | ours — NATIVE-META |
| explicit sync during a held wake-driven round observes the newer head<br>`sync-after-call.test.mjs:87:1` | ours — NATIVE-META |
| a wake during an explicit round coalesces without an extra round<br>`sync-after-call.test.mjs:107:1` | ours — NATIVE-META |
| explicit sync waits for the follow-up's offline fetch<br>`sync-after-call.test.mjs:114:62` | ours — NATIVE-META |
| explicit sync waits for the follow-up's device rejection<br>`sync-after-call.test.mjs:114:62` | ours — NATIVE-META |
| an older round returning false after network error cannot skip the explicit follow-up<br>`sync-after-call.test.mjs:136:54` | ours — NATIVE-META |
| an older round returning false after HTTP 500 cannot skip the explicit follow-up<br>`sync-after-call.test.mjs:136:54` | ours — NATIVE-META |
| a failed older round cannot skip the explicit follow-up attempt<br>`sync-after-call.test.mjs:167:1` | ours — NATIVE-META |
| wasm: early generation adoption preserves unsent writes, known and lost acknowledgements<br>`sync-generation.test.mjs:122:41` | ours — NATIVE-META |
| wasm: early generation head preserves restore evidence from deferred stream<br>`sync-generation.test.mjs:411:3` | ours — NATIVE-META |
| wasm: early generation head preserves restore evidence from staged snapshot<br>`sync-generation.test.mjs:411:3` | ours — NATIVE-META |
| wasm: early head 20 and ordinary page decide deferred stream evidence identically<br>`sync-generation.test.mjs:441:32` | ours — NATIVE-META |
| wasm: early head 25 and ordinary page decide deferred stream evidence identically<br>`sync-generation.test.mjs:441:32` | ours — NATIVE-META |
| wasm: missing early watermark preserves deferred stream evidence until a headed retry<br>`sync-generation.test.mjs:474:3` | ours — NATIVE-META |
| wasm: early head 20 and ordinary page decide staged snapshot evidence identically<br>`sync-generation.test.mjs:441:32` | ours — NATIVE-META |
| wasm: early head 25 and ordinary page decide staged snapshot evidence identically<br>`sync-generation.test.mjs:441:32` | ours — NATIVE-META |
| wasm: missing early watermark preserves staged snapshot evidence until a headed retry<br>`sync-generation.test.mjs:474:3` | ours — NATIVE-META |
| wasm: invalid early heads are retryable and never reach observation or adoption<br>`sync-generation.test.mjs:521:41` | ours — NATIVE-META |
| oversized sync identity, indivisible-commit snapshot recovery, and wedged generation adoption<br>`sync-overflow.test.mjs:140:1` | ours — NATIVE-META |
| an oversized reply from a replacement store is observed before shrinking even at the same generation<br>`sync-overflow.test.mjs:195:1` | ours — NATIVE-META |
| wasm a new replica recovers its oversized first commit<br>`sync-overflow.test.mjs:217:41` | ours — NATIVE-META |
| wasm an oversized first commit arriving during zero-head snapshot catch-up restarts inline<br>`sync-overflow.test.mjs:239:41` | ours — NATIVE-META |
| wasm interrupted inline recovery retries after reopen, preserves delivered history and enforces the horizon<br>`sync-overflow.test.mjs:355:41` | ours — NATIVE-META |
| wasm: many ordinary commits recover by halving without snapshot<br>`sync-overflow.test.mjs:381:41` | ours — NATIVE-META |
| wasm a snapshot continuation overflow keeps its cursor and terminates at limit one<br>`sync-overflow.test.mjs:398:41` | ours — NATIVE-META |
| wasm bare refusals retain held rows beyond the horizon and allow a later sync retry<br>`sync-overflow.test.mjs:416:41` | ours — NATIVE-META |
| unread badge uses server fallback online and keeps its bound after cold offline reopen<br>`unread-range.test.mjs:156:1` | ours — NATIVE-META |
| unread fallback respects held<br>`unread-range.test.mjs:204:45` | ours — NATIVE-META |
| unread fallback respects prediction<br>`unread-range.test.mjs:204:45` | ours — NATIVE-META |
| W6R1 A memory: already-open owners equal input, offline<br>`write-ids.test.mjs:99:5` | ours — NATIVE-META |
| W6R1 A memory: already-open owners equal input, in-flight send<br>`write-ids.test.mjs:99:5` | ours — NATIVE-META |
| W6R1 A memory: already-open owners conflicting input, offline<br>`write-ids.test.mjs:99:5` | ours — NATIVE-META |
| W6R1 A memory: already-open owners conflicting input, in-flight send<br>`write-ids.test.mjs:99:5` | ours — NATIVE-META |
| W6R1 B memory: evicted explicit row outcome reaches server replay<br>`write-ids.test.mjs:130:40` | ours — NATIVE-META |
| W6R1 B memory: evicted changed guard outcome reaches server replay<br>`write-ids.test.mjs:130:40` | ours — NATIVE-META |
| W6R1 principals memory: one caller ID is independent per principal<br>`write-ids.test.mjs:154:52` | ours — NATIVE-META |

## Development and deliberate negative controls

See `development-failures.json` for log-by-log failure names and diagnostics.
All are ours: deliberate pre-fix/mutation controls, fixture construction,
intermediate compilation, or already-listed integration corrections. None is
counted as a successful verification. The early native-expiry prototype did
not reproduce the retired-row race; its replacement waits for full retirement.

## Follow-up checks

`full-failures-recheck.log`: 291 tests, 286 passed, 5 failed, no cancelled or
skipped. All five are **ours**: the initial explicit-sync reservation made ten
calls reserve eleven rounds (`ten explicit calls during one round share
exactly one follow-up`); four server-clock composition tests still assumed
100 microtasks drained a complete publication. The fixes preserve original
assertions. `sync-clock-complete-final.log` passes all 29 cases, including
those five. `affected-verified-final.log` passes all 149 affected cases.

The four clock names are `composition: a deadline behind the issued floor does
not loop server refetches`, `composition publishes at both deadlines, device
first`, `composition publishes at both deadlines, server first`, and `composed
data with no server deadline still withdraws at its local row deadline`.

`nested-failures-recheck.log` passes 48/48 including the two aggregate overflow/
round-9–12 families. `react-final.log` passes 50/50 including its failed
aggregate and shared-owner hook case. No skipped or cancelled case is counted
as a pass. The original full log and JSON retain the original failures.
