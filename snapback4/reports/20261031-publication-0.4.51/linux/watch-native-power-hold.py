#!/usr/bin/env python3
"""Observe AC at ten-minute intervals; never start, stop or qualify a build."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import json, re, subprocess, time

k = Path.home() / 'sb4-pub-0451-kit'
r = Path.home() / 'sb4-pub-0451-records'
p = r / 'power-hold-native-a1.json'
source = (k / 'source.sha').read_text().strip()
remote = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
          'ccheever@charlies-macbook-pro-m5max-black',
          'date -u +%FT%TZ; pmset -g batt; ioreg -r -k AppleClamshellState | grep AppleClamshellState; df -h ~/sb4-pub-0444-wt; sysctl -n vm.loadavg']

while True:
    state = json.loads(p.read_text())
    due = datetime.fromisoformat(state['nextPowerCheck'])
    while (remaining := (due - datetime.now(timezone.utc)).total_seconds()) > 0:
        time.sleep(min(60, remaining))
    number = len(state.get('checks', [])) + 1
    now = datetime.now(timezone.utc)
    try:
        result = subprocess.run(remote, capture_output=True, text=True, timeout=45)
        output = result.stdout + result.stderr
        valid = result.returncode == 0 and ("AC Power" in output or "Battery Power" in output)
    except subprocess.TimeoutExpired:
        output, valid = 'SSH power observation timed out\n', False
    evidence = f'power-hold-native-a1-check-{number}.log'
    (r / evidence).write_text(output)
    ac = valid and "Now drawing from 'AC Power'" in output
    lid = valid and '"AppleClamshellState" = No' in output
    percent = re.search(r'(\d+)%;', output)
    entry = {'at': now.isoformat(), 'power': 'AC' if ac else 'battery' if valid else 'unavailable',
             'percent': int(percent.group(1)) if percent else None,
             'lid': 'open' if lid else 'closed-or-unavailable', 'evidence': evidence, 'source': source}
    state.setdefault('checks', []).append(entry)
    state['nextPowerCheck'] = (now + timedelta(minutes=10)).isoformat()
    p.write_text(json.dumps(state, indent=2) + '\n')
    message = f'POWER HOLD check{number}: {entry["power"]}, battery={entry["percent"]}%, lid={entry["lid"]}; observation {evidence}. No build/upload started.'
    subprocess.run(['python3', str(k / 'log-status.py'), message], check=True)
    if ac and lid:
        (r / 'power-hold-native-a1-restored.json').write_text(json.dumps(entry, indent=2) + '\n')
        break
