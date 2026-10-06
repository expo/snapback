#!/usr/bin/env python3
"""Qualified Driver.preflight only, with a deliberately absent app. No run()."""
import sys, uuid
from common import *

host_check()
sys.path.insert(0, str(NATIVE / 'driver'))
from run import Driver

attempt = ROOT / 'preparation' / ('no-app-' + str(uuid.uuid4())); attempt.mkdir()
config = {'instrument': read(NATIVE / 'QUALIFIED.json')['instrument'], 'udid': UDID,
          'app': str(attempt / 'deliberately-absent.app'), 'bundleId': 'dev.clique.pilot.empty',
          'origin': 'http://127.0.0.1:49589', 'backendArgv': ['/usr/bin/false'], 'backendCwd': str(attempt)}
put(attempt / 'config.json', config)
driver = Driver(config, 'm6', attempt / 'evidence')
result = {'pass': None, 'outcomeClass': 'setup', 'scope': 'Driver.preflight only; no builder, build or Driver.run',
          'scoredUse': False, 'expected': 'unmeasured', 'udid': UDID}
try:
    driver.preflight()
    raise RuntimeError('unexpected-preflight-success')
except FileNotFoundError as e:
    if str(attempt / 'deliberately-absent.app') not in str(e): raise
    result['reason'] = 'unmeasured:no-app'; result['diagnostic'] = str(e)
except Exception as e:
    if getattr(e, 'reason', '').startswith('unavailable-simulator:'):
        result['reason'] = e.reason
    else: raise
finally:
    if any([driver.backend, driver.runner, driver.video, driver.bridge]):
        raise RuntimeError('no-app-preflight-started-a-process')
    driver.cleanup()
put(attempt / 'result.json', result)
print(json.dumps({'attempt': str(attempt), **result}))
