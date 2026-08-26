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
    "verdict": "Fallback",
    "reason": "predicate-unanalyzable"
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
  "window-interval-clips-candidate": {
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
  "window-tail-authenticated-exhausted-true": {
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
  },
  "window-tail-authenticated-exhausted-false": {
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
        }
      ],
      "boundary": {
        "values": [
          1
        ],
        "rowKey": "a"
      },
      "resultCount": 1,
      "complete": false,
      "label": "incomplete",
      "continuation": {
        "values": [
          1
        ],
        "rowKey": "a"
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
          "rowVersion": null
        }
      },
      "children": {
        "c1": {
          "_id": "c1",
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
  "lookup-inadmitted-child-does-not-attach": {
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
          "childKey": null,
          "found": false,
          "rowVersion": null
        }
      },
      "children": {}
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
  "lookup-child-rekey-old-leaves-new-arrives": {
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
          "bit": true
        }
      }
    }
  },
  "support-all-mode-element-transition": {
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
  "support-same-scope-delete-insert-fold": {
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
  "support-parent-death-destroys-bit": {
    "verdict": "Maintain",
    "deltaOut": {
      "transitions": []
    },
    "nextState": {
      "scopes": {}
    }
  },
  "support-through-target-change": {
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
  "lift-zero-to-one-admits-unretained": {
    "verdict": "Maintain",
    "deltaOut": {
      "entries": [
        {
          "rowKey": "a",
          "op": "update",
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
  "principal-binding-then-target": {
    "verdict": "Maintain",
    "deltaOut": {
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
    },
    "nextState": {
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
  },
  "principal-digest-cannot-rekey": {
    "verdict": "Fallback",
    "reason": "rekey-unread"
  },
  "assemble-projection-scoped-patch": {
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
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
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
            "title": "new",
            "child": {
              "name": "assembled"
            }
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "resultDigest": "sha256:8cc79c6b8ffe23ce67ea8d7a336e6d92ef096225d0c1a67b18c72ea139e0014f"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "new",
          "child": {
            "name": "assembled"
          }
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
      "resultDigest": "sha256:1c5ad2f3964bf1a50920e8e94e0f1e354af0e4fa4e52e858d0f04288470267c4"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "old"
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
  "assemble-to-many-direct-root-addressable": {
    "verdict": "Maintain",
    "deltaOut": {
      "ops": [
        {
          "op": "add",
          "nodeId": "many",
          "rootKey": "p1",
          "key": "c1",
          "position": 0,
          "row": {
            "_id": "c1",
            "title": "child"
          }
        }
      ],
      "orderedRootKeys": [
        "p1"
      ],
      "resultDigest": "sha256:df1c90bb50477d266dd4298c22988193edfa2b84c14e9fd6a25d9407b9a80dee"
    },
    "nextState": {
      "result": [
        {
          "_id": "p1",
          "title": "old",
          "children": [
            {
              "_id": "c1",
              "title": "child"
            }
          ]
        }
      ],
      "orderedRootKeys": [
        "p1"
      ]
    }
  },
  "composition-admit-to-window": {
    "verdict": "Maintain",
    "deltaOut": {
      "admit": {
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
              "rank": 1
            }
          }
        ]
      }
    },
    "nextState": {
      "admit": {
        "retained": {
          "a": {
            "_id": "a",
            "rank": 1
          }
        }
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
  "composition-fallback-aborts-frame": {
    "verdict": "Fallback",
    "reason": "rank-undecidable"
  },
  "window-incomplete-underfill-tail-exhausted-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-tail-competition-known-mask-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-tail-authenticated-exhausted-true-empty-transcript": {
    "verdict": "Fallback",
    "reason": "boundary-displacement"
  },
  "window-tail-authenticated-exhausted-false-empty-transcript": {
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
  "window-backward-tail-competition-empty-transcript": {
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
  "support-through-target-change-empty-transcript": {
    "verdict": "Fallback",
    "reason": "support-unproved"
  },
  "lift-zero-to-one-admits-unretained-empty-transcript": {
    "verdict": "Fallback",
    "reason": "scope-unresolved"
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
const dz = (rowKey, op, admit, postImage, rankKeys = []) => ({
  rowKey, op, admit, ...(postImage === undefined ? {} : { postImage }), rankKeys,
});
const parent = (id, admit, join, extra = {}) => dz(id, admit === 'enter' ? 'insert' : 'update', admit,
  admit === 'leave' ? undefined : { _id: id, join, ...extra });
const tail = (window, boundary, k, rows, exhausted, labelOnly = false) => ({
  request: { kind: 'tail', window, ...(boundary === null ? {} : { boundary }), k, labelOnly },
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
const lookupScope = (lookupKey, childKey, found = childKey !== null) => ({
  lookupKey, childKey, found, rowVersion: null,
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
const supportScope = (joinKey, bit) => ({ joinKey, bit });

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
add('admit-membership-rekey-probed', ['admit', 'membership', 'parent-arm'], publicAdmit({
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
add('window-backward-order', ['window'], window({ order: [{ field: 'rank', direction: 'desc' }] }), windowState([['c', 3], ['b', 2]], true), {
  entries: [dz('d', 'insert', 'enter', row('d', 4), [4])],
});
add('window-interval-clips-candidate', ['window'], window({
  interval: { upper: { key: rankKey('b', 2), inclusive: true } },
}), windowState([['a', 1], ['b', 2]], true), { entries: [dz('c', 'insert', 'enter', row('c', 3), [3])] });
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
add('window-tail-authenticated-exhausted-true', ['window', 'read-maintain'], window(), windowState([['a', 1]], false), { entries: [] }, [
  tail('root', rankKey('a', 1), 1, [], true),
]);
add('window-tail-authenticated-exhausted-false', ['window', 'read-maintain'], window(), windowState([['a', 1]], false), { entries: [] }, [
  tail('root', rankKey('a', 1), 1, [], false),
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
add('window-empty-incomplete-tail-from-start', ['window', 'read-maintain'], window(), windowState([], false), { entries: [] }, [
  tail('root', null, 2, [row('a', 1), row('b', 2)], true),
]);
add('window-backward-tail-competition', ['window', 'read-maintain'], window({ order: [{ field: 'rank', direction: 'desc' }] }), {
  ...windowState([['c', 3], ['b', 2]], false),
}, { entries: [dz('c', 'delete', 'leave'), dz('a', 'insert', 'enter', row('a', 1), [1])] }, [
  tail('root', rankKey('b', 2), 1, [row('x', 1.5)], true),
]);

// E4 unique keyed lookup and presence cases.
const foundState = lookupState({ p1: lookupScope(['j1'], 'c1') }, { c1: { _id: 'c1', join: 'j1', name: 'old' } });
const missingState = lookupState({ p1: lookupScope(['j1'], null, false) }, {});
add('lookup-child-patch', ['lookup', 'presence'], lookup(), clone(foundState), { parent: { entries: [] }, child: { entries: [
  dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j1', name: 'new', secret: 'hidden' }),
] } });
add('lookup-optional-found-to-missing', ['lookup', 'presence'], lookup(), clone(foundState), { parent: { entries: [] }, child: { entries: [dz('c1', 'delete', 'leave')] } });
add('lookup-optional-missing-to-found', ['lookup', 'presence'], lookup(), clone(missingState), { parent: { entries: [] }, child: { entries: [
  dz('c1', 'insert', 'enter', { _id: 'c1', join: 'j1', name: 'new' }),
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
  child: { entries: [dz('c2', 'insert', 'enter', { _id: 'c2', join: 'j2', name: 'two' })] },
}, [point('child.by_join', ['j2'], { _id: 'c2', join: 'j2', name: 'two' })]);
add('lookup-inadmitted-child-does-not-attach', ['lookup'], lookup(), clone(missingState), {
  parent: { entries: [] }, child: { entries: [dz('c1', 'insert', 'stay-out', { _id: 'c1', join: 'j1', name: 'hidden' })] },
});
add('lookup-scope-death-no-read', ['lookup', 'parent-arm'], lookup(), clone(foundState), {
  parent: { entries: [dz('p1', 'delete', 'leave')] }, child: { entries: [] },
});
add('lookup-child-rekey-old-leaves-new-arrives', ['lookup', 'rekey'], lookup(), clone(foundState), {
  parent: { entries: [] }, child: { entries: [dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j2', name: 'moved' })] },
});

// E5 bounded per-parent windows.
add('per-parent-birth-fill-emitted', ['per-parent-window', 'scope-fill', 'read-maintain'], e5(), { scopes: {} }, {
  parent: { entries: [parent('p1', 'enter', 'j1')] }, childByScope: {},
}, [range('child.by_parent', ['j1'], 4, [row('c1', 1), row('c2', 2)])]);
add('per-parent-birth-null-key-skips-read', ['per-parent-window', 'scope-fill'], e5(), { scopes: {} }, {
  parent: { entries: [dz('p1', 'insert', 'enter', { _id: 'p1', join: null })] }, childByScope: {},
});
const e5State = { scopes: { p1: { lookupKey: ['j1'], window: windowState([['c1', 1], ['c2', 2]], true) } } };
add('per-parent-rekey-prior-to-fill', ['per-parent-window', 'rekey', 'read-maintain'], e5(), clone(e5State), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, childByScope: {},
}, [range('child.by_parent', ['j2'], 4, [row('c3', 3)])]);
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
add('per-parent-zero-take-rekey', ['per-parent-window', 'rekey'], e5({ window: window({ windowId: 'children', take: 0 }).config }), clone(e5State), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, childByScope: {},
});
add('per-parent-both-change-parent-first-skip', ['per-parent-window', 'both-change', 'read-maintain'], e5(), clone(e5State), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] },
  childByScope: { p1: { entries: [dz('c3', 'insert', 'enter', row('c3', 3), [3])] } },
}, [range('child.by_parent', ['j2'], 4, [row('c3', 3)])]);

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
add('support-through-zero-to-one-probed', ['support', 'read-maintain'], support({ edgeKind: 'through' }), clone(supportFalse), {
  parent: { entries: [] }, support: { entries: [dz('through1', 'insert', 'enter', { _id: 'through1', join: 'j1' })] }, target: { entries: [] },
}, [probe('edge', 'p1', true)]);
const allSupport = support({ mode: { kind: 'all', elements: ['a', 'b'] } });
add('support-all-mode-element-transition', ['support', 'read-maintain'], allSupport, clone(supportFalse), {
  parent: { entries: [] }, support: { entries: [dz('m1', 'insert', 'enter', { _id: 'm1', join: 'j1' })] }, target: { entries: [] },
}, [probe('edge', 'p1', true, 'a'), probe('edge', 'p1', true, 'b')]);
add('support-same-scope-delete-insert-fold', ['support', 'batch-fold'], support(), clone(supportTrue), {
  parent: { entries: [] }, support: { entries: [
    dz('m1', 'delete', 'leave', undefined, ['j1']), dz('m2', 'insert', 'enter', { _id: 'm2', join: 'j1' }),
  ] }, target: { entries: [] },
});
add('support-parent-birth-establishes-bit', ['support', 'parent-arm', 'read-maintain'], support(), { scopes: {} }, {
  parent: { entries: [parent('p1', 'enter', 'j1')] }, support: { entries: [] }, target: { entries: [] },
}, [probe('edge', 'p1', true)]);
add('support-parent-rekey-establishes-bit', ['support', 'parent-arm', 'rekey', 'read-maintain'], support(), clone(supportTrue), {
  parent: { entries: [parent('p1', 'stay-in', 'j2')] }, support: { entries: [] }, target: { entries: [] },
}, [probe('edge', 'p1', false)]);
add('support-scope-attribution-unresolved', ['support', 'fallback'], support(), clone(supportTrue), {
  parent: { entries: [] }, support: { entries: [dz('m1', 'delete', 'leave')] }, target: { entries: [] },
});
add('support-parent-death-destroys-bit', ['support', 'parent-arm'], support(), clone(supportTrue), {
  parent: { entries: [dz('p1', 'delete', 'leave')] }, support: { entries: [] }, target: { entries: [] },
});
add('support-through-target-change', ['support', 'read-maintain'], support({ edgeKind: 'through' }), clone(supportTrue), {
  parent: { entries: [] }, support: { entries: [] }, target: { entries: [dz('t1', 'delete', 'leave', undefined, ['j1'])] },
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
add('principal-binding-then-target', ['principal', 'both-change'], principalBinding, { binding: clone(foundState), target: clone(foundState), principalDigests: { p1: 'digest-only' } }, {
  binding: { parent: { entries: [] }, child: { entries: [dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j1', name: 'bound' })] } },
  target: { parent: { entries: [] }, child: { entries: [dz('c1', 'update', 'stay-in', { _id: 'c1', join: 'j1', name: 'target' })] } },
});
add('principal-digest-cannot-rekey', ['principal', 'fallback'], principal, { binding: lookupState(), target: clone(foundState), principalDigests: { p1: 'digest-only' } }, {
  binding: { parent: { entries: [] }, child: { entries: [] } },
  target: { parent: { entries: [parent('p1', 'stay-in', 'j2')] }, child: { entries: [] } },
});

// E8 wire lowering and assembly.
const assemble = (nodes) => ({ form: 'assemble', config: { rootNodeId: 'root', nodes } });
const rootNode = { nodeId: 'root', parent: null, kind: 'root', projectionFields: ['_id', 'title'] };
const oneNode = { nodeId: 'one', parent: 'root', kind: 'to-one', resultField: 'child', projectionFields: ['name'] };
const manyNode = { nodeId: 'many', parent: 'root', kind: 'to-many', resultField: 'children', projectionFields: ['_id', 'title'] };
const existsNode = { nodeId: 'exists', parent: 'root', kind: 'exists', resultField: 'hasAny', projectionFields: ['hasAny'] };
const assembleState = { result: [{ _id: 'p1', title: 'old' }], orderedRootKeys: ['p1'] };
add('assemble-projection-scoped-patch', ['assemble'], assemble([rootNode]), clone(assembleState), {
  events: [{ kind: 'root-seq', nodeId: 'root', delta: { ops: [{ op: 'patch', sortKey: rankKey('p1', 1), rowKey: 'p1', post: { title: 'new', secret: 'hidden' } }] } }],
  postResult: [{ _id: 'p1', title: 'new' }], orderedRootKeys: ['p1'],
});
// serde field names inside enum variants are snake_case; the next normalization fixes authored convenience.
authored.at(-1).foldedChangeBatch.events[0].delta.ops[0] = { op: 'patch', sortKey: rankKey('p1', 1), rowKey: 'p1', post: { title: 'new', secret: 'hidden' } };
add('assemble-root-splice-add', ['assemble'], assemble([rootNode]), { result: [], orderedRootKeys: [] }, {
  events: [{ kind: 'root-seq', nodeId: 'root', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('p1', 1), row: { _id: 'p1', title: 'new', secret: 'hidden' } }] } }],
  postResult: [{ _id: 'p1', title: 'new', child: { name: 'assembled' } }], orderedRootKeys: ['p1'],
});
add('assemble-to-one-presence', ['assemble', 'presence'], assemble([rootNode, oneNode]), clone(assembleState), {
  events: [{ kind: 'to-one', nodeId: 'one', delta: { ops: [{ kind: 'presence', scope: 'p1', childKey: 'c1', value: { name: 'child' } }] } }],
  postResult: [{ _id: 'p1', title: 'old', child: { name: 'child' } }], orderedRootKeys: ['p1'],
});
add('assemble-exists-bit', ['assemble', 'support'], assemble([rootNode, existsNode]), clone(assembleState), {
  events: [{ kind: 'exists', nodeId: 'exists', delta: { transitions: [{ scope: 'p1', transition: 'zero-to-one' }] } }],
  postResult: [{ _id: 'p1', title: 'old', hasAny: true }], orderedRootKeys: ['p1'],
});
const nestedOne = { nodeId: 'nestedOne', parent: 'many', kind: 'to-one', projectionFields: ['name'] };
add('assemble-below-array-unaddressable', ['assemble', 'fallback'], assemble([rootNode, manyNode, nestedOne]), clone(assembleState), {
  events: [{ kind: 'to-one', nodeId: 'nestedOne', delta: { ops: [{ kind: 'presence', scope: 'c1', childKey: 'x', value: { name: 'x' } }] } }],
  postResult: clone(assembleState.result), orderedRootKeys: ['p1'],
});
add('assemble-ancestor-birth-absorbs-descendant', ['assemble', 'ancestor-absorption'], assemble([rootNode, manyNode]), clone(assembleState), {
  events: [
    { kind: 'root-seq', nodeId: 'root', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('p2', 2), row: { _id: 'p2', title: 'new' } }] } },
    { kind: 'to-many', nodeId: 'many', scope: 'p2', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('c1', 1), row: { _id: 'c1', title: 'child' } }] } },
  ],
  postResult: [
    { _id: 'p1', title: 'old' },
    { _id: 'p2', title: 'new', children: [{ _id: 'c1', title: 'child' }] },
  ],
  orderedRootKeys: ['p1', 'p2'],
});
add('assemble-to-many-direct-root-addressable', ['assemble'], assemble([rootNode, manyNode]), clone(assembleState), {
  events: [{ kind: 'to-many', nodeId: 'many', scope: 'p1', delta: { ops: [{ op: 'splice-in', sortKey: rankKey('c1', 1), row: { _id: 'c1', title: 'child' } }] } }],
  postResult: [{ _id: 'p1', title: 'old', children: [{ _id: 'c1', title: 'child' }] }], orderedRootKeys: ['p1'],
});

// Whole-graph dataflow and atomic fallback.
const composition = { form: 'composition', nodes: [
  { nodeId: 'admit', operator: publicAdmit(), inputFrom: null },
  { nodeId: 'window', operator: window(), inputFrom: 'admit' },
] };
add('composition-admit-to-window', ['composition'], composition, {
  admit: { retained: {} }, window: windowState([], true),
}, {
  admit: { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', 1) }] }, supportBits: {} },
});
add('composition-fallback-aborts-frame', ['composition', 'fallback'], composition, {
  admit: { retained: {} }, window: windowState([], true),
}, {
  admit: { changes: { changes: [{ rowKey: 'a', op: 'insert', postImage: row('a', [1]) }] }, supportBits: {} },
});

// Every maintain vector whose proof consumes R has an exact empty-transcript
// twin. The reference form must return that rule's domain reason, never a
// generic read-unavailable reason.
for (const source of authored.filter(({ coverage }) => coverage.includes('read-maintain'))) {
  add(`${source.name}-empty-transcript`, [...source.coverage.filter((tag) => tag !== 'read-maintain'), 'fallback'],
    clone(source.operator), clone(source.initialState), clone(source.foldedChangeBatch), []);
}

if (authored.length < 60 || authored.length > 120) {
  throw new Error(`delta-semantics corpus must contain 60-120 cases, found ${authored.length}`);
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
    .map((name) => JSON.parse(readFileSync(join(DIRECTORY, name), 'utf8')))
    .map((value) => [value.name, value.expected]));
  if (Object.keys(frozen).length !== authored.length) throw new Error('cannot adopt an incomplete frozen corpus');
  const sourcePath = fileURLToPath(import.meta.url);
  const source = readFileSync(sourcePath, 'utf8');
  const replacement = `/* EXPECTED_SOURCE_START */ ${JSON.stringify(frozen, null, 2)} /* EXPECTED_SOURCE_END */`;
  const next = source.replace(/\/\* EXPECTED_SOURCE_START \*\/[\s\S]*?\/\* EXPECTED_SOURCE_END \*\//, replacement);
  if (next === source) throw new Error('expected-source marker not found');
  writeFileSync(sourcePath, next);
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
