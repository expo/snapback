# Quarry differential test: device-sqlite--examined-metered-steps--loading

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, Quarry, database testing
**Date:** 2026-10-12
**Failure signature:** `device-sqlite--examined-metered-steps--loading`
**Detected at:** `1c47f02cd8faca7b0997644f4cc111711f7c8291`
**Seed:** `33319`
**Related:** LLP 3000.035 §5.1

## Observation

The oracle `{"Device": {"ceiling": 1, "phase": "examined", "store": "sqlite"}}` disagreed on
`examined-metered-steps`. The shrunk case reproduced the signature twice.
Diagnosis is pending: inspect for an engine defect, binder defect, harness
defect or underspecified point. No engine or binder change was made by the runner.

## Replay

The server-against-device oracle needs no database: it runs the engine on
SQLite and the device on its native SQLite and memory stores.

```sh
python3 snapback4/scripts/difftest-tickets.py extract issues/20261012-quarry-difftest-device-sqlite--examined-metered-steps--loading-9cfe600e4d03.md /tmp/quarry-replay
cd snapback4
cargo run --release -p snapback4-difftest -- replay /tmp/quarry-replay
```

## case.q

````quarry
table items:
  bucket: int
  score: int
  until: time ?
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return min(items where .bucket = bucket, .score)
````

## case.json (typed inputs, both raw outcomes and continuation)

````json
{
  "version": 1,
  "case": {
    "seed": 33319,
    "program": {
      "tables": [
        {
          "name": "items",
          "columns": [
            {
              "name": "bucket",
              "ty": "Int"
            },
            {
              "name": "score",
              "ty": "Int"
            },
            {
              "name": "until",
              "ty": {
                "Nullable": "Time"
              }
            }
          ],
          "keys": [],
          "rule": "Allow",
          "residency": "Public",
          "expire": "until"
        }
      ],
      "body": {
        "Read": {
          "kind": "Min",
          "take": 1,
          "descending": false,
          "filter": false,
          "owner": false
        }
      },
      "lets": [],
      "bind_return": false,
      "reverse": false,
      "helper": false
    },
    "rows": [
      [
        "items",
        {
          "bucket": 1,
          "id": "r1",
          "score": 0,
          "until": 354836
        }
      ],
      [
        "items",
        {
          "bucket": 1,
          "id": "r2",
          "score": 9007199254740991,
          "until": null
        }
      ],
      [
        "items",
        {
          "bucket": 1,
          "id": "r4",
          "score": -9007199254740990,
          "until": null
        }
      ]
    ],
    "principal": "bob",
    "args": {
      "a": 0,
      "b": 0,
      "bucket": 1,
      "c": null,
      "key": "missing",
      "n": null
    },
    "clock": 354837,
    "budget": {
      "examined": 8192,
      "index_entries": 16384,
      "rule_probes": 8192,
      "steps": 14675,
      "heap_bytes": 16777216,
      "output_bytes": 1048576,
      "rows_written": 1024
    }
  },
  "finding": {
    "signature": "device-sqlite--examined-metered-steps--loading",
    "oracle": {
      "Device": {
        "store": "sqlite",
        "phase": "examined",
        "ceiling": 1
      }
    },
    "field": "examined-metered-steps",
    "left": {
      "kind": "projection",
      "value": {
        "complete": false,
        "cut": "meter",
        "loading": true,
        "metered": {
          "examined": 2,
          "heap_bytes": 7,
          "index_entries": 0,
          "output_bytes": 6,
          "rows_written": 0,
          "rule_probes": 0,
          "steps": 5
        },
        "nextExpiry": null,
        "tables": [
          "items"
        ],
        "unknown": false
      }
    },
    "right": {
      "kind": "projection",
      "value": {
        "complete": false,
        "cut": "meter",
        "loading": true,
        "metered": {
          "examined": 2,
          "heap_bytes": 614,
          "index_entries": 0,
          "output_bytes": 6,
          "rows_written": 0,
          "rule_probes": 0,
          "steps": 6
        },
        "nextExpiry": null,
        "tables": [
          "items"
        ],
        "unknown": false
      }
    },
    "continuation": [],
    "store_trace": {
      "left": [
        {
          "kind": "query",
          "value": {
            "capped_at": [
              "examined",
              "programs.run.0"
            ],
            "complete": false,
            "cut": "meter",
            "data": "Null",
            "metered": {
              "examined": 2,
              "heap_bytes": 7,
              "index_entries": 0,
              "output_bytes": 6,
              "rows_written": 0,
              "rule_probes": 0,
              "steps": 5
            },
            "seq": 1,
            "tables": [
              "items"
            ],
            "unavailable": true
          }
        }
      ],
      "right": [
        {
          "kind": "device-call",
          "value": {
            "raw": {
              "ok": {
                "complete": false,
                "cut": "meter",
                "decorationExpiry": null,
                "loading": true,
                "metered": {
                  "examined": 8193,
                  "heap_bytes": 614,
                  "index_entries": 0,
                  "output_bytes": 6,
                  "rows_written": 0,
                  "rule_probes": 0,
                  "steps": 6
                },
                "nextExpiry": null,
                "retained": false,
                "scopes": {
                  "items": [
                    {}
                  ]
                },
                "tables": [
                  "items"
                ],
                "unknown": false,
                "watermark": 1
              }
            },
            "reply": {
              "complete": false,
              "cut": "meter",
              "decorationExpiry": null,
              "loading": true,
              "metered": {
                "examined": 2,
                "heap_bytes": 614,
                "index_entries": 0,
                "output_bytes": 6,
                "rows_written": 0,
                "rule_probes": 0,
                "steps": 6
              },
              "nextExpiry": null,
              "retained": false,
              "scopes": {
                "items": [
                  {}
                ]
              },
              "tables": [
                "items"
              ],
              "unknown": false,
              "watermark": 1
            }
          }
        }
      ]
    }
  },
  "shrink_attempts": 143
}
````

## Recurrences

- 2026-10-12: run `20261012T000004Z-bbc18bf6`, seed `33319`, commit `1c47f02cd8faca7b0997644f4cc111711f7c8291`.

When resolved, keep the case as a regression, record the resolution, and move
this ticket to `issues/closed/`.
