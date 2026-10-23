"""EV-1 public release witness, using the serving harness's owned cluster/children."""
# @ref LLP 3000.009.001.000#3.5 — configured deploy/serve and a store-independent wire comparison.
import json, time

V1 = '''use identity
table notes:
  n: int
  memo: json <=100 ?
  site: text <=200 format url ?
  by byN: n, id
  public
  insert <- allow
  update <- allow
  online only
table retired:
  text: text <=100
  public
  insert <- allow
  online only
mutation put(key: id, n: int, memo: json <=100 ?, site: text <=200 format url ?):
  upsert notes[key] {n, memo, site}
  return n
mutation archive(key: id, text: text <=100):
  insert retired {id: key, text}
  return text
query peek(key: id):
  return notes[key]
query archived(key: id):
  return retired[key]
query ordered():
  return notes first 10 by byN
'''
V2 = '''use identity
table notes:
  n: int
  extra: text <=100 ?
  count: int default 7
  by byCount: count, id
  public
  insert <- allow
  update <- allow
  online only
table added:
  n: int
  public
  insert <- allow
  online only
mutation put(key: id, n: int):
  upsert notes[key] {n}
  return n
mutation add(key: id, n: int):
  insert added {id: key, n}
  return n
query peek(key: id):
  return notes[key]
query addedRow(key: id):
  return added[key]
query ordered():
  return notes where .count = 7 first 10 by byCount
'''

V3 = V1.replace('  memo: json <=100 ?\n', '  memo: json <=100 ?\n  extra: text <=100 ?\n  count: int default 7\n')

def witness(h, pg_url):
    work, cli, start, stop, http = (h[k] for k in ('WORK','cli','start','stop','http'))
    transcripts = {}
    for backend, target in [('postgres', pg_url), ('sqlite', None)]:
        deployment = work / ('ev1-' + backend)
        records = []
        assert V3 != V1 and 'format url ?' in V3
        for version, source in [(1,V1),(2,V2),(3,V3)]:
            (work/'app/snapback/schema.q').write_text(source)
            args = ['deploy', str(deployment)]
            if version == 3: args += ['--restore-dormant']
            cli(args, url=target)
            child, base = start('ev1-'+backend+'-v'+str(version),target,deployment=deployment)
            guest = http(base,'POST','/auth/guest',{})['session']
            token = guest['token']
            state = http(base,'GET','/schema',token=token)
            assert state['generation']==version,state
            def capture(label, value):
                # Each backend mints its own guest principal. Check its value
                # before excluding that nondeterministic identity from comparison.
                if ' q ' in label: assert value['viewer']==guest['principal'],value
                if 'store_id' in value: assert value['store_id']==state['store_id'],value
                independent = {k:v for k,v in value.items() if k not in ('store_id','now','viewer')}
                records.append((label,json.dumps(independent,sort_keys=True,separators=(',',':'))))
                return value
            def mutate(name, identity, args):
                return capture(f'v{version} m {name}',http(base,'POST','/m/'+name,{'id':identity,'args':args,'store_id':state['store_id']},token))
            def query(name, args):
                return capture(f'v{version} q {name}',http(base,'POST','/q/'+name,{'args':args},token))
            if version == 1:
                assert mutate('put','ev1-a',{'key':'a','n':2,'memo':'雪\0exact','site':'https://example.com'})['state']=='sent'
                assert mutate('put','ev1-b',{'key':'b','n':1,'memo':None,'site':None})['state']=='sent'
                assert mutate('archive','ev1-z',{'key':'z','text':'retained row'})['state']=='sent'
                first = query('peek',{'key':'a'})['data']
                archived = query('archived',{'key':'z'})['data']
                assert [r['n'] for r in query('ordered',{})['data']]==[1,2]
            elif version == 2:
                changed = query('peek',{'key':'a'})['data']
                assert changed == {'id':'a','n':2,'extra':None,'count':7},changed
                assert len(query('ordered',{})['data'])==2
                assert mutate('add','ev1-new',{'key':'new','n':9})['state']=='sent'
                assert query('addedRow',{'key':'new'})['data']['n']==9
            else:
                assert query('peek',{'key':'a'})['data']==dict(first,extra=None,count=7)
                assert query('archived',{'key':'z'})['data']==archived
                assert [r['n'] for r in query('ordered',{})['data']]==[1,2]
            stop(child)
            if backend == 'postgres':
                deadline=time.monotonic()+15
                while True:
                    doctor=json.loads(cli(['doctor','--release',str(deployment),'--json'],url=target).stdout)
                    if doctor['store']['expired']: break
                    assert time.monotonic()<deadline,doctor
                    time.sleep(.1)
        transcripts[backend]=json.dumps(records,sort_keys=True,separators=(',',':')).encode()
        (work/('ev1-'+backend+'-wire.json')).write_bytes(transcripts[backend])
        print('P1-EV-1',backend,'PASS: v1 writes, v2 additions/retirements/indexes, v3 exact restoration',flush=True)
    assert transcripts['postgres']==transcripts['sqlite'], 'EV-1 wire bytes differ'
    (work/'app/snapback/schema.q').write_text(h['source'])
    print('P1-EV-1 PASS: byte-identical wire after removing store_id, now and the checked minted guest viewer',flush=True)
    large_default_witness(h, pg_url.replace('schema=ev1', 'schema=ev1_large'))


def large_default_witness(h, pg_url):
    """A restored raw parent image must widen /changes identically on both stores."""
    work, cli, start, stop, http = (h[k] for k in ('WORK','cli','start','stop','http'))
    v1 = '''use identity
table notes:
  n: int
  memo: json <=100 ?
  public
  insert <- allow
  delete <- allow
  online only
table children:
  note: notes on delete restrict
  public
  insert <- allow
  online only
mutation put(key: id):
  insert notes {id: key, n: 1}
mutation erase(key: id):
  delete notes[key]
query peek(key: id):
  return notes[key]
'''
    sibling = "  payload: text <=307200 default '" + 'x' * (300 * 1024) + "'\n"
    versions = [v1, v1.replace('  memo: json <=100 ?\n', sibling),
        v1.replace('  memo: json <=100 ?\n', '  memo: json <=100 ?\n' + sibling)]
    answers = {}
    for backend, target in [('postgres', pg_url), ('sqlite', None)]:
        deployment = work / ('ev1-large-' + backend)
        for version, source in enumerate(versions, 1):
            (work/'app/snapback/schema.q').write_text(source)
            cli(['deploy', str(deployment)] + (['--restore-dormant'] if version == 3 else []), url=target)
            child, base = start(f'ev1-large-{backend}-v{version}', target, deployment=deployment)
            guest = http(base, 'POST', '/auth/guest', {})['session']
            token = guest['token']
            state = http(base, 'GET', '/schema', token=token)
            assert state['generation'] == version, state
            def mutate(name):
                return http(base, 'POST', '/m/'+name, {'id':f'large-{name}',
                    'args':{'key':'a'}, 'store_id':state['store_id']}, token)
            if version == 1:
                assert mutate('put')['state'] == 'sent'
            else:
                row = http(base, 'POST', '/q/peek', {'args':{'key':'a'}}, token)
                assert row['data']['payload'] == 'x' * (300 * 1024)
                if version == 3:
                    assert row['data']['memo'] is None
                    assert mutate('erase')['state'] == 'sent'
                    answer = http(base, 'GET', f"/changes?since={row['seq']}&wait=0", token=token)
                    answers[backend] = {k:v for k,v in answer.items() if k not in ('store_id','now')}
                    print('P1-EV-1 300 KiB', backend, '/changes:', answers[backend], flush=True)
            stop(child)
            if backend == 'postgres':
                deadline = time.monotonic() + 15
                while True:
                    doctor = json.loads(cli(['doctor','--release',str(deployment),'--json'],url=target).stdout)
                    if doctor['store']['expired']: break
                    assert time.monotonic() < deadline, doctor
                    time.sleep(.1)
    assert answers['sqlite']['changes'] is None, answers
    assert answers['postgres'] == answers['sqlite'], '300 KiB restored parent /changes differs'
    (work/'ev1-large-changes.json').write_text(json.dumps(answers, sort_keys=True))
    (work/'app/snapback/schema.q').write_text(h['source'])
    print('P1-EV-1 PASS: 300 KiB restored parent /changes is null on both stores', flush=True)
