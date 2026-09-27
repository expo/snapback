"""Run after the full suite's guide target, so no other guide reader sees mutants."""
import json
from pathlib import Path
import subprocess
import os

root = Path(__file__).resolve().parents[4]
sb4 = root / 'snapback4'
path = root / 'llp/3000.025-expiring-mutation-read-prefix.rfc.md'
logdir = sb4 / 'target/lane-dc-round13'
original = path.read_bytes()
before = subprocess.check_output(['git', 'show', 'a91f8f9d9:llp/3000.025-expiring-mutation-read-prefix.rfc.md'], cwd=root).decode()
current = original.decode()
env = dict(os.environ, CARGO_INCREMENTAL='0', CARGO_BUILD_JOBS='8', CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0')
command = ['cargo', 'test', '-p', 'snapback4-lang', '--test', 'guide', 'delivery_bound_rfc_acceptance_requires_start_only_recovery', '--', '--exact']
# The guide target's module prefixes the test; use its full name.
command[-3] = 'definitions::delivery_bound_rfc_acceptance_requires_start_only_recovery'
results = []
def section(text, number):
    start = text.index(f'\n## {number}. ')
    end = text.find('\n## ', start + 1)
    return start, len(text) if end < 0 else end
try:
    for number in [5, 6, 7]:
        start, end = section(current, number)
        old_start, old_end = section(before, number)
        for kind in ['revert', 'append']:
            body = before[old_start:old_end] if kind == 'revert' else current[start:end] + '\nFor delivery, use a fresh id without restart.\n'
            path.write_text(current[:start] + body + current[end:])
            result = subprocess.run(command, cwd=sb4, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            logfile = logdir / f'guide-mutant-{number}-{kind}.log'
            logfile.write_text(result.stdout)
            assert result.returncode != 0 and f'LLP 3000.025 §{number}:' in result.stdout, result.stdout
            results.append({'section': number, 'mutation': kind, 'exit': result.returncode, 'log': logfile.name})
finally:
    path.write_bytes(original)
assert path.read_bytes() == original
(logdir / 'guide-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
