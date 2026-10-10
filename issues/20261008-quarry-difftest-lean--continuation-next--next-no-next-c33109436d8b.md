# Quarry differential test: lean--continuation-next--next~no-next

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, Quarry reads (cursors), Lean oracle
**Date:** 2026-10-08
**Failure signature:** `lean--continuation-next--next~no-next`
**Detected at:** `ff3eb63cc475d50b37fe5a283d3407c343f3a379`
**Seed:** `22563`
**Related:** LLP 3000.035 §5.2

## Observation

The oracle `"Lean"` disagreed on
`continuation-next`. The shrunk case reproduced the signature twice.
**Diagnosis (2026-10-08, lane LO): open language question, OPEN C2.** On a
non-uniform page, or a page with a residual filter, a page that fills its
bound carries `next` even when no candidate follows; that cursor returns an
empty page. Uniform pages without a residual filter agree with the model's
lookahead (all 9,859 in the 60,000-case run). Data and `complete` agree. The
reads card ("A terminal full page need not carry `next`") permits both;
recorded as an observation in `snapback4/lean/OPEN.md` C2. Full record:
`snapback4/crates/snapback4-difftest/cases/found/lean--continuation-next--next~no-next/DIAGNOSIS.md`. No
engine, binder or model change was made; a ruling would either require the
lookahead or accept the extra empty page.

## Replay

The Lean oracle needs no database, but needs the model built:
`(cd snapback4/lean && lake build)` (or export `SNAPBACK4_LEAN_ORACLE`), then:

```sh
python3 snapback4/scripts/difftest-tickets.py extract issues/20261008-quarry-difftest-lean--continuation-next--next-no-next-c33109436d8b.md /tmp/quarry-replay
cd snapback4
cargo run --release -p snapback4-difftest -- replay /tmp/quarry-replay
```

## case.q

````quarry
table items:
  owner: principal
  bucket: int
  tag: id
  read <- .owner = viewer
  insert <- deny
  update (old, next) <- old.owner = viewer
  delete <- deny
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket first 1 by .tag after c
````

## case.json (typed inputs, both raw outcomes and continuation)

````json
{
  "version": 1,
  "case": {
    "seed": 22563,
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
              "name": "tag",
              "ty": "Id"
            }
          ],
          "keys": [],
          "rule": "Allow",
          "residency": "Online",
          "effects": [
            "Owner",
            "Deny",
            "NamedOld",
            "Deny"
          ]
        }
      ],
      "body": {
        "Read": {
          "kind": "Page",
          "take": 1,
          "descending": false,
          "filter": false,
          "owner": false
        }
      },
      "lets": [],
      "bind_return": false,
      "reverse": false,
      "helper": false,
      "order": [
        "tag"
      ]
    },
    "rows": [
      [
        "items",
        {
          "bucket": 1,
          "id": "r6",
          "owner": "bob",
          "tag": "tag6"
        }
      ],
      [
        "items",
        {
          "bucket": 1,
          "id": "r8",
          "owner": "bob",
          "tag": "tag8"
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
    "clock": 87214,
    "budget": {
      "examined": 8192,
      "index_entries": 16384,
      "rule_probes": 8192,
      "steps": 16378,
      "heap_bytes": 16777216,
      "output_bytes": 1048576,
      "rows_written": 1024
    }
  },
  "finding": {
    "signature": "lean--continuation-next--next~no-next",
    "oracle": "Lean",
    "field": "continuation-next",
    "left": {
      "kind": "query",
      "value": {
        "complete": false,
        "cut": null,
        "data": {
          "Array": [
            {
              "Row": {
                "bucket": {
                  "Int": 1
                },
                "id": {
                  "Id": "r8"
                },
                "owner": {
                  "Id": "bob"
                },
                "tag": {
                  "Id": "tag8"
                }
              }
            }
          ]
        },
        "metered": {
          "examined": 1,
          "heap_bytes": 864,
          "index_entries": 0,
          "output_bytes": 98,
          "rows_written": 0,
          "rule_probes": 0,
          "steps": 4
        },
        "next": "WzIsIml0ZW1zIiwiJGludGVudDpieUJ1Y2tldFRhZzoyMjE1YjAxYjliM2M0YTVjIiwiQXNjIixbeyJuYW1lIjoidGFnIiwia2luZCI6IklkIn0seyJuYW1lIjoiaWQiLCJraW5kIjoiSWQifV0sW3siSWQiOiJ0YWc4In0seyJJZCI6InI4In1dLHsiZ2VuZXJhdGlvbiI6MSwicHJlZml4IjpbeyJJbnQiOjF9XX1d",
        "seq": 1,
        "tables": [
          "items"
        ]
      }
    },
    "right": {
      "kind": "lean",
      "value": {
        "complete": false,
        "data": {
          "arr": [
            {
              "row": [
                [
                  "id",
                  {
                    "id": "r8"
                  }
                ],
                [
                  "owner",
                  {
                    "id": "bob"
                  }
                ],
                [
                  "bucket",
                  {
                    "int": "1"
                  }
                ],
                [
                  "tag",
                  {
                    "id": "tag8"
                  }
                ]
              ]
            }
          ]
        },
        "kind": "answer",
        "next": {
          "null": null
        }
      }
    },
    "continuation": [
      {
        "kind": "canonical",
        "value": {
          "engine": {
            "code": null,
            "complete": false,
            "data": {
              "arr": [
                {
                  "row": {
                    "bucket": {
                      "int": "1"
                    },
                    "id": {
                      "id": "r6"
                    },
                    "owner": {
                      "id": "bob"
                    },
                    "tag": {
                      "id": "tag6"
                    }
                  }
                }
              ]
            },
            "kind": "answer",
            "next": true
          },
          "model": {
            "code": null,
            "complete": false,
            "data": {
              "arr": [
                {
                  "row": {
                    "bucket": {
                      "int": "1"
                    },
                    "id": {
                      "id": "r6"
                    },
                    "owner": {
                      "id": "bob"
                    },
                    "tag": {
                      "id": "tag6"
                    }
                  }
                }
              ]
            },
            "kind": "answer",
            "next": true
          }
        }
      },
      {
        "kind": "canonical",
        "value": {
          "engine": {
            "code": null,
            "complete": false,
            "data": {
              "arr": [
                {
                  "row": {
                    "bucket": {
                      "int": "1"
                    },
                    "id": {
                      "id": "r8"
                    },
                    "owner": {
                      "id": "bob"
                    },
                    "tag": {
                      "id": "tag8"
                    }
                  }
                }
              ]
            },
            "kind": "answer",
            "next": true
          },
          "model": {
            "code": null,
            "complete": false,
            "data": {
              "arr": [
                {
                  "row": {
                    "bucket": {
                      "int": "1"
                    },
                    "id": {
                      "id": "r8"
                    },
                    "owner": {
                      "id": "bob"
                    },
                    "tag": {
                      "id": "tag8"
                    }
                  }
                }
              ]
            },
            "kind": "answer",
            "next": false
          }
        }
      }
    ]
  },
  "shrink_attempts": 164
}
````

## Recurrences

- 2026-10-08: run `lane-LO-60k` (seeds 0–59,999, local), seed `22563`, commit `ff3eb63cc475d50b37fe5a283d3407c343f3a379`.

When resolved, keep the case as a regression, record the resolution, and move
this ticket to `issues/closed/`.

- 2026-10-09: run `20261009T011321Z-eb3eb4e7`, seed `11756`, commit `74f3a1dd3240287cd7f5405ed55588e0c93db8e5`.

- 2026-10-10: run `20261010T000005Z-fe12e802`, seed `20379`, commit `e92ba8687bc6e363cf5f76436f53d8b3bacdd284`.
