
## Corroboration (2026-08-27 clique matrix, published 0.1.29)

Reproduced again by an autonomous lane on 0.1.29: `grok-snapback-explicit`
recorded that *"supervised Expo web wants stdin detached or the owner dies on
pipe EOF"* — the supervised `snapback dev --expo` owner dies when its stdin
reaches EOF (e.g. a closed pipe / non-interactive launcher), and the model had
to detach stdin to keep the loop alive. This is a recurring autonomous-agent
papercut (cf. grok-0127, which hit stdin=`/dev/null` → reload undeliverable) and
overlaps `20260825-dev-control-channel-requires-stdin`. Evidence: lane run-log
`~/clique-matrix-0129/lanes/grok-snapback-explicit/`.
