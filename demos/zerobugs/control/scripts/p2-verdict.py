#!/usr/bin/env python3
# Supervisor-side H-3 verdict extraction over analyze-oq4 output (LLP 0200 Phase 2).
# Usage: bun scripts/analyze-oq4.mts <arms...> | python3 scripts/p2-verdict.py
import sys, json

text = sys.stdin.read()
data = json.loads(text.split('\n\n## OQ4')[0])
for arm in data['arms']:
    name = arm['arm']
    s = arm['settlementByEffect']
    trig = s['trigger']
    led = arm['frameLedgerReconciliation']['clientLedger']['authorizationBoundaryCallbacksByKind']
    ev = arm['evaluations']['durationMs']
    auth = arm.get('authorityLane') or {}
    evp50 = ev.get('p50')
    floor = 6 * evp50 if evp50 is not None else None
    conv_last = trig['lastObserverConvergenceMs']['p50']
    conv_first = trig['firstObserverConvergenceMs']['p50']
    print(f"== {name}")
    print(f"  settle p50 trigger/non: {trig['clientSettleLatencyMs']['p50']} / {s['non-trigger']['clientSettleLatencyMs']['p50']}")
    print(f"  eval p50: {evp50}  serial floor (6x): {floor}")
    print(f"  convergence p50 first/last: {conv_first} / {conv_last}"
          + (f"  -> last<floor: {conv_last is not None and floor is not None and conv_last < floor}" if floor else ""))
    print(f"  boundary callbacks: {led}")
    print(f"  quarantine callbacks: {led.get('authorization_quarantine', 0)}")
    if auth.get('fenceAppliedEvents'):
        print(f"  fence applied events: {auth['fenceAppliedEvents']}  latency: {auth['fenceAppliedLatencyMs']}")
        print(f"  restorations: {auth['restorationsObserved']}  latency: {auth['restorationLatencyMs']}")
        print(f"  unrestored fences: {auth['unrestoredFences']}  stale discards: {auth['staleAuthorityFrameDiscards']}")
        print(f"  client authority transitions: {auth['clientAuthorityTransitions']}")
