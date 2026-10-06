#!/usr/bin/env python3
"""Run on the mini after copying harness + components. Does not seal or launch."""
import json, shutil, subprocess
from common import *
from render import main as render

host_check()
builder = ROOT / 'inputs/builder'; builder.mkdir()
shutil.copytree(WEB, builder / 'web')
(builder / 'native').mkdir()
for name in ['CONTRACT.md', 'builder-prompt.md', 'helper', 'ui', 'schemas']:
    src = NATIVE / name; dst = builder / 'native' / name
    if src.is_dir(): shutil.copytree(src, dst)
    else: shutil.copyfile(src, dst)
for name in ['ENVIRONMENT.md', 'OPERATOR-INTERFACE.md']:
    shutil.copyfile(ROOT / 'prompts' / name, builder / name)
shutil.copyfile(ROOT / 'scripts/boundary.py', builder / 'boundary.py')
helper = {str(p.relative_to(NATIVE / 'helper')): {'bytes': p.stat().st_size, 'sha256': sha(p)}
          for p in (NATIVE / 'helper').rglob('*') if p.is_file()}
put(builder / 'AID.json', {'seriesBreak': '0.3.8-m8 -> 0.4.0-native.1', 'identicalForBothBackends': True,
                        'helperBytes': sum(x['bytes'] for x in helper.values()), 'helperFiles': helper,
                        'authoringCharged': ['orientation', 'helper integration', 'stable IDs', 'fixture seed', 'oracle mapping'],
                        'referenceAppProvided': False})
for b in BACKENDS:
    lane = ROOT / 'lanes' / b; lane.mkdir(parents=True)
    (lane / 'instrument').symlink_to(builder)
for name in ['logs', 'results', 'attempts', 'runtime', 'metadata']: (ROOT / name).mkdir(exist_ok=True)
put(ROOT / 'metadata/caps.json', {'source': 'LLP 0201 D7 / LLP 0201.000 Phase 2', 'model': 'gpt-6-astra',
   'effort': 'medium', 'milestones': list(MILESTONES), 'wallSecondsPerMilestone': 14400,
   'tokensPerMilestone': 2000000,
   'tokenBasis': 'non-cached input + output; reasoning included in output',
   'cacheReadCapped': False, 'cacheWriteCapped': False, 'interpretation': 'lead ruling 2026-10-05; REVISION-2.md', 'replayWallSeconds': 14400,
   'operatorClockSeparate': True, 'setupReruns': 1, 'productRetries': 0, 'scoredUse': False})
render()
print('assembled; collect metadata and seal before verification')
