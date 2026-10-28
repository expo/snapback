from pathlib import Path
import runpy,json,collections,hashlib
out=Path(__file__).parent
repo=Path('/home/ccheever/projects/snapback-sb4loop')
scope=runpy.run_path(str(repo/'snapback4/reports/sec11b/tools/coverage.py'))
rules=scope['rules'];category=scope['category']
rules.update({
 (32,'004','F1'):dict(codes=['N_OPTIONAL_EVIDENCE'],ops=['addRoom'],term='.photo',truth={'photo':None}),
 (32,'004','F3'):dict(codes=['N_MOVABLE_TIME_ANCHOR'],ops=['updateMove'],term='moveDate'),
 (32,'017','F1'):dict(codes=['N_OPTIONAL_EVIDENCE'],ops=['openParty'],term='safetyAgreement'),
 (32,'018','F1'):dict(codes=['N_APPROVAL_NOT_ENFORCED','N_APPROVAL_PATH','N_DERIVED_WRITE_AUTHORITY'],ops=['addTree']),
 (32,'025','F1'):dict(codes=['N_EVENT_TIME_ANCHOR'],ops=['bookExam'],term='scheduledAt'),
 (32,'029','F2'):dict(codes=['N_MOVABLE_TIME_ANCHOR'],ops=['reschedule'],term='scheduledAt'),
 (32,'033','F1'):dict(codes=['N_CHILD_EVIDENCE_PRESENCE'],ops=['openJob'],term='jobPhotos'),
 (32,'036','F1'):dict(codes=['N_SWEEP_ONLY_DEADLINE','N_TIME_TRANSITION','N_TRANSITION_BYPASS'],term='ceremonyAt'),
})
for (wave,lane,finding),rule in list(rules.items()):
 if wave==32:rules[(33,lane,finding)]=rule.copy()
rules.update({
 (33,'004','F4'):dict(notModeled='No current finding links legacy addHazard writes to briefing body contents. Generic grant/read advice is unrelated.'),
 (33,'017','F2'):dict(notModeled='No current allergyPrep authority finding. The updateShow N_EDIT_AFTER_APPROVAL note concerns venuePhotos, which is not the calibrated field.'),
 (33,'017','F3'):dict(codes=['N_DERIVED_WRITE_AUTHORITY'],ops=['setAllergyPrep'],term='allergyPrep',truth={'allergyPrep':'No allergy notes recorded'},notNull=['allergyNotes']),
 (33,'017','F4'):dict(notModeled='The current label-consistency candidate uses allergyNotes != null and agrees with the empty-string bug; it does not ask whether blank notes count as absent.'),
 (33,'019','F2'):dict(codes=['N_INSERT_WRITE_INTENT'],ops=['bookMove'],term='priceCents',viewerRole='owner',notNull=['priceCents']),
 (33,'033','F2'):dict(codes=['N_INSERT_WRITE_INTENT','N_RELEASE_CREATE_AUTHORITY'],ops=['openJob'],term='priceCents',viewerRole='crew',notNull=['priceCents']),
 (33,'033','F3'):dict(codes=['N_APPROVAL_NOT_ENFORCED','N_APPROVAL_PATH','N_DERIVED_WRITE_AUTHORITY'],ops=['acceptQuote','advanceJob'],term='priceCents',truth={'priceCents':None}),
})
base_category=category
def category(row,rule):
 if rule.get('notModeled'):return dict(category='nothing',targetVisible=False,evidence=[],reason=rule['notModeled'])
 if rule.get('notNull'):
  row={**row,'reviews':[d for d in row['reviews'] if not d.get('witness') or all((d['witness'].get('row')or{}).get(k)is not None for k in rule['notNull'])]}
 return base_category(row,rule)
rows=json.loads((out/'survey-final/results.json').read_text());idx={(r['wave'],r['lane'][:3]):r for r in rows}
assess=[];hashes={}
for wave in [30,31,32,33]:
 p=Path.home()/f'sb4-loop/wave{wave}/analysis/calibration.json'
 if not p.exists():continue
 hashes[str(wave)]=hashlib.sha256(p.read_bytes()).hexdigest()
 for f in json.loads(p.read_text())['findings']:
  if f.get('backend')!='snapback'or f.get('cal')!='M':continue
  key=(wave,f['lane'],f['id']);assert key in rules,('new calibrated effect needs exact source assessment',key)
  row=idx[wave,f['lane']];result=category(row,rules[key])
  text=row['defaultCheck']['stdout']+row['defaultCheck']['stderr']
  for witness in result.get('evidence',[]):
   assert witness['decision']in text,(key,'matched witness not actually visible in cold default output',witness['decision'])
  assess.append(dict(wave=wave,lane=f['lane'],finding=f['id'],inherited=f.get('inherited'),calibration=f.get('rule')or f.get('note'),match=rules[key],**result))
result=dict(calibrationSha256=hashes,method='Every calibrated Snapback M, including inherited wave31 M, assessed against its actual operation/material/role/old-new condition. Reuses SEC11b exact matcher for30/31; SEC13 source-qualified targets for32. Unrelated findings do not count. Wave33 is included when its calibration exists; carried effects retain the same exact matcher.',wave33CalibrationPresent='33'in hashes,assessments=assess,summary={str(w):dict(total=sum(r['wave']==w for r in assess),visible=sum(r['targetVisible']for r in assess if r['wave']==w),categories=dict(collections.Counter(r['category']for r in assess if r['wave']==w)))for w in [30,31,32,33]})
(out/'calibration-final.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['summary'],indent=2))
