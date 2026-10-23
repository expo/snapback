"""EV-1 public release witness, using the serving harness's owned cluster/children."""
# @ref LLP 3000.009.001.000#3.5 — configured deploy/serve and a store-independent wire comparison.
import json, time

V1 = '''use identity
table notes:
  n: int
  memo: json <=100 ?
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
mutation put(key: id, n: int, memo: json <=100 ?):
  upsert notes[key] {n, memo}
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

def witness(h, pg_url):
    work, cli, start, stop, http = (h[k] for k in ('WORK','cli','start','stop','http'))
    transcripts = {}
    for backend, target in [('postgres', pg_url), ('sqlite', None)]:
        deployment = work / ('ev1-' + backend)
        records = []
        for version, source in [(1,V1),(2,V2),(3,V1)]:
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
                assert mutate('put','ev1-a',{'key':'a','n':2,'memo':'雪\0exact'})['state']=='sent'
                assert mutate('put','ev1-b',{'key':'b','n':1,'memo':None})['state']=='sent'
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
                assert query('peek',{'key':'a'})['data']==first
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
