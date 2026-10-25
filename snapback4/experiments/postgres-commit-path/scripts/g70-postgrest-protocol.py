#!/usr/bin/env python3
"""Observe one W4 PostgREST request with bind values suppressed in the PG log.

Run after performance trials, on a separate owned private cluster. The ordinary
one-host lifecycle/pinning and advocate config are reused without tuning.
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import urllib.request

CONTROL=Path(__file__).resolve().parents[2]/'scale-controls/scripts'
sys.path.insert(0,str(CONTROL))
spec=importlib.util.spec_from_file_location('onehost',CONTROL/'s1-onehost.py')
oh=importlib.util.module_from_spec(spec);spec.loader.exec_module(oh)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',required=True);p.add_argument('--harness',required=True);p.add_argument('--scan-vault',type=Path,required=True);args=p.parse_args()
    a=argparse.Namespace(system='supabase',out=args.out,harness=args.harness,snapback_bin='',seed_bin='',warmup_ms=0,duration_ms=0,repeats=1,extra_read_rates=[],max_rate=1,rates=[1],rows=1000000,load_cores=oh.LOAD_CORES,target='supabase')
    r=oh.make_runner(oh.configure(a))(a)
    def interrupt(sig,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupt)
    try:
        # Extend the outside-archive known-secret vault before private cleanup.
        values=set(json.loads(args.scan_vault.read_text()))
        values.add(base64.b64encode((r.runtime/'jwt-secret').read_bytes()).decode())
        values.update(base64.b64encode(t.encode()).decode() for t in json.loads(r.private.read_text()))
        with args.scan_vault.open('w') as f:json.dump(sorted(values),f)
        assert args.scan_vault.stat().st_mode&0o777==0o600
        r.start();r.fixture(1000000)
        # These settings apply only to new authenticator sessions, after load
        # trials. Zero prevents any bind value (including Authorization) from
        # entering the statement log. The session-level settings are verified.
        r.sqlpg("ALTER ROLE authenticator SET log_parameter_max_length=0; ALTER ROLE authenticator SET log_parameter_max_length_on_error=0; ALTER ROLE authenticator SET log_statement='all'")
        d=r.out/'request';d.mkdir();r.ping(500,d/'rtt-before.json');r.start_service(32,500,d)
        log=r.out/'postgres.stderr';offset=log.stat().st_size
        before=json.loads(r.sqlpg("SELECT jsonb_build_object('xact_commit',xact_commit,'wal_sync',(SELECT wal_sync FROM pg_stat_wal)) FROM pg_stat_database WHERE datname=current_database()"))
        request=urllib.request.Request('http://127.0.0.1:58080/rpc/increment',data=b'{"counter_id":0}',method='POST',headers={'Authorization':'Bearer '+json.loads(r.private.read_text())[0],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=10) as response:
            assert response.status==200
            body=json.loads(response.read());assert body=={'id':0,'n':1}
        # Closing the serving sessions publishes transaction and WAL stats.
        r.stop_service()
        after=json.loads(r.sqlpg("SELECT jsonb_build_object('xact_commit',xact_commit,'wal_sync',(SELECT wal_sync FROM pg_stat_wal)) FROM pg_stat_database WHERE datname=current_database()"))
        snippet=log.read_bytes()[offset:]
        # PG logs extended-protocol statement text, never its bound values.
        assert b'parameters:' not in snippet
        statements=[]
        for line in snippet.decode().splitlines():
            if 'LOG:  execute ' in line:statements.append(line.split(': ',2)[-1])
            elif 'LOG:  statement: ' in line:statements.append(line.split('LOG:  statement: ',1)[1])
        (d/'protocol.json').write_text(json.dumps(dict(http_status=200,returned_counter=body,statements=statements,bind_values_logged=False,database_before=before,database_after=after),indent=2)+'\n')
        print('one W4 protocol request observed; bind values suppressed',flush=True)
    finally:
        r.close();private=str(r.runtime);shutil.rmtree(r.runtime)
        (r.out/'private-cleanup.json').write_text(json.dumps(dict(path=private,removed=not Path(private).exists()))+'\n')


if __name__=='__main__':main()
