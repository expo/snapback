#!/usr/bin/env python3
"""Black-box native authorization, seed round trip and overload witnesses."""
import argparse, hashlib, json, subprocess as sp, urllib.error, zipfile
from pathlib import Path
from convex import ConvexRun, ROOT, seed
from run import write

p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--rows',type=int,default=100000);a=p.parse_args()
a.tunnel_base=61000;a.load_cores='3-5,9-11';a.warmup_ms=500;a.duration_ms=2000;a.repeats=1;a.max_rate=128000;a.rates=None;a.target='convex'
r=ConvexRun(a);checks={}
try:
    r.start(33);r.fixture(a.rows)
    d=r.out/'checks';d.mkdir();r.start_service(32,0,d)
    tokens=json.loads((ROOT/'tokens.json').read_text())
    def call(path,args=None,kind='query',principal=0,admin=False,token=None):
        return r.call('chat:'+path,args,kind,token=tokens[principal] if token is None else token,admin=admin)
    def denied(name,*args,**kw):
        try:call(*args,**kw)
        except (urllib.error.HTTPError,RuntimeError):checks[name]=True;return
        raise AssertionError(name+' unexpectedly allowed')
    checks['member_point']=call('point',{'message':1})==dict(id=1,room=0,sender=0,at=1700000000001,body='message-1 '+'chat '*30)
    denied('nonmember_point','point',{'message':1},principal=1)
    denied('nonmember_page','page',{'room':0},principal=1)
    denied('anonymous','point',{'message':1},token='')
    denied('invalid_signature','point',{'message':1},token=tokens[0][:-8]+'AAAAAAAA')
    def mint(overrides):
        script="""const c=require('node:crypto'),f=require('node:fs');const k=f.readFileSync(process.argv[1]);const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const t=enc({alg:'RS256',kid:'s1cx',typ:'JWT'})+'.'+enc({iss:'https://s1cx.invalid',aud:'s1cx',sub:'0',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...JSON.parse(process.argv[2])});process.stdout.write(t+'.'+c.sign('RSA-SHA256',Buffer.from(t),k).toString('base64url'));"""
        return sp.check_output(['node','-e',script,str(ROOT/'issuer-private.pem'),json.dumps(overrides)],env=r.env,text=True)
    for name,overrides in [('expired',{'exp':1}),('wrong_audience',{'aud':'elsewhere'}),('wrong_issuer',{'iss':'https://elsewhere.invalid'}),('unknown_principal',{'sub':'256'})]:
        denied(name,'point',{'message':1},token=mint(overrides))
    denied('internal_witness_private','witness')
    page=call('page',{'room':0});checks['ordered_page']=len(page)==20 and all(m['room']==0 for m in page) and all(page[i]['at']>page[i+1]['at'] for i in range(19))
    inbox=call('inbox');checks['inbox']=len(inbox)==32 and all(m['unread']==10 for m in inbox)
    # Validate the actual imported values against seed.sql's field formulas.
    export=ROOT/f'check-export-{a.rows}-{r.out.name}.zip'
    r.cli('export','--path',str(export),log=d/'export.txt')
    mask=(1<<256)-1
    def digest(records):
        count=0;total=0;xor=0
        for x in records:
            x={k:v for k,v in x.items() if k not in ['_id','_creationTime']}
            # JSON numbers from Convex may use floating lexical representations.
            x={k:int(v) if isinstance(v,float) and v.is_integer() else v for k,v in x.items()}
            n=int.from_bytes(hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).digest(),'big')
            count+=1;total=(total+n)&mask;xor^=n
        return dict(count=count,sum_sha256=f'{total:064x}',xor_sha256=f'{xor:064x}')
    fingerprints={}
    with zipfile.ZipFile(export) as z:
        for table,expected in seed(a.rows):
            path=next(n for n in z.namelist() if n==table+'/documents.jsonl')
            with z.open(path) as f:
                if table=='counters':
                    cs=[json.loads(line) for line in f]
                    ns={int(x['id']):int(x['n']) for x in cs}
                    assert len(ns)==257 and all(n>=0 for n in ns.values())
                    actual=digest(cs)
                    expected=(dict(x,n=ns[x['id']]) for x in expected)
                else:actual=digest(json.loads(line) for line in f)
            wanted=digest(expected)
            assert actual==wanted,(table,actual,wanted)
            fingerprints[table]=dict(actual=actual,expected=wanted,equal=True)
    write(r.out/'seed-equivalence.json',fingerprints)
    checks['full_seed_export']=True
    before=call('witness',admin=True)
    checks['own_counter']=call('increment',{'counter':0},'mutation')['id']==0
    denied('other_counter','increment',{'counter':0},'mutation',principal=1)
    checks['shared_counter']=call('increment',{'counter':256},'mutation',principal=1)['id']==256
    checks['exact_counters']=call('witness',admin=True)['sum']-before['sum']==2
    denied('nonmember_post','post',dict(room=0,id=-1,at=1800000000000,body='test'),'mutation',principal=1)
    denied('spoofed_sender','post',dict(room=0,id=-1,at=1800000000000,body='test',sender=1),'mutation')
    before=call('inspect',admin=True)
    post=call('post',dict(room=0,id=-1,at=1800000000000,body='test'),'mutation')
    after=call('inspect',admin=True)
    checks['atomic_totals']=after['room']['total']==before['room']['total']+1 and after['user']['sent']==before['user']['sent']+1 and post['sender']==0
    call('removeTestPost',{'id':-1},'mutation',admin=True)
    checks['test_post_restored']=call('inspect',admin=True)==before
    for w in ['W1','W2','W3','W4','W5']:
        test=r.out/('adapter-'+w);test.mkdir()
        result=r.trial(test,w,4,'same' if w=='W5' else 'disjoint',a.rows,2,0)
        checks['native_adapter_'+w]=result['error_count']==0 and result['success']==result['scheduled'] and result.get('counter_check',{'ok':True})['ok']
    r.stop_service()
    # At C=1, including startup, the same persistence budget must remain usable.
    d=r.out/'overload';d.mkdir();r.start_service(1,500,d)
    result=r.trial(d,'W4',4,'disjoint',a.rows,20000,0)
    checks['overload_accounting']=not result['slo_pass'] and result['scheduled']==result['success']+result['error_count'] and result['latency']['p99_ms']>100
    r.stop_service()
    assert all(checks.values()),checks
    write(r.out/'checks.json',checks)
finally:r.close()
