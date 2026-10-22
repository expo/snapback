#!/usr/bin/env python3
"""Detached post-campaign black-box checks using only S1-FR databases/roles."""
import argparse
import json
import os
from pathlib import Path
import subprocess as sp
import sys
import time
import urllib.error
import urllib.request

from fairness import Raw, Supabase
from run import BIN, LOAD_CORES, write
from supabase import token


def main():
    out=Path(sys.argv[1]).resolve();out.mkdir(exist_ok=False,parents=True)
    write(out/'supervisor.json',dict(pid=os.getpid(),pgid=os.getpgid(0),start=time.time()))
    checks={}
    for target,cls in [('raw-pg',Raw),('supabase',Supabase)]:
        args=argparse.Namespace(out=str(out/(out.name+'-'+target)),tunnel_base=63100,target=target)
        r=cls(args)
        try:
            r.start(34 if target=='supabase' else 33);r.fixture(1000000)
            normal=r.out/'rules';normal.mkdir();r.start_service(32,0,normal)
            secret=(Path(r.env['SCALE_JWT_SECRET_FILE']) if target=='raw-pg' else r.jwt).read_bytes()
            def call(path,principal=0,data=None,jwt=None,headers=None):
                hs=dict(headers or {})
                if jwt is not False: hs['Authorization']='Bearer '+(jwt or token(secret,principal))
                if data is not None: hs['Content-Type']='application/json'
                req=urllib.request.Request('http://127.0.0.1:58080/'+path,
                    None if data is None else json.dumps(data).encode(),hs)
                try:
                    with urllib.request.urlopen(req,timeout=5) as response:
                        body=response.read()
                        return response.status,json.loads(body) if body else None
                except urllib.error.HTTPError as error: return error.code,None
            def op(w,principal=0,**fields):
                if target=='raw-pg':
                    code,v=call('op',principal,data=dict(workload=w,principal=999,**fields))
                    return code,(v or {}).get('data')
                path=({'W1':'messages?id=eq.'+str(fields.get('message',1)),
                    'W2':'messages?room=eq.'+str(fields.get('room',0))+'&order=at.desc,id.desc&limit=20',
                    'W3':'rpc/inbox','W4':'rpc/increment','W5':'rpc/increment'})[w]
                data={} if w=='W3' else dict(counter_id=fields['counter']) if w in ('W4','W5') else None
                code,v=call(path,principal,data=data)
                if w=='W1': v=v[0] if v else None
                return code,v
            assert op('W1',message=1)[1]['room']==0
            assert op('W1',128,message=1)[1] is None
            assert len(op('W2',room=0)[1])==20
            assert op('W2',128,room=0)[1] in (None,[])
            assert len(op('W3')[1])==32
            assert op('W4',counter=1)[1] is None
            assert op('W4',counter=0)[1]['id']==0
            assert op('W5',255,counter=256)[1]['id']==256
            if target=='raw-pg':
                r.before_trials(normal,'W1',128,'disjoint',1000000)
            else:
                assert call('rpc/principal_id',data={})[0]==404
                assert call('rpc/member_rooms',data={})[0]==404
                assert call('messages?id=eq.1',jwt=False)[0] in (401,403)
                assert call('messages?id=eq.1',jwt=token(b'wrong-key'*8))[0]==401
                assert call('messages?id=eq.1',jwt=token(secret,exp=1))[0]==401
                assert call('rpc/increment',jwt=token(secret,role='service_role'),data=dict(counter_id=1))[1]['id']==1
            before=json.loads(r.psql("SELECT jsonb_build_array((SELECT count(*) FROM messages WHERE room=0),(SELECT total FROM rooms WHERE id=0),(SELECT sent FROM users WHERE id=0))"))
            if target=='raw-pg':
                assert call('op',128,data=dict(workload='post',principal=0,room=0,body='forbidden'))[0]==404
                code,v=call('op',data=dict(workload='post',principal=128,room=0,body='maintain witness'))
                assert code==200;mid=v['data']['id']
            else:
                post=dict(room=0,sender=0,at=1700000000000,body='maintain witness')
                assert call('messages',128,data=dict(post,sender=128))[0]==403
                assert call('messages',data=dict(post,sender=1))[0]==403
                code,v=call('messages',data=post,headers={'Prefer':'return=representation'})
                assert code==201;mid=v[0]['id']
            after=json.loads(r.psql("SELECT jsonb_build_array((SELECT count(*) FROM messages WHERE room=0),(SELECT total FROM rooms WHERE id=0),(SELECT sent FROM users WHERE id=0))"))
            assert after==[v+1 for v in before]
            r.psql(f'DELETE FROM messages WHERE id={mid}; UPDATE rooms SET total=total-1 WHERE id=0; UPDATE users SET sent=sent-1 WHERE id=0')
            # The immutable fixture must agree across the two private databases.
            fingerprint="SELECT jsonb_build_object('messages',(SELECT md5(string_agg(row(id,room,sender,at,body)::text,'' ORDER BY id)) FROM messages),'memberships',(SELECT md5(string_agg(row(room,principal,last_read)::text,'' ORDER BY room,principal)) FROM memberships),'rooms',(SELECT md5(string_agg(row(id,total)::text,'' ORDER BY id)) FROM rooms),'users',(SELECT md5(string_agg(row(id,sent)::text,'' ORDER BY id)) FROM users))"
            seed=json.loads(r.psql(fingerprint))
            write(r.out/'seed-equivalence.json',seed)
            r.stop_service()
            overload=r.out/'overload';overload.mkdir();r.start_service(1,0,overload)
            # This intentionally overloaded short witness is separate from measured cells.
            command=['taskset','-c',LOAD_CORES,str(BIN),'load','--target',target,
                '--workload','W4','--workers','1','--rows','1000000','--rate','5000',
                '--warmup-ms','0','--duration-ms','400']
            child=sp.Popen(command,env=r.env,stdout=sp.PIPE,stderr=sp.PIPE,text=True)
            with (r.out/'pids.jsonl').open('a') as f:
                f.write(json.dumps(dict(pid=child.pid,kind='overload-check',time=time.time()))+'\n')
            try:
                output,_=child.communicate(timeout=20)
            finally:
                if child.poll() is None:
                    child.terminate();child.wait(timeout=10)
            assert child.returncode==0
            result=json.loads(output)
            assert result['scheduled']==2000==result['success']+result['error_count']
            assert result['errors'].get('expired_before_send',0)>0 and not result['slo_pass']
            write(overload/'result.json',result)
            checks[target]=dict(member_nonmember=True,counter_ownership_and_shared=True,
                signed_identity_and_jwt_refusals=True,atomic_post_maintains=True,overload_accounting=True)
        finally: r.close()
    raw=json.loads((out/(out.name+'-raw-pg')/'seed-equivalence.json').read_text())
    sb=json.loads((out/(out.name+'-supabase')/'seed-equivalence.json').read_text())
    assert raw==sb
    checks['private_seed_equivalence']=True
    write(out/'checks.json',checks)
    print(json.dumps(checks),flush=True)


if __name__=='__main__': main()
