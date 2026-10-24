"""Untimed authorization and full imported-image witnesses for the S1 runner."""
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request
import zipfile


def convex_image(r,rows):
    from convex import seed
    directory=r.out/'fixture-verify';directory.mkdir()
    r.start_service(32,0,directory)
    export=r.runtime/'fixture.zip'
    r.cli('export','--path',str(export),log=directory/'export.txt')
    def digest(records):
        count=total=xor=0;mask=(1<<256)-1
        for x in records:
            x={k:int(v) if isinstance(v,float) and v.is_integer() else v for k,v in x.items() if k not in ('_id','_creationTime')}
            n=int.from_bytes(hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).digest(),'big')
            count+=1;total=(total+n)&mask;xor^=n
        return dict(count=count,sum_sha256=f'{total:064x}',xor_sha256=f'{xor:064x}')
    fingerprints={}
    with zipfile.ZipFile(export) as z:
        for table,expected in seed(rows):
            with z.open(table+'/documents.jsonl') as f:actual=digest(json.loads(line) for line in f)
            wanted=digest(expected);assert actual==wanted,(table,actual,wanted)
            fingerprints[table]=dict(actual=actual,expected=wanted,equal=True)
    r.stop_service();export.unlink()
    return fingerprints


def authorization(r):
    tokens=json.loads(Path(r.env['SCALE_JWT_TOKENS_FILE']).read_text())
    system=r.args.system
    if system=='snapback':return dict(source='native seed and inherited native probe equality')
    def call(operation,principal=0,args=None,bearer=None):
        args=args or {}
        if system=='convex':
            functions=dict(W1='point',W2='page',W3='inbox',W4='increment')
            try:return 200,r.call('chat:'+functions[operation],args,'mutation' if operation=='W4' else 'query',token=tokens[principal] if bearer is None else bearer)
            except (urllib.error.HTTPError,RuntimeError):return 403,None
        headers={'Content-Type':'application/json','Authorization':'Bearer '+(tokens[principal] if bearer is None else bearer)}
        if system=='supabase':
            paths=dict(W1='messages?id=eq.'+str(args.get('message',1)),W2='messages?room=eq.0&order=at.desc,id.desc&limit=20',W3='rpc/inbox',W4='rpc/increment')
            path=paths[operation];body=({'counter_id':args['counter']} if operation=='W4' else {}) if operation in ('W3','W4') else None
        else:path='op';body=dict(workload=operation,principal=principal,**args)
        req=urllib.request.Request('http://127.0.0.1:58080/'+path,None if body is None else json.dumps(body).encode(),headers)
        try:
            with urllib.request.urlopen(req,timeout=10) as response:value=json.load(response)
            return 200,value['data'] if system=='rawpg' else value
        except urllib.error.HTTPError as e:return e.code,None
    def allowed(op,**args):
        code,v=call(op,args=args);assert code==200 and v is not None
        return v
    point=allowed('W1',message=1)
    if system=='supabase':point=point[0]
    assert point['id']==1 and point['room']==0 and point['body']=='message-1 '+'chat '*30
    code,v=call('W1',principal=128,args=dict(message=1));assert code!=200 or not v
    assert call('W1',args=dict(message=1),bearer='malformed')[0]!=200
    page=allowed('W2',room=0);assert len(page)==20 and all(page[i]['at']>page[i+1]['at'] for i in range(19))
    inbox=allowed('W3');assert len(inbox)==32
    if system=='convex':before=r.call('chat:witness',admin=True)['sum']
    else:before=int(r.psql('SELECT sum(n) FROM counters'))
    assert allowed('W4',counter=0)['id']==0
    code,v=call('W4',principal=1,args=dict(counter=0));assert code!=200 or not v
    assert allowed('W4',counter=256)['id']==256
    if system=='convex':after=r.call('chat:witness',admin=True)['sum']
    else:after=int(r.psql('SELECT sum(n) FROM counters'))
    assert after-before==2
    return dict(point_image=True,nonmember_denied=True,malformed_jwt_denied=True,ordered_page=True,inbox_32=True,own_and_shared_counter=True,other_counter_denied=True,untimed_counter_delta=2)
