# snapback2 test wedges at ~98% CPU when seeds populate rule-restricted tables

**Opened:** 2026-08-31 · **Systems:** snapback2 test runner
**Status:** reported by the Quarry benchmark lane (9+ min spin, killed); not independently re-verified.

With seed rows present in rule-restricted tables, `snapback2 test` spun at
~98% CPU for 9+ minutes and had to be killed. Likely the derived battery
re-evaluating rules pathologically. Repro: the Quarry lane's app
(spikes/clique-diagnostic-runs/quarry-lane) + its seed.
