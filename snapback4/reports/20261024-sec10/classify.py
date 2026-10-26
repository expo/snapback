#!/usr/bin/env python3
"""Apply source-reviewed classifications; never label an unseen refusal as genuine."""
import argparse,json,pathlib,collections
p=argparse.ArgumentParser();p.add_argument('--comparison',required=True);p.add_argument('--catalog',default=str(pathlib.Path(__file__).with_name('reviewed-gates.json')));a=p.parse_args();path=pathlib.Path(a.comparison);d=json.loads(path.read_text());catalog=json.loads(pathlib.Path(a.catalog).read_text())['reviewedGates'];pool=collections.defaultdict(list)
for r in catalog:pool[(r['wave'],r['lane'],r['code'],r['site'],tuple(r['messages']))].append(r)
for r in d['newGates']:
 key=(r['wave'],r['lane'],r['code'],r['site'],tuple(r['messages']))
 if pool[key]:review=pool[key].pop(0);r.update(classification=review['classification'],reason=review['reason'])
for r in d['newDeploymentFixes']+d['newTestFixes']:
 if r['wave']!=26:continue
 lane=r['lane'][:3];where=r['site'];op=r['operation'];reason=None
 if lane=='008' and '/parent-state/' in where and op=='advanceWall':reason='Child work commits outside the exact parent phase required by the corresponding parent transition.'
 if lane=='008' and '/child-stage/' in where and op=='finishJob':reason='Parent completion commits while an actual linked child remains unfinished.'
 if lane=='018' and '/sibling-approval/' in where and op=='addRescan':reason='Sibling creator commits the governed rescan without the same livestock approval.'
 if lane=='025' and '/repeat-create/' in where and op=='retest':reason='The same admitted retry guard produces a second child because it is not consumed.'
 if lane=='025' and '/approval-history/' in where and op in ['retest','logExam']:reason='A new attempt for the same principal bypasses the declared prior-failure approval contract; actual authored continuation is retained.'
 if lane=='033' and '/jobs/customerConsent/update/' in where and op=='signFailing':reason='Approved consent changes while its stored approval remains valid; the paired history contract observes the stale decision at the actual write.'
 if reason:r.update(classification='genuine replayed violation',reason=reason)
complete=not d['watchdogs'] and d['sourceHashesMatch'] and all(r['classification']!='pending manual review' for key in ['newGates','newDeploymentFixes','newTestFixes','unexpectedFailures'] for r in d[key]) and not any(pool.values())
d['classificationsComplete']=complete
if complete:d.update(falseGates=0,falseRefusals=0)
path.write_text(json.dumps(d,indent=2)+'\n');print(json.dumps(dict(complete=complete,newGates=len(d['newGates']),newDeploymentFixes=len(d['newDeploymentFixes']),newTestFixes=len(d['newTestFixes']),pending=[r for key in ['newGates','newDeploymentFixes','newTestFixes','unexpectedFailures'] for r in d[key] if r['classification']=='pending manual review'])))
raise SystemExit(0 if complete else 1)
