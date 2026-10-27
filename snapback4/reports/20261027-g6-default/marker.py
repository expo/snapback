#!/usr/bin/env python3
"""Probe existing binary guards on a stopped, caller-owned scratch deployment.

This deliberately does NOT activate a grant. It installs each proposed marker,
checks exact refusal and unchanged application head, then restores the store in
finally. The caller must supply a private cluster and a g6d_cost_* namespace
created by measure.py; arbitrary production namespaces are refused.
"""
# @ref LLP 3000.009.001.000.002#4.2 — compatibility must use checks old binaries already perform.
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bin', type=Path, required=True)
    ap.add_argument('--psql', required=True)
    ap.add_argument('--socket', required=True)
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--deployment', type=Path, required=True)
    ap.add_argument('--namespace', required=True)
    ap.add_argument('--user', default='g6d')
    args = ap.parse_args()
    ns = args.namespace
    assert re.fullmatch(r'g6d_cost_[0-9]+_[0-9]+', ns)
    assert args.port >= 55600 and args.port != 55440
    conn = f'host={args.socket} port={args.port} user={args.user} dbname=postgres'
    def sql(s):
        return subprocess.check_output([args.psql, conn, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', s], text=True).strip()
    # Do not mutate a live owner's namespace. No backend is killed by this script.
    assert sql(f"SELECT count(*) FROM {ns}._owner WHERE lease_until>clock_timestamp()") == '0'
    assert sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sb:' || (SELECT value FROM {ns}._meta WHERE key='store_id') || ':%'") == '0'
    original = sql(f'SELECT version FROM {ns}._backend WHERE singleton')
    assert original == 'snapback4-postgres-evaluation-3'
    head = sql(f'SELECT seq FROM {ns}._head WHERE singleton')
    result = []
    env = {k: v for k, v in os.environ.items() if not k.startswith('SNAPBACK4_')}
    env['SNAPBACK4_STORE_URL'] = f'postgres://{args.user}@/postgres?host={urllib.parse.quote(args.socket,safe="")}&port={args.port}&schema={ns}&ha=none'
    scratch = Path(tempfile.mkdtemp(prefix='sb4-g6d-marker-'))
    for marker in ('version', 'owner-shape'):
        token = sql(f'SELECT token FROM {ns}._owner WHERE singleton')
        try:
            if marker == 'version':
                sql(f"UPDATE {ns}._backend SET version='snapback4-postgres-read-grant-1' WHERE singleton")
            else:
                sql(f"BEGIN; ALTER TABLE {ns}._owner ADD COLUMN read_protocol text COLLATE \"C\"; UPDATE {ns}._owner SET read_protocol='g6-v1'; ALTER TABLE {ns}._owner ALTER COLUMN read_protocol SET NOT NULL; COMMIT")
            child = subprocess.Popen([str(args.bin.resolve()), 'serve', str(args.deployment.resolve()),
                                      '--worker-state-dir', str(scratch / 'workers'), '--port', '0'],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                stdout, stderr = child.communicate(timeout=20)
            except subprocess.TimeoutExpired:
                child.terminate()
                try:
                    child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.communicate()
                raise AssertionError('marker failed to stop startup')
            assert child.returncode != 0, marker
            reason = 'opening' if marker == 'version' else 'unexpected column set'
            assert reason in stderr, (marker, stderr)
            assert sql(f'SELECT seq FROM {ns}._head WHERE singleton') == head
            token_unchanged = sql(f'SELECT token FROM {ns}._owner WHERE singleton') == token
            if marker == 'owner-shape':
                assert token_unchanged, 'must refuse before owner acquisition'
            result.append({'marker': marker, 'refused': True, 'reason': reason,
                           'application_head_unchanged': True, 'token_unchanged': token_unchanged,
                           'pid': child.pid, 'reaped': child.poll() is not None})
        finally:
            sql(f"BEGIN; UPDATE {ns}._backend SET version='{original}' WHERE singleton; ALTER TABLE {ns}._owner DROP COLUMN IF EXISTS read_protocol; COMMIT")
        time.sleep(.1)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
