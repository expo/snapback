#!/usr/bin/env python3
"""Replay-sized HTTP empty-read burst; no credentials or application rows.

Usage: replay.py BINARY OUTPUT_PREFIX [COUNT=55210]
Linux /proc counters include all host threads. Socket writes are included;
the before/after difference and console/record counts attribute diagnostic I/O.
"""
import gzip
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

binary = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
count = int(sys.argv[3]) if len(sys.argv) > 3 else 55210
source = """use personas alice
table rows:
  owner: principal
  read <- .owner = viewer
  online only
query empty():
  return rows first 5 by .id
query point():
  return rows['absent']
query composed():
  return {outer: {row: rows['absent']}}
"""

def counters(pid):
    io = {key: int(value) for key, value in (line.split(':') for line in Path(f'/proc/{pid}/io').read_text().splitlines())}
    stat = Path(f'/proc/{pid}/stat').read_text().split(') ')[1].split()
    io['cpu_ticks'] = int(stat[11]) + int(stat[12])
    return io

with tempfile.TemporaryDirectory(prefix='sb4-dx-burst-') as tmp:
    root = Path(tmp)
    (root / 'snapback').mkdir()
    (root / 'snapback/schema.q').write_text(source)
    with (root / 'stderr').open('wb') as err:
        host = subprocess.Popen([str(binary), 'dev', '--fresh', '--no-watch', '--port', '0'], cwd=root, stdout=subprocess.PIPE, stderr=err)
        try:
            url = host.stdout.readline().decode().strip()
            assert url.startswith('http://'), (url, (root / 'stderr').read_text())
            address = url.removeprefix('http://')
            before = counters(host.pid)
            start = time.perf_counter()
            times = []
            for i in range(count):
                op = ['empty', 'point', 'composed'][i % 3]
                connection = http.client.HTTPConnection(address, timeout=15)
                tick = time.perf_counter_ns()
                connection.request('POST', '/q/' + op, '{}', {'x-snapback-persona': 'alice', 'Connection': 'close'})
                response = connection.getresponse()
                body = json.loads(response.read())
                times.append((time.perf_counter_ns() - tick) / 1e6)
                connection.close()
                assert response.status == 200 and body['data'] == [[], None, {'outer': {'row': None}}][i % 3], body
            wall = time.perf_counter() - start
            # Let eventual persistence and the one-second console window finish.
            time.sleep(1.2)
            after = counters(host.pid)
            path, = root.glob('.snapback4/dev-refusals/*/*.json')
            envelope = json.loads(path.read_text())
            stderr = (root / 'stderr').read_bytes()
            lines = stderr.splitlines()
            refusal_lines = [line for line in lines if line.startswith(b'dev refusal:')]
            times.sort()
            result = {
                'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
                'count': count, 'wall_seconds': wall,
                'latency_ms': {p: times[int((len(times)-1)*q)] for p, q in [('p50', .5), ('p95', .95), ('p99', .99)]},
                'request_ms_sum': sum(times), 'proc_io_delta': {key: after[key]-before[key] for key in before},
                'clock_ticks_per_second': os.sysconf('SC_CLK_TCK'),
                'console_lines': len(refusal_lines), 'console_bytes': sum(len(line)+1 for line in refusal_lines),
                'stored_records': len(envelope['records']), 'dropped': envelope['dropped'],
                'latest_sequence': envelope['records'][-1]['responseSequence'] if envelope['records'] else 0,
                'watermark': int.from_bytes(path.with_suffix('.watermark').read_bytes(), sys.byteorder),
                'host_load_end': os.getloadavg(), 'source': source,
            }
            output.with_suffix('.json').write_text(json.dumps(result, indent=2) + '\n')
            output.with_suffix('.stderr.gz').write_bytes(gzip.compress(stderr, mtime=0))
            print(json.dumps(result))
        finally:
            host.kill()
            host.wait()
