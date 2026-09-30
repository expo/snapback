#!/usr/bin/env python3
"""Call the final native core's C ABI directly; no device subprocess or pipe.

Arguments: shared library, captured opening JSON, captured request JSONL, fresh DB.
This includes Rust JSON decoding; typed replay.rs measures apply separately.
"""
import ctypes, hashlib, json, re, resource, sys, time
from pathlib import Path
library, backend, requests, database = map(Path, sys.argv[1:])
assert not database.exists(), 'use a fresh store'
lib = ctypes.CDLL(str(library.resolve()))
lib.sb4_open.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
lib.sb4_open.restype = ctypes.c_void_p
lib.sb4_call.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.sb4_call.restype = ctypes.c_void_p
lib.sb4_free.argtypes = [ctypes.c_void_p]
lib.sb4_close.argtypes = [ctypes.c_void_p]
device = lib.sb4_open(str(database.resolve()).encode(), backend.read_bytes())
assert device, 'opening failed'
started = time.monotonic_ns()
samples = []
try:
    with requests.open('rb') as stream:
        for seq, request in enumerate(stream):
            op = re.search(rb'"op":"([^"]+)"', request[:100]).group(1).decode()
            at = time.monotonic_ns()
            answer = lib.sb4_call(device, request)
            elapsed = (time.monotonic_ns()-at)/1e6
            result = json.loads(ctypes.string_at(answer)); lib.sb4_free(answer)
            assert 'denied' not in result, (seq, op, result)
            sample = {'seq':seq,'op':op,'ms':elapsed,'bytes':len(request)}
            if op == 'apply': sample['published'] = result['ok']['published']
            if op == 'witness_coverage':
                sample['coverageSha256'] = hashlib.sha256(json.dumps([result],sort_keys=True,separators=(',',':')).encode()).hexdigest()
            samples.append(sample)
finally:
    lib.sb4_close(device)
print(json.dumps({'wallMs':(time.monotonic_ns()-started)/1e6,
    'applyMs':sum(s['ms'] for s in samples if s['op']=='apply'),
    'maxRssKiBIncludingPython':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'samples':samples},indent=2))
