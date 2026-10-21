#!/usr/bin/env python3
"""Native HTTP authorization, JWT validation, seed equivalence and overload."""
import argparse
import json
import subprocess as sp
import sys
import urllib.error
import urllib.request
from run import BIN, LOAD_CORES, write
from supabase import SupabaseRun, token

args=argparse.Namespace(out=sys.argv[1],tunnel_base=63000,target='supabase')
run=SupabaseRun(args)
checks={}

def call(path,principal=0,data=None,jwt=None,headers=None):
    headers=dict(headers or {})
    if jwt is not False: headers['Authorization']='Bearer '+(jwt or token(run.jwt.read_bytes(),principal))
    if data is not None: headers['Content-Type']='application/json'
    request=urllib.request.Request('http://127.0.0.1:58080/'+path,
              None if data is None else json.dumps(data).encode(),headers)
    try:
        with urllib.request.urlopen(request,timeout=3) as response:
            value=response.read()
            return response.status,json.loads(value) if value else None
    except urllib.error.HTTPError as error:
        return error.code,json.loads(error.read())

try:
    run.start(33);run.fixture(100000)
    normal=run.out/'rules';normal.mkdir()
    run.start_service(10,0,normal)
    assert call('messages?id=eq.1')[1][0]['room']==0
    assert call('messages?id=eq.1',128)==(200,[])
    assert len(call('messages?room=eq.0&order=at.desc,id.desc&limit=20')[1])==20
    assert call('messages?room=eq.0',128)==(200,[])
    assert len(call('rpc/inbox',data={})[1])==32
    assert call('rpc/increment',data=dict(counter_id=1))==(200,None)
    assert call('rpc/increment',data=dict(counter_id=0))[1]['id']==0
    assert call('rpc/increment',999,data=dict(counter_id=256))==(200,None)
    assert call('rpc/increment',255,data=dict(counter_id=256))[1]['id']==256
    assert call('messages?id=eq.1',jwt=False)[0] in (401,403)
    assert call('messages?id=eq.1',jwt=token(b'wrong-secret'*4))[0]==401
    assert call('messages?id=eq.1',jwt=token(run.jwt.read_bytes(),exp=1))[0]==401
    assert call('users')[1][0]['id']==0 and len(call('users')[1])==1
    assert call('messages?id=eq.1',128)==(200,[]), 'pooled claims leaked'
    assert call('rpc/principal_id',data={})[0]==404, 'private helper exposed'
    checks['membership_counter_jwt_and_pooled_claim_isolation']=True
    before=json.loads(run.psql("SELECT jsonb_build_array((SELECT count(*) FROM messages WHERE room=0),(SELECT total FROM rooms WHERE id=0),(SELECT sent FROM users WHERE id=0))"))
    post=dict(room=0,sender=0,at=1700000000000,body='maintain witness')
    assert call('messages',128,data=dict(post,sender=128))[0]==403
    assert call('messages',data=dict(post,sender=1))[0]==403
    code,rows=call('messages',data=post,headers={'Prefer':'return=representation'})
    assert code==201 and len(rows)==1
    after=json.loads(run.psql("SELECT jsonb_build_array((SELECT count(*) FROM messages WHERE room=0),(SELECT total FROM rooms WHERE id=0),(SELECT sent FROM users WHERE id=0))"))
    assert after==[v+1 for v in before]
    run.psql(f"DELETE FROM messages WHERE id={rows[0]['id']}; UPDATE rooms SET total=total-1 WHERE id=0; UPDATE users SET sent=sent-1 WHERE id=0")
    checks['post_membership_sender_and_atomic_maintains']=True
    # Compare actual read values and all message payloads with S1-H's seed.
    for sql,path in [
        ("SELECT to_jsonb(m) FROM messages m WHERE id=1",'messages?id=eq.1'),
        ("SELECT jsonb_agg(to_jsonb(m) ORDER BY at DESC,id DESC) FROM (SELECT * FROM messages WHERE room=0 ORDER BY at DESC,id DESC LIMIT 20) m",'messages?room=eq.0&order=at.desc,id.desc&limit=20'),
        ("SELECT jsonb_agg(to_jsonb(p) ORDER BY room) FROM (SELECT m.room,r.total,greatest(0,r.total-m.last_read) unread FROM memberships m JOIN rooms r ON r.id=m.room WHERE m.principal=0 AND m.room<1024 ORDER BY m.room LIMIT 32) p",'rpc/inbox')]:
        raw=json.loads(run.psql(sql,database='sb4scale_raw_100000'))
        data=call(path,data={} if path.startswith('rpc/') else None)[1]
        assert raw==(data[0] if 'id=eq.1' in path else data)
    sql="SELECT jsonb_build_object('messages', (SELECT md5(string_agg(row(id,room,sender,at,body)::text,'' ORDER BY id)) FROM messages),'memberships',(SELECT md5(string_agg(row(room,principal,last_read)::text,'' ORDER BY room,principal)) FROM memberships),'rooms',(SELECT md5(string_agg(row(id,total)::text,'' ORDER BY id)) FROM rooms),'users',(SELECT md5(string_agg(row(id,sent)::text,'' ORDER BY id)) FROM users))"
    own=json.loads(run.psql(sql));raw=json.loads(run.psql(sql,database='sb4scale_raw_100000'))
    assert own==raw
    write(run.out/'seed-equivalence.json',own)
    checks['raw_seed_and_http_values_equal']=True
    run.stop_service()
    overload=run.out/'overload';overload.mkdir();run.start_service(10,0,overload)
    result=json.loads(sp.check_output(['taskset','-c',LOAD_CORES,str(BIN),'load','--target','supabase','--workload','W4','--workers','1','--rows','100000','--rate','5000','--warmup-ms','0','--duration-ms','400'],env=run.env,text=True))
    assert result['scheduled']==2000==result['success']+result['error_count']
    assert result['errors'].get('expired_before_send',0)>0
    assert result['latency']['p99_ms']>=1000 and not result['slo_pass']
    write(overload/'result.json',result)
    checks['overload_arrival_accounting']=True
    write(run.out/'checks.json',checks)
    print(json.dumps(checks))
finally: run.close()
