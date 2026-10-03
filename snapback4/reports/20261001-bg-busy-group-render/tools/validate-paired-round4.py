"""Validate all paired runs and retain paired latency and host evidence."""
from pathlib import Path
import gzip, json, math
root=Path(__file__).resolve().parents[1]/'round4'
def contents(name):
    path=root/name
    return path.read_text() if path.exists() else gzip.decompress(path.with_name(path.name+'.gz').read_bytes()).decode()
def read(name):return json.loads(contents(name+'.json'))
def stats(xs):
    xs=sorted(xs);return {'n':len(xs),'p50':xs[math.ceil(len(xs)*.5)-1],'p95':xs[math.ceil(len(xs)*.95)-1],'max':xs[-1]}
result={}
for condition in ['idle','loaded']:
    runs=[]
    for n,variant in enumerate(['base','candidate','base','candidate']):
        name=f'{condition}-{n+1}-{variant}';trace=read(name);summary=read(name+'-summary');s=summary['stages']
        assert (root/(name+'.exit')).read_text().strip()=='0',name
        for key,value in [('profile','production'),('runs',50),('members',50),('messages',10000),('viewers',3),('mountedWindow',20),('acquisitionWindow',500)]:assert trace['metadata'][key]==value,(name,key)
        assert len(trace['samples'])==50 and all(len(x['views'])==2 for x in trace['samples'])
        assert all(v['trial']['reactCommit'] for sample in trace['samples'] for v in sample['views'])
        assert 'BROWSER ' not in trace['errors'],(name,trace['errors'])
        assert s['live_count_rows']=={'n':100,'p50':0,'p95':0,'max':0}
        assert all(v['history_window']==20 for sample in summary['samples'] for v in sample['views'])
        assert len(trace['allEvents'])==3
        for events in trace['allEvents']:
            for sample in trace['samples']:
                assert any(e['stage']=='response' and e.get('path')=='/changes' and e.get('seq',-1)>=sample['commit']['seq'] and e['at']>=sample['commit']['at'] for e in events),name
        start=min(v['at']['send'] for s in summary['samples'] for v in s['views'])/1000
        end=max(v['at']['react'] for s in summary['samples'] for v in s['views'])/1000
        entries=[json.loads(line) for line in contents(name+'.log').splitlines() if line.startswith('{')]
        cpu=stats([e['cpu_busy_percent'] for e in entries if start<=e.get('host_sample',0)<=end])
        if condition=='idle':assert s['send_slowest_remote_render_ms']['p95']<250
        runs.append({'name':name,'variant':variant,'send_render_ms':s['send_slowest_remote_render_ms'],'cpu_during_sends':cpu,
            'certification_ms':s['live_count_ms'],'renders':100,'notifications':150,'recertified_history':0})
    pooled={v:stats([s['worst'] for n in range(4) if runs[n]['variant']==v for s in read(runs[n]['name']+'-summary')['samples']]) for v in ['base','candidate']}
    pairs=[];differences=[]
    for i in [0,2]:
        base=read(runs[i]['name']+'-summary');candidate=read(runs[i+1]['name']+'-summary')
        delta=[c['worst']-b['worst'] for b,c in zip(base['samples'],candidate['samples'])]
        differences+=delta
        pairs.append({'base':runs[i]['name'],'candidate':runs[i+1]['name'],
            'p95_difference_ms':runs[i+1]['send_render_ms']['p95']-runs[i]['send_render_ms']['p95'],
            'same_send_ordinal_difference_ms':stats(delta)})
    result[condition]={'runs':runs,'pooled':pooled,'pairs':pairs,'paired_send_difference_ms':stats(differences)}
entries=[json.loads(line) for line in contents('loaded-batch.log').splitlines() if line.startswith('{')]
workers=next(e for e in entries if 'workers' in e);assert workers['workers']==96
assert next(e['reaped'] for e in entries if 'reaped' in e)==96
result['burners']={'workers':96,'reaped':96,'nice':workers['nice'],'pids':workers['pids']}
for variant in ['base','candidate']:
    ll=read('ll-'+variant+'-summary');flows=ll['flows']
    assert len(flows)==8 and all(v['runs']==20 and v['timeouts']==0 for v in flows.values())
    result['ll-'+variant]={name:flow['commitToReact'] for name,flow in flows.items()}
result['passed']=True
(root/'paired-validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
