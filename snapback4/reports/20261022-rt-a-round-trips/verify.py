#!/usr/bin/env python3
"""Audit captured counts, outcomes, protocol ordering, and local process custody."""
import gzip,hashlib,json,os,pathlib,subprocess
HERE=pathlib.Path(__file__).resolve().parent
for source in HERE.glob('*.py'):compile(source.read_text(),str(source),'exec')
counts=json.loads((HERE/'counts.json').read_text())
expected={('tiny','increment-warm'):(58,57),('tiny','q-warm'):(22,22),
          ('tiny','q-new-session'):(21,21),('reads','W1-warm'):(23,23),
          ('reads','W2-warm'):(23,23),('reads','one-rule-1'):(59,58),
          ('reads','one-rule-2'):(59,58),('reads','one-rule-3'):(59,58)}
checked=0
for p in counts['phases']:
    if p['backend']=='postgres':
        for (run,prefix),pair in expected.items():
            if p['run']==run and p['label'].startswith(prefix):
                assert (p['statements'],p['exchanges'])==pair,p
                assert p['prepare_exchanges']==0 and p['close_exchanges']==0 and p['startup_exchanges']==0,p
                assert all(a['end_ns']<=b['start_ns'] for a,b in zip(p['flights'],p['flights'][1:])),p['label']
                checked+=1
        if p['label']=='increment-warm-0':
            assert len(p['snapshots'])==10
            assert sum(t['mode']=='None' for t in p['snapshots'])==9
            assert p['commands']['ROLLBACK']==9 and p['commands']['COMMIT']==1
    else:
        prefix=p['label'].split('-warm')[0]
        expected_sql={'increment':79,'q':31 if p['server'].startswith('reads') else 30,'W1':31,'W2':31}
        if '-warm-' in p['label']:
            assert p['statements']==expected_sql[prefix],p
        if p['label'].startswith('one-rule'):assert p['statements']==80,p
assert checked>=15,checked
audits=[]
env={**os.environ,'LD_LIBRARY_PATH':str(pathlib.Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu')}
pgbin=pathlib.Path.home()/'tools/pg16/usr/lib/postgresql/16/bin'
for name in ['tiny','reads','sqlite']:
    raw=json.loads(gzip.decompress((HERE/('raw-'+name+'.json.gz')).read_bytes()))
    assert not raw['alive'] and not raw.get('errors'),name
    absent=[{**p,'absent_now':not pathlib.Path('/proc',str(p['pid'])).exists()} for p in raw['pids']]
    assert all(p['absent_now'] for p in absent),absent
    audit=dict(run=name,work=raw['work'],processes=absent)
    if name!='sqlite':
        status=subprocess.run([str(pgbin/'pg_ctl'),'-D',raw['work']+'/data','status'],env=env,text=True,capture_output=True,timeout=10)
        assert status.returncode==3,(status.returncode,status.stdout,status.stderr)
        audit['cluster_status']=status.stdout.strip()
        settings={}
        for setting in ['fsync','synchronous_commit','full_page_writes','server_version']:
            command=subprocess.run([str(pgbin/'postgres'),'-D',raw['work']+'/data','-C',setting],env=env,text=True,capture_output=True,timeout=10)
            assert command.returncode==0,command.stderr
            settings[setting]=command.stdout.strip()
        audit['settings']=settings
        for phase in raw['phases']:
            if phase['label'].startswith('W1'):
                assert phase['result']['complete'] and phase['result']['data']['id']=='m0024'
            if phase['label'].startswith('W2'):
                assert phase['result']['complete'] and [row['at'] for row in phase['result']['data']]==list(range(24,4,-1))
    else:
        assert all(phase['result']['rows']==20 for phase in raw['phases'] if phase['label'].startswith('W2'))
    audits.append(audit)
result=dict(warm_request_checks=checked,checks='protocol framing/completion, no warm pipeline overlap or prepare, exact counts, W1 point and W2 newest twenty, thread-scoped SQLite counts, all owned processes absent and clusters stopped',custody=audits,sha256={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.glob('*.gz')})
result['source']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
result['binary_sha256']={name:json.loads(gzip.decompress((HERE/('raw-'+name+'.json.gz')).read_bytes()))['binary_sha256'] for name in ['tiny','reads','sqlite']}
result['restored_binary_sha256']=hashlib.sha256((HERE.parents[1]/'target/debug/snapback4').read_bytes()).hexdigest()
(HERE/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(warm_request_checks=checked,owned_processes=sum(len(a['processes']) for a in audits),alive=[])))
