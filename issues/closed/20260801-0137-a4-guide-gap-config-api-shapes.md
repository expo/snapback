# A4 sweep: guide-gap — config API routes and body shapes are undocumented for public consumers

**Opened:** 2026-08-01
**Systems:** Documentation, Secrets and config
**Related:** LLP 0137 (A4 arm), LLP 0036, LLP 0061 §5, demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f7-guide-gap-config-api-shapes.json

The secrets-and-config guide names the operations (status, set, unset,
verify) but demonstrates them only through the repo kit's `configApi`
helper, which public consumers do not have; routes and request shapes are
undocumented. The A4 arm probed them out:

- `GET /_snapback/api/config/status` (admin token) — full custody report,
  never value bytes;
- `POST /_snapback/api/config/set` with `{entry: <name>, value: <string>}`
  (nested-object spelling 422s with a raw serde message; `{entry, member}`
  400s with `SNAPBACK_CONFIG_VALUE_INVALID` "provide exactly one of value
  or values");
- `POST /_snapback/api/config/unset` with `{entry}`.

The custody behavior itself is excellent once reached. File under LLP
0061 §5: a guide subsection (or `snapback config` CLI verbs) should give
the consumer-callable shapes, with a guide check exercising them.

---

**RESOLVED 2026-08-01 (fix-wave docs sweep).** Same section (guide/operating/secrets-and-config.md §"The callable routes"): consumer-callable shapes for status/set/unset/verify verified against src/server.rs, including the `{entry, member}` mis-spelling that produces SNAPBACK_CONFIG_VALUE_INVALID.
