```json
{
  "scorer": {
    "family": "astra",
    "model": "gpt-6-astra",
    "basis": "own lane's narrative files (Snapback 2 only)"
  },
  "backends": {
    "snapback2": {
      "overall": {
        "score": null,
        "note": "Unscored: file access failed before any evidence could be read; assigning an integer would fabricate an assessment."
      },
      "setup_and_docs": {"score": null, "note": "Required lane evidence inaccessible."},
      "data_modeling": {"score": null, "note": "Required lane evidence inaccessible."},
      "authorization": {"score": null, "note": "Required lane evidence inaccessible."},
      "queries_and_live": {"score": null, "note": "Required lane evidence inaccessible."},
      "writes_and_transactions": {"score": null, "note": "Required lane evidence inaccessible."},
      "offline_sync": {"score": null, "note": "Required lane evidence inaccessible."},
      "media_assets": {"score": null, "note": "Required lane evidence inaccessible."},
      "background_work": {"score": null, "note": "Required lane evidence inaccessible."},
      "client_integration": {"score": null, "note": "Required lane evidence inaccessible."},
      "diagnostics_dev_loop": {"score": null, "note": "Required lane evidence inaccessible."},
      "scale_and_limits": {"score": null, "note": "Required lane evidence inaccessible."},
      "operations": {"score": null, "note": "Required lane evidence inaccessible."},
      "verdict": "No backend verdict is supported because the specified evidence could not be read.",
      "would_use_again_for": "Undetermined without access to the lane evidence."
    }
  },
  "notes": [
    "Both read attempts failed during sandbox initialization with: bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted.",
    "This scorer-environment failure is not evidence against Snapback 2.",
    "No files were opened or changed.",
    "Null scores indicate missing evidence, not zero performance.",
    "Please provide the specified files' contents or rerun with working read access so I can produce the requested integer scores."
  ]
}
```