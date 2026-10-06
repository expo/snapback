#!/usr/bin/env python3
"""Read-only post-run packet, custody, lease and installation checks on mini."""
import sys
sys.path.insert(0, str(__import__('pathlib').Path(sys.argv[1]) / 'scripts'))
from common import *
from verify import verify
import derived_data

host_check()
lease = lock('authoring-or-operator.lock')
sim = open('/tmp/clique-native-' + UDID + '.lock', 'a')
fcntl.flock(sim, fcntl.LOCK_EX | fcntl.LOCK_NB)
value = dict(at=time.time(), label='diagnostic: operator-patched seed body format; audit-refused; never admissible; no pass claimed',
             packet=verify(ready=True), packetSha256=sha(ROOT / 'PACKET.sha256'),
             exclusiveOperatorAndSimulatorLeases=True, lanes={})
try:
    for backend in ('convex', 'snapback4'):
        free_ports(backend)
        original = ROOT / 'results' / backend / 'attempt-01'
        attempt = ROOT / 'results' / backend / 'diagnostic-round7-operator-patched-seed-setup-repair'
        lane_equal = inventory(ROOT / 'lanes' / backend) == read(original / 'custody.before.json')
        custody_equal = inventory(ROOT / 'attempts' / (backend + '-builder-completed')) == read(original / 'custody.clone.json')
        probe = subprocess.run(['xcrun', 'simctl', 'get_app_container', UDID, 'dev.clique.pilot.' + backend, 'app'], capture_output=True)
        value['lanes'][backend] = dict(builderLaneUnchanged=lane_equal, custodyUnchanged=custody_equal,
                                      allAssignedPortsFree=True, installationAbsent=probe.returncode != 0,
                                      summarySha256=sha(attempt / 'summary.json'))
        if not lane_equal or not custody_equal or probe.returncode == 0:
            raise RuntimeError('closeout-failed:' + backend)
    value['manifestSandboxPreference'] = derived_data.manifest_setting()
    value['originalPreferenceRestored'] = value['manifestSandboxPreference'] is None
    if not value['originalPreferenceRestored']: raise RuntimeError('preference-not-restored')
    value['qualifiedRunner'] = runner_config()
    value['complete'] = True
finally:
    put(ROOT / 'preparation/round7/closeout.json', value)
    sim.close()
    lease.close()
print(json.dumps(value))
