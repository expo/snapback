#!/usr/bin/env python3
"""Describe yield without equating nonmirror candidates, manual findings or proof."""
import collections,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
MANUAL={
 '001':{'confirmedFindingOverlap':['apprentice access beyond live bench states and into private estimates (F1)'],'specDecisions':['Current apprentice plus gluing/setup/finalCheck for bench records; customer ownership remains independent of mutable customer role.','Estimate privacy excludes apprentices.'],'interpretations':['The exact minimal bench column projection is not enumerated by the spec.'],'limits':['Over-appraisal consent ambiguity is not promoted to a new confirmed finding.']},
 '006':{'confirmedFindingOverlap':['unverified self-claimed parent relationship (F1)','clinical category kind disclosed to coach/parent (F2)'],'specDecisions':['Parent reads require current parent role and own-child relationship.','Clinical-only diagnosis includes its revealing category.','Parent relationship writer needs verified appointment, not the recipient claiming it.'],'interpretations':[],'limits':['Explicit either/or evidence and legitimate historical injury time are not automatic defects.']},
 '014':{'confirmedFindingOverlap':[],'specDecisions':['Restore the leader matching-club condition in intent, already present in enforcement.','Owner access survives a missing exhibitor role; operational staff remain fair-wide.'],'interpretations':['The spec does not enumerate a private field list or staff lifecycle read cutoff.'],'limits':['Matching independently confirmed read predicates are legitimate, and are not counted as nonmirror yield.']},
 '025':{'confirmedFindingOverlap':['caller-controlled stop/exam times and shortening of suspension (including F2)'],'specDecisions':['Record a genuine bout stop time and preserve an existing longer suspension except under inspector authority.','Future exam times cannot establish current validity.'],'interpretations':['Owner visibility of clinical result notes has conflicting own-history wording (the bakeoff treated that as judgment).','Restricting whole exam scans/rows and public clinical result columns extends an interpretation of the enumerated audiences.'],'limits':['The transition/time requirements are mostly manual obligations outside the invariant fragment, not checker catches.']},
 '030':{'confirmedFindingOverlap':[],'specDecisions':['Existing director-only financial/cause-of-death fields remain confirmed.'],'interpretations':['Additional director-or-family private columns derive from treating the enumerated staff view as a payload allowlist.','Requiring current family role as well as relationship is a stricter interpretation.'],'limits':['Do not turn these additional privacy interpretations into newly confirmed vulnerabilities.']},
 '033':{'confirmedFindingOverlap':['crew role-wide readership outside scheduled/finished lifecycle (F1)'],'specDecisions':['Crew reads require scheduled or finished home state.','Child records inherit the associated home audience.','Owner/contractor relationship and current role are independently checked.'],'interpretations':['The precise child-column/staff-identifier audiences follow a documented operational interpretation.'],'limits':['A shared crew role does not imply an invented per-crew assignment.']},
 '036':{'confirmedFindingOverlap':['sharpener reads collected/donated sets outside live board (F1)'],'specDecisions':['Restaurant/customer ownership and current courier route apply independently.','Sharpener reads require dropped/ready lifecycle, including associated incidents.'],'interpretations':[],'limits':['No extra courier live-state cutoff or customer-history expiry is invented.']},
 '042':{'confirmedFindingOverlap':[],'specDecisions':['Educational progress audiences remain owner or current teacher/coordinator; contact and immigration fields remain coordinator-only.'],'interpretations':['Incidental progress metadata follows the educational audience; no invented publication/status embargo.'],'limits':['All31 read declarations match confirmed existing enforcement; zero nonmirror read yield is not a defect.']},
 '048':{'confirmedFindingOverlap':[],'specDecisions':['Progress-note reads require current family role plus own-rider link; row/body/photo declarations catch retained links after role demotion.'],'interpretations':['Builder treats wider rider basics/row existence as unspecified, and intentionally does not add a riders.read invariant.'],'limits':['MISSED known F1 broad roster branch. Three real test refutations concern notes after family-to-volunteer demotion, not F1.']},
 '050':{'confirmedFindingOverlap':['Intake wrongly receives owner name/address (F1); independently identified and encoded, but direct pieces-column path not refuted on frozen input.'],'specDecisions':['Only owner/senior may read ownerName/address; the same name copied into roles.displayName needs that privacy boundary.'],'interpretations':['Incidental staff fields remain unspecified within a bounded whole-row audience; no invented assignment/lifecycle ban.'],'limits':['Two concrete test witnesses expose owner displayName through owners; final check retains that one invariant refutation. Piece ownerName/address still lack the packed campaign column-world reduction. Initial overbroad signature-update assertions were corrected after actual null-patch traces; confirmed name privacy was preserved.']},
}

# Independent conservative classification. Child-table audience inheritance and
# additional private-field allowlists are not silently treated as explicit spec.
EXPLICIT_GROUPS={'001':{0,2},'006':{0,1,2},'014':set(),'025':set(),'030':set(),
                 '033':{0},'036':{0,1,4},'042':set(),'048':{0},'050':{0,1}}
CLASSIFICATION_NOTES={
 '001':'Active bench lifecycle and private estimates are explicit; exact minimal instrument board columns need a product interpretation.',
 '006':'Own-child/current-family-role and clinical diagnostic-category boundaries are explicit; parent relationship writer is separate non-read intent.',
 '014':'Matching club readership is independently confirmed but not narrower than enforcement.',
 '025':'Owner medical history versus physician-only notes conflict; full exam-file and bout-result privacy need product choices. Temporal findings are separate.',
 '030':'Additional private staff-view fields and current family role extend documented audience interpretations.',
 '033':'Crew map lifecycle on homes is explicit. Child-record/column readership inherits an operational interpretation and is excluded from the lower bound.',
 '036':'Restaurant own sets and sharpener live sets (including combined route audience) are explicit. Incident readership inherits a child-table interpretation and is excluded from the lower bound.',
 '042':'The confirmed read audiences match existing enforcement; no invented lifecycle/private-field constraints are counted.',
 '048':'Current family plus own-rider notes is explicit. The known broad riders roster boundary was deliberately left unspecified and missed.',
 '050':'Only owner/senior sees owner name/address, including that name copied to roster displayName. No inferred intake exception.',
}

def summarize():
 result={'method':'Ten fresh installed-document-only reviews of copied authored sources; original rules/operations preserved. Input snapshot is identified by packed/packs.json, not an exact source commit.','counting':'Read assertions are not independent security discoveries. Nonmirror candidates are declarations without a restatement advisory at their site; manual specification assessment and distinct table/predicate groups are reported separately. Unknown, timeout and empty output do not mean passing.','snapshot':'First packed integration snapshot, preceding later role-question wording hardening and audit/default campaign repairs.','lanes':[]}
 for cohort in ['builders','builders-extra']:
  for p in sorted((ROOT/cohort).glob('*/provenance.json')):
   provenance=json.loads(p.read_text());lane=p.parent;number=provenance['lane'][:3]
   item={'lane':provenance['lane'],'evidence':str(lane.relative_to(ROOT)),'builderExit':provenance['exitCode'],'seconds':provenance['seconds'],'onlyInvariantLinesChanged':provenance['onlyInvariantLinesChanged'],'originalDeclarations':len(provenance['originalInvariants']),'finalDeclarations':len(provenance['finalInvariants']),'manualAssessment':MANUAL[number]}
   check=lane/'check.json'
   if check.exists() and check.stat().st_size:
    try:
     document=json.loads(check.read_text());verdicts=document['security']['invariants'];reads=[v for v in verdicts if v['invariant']['target']=='read'];mirrors={n['site']['line'] for n in document['security']['notes'] if n['code']=='N_INVARIANT_RESTATES_RULE'}
     candidates=[v for v in reads if v['invariant']['site']['line'] not in mirrors]
     groups={}
     for verdict in candidates:
      inv=verdict['invariant'];policy=json.dumps(inv.get('policy'),sort_keys=True,separators=(',',':'))
      key=(inv['table'],policy if inv.get('policy') is not None else inv['predicate'])
      group=groups.setdefault(key,{'table':inv['table'],'predicate':inv['predicate'],'targets':[],'boundRulePolicy':inv.get('policy') is not None})
      group['targets'].append(inv['column'] or 'read')
     group_values=list(groups.values())
     for index,group in enumerate(group_values):
      group['independentClassification']='explicit-spec-boundary' if index in EXPLICIT_GROUPS[number] else 'interpretation-dependent'
     explicit=[group for group in group_values if group['independentClassification']=='explicit-spec-boundary']
     item['explicitSpecReadAssertions']=sum(len(group['targets']) for group in explicit)
     item['explicitSpecTablePredicateGroups']=len(explicit)
     item['independentClassificationNote']=CLASSIFICATION_NOTES[number]
     item.update({'readDeclarations':len(reads),'readRestatementAdvisories':len(reads)-len(candidates),'nonmirrorReadCandidates':len(candidates),'distinctTablePredicateGroups':len(groups),'candidateGroups':group_values,'checkVerdicts':dict(collections.Counter(v['status'] for v in verdicts)),'checkDeclarationCountMatchesFinal':len(verdicts)==len(provenance['finalInvariants'])})
    except Exception as error:item['checkParseError']=str(error)
   for name,key in [('test.txt','testCapturedBytes'),('audit.json','auditCapturedBytes')]:item[key]=(lane/name).stat().st_size if (lane/name).exists() else None
   commands=[]
   for line in (lane/'transcript.jsonl').read_text().splitlines():
    try:
     event=json.loads(line);tool=event.get('item',{})
     if tool.get('type')=='command_execution':commands.append(tool)
    except json.JSONDecodeError:pass
   item['commandEventsWithoutTimeoutToken']=sum('timeout' not in c.get('command','') for c in commands)
   item['capturedValidationCommands']=[{'command':c.get('command'),'exitCode':c.get('exit_code')} for c in commands if c.get('status')=='completed' and any(' '+word in c.get('command','') for word in ['check --json','test --fixture-only','audit --json'])]
   result['lanes'].append(item)
 result['lanes'].sort(key=lambda item:item['lane'])
 result['totals']={key:sum(row.get(key,0) for row in result['lanes']) for key in ['originalDeclarations','finalDeclarations','readDeclarations','readRestatementAdvisories','nonmirrorReadCandidates','distinctTablePredicateGroups','explicitSpecReadAssertions','explicitSpecTablePredicateGroups']}
 result['completedEvidenceLanes']=len(result['lanes'])
 result['sessionExitCounts']=dict(collections.Counter(str(row['builderExit']) for row in result['lanes']))
 (ROOT/'builders-summary.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({key:result[key] for key in ['completedEvidenceLanes','totals','sessionExitCounts']},indent=2))
if __name__=='__main__':summarize()
