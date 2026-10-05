#!/usr/bin/env python3
"""Bounded NP2 scratch process custody. Run only in the named /tmp copy."""
import datetime
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

ROOT = Path('/tmp/np2-native-protocol-20261004')
UDID = '3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B'
os.chdir(ROOT)
os.environ['DEVELOPER_DIR'] = '/Applications/Xcode.app/Contents/Developer'


def birth(pid):
    return subprocess.run(['ps', '-p', str(pid), '-o', 'lstart='], capture_output=True, text=True).stdout.strip()


def event(name, **details):
    with open('host-events.jsonl', 'a') as f:
        f.write(json.dumps({'event': name, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **details}) + '\n')


def reachable():
    try:
        with socket.create_connection(('127.0.0.1', 49481), timeout=1):
            return True
    except OSError:
        return False


kind = sys.argv[1]
if kind in ('start', 'record'):
    name = 'backend' if kind == 'start' else 'video'
    if kind == 'start' and reachable():
        raise SystemExit('Refuse: scratch port already occupied')
    command = ([str(ROOT / 'app/node_modules/snapback4-darwin-arm64/snapback4'), 'dev', '--port', '49481']
               if kind == 'start' else ['xcrun', 'simctl', 'io', UDID, 'recordVideo', '--codec', 'h264', str(ROOT / 'prototype-screen.mp4')])
    record = Path(name + '-process.json')
    if record.exists():
        raise SystemExit('Refuse: existing custody record')
    with open(name + '.log', 'a') as output:
        child = subprocess.Popen(command, cwd=ROOT / 'app', stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    identity = birth(child.pid)
    record.write_text(json.dumps({'pid': child.pid, 'birth': identity, 'argv': command}))
    event(kind, pid=child.pid, birth=identity, argv=command)
    if kind == 'start':
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and not reachable() and child.poll() is None:
            time.sleep(.2)
        if not reachable():
            raise SystemExit('Backend failed; inspect backend.log and retain custody record')
elif kind in ('stop', 'stop-record'):
    name = 'backend' if kind == 'stop' else 'video'
    record = Path(name + '-process.json')
    owned = json.loads(record.read_text())
    actual = birth(owned['pid'])
    if actual and actual != owned['birth']:
        raise SystemExit('Refuse: process identity changed')
    if actual:
        os.kill(owned['pid'], signal.SIGTERM if kind == 'stop' else signal.SIGINT)
    deadline = time.monotonic() + 15
    while birth(owned['pid']) and time.monotonic() < deadline:
        time.sleep(.2)
    if birth(owned['pid']):
        raise SystemExit('Owned process did not exit; retain custody record')
    event(kind, pid=owned['pid'], processAbsent=True, backendReachable=reachable())
    record.unlink()
elif kind == 'offline':
    result = subprocess.run(['xcrun', 'simctl', 'spawn', UDID, 'launchctl', 'list'], capture_output=True, text=True, check=True)
    lines = [line for line in result.stdout.splitlines() if 'dev.snapback.np2.cal30' in line]
    event('offline-check', backendReachable=reachable(), appLaunchctlRows=lines)
    if reachable() or any(line.split()[0] != '-' for line in lines):
        raise SystemExit('Offline/cold precondition failed')
else:
    raise SystemExit('start | stop | record | stop-record | offline')
