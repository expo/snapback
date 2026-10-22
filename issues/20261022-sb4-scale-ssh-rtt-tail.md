# Investigate the 40 ms SSH-path RTT tail in S1-PG2

**Status:** Open
**Scope:** Snapback 4 scale experiment transport; not a confirmed product defect
**Date:** 2026-10-22

The S1-PG2 natural-link prepared `SELECT 1` p50 stays near 0.6 ms, but p99
changes after a fresh SSH tunnel. Before natural W1/W2, p99 is 1.028/0.916 ms.
The later tunnel's pre-cell W3/W4/W5-shared captures have p99
41.183/41.215/41.503 ms, with p50 0.637/0.630/0.609 ms. These are native
database pings; Snapback is absent from the ping path. Historical S1-FR
raw-PG token captures have median natural p99 0.762 ms.

This limits attribution of S1-PG2's write-SLO failures and comparison with
the historical controls. Counts still establish the 57-exchange own-counter
and 60-exchange shared-counter paths, but multiplying the median ping by
the count misses tail amplification. A recurring 40 ms wait may be a TCP/SSH
interaction; that cause is a hypothesis, not established by these captures.
No product, cluster or TCP setting was changed to hide the tail.

Evidence and eventual archive pointer:
[S1-PG2 report](../snapback4/experiments/scale-controls/results-20261022-snapback-postgres-2/README.md),
its `rtt.json`, and the raw per-cell `rtt-before.json` / `rtt-after.json`.
The first transport and its completed W1/W2 cells remain retained separately
from the restarted transport and later cells.

Minimal transport-only probe, with an already provisioned **owned** database,
role and tunnel (credentials are read privately, never placed in argv):

```sh
export SCALE_PASSWORD_FILE="$HOME/sb4scale/pw"
export SCALE_DB_USER=s1pg2_app SCALE_DATABASE=sb4_snapback_s1pg2
setsid nohup taskset -c 0-2,6-8 target/release/sb4-scale-controls ping-unix \
  --socket-dir target/p3/s > target/rtt-tail.stdout 2> target/rtt-tail.stderr < /dev/null &
probe_pid=$!
echo "$probe_pid" > target/rtt-tail.pid
```

The S1 lane drops that database/role at completion; reproduce with a fresh owned
fixture, not by recreating or changing the shared cluster. Run one probe at a
time and retain all fresh-tunnel repetitions rather than selecting a fast one.

Next investigation: capture full RTT histograms/means, compare several fresh
SSH connections, separate SSH transport from the loopback TCP leg on 450a,
and compare the synchronous/async driver and message shapes. Investigate
packet/coalescing or scheduling causes before prescribing a TCP option.
Repeat claim-relevant latency cells after matching the transport distribution;
the current ledger remains exploratory and makes no isolated-interpreter or
production-capacity claim.
