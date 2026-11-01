from pathlib import Path
import json,subprocess,hashlib,re,datetime
r=Path.home()/'sb4-pub-0452-records';k=Path.home()/'sb4-pub-0452-kit';w=Path.home()/'sb4-pub-0441'
git=lambda *a:subprocess.check_output(['git',*a],cwd=w,text=True).strip()
load=lambda p:json.loads(p.read_text())
base=(k/'guide-owner-scope-base.sha').read_text().strip();head=git('rev-parse','HEAD')
assert git('status','--porcelain')==''
doc='snapback4/packages/snapback4/reference/CHANGELOG.md'
assert git('diff','--name-only',base,head)==doc
assert (w/doc).read_text().strip()==git('show',base+':'+doc).replace('`--full` prints the complete card','`guide --full` prints the complete card')
archive=r/'archive-corrected-full-rerun-red'
old_path=next(archive.glob(base[:12]+'-*.json'));old=load(old_path)
assert old['head']==base and old['complete'] and old['unchanged'] and not old['ok']
assert [x['id'] for x in old['results'] if x['status']!=0]==['client-tests']
new_result=load(r/'release-final-scope-result.json');new_path=Path(new_result['receiptPath']);new=load(new_path)
assert new==new_result['receipt'] and new['head']==head and new['base']==base and new['complete'] and new['unchanged'] and new['ok']
assert new['observedFiles']==old['observedFiles'] and new['mergeBase']==old['mergeBase']
for path in old['observedFiles']:
 if path!=doc:assert git('rev-parse',base+':'+path)==git('rev-parse',head+':'+path)
for ident in ['client-tests','client-models']:
 assert next(s for s in old['steps'] if s['id']==ident)['argv']==next(s for s in new['steps'] if s['id']==ident)['argv']
for f in ['release-final-doc-checks','release-inventories','release-ref-check']:
 assert (r/(f+'.exit')).read_text().strip()=='0'
assert (r/'release-final-checks-source.sha').read_text().strip()==head

def summaries(path):
 text=path.read_text();out={}
 for ident in ['client-tests','client-models']:
  part=text.split('== '+ident+'\n',1)[1].split('\n== ',1)[0]
  matches=re.findall(r'^-- client files: (\d+)/(\d+); failed (\d+); tests (\{.*\})$',part,re.M);assert matches
  done,total,failed,counts=matches[-1];out[ident]={'files':int(total),'done':int(done),'failedFiles':int(failed),**json.loads(counts)}
 return out
old_counts=summaries(archive/'release-affected.log');new_counts=summaries(r/'release-final-scope.log')
for ident,q in new_counts.items():
 p=old_counts[ident]
 assert q['files']==q['done']==p['files']==p['done']
 assert q['failedFiles']==q['fail']==q['cancelled']==0
 assert q['tests']==p['tests'] and q['skipped']==p['skipped'] and q['pass']==p['pass']+p['fail']
assert new_counts['client-tests']['files']==487 and new_counts['client-models']['tests']==89
fresh={x['id']:x for x in new['results']};old_results={x['id']:x for x in old['results']}
effective={s['id']:{'source':head if s['id'] in fresh else base,'status':(fresh.get(s['id']) or old_results[s['id']])['status']} for s in old['steps']}
assert len(effective)==32 and all(x['status']==0 for x in effective.values())
hashfile=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
result={'status':'passed','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'publicationCandidate':head,'priorFullSource':base,'actualDelta':[doc],'onlyDelta':'spell guide --full explicitly in release entry; every other tracked byte identical','fullRawReceipt':{'path':str(old_path),'sha256':hashfile(old_path),'ok':False},'finalAffectedReceipt':{'path':str(new_path),'sha256':hashfile(new_path),'ok':True},'effectiveChecks':effective,'clientCounts':new_counts,'scope':'original full32 plus final documentation selection overselected to exact full original clients/models; original raw failure retained','publicationSuites':'full Linux and Mac qualification still independently required'}
(r/'release-effective-qualification.json').write_text(json.dumps(result,indent=2)+'\n')
print('RELEASE QUALIFICATION PASS:32 effective checks, final documentation delta and exact full client/model rerun; original FAIL preserved')
