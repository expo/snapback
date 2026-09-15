# Clique full run: same-family holistic Snapback 4 scores (0–100)

Each builder model scored only its own lane's narrative evidence at xhigh. This adapts the September 5 rubric from three backends per family to one Snapback 4 lane per family; prior cross-backend scores remain anchors rather than directly pooled observations.

| Category | Astra | Grok | Muse | Mean |
| --- | ---: | ---: | ---: | ---: |
| overall | 82 | 63 | 82 | 76 |
| setup_and_docs | 79 | 71 | 90 | 80 |
| data_modeling | 84 | 85 | 90 | 86 |
| authorization | 87 | 63 | 95 | 82 |
| queries_and_live | 77 | 57 | 78 | 71 |
| writes_and_transactions | 86 | 77 | 72 | 78 |
| offline_sync | 80 | 37 | 70 | 62 |
| media_assets | 93 | 79 | 85 | 86 |
| background_work | 78 | 81 | 88 | 82 |
| client_integration | 84 | 48 | 80 | 71 |
| diagnostics_dev_loop | 75 | 79 | 70 | 75 |
| scale_and_limits | 76 | 83 | 55 | 71 |
| operations | 83 | 69 | 75 | 76 |

## Verdicts

- **astra:** Snapback 4 was a strong fit for this messenger, with substantial integration savings tempered by three consequential defects or documentation mismatches and a costly retention workaround. Would use again for: I would use it again for relational messaging applications needing durable offline interaction, membership-scoped replication and revocable media, while testing retention and prediction behavior early.
- **grok:** Snapback 4 made Clique’s server program cheap and the Expo-web choreography bar expensive, because liveness and offline only show up on the replica arm this lane could not keep. Would use again for: A product whose hard part is authorization and sync and whose clients can stay on the local replica, not a Playwright two-browser online web proof.
- **muse:** Snapback 4 carried auth, expiry, and ordering correctness while charging the builder for convergence timing and outbox durability. Would use again for: I would choose it again for an offline-capable social app, demanding a device inspector and a navigation-surviving durable-mutation primitive.
