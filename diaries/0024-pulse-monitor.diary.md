# 0024 — Pulse Monitor cron and live-demand workout

## 2026-07-27 — scheduler to action to mutation to live query

Pulse Monitor declares a `WhileLive` cron job. With the scheduler disabled for
determinism, acceptance proves inactive-without-demand, armed-with-demand,
action-to-mutation delivery, a trusted probe timestamp, and disarming after
unsubscribe.

### What felt good

- `cronDisabled: true` plus the admin tick seam made scheduler behavior
  deterministic without weakening the action/mutation boundary.
- Demand activation followed the live subscription automatically. The app did
  not maintain watcher counts.
- The action reused an ordinary mutation for the durable effect, so live
  delivery and transactional behavior needed no scheduler-specific code.

### What felt bad or surprising

- The cron guide said public `GET /inspect` exposed per-job activation and run
  ledgers. The implementation intentionally redacts those fields from the
  public projection; only the admin twin contains them.
- The initial test therefore observed an empty activation string even though
  the scheduler path itself worked.

The guide now names the public aggregate/admin detail split, and the shared
headless fixture exposes the existing `AdminClient` at the correct
`/_snapback/api` base. This was a guide gap, not a runtime defect.
