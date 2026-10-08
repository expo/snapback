# Quarry differential test: lean--kind--committed~NOT_FOUND

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, Quarry rules (write authority), Lean oracle
**Date:** 2026-10-08
**Failure signature:** `lean--kind--committed~NOT_FOUND`
**Detected at:** `ff3eb63cc475d50b37fe5a283d3407c343f3a379`
**Seed:** `23074`
**Related:** LLP 3000.035 §5.2

## Observation

The oracle `"Lean"` disagreed on
`kind`. The shrunk case reproduced the signature twice.
**Diagnosis (2026-10-08, lane LO): open language question, OPEN R2 — needs
Charlie's ruling; security-relevant.** The engine judges an unnamed
`update <- R` against the *next* image only; the model judges `R[old] and
R[next]`. Under `update <- .owner = viewer` (with no `immutable owner`), a
viewer can take over another principal's row with a blind `upsert`/`update`
that sets `owner: viewer`: the engine commits, the model refuses
(`NOT_FOUND` on an unreadable target, `E_RULE` on a readable one). Named
`update (old, next)` rules agree in all 374 compared writes. Documents leaning
to the model: `why NOT_FOUND` ("the update rule judges old and next"), LLP
3000.007 §8 item 7(a) (Postgres `UPDATE` policy semantics), `guide from-sql`
(RLS `USING`/`WITH CHECK` → `update <-`); the rules card does not decide the
unnamed form. Full record:
`snapback4/crates/snapback4-difftest/cases/found/lean--kind--committed~NOT_FOUND/DIAGNOSIS.md` and
`snapback4/lean/OPEN.md` R2. A ruling either fixes the engine (judge both
images) or the model and the cards (judge next only, and say so). No engine,
binder or model change was made.

## Replay

The Lean oracle needs no database, but needs the model built:
`(cd snapback4/lean && lake build)` (or export `SNAPBACK4_LEAN_ORACLE`), then:

```sh
python3 snapback4/scripts/difftest-tickets.py extract issues/20261008-quarry-difftest-lean--kind--committed-not-found-2b9511f3e782.md /tmp/quarry-replay
cd snapback4
cargo run --release -p snapback4-difftest -- replay /tmp/quarry-replay
```

## case.q

````quarry
table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  flag: bool
  maybe: int ?
  tag: id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  sync to .owner

mutation run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  upsert items[key] { owner: viewer, bucket, score: 0, label: '𐀀', flag: true, maybe: n, tag: 'tag' }
  return true

query observe(key: id):
  return items[key]
````

## case.json (typed inputs, both raw outcomes and continuation)

````json
{
  "version": 1,
  "case": {
    "seed": 23074,
    "program": {
      "tables": [
        {
          "name": "items",
          "columns": [
            {
              "name": "owner",
              "ty": "Principal"
            },
            {
              "name": "bucket",
              "ty": "Int"
            },
            {
              "name": "score",
              "ty": "Int"
            },
            {
              "name": "label",
              "ty": "Text"
            },
            {
              "name": "flag",
              "ty": "Bool"
            },
            {
              "name": "maybe",
              "ty": {
                "Nullable": "Int"
              }
            },
            {
              "name": "tag",
              "ty": "Id"
            }
          ],
          "keys": [],
          "rule": "Owner",
          "residency": "Owner"
        }
      ],
      "body": {
        "Write": [
          "Upsert",
          {
            "Int": 0
          }
        ]
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
          "flag": false,
          "id": "r0",
          "label": "é",
          "maybe": null,
          "owner": "bob",
          "score": -1,
          "tag": "tag0"
        }
      ]
    ],
    "principal": "alice",
    "args": {
      "a": 0,
      "b": 0,
      "bucket": 0,
      "c": null,
      "key": "r0",
      "n": null
    },
    "clock": 59429,
    "budget": {
      "examined": 8192,
      "index_entries": 16384,
      "rule_probes": 8192,
      "steps": 16928,
      "heap_bytes": 16777216,
      "output_bytes": 1048576,
      "rows_written": 1024
    }
  },
  "finding": {
    "signature": "lean--kind--committed~NOT_FOUND",
    "oracle": "Lean",
    "field": "kind",
    "left": {
      "kind": "mutation",
      "value": {
        "events": 2,
        "metered": {
          "examined": 0,
          "heap_bytes": 1536,
          "index_entries": 2,
          "output_bytes": 13,
          "rows_written": 1,
          "rule_probes": 0,
          "steps": 16
        },
        "receipt_only": false,
        "replayed": false,
        "result": {
          "Bool": true
        },
        "seq": 2,
        "state": "sent",
        "tables": [
          "items"
        ]
      }
    },
    "right": {
      "kind": "lean",
      "value": {
        "code": "NOT_FOUND",
        "kind": "refused"
      }
    },
    "continuation": [
      {
        "kind": "canonical",
        "value": {
          "engine": {
            "code": null,
            "complete": null,
            "data": {
              "bool": true
            },
            "kind": "committed",
            "next": false
          },
          "model": {
            "code": "NOT_FOUND",
            "complete": null,
            "data": null,
            "kind": "refused",
            "next": false
          }
        }
      }
    ]
  },
  "shrink_attempts": 95
}
````

## Recurrences

- 2026-10-08: run `lane-LO-60k` (seeds 0–59,999, local), seed `23074`, commit `ff3eb63cc475d50b37fe5a283d3407c343f3a379`.

When resolved, keep the case as a regression, record the resolution, and move
this ticket to `issues/closed/`.
