# Quarry differential test: rewrite-commute--metered--E_OVERFLOW

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, Quarry, database testing
**Date:** 2026-10-12
**Failure signature:** `rewrite-commute--metered--E_OVERFLOW`
**Detected at:** `1c47f02cd8faca7b0997644f4cc111711f7c8291`
**Seed:** `47997`
**Related:** LLP 3000.035 §5.1

## Observation

The oracle `{"Rewrite": "Commute"}` disagreed on
`metered`. The shrunk case reproduced the signature twice.
Diagnosis is pending: inspect for an engine defect, binder defect, harness
defect or underspecified point. No engine or binder change was made by the runner.

## Replay

Start an isolated Postgres evaluation cluster and export
`SNAPBACK4_EVAL_POSTGRES` (see `snapback4/scripts/test-postgres.sh`), then:

```sh
python3 snapback4/scripts/difftest-tickets.py extract issues/20261012-quarry-difftest-rewrite-commute--metered--e-overflow-3c805c9e1c40.md /tmp/quarry-replay
cd snapback4
cargo run --release -p snapback4-difftest --features postgres -- replay /tmp/quarry-replay
```

## case.q

````quarry
table items:
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

mutation run(key: id, k2: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return ((b * a) = b)

query observe(key: id, k2: id):
  return [items[key], items[k2]]
````

## case.json (typed inputs, both raw outcomes and continuation)

````json
{
  "version": 1,
  "case": {
    "seed": 47997,
    "program": {
      "tables": [
        {
          "name": "items",
          "columns": [],
          "keys": [],
          "rule": "Allow",
          "residency": "Online"
        }
      ],
      "body": {
        "Block": {
          "stmts": [],
          "ret": {
            "Binary": [
              "Eq",
              {
                "Binary": [
                  "Mul",
                  {
                    "Arg": [
                      "b",
                      "Int"
                    ]
                  },
                  {
                    "Arg": [
                      "a",
                      "Int"
                    ]
                  }
                ]
              },
              {
                "Arg": [
                  "b",
                  "Int"
                ]
              }
            ]
          }
        }
      },
      "lets": [],
      "bind_return": false,
      "reverse": false,
      "helper": false
    },
    "rows": [],
    "principal": "alice",
    "args": {
      "a": -9007199254740991,
      "b": 9007199254740990,
      "bucket": 0,
      "c": null,
      "k2": "r1",
      "key": "r0",
      "n": null
    },
    "clock": 382413,
    "budget": {
      "examined": 8192,
      "index_entries": 16384,
      "rule_probes": 8192,
      "steps": 13238,
      "heap_bytes": 16777216,
      "output_bytes": 1048576,
      "rows_written": 1024
    }
  },
  "finding": {
    "signature": "rewrite-commute--metered--E_OVERFLOW",
    "oracle": {
      "Rewrite": "Commute"
    },
    "field": "metered",
    "left": {
      "kind": "mutation",
      "value": {
        "events": 0,
        "metered": {
          "examined": 0,
          "heap_bytes": 4,
          "index_entries": 0,
          "output_bytes": 0,
          "rows_written": 0,
          "rule_probes": 0,
          "steps": 5
        },
        "receipt_only": false,
        "replayed": false,
        "state": "failed",
        "tables": [],
        "why": {
          "code": "E_OVERFLOW",
          "family": "input",
          "message": "E_OVERFLOW: -81129638414606654674191240921090 is outside the i53 value model"
        }
      }
    },
    "right": {
      "kind": "mutation",
      "value": {
        "events": 0,
        "metered": {
          "examined": 0,
          "heap_bytes": 4,
          "index_entries": 0,
          "output_bytes": 0,
          "rows_written": 0,
          "rule_probes": 0,
          "steps": 6
        },
        "receipt_only": false,
        "replayed": false,
        "state": "failed",
        "tables": [],
        "why": {
          "code": "E_OVERFLOW",
          "family": "input",
          "message": "E_OVERFLOW: -81129638414606654674191240921090 is outside the i53 value model"
        }
      }
    },
    "continuation": []
  },
  "shrink_attempts": 86
}
````

## Recurrences

- 2026-10-12: run `20261012T000004Z-bbc18bf6`, seed `47997`, commit `1c47f02cd8faca7b0997644f4cc111711f7c8291`.

When resolved, keep the case as a regression, record the resolution, and move
this ticket to `issues/closed/`.
