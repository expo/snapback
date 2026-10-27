import argparse,gzip,json,pathlib,collections
# Each rule is tied to the calibrated effect, not just any finding in its lane.
rules={
(26,'002','F1'):dict(codes=['N_CALENDAR_DURATION']),
(26,'008','F1'):dict(ops=['advanceWall'],site='/parent-state/',codes=['N_DERIVED_WRITE_AUTHORITY']),
(26,'008','F2'):dict(ops=['finishJob'],site='/child-stage/',codes=['N_DERIVED_WRITE_AUTHORITY']),
(26,'018','F1'):dict(ops=['addRescan'],site='/sibling-approval/',codes=['N_DERIVED_WRITE_AUTHORITY']),
(26,'020','F1'):dict(ops=['advanceStatus'],codes=['N_APPROVAL_NOT_ENFORCED'],truth={'crossesPrivateLand':True}),
(26,'024','F1'):dict(codes=['N_TEXT_EVIDENCE'],term='photo'),
(26,'025','F1'):dict(ops=['retest'],site='/repeat-create/',codes=['N_GUARD_NOT_CONSUMED','N_DERIVED_WRITE_AUTHORITY']),
(26,'025','F2'):dict(ops=['logExam'],site='/approval-history/',codes=['N_DERIVED_WRITE_AUTHORITY']),
(26,'031','F1'):dict(codes=['N_DEPENDENT_WINDOW']),
(26,'033','F1'):dict(ops=['signFailing'],term='customerConsent',codes=['N_DERIVED_WRITE_AUTHORITY']),
(26,'033','F2'):dict(codes=['N_CHILD_EVIDENCE_PRESENCE'],ops=['acceptQuote','advanceStatus']),
(26,'036','F1'):dict(codes=['N_APPROVAL_NOT_ENFORCED'],ops=['advanceStage']),
(26,'045','F1'):dict(prevented='Inherited visible-text minimum rejects the calibrated whitespace input; no new SEC11 prevention claim.'),
(26,'046','F1'):dict(codes=['N_APPROVAL_NOT_ENFORCED','N_APPROVAL_INFORMATIONAL'],ops=['installPart']),
(26,'049','F1'):dict(codes=['N_MEDIA_PRIVATE_FIELDS']),
(28,'011','F1'):dict(codes=['N_APPROVAL_NOT_ENFORCED'],ops=['recordInstallation'],truth={'indoorMount':True,'indoorApproved':False}),
(28,'011','F2'):dict(codes=['N_ARGUMENT_GRANT'],term='homeowner'),
(28,'013','F1'):dict(codes=['N_APPROVAL_NOT_ENFORCED','N_APPROVAL_INFORMATIONAL'],ops=['requestLift']),
(28,'013','F2'):dict(codes=['N_TRANSITION_BYPASS','N_DERIVED_WRITE_AUTHORITY'],ops=['advanceSling']),
(28,'019','F1'):dict(codes=['N_INSERT_WRITE_INTENT'],ops=['setAccount'],term='balance',decrease='balance'),
(28,'019','F2'):dict(codes=['N_TRANSITION_BYPASS'],ops=['advanceMove']),
(28,'023','F1'):dict(codes=['N_TEXT_EVIDENCE'],term='photo'),
(28,'024','F1'):dict(codes=['N_DEPENDENT_WINDOW'],ops=['scheduleVisit']),
(28,'036','F1'):dict(codes=['N_DERIVED_WRITE_AUTHORITY','N_EDIT_AFTER_APPROVAL'],ops=['changeLikeness'],term='likenessScan'),
(28,'046','F1'):dict(prevented='Inherited Unicode visible-text minimum rejects the calibrated U+200B consent; no new SEC11 prevention claim.'),
(28,'047','F1'):dict(codes=['N_TEXT_EVIDENCE'],term='trialPhotos'),
(28,'050','F1'):dict(codes=['N_DEPENDENT_WINDOW'],ops=['openVisit']),
(30,'002','F1'):dict(codes=['N_TEXT_EVIDENCE'],term='referralScan'),
(30,'004','F1'):dict(codes=['N_ASSIGNMENT_SCOPE'],ops=['privateDetail'],term='careNeeds',viewerRole='coordinator',assignment=True),
(30,'006','F1'):dict(codes=['N_ENTITLEMENT_CHARGE']),
(30,'010','F1'):dict(codes=['N_GUARD_NOT_CONSUMED'],ops=['rebookTrip'],term='status'),
(30,'014','F1'):dict(codes=['N_ROLE_WIDE_READ','N_ASSIGNMENT_SCOPE'],ops=['project','board'],term='clientPhone',viewerRole='lead'),
(30,'018','F1'):dict(codes=['N_APPROVAL_PATH'],ops=['pruneTouchup']),
(30,'025','F1'):dict(codes=['N_CALLER_HISTORY'],ops=['logExam'],less={'attempt':3}),
(30,'025','F2'):dict(codes=['N_LATEST_SUBJECT'],ops=['logExam']),
(30,'030','F1'):dict(codes=['N_OPTIONAL_EVIDENCE'],term='recordings'),
(30,'030','F2'):dict(codes=['N_TRANSITION_BYPASS'],ops=['publishReport']),
(30,'033','F1'):dict(codes=['N_APPROVAL_NOT_ENFORCED'],ops=['advanceJob'],truth={'dampSigned':True,'dampApproved':False}),
(30,'033','F2'):dict(codes=['N_CHILD_EVIDENCE_PRESENCE'],ops=['acceptQuote','advanceJob']),
(30,'035','F1'):dict(codes=['N_TRANSITION_BYPASS'],ops=['finishBatch']),
(30,'038','F1'):dict(codes=['N_DUPLICABLE_GUARD']),
}
for (wave,lane,finding),rule in list(rules.items()):
 if wave==30:rules[(31,lane,finding)]=rule.copy()
rules.update({
 (31,'002','F2'):dict(codes=['N_INSERT_WRITE_INTENT'],ops=['openFitting'],term='referralScan'),
 (31,'010','F2'):dict(codes=['N_TRANSITION_BYPASS','N_EDIT_AFTER_APPROVAL'],ops=['cancelHighWater'],oldValues=['equipped']),
 (31,'014','F3'):dict(codes=['N_ASSIGNMENT_SCOPE'],ops=['setEntrancePhoto'],term='entrancePhoto',effect='update'),
 (31,'014','F4'):dict(codes=['N_INSERT_WRITE_INTENT'],ops=['openProject'],term='entrancePhoto'),
 (31,'019','F1'):dict(codes=['N_INSERT_WRITE_INTENT'],ops=['openMove'],term='price'),
})
def category(row,rule):
 if 'prevented'in rule:return dict(category='nothing',reason='No current finding/witness; the calibrated input is already rejected by inherited language semantics.',inheritedLanguagePrevention=rule['prevented'],targetVisible=False,evidence=[])
 ev=[]
 for d in row['reviews']:
  w=d.get('witness')
  if d['code']not in rule.get('codes',[])or not w:continue
  if rule.get('ops')and w.get('operation')not in rule['ops']:continue
  if rule.get('viewerRole'):
   roster=(w.get('supportingRows')or{}).get('roles',[])
   if not any(r.get('principal')==w.get('viewer')and r.get('role')==rule['viewerRole']for r in roster):continue
  if rule.get('assignment'):
   assigned=(w.get('assignment')or{}).get('principal')
   if not assigned or assigned==w.get('viewer'):continue
  material=w.get('candidate','') if d['code']in['N_TEXT_EVIDENCE','N_OPTIONAL_EVIDENCE']else w.get('candidate','')+' '+json.dumps(w.get('row',{}))
  if rule.get('term')and rule['term'].lower()not in material.lower():continue
  if any(w.get('row',{}).get(k)!=v for k,v in rule.get('truth',{}).items()):continue
  if any(not isinstance(w.get('row',{}).get(k),int) or w['row'][k]>=v for k,v in rule.get('less',{}).items()):continue
  if rule.get('effect')and w.get('effect')!=rule['effect']:continue
  if rule.get('oldValues')and not all(v in (w.get('old')or{}).values()for v in rule['oldValues']):continue
  if rule.get('decrease'):
   c=rule['decrease'];old=(w.get('old')or{}).get(c);new=(w.get('row')or{}).get(c)
   if not isinstance(old,int)or not isinstance(new,int)or old<=new:continue
  history=w.get('history',[])
  if not history or history[-1].get('operation')!=w.get('operation'):continue
  ev.append(dict(code=d['code'],operation=w['operation'],viewer=w['viewer'],decision=d['id'],witness=w['id'],candidate=w['candidate'],gated=d['gated']))
 fixes=[f for f in row.get('fresh',{}).get('fixes',[])if f.get('operation')in rule.get('ops',[])and (not rule.get('site')or rule['site']in f['site']['file'])and (not rule.get('term')or rule['term'].lower()in json.dumps(f).lower())]
 # A FIX match requires a known derived contract; unrelated authored failures do not count.
 if rule.get('site')and fixes or any(e['gated']for e in ev)or fixes and 'N_DERIVED_WRITE_AUTHORITY'in rule.get('codes',[]):return dict(category='gated with witness',targetVisible=True,evidence=ev,productionFixes=fixes)
 if ev:return dict(category='witnessed question on default verdict',targetVisible=True,evidence=ev)
 notes=[n for n in row['notes']if n['code']in rule.get('codes',[])and (not rule.get('term')or rule['term'].lower()in n['message'].lower())]
 return dict(category='advisory only'if notes else'nothing',targetVisible=False,evidence=[],notes=notes)

def main():
 p=argparse.ArgumentParser();p.add_argument('--survey',required=True);p.add_argument('--out',required=True);p.add_argument('--baseline',default='snapback4/reports/sec11-item1/survey-all800.json.gz');p.add_argument('--baseline-extra');p.add_argument('--survey-extra');a=p.parse_args()
 root=pathlib.Path.home()/'sb4-loop'
 before=json.load(gzip.open(a.baseline,'rt')) if a.baseline.endswith('.gz') else json.loads(pathlib.Path(a.baseline).read_text())
 after=json.loads(pathlib.Path(a.survey).read_text())
 if a.baseline_extra:before+=json.loads(pathlib.Path(a.baseline_extra).read_text())
 if a.survey_extra:after+=json.loads(pathlib.Path(a.survey_extra).read_text())
 indexes=[{(r['wave'],r['lane'][:3]):r for r in rows}for rows in [before,after]]
 assess=[]
 waves=[26,28,30]+([31]if a.baseline_extra and a.survey_extra else[])
 for wave in waves:
  for finding in json.loads((root/f'wave{wave}/analysis/calibration.json').read_text())['findings']:
   if finding['backend']!='snapback'or finding['cal']!='M':continue
   key=(wave,finding['lane'],finding['id']);rule=rules[key];records=[idx[(wave,finding['lane'])]for idx in indexes]
   assess.append(dict(wave=wave,lane=finding['lane'],finding=finding['id'],pattern=finding.get('pattern'),calibration=finding.get('rule')or finding.get('note'),match=rule,sourceHashMatches=records[0]['sha256']==records[1]['sha256'],before=category(records[0],rule),after=category(records[1],rule)))
 result=dict(method='Exact calibrated effects matched by operation, material predicate/column, and where relevant actual row values. Unrelated questions are excluded. The four requested finding categories are used; rows already prevented by inherited types have category nothing (no current finding/witness) and an explicit inheritedLanguagePrevention flag, never SEC11 credit.',assessments=assess,summary={str(w):{when:dict(collections.Counter(x[when]['category']for x in assess if x['wave']==w))for when in['before','after']}for w in waves})
 pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['summary'],indent=2))

if __name__ == "__main__":main()
