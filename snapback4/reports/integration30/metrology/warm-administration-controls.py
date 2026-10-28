from pathlib import Path
import sys,json,copy,hashlib
p=Path(__file__).parent;sys.path.insert(0,str(p))
from identity_validation import validate_item,inputs,canonical,warm_reactivation_projection
capture=p/'identity/w33-020-snapback-horseback-trail-rides.json';item=json.loads(capture.read_text());wave,lane=item['wave'],item['lane'];hashes=inputs(wave,lane);pairs=validate_item(item,wave,lane,*hashes)
a,b=[pairs['staging','warm'][label]for label in ['baseline','candidate']];assert canonical(a['security'])==canonical(b['security'])and not a['security']['security']and not b['security']['security']
controls=[]
def reject(name,fn,temp='warm'):
 altered=copy.deepcopy(item);row=next(r for r in altered['rows']if r['label']=='candidate'and r['mode']=='staging'and r['temperature']==temp);parsed=json.loads(row['stdout']);fn(parsed);row['stdout']=json.dumps(parsed)+'\n'
 try:validate_item(altered,wave,lane,*hashes);rejected=False
 except(AssertionError,KeyError,TypeError,ValueError):rejected=True
 assert rejected,name;controls.append(name)
reject('typed release cannot become boolean',lambda d:d.update(release=True))
reject('live target mismatch',lambda d:d['live']['rowShape'].update(matchesTarget=False))
reject('carried items cannot disappear',lambda d:d['preview']['plan'].update(items=[{'id':'unexpected'}]))
reject('source release changes',lambda d:d.update(sourceRelease=2))
reject('unknown root field',lambda d:d.update(unexpected='field'))
reject('schema columns remain ordered/exact',lambda d:d['live']['rowShape']['tables']['tickets'].pop())
reject('event generation remains exact',lambda d:d['preview']['plan']['events'][1].update(generation=99))
reject('phase text outside measured duration remains exact',lambda d:d.update(details=d['details']+' changed source intent'))
reject('physical event timestamp must be positive integer',lambda d:d['preview']['plan']['events'][1].update(at=0))
reject('event array chronology',lambda d:d['preview']['plan']['events'].reverse())
reject('event row retention summary remains exact',lambda d:d['preview']['plan']['events'][1]['summary'].update(narrowed_retained=1))
reject('cold security cannot be omitted',lambda d:d.update(security=None),'cold')
wrong=copy.deepcopy(a);wrong['sourceSha256']='0'*64
try:warm_reactivation_projection(wrong,json.loads(wrong['stdout']));rejected=False
except(AssertionError,KeyError,TypeError,ValueError):rejected=True
assert rejected;controls.append('exact source hash required')
report=dict(sourceKey=f'{wave}/{lane}',sourceSha256=hashes[0],captureSha256=hashlib.sha256(capture.read_bytes()).hexdigest(),validatorSha256=hashlib.sha256((p/'identity_validation.py').read_bytes()).hexdigest(),positiveSourceBoundAdministrationPair=True,securityEnvelopesLiterallyEqual=True,negativeControlsRejected=len(controls),controls=controls,claim='Additional NON-security administration validation only. Security extraction/comparison unchanged. Full body remains exact except original explicitly typed physical deployment-event timestamps and measured duration tokens on three fixed source hashes.')
(p/'warm-administration-controls.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
