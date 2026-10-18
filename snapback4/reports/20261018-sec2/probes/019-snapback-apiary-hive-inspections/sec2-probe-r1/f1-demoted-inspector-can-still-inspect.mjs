import { lead, insp2, q, m, hive, sent, data, check } from './qa-lib.mjs';
// A legitimate lead revokes the inspector role. Existing route assignment remains.
let changed = false;
try {
  check(data(await q(insp2,'myRole')).role === 'inspector', 'Expected supplied inspector role at start');
  const route = 'qa-inspector-role-revocation';
  const assigned = data(await q(lead,'routeBoard'));
  if (!assigned.some(r=>r.inspector===insp2.principal && r.route===route)) {
    sent(await m(lead,'assignRoute',{inspector:insp2.principal,route}));
  }
  sent(await m(lead,'grantRole',{who:insp2.principal,role:'landowner'}));
  changed = true;
  const h = await hive({owner:insp2,route});
  check(data(await q(insp2,'myRole')).role === 'landowner','Demotion did not take effect');
  const attempt = await m(insp2,'recordInspection',{hive:h.id,queenStatus:'queenless',miteCount:9,notes:'Filed after inspector role was revoked'});
  check(attempt.body?.state === 'sent','Gap absent: demoted landowner was correctly refused');
  const rows = data(await q(lead,'inspectionsOf',{hive:h.id}));
  check(rows.some(r=>r.id===attempt.body.result.id && r.inspector===insp2.principal),'Unauthorized inspection was not persisted');
  console.log('GAP PRESENT: a current landowner recorded an inspection using an assignment left over from its revoked inspector role.');
} finally {
  if (changed) sent(await m(lead,'grantRole',{who:insp2.principal,role:'inspector'}));
}
