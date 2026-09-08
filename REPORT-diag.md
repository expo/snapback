# Lane D — diagnostics say the fix; why speaks

Base: `3062777ab`. Branch left untouched. No commits or stashes.
Governing context: LLP 1000's Snapback 2 fence; LLP 1002 §3, §8 and the dated
“Diagnostics say the fix” revision; program plan §D1–D6.

## Implemented

- D1: value reads missing a range bound emit `E_UNBOUND_SCAN`; matching nonunique
  indexes precede exactly matching unique alternatives. Unknown key sets retain
  the unknown-index diagnostic with declared nominal types. Intrinsic-only tables
  also receive a usable bounded `by byId` repair.
- D2: one unrestricted Damerau–Levenshtein helper (two edits or case-only), with
  deterministic nearest-name selection and declared-name fallback. Applied to
  tables, named keys, fields, indexes, enum cases, functions, procedures, shapes,
  modules, schedule operations, rules, maintains, caps and immutable declarations.
- D3: 94 family entries reduced to 85; backend examples use Quarry. Seeds, effects,
  CLI and offline protocol harness examples keep their corresponding surfaces.
  Every entry names an existing guide page. Removed dead entries/declarations:
  `E_BOUND_TAKE_REQUIRED`, `E_PROVENANCE_AMBIGUOUS`, `E_UNBOUND_COUNT`,
  `E_ARGS_SPREAD`, `E_ARGS_DESCRIPTOR`, `E_SCHEMA_UNKNOWN_TABLE`,
  `E_SCHEMA_INDEX_OPTION`, `E_SCHEMA_COLUMN`, `E_ENUM_VARIANT`.
  No executable emitting sites remained for these codes. Runtime refusal messages
  strip their own leading code; project-root advice names only `schema.q`.
- D4: both check text paths print complete messages and rewrites, wrapping at 100
  characters. JSON output is unchanged. Unicode and a 200-character rewrite are tested.
- D5: default why is prose; `--json` keeps the authoritative document. Compiler
  source positions, helper call sites, guard associations and compiled source lines
  live inside the existing operation entries in `certificates.json`. No new artifact
  kind, executable IR field, server-query field, or generation hash input. Guide app
  compares the executable certificate separately from its source metadata.
- D6: `guide/operator.md` documents why, check, spelling repairs and missing bounds;
  compressed existing prose to **4,096 bytes**, without raising any budget.
  LLP 1002 includes the dated delegated rulings and marks the old default superseded.

## Files changed

- `llp/1002-dev-loop.spec.md`
- `snapback2/crates/snapback2/src/check.rs`
- `snapback2/crates/snapback2/src/guide.rs`
- `snapback2/crates/snapback2/src/project.rs`
- `snapback2/crates/snapback2/src/project/bound_tests.rs`
- `snapback2/crates/snapback2/src/protocol.rs`
- `snapback2/crates/snapback2/src/why.rs`
- `snapback2/crates/snapback2/src/writer_assets.rs`
- `snapback2/crates/snapback2/src/writer_auth.rs`
- `snapback2/crates/snapback2/src/writer_live_tests.rs`
- `snapback2/crates/snapback2/tests/guide.rs`
- `snapback2/crates/snapback2/tests/test_verb.rs`
- `snapback2/crates/snapback2/tests/why_trace.rs`
- `snapback2/packages/compiler/src/diagnostics.ts`
- `snapback2/packages/compiler/src/ir.ts`
- `snapback2/packages/compiler/src/quarry-diagnostic-checks.ts`
- `snapback2/packages/compiler/src/quarry-fanout-checks.ts`
- `snapback2/packages/compiler/src/quarry-language-checks.ts`
- `snapback2/packages/compiler/src/quarry/ast.ts`
- `snapback2/packages/compiler/src/quarry/bound-declarations.ts`
- `snapback2/packages/compiler/src/quarry/bound-schema.ts`
- `snapback2/packages/compiler/src/quarry/bound-values.ts`
- `snapback2/packages/compiler/src/quarry/bound.ts`
- `snapback2/packages/compiler/src/quarry/catalog.ts`
- `snapback2/packages/compiler/src/quarry/diagnostics.ts`
- `snapback2/packages/compiler/src/quarry/direct.ts`
- `snapback2/packages/compiler/src/quarry/index.ts`
- `snapback2/packages/compiler/src/quarry/project.ts`
- `snapback2/packages/compiler/src/quarry/schedule.ts`
- `snapback2/packages/compiler/src/test-final-gates.ts`
- `snapback2/packages/snapback2/guide/families.source.json`
- `snapback2/packages/snapback2/guide/operator.md`

## Supporting scope and deviations

- No 120-character truncation exists in this base's Rust printer. Project check
  printed JSON regardless of the flag; the IR text printer omitted rewrites.
  Replaced those behaviors with a wrapping formatter; did not invent a removed cut.
- Source metadata required the compiler `ir.ts` SourceSite type and Rust compiled
  project/cache custody. `writer_assets.rs`, `writer_auth.rs`, `writer_live_tests.rs`
  and `project/bound_tests.rs` changed only to supply the new test-fixture fields.
- The guide cache reader and guide tests had to account for source metadata and
  the deleted diagnostic family. The nominal-type expectations in compiler tests
  and `tests/test_verb.rs` now use the declared Quarry table type.
- The two compiler files outside `quarry/` (`diagnostics.ts`, `ir.ts`) also shed
  dead code declarations/guidance branches. Added tests live in existing test files.
- No grammar construct, client SDK implementation, template, core engine, corpus,
  build script, registry or budget was changed. Formatting touched nearby lines
  in the edited Rust files.

## Tests and validation

PENDING FINAL VERIFICATION COUNTS

New compiler regressions cover missing bounds (empty, principal prefix, explicit
nonunique, intrinsic-only), exact unique candidate ordering, unknown-key types,
column/index/enum transpositions, all requested declared namespaces, named key
columns, schema index/immutable/rule fields, and distant-name fallback. The first
eight failed before implementation; all 21 pass now. One family test rejects the
six deleted surface fragments and checks every guide path; it failed on the base.
Rust adds exact denied/admitted chat output comparisons, invalid-edit source
snapshot custody, capped visible/examined counts and site fallback, complete
200-character/Unicode check output, code-free E_INPUT, and schema.q-only root advice.

Initial compiler regression results, verbatim:

```text
FAIL diagnostic fix: empty range needs a bound Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"no unique index on posts matches []; name the columns/index or add one","site":"snapback/posts.q:2:10","rewrite":"-- candidate indexes: posts.byId (id: reference to posts)","guide":"quarry/names"}],"ms":6.92}
FAIL diagnostic fix: principal prefix needs a bound Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"no unique index on memberships matches [?]; name the columns/index or add one","site":"snapback/posts.q:2:10","rewrite":"-- candidate indexes: memberships.byId (id: reference to memberships); memberships.byConversationPrincipal (conversationId: reference to conversations, principal: principal)","guide":"quarry/names"}],"ms":1.09}
FAIL diagnostic fix: explicit nonunique prefix needs a bound Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"memberships.byPrincipalConversation is not a complete unique key","site":"snapback/posts.q:2:10","rewrite":"-- memberships.byPrincipalConversation is not a complete unique key","guide":"quarry/names"}],"ms":0.97}
FAIL diagnostic fix: unknown keys keep declared types Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"no unique index on memberships matches [?, ?]; name the columns/index or add one","site":"snapback/posts.q:2:10","rewrite":"-- candidate indexes: memberships.byId (id: reference to memberships); memberships.byConversationPrincipal (conversationId: reference to conversations, principal: principal)","guide":"quarry/names"}],"ms":0.81}
FAIL diagnostic fix: column case typo Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_TYPE","family":"quarry","message":"unknown posts field authorid","site":"snapback/posts.q:2:18","rewrite":"-- use a declared posts column","guide":"quarry/types"}],"ms":1.09}
FAIL diagnostic fix: index transposition Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"table posts has no index byTmie","site":"snapback/posts.q:2:10","rewrite":"-- candidate indexes: posts.byId (id: reference to posts); posts.byTime (at: time, id: reference to posts); posts.byAuthorTime (authorId: principal, at: time, id: reference to posts)","guide":"quarry/names"}],"ms":0.55}
FAIL diagnostic fix: enum transposition Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_TYPE","family":"quarry","message":"enum literal \"opne\" is not one of open, closed","site":"snapback/posts.q:2:65","rewrite":"-- use one of \"open\", \"closed\"","guide":"quarry/types"}],"ms":1.67}
FAIL diagnostic fix: distant column lists names Error: {"ok":false,"diagnostics":[{"code":"E_QUARRY_TYPE","family":"quarry","message":"unknown posts field unrelated","site":"snapback/posts.q:2:18","rewrite":"-- use a declared posts column","guide":"quarry/types"}],"ms":0.65}
0 passed, 8 failed
```

Final focused compiler results, verbatim:

```text
PASS diagnostic fix: empty range needs a bound
PASS diagnostic fix: principal prefix needs a bound
PASS diagnostic fix: explicit nonunique prefix needs a bound
PASS diagnostic fix: unknown keys keep declared types
PASS diagnostic fix: column case typo
PASS diagnostic fix: index transposition
PASS diagnostic fix: enum transposition
PASS diagnostic fix: named key column spelling
PASS diagnostic fix: table transposition
PASS diagnostic fix: row column spelling
PASS diagnostic fix: fn spelling
PASS diagnostic fix: proc spelling
PASS diagnostic fix: shape spelling
PASS diagnostic fix: module spelling
PASS diagnostic fix: op spelling
PASS diagnostic fix: intrinsic-only range needs a bound
PASS diagnostic fix: distant column lists names
PASS diagnostic fix: named range lists matching ranges before exact unique choices
PASS diagnostic fix: schema column in by byOwner: authorid
PASS diagnostic fix: schema column in immutable authorid
PASS diagnostic fix: schema column in read <- .authorid = viewer
21 passed, 0 failed
```

## Reproductions: before and after

Scaffolded the base chat template with the real Node 24 binary, then edited only
the temporary project. `feeds.q` received each query separately; the third probe
changed `authorId: viewer` to `authorid: viewer` in the existing post mutation.

### posts — before

```json
{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"no unique index on posts matches []; name the columns/index or add one","site":"snapback/feeds.q:17:10","rewrite":"-- candidate indexes: posts.byId (id: reference to posts)","guide":"quarry/names"}
```

### posts — after

```json
{"code":"E_UNBOUND_SCAN","family":"bound","message":"`posts[]` reads a range; name its bound","site":"snapback/feeds.q:17:10","rewrite":"-- posts[] first 50 by byTime; posts[] first 50 by byAuthorTime; candidate indexes: posts.byTime (at: time, id: posts); posts.byAuthorTime (author: principal, at: time, id: posts)","guide":"quarry/indexes"}
```

### memberships — before

```json
{"code":"E_QUARRY_UNKNOWN","family":"quarry","message":"no unique index on memberships matches [?]; name the columns/index or add one","site":"snapback/feeds.q:17:10","rewrite":"-- candidate indexes: memberships.byId (id: reference to memberships); memberships.byConversationPrincipal (conversationId: reference to conversations, principal: principal)","guide":"quarry/names"}
```

### memberships — after

```json
{"code":"E_UNBOUND_SCAN","family":"bound","message":"`memberships[p]` reads a range; name its bound","site":"snapback/feeds.q:17:10","rewrite":"-- memberships[p] first 50 by byPrincipalConversation; candidate indexes: memberships.byPrincipalConversation (principal: principal, conversationId: conversations)","guide":"quarry/indexes"}
```

### authorid — before

```json
{"code":"E_QUARRY_TYPE","family":"quarry","message":"unknown messages field authorid","site":"snapback/deliveries.q:28:43","rewrite":"-- use a declared messages column","guide":"quarry/types"}
```

### authorid — after

```json
{"code":"E_QUARRY_TYPE","family":"quarry","message":"unknown messages field `authorid`","site":"snapback/deliveries.q:28:43","rewrite":"-- did you mean `authorId`?","guide":"quarry/types"}
```

### check text — after

```text
refused E_QUARRY_TYPE at snapback/deliveries.q:28:43
  message: unknown messages field `authorid`
  rewrite: -- did you mean `authorId`?
```

### why as charlie — before

Command: `why deliveries.thread '{"conversationId":"conversation-1"}' --as charlie`.

```json
{
  "authoritativeTrace": {
    "absences": [
      [
        "memberships",
        "byConversationPrincipal",
        [
          {
            "Id": "conversation-1"
          },
          {
            "Id": "dev:charlie"
          }
        ]
      ]
    ],
    "constraint_inputs": [],
    "derived_scratch_bytes": 0,
    "derived_steps": 0,
    "emits": [],
    "examined": 0,
    "points": [
      {
        "digest": null,
        "examined": false,
        "index": "byConversationPrincipal",
        "key": [
          {
            "Id": "conversation-1"
          },
          {
            "Id": "dev:charlie"
          }
        ],
        "site": "deliveries.thread.0",
        "table": "memberships",
        "visible": false
      }
    ],
    "ranges": [],
    "rows": [],
    "rule_inputs": [],
    "rule_probes": 0,
    "scope_touches": [],
    "steps": 10,
    "touched": [],
    "writes": {}
  },
  "diagnostics": [],
  "op": "deliveries.thread",
  "readSites": [
    {
      "complete": false,
      "hoist": false,
      "index": "byConversationPrincipal",
      "max_calls": 1,
      "prefix_template": "Shape",
      "rule_probes_per_candidate": 2,
      "site": "deliveries.thread.0",
      "table": "memberships",
      "take": 1
    },
    {
      "complete": false,
      "decided_true": true,
      "hoist": true,
      "index": "byRecipientConversationKindAt",
      "max_calls": 1,
      "prefix_template": "Shape",
      "rule_probes_per_candidate": 0,
      "site": "deliveries.thread.1",
      "table": "deliveries",
      "take": 50
    },
    {
      "complete": false,
      "hoist": false,
      "index": "byId",
      "max_calls": 50,
      "prefix_template": "Shape",
      "rule_probes_per_candidate": 2,
      "site": "deliveries.thread.2",
      "table": "messages",
      "take": 1
    }
  ],
  "result": {
    "data": null,
    "rule": "MEMBERSHIP_REQUIRED",
    "seq": 1,
    "state": "denied"
  },
  "rowVerdicts": [],
  "ruleInputs": [],
  "subscriptions": []
}
```

### why as alice — before

Command: `why deliveries.thread '{"conversationId":"conversation-1"}' --as alice`.

```json
{
  "authoritativeTrace": {
    "absences": [],
    "constraint_inputs": [],
    "derived_scratch_bytes": 0,
    "derived_steps": 0,
    "emits": [],
    "examined": 3,
    "points": [
      {
        "digest": "d27c9f21df004dbe91ee8f53123acb424cd44371a6471b33f0ff0c17d1b68d44",
        "examined": true,
        "index": "byConversationPrincipal",
        "key": [
          {
            "Id": "conversation-1"
          },
          {
            "Id": "dev:alice"
          }
        ],
        "site": "deliveries.thread.0",
        "table": "memberships",
        "visible": true
      },
      {
        "digest": "fd26c1c39bf7f5d776032b1475ffcbcb0ee68be44eed2787e8f1e11f71214184",
        "examined": true,
        "index": "byId",
        "key": [
          {
            "Id": "message-1"
          }
        ],
        "site": "deliveries.thread.2",
        "table": "messages",
        "visible": true
      }
    ],
    "ranges": [
      {
        "absence": false,
        "after": null,
        "before": null,
        "examined_ids": [
          "delivery-1-alice"
        ],
        "gt": null,
        "gte": null,
        "halo": null,
        "index": "byRecipientConversationKindAt",
        "lt": null,
        "lte": null,
        "n2_suffix": null,
        "order": "Desc",
        "prefix": [
          {
            "Scalar": {
              "Id": "dev:alice"
            }
          },
          {
            "Scalar": {
              "Id": "conversation-1"
            }
          },
          {
            "Scalar": {
              "String": "message"
            }
          }
        ],
        "returned_ids": [
          "delivery-1-alice"
        ],
        "rule_hash": "79adf1c6fdc9cd57a7b6536e49189e821f78550e797effa096845deb580fca7e",
        "site": "deliveries.thread.1",
        "stop": "Exhausted",
        "table": "deliveries",
        "take": 50,
        "visible_ids": [
          "delivery-1-alice"
        ]
      }
    ],
    "rows": [
      {
        "id": "membership-1",
        "row": {
          "Row": {
            "conversationId": {
              "Id": "conversation-1"
            },
            "id": {
              "Id": "membership-1"
            },
            "joinedAt": {
              "Int": 0
            },
            "principal": {
              "Id": "dev:alice"
            },
            "role": {
              "String": "admin"
            }
          }
        },
        "table": "memberships"
      },
      {
        "id": "delivery-1-alice",
        "row": {
          "Row": {
            "at": {
              "Int": 1
            },
            "conversationId": {
              "Id": "conversation-1"
            },
            "id": {
              "Id": "delivery-1-alice"
            },
            "kind": {
              "String": "message"
            },
            "messageId": {
              "Id": "message-1"
            },
            "recipient": {
              "Id": "dev:alice"
            }
          }
        },
        "table": "deliveries"
      },
      {
        "id": "message-1",
        "row": {
          "Row": {
            "at": {
              "Int": 1
            },
            "authorId": {
              "Id": "dev:alice"
            },
            "body": {
              "String": "Welcome"
            },
            "clip": "Null",
            "conversationId": {
              "Id": "conversation-1"
            },
            "expiresAt": "Null",
            "id": {
              "Id": "message-1"
            },
            "oncePhoto": "Null",
            "photo": "Null"
          }
        },
        "table": "messages"
      }
    ],
    "rule_inputs": [
      {
        "hidden": true,
        "index": "byConversationPrincipal",
        "key": [
          {
            "Id": "conversation-1"
          },
          {
            "Id": "dev:alice"
          }
        ],
        "pinned_inputs_digest": "2dce292308b1ab1349317fa490501f6847df244e7aa74668733142ae85c5cb73",
        "result": true,
        "rule_hash": "93d9b6cbc32e91853f2adf2745cf08ef4395ff707773054d5ecc9b2e1d36770b",
        "table": "memberships"
      },
      {
        "hidden": false,
        "index": "byConversationPrincipal",
        "key": [
          {
            "Id": "conversation-1"
          },
          {
            "Id": "dev:alice"
          }
        ],
        "pinned_inputs_digest": "2dce292308b1ab1349317fa490501f6847df244e7aa74668733142ae85c5cb73",
        "result": true,
        "rule_hash": "93d9b6cbc32e91853f2adf2745cf08ef4395ff707773054d5ecc9b2e1d36770b",
        "table": "memberships"
      }
    ],
    "rule_probes": 2,
    "scope_touches": [],
    "steps": 57,
    "touched": [],
    "writes": {}
  },
  "diagnostics": [],
  "op": "deliveries.thread",
  "readSites": [
    {
      "complete": false,
      "hoist": false,
      "index": "byConversationPrincipal",
      "max_calls": 1,
      "prefix_template": "Shape",
      "rule_probes_per_candidate": 2,
      "site": "deliveries.thread.0",
      "table": "memberships",
      "take": 1
    },
    {
      "complete": false,
      "decided_true": true,
      "hoist": true,
      "index": "byRecipientConversationKindAt",
      "max_calls": 1,
      "prefix_template": "Shape",
      "rule_probes_per_candidate": 0,
      "site": "deliveries.thread.1",
      "table": "deliveries",
      "take": 50
    },
    {
      "complete": false,
      "hoist": false,
      "index": "byId",
      "max_calls": 50,
      "prefix_template": "Shape",
      "rule_probes_per_candidate": 2,
      "site": "deliveries.thread.2",
      "table": "messages",
      "take": 1
    }
  ],
  "result": {
    "data": [
      {
        "at": 1,
        "conversationId": "conversation-1",
        "id": "delivery-1-alice",
        "kind": "message",
        "message": {
          "at": 1,
          "authorId": "dev:alice",
          "body": "Welcome",
          "clip": null,
          "conversationId": "conversation-1",
          "expiresAt": null,
          "id": "message-1",
          "oncePhoto": null,
          "photo": null
        },
        "messageId": "message-1",
        "recipient": "dev:alice"
      }
    ],
    "next": null,
    "seq": 1,
    "state": "complete"
  },
  "rowVerdicts": [
    {
      "cut": false,
      "row": "delivery-1-alice",
      "site": "deliveries.thread.1",
      "table": "deliveries",
      "verdict": "allow"
    },
    {
      "cut": false,
      "key": [
        {
          "Id": "conversation-1"
        },
        {
          "Id": "dev:alice"
        }
      ],
      "site": "deliveries.thread.0",
      "table": "memberships",
      "verdict": "allow"
    },
    {
      "cut": false,
      "key": [
        {
          "Id": "message-1"
        }
      ],
      "site": "deliveries.thread.2",
      "table": "messages",
      "verdict": "allow"
    }
  ],
  "ruleInputs": [
    {
      "hidden": true,
      "index": "byConversationPrincipal",
      "key": [
        {
          "Id": "conversation-1"
        },
        {
          "Id": "dev:alice"
        }
      ],
      "pinned_inputs_digest": "2dce292308b1ab1349317fa490501f6847df244e7aa74668733142ae85c5cb73",
      "result": true,
      "rule_hash": "93d9b6cbc32e91853f2adf2745cf08ef4395ff707773054d5ecc9b2e1d36770b",
      "table": "memberships"
    },
    {
      "hidden": false,
      "index": "byConversationPrincipal",
      "key": [
        {
          "Id": "conversation-1"
        },
        {
          "Id": "dev:alice"
        }
      ],
      "pinned_inputs_digest": "2dce292308b1ab1349317fa490501f6847df244e7aa74668733142ae85c5cb73",
      "result": true,
      "rule_hash": "93d9b6cbc32e91853f2adf2745cf08ef4395ff707773054d5ecc9b2e1d36770b",
      "table": "memberships"
    }
  ],
  "subscriptions": []
}
```

PENDING FINAL WHY OUTPUTS

## Open questions

PENDING FINAL VERIFICATION LIMITATIONS

The trace carries application refusal codes, not a unique failing-requirement ID.
If a program repeats the same code on multiple requirements, prose falls back to
executed read sites rather than guessing which requirement failed. Missing source
metadata also falls back to site IDs. This does not affect the specified chat case.
