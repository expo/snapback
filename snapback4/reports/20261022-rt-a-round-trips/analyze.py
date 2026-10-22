#!/usr/bin/env python3
"""Derive exact protocol cycles and thread-scoped SQLite counts from archives."""
import collections, gzip, json, pathlib, re
HERE=pathlib.Path(__file__).resolve().parent

def derive(raw):
    names={};building=collections.defaultdict(list);pending=collections.defaultdict(collections.deque)
    flights=[];max_pending=collections.Counter();unmatched=[]
    for index,event in enumerate(raw['events']):
        conn=event['conn'];typ=event['type'];direction=event['direction']
        if direction=='frontend':
            if typ=='P':names[conn,event['name']]=event['sql']
            if typ in ['P','B','E','D','C','Q','S','H']:
                copy={**event,'event_index':index}
                if typ=='B':copy['sql']=names.get((conn,event['name']),'<unknown>')
                building[conn].append(copy)
            if typ in ['S','Q']:
                group=building.pop(conn)
                flight=dict(conn=conn,start_ns=group[0]['ns'],boundary_ns=event['ns'],frontend=''.join(e['type'] for e in group),
                            sql=[e['sql'] for e in group if e['type'] in ['B','Q']],
                            prepare=[e['sql'] for e in group if e['type']=='P'],commands=[],start_event=group[0]['event_index'])
                pending[conn].append(flight);max_pending[conn]=max(max_pending[conn],len(pending[conn]))
        else:
            if typ=='C':
                assert pending[conn],event
                pending[conn][0]['commands'].append(event['tag'])
            if typ=='Z':
                if pending[conn]:
                    flight=pending[conn].popleft();flight.update(end_ns=event['ns'],status=event['status']);flights.append(flight)
                else:unmatched.append(event) # Startup ReadyForQuery, excluded from SQL flights.
    assert not any(pending.values()),'incomplete response flights'
    flights.sort(key=lambda f:f['start_ns'])
    summaries=[]
    for phase in raw['phases']:
        out={k:v for k,v in phase.items() if k not in ['result']}
        if phase['backend']=='postgres':
            group=[f for f in flights if phase['start_ns']<=f['start_ns']<=phase['end_ns']]
            # Renewals have their own dedicated connection and UPDATE _owner.
            renewal_conns={f['conn'] for f in flights if any('UPDATE _owner SET lease_until' in sql for sql in f['sql'])}
            renew=[f for f in group if f['conn'] in renewal_conns]
            request=[f for f in group if f['conn'] not in renewal_conns]
            out.update(startup_exchanges=sum(1 for e in raw['events'] if e['direction']=='frontend' and e['type']=='Startup' and phase['start_ns']<=e['ns']<=phase['end_ns']),blocking_exchanges=sum(f['frontend']!='CS' for f in request),close_exchanges=sum(f['frontend']=='CS' for f in request),exchanges=len(request),statements=sum(len(f['commands']) for f in request),prepare_exchanges=sum(bool(f['prepare']) for f in request),
                       frontend=dict(collections.Counter(f['frontend'] for f in request)),
                       commands=dict(collections.Counter(c for f in request for c in f['commands'])),
                       renewal_exchanges=len(renew),renewal_statements=sum(len(f['commands']) for f in renew),
                       flights=request,renewal_flights=renew)
            traces=[t for t in raw['traces'][phase['server']] if phase['start_ns']<=int(t['ns'])<=phase['end_ns'] and t['kind']=='pg_begin']
            out['snapshots']=[dict(mode=t['mode'],ns=t['ns'],sites=re.findall(r'at (.*(?:snapback4|snapback4-core)/src/[^\n]+)',t['stack'])) for t in traces]
        else:
            stmts=[t for t in raw['traces'][phase['server']] if phase['start_ns']<=int(t['ns'])<=phase['end_ns'] and t['kind']=='sqlite']
            out.update(statements=len(stmts),sql=[t['sql'] for t in stmts])
        summaries.append(out)
    return dict(phases=summaries,max_pending_flights=dict(max_pending),startup_ready_messages=len(unmatched),all_flights=len(flights))

runs={}
phases=[]
for name in ['tiny','reads']:
    raw=json.loads(gzip.decompress((HERE/('raw-'+name+'.json.gz')).read_bytes()))
    result=derive(raw)
    # The first two runs lack SQLite thread attribution; retain them as window
    # counts only, and use the dedicated repeat for request-specific counts.
    runs[name]={k:v for k,v in result.items() if k!='phases'}
    runs[name]['unseparated_sqlite_windows']=[p for p in result['phases'] if p['backend']=='sqlite']
    for p in result['phases']:
        if p['backend']=='postgres':p['run']=name;phases.append(p)
raw=json.loads(gzip.decompress((HERE/'raw-sqlite.json.gz').read_bytes()))
for phase in raw['phases']:
    window=[t for t in raw['traces'][phase['server']] if phase['start_ns']<=int(t['ns'])<=phase['end_ns'] and t['kind']=='sqlite']
    request_threads={t['thread'] for t in window if 'FROM _sessions' in t['sql']}
    assert len(request_threads)==1,(phase,request_threads)
    request=[t for t in window if t['thread'] in request_threads]
    background=[t for t in window if t['thread'] not in request_threads]
    out={k:v for k,v in phase.items() if k!='result'}
    out.update(run='sqlite-repeat',statements=len(request),sql=[t['sql'] for t in request],request_thread=next(iter(request_threads)),background_statements=len(background),background_sql=[t['sql'] for t in background])
    phases.append(out)
(HERE/'counts.json').write_text(json.dumps(dict(runs=runs,phases=phases),indent=2)+'\n')
for p in phases:
    print(p['run'],p['backend'],p['label'],'SQL',p['statements'],'cycles',p.get('exchanges'),'prepare',p.get('prepare_exchanges'),'blocking',p.get('blocking_exchanges'),'startup',p.get('startup_exchanges'),'background',p.get('background_statements',0))
