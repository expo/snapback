# Client follow-up: useSnapbackAssetImage should consume server-provided placeholders

**Status:** OPEN — successor to the resolved record-surface ticket
(2026-07-31)

`GET /assets/records/{id}` and the live projection now serve
`renditions` + `media` (ThumbHash placeholder, dominantColor, dims,
mediaType) per `schemas/asset.record-view.schema.json`. The React
`useSnapbackAssetImage` hook and the headless `record`/`watch` snapshot
still treat the placeholder as a caller-supplied prop. Extend the client
snapshot types to surface the view's `media`/`renditions`, default the
renderer ladder's placeholder to `media.placeholder` when present, and
drop the prop to optional-override. Lane-1 package territory
(packages/snapback-client, packages/snapback-react).
