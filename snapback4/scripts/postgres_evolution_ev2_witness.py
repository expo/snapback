"""Configured EV-2 deploy/serve, sharing the harness's owned PG16 and children."""
# @ref LLP 3000.009.001.000#3.5 — narrowing hides, widening restores; canonical wire and changes match SQLite.
import json, time

SOURCE = '''use identity
table notes:
  n: int
  memo: json <=100 ?
  public
  insert <- allow
  delete <- allow
  online only
table children:
  parent: notes on delete restrict
  public
  insert <- allow
  online only
mutation put(key: id, n: int, memo: json <=100 ?):
  insert notes {id: key, n, memo}
mutation child(key: id, parent: notes):
  insert children {id: key, parent}
mutation erase(key: id):
  delete notes[key]
query peek(key: id):
  return notes[key]
query childRow(key: id):
  return children[key]
query ordered():
  return notes first 100
'''


def witness(h, pg_url):
    work, cli, start, stop, http = (h[k] for k in ('WORK', 'cli', 'start', 'stop', 'http'))
    transcripts = {}
    sibling = "  payload: text <=307200 default '" + 'x' * (300 * 1024) + "'\n"
    v2 = SOURCE.replace('  n: int\n', '  n: int 0..10\n' + sibling)
    v3 = SOURCE.replace('  n: int\n', '  n: int\n' + sibling)
    for backend, target in [('postgres', pg_url), ('sqlite', None)]:
        records = []
        deployment = work / ('ev2-' + backend)
        for version, source in enumerate([SOURCE, v2, v3], 1):
            (work / 'app/snapback/schema.q').write_text(source)
            cli(['deploy', str(deployment)], url=target)
            child, base = start(f'ev2-{backend}-v{version}', target, deployment=deployment)
            guest = http(base, 'POST', '/auth/guest', {})['session']
            token = guest['token']
            state = http(base, 'GET', '/schema', token=token)
            assert state['generation'] == version, state

            def capture(label, value):
                if 'viewer' in value:
                    assert value['viewer'] == guest['principal'], value
                if 'store_id' in value:
                    assert value['store_id'] == state['store_id'], value
                independent = {k: v for k, v in value.items() if k not in ('store_id', 'now', 'viewer')}
                records.append((f'v{version} {label}', independent))
                return value

            def mutate(name, identity, args):
                return capture('m ' + name, http(base, 'POST', '/m/' + name,
                    {'id': identity, 'args': args, 'store_id': state['store_id']}, token))

            def query(name, args):
                return capture('q ' + name, http(base, 'POST', '/q/' + name, {'args': args}, token))

            if version == 1:
                for key, n in [('low', 0), ('high', 99), ('delete', 20)]:
                    assert mutate('put', 'ev2-put-' + key, {'key': key, 'n': n, 'memo': '雪\0exact'})['state'] == 'sent'
                assert mutate('child', 'ev2-child', {'key': 'c', 'parent': 'high'})['state'] == 'sent'
            notes = query('ordered', {})
            assert [r['id'] for r in notes['data']] == (['low'] if version == 2 else ['delete', 'high', 'low']), notes
            hidden = query('peek', {'key': 'high'})['data']
            descendant = query('childRow', {'key': 'c'})['data']
            assert (hidden is None and descendant is None) if version == 2 else (hidden['n'] == 99 and descendant['parent'] == 'high')
            if version == 3:
                assert hidden['payload'] == 'x' * (300 * 1024)
                assert hidden['memo'] == '雪\0exact'
                assert mutate('erase', 'ev2-erase', {'key': 'delete'})['state'] == 'sent'
                changes = capture('changes', http(base, 'GET', f"/changes?since={notes['seq']}&wait=0", token=token))
                assert changes['changes'] is None, changes
            stop(child)
            if backend == 'postgres':
                deadline = time.monotonic() + 15
                while True:
                    doctor = json.loads(cli(['doctor', '--release', str(deployment), '--json'], url=target).stdout)
                    if doctor['store']['expired']:
                        break
                    assert time.monotonic() < deadline, doctor
                    time.sleep(.1)
        transcripts[backend] = json.dumps(records, sort_keys=True, separators=(',', ':')).encode()
        (work / ('ev2-' + backend + '-wire.json')).write_bytes(transcripts[backend])
        print('P1-EV-2', backend, 'PASS: v1 writes → v2 hidden parent/child → v3 restored; 300 KiB /changes unknown', flush=True)
    assert transcripts['postgres'] == transcripts['sqlite'], 'EV-2 canonical wire bytes differ'
    (work / 'app/snapback/schema.q').write_text(h['source'])
    print('P1-EV-2 PASS: byte-identical wire and meters,', len(transcripts['sqlite']), 'bytes', flush=True)
