// Authoring source for the LLP 0309.000 Stage-A delta-semantics corpus.
// Committed *.case.json files are data-only cross-consumer vectors.
//
// Usage:
//   node corpus-source.mjs --write
//   node corpus-source.mjs --check
//   node corpus-source.mjs --adopt-frozen-expectations

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FORMAT = 'snapback.delta-semantics.case.v1';
const EXACT_INTEGER_PREFIX = '__SNAPBACK_EXACT_INTEGER__:';
function exactInteger(value) {
  return JSON.rawJSON(String(value));
}

const EXPECTED_SOURCE = /* EXPECTED_SOURCE_START */ {
  "admit-public-insert": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1
          },
          "admit": "enter",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 1
        }
      }
    }
  },
  "admit-owner-missing-field": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1
          },
          "admit": "stay-out",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-owner-non-string-field": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "ownerId": 7,
            "rank": 1
          },
          "admit": "stay-out",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-owner-transfer-leaves": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
          "postImage": {
            "_id": "a",
            "ownerId": "u2",
            "rank": 1
          },
          "admit": "leave",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-null-actual-never-eq": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": null
          },
          "admit": "stay-out",
          "rankKeys": [
            null
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-in-null-element-with-match": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 2
          },
          "admit": "enter",
          "rankKeys": [
            2
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 2
        }
      }
    }
  },
  "admit-in-null-element-without-match": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 3
          },
          "admit": "stay-out",
          "rankKeys": [
            3
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-missing-filter-field": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1
          },
          "admit": "stay-out",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-un-analyzable-row-value": {
    "verdict": "Fallback",
    "reason": "predicate-unanalyzable"
  },
  "admit-any-of-row-arm-wins": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "ownerId": "u1",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "enter",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "ownerId": "u1",
          "rank": 1,
          "roomId": "r1"
        }
      }
    }
  },
  "admit-any-of-membership-loss-surviving-owner": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
          "postImage": {
            "_id": "a",
            "ownerId": "u1",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "stay-in",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "ownerId": "u1",
          "rank": 1,
          "roomId": "r1"
        }
      }
    }
  },
  "admit-membership-any-active-role": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "enter",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 1,
          "roomId": "r1"
        }
      }
    }
  },
  "admit-membership-pending-role-denied": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "stay-out",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-membership-listed-role": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "enter",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 1,
          "roomId": "r1"
        }
      }
    }
  },
  "admit-membership-unlisted-role-denied": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "stay-out",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-membership-rekey-probed": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
          "postImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r2"
          },
          "preImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "stay-in",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 1,
          "roomId": "r2"
        }
      }
    }
  },
  "admit-membership-probe-visibility-exception": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "m1",
          "op": "insert",
          "postImage": {
            "_id": "m1",
            "ownerId": "u2",
            "rank": 1
          },
          "admit": "enter",
          "rankKeys": [
            1
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "m1": {
          "_id": "m1",
          "ownerId": "u2",
          "rank": 1
        }
      }
    }
  },
  "admit-insert-delete-folds-away": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": []
    },
    "nextState": {
      "retained": {}
    }
  },
  "admit-delete-reinsert-nets-update": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
          "postImage": {
            "_id": "a",
            "rank": 3
          },
          "preImage": {
            "_id": "a",
            "rank": 1
          },
          "admit": "stay-in",
          "rankKeys": [
            3
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 3
        }
      }
    }
  },
  "admit-update-update-folds-last-post": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
          "postImage": {
            "_id": "a",
            "rank": 3
          },
          "preImage": {
            "_id": "a",
            "rank": 1
          },
          "admit": "stay-in",
          "rankKeys": [
            3
          ]
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 3
        }
      }
    }
  },
  "window-full-complete-displacement": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "rowKey": "c"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-unfull-complete-insert": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-incomplete-underfill-tail-exhausted": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-backward-tail-competition": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "rowKey": "c"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              1.5
            ],
            "rowKey": "x"
          },
          "row": {
            "_id": "x",
            "rank": 1.5
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        },
        {
          "rowKey": "x",
          "rankKeys": {
            "values": [
              1.5
            ],
            "rowKey": "x"
          },
          "row": {
            "_id": "x",
            "rank": 1.5
          }
        }
      ],
      "boundary": {
        "values": [
          1.5
        ],
        "rowKey": "x"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          1.5
        ],
        "rowKey": "x"
      }
    }
  },
  "window-interval-clips-candidate": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "z",
          "rankKeys": {
            "values": [
              exactInteger("9007199254740992")
            ],
            "rowKey": "z"
          },
          "row": {
            "_id": "z",
            "rank": exactInteger("9007199254740992")
          }
        }
      ],
      "boundary": {
        "values": [
          exactInteger("9007199254740992")
        ],
        "rowKey": "z"
      },
      "resultCount": 1,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          exactInteger("9007199254740992")
        ],
        "rowKey": "z"
      }
    }
  },
  "window-take-zero": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [],
      "boundary": null,
      "resultCount": 0,
      "complete": false,
      "label": "zero-take-unproved",
      "continuation": null
    }
  },
  "window-boundary-swap-one-batch": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "rowKey": "b"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "row": {
            "_id": "c",
            "rank": 3
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "c",
          "rankKeys": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "row": {
            "_id": "c",
            "rank": 3
          }
        }
      ],
      "boundary": {
        "values": [
          3
        ],
        "rowKey": "c"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          3
        ],
        "rowKey": "c"
      }
    }
  },
  "window-two-enters-displace-two": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "rowKey": "c"
        },
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              4
            ],
            "rowKey": "d"
          },
          "rowKey": "d"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-tail-competition-known-mask": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "rowKey": "a"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "row": {
            "_id": "c",
            "rank": 3
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        },
        {
          "rowKey": "c",
          "rankKeys": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "row": {
            "_id": "c",
            "rank": 3
          }
        }
      ],
      "boundary": {
        "values": [
          3
        ],
        "rowKey": "c"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          3
        ],
        "rowKey": "c"
      }
    }
  },
  "window-backward-order": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "rowKey": "b"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              4
            ],
            "rowKey": "d"
          },
          "row": {
            "_id": "d",
            "rank": 4
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "d",
          "rankKeys": {
            "values": [
              4
            ],
            "rowKey": "d"
          },
          "row": {
            "_id": "d",
            "rank": 4
          }
        },
        {
          "rowKey": "c",
          "rankKeys": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "row": {
            "_id": "c",
            "rank": 3
          }
        }
      ],
      "boundary": {
        "values": [
          3
        ],
        "rowKey": "c"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          3
        ],
        "rowKey": "c"
      }
    }
  },
  "window-desc-empty-finite-upper-origin": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              12
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 12
          }
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              11
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 11
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              12
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 12
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              11
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 11
          }
        }
      ],
      "boundary": {
        "values": [
          11
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          11
        ],
        "rowKey": "b"
      }
    }
  },
  "window-tail-missing-authenticated-exhausted": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-discarded-known-insert-makes-incomplete": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-label-reproof-to-complete": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-label-reproof-stays-incomplete": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-label-reproof-no-read": {
    "verdict": "Fallback",
    "reason": "completeness-indeterminate"
  },
  "window-a-gates-c-combined-batch": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-rank-unchanged-patch": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "patch",
          "sortKey": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "rowKey": "a",
          "post": {
            "title": "new"
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1,
            "secret": "hidden",
            "title": "new"
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-rank-change-atomic-out-in": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "rowKey": "a"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 3
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        },
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              3
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 3
          }
        }
      ],
      "boundary": {
        "values": [
          3
        ],
        "rowKey": "a"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          3
        ],
        "rowKey": "a"
      }
    }
  },
  "window-rank-undecidable": {
    "verdict": "Fallback",
    "reason": "rank-undecidable"
  },
  "window-stay-out-post-rank-undecidable": {
    "verdict": "Fallback",
    "reason": "rank-undecidable"
  },
  "window-admitted-missing-post-image": {
    "verdict": "Fallback",
    "reason": "missing-image"
  },
  "window-complete-unretained-delete-noop": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        }
      ],
      "boundary": {
        "values": [
          2
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          2
        ],
        "rowKey": "b"
      }
    }
  },
  "window-empty-incomplete-tail-from-start": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              11
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 11
          }
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              12
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 12
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              11
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 11
          }
        },
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              12
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 12
          }
        }
      ],
      "boundary": {
        "values": [
          12
        ],
        "rowKey": "b"
      },
      "resultCount": 2,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          12
        ],
        "rowKey": "b"
      }
    }
  },
  "window-backward-boundary-change": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-out",
          "sortKey": {
            "values": [
              3
            ],
            "rowKey": "c"
          },
          "rowKey": "c"
        },
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "b",
          "rankKeys": {
            "values": [
              2
            ],
            "rowKey": "b"
          },
          "row": {
            "_id": "b",
            "rank": 2
          }
        },
        {
          "rowKey": "a",
          "rankKeys": {
            "values": [
              1
            ],
            "rowKey": "a"
          },
          "row": {
            "_id": "a",
            "rank": 1
          }
        }
      ],
      "boundary": {
        "values": [
          1
        ],
        "rowKey": "a"
      },
      "resultCount": 2,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          1
        ],
        "rowKey": "a"
      }
    }
  },
  "lookup-child-patch": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "patch",
          "scope": "p1",
          "childKey": "c1",
          "fields": {
            "name": "new"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j1"
          ],
          "childKey": "c1",
          "found": true,
          "rowVersion": 2
        }
      },
      "children": {
        "c1": {
          "_id": "c1",
          "_version": 2,
          "join": "j1",
          "name": "new",
          "secret": "hidden"
        }
      }
    }
  },
  "lookup-optional-found-to-missing": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "presence",
          "scope": "p1"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j1"
          ],
          "childKey": null,
          "found": false,
          "rowVersion": null
        }
      },
      "children": {}
    }
  },
  "lookup-optional-missing-to-found": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "presence",
          "scope": "p1",
          "childKey": "c1",
          "value": {
            "name": "new"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j1"
          ],
          "childKey": "c1",
          "found": true,
          "rowVersion": 5
        }
      },
      "children": {
        "c1": {
          "_id": "c1",
          "_version": 5,
          "join": "j1",
          "name": "new"
        }
      }
    }
  },
  "lookup-required-found-to-missing": {
    "verdict": "Fallback",
    "reason": "refusal-transition"
  },
  "lookup-required-missing-to-found": {
    "verdict": "Fallback",
    "reason": "refusal-transition"
  },
  "lookup-birth-fill-emitted": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "presence",
          "scope": "p1",
          "childKey": "c1",
          "value": {
            "name": "new"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j1"
          ],
          "childKey": "c1",
          "found": true,
          "rowVersion": null
        }
      },
      "children": {
        "c1": {
          "_id": "c1",
          "join": "j1",
          "name": "new"
        }
      }
    }
  },
  "lookup-birth-null-key-skips-read": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": null,
          "childKey": null,
          "found": false,
          "rowVersion": null
        }
      },
      "children": {}
    }
  },
  "lookup-rekey-prior-to-fill": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "presence",
          "scope": "p1",
          "childKey": "c2",
          "value": {
            "name": "two"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j2"
          ],
          "childKey": "c2",
          "found": true,
          "rowVersion": null
        }
      },
      "children": {
        "c2": {
          "_id": "c2",
          "join": "j2",
          "name": "two"
        }
      }
    }
  },
  "lookup-existing-found-second-row-unique": {
    "verdict": "Fallback",
    "reason": "unique-violation"
  },
  "lookup-two-enters-empty-unique": {
    "verdict": "Fallback",
    "reason": "unique-violation"
  },
  "lookup-both-change-parent-first-skip": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "presence",
          "scope": "p1",
          "childKey": "c2",
          "value": {
            "name": "fill-row"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j2"
          ],
          "childKey": "c2",
          "found": true,
          "rowVersion": 2
        }
      },
      "children": {
        "c2": {
          "_id": "c2",
          "_version": 2,
          "join": "j2",
          "name": "fill-row"
        }
      }
    }
  },
  "lookup-child-rekey-old-leaves-new-arrives": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "kind": "presence",
          "scope": "old"
        },
        {
          "kind": "presence",
          "scope": "new",
          "childKey": "c1",
          "value": {
            "name": "moved"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "new": {
          "lookupKey": [
            "j2"
          ],
          "childKey": "c1",
          "found": true,
          "rowVersion": 2
        },
        "old": {
          "lookupKey": [
            "j1"
          ],
          "childKey": null,
          "found": false,
          "rowVersion": null
        }
      },
      "children": {
        "c1": {
          "_id": "c1",
          "_version": 2,
          "join": "j2",
          "name": "moved"
        }
      }
    }
  },
  "lookup-scope-death-no-read": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "scopes": {},
      "children": {}
    }
  },
  "lookup-delete-insert-same-row-key-net-update": {
    "verdict": "Maintain",
    "deltaOut": {
      "child-admit": {
        "entries": [
          {
            "rowKey": "c1",
            "op": "update",
            "postImage": {
              "_id": "c1",
              "_version": 2,
              "join": "j1",
              "name": "replacement"
            },
            "preImage": {
              "_id": "c1",
              "_version": 1,
              "join": "j1",
              "name": "old"
            },
            "admit": "stay-in",
            "rankKeys": []
          }
        ]
      },
      "lookup": {
        "ops": [
          {
            "kind": "patch",
            "scope": "p1",
            "childKey": "c1",
            "fields": {
              "name": "replacement"
            }
          }
        ]
      }
    },
    "nextState": {
      "child-admit": {
        "retained": {
          "c1": {
            "_id": "c1",
            "_version": 2,
            "join": "j1",
            "name": "replacement"
          }
        }
      },
      "lookup": {
        "scopes": {
          "p1": {
            "lookupKey": [
              "j1"
            ],
            "childKey": "c1",
            "found": true,
            "rowVersion": 2
          }
        },
        "children": {
          "c1": {
            "_id": "c1",
            "_version": 2,
            "join": "j1",
            "name": "replacement"
          }
        }
      }
    }
  },
  "per-parent-birth-fill-emitted": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "scope": "p1",
          "op": {
            "op": "splice-in",
            "sortKey": {
              "values": [
                1
              ],
              "rowKey": "c1"
            },
            "row": {
              "_id": "c1",
              "rank": 1
            }
          }
        },
        {
          "scope": "p1",
          "op": {
            "op": "splice-in",
            "sortKey": {
              "values": [
                2
              ],
              "rowKey": "c2"
            },
            "row": {
              "_id": "c2",
              "rank": 2
            }
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j1"
          ],
          "window": {
            "rows": [
              {
                "rowKey": "c1",
                "rankKeys": {
                  "values": [
                    1
                  ],
                  "rowKey": "c1"
                },
                "row": {
                  "_id": "c1",
                  "rank": 1
                }
              },
              {
                "rowKey": "c2",
                "rankKeys": {
                  "values": [
                    2
                  ],
                  "rowKey": "c2"
                },
                "row": {
                  "_id": "c2",
                  "rank": 2
                }
              }
            ],
            "boundary": {
              "values": [
                2
              ],
              "rowKey": "c2"
            },
            "resultCount": 2,
            "complete": true,
            "label": "complete",
            "continuation": {
              "values": [
                2
              ],
              "rowKey": "c2"
            }
          }
        }
      }
    }
  },
  "per-parent-birth-null-key-skips-read": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": null,
          "window": {
            "rows": [],
            "boundary": null,
            "resultCount": 0,
            "complete": true,
            "label": "complete",
            "continuation": null
          }
        }
      }
    }
  },
  "per-parent-rekey-prior-to-fill": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "scope": "p1",
          "op": {
            "op": "splice-out",
            "sortKey": {
              "values": [
                1
              ],
              "rowKey": "c1"
            },
            "rowKey": "c1"
          }
        },
        {
          "scope": "p1",
          "op": {
            "op": "splice-out",
            "sortKey": {
              "values": [
                2
              ],
              "rowKey": "c2"
            },
            "rowKey": "c2"
          }
        },
        {
          "scope": "p1",
          "op": {
            "op": "splice-in",
            "sortKey": {
              "values": [
                3
              ],
              "rowKey": "c3"
            },
            "row": {
              "_id": "c3",
              "rank": 3
            }
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j2"
          ],
          "window": {
            "rows": [
              {
                "rowKey": "c3",
                "rankKeys": {
                  "values": [
                    3
                  ],
                  "rowKey": "c3"
                },
                "row": {
                  "_id": "c3",
                  "rank": 3
                }
              }
            ],
            "boundary": {
              "values": [
                3
              ],
              "rowKey": "c3"
            },
            "resultCount": 1,
            "complete": true,
            "label": "complete",
            "continuation": {
              "values": [
                3
              ],
              "rowKey": "c3"
            }
          }
        }
      }
    }
  },
  "per-parent-rekey-to-null-skips-read": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "scope": "p1",
          "op": {
            "op": "splice-out",
            "sortKey": {
              "values": [
                1
              ],
              "rowKey": "c1"
            },
            "rowKey": "c1"
          }
        },
        {
          "scope": "p1",
          "op": {
            "op": "splice-out",
            "sortKey": {
              "values": [
                2
              ],
              "rowKey": "c2"
            },
            "rowKey": "c2"
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": null,
          "window": {
            "rows": [],
            "boundary": null,
            "resultCount": 0,
            "complete": true,
            "label": "complete",
            "continuation": null
          }
        }
      }
    }
  },
  "per-parent-demand-birth": {
    "verdict": "Fallback",
    "reason": "demand-identity-transition"
  },
  "per-parent-demand-death": {
    "verdict": "Fallback",
    "reason": "demand-identity-transition"
  },
  "per-parent-demand-rekey": {
    "verdict": "Fallback",
    "reason": "demand-identity-transition"
  },
  "per-parent-zero-take-birth": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j1"
          ],
          "window": {
            "rows": [],
            "boundary": null,
            "resultCount": 0,
            "complete": false,
            "label": "zero-take-unproved",
            "continuation": null
          }
        }
      }
    }
  },
  "per-parent-zero-take-rekey": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j2"
          ],
          "window": {
            "rows": [],
            "boundary": null,
            "resultCount": 0,
            "complete": false,
            "label": "zero-take-unproved",
            "continuation": null
          }
        }
      }
    }
  },
  "per-parent-both-change-parent-first-skip": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "scope": "p1",
          "op": {
            "op": "splice-out",
            "sortKey": {
              "values": [
                1
              ],
              "rowKey": "c1"
            },
            "rowKey": "c1"
          }
        },
        {
          "scope": "p1",
          "op": {
            "op": "splice-out",
            "sortKey": {
              "values": [
                2
              ],
              "rowKey": "c2"
            },
            "rowKey": "c2"
          }
        },
        {
          "scope": "p1",
          "op": {
            "op": "splice-in",
            "sortKey": {
              "values": [
                3
              ],
              "rowKey": "c3"
            },
            "row": {
              "_id": "c3",
              "rank": 3
            }
          }
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "lookupKey": [
            "j2"
          ],
          "window": {
            "rows": [
              {
                "rowKey": "c3",
                "rankKeys": {
                  "values": [
                    3
                  ],
                  "rowKey": "c3"
                },
                "row": {
                  "_id": "c3",
                  "rank": 3
                }
              }
            ],
            "boundary": {
              "values": [
                3
              ],
              "rowKey": "c3"
            },
            "resultCount": 1,
            "complete": true,
            "label": "complete",
            "continuation": {
              "values": [
                3
              ],
              "rowKey": "c3"
            }
          }
        }
      }
    }
  },
  "support-direct-zero-to-one": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "zero-to-one"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": true
        }
      }
    }
  },
  "support-direct-one-to-zero-reprobe": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "one-to-zero"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": false
        }
      }
    }
  },
  "support-one-to-one-delete": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": true
        }
      }
    }
  },
  "support-through-zero-to-one-probed": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "zero-to-one"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": true,
          "throughTargets": {
            "through1": "t1"
          }
        }
      }
    }
  },
  "support-all-mode-element-transition": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p2",
          "transition": "zero-to-one"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": false
        },
        "p2": {
          "joinKey": [
            "j2"
          ],
          "bit": true
        },
        "p3": {
          "joinKey": [
            "j3"
          ],
          "bit": true
        },
        "p4": {
          "joinKey": [
            "j4"
          ],
          "bit": false
        }
      }
    }
  },
  "support-enter-on-already-true-no-probe": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": true
        },
        "p2": {
          "joinKey": [
            "j2"
          ],
          "bit": true
        }
      }
    }
  },
  "support-parent-birth-establishes-bit": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "zero-to-one"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": true
        }
      }
    }
  },
  "support-parent-rekey-establishes-bit": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "one-to-zero"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j2"
          ],
          "bit": false
        }
      }
    }
  },
  "support-scope-attribution-unresolved": {
    "verdict": "Fallback",
    "reason": "scope-unresolved"
  },
  "support-leave-on-already-false-no-probe": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": []
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": false
        }
      }
    }
  },
  "support-through-retarget-reprobed": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "one-to-zero"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": false,
          "throughTargets": {
            "through1": "t2"
          }
        },
        "p2": {
          "joinKey": [
            "j2"
          ],
          "bit": true,
          "throughTargets": {
            "through2": "t3"
          }
        }
      }
    }
  },
  "lift-zero-to-one-admits-unretained": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "insert",
          "postImage": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          },
          "admit": "enter",
          "rankKeys": []
        }
      ]
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "rank": 1,
          "roomId": "r1"
        }
      },
      "survivingAnyOf": []
    }
  },
  "lift-one-to-zero-sole-admission": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
          "postImage": {
            "_id": "a",
            "roomId": "r1"
          },
          "admit": "leave",
          "rankKeys": []
        }
      ]
    },
    "nextState": {
      "retained": {},
      "survivingAnyOf": []
    }
  },
  "lift-one-to-zero-any-of-survives": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": []
    },
    "nextState": {
      "retained": {
        "a": {
          "_id": "a",
          "roomId": "r1"
        }
      },
      "survivingAnyOf": [
        "a"
      ]
    }
  },
  "lift-windowed-unprojected-fallback-pin": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "principal-target-child-patch": {
    "verdict": "Maintain",
    "deltaOut": {
      "binding": {
        "ops": []
      },
      "target": {
        "ops": [
          {
            "kind": "patch",
            "scope": "p1",
            "childKey": "c1",
            "fields": {
              "name": "new"
            }
          }
        ]
      }
    },
    "nextState": {
      "binding": {
        "scopes": {},
        "children": {}
      },
      "target": {
        "scopes": {
          "p1": {
            "lookupKey": [
              "j1"
            ],
            "childKey": "c1",
            "found": true,
            "rowVersion": null
          }
        },
        "children": {
          "c1": {
            "_id": "c1",
            "join": "j1",
            "name": "new"
          }
        }
      },
      "principalDigests": {
        "p1": "digest-only"
      }
    }
  },
  "composition-principal-bind-product": {
    "verdict": "Maintain",
    "deltaOut": {
      "principal": {
        "binding": {
          "ops": [
            {
              "kind": "patch",
              "scope": "p1",
              "childKey": "c1",
              "fields": {
                "name": "bound"
              }
            }
          ]
        },
        "target": {
          "ops": [
            {
              "kind": "patch",
              "scope": "p1",
              "childKey": "c1",
              "fields": {
                "name": "target"
              }
            }
          ]
        }
      }
    },
    "nextState": {
      "principal": {
        "binding": {
          "scopes": {
            "p1": {
              "lookupKey": [
                "j1"
              ],
              "childKey": "c1",
              "found": true,
              "rowVersion": null
            }
          },
          "children": {
            "c1": {
              "_id": "c1",
              "join": "j1",
              "name": "bound"
            }
          }
        },
        "target": {
          "scopes": {
            "p1": {
              "lookupKey": [
                "j1"
              ],
              "childKey": "c1",
              "found": true,
              "rowVersion": null
            }
          },
          "children": {
            "c1": {
              "_id": "c1",
              "join": "j1",
              "name": "target"
            }
          }
        },
        "principalDigests": {
          "p1": "digest-only"
        }
      }
    }
  },
  "principal-digest-cannot-rekey": {
    "verdict": "Fallback",
    "reason": "rekey-unread"
  },
  "assemble-aliased-field-and-literal": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "update",
          "nodeId": "root",
          "rootKey": "p1",
          "key": "p1",
          "position": 0,
          "row": {
            "headline": "new"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "window"
        }
      ],
      "graphCompleteness": "window",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:a4a983b57fed14268f6be604c3257562f779765c179b578e57b4b9022ce9ba42"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "headline": "new",
          "kind": "issue"
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "assemble-root-splice-add": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "add",
          "nodeId": "root",
          "key": "p1",
          "position": 0,
          "row": {
            "_id": "p1",
            "title": "new"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "complete"
        }
      ],
      "graphCompleteness": "complete",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:1e7f4f831e1822fe6f24deb7a46171e684a2ae772649c386ebc7977da7c296b3"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "new"
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "assemble-to-one-presence": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "update",
          "nodeId": "one",
          "rootKey": "p1",
          "key": "p1",
          "position": 0,
          "row": {
            "name": "child"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "complete"
        },
        {
          "nodeId": "one",
          "label": "unknown"
        }
      ],
      "graphCompleteness": "unknown",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:4fd139b23420dce177de78466789d97857f9d35f75ed725be274669596d01dfc"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "old",
          "child": {
            "name": "child"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "assemble-exists-bit": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "update",
          "nodeId": "exists",
          "rootKey": "p1",
          "key": "p1",
          "position": 0,
          "row": {
            "hasAny": true
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "complete"
        },
        {
          "nodeId": "exists",
          "label": "complete"
        }
      ],
      "graphCompleteness": "complete",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:24b4e11c3e33bbf957d1358a1746e3d446410e964b06ff65882b3f2f8d1ceda5"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "old",
          "hasAny": true
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "assemble-below-array-unaddressable": {
    "verdict": "Fallback",
    "reason": "wire-unaddressable"
  },
  "assemble-ancestor-birth-absorbs-descendant": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "add",
          "nodeId": "root",
          "key": "p2",
          "position": 1,
          "row": {
            "_id": "p2",
            "title": "new",
            "children": [
              {
                "_id": "c1",
                "title": "child"
              }
            ]
          }
        }
      ],
      "orderedRootKeys": [
        "p1",
        "p2"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "complete"
        },
        {
          "nodeId": "many",
          "label": "complete"
        }
      ],
      "graphCompleteness": "complete",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:62110f91b67fb7a0a105780cf3209c06d52876c60bf63ae4770cac155b17ff19"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "old",
          "children": []
        },
        {
          "_id": "p2",
          "title": "new",
          "children": [
            {
              "_id": "c1",
              "title": "child"
            }
          ]
        }
      ],
      "orderedRootKeys": [
        "p1",
        "p2"
      ]
    }
  },
  "assemble-to-many-two-removals-application-positions": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "remove",
          "nodeId": "many",
          "rootKey": "p1",
          "key": "c1",
          "position": 0
        },
        {
          "op": "remove",
          "nodeId": "many",
          "rootKey": "p1",
          "key": "c2",
          "position": 0
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "complete"
        },
        {
          "nodeId": "many",
          "label": "complete"
        }
      ],
      "graphCompleteness": "complete",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:a0085a6a0781a87d7032e60505fe322e48d2d6c35a0428659bc900cdaf388dbc"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "old",
          "children": []
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "composition-parent-child-product-to-lookup": {
    "verdict": "Maintain",
    "deltaOut": {
      "parent-admit": {
        "entries": [
          {
            "rowKey": "p1",
            "op": "update",
            "postImage": {
              "_id": "p1",
              "join": null
            },
            "admit": "stay-in",
            "rankKeys": [
              null
            ]
          }
        ]
      },
      "child-admit": {
        "entries": [
          {
            "rowKey": "c2",
            "op": "insert",
            "postImage": {
              "_id": "c2",
              "_version": 2,
              "join": "j1",
              "name": "batch-row"
            },
            "admit": "enter",
            "rankKeys": [
              null
            ]
          }
        ]
      },
      "lookup": {
        "ops": [
          {
            "kind": "presence",
            "scope": "p1"
          }
        ]
      }
    },
    "nextState": {
      "parent-admit": {
        "retained": {
          "p1": {
            "_id": "p1",
            "join": null
          }
        }
      },
      "child-admit": {
        "retained": {
          "c2": {
            "_id": "c2",
            "_version": 2,
            "join": "j1",
            "name": "batch-row"
          }
        }
      },
      "lookup": {
        "scopes": {
          "p1": {
            "lookupKey": null,
            "childKey": null,
            "found": false,
            "rowVersion": null
          }
        },
        "children": {}
      }
    }
  },
  "composition-fallback-aborts-frame": {
    "verdict": "Fallback",
    "reason": "rank-undecidable"
  },
  "composition-lift-enters-window-same-step": {
    "verdict": "Maintain",
    "deltaOut": {
      "support": {
        "transitions": [
          {
            "scope": "r1",
            "transition": "zero-to-one"
          }
        ]
      },
      "lift": {
        "entries": [
          {
            "rowKey": "a",
            "op": "insert",
            "postImage": {
              "_id": "a",
              "rank": 1,
              "roomId": "r1"
            },
            "admit": "enter",
            "rankKeys": []
          }
        ]
      },
      "window": {
        "ops": [
          {
            "op": "splice-in",
            "sortKey": {
              "values": [
                1
              ],
              "rowKey": "a"
            },
            "row": {
              "_id": "a",
              "rank": 1,
              "roomId": "r1"
            }
          }
        ]
      }
    },
    "nextState": {
      "support": {
        "scopes": {
          "r1": {
            "joinKey": [
              "j1"
            ],
            "bit": true
          }
        }
      },
      "lift": {
        "retained": {
          "a": {
            "_id": "a",
            "rank": 1,
            "roomId": "r1"
          }
        },
        "survivingAnyOf": []
      },
      "window": {
        "rows": [
          {
            "rowKey": "a",
            "rankKeys": {
              "values": [
                1
              ],
              "rowKey": "a"
            },
            "row": {
              "_id": "a",
              "rank": 1,
              "roomId": "r1"
            }
          }
        ],
        "boundary": {
          "values": [
            1
          ],
          "rowKey": "a"
        },
        "resultCount": 1,
        "complete": true,
        "label": "complete",
        "continuation": {
          "values": [
            1
          ],
          "rowKey": "a"
        }
      }
    }
  },
  "support-direct-stay-in-rekey-moves-scopes": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": [
        {
          "scope": "p1",
          "transition": "one-to-zero"
        },
        {
          "scope": "p2",
          "transition": "zero-to-one"
        }
      ]
    },
    "nextState": {
      "scopes": {
        "p1": {
          "joinKey": [
            "j1"
          ],
          "bit": false
        },
        "p2": {
          "joinKey": [
            "j2"
          ],
          "bit": true
        }
      }
    }
  },
  "support-direct-stay-in-rekey-missing-pre-image": {
    "verdict": "Fallback",
    "reason": "scope-unresolved"
  },
  "assemble-ancestor-source-alias-to-one": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "update",
          "nodeId": "root",
          "rootKey": "p1",
          "key": "p1",
          "position": 0,
          "row": {
            "title": "new"
          }
        },
        {
          "op": "update",
          "nodeId": "one",
          "rootKey": "p1",
          "key": "c1",
          "position": 0,
          "row": {
            "rootTitle": "new"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "nodeCompleteness": [
        {
          "nodeId": "root",
          "label": "complete"
        },
        {
          "nodeId": "one",
          "label": "complete"
        }
      ],
      "graphCompleteness": "complete",
      "proofTuple": {
        "materialization": "m1",
        "authority": "public",
        "evaluationCut": 7
      },
      "resultDigest": "sha256:934c5260ec6928873697bf29ec77f37f7461ec9c74acb2a357b8649cd713db53"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "new",
          "child": {
            "name": "child",
            "rootTitle": "new"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "assemble-ancestor-source-alias-below-array-unaddressable": {
    "verdict": "Fallback",
    "reason": "wire-unaddressable"
  },
  "window-empty-inclusive-start-admits-boundary-rank": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "splice-in",
          "sortKey": {
            "values": [
              10
            ],
            "rowKey": "interval-start"
          },
          "row": {
            "_id": "interval-start",
            "rank": 10
          }
        }
      ]
    },
    "nextState": {
      "rows": [
        {
          "rowKey": "interval-start",
          "rankKeys": {
            "values": [
              10
            ],
            "rowKey": "interval-start"
          },
          "row": {
            "_id": "interval-start",
            "rank": 10
          }
        }
      ],
      "boundary": {
        "values": [
          10
        ],
        "rowKey": "interval-start"
      },
      "resultCount": 1,
      "complete": true,
      "label": "complete",
      "continuation": {
        "values": [
          10
        ],
        "rowKey": "interval-start"
      }
    }
  },
  "admit-membership-rekey-probed-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "window-incomplete-underfill-tail-exhausted-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-backward-tail-competition-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-tail-competition-known-mask-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-desc-empty-finite-upper-origin-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-label-reproof-to-complete-empty-transcript": {
    "verdict": "Fallback",
    "reason": "completeness-indeterminate"
  },
  "window-label-reproof-stays-incomplete-empty-transcript": {
    "verdict": "Fallback",
    "reason": "completeness-indeterminate"
  },
  "window-empty-incomplete-tail-from-start-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "lookup-birth-fill-emitted-empty-transcript": {
    "verdict": "Fallback",
    "reason": "scope-unfilled"
  },
  "lookup-rekey-prior-to-fill-empty-transcript": {
    "verdict": "Fallback",
    "reason": "rekey-unread"
  },
  "lookup-both-change-parent-first-skip-empty-transcript": {
    "verdict": "Fallback",
    "reason": "rekey-unread"
  },
  "per-parent-birth-fill-emitted-empty-transcript": {
    "verdict": "Fallback",
    "reason": "scope-unfilled"
  },
  "per-parent-rekey-prior-to-fill-empty-transcript": {
    "verdict": "Fallback",
    "reason": "rekey-unread"
  },
  "per-parent-both-change-parent-first-skip-empty-transcript": {
    "verdict": "Fallback",
    "reason": "rekey-unread"
  },
  "support-direct-one-to-zero-reprobe-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "support-one-to-one-delete-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "support-through-zero-to-one-probed-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "support-all-mode-element-transition-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "support-parent-birth-establishes-bit-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "support-parent-rekey-establishes-bit-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "support-through-retarget-reprobed-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "lift-zero-to-one-admits-unretained-empty-transcript": {
    "verdict": "Fallback",
    "reason": "scope-unresolved"
  },
  "composition-lift-enters-window-same-step-empty-transcript": {
    "verdict": "Fallback",
    "reason": "scope-unresolved"
  },
  "support-direct-stay-in-rekey-moves-scopes-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "window-empty-inclusive-start-admits-boundary-rank-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  }
} /* EXPECTED_SOURCE_END */;

const clone = (value) => structuredClone(value);
const row = (id, rank, extra = {}) => ({ _id: id, rank, ...extra });
const rankKey = (id, rank) => ({ values: [rank], rowKey: id });
const ranked = (id, rank, extra = {}) => ({ rowKey: id, rankKeys: rankKey(id, rank), row: row(id, rank, extra) });
const windowState = (rows, complete = true) => ({
  rows: rows.map(([id, rank, extra = {}]) => ranked(id, rank, extra)),
  boundary: rows.length ? rankKey(rows.at(-1)[0], rows.at(-1)[1]) : null,
  resultCount: rows.length,
  complete,
  label: complete ? 'complete' : 'incomplete',
  continuation: rows.length ? rankKey(rows.at(-1)[0], rows.at(-1)[1]) : null,
});
const dz = (rowKey, op, admit, postImage, rankKeys = [], preImage) => ({
  rowKey, op, admit, ...(postImage === undefined ? {} : { postImage }),
  ...(preImage === undefined ? {} : { preImage }), rankKeys,
});
const parent = (id, admit, join, extra = {}) => dz(id, admit === 'enter' ? 'insert' : 'update', admit,
  admit === 'leave' ? undefined : { _id: id, join, ...extra });
const tail = (window, boundary, k, rows, exhausted, labelOnly = false, inclusive = false) => ({
  request: {
    kind: 'tail', window, ...(boundary === null ? {} : { boundary }), k, labelOnly,
    ...(inclusive ? { inclusive: true } : {}),
  },
  response: { kind: 'tail', rows, exhausted },
});
const point = (index, key, found) => ({
  request: { kind: 'point', index, key }, response: { kind: 'point', row: found },
});
const probe = (edge, scope, supported, element) => ({
  request: { kind: 'probe', edge, scope, ...(element === undefined ? {} : { element }) },
  response: { kind: 'probe', rows: supported ? [{ _id: `support-${scope}-${element ?? 'exists'}` }] : [] },
});
const range = (index, keyPrefix, bound, rows, exhausted = true) => ({
  request: { kind: 'range', index, keyPrefix, bound },
  response: { kind: 'range', rows, exhausted },
});

const publicAdmit = (overrides = {}) => ({
  form: 'admit', config: {
    visibility: { kind: 'public-read' }, filters: [], grain: 'complete-scope',
    rankOrder: [{ field: 'rank', direction: 'asc' }], probeRelation: false, ...overrides,
  },
});
const window = (overrides = {}) => ({
  form: 'window', config: {
    windowId: 'root', order: [{ field: 'rank', direction: 'asc' }], interval: {}, take: 2,
    projectionFields: ['rank', 'title'], ...overrides,
  },
});
const lookup = (overrides = {}) => ({
  form: 'keyed-lookup', config: {
    index: 'child.by_join', parentJoinFields: ['join'], childJoinFields: ['join'],
    presence: 'optional', projectionFields: ['name'], ...overrides,
  },
});
const lookupState = (scopes = {}, children = {}) => ({ scopes, children });
const lookupScope = (lookupKey, childKey, found = childKey !== null, rowVersion = null) => ({
  lookupKey, childKey, found, rowVersion,
});
const e5 = (overrides = {}) => ({
  form: 'per-parent-window', config: {
    index: 'child.by_parent', parentJoinFields: ['join'], demandPaged: false,
    maxChildrenPerParent: 4, window: window({ windowId: 'children' }).config, ...overrides,
  },
});
const support = (overrides = {}) => ({
  form: 'support-semi-join', config: {
    edge: 'edge', edgeKind: 'direct', mode: { kind: 'exists' },
    parentJoinFields: ['join'], supportJoinFields: ['join'], ...overrides,
  },
});
const supportState = (scopes) => ({ scopes });
const supportScope = (joinKey, bit, throughTargets) => ({
  joinKey, bit, ...(throughTargets === undefined ? {} : { throughTargets }),
});

const authored = [];
const add = (name, coverage, operator, initialState, foldedChangeBatch, readTranscript = []) => {
  authored.push({ name, coverage, operator, initialState, foldedChangeBatch, readTranscript });
};

// E0 / ΔApp / three-valued predicate and visibility cases.
add('admit-public-insert', ['admit', 'three-valued'], publicAdmit(), { retained: {} }, {
  changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1) }] }, supportBits: {},
});
add('admit-owner-missing-field', ['admit', 'three-valued'], publicAdmit({
  visibility: { kind: 'owner', field: 'ownerId', userId: 'u1' },
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1) }] }, supportBits: {} });
add('admit-owner-non-string-field', ['admit', 'three-valued'], publicAdmit({
  visibility: { kind: 'owner', field: 'ownerId', userId: 'u1' },
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { ownerId: 7 }) }] }, supportBits: {} });
add('admit-owner-transfer-leaves', ['admit', 'three-valued'], publicAdmit({
  visibility: { kind: 'owner', field: 'ownerId', userId: 'u1' },
}), { retained: { a: row('a', 1, { ownerId: 'u1' }) } }, { changes: { changes: [{ rowKey: 'a', op: 'update', postImage: row('a', 1, { ownerId: 'u2' }) }] }, supportBits: {} });
add('admit-null-actual-never-eq', ['admit', 'three-valued'], publicAdmit({
  filters: [{ field: 'rank', op: 'Eq', literal: null }],
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', null) }] }, supportBits: {} });
add('admit-in-null-element-with-match', ['admit', 'three-valued'], publicAdmit({
  filters: [{ field: 'rank', op: 'In', literal: [null, 2] }],
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 2) }] }, supportBits: {} });
add('admit-in-null-element-without-match', ['admit', 'three-valued'], publicAdmit({
  filters: [{ field: 'rank', op: 'In', literal: [null, 2] }],
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 3) }] }, supportBits: {} });
add('admit-missing-filter-field', ['admit', 'three-valued'], publicAdmit({
  filters: [{ field: 'missing', op: 'Gt', literal: 0 }],
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1) }] }, supportBits: {} });
add('admit-un-analyzable-row-value', ['admit', 'fallback'], publicAdmit({
  filters: [{ field: 'value', op: 'Eq', literal: 1 }],
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { value: [1] }) }] }, supportBits: {} });
add('admit-any-of-row-arm-wins', ['admit', 'membership'], publicAdmit({
  visibility: { kind: 'any-of', arms: [
    { kind: 'owner', field: 'ownerId', userId: 'u1' },
    { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: null, edge: 'membership' },
  ] },
}), { retained: {} }, { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { ownerId: 'u1', roomId: 'r1' }) }] }, supportBits: {} });
add('admit-any-of-membership-loss-surviving-owner', ['admit', 'membership'], publicAdmit({
  visibility: { kind: 'any-of', arms: [
    { kind: 'owner', field: 'ownerId', userId: 'u1' },
    { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: ['admin'], edge: 'membership' },
  ] },
}), { retained: { a: row('a', 1, { ownerId: 'u1', roomId: 'r1' }) } }, {
  changes: { changes: [{ rowKey: 'a', op: 'update', postImage: row('a', 1, { ownerId: 'u1', roomId: 'r1' }) }] },
  supportBits: { member: { a: false } },
});
add('admit-membership-any-active-role', ['admit', 'membership', 'roles'], publicAdmit({
  visibility: { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: null, edge: 'membership' },
}), { retained: {} }, {
  changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { roomId: 'r1' }) }] },
  supportBits: { member: { a: { role: 'reader', pending: false } } },
});
add('admit-membership-pending-role-denied', ['admit', 'membership', 'roles'], publicAdmit({
  visibility: { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: null, edge: 'membership' },
}), { retained: {} }, {
  changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { roomId: 'r1' }) }] },
  supportBits: { member: { a: { role: 'reader', pending: true } } },
});
add('admit-membership-listed-role', ['admit', 'membership', 'roles'], publicAdmit({
  visibility: { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: ['admin'], edge: 'membership' },
}), { retained: {} }, {
  changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { roomId: 'r1' }) }] },
  supportBits: { member: { a: { role: 'admin', pending: false } } },
});
add('admit-membership-unlisted-role-denied', ['admit', 'membership', 'roles'], publicAdmit({
  visibility: { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: ['admin'], edge: 'membership' },
}), { retained: {} }, {
  changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1, { roomId: 'r1' }) }] },
  supportBits: { member: { a: { role: 'reader', pending: false } } },
});
add('admit-membership-rekey-probed', ['admit', 'membership', 'parent-arm', 'read-maintain'], publicAdmit({
  visibility: { kind: 'membership', arm: 'member', resourceField: 'roomId', roles: null, edge: 'membership' },
}), { retained: { a: row('a', 1, { roomId: 'r1' }) } }, {
  changes: { changes: [{ rowKey: 'a', op: 'update', postImage: row('a', 1, { roomId: 'r2' }), preImage: row('a', 1, { roomId: 'r1' }) }] }, supportBits: {},
}, [probe('membership', 'r2', true)]);
add('admit-membership-probe-visibility-exception', ['admit', 'membership'], publicAdmit({
  visibility: { kind: 'owner', field: 'ownerId', userId: 'u1' }, probeRelation: true,
}), { retained: {} }, { changes: { changes: [{ rowKey: 'm1', op: 'insert', postImage: row('m1', 1, { ownerId: 'u2' }) }] }, supportBits: {} });
add('admit-insert-delete-folds-away', ['admit', 'batch-fold'], publicAdmit(), { retained: {} }, {
  changes: { changes: [
    { rowKey: 'a', op: 'insert', postImage: row('a', 1) },
    { rowKey: 'a', op: 'delete' },
  ] }, supportBits: {},
});
add('admit-delete-reinsert-nets-update', ['admit', 'batch-fold'], publicAdmit(), { retained: { a: row('a', 1) } }, {
  changes: { changes: [
    { rowKey: 'a', op: 'delete', preImage: row('a', 1) },
    { rowKey: 'a', op: 'insert', postImage: row('a', 3) },
  ] }, supportBits: {},
});
add('admit-update-update-folds-last-post', ['admit', 'batch-fold'], publicAdmit(), { retained: { a: row('a', 1) } }, {
  changes: { changes: [
    { rowKey: 'a', op: 'update', preImage: row('a', 1), postImage: row('a', 2), changedFields: ['rank'] },
    { rowKey: 'a', op: 'update', postImage: row('a', 3), changedFields: ['title'] },
  ] }, supportBits: {},
});

// E3 whole-batch window cases.
add('window-full-complete-displacement', ['window'], window(), windowState([['b', 2], ['c', 3]], true), {
  entries: [dz('a', 'insert', 'enter', row('a', 1), [1])],
});
add('window-unfull-complete-insert', ['window'], windowState([['a', 1]], true), windowState([['a', 1]], true));
// Correct the shorthand case above into an ordinary operator/input vector.
authored.at(-1).operator = window(); authored.at(-1).foldedChangeBatch = { entries: [dz('b', 'insert', 'enter', row('b', 2), [2])] };
add('window-incomplete-underfill-tail-exhausted', ['window', 'read-maintain'], window(), windowState([['a', 1]], false), { entries: [] }, [
  tail('root', rankKey('a', 1), 1, [row('b', 2)], true),
]);
add('window-backward-tail-competition', ['window', 'backward', 'tail-competition', 'read-maintain'],
  window({ order: [{ field: 'rank', direction: 'desc' }] }), windowState([['c', 3], ['b', 2]], false), {
    entries: [dz('c', 'delete', 'leave'), dz('a', 'insert', 'enter', row('a', 1), [1])],
  }, [tail('root', rankKey('b', 2), 1, [row('x', 1.5)], false)]);
const exactLow = exactInteger('9007199254740992');
const exactHigh = exactInteger('9007199254740993');
add('window-interval-clips-candidate', ['window', 'numeric-precision'], window({
  take: 1,
  interval: { upper: { key: rankKey('zzzz', exactLow), inclusive: true } },
}), windowState([['z', exactLow]], true), {
  entries: [dz('a', 'insert', 'enter', row('a', exactHigh), [exactHigh])],
});
add('window-take-zero', ['window'], window({ take: 0 }), windowState([], false), {
  entries: [dz('a', 'insert', 'enter', row('a', 1), [1])],
});
add('window-boundary-swap-one-batch', ['window', 'batch-fold'], window(), windowState([['a', 1], ['b', 2]], true), { entries: [
  dz('b', 'delete', 'leave'), dz('c', 'insert', 'enter', row('c', 3), [3]),
] });
add('window-two-enters-displace-two', ['window', 'batch-fold'], window(), windowState([['c', 3], ['d', 4]], true), { entries: [
  dz('a', 'insert', 'enter', row('a', 1), [1]), dz('b', 'insert', 'enter', row('b', 2), [2]),
] });
add('window-tail-competition-known-mask', ['window', 'read-maintain'], window(), windowState([['a', 1], ['b', 2]], false), { entries: [
  dz('a', 'delete', 'leave'), dz('d', 'insert', 'enter', row('d', 4), [4]),
] }, [tail('root', rankKey('b', 2), 1, [row('c', 3)], false)]);
add('window-backward-order', ['window', 'backward'], window({ order: [{ field: 'rank', direction: 'desc' }] }),
  windowState([['c', 3], ['b', 2]], true), {
    entries: [dz('d', 'insert', 'enter', row('d', 4), [4])],
  });
add('window-desc-empty-finite-upper-origin', ['window', 'backward', 'finite-interval', 'read-maintain'], window({
  order: [{ field: 'rank', direction: 'desc' }],
  interval: { upper: { key: rankKey('interval-start', 10), inclusive: true } },
}), windowState([], false), { entries: [] }, [
  tail('root', null, 2, [row('a', 12), row('b', 11)], false),
]);
add('window-tail-missing-authenticated-exhausted', ['window', 'fallback'], window(), windowState([['a', 1]], false), { entries: [] }, [{
  request: { kind: 'tail', window: 'root', boundary: rankKey('a', 1), k: 1, labelOnly: false },
  response: { kind: 'tail', rows: [] },
}]);
add('window-discarded-known-insert-makes-incomplete', ['window', 'completeness'], window(), windowState([['a', 1], ['b', 2]], true), {
  entries: [dz('c', 'insert', 'enter', row('c', 3), [3])],
});
add('window-label-reproof-to-complete', ['window', 'completeness', 'read-maintain'], window(), windowState([['a', 1], ['b', 2]], false), {
  entries: [dz('x', 'delete', 'stay-out')],
}, [tail('root', rankKey('b', 2), 1, [], true, true)]);
add('window-label-reproof-stays-incomplete', ['window', 'completeness', 'read-maintain'], window(), windowState([['a', 1], ['b', 2]], false), {
  entries: [dz('x', 'update', 'stay-out', row('x', 9), [9])],
}, [tail('root', rankKey('b', 2), 1, [row('c', 3)], true, true)]);
add('window-label-reproof-no-read', ['window', 'fallback'], window(), windowState([['a', 1], ['b', 2]], false), {
  entries: [dz('x', 'delete', 'stay-out')],
});
add('window-a-gates-c-combined-batch', ['window', 'completeness', 'batch-fold'], window(), windowState([['a', 1], ['b', 2]], false), { entries: [
  dz('c', 'insert', 'enter', row('c', 3), [3]), dz('x', 'delete', 'stay-out'),
] });
add('window-rank-unchanged-patch', ['window'], window(), windowState([['a', 1, { title: 'old' }], ['b', 2]], true), {
  entries: [dz('a', 'update', 'stay-in', row('a', 1, { title: 'new', secret: 'hidden' }), [1])],
});
add('window-rank-change-atomic-out-in', ['window'], window(), windowState([['a', 1], ['b', 2]], true), {
  entries: [dz('a', 'update', 'stay-in', row('a', 3), [3])],
});
add('window-rank-undecidable', ['window', 'fallback'], window(), windowState([], true), {
  entries: [dz('a', 'insert', 'enter', row('a', [1]), [[1]])],
});
add('window-stay-out-post-rank-undecidable', ['window', 'fallback'], window(), windowState([], true), {
  entries: [dz('a', 'update', 'stay-out', row('a', [1]), [[1]])],
});
add('window-admitted-missing-post-image', ['window', 'fallback'], window(), windowState([], true), {
  entries: [dz('a', 'update', 'enter')],
});
add('window-complete-unretained-delete-noop', ['window', 'completeness'], window(), windowState([['a', 1], ['b', 2]], true), {
  entries: [dz('x', 'delete', 'stay-out')],
});
add('window-empty-incomplete-tail-from-start', ['window', 'finite-interval', 'read-maintain'], window({
  interval: { lower: { key: rankKey('interval-start', 10), inclusive: true } },
}), windowState([], false), { entries: [dz('c', 'insert', 'enter', row('c', 15), [15])] }, [
  tail('root', rankKey('interval-start', 10), 2, [row('a', 11), row('b', 12)], false, false, true),
]);
add('window-backward-boundary-change', ['window', 'backward'], window({ order: [{ field: 'rank', direction: 'desc' }] }),
  windowState([['c', 3], ['b', 2]], true), {
    entries: [dz('c', 'delete', 'leave'), dz('a', 'insert', 'enter', row('a', 1), [1])],
  });

// E4 unique keyed lookup and presence cases.
const foundState = lookupState(
  { p1: lookupScope(['j1'], 'c1', true, 1) },
  { c1: { _id: 'c1', _version: 1, join: 'j1', name: 'old' } },
);
const missingState = lookupState({ p1: lookupScope(['j1'], null, false) }, {});
add('lookup-child-patch', ['lookup', 'presence'], lookup(), clone(foundState), { parent: { entries: [] }, child: { entries: [
  dz('c1', 'update', 'stay-in', { _id: 'c1', _version: 2, join: 'j1', name: 'new', secret: 'hidden' }),
] } });
add('lookup-optional-found-to-missing', ['lookup', 'presence'], lookup(), clone(foundState), { parent: { entries: [] }, child: { entries: [dz('c1', 'delete', 'leave')] } });
add('lookup-optional-missing-to-found', ['lookup', 'presence'], lookup(), clone(missingState), { parent: { entries: [] }, child: { entries: [
  dz('c1', 'insert', 'enter', { _id: 'c1', _version: 5, join: 'j1', name: 'new' }),
] } });
add('lookup-required-found-to-missing', ['lookup', 'presence', 'fallback'], lookup({ presence: 'required' }), clone(foundState), {
  parent: { entries: [] }, child: { entries: [dz('c1', 'delete', 'leave')] },
});
add('lookup-required-missing-to-found', ['lookup', 'presence', 'fallback'], lookup({ presence: 'required' }), clone(missingState), {
  parent: { entries: [] }, child: { entries: [dz('c1', 'insert', 'enter', { _id: 'c1', join: 'j1', name: 'new' })] },
});
add('lookup-birth-fill-emitted', ['lookup', 'scope-fill', 'read-maintain'], lookup(), lookupState(), {
  parent: { entries: [parent('p1', 'enter', 'j1')] }, child: { entries: [] },
}, [point('child.by_join', ['j1'], { _id: 'c1', join: 'j1', name: 'new' })]);
add('lookup-birth-null-key-skips-read', ['lookup', 'scope-fill'], lookup(), lookupState(), {
  parent: { entries: [dz('p1', 'insert', 'enter', { _id: 'p1', join: null })] }, child: { entries: [] },
});
add('lookup-rekey-prior-to-fill', ['lookup', 'rekey', 'read-maintain'], lookup(), clone(foundState), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, child: { entries: [] },
}, [point('child.by_join', ['j2'], { _id: 'c2', join: 'j2', name: 'two' })]);
add('lookup-existing-found-second-row-unique', ['lookup', 'fallback'], lookup(), clone(foundState), {
  parent: { entries: [] }, child: { entries: [dz('c2', 'insert', 'enter', { _id: 'c2', join: 'j1', name: 'two' })] },
});
add('lookup-two-enters-empty-unique', ['lookup', 'fallback', 'batch-fold'], lookup(), clone(missingState), {
  parent: { entries: [] }, child: { entries: [
    dz('c1', 'insert', 'enter', { _id: 'c1', join: 'j1', name: 'one' }),
    dz('c2', 'insert', 'enter', { _id: 'c2', join: 'j1', name: 'two' }),
  ] },
});
add('lookup-both-change-parent-first-skip', ['lookup', 'both-change', 'read-maintain'], lookup(), clone(foundState), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] },
  child: { entries: [dz('c3', 'insert', 'enter', { _id: 'c3', _version: 3, join: 'j2', name: 'batch-row' })] },
}, [point('child.by_join', ['j2'], { _id: 'c2', _version: 2, join: 'j2', name: 'fill-row' })]);
add('lookup-child-rekey-old-leaves-new-arrives', ['lookup', 'rekey'], lookup(), lookupState({
  old: lookupScope(['j1'], 'c1', true, 1),
  new: lookupScope(['j2'], null, false),
}, { c1: { _id: 'c1', _version: 1, join: 'j1', name: 'moving' } }), {
  parent: { entries: [] }, child: { entries: [
    dz('c1', 'update', 'stay-in', { _id: 'c1', _version: 2, join: 'j2', name: 'moved' }),
  ] },
});
add('lookup-scope-death-no-read', ['lookup', 'parent-arm'], lookup(), clone(foundState), {
  parent: { entries: [dz('p1', 'delete', 'leave')] }, child: { entries: [] },
});
const lookupNetUpdateComposition = { form: 'composition', nodes: [
  { nodeId: 'child-admit', operator: publicAdmit({ rankOrder: [] }), inputs: [
    { name: 'changes', source: 'external', input: 'children' },
  ] },
  { nodeId: 'lookup', operator: lookup({ presence: 'required' }), inputs: [
    { name: 'parent', source: 'external', input: 'parents' },
    { name: 'child', source: 'upstream', nodeId: 'child-admit' },
  ] },
] };
add('lookup-delete-insert-same-row-key-net-update', ['lookup', 'composition', 'batch-fold', 'net-candidate'],
  lookupNetUpdateComposition, {
    'child-admit': { retained: { c1: { _id: 'c1', _version: 1, join: 'j1', name: 'old' } } },
    lookup: clone(foundState),
  }, {
    parents: { entries: [] },
    children: { changes: [
      { rowKey: 'c1', op: 'delete', preImage: { _id: 'c1', _version: 1, join: 'j1', name: 'old' } },
      { rowKey: 'c1', op: 'insert', postImage: { _id: 'c1', _version: 2, join: 'j1', name: 'replacement' } },
    ] },
});

// E5 bounded per-parent windows.
add('per-parent-birth-fill-emitted', ['per-parent-window', 'scope-fill', 'read-maintain'], e5(), { scopes: {} }, {
  parent: { entries: [parent('p1', 'enter', 'j1')] }, childByScope: {},
}, [range('child.by_parent', ['j1'], 2, [row('c1', 1), row('c2', 2)])]);
add('per-parent-birth-null-key-skips-read', ['per-parent-window', 'scope-fill'], e5(), { scopes: {} }, {
  parent: { entries: [dz('p1', 'insert', 'enter', { _id: 'p1', join: null })] }, childByScope: {},
});
const e5State = { scopes: { p1: { lookupKey: ['j1'], window: windowState([['c1', 1], ['c2', 2]], true) } } };
add('per-parent-rekey-prior-to-fill', ['per-parent-window', 'rekey', 'read-maintain'], e5(), clone(e5State), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, childByScope: {},
}, [range('child.by_parent', ['j2'], 2, [row('c3', 3)])]);
add('per-parent-rekey-to-null-skips-read', ['per-parent-window', 'rekey'], e5(), clone(e5State), {
  parent: { entries: [parent('p1', 'stay-in', null)] }, childByScope: {},
});
for (const transition of ['birth', 'death', 'rekey']) {
  const entry = transition === 'birth' ? parent('p2', 'enter', 'j2')
    : transition === 'death' ? dz('p1', 'delete', 'leave') : parent('p1', 'stay-in', 'j2');
  add(`per-parent-demand-${transition}`, ['per-parent-window', 'demand-identity', 'fallback'], e5({ demandPaged: true }), clone(e5State), {
    parent: { entries: [entry] }, childByScope: {},
  });
}
add('per-parent-zero-take-birth', ['per-parent-window', 'scope-fill'], e5({ window: window({ windowId: 'children', take: 0 }).config }), { scopes: {} }, {
  parent: { entries: [parent('p1', 'enter', 'j1')] }, childByScope: {},
});
const zeroTakeWindowState = {
  rows: [], boundary: null, resultCount: 0, complete: false,
  label: 'zero-take-unproved', continuation: null,
};
add('per-parent-zero-take-rekey', ['per-parent-window', 'rekey'], e5({ window: window({ windowId: 'children', take: 0 }).config }), {
  scopes: { p1: { lookupKey: ['j1'], window: clone(zeroTakeWindowState) } },
}, {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, childByScope: {},
});
add('per-parent-both-change-parent-first-skip', ['per-parent-window', 'both-change', 'read-maintain'], e5(), clone(e5State), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] },
  childByScope: { p1: { entries: [dz('c3', 'insert', 'enter', row('c3', 3), [3])] } },
}, [range('child.by_parent', ['j2'], 2, [row('c3', 3)])]);

// E6 support transitions and parent arms.
const supportFalse = supportState({ p1: supportScope(['j1'], false) });
const supportTrue = supportState({ p1: supportScope(['j1'], true) });
add('support-direct-zero-to-one', ['support'], support(), clone(supportFalse), {
  parent: { entries: [] }, support: { entries: [dz('m1', 'insert', 'enter', { _id: 'm1', join: 'j1' })] }, target: { entries: [] },
});
add('support-direct-one-to-zero-reprobe', ['support', 'read-maintain'], support(), clone(supportTrue), {
  parent: { entries: [] }, support: { entries: [dz('m1', 'delete', 'leave', undefined, ['j1'])] }, target: { entries: [] },
}, [probe('edge', 'p1', false)]);
add('support-one-to-one-delete', ['support', 'read-maintain'], support(), clone(supportTrue), {
  parent: { entries: [] }, support: { entries: [dz('m1', 'delete', 'leave', undefined, ['j1'])] }, target: { entries: [] },
}, [probe('edge', 'p1', true)]);
add('support-through-zero-to-one-probed', ['support', 'read-maintain'], support({ edgeKind: 'through', throughTargetField: 'targetId' }),
  supportState({ p1: supportScope(['j1'], false, {}) }), {
  parent: { entries: [] }, support: { entries: [dz('through1', 'insert', 'enter', { _id: 'through1', join: 'j1', targetId: 't1' })] }, target: { entries: [] },
}, [probe('edge', 'p1', true)]);
const allSupport = support({ mode: { kind: 'all', elements: ['a', 'b'] } });
add('support-all-mode-element-transition', ['support', 'all-and', 'read-maintain'], allSupport,
  supportState({
    p1: supportScope(['j1'], false), p2: supportScope(['j2'], false),
    p3: supportScope(['j3'], true), p4: supportScope(['j4'], false),
  }), {
  parent: { entries: [] }, support: { entries: [
    dz('m1', 'insert', 'enter', { _id: 'm1', join: 'j1' }),
    dz('m2', 'insert', 'enter', { _id: 'm2', join: 'j2' }),
    dz('m3', 'insert', 'enter', { _id: 'm3', join: 'j3' }),
    dz('m4', 'delete', 'leave', undefined, ['j4']),
  ] }, target: { entries: [] },
}, [
  probe('edge', 'p1', true, 'a'), probe('edge', 'p1', false, 'b'),
  probe('edge', 'p2', true, 'a'), probe('edge', 'p2', true, 'b'),
]);
add('support-enter-on-already-true-no-probe', ['support', 'provability', 'batch-fold'], support(),
  supportState({ p1: supportScope(['j1'], true), p2: supportScope(['j2'], true) }), {
  parent: { entries: [] }, support: { entries: [
    dz('m0', 'insert', 'enter', { _id: 'm0', join: 'j1' }),
    dz('m1', 'delete', 'leave', undefined, ['j2']),
    dz('m2', 'insert', 'enter', { _id: 'm2', join: 'j2' }),
  ] }, target: { entries: [] },
});
add('support-parent-birth-establishes-bit', ['support', 'parent-arm', 'parent-first-skip', 'both-change', 'read-maintain'], support(), { scopes: {} }, {
  parent: { entries: [parent('p1', 'enter', 'j1')] },
  support: { entries: [dz('m1', 'insert', 'enter', { _id: 'm1', join: 'j1' })] },
  target: { entries: [] },
}, [probe('edge', 'p1', true)]);
add('support-parent-rekey-establishes-bit', ['support', 'parent-arm', 'rekey', 'read-maintain'], support(), clone(supportTrue), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, support: { entries: [] }, target: { entries: [] },
}, [probe('edge', 'p1', false)]);
add('support-scope-attribution-unresolved', ['support', 'fallback'], support({ edgeKind: 'through', throughTargetField: 'targetId' }), clone(supportTrue), {
  parent: { entries: [] }, support: { entries: [] }, target: { entries: [dz('t1', 'delete', 'leave')] },
});
add('support-leave-on-already-false-no-probe', ['support', 'provability', 'parent-arm'], support(),
  supportState({ p1: supportScope(['j1'], false), p2: supportScope(['j2'], true) }), {
  parent: { entries: [dz('p2', 'delete', 'leave')] },
  support: { entries: [dz('m1', 'delete', 'leave', undefined, ['j1'])] },
  target: { entries: [] },
});
add('support-through-retarget-reprobed', ['support', 'through-retarget', 'provability', 'read-maintain'],
  support({ edgeKind: 'through', throughTargetField: 'targetId' }), supportState({
    p1: supportScope(['j1'], true, { through1: 't1' }),
    p2: supportScope(['j2'], true, { through2: 't3' }),
  }), {
  parent: { entries: [] }, support: { entries: [
    dz('through1', 'update', 'stay-in', { _id: 'through1', join: 'j1', targetId: 't2' }),
    dz('through2', 'update', 'stay-in', { _id: 'through2', join: 'j2', targetId: 't3' }),
  ] }, target: { entries: [] },
}, [probe('edge', 'p1', false)]);

// E6 membership lift.
const lift = (overrides = {}) => ({ form: 'membership-lift', config: {
  index: 'carrier.by_room', supportField: 'roomId', bound: 4, windowedUnprojected: false, ...overrides,
} });
add('lift-zero-to-one-admits-unretained', ['membership-lift', 'read-maintain'], lift(), { retained: {}, survivingAnyOf: [] }, {
  bits: { transitions: [{ scope: 'r1', transition: 'zero-to-one' }] }, supportValues: { r1: 'r1' },
}, [range('carrier.by_room', ['r1'], 4, [{ _id: 'a', roomId: 'r1', rank: 1 }])]);
add('lift-one-to-zero-sole-admission', ['membership-lift'], lift(), { retained: { a: { _id: 'a', roomId: 'r1' } }, survivingAnyOf: [] }, {
  bits: { transitions: [{ scope: 'r1', transition: 'one-to-zero' }] }, supportValues: { r1: 'r1' },
});
add('lift-one-to-zero-any-of-survives', ['membership-lift'], lift(), { retained: { a: { _id: 'a', roomId: 'r1' } }, survivingAnyOf: ['a'] }, {
  bits: { transitions: [{ scope: 'r1', transition: 'one-to-zero' }] }, supportValues: { r1: 'r1' },
});
add('lift-windowed-unprojected-fallback-pin', ['membership-lift', 'fallback'], lift({ windowedUnprojected: true }), { retained: {}, survivingAnyOf: [] }, {
  bits: { transitions: [] }, supportValues: {},
});

// E7 composition of E4 lookups.
const principal = { form: 'principal-bind', config: { binding: null, target: lookup().config } };
add('principal-target-child-patch', ['principal'], principal, { binding: lookupState(), target: clone(foundState), principalDigests: { p1: 'digest-only' } }, {
  binding: { parent: { entries: [] }, child: { entries: [] } },
  target: { parent: { entries: [] }, child: { entries: [dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j1', name: 'new' })] } },
});
const principalBinding = { form: 'principal-bind', config: { binding: lookup().config, target: lookup().config } };
const principalProductComposition = { form: 'composition', nodes: [{
  nodeId: 'principal', operator: principalBinding, inputs: [
    { name: 'binding', source: 'external', input: 'binding' },
    { name: 'target', source: 'external', input: 'target' },
  ],
}] };
add('composition-principal-bind-product', ['principal', 'composition', 'product', 'both-change'],
  principalProductComposition, {
    principal: { binding: clone(foundState), target: clone(foundState), principalDigests: { p1: 'digest-only' } },
  }, {
    binding: { parent: { entries: [] }, child: { entries: [
      dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j1', name: 'bound' }),
    ] } },
    target: { parent: { entries: [] }, child: { entries: [
      dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j1', name: 'target' }),
    ] } },
  });
add('principal-digest-cannot-rekey', ['principal', 'fallback'], principal, { binding: lookupState(), target: clone(foundState), principalDigests: { p1: 'digest-only' } }, {
  binding: { parent: { entries: [] }, child: { entries: [] } },
  target: { parent: { entries: [parent('p1', 'stay-in', 'j2')] }, child: { entries: [] } },
});

// E8 wire lowering and assembly.
const assemble = (nodes) => ({ form: 'assemble', config: { rootNodeId: 'root', nodes } });
const projectionField = (sourceNode, sourceField) => ({ kind: 'field', sourceNode, sourceField });
const projectionLiteral = (value) => ({ kind: 'literal', value });
const rootNode = { nodeId: 'root', parent: null, kind: 'root', projection: {
  _id: projectionField('root', '_id'), title: projectionField('root', 'title'),
} };
const oneNode = { nodeId: 'one', parent: 'root', kind: 'to-one', resultField: 'child', projection: {
  name: projectionField('one', 'name'),
} };
const manyNode = { nodeId: 'many', parent: 'root', kind: 'to-many', resultField: 'children', projection: {
  _id: projectionField('many', '_id'), title: projectionField('many', 'title'),
} };
const existsNode = { nodeId: 'exists', parent: 'root', kind: 'exists', resultField: 'hasAny', projection: {} };
const assembleState = { result: [{ _id: 'p1', title: 'old' }], orderedRootKeys: ['p1'] };
const assemblyInput = (nodes, events, nextNodeOutputs, postResult, labels = {}) => ({
  events,
  nextNodeOutputs,
  postResult,
  orderedRootKeys: postResult.map(({ _id }) => _id),
  nodeCompleteness: nodes.map(({ nodeId }) => ({ nodeId, label: labels[nodeId] ?? 'complete' })),
  proofTuple: { materialization: 'm1', authority: 'public', evaluationCut: 7 },
});
const aliasedRootNode = { nodeId: 'root', parent: null, kind: 'root', projection: {
  _id: projectionField('root', '_id'),
  headline: projectionField('root', 'title'),
  kind: projectionLiteral('issue'),
} };
add('assemble-aliased-field-and-literal', ['assemble', 'projection-alias', 'projection-literal'],
  assemble([aliasedRootNode]), {
  result: [{ _id: 'p1', headline: 'old', kind: 'issue' }], orderedRootKeys: ['p1'],
}, {
  ...assemblyInput(
    [aliasedRootNode],
    [{ kind: 'root-seq', nodeId: 'root', delta: { ops: [{ op: 'patch', sortKey: rankKey('p1', 1), rowKey: 'p1', post: { title: 'new', secret: 'hidden' } }] } }],
    { root: { $root: [{ _id: 'p1', title: 'new', secret: 'hidden' }] } },
    [{ _id: 'p1', headline: 'new', kind: 'issue' }],
    { root: 'window' },
  ),
});
add('assemble-root-splice-add', ['assemble'], assemble([rootNode]), { result: [], orderedRootKeys: [] }, {
  ...assemblyInput(
    [rootNode],
    [{ kind: 'root-seq', nodeId: 'root', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('p1', 1), row: { _id: 'p1', title: 'new', secret: 'hidden' } }] } }],
    { root: { $root: [{ _id: 'p1', title: 'new', secret: 'hidden' }] } },
    [{ _id: 'p1', title: 'new' }],
  ),
});
add('assemble-to-one-presence', ['assemble', 'presence'], assemble([rootNode, oneNode]), clone(assembleState), {
  ...assemblyInput(
    [rootNode, oneNode],
    [{ kind: 'to-one', nodeId: 'one', delta: { ops: [{ kind: 'presence', scope: 'p1', childKey: 'c1', value: { name: 'child' } }] } }],
    {
      root: { $root: [{ _id: 'p1', title: 'old' }] },
      one: { p1: { _id: 'c1', name: 'child' } },
    },
    [{ _id: 'p1', title: 'old', child: { name: 'child' } }],
    { one: 'unknown' },
  ),
});
add('assemble-exists-bit', ['assemble', 'support'], assemble([rootNode, existsNode]), clone(assembleState), {
  ...assemblyInput(
    [rootNode, existsNode],
    [{ kind: 'exists', nodeId: 'exists', delta: { transitions: [{ scope: 'p1', transition: 'zero-to-one' }] } }],
    {
      root: { $root: [{ _id: 'p1', title: 'old' }] },
      exists: { p1: true },
    },
    [{ _id: 'p1', title: 'old', hasAny: true }],
  ),
});
const nestedOne = { nodeId: 'nestedOne', parent: 'many', kind: 'to-one', projection: {
  name: projectionField('nestedOne', 'name'),
} };
add('assemble-below-array-unaddressable', ['assemble', 'fallback'], assemble([rootNode, manyNode, nestedOne]), clone(assembleState), {
  ...assemblyInput(
    [rootNode, manyNode, nestedOne],
    [{ kind: 'to-one', nodeId: 'nestedOne', delta: { ops: [{ kind: 'presence', scope: 'c1', childKey: 'x', value: { name: 'x' } }] } }],
    {
      root: { $root: [{ _id: 'p1', title: 'old' }] },
      many: { p1: [] },
      nestedOne: {},
    },
    [{ _id: 'p1', title: 'old', children: [] }],
  ),
});
const parentWithEmptyChildren = {
  result: [{ _id: 'p1', title: 'old', children: [] }], orderedRootKeys: ['p1'],
};
add('assemble-ancestor-birth-absorbs-descendant', ['assemble', 'ancestor-absorption'], assemble([rootNode, manyNode]), clone(parentWithEmptyChildren), {
  ...assemblyInput(
    [rootNode, manyNode],
    [
      { kind: 'root-seq', nodeId: 'root', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('p2', 2), row: { _id: 'p2', title: 'new' } }] } },
      { kind: 'to-many', nodeId: 'many', scope: 'p2', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('c1', 1), row: { _id: 'c1', title: 'child' } }] } },
    ],
    {
      root: { $root: [{ _id: 'p1', title: 'old' }, { _id: 'p2', title: 'new' }] },
      many: { p1: [], p2: [{ _id: 'c1', title: 'child' }] },
    },
    [
      { _id: 'p1', title: 'old', children: [] },
      { _id: 'p2', title: 'new', children: [{ _id: 'c1', title: 'child' }] },
    ],
  ),
});
const twoChildrenState = {
  result: [{ _id: 'p1', title: 'old', children: [
    { _id: 'c1', title: 'one' }, { _id: 'c2', title: 'two' },
  ] }],
  orderedRootKeys: ['p1'],
};
add('assemble-to-many-two-removals-application-positions', ['assemble', 'application-position'], assemble([rootNode, manyNode]), clone(twoChildrenState), {
  ...assemblyInput(
    [rootNode, manyNode],
    [{ kind: 'to-many', nodeId: 'many', scope: 'p1', delta: { ops: [
      { op: 'splice-out', sortKey: rankKey('c1', 1), rowKey: 'c1' },
      { op: 'splice-out', sortKey: rankKey('c2', 2), rowKey: 'c2' },
    ] } }],
    {
      root: { $root: [{ _id: 'p1', title: 'old' }] },
      many: { p1: [] },
    },
    [{ _id: 'p1', title: 'old', children: [] }],
  ),
});

// Whole-graph dataflow and atomic fallback.
const externalArm = (name, input) => ({ name, source: 'external', input });
const upstreamArm = (name, nodeId) => ({ name, source: 'upstream', nodeId });
const unaryComposition = { form: 'composition', nodes: [
  { nodeId: 'admit', operator: publicAdmit(), inputs: [externalArm('changes', 'rows')] },
  { nodeId: 'window', operator: window(), inputs: [upstreamArm('input', 'admit')] },
] };
const lookupComposition = { form: 'composition', nodes: [
  { nodeId: 'parent-admit', operator: publicAdmit(), inputs: [externalArm('changes', 'parents')] },
  { nodeId: 'child-admit', operator: publicAdmit(), inputs: [externalArm('changes', 'children')] },
  { nodeId: 'lookup', operator: lookup(), inputs: [
    upstreamArm('parent', 'parent-admit'), upstreamArm('child', 'child-admit'),
  ] },
] };
add('composition-parent-child-product-to-lookup', ['composition', 'product', 'both-change'], lookupComposition, {
  'parent-admit': { retained: { p1: { _id: 'p1', join: 'j1' } } },
  'child-admit': { retained: {} },
  lookup: clone(foundState),
}, {
  parents: { changes: [{ rowKey: 'p1', op: 'update', postImage: { _id: 'p1', join: null } }] },
  children: { changes: [{ rowKey: 'c2', op: 'insert', postImage: { _id: 'c2', _version: 2, join: 'j1', name: 'batch-row' } }] },
});
add('composition-fallback-aborts-frame', ['composition', 'fallback'], unaryComposition, {
  admit: { retained: {} }, window: windowState([], true),
}, {
  rows: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', [1]) }] },
});
const liftComposition = { form: 'composition', nodes: [
  { nodeId: 'support', operator: support(), inputs: [
    externalArm('parent', 'empty'), externalArm('support', 'supportRows'), externalArm('target', 'empty'),
  ] },
  { nodeId: 'lift', operator: lift(), inputs: [
    upstreamArm('bits', 'support'), externalArm('supportValues', 'supportValues'),
  ] },
  { nodeId: 'window', operator: window(), inputs: [upstreamArm('input', 'lift')] },
] };
add('composition-lift-enters-window-same-step', ['composition', 'membership-lift', 'read-maintain'], liftComposition, {
  support: supportState({ r1: supportScope(['j1'], false) }),
  lift: { retained: {}, survivingAnyOf: [] },
  window: windowState([], true),
}, {
  empty: { entries: [] },
  supportRows: { entries: [dz('m1', 'insert', 'enter', { _id: 'm1', join: 'j1' })] },
  supportValues: { r1: 'r1' },
}, [range('carrier.by_room', ['r1'], 4, [{ _id: 'a', roomId: 'r1', rank: 1 }])]);

// Lane A re-review round 3 vectors. Appending preserves the established
// operator-case numbers (in particular case 057's ordering pin).
const round3Start = authored.length;
add('support-direct-stay-in-rekey-moves-scopes',
  ['support', 'rekey', 'provability', 'read-maintain'], support(), supportState({
    p1: supportScope(['j1'], true), p2: supportScope(['j2'], false),
  }), {
    parent: { entries: [] },
    support: { entries: [
      dz('m1', 'update', 'stay-in', { _id: 'm1', join: 'j2' }, [], { _id: 'm1', join: 'j1' }),
    ] },
    target: { entries: [] },
  }, [probe('edge', 'p1', false)]);
add('support-direct-stay-in-rekey-missing-pre-image',
  ['support', 'rekey', 'fallback'], support(), supportState({
    p1: supportScope(['j1'], true), p2: supportScope(['j2'], false),
  }), {
    parent: { entries: [] },
    support: { entries: [
      dz('m1', 'update', 'stay-in', { _id: 'm1', join: 'j2' }),
    ] },
    target: { entries: [] },
  });

const ancestorAliasedOneNode = {
  nodeId: 'one', parent: 'root', kind: 'to-one', resultField: 'child', projection: {
    name: projectionField('one', 'name'), rootTitle: projectionField('root', 'title'),
  },
};
add('assemble-ancestor-source-alias-to-one', ['assemble', 'projection-alias', 'ancestor-source'],
  assemble([rootNode, ancestorAliasedOneNode]), {
    result: [{ _id: 'p1', title: 'old', child: { name: 'child', rootTitle: 'old' } }],
    orderedRootKeys: ['p1'],
  }, {
    ...assemblyInput(
      [rootNode, ancestorAliasedOneNode],
      [{ kind: 'root-seq', nodeId: 'root', delta: { ops: [
        { op: 'patch', sortKey: rankKey('p1', 1), rowKey: 'p1', post: { title: 'new' } },
      ] } }],
      {
        root: { $root: [{ _id: 'p1', title: 'new' }] },
        one: { p1: { _id: 'c1', name: 'child' } },
      },
      [{ _id: 'p1', title: 'new', child: { name: 'child', rootTitle: 'new' } }],
    ),
  });

const ancestorAliasedManyNode = {
  nodeId: 'many', parent: 'root', kind: 'to-many', resultField: 'children', projection: {
    _id: projectionField('many', '_id'), rootTitle: projectionField('root', 'title'),
  },
};
add('assemble-ancestor-source-alias-below-array-unaddressable',
  ['assemble', 'projection-alias', 'ancestor-source', 'fallback'],
  assemble([rootNode, ancestorAliasedManyNode]), {
    result: [{ _id: 'p1', title: 'old', children: [{ _id: 'c1', rootTitle: 'old' }] }],
    orderedRootKeys: ['p1'],
  }, {
    ...assemblyInput(
      [rootNode, ancestorAliasedManyNode],
      [{ kind: 'root-seq', nodeId: 'root', delta: { ops: [
        { op: 'patch', sortKey: rankKey('p1', 1), rowKey: 'p1', post: { title: 'new' } },
      ] } }],
      {
        root: { $root: [{ _id: 'p1', title: 'new' }] },
        many: { p1: [{ _id: 'c1' }] },
      },
      [{ _id: 'p1', title: 'new', children: [{ _id: 'c1', rootTitle: 'new' }] }],
    ),
  });

add('window-empty-inclusive-start-admits-boundary-rank',
  ['window', 'finite-interval', 'inclusive-origin', 'read-maintain'], window({
    interval: { lower: { key: rankKey('interval-start', 10), inclusive: true } },
  }), windowState([], false), { entries: [] }, [
    tail('root', rankKey('interval-start', 10), 2, [row('interval-start', 10)], true, false, true),
  ]);

// Every maintain vector whose proof consumes R has an exact empty-transcript
// twin. The reference form must return that rule's domain reason, never a
// generic read-unavailable reason.
const round3Cases = authored.splice(round3Start);
for (const source of authored.filter(({ coverage }) => coverage.includes('read-maintain'))) {
  add(`${source.name}-empty-transcript`, [...source.coverage.filter((tag) => tag !== 'read-maintain'), 'fallback'],
    clone(source.operator), clone(source.initialState), clone(source.foldedChangeBatch), []);
}
authored.push(...round3Cases);
for (const source of round3Cases.filter(({ coverage }) => coverage.includes('read-maintain'))) {
  add(`${source.name}-empty-transcript`, [...source.coverage.filter((tag) => tag !== 'read-maintain'), 'fallback'],
    clone(source.operator), clone(source.initialState), clone(source.foldedChangeBatch), []);
}

if (authored.length < 60 || authored.length > 140) {
  throw new Error(`delta-semantics corpus must contain 60-140 cases, found ${authored.length}`);
}
if (new Set(authored.map(({ name }) => name)).size !== authored.length) throw new Error('duplicate case name');

const cases = authored.map((entry, index) => ({
  format: FORMAT,
  name: entry.name,
  coverage: entry.coverage,
  operator: entry.operator,
  initialState: entry.initialState,
  foldedChangeBatch: entry.foldedChangeBatch,
  readTranscript: entry.readTranscript,
  expected: EXPECTED_SOURCE[entry.name] ?? null,
  __path: `${String(index + 1).padStart(3, '0')}-${entry.name}.case.json`,
}));

const render = (value) => `${JSON.stringify(value, null, 2)}\n`;
const renderedCases = cases.map(({ __path, ...value }) => ({ path: __path, value, raw: render(value) }));
const manifest = {
  artifactKind: 'snapback.delta-semantics-corpus-manifest.v1',
  corpus: 'snapback.delta-semantics-v1',
  corpusFormatVersion: 1,
  caseSchemaPath: 'tests/conformance/delta-semantics-v1/case.schema.json',
  evaluatorIdentity: 'snapback.delta-semantics.reference.rust.v1',
  cases: renderedCases.map(({ path, value, raw }) => ({
    name: value.name,
    path,
    sha256: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    coverage: value.coverage,
  })),
};

const mode = process.argv[2] ?? '--check';
if (mode === '--adopt-frozen-expectations') {
  const frozen = Object.fromEntries(readdirSync(DIRECTORY)
    .filter((name) => name.endsWith('.case.json')).sort()
    .map((name) => JSON.parse(readFileSync(join(DIRECTORY, name), 'utf8'), (key, value, context) => {
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        return `${EXACT_INTEGER_PREFIX}${context.source}`;
      }
      return value;
    }))
    .map((value) => [value.name, value.expected]));
  if (Object.keys(frozen).length !== authored.length) throw new Error('cannot adopt an incomplete frozen corpus');
  const sourcePath = fileURLToPath(import.meta.url);
  const source = readFileSync(sourcePath, 'utf8');
  const serialized = JSON.stringify(frozen, null, 2).replace(
    new RegExp(`"${EXACT_INTEGER_PREFIX}(-?\\d+)"`, 'g'),
    'exactInteger("$1")',
  );
  const replacement = `/* EXPECTED_SOURCE_START */ ${serialized} /* EXPECTED_SOURCE_END */`;
  const expectedSourcePattern = /\/\* EXPECTED_SOURCE_START \*\/[\s\S]*?\/\* EXPECTED_SOURCE_END \*\//;
  if (!expectedSourcePattern.test(source)) throw new Error('expected-source marker not found');
  const next = source.replace(expectedSourcePattern, replacement);
  if (next !== source) writeFileSync(sourcePath, next);
  console.log(`adopted ${Object.keys(frozen).length} frozen expectations`);
  process.exit(0);
}
if (!['--write', '--check'].includes(mode)) throw new Error(`unknown mode ${mode}`);

const artifacts = [...renderedCases.map(({ path, raw }) => [path, raw]), ['corpus.manifest.json', render(manifest)]];
if (mode === '--write') {
  const retained = new Set(renderedCases.map(({ path }) => path));
  for (const stale of readdirSync(DIRECTORY).filter((name) => name.endsWith('.case.json') && !retained.has(name))) {
    unlinkSync(join(DIRECTORY, stale));
  }
}
for (const [path, raw] of artifacts) {
  const absolute = join(DIRECTORY, path);
  if (mode === '--write') writeFileSync(absolute, raw);
  else if (readFileSync(absolute, 'utf8') !== raw) throw new Error(`${path} drifted from corpus-source.mjs`);
}
console.log(`${mode === '--write' ? 'wrote' : 'verified'} ${renderedCases.length} delta-semantics cases`);
