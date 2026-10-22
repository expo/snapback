#!/usr/bin/env python3
"""Black-box semantics on a disposable copy; never changes the measured fixture."""
import argparse
import json
from pathlib import Path
import shutil
import time

from snapback import Snapback, http, room, user, principal
from run import write


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--out',required=True)
    p.add_argument('--fixture',required=True)
    p.add_argument('--rows',type=int,default=1000000)
    args=p.parse_args()
    args.warmup_ms=10000;args.duration_ms=20000;args.repeats=3
    run=Snapback(args)
    try:
        run.start()
        shutil.copytree(args.fixture,run.release,symlinks=True)
        directory=run.out/'serve';directory.mkdir()
        run.start_service(32,0,directory)
        tokens=run.tokens
        def call(op,args=None,u=0,mutation=False,**fields):
            return http(('/m/' if mutation else '/q/')+op,dict(args=args or {},**fields),tokens[u])
        assert http('/q/W1',dict(args=dict(message='m0000000001')))[0]==401
        assert http('/q/W1',dict(args=dict(message='m0000000001')),'malformed')[0]==401
        assert http('/q/W1',dict(args=dict(message='m0000000001')),None,**{'x-snapback-persona':'alice'})[0]==401
        assert http('/seed',[])[0]==403
        write(run.out/'seed-equality.json',run.verify_seed(args.rows))
        for u in range(256):
            r=(u*4)%1024
            status,v=call('W1',dict(message=f'm{r+1:010}'),u,principal=principal((u+128)%256))
            assert status==200 and v['complete'] and v['data']['room']==room(r)
            assert v['data']['body']==f'message-{r+1} '+'chat '*30
            assert v['viewer']==principal(u)
            status,v=call('W2',dict(room=room(r)),u)
            expected=[g for g in range(r+1,args.rows+1,1024)][-20:][::-1]
            assert status==200 and v['complete'] and [m['id'] for m in v['data']]==[f'm{g:010}' for g in expected]
            status,v=call('W3',u=u)
            rooms=sorted((u*4+j)%1024 for j in range(32))
            assert status==200 and v['complete'] and [r['room'] for r in v['data']]==[room(r) for r in rooms]
            assert all(r['unread']==10 and r['total']==(args.rows+1023-int(r['room'][1:]))//1024 for r in v['data'])
        assert 'denied' in call('W1',dict(message='m0000000001'),128)[1]
        assert 'denied' in call('W2',dict(room='r0000'),128)[1]
        assert call('increment',dict(counter='c0000'),128,True)[1]['state']=='failed'
        for u in (0,1,31,128,255):
            v=call('increment',dict(counter=f'c{u:04}'),u,True)[1]
            assert v['state']=='sent' and v['result']['n']==1
            v=call('increment',dict(counter='c0256'),u,True)[1]
            assert v['state']=='sent'
        assert run.sql('SELECT sum(n) AS n FROM counters')['rows']==[dict(n=10)]
        before=run.sql("SELECT total FROM rooms WHERE id='r0000'")['rows'][0]['total']
        sent=run.sql("SELECT sent FROM users WHERE id='u0000'")['rows'][0]['sent']
        assert call('post',dict(room='r0000',body='refused'),128,True)[1]['state']=='failed'
        v=call('post',dict(room='r0000',body='atomic post'),0,True)[1]
        assert v['state']=='sent'
        assert run.sql("SELECT total FROM rooms WHERE id='r0000'")['rows'][0]['total']==before+1
        assert run.sql("SELECT sent FROM users WHERE id='u0000'")['rows'][0]['sent']==sent+1
        service=run.cli('token','--service','fixture','--release',run.release,'--quiet').strip()
        assert http('/auth/revoke',dict(principal=principal(255)),service)[0]==200
        assert call('W3',u=255)[0]==401
        write(run.out/'checks.json',dict(all_256_principals_full_read_results=True,
            signed_principal_ignores_body=True,member_nonmember=True,ordered_newest20=True,
            exact_32_room_inbox=True,counter_ownership=True,shared_member_counter=True,
            post_member_rule=True,atomic_maintained_room_and_sender_totals=True,
            missing_malformed_revoked_token_401=True,serve_personas_and_seed_closed=True,
            tokens_verified_per_request='SHA-256 bearer digest + stored live session/expiry/generation, shipped serve'))
        print('Snapback black-box checks passed',flush=True)
    finally:run.close()


if __name__=='__main__':main()
