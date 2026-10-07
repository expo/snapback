#!/usr/bin/env python3
"""Astra's production_scale workload, recreated in an isolated directory.
Usage: python3 benchmark.py /absolute/path/target/production/snapback4 out.json
Derived from dk-r0.astra.evidence/{probes,extra,production_scale}.py.
Only processes started here are stopped; no existing stores are read or changed.
"""
import base64, hashlib, io, json, os, pathlib, selectors, sqlite3
import subprocess, sys, tarfile, tempfile, time, urllib.error, urllib.request

NEW = str(pathlib.Path(sys.argv[1]).resolve())
OUT = pathlib.Path(sys.argv[2]).resolve()
BASE = pathlib.Path(tempfile.mkdtemp(prefix='dk-r1-benchmark-'))
OLD = str(BASE / 'published/package/snapback4')
URL = 'https://registry.npmjs.org/snapback4-linux-x64/-/snapback4-linux-x64-0.4.14.tgz'
SRI = 'Krx8cJCwCAuT4vDjNKCHD2MRd8xcqIuuHnFiGRrjUlcBNpJUzhaoQC6BjggtaD/mXp7j3/z6GAVJ5xdLoEJH6w=='
archive = urllib.request.urlopen(URL).read()
assert base64.b64encode(hashlib.sha512(archive).digest()).decode() == SRI
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    tar.extractall(BASE / 'published', filter='data')
ENV = dict(os.environ, TMPDIR=str(BASE / 'tmp'))
(BASE / 'tmp').mkdir()
SOURCE = '''use identity
use personas alice
use server
table notes:
  at: time
  body: text <=10000
  public
  insert <- allow
  delete <- allow
  online only
query list():
  return notes first 10 by .id
query who():
  return viewer
mutation add(at: time, body: text <=10000):
  return insert notes {at, body}
mutation drop(id: notes):
  delete notes[id]
action work()
'''
D = BASE / 'scale'
(D / 'snapback').mkdir(parents=True)
(D / 'snapback/schema.q').write_text(SOURCE)

class Host:
    def __init__(self, binary):
        self.log = (D / 'stderr.log').open('w')
        start = time.perf_counter()
        self.p = subprocess.Popen([binary, 'dev', '--no-watch', '--hold-schedules', '--port', '0'],
            cwd=D, env=ENV, stdout=subprocess.PIPE, stderr=self.log, text=True)
        try:
            with selectors.DefaultSelector() as sel:
                sel.register(self.p.stdout, selectors.EVENT_READ)
                assert sel.select(90), 'startup timed out'
                self.url = self.p.stdout.readline().strip()
            self.ms = (time.perf_counter() - start) * 1000
            assert self.url.startswith('http://'), (D / 'stderr.log').read_text()
        except BaseException:
            self.stop()
            raise
    def request(self, path, body=None, persona=False):
        headers = {'Content-Type': 'application/json'}
        if persona: headers['x-snapback-persona'] = 'alice'
        request = urllib.request.Request(self.url + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers)
        try: response = urllib.request.urlopen(request, timeout=90)
        except urllib.error.HTTPError as error: response = error
        with response: return json.loads(response.read())
    def stop(self):
        if self.p.poll() is None: self.p.terminate()
        self.p.wait(10)
        self.log.close()
    def __enter__(self): return self
    def __exit__(self, *_): self.stop()

def database(query):
    with sqlite3.connect(D / '.snapback4/store.sqlite') as conn:
        return conn.execute(query).fetchall()

def measure(label):
    records = []
    for i in range(5):
        for binary, name in [(OLD, 'published-0.4.14'), (NEW, 'dk-round1-production')]:
            with Host(binary) as host:
                row = {'binary': name, 'iteration': i, 'startup_ms': host.ms}
                if binary == NEW:
                    start = time.perf_counter()
                    row['clock_status'] = host.request('/dev/clock/status')
                    row['clock_status_ms'] = (time.perf_counter() - start) * 1000
                    row['startup_note'] = (D / 'stderr.log').read_text()
                    start = time.perf_counter()
                    doctor = subprocess.run([NEW, 'doctor', '--json'], cwd=D, env=ENV,
                        text=True, capture_output=True, timeout=120)
                    row['doctor_ms'] = (time.perf_counter() - start) * 1000
                    row['doctor_exit'] = doctor.returncode
                    assert doctor.returncode == 0, doctor.stderr
                records.append(row)
    result[label] = records
    OUT.write_text(json.dumps(result, indent=2))
    print(label, json.dumps(records), flush=True)

result = {'scratch': str(BASE), 'profile': 'production; LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT',
    'published_tarball': URL, 'published_integrity': 'sha512-' + SRI,
    'binaries': {name: hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest()
        for binary, name in [(OLD, 'published-0.4.14'), (NEW, 'dk-round1-production')]}}
# Create the store with the published binary: all indexes and commits are valid,
# and baseline SQLite schema can be compared with the development build.
with Host(OLD) as host:
    start = time.monotonic()
    for j in range(0, 100000, 1000):
        rows = [{'table': 'notes', 'row': {'id': f'n{i:09d}', 'at': int(time.time()*1000), 'body': 'x'*8192}}
            for i in range(j, j+1000)]
        assert host.request('/seed', rows)['seeded'] == 1000
    result['seed_seconds'] = time.monotonic() - start
schema_before = database('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
measure('normal_clock_runs')
with Host(NEW) as host:
    host.request('/dev/clock/advance', {'duration': '25h'})
    sent = host.request('/m/add', {'id': 'offset-row', 'args': {'at': int(time.time()*1000)+90000000, 'body': 'future'}}, True)
    assert sent.get('state') == 'sent', sent
result['rows'] = database('SELECT count(*) FROM r')[0][0]
result['file_bytes'] = (D / '.snapback4/store.sqlite').stat().st_size
assert result['rows'] == 100001
measure('future_commit_runs')
result['sqlite_schema_unchanged'] = schema_before == database('SELECT type,name,sql FROM sqlite_schema ORDER BY name')
assert result['sqlite_schema_unchanged']
OUT.write_text(json.dumps(result, indent=2))
print('complete', OUT, flush=True)
