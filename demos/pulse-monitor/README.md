# pulse-monitor

`pulse-monitor` is a headless service-health board. A demand-gated cron job
runs an action, which invokes the single durable mutation that updates the
live service row.

Run:

```sh
node packages/snapback-codegen/index.mjs demos/pulse-monitor/snapback
node demos/pulse-monitor/tests/acceptance/headless.mjs
```

The probe is deterministic and local. This demo does not claim external
monitoring, retry queues, or hosted scheduler support.
