#!/usr/bin/env python3
"""Enter the unchanged qualified driver with bounded, graceful cancellation."""
import argparse, signal, sys
from common import *

sys.path.insert(0, str(NATIVE / 'driver'))
from run import Driver, Failure

p = argparse.ArgumentParser(); p.add_argument('--config', required=True); p.add_argument('--segment', choices=['m6', 'm8'], required=True); p.add_argument('--out', required=True)
a = p.parse_args()
def interrupted(signum, frame):
    # Let Driver.run's ordinary setup-failure path retain partial evidence and
    # stop its owned backend/runner. No source bytes or verdict rules are changed.
    signal.alarm(0)
    raise Failure('operator-interrupted-or-time-limit:' + str(signum), 'setup')
signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted); signal.signal(signal.SIGALRM, interrupted)
signal.alarm(1500)
d = Driver(read(a.config), a.segment, Path(a.out).resolve())
try:
    result = d.run(); sys.exit(1 if result['pass'] is False else 0)
finally:
    signal.alarm(0)
