// Shared by the published Darwin fence and Linux refusal regressions.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const timeline=readFileSync(join(root,'crates/snapback4-lang/tests/fixtures/timeline-capability.q'),'utf8');
// The published 0.2.33 compiler cannot parse `on delete`; since LLP 3000.039
// an undeclared reference restricts, so the current compiler spells the legacy
// (capability-free) meaning `on delete keep`.
const legacyRecorded=`use personas alice
 table posts:
  authorId: principal
  immutable authorId
  read <- allow
  insert <- .authorId = viewer
  sync public
 table likes:
  postId: posts
  principal: principal
  immutable postId
  read <- allow
  insert <- .principal = viewer
  sync public
 maintain totals: count likes by postId.authorId
  read <- allow
 mutation like(postId: posts):
  insert likes {postId, principal: viewer}
 query posts():
  return posts first 10
 query likes():
  return likes first 10
`.replace(/^ /gm,'');
const recorded=legacyRecorded.replace(' postId: posts\n',' postId: posts on delete keep\n');
export const ordinary=recorded.replace(/maintain totals:[\s\S]*?mutation like/, 'mutation like');
export const legacyOrdinary=legacyRecorded.replace(/maintain totals:[\s\S]*?mutation like/, 'mutation like');
const maintained=ordinary.replace('table posts:\n','table posts:\n likeCount: count likes by postId\n');
const timelinePlain=timeline.replace(/maintain feed:[\s\S]*?mutation register/,'mutation register').replace(/query following[\s\S]*?query posts/,'query posts');
// Ordinary (non-row-keyed) aggregate targets use digest ids; the private
// maintain behind a maintained column also derives an ordinary target on the
// server, but is omitted from the device projection. Timeline v2 uses its own slot identity, so it adds no digest marker.
// These priced writes also carry v1 reservations and v2 birth reservations.
// @ref LLP 3000.007.003#30-aggregate-target-identity-and-migration — fence aggregate identity before interpretation.
export const fixtures=[
  {name:'timeline-v2',capabilities:['timeline-event-slots','timeline-v2'],source:timeline,plain:timelinePlain,legacyPlain:timelinePlain.replaceAll(' on delete keep',''),
    seed:[{table:'profiles',row:{id:'profile',principal:'dev:alice'}}], query:'profiles',op:'publish',args:{postId:'offline'},predictions:3},
  {name:'recorded-attribution',capabilities:['maintained-id-sha256-v1','recorded-attribution','source-write-reservations-v1','source-write-reservations-v2'],source:recorded,plain:ordinary,legacyPlain:legacyOrdinary,
    seed:[{table:'posts',row:{id:'p',authorId:'dev:alice'}}],query:'posts',op:'like',args:{postId:'p'},predictions:2},
  {name:'maintained-column',capabilities:['maintained-column','source-write-reservations-v1','source-write-reservations-v2'],storedCapabilities:['maintained-column','maintained-id-sha256-v1','source-write-reservations-v1','source-write-reservations-v2'],source:maintained,plain:ordinary,legacyPlain:legacyOrdinary,freshStore:true,
    seed:[{table:'posts',row:{id:'p',authorId:'dev:alice'}}],query:'posts',op:'like',args:{postId:'p'},predictions:1},
];

// The opt-in historical F2 fence and Clique export also pin exact marker sets.
// Keep their expectations exercised by the ordinary Linux client pool.
// Undeclared reference actions restrict; these schemas therefore require the
// reference-actions fence. Their ordinary aggregates and source prices add the
// digest and both reservation markers; Clique adds column and timeline slots.
export const recordedCompatibility={name:'recorded-only',source:`use personas alice
table posts:
  authorId: principal
  immutable authorId
  read <- allow
  sync public
table likes:
  postId: posts
  immutable postId
  read <- allow
  sync public
maintain totals: count likes by postId.authorId
  read <- allow
query totals():
  return totals first 10 by byGroup
`,capabilities:['maintained-id-sha256-v1','recorded-attribution','reference-actions','source-write-reservations-v1','source-write-reservations-v2']};
export const cliqueCapabilities=['maintained-column','maintained-id-sha256-v1','recorded-attribution','reference-actions','source-write-reservations-v1','source-write-reservations-v2','timeline-event-slots','timeline-v2'];
export const additionalMarkerFixtures=[recordedCompatibility,{name:'clique-03',source:readFileSync(join(root,'examples/clique-03/snapback/schema.q'),'utf8'),capabilities:cliqueCapabilities}];
