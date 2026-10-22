#!/usr/bin/env python3
"""Black-box rules, maintained totals, prepared service and open-loop overload."""
import argparse
import json
import subprocess as sp
import urllib.error
import urllib.request
from pathlib import Path
from run import Run, BIN, LOAD_CORES


def call(workload,principal=0,**kwargs):
    request=urllib.request.Request('http://127.0.0.1:58080/op',json.dumps(dict(workload=workload,principal=principal,**kwargs)).encode(),{'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request) as r: return r.status,json.load(r)
    except urllib.error.HTTPError as e: return e.code,None


a=argparse.Namespace(out=__import__('sys').argv[1],tunnel_base=63000)
r=Run(a)
checks={}
try:
    r.start(33); r.fixture(100000)
    normal=r.out/'rules'; normal.mkdir()
    r.start_service(4,0,normal)
    assert call('W1',message=1)[0]==200
    assert call('W1',principal=128,message=1)[0]==404
    assert call('W2',room=0)[0]==200
    assert len(call('W2',room=0)[1]['data'])==20
    assert call('W2',principal=128,room=0)[0]==404
    assert len(call('W3')[1]['data'])==32
    assert call('W4',counter=1)[0]==404
    assert call('W4',counter=0)[0]==200
    assert call('W5',principal=999,counter=256)[0]==404
    assert call('W5',principal=255,counter=256)[0]==200
    checks['read_and_counter_rules']=True
    before=json.loads(r.psql("SELECT jsonb_build_array((SELECT count(*) FROM messages WHERE room=0),(SELECT total FROM rooms WHERE id=0),(SELECT sent FROM users WHERE id=0))"))
    assert call('post',principal=128,room=0,body='forbidden')[0]==404
    code,data=call('post',room=0,body='maintain witness')
    assert code==200
    after=json.loads(r.psql("SELECT jsonb_build_array((SELECT count(*) FROM messages WHERE room=0),(SELECT total FROM rooms WHERE id=0),(SELECT sent FROM users WHERE id=0))"))
    assert after==[v+1 for v in before]
    mid=data['data']['id']
    r.psql(f'DELETE FROM messages WHERE id={mid}; UPDATE rooms SET total=total-1 WHERE id=0; UPDATE users SET sent=sent-1 WHERE id=0;')
    checks['post_rule_and_atomic_maintains']=True
    r.stop_service()
    overload=r.out/'overload'; overload.mkdir()
    r.start_service(1,0,overload)
    output=sp.check_output(['taskset','-c',LOAD_CORES,str(BIN),'load','--target','raw-pg-no-token','--workload','W4','--workers','1','--rows','100000','--rate','5000','--warmup-ms','0','--duration-ms','400'],env=r.env,text=True)
    result=json.loads(output)
    assert result['scheduled']==2000
    assert result['scheduled']==result['success']+result['error_count']
    assert result['errors'].get('expired_before_send',0)>0
    assert result['latency']['p99_ms']>=1000 and not result['slo_pass']
    (overload/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    checks['overload_preserves_arrivals_and_queue_latency']=True
    (r.out/'checks.json').write_text(json.dumps(checks,indent=2)+'\n')
    print(json.dumps(checks))
finally: r.close()
